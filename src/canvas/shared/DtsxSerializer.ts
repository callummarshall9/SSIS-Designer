/**
 * DtsxSerializer – parses .dtsx XML into SsisPackageModel and serializes back.
 *
 * Key design goals:
 *  1. Round-trip fidelity: unknown/unrecognized XML elements are preserved.
 *  2. Namespace-aware: handles DTS:, SQLTask:, pipeline: prefixes.
 *  3. Two serialization modes:
 *       "merge" – patches the original XML document (preserving formatting).
 *       "new"   – builds the XML from the model alone.
 */

import { XMLParser, XMLBuilder, XmlBuilderOptions } from 'fast-xml-parser';
import {
  SsisPackageModel,
  SsisExecutable,
  PrecedenceConstraint,
  ConnectionManager,
  SsisVariable,
  SsisParameter,
  SsisDataType,
  DTS_DATA_TYPE_MAP,
  ObjectDataConnectionRef,
  UnknownXmlElement,
} from '../../models/SsisPackageModel';
import {
  DataFlowModel,
  DataFlowComponent,
  DataFlowInput,
  DataFlowOutput,
  DataFlowColumn,
  ExternalColumn,
  DataFlowPath,
} from '../../models/DataFlowModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a GUID wrapped in braces: {xxxxxxxx-xxxx-...} */
function newGuid(): string {
  // Use crypto.randomUUID when available (Node 19+), otherwise manual.
  try {
    const g = (globalThis as any).crypto;
    if (g && typeof g.randomUUID === 'function') {
      return `{${(g.randomUUID() as string).toUpperCase()}}`;
    }
  } catch { /* ignore */ }
  // Fallback – manual v4-like
  const hex = '0123456789ABCDEF';
  const seg = (n: number) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('');
  return `{${seg(8)}-${seg(4)}-4${seg(3)}-${hex[8 + Math.floor(Math.random() * 4)]}${seg(3)}-${seg(12)}}`;
}

/** Ensure a value is always an array */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) { return []; }
  return Array.isArray(v) ? v : [v];
}

/** Get attribute value supporting both prefixed and non-prefixed keys */
function attr(node: any, name: string): string {
  if (!node) { return ''; }
  // fast-xml-parser with attributeNamePrefix = '@_' stores attrs as @_Name
  return String(node[`@_DTS:${name}`] ?? node[`@_${name}`] ?? node[name] ?? '');
}

function attrNum(node: any, name: string): number {
  const v = attr(node, name);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Safely read text content from a node that may be { '#text': ... } or just a string */
function textContent(node: any): string {
  if (node === undefined || node === null) { return ''; }
  if (typeof node === 'string' || typeof node === 'number') { return String(node); }
  if (typeof node === 'object' && '#text' in node) { return String(node['#text']); }
  return '';
}

/** Convert DTS numeric type code to SsisDataType */
function numericToDataType(code: number | string): SsisDataType {
  const num = typeof code === 'string' ? parseInt(code, 10) : code;
  return DTS_DATA_TYPE_MAP[num] ?? 'String';
}

// ---------------------------------------------------------------------------
// Default parser / builder options
// ---------------------------------------------------------------------------

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Preserve CDATA
  cdataPropName: '__cdata',
  // Don't trim whitespace in text
  trimValues: false,
  // Preserve tag order so we can detect unknowns
  preserveOrder: false,
  // Parse tag values
  parseTagValue: false,
  // Allow boolean attrs
  allowBooleanAttributes: true,
  // Keep namespace prefix in tag names
  removeNSPrefix: false,
  // Process all entities
  processEntities: true,
  // Comment handling
  commentPropName: '__comment',
  // Stop number parsing
  numberParseOptions: { leadingZeros: false, hex: false },
  isArray: (tagName: string, _jPath: string, _isLeafNode: boolean, _isAttribute: boolean) => {
    // Force certain tags to always be arrays for consistency
    const arrayTags = [
      'DTS:Variable', 'DTS:Executable', 'DTS:PrecedenceConstraint',
      'DTS:ConnectionManager', 'DTS:Property', 'DTS:PackageParameter',
      'DTS:VariableValue',
      'pipeline:component', 'pipeline:path',
      'pipeline:input', 'pipeline:output',
      'pipeline:inputColumn', 'pipeline:outputColumn',
      'pipeline:externalMetadataColumn',
      'pipeline:property',
      'component', 'path', 'input', 'output',
      'inputColumn', 'outputColumn', 'externalMetadataColumn',
      'property',
    ];
    return arrayTags.includes(tagName);
  },
};

const BUILDER_OPTIONS: Partial<XmlBuilderOptions> = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  commentPropName: '__comment',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
  suppressBooleanAttributes: false,
};

// ---------------------------------------------------------------------------
// Known DTS child element names (used to detect unknowns at various levels)
// ---------------------------------------------------------------------------

const KNOWN_PACKAGE_CHILDREN = new Set([
  'DTS:Property', 'DTS:ConnectionManagers', 'DTS:Variables',
  'DTS:PackageParameters', 'DTS:Executables', 'DTS:PrecedenceConstraints',
  'DTS:DesignTimeProperties', 'DTS:LogProviders', 'DTS:Configurations',
  'DTS:EventHandlers',
]);

const KNOWN_EXECUTABLE_CHILDREN = new Set([
  'DTS:Property', 'DTS:Variables', 'DTS:Executables',
  'DTS:PrecedenceConstraints', 'DTS:ObjectData', 'DTS:ForEachEnumerator',
  'DTS:ForEachVariableMappings', 'DTS:LoggingOptions', 'DTS:PropertyExpression',
  'DTS:EventHandlers', 'DTS:DesignTimeProperties',
]);

const SQLTASK_NAMESPACE = 'www.microsoft.com/sqlserver/dts/tasks/sqltask';
const DEFAULT_LAST_MODIFIED_PRODUCT_VERSION = '16.0.0.0';
const DEFAULT_LOCALE_ID = '1033';
const DEFAULT_VERSION_BUILD = '0';

// ---------------------------------------------------------------------------
// DtsxSerializer class
// ---------------------------------------------------------------------------

export class DtsxSerializer {
  private parser: XMLParser;
  private builder: XMLBuilder;
  /** Temporarily set during serialization so child methods can resolve connection GUIDs. */
  private _connectionManagers: ConnectionManager[] = [];

  constructor() {
    this.parser = new XMLParser(PARSER_OPTIONS as any);
    this.builder = new XMLBuilder(BUILDER_OPTIONS as any);
  }

  /**
   * Resolve a connection reference to its DTSID.
   * If the value is already a GUID (wrapped in braces), return it unchanged.
   * Otherwise look up the CM by objectName and return its DTSID.
   */
  private resolveConnectionDtsId(idOrName: string): string {
    if (idOrName.startsWith('{') && idOrName.endsWith('}')) {
      return idOrName;
    }
    const cm = this._connectionManagers.find(c => c.objectName === idOrName);
    return cm?.dtsId || idOrName;
  }

  // =========================================================================
  // PARSING  .dtsx → SsisPackageModel
  // =========================================================================

  /**
   * Parse a raw .dtsx XML string into an SsisPackageModel.
   */
  parse(xml: string): SsisPackageModel {
    const doc = this.parser.parse(xml);
    // The isArray callback forces DTS:Executable to always be an array (since
    // tasks inside DTS:Executables use the same tag). At the document root
    // level, there is exactly one package element, so unwrap the array.
    const rawRoot = doc['DTS:Executable'] ?? doc['Executable'] ?? doc;
    const root = Array.isArray(rawRoot) ? rawRoot[0] : rawRoot;

    // --- Package-level attributes -----------------------------------------
    const packageName = attr(root, 'ObjectName');
    const packageId = attr(root, 'DTSID');
    const creationDate = attr(root, 'CreationDate');
    const creatorName = attr(root, 'CreatorName');
    const description = attr(root, 'Description') || '';

    // --- Properties -------------------------------------------------------
    const properties = this.parseProperties(root);
    const formatVersion = parseInt(properties['PackageFormatVersion'] ?? '8', 10);

    // --- Connection managers ----------------------------------------------
    const connectionManagers = this.parseConnectionManagers(root);

    // --- Variables ---------------------------------------------------------
    const variables = this.parseVariables(root);

    // --- Parameters --------------------------------------------------------
    const parameters = this.parseParameters(root);

    // --- Executables -------------------------------------------------------
    const executables = this.parseExecutables(root);

    // --- Precedence constraints -------------------------------------------
    const precedenceConstraints = this.parsePrecedenceConstraints(root, executables);

    // --- Design time properties (canvas positions) ------------------------
    this.applyDesignTimeProperties(root, executables);

    // --- Unknown elements --------------------------------------------------
    const unknownElements = this.collectUnknownElements(root, 'DTS:Executable', KNOWN_PACKAGE_CHILDREN);

    return {
      packageName,
      packageId,
      creationDate,
      creatorName,
      description,
      formatVersion,
      executables,
      precedenceConstraints,
      connectionManagers,
      variables,
      parameters,
      properties,
      unknownElements,
    };
  }

  // ---- Properties --------------------------------------------------------

  private parseProperties(node: any): Record<string, string> {
    const props: Record<string, string> = {};
    const propNodes = asArray(node['DTS:Property']);
    for (const p of propNodes) {
      const name = attr(p, 'Name');
      if (name) {
        props[name] = textContent(p);
      }
    }
    return props;
  }

  // ---- Connection Managers -----------------------------------------------

  private parseConnectionManagers(root: any): ConnectionManager[] {
    const cmContainer = root['DTS:ConnectionManagers'];
    if (!cmContainer) { return []; }
    const cmNodes = asArray(cmContainer['DTS:ConnectionManager']);
    return cmNodes.map((cm, idx) => this.parseOneConnectionManager(cm, idx));
  }

  private parseOneConnectionManager(cm: any, idx: number): ConnectionManager {
    const dtsId = attr(cm, 'DTSID');
    const objectName = attr(cm, 'ObjectName');
    const creationName = attr(cm, 'CreationName');
    const description = attr(cm, 'Description') || '';

    // Connection string lives inside ObjectData > DTS:ConnectionManager > DTS:Property
    let connectionString = '';
    const props: Record<string, string> = {};
    const objectData = cm['DTS:ObjectData'];
    if (objectData) {
      // The isArray callback forces DTS:ConnectionManager to always be an array,
      // even for the inner CM node inside ObjectData — unwrap it.
      const innerRaw = objectData['DTS:ConnectionManager'];
      const inner = Array.isArray(innerRaw) ? innerRaw[0] : innerRaw;
      if (inner) {
        const innerProps = asArray(inner['DTS:Property']);
        for (const p of innerProps) {
          const name = attr(p, 'Name');
          const val = textContent(p);
          if (name === 'ConnectionString') {
            connectionString = val;
          }
          if (name) {
            props[name] = val;
          }
        }
        // Also check for attributes on the inner ConnectionManager (e.g. RetainSameConnection)
        for (const key of Object.keys(inner)) {
          if (key.startsWith('@_')) {
            const attrName = key.replace('@_DTS:', '').replace('@_', '');
            if (attrName !== 'Name') {
              props[attrName] = String(inner[key]);
            }
          }
        }
        // Q1-style: ConnectionString may be an attribute on the inner CM, not a DTS:Property child
        if (!connectionString && props['ConnectionString']) {
          connectionString = props['ConnectionString'];
        }
      }
    }

    const unknownElements = this.collectUnknownElements(cm, `ConnectionManager[${objectName}]`, new Set([
      'DTS:Property', 'DTS:ObjectData',
    ]));

    return {
      id: dtsId || `cm-${idx}`,
      dtsId,
      objectName,
      connectionString,
      creationName,
      description,
      properties: props,
      unknownElements,
    };
  }

  // ---- Variables ----------------------------------------------------------

  private parseVariables(node: any): SsisVariable[] {
    const container = node['DTS:Variables'];
    if (!container) { return []; }
    const varNodes = asArray(container['DTS:Variable']);
    return varNodes.map((v, idx) => this.parseOneVariable(v, idx));
  }

  private parseOneVariable(v: any, idx: number): SsisVariable {
    const dtsId = attr(v, 'DTSID');
    const objectName = attr(v, 'ObjectName');
    const namespace = attr(v, 'Namespace') || 'User';
    const expression = attr(v, 'Expression') || undefined;
    const evalAsExpr = attr(v, 'EvaluateAsExpression') === '-1' || attr(v, 'EvaluateAsExpression').toLowerCase() === 'true';
    const readOnly = attr(v, 'ReadOnly') === '-1' || attr(v, 'ReadOnly').toLowerCase() === 'true';

    // Value & data type
    let dataType: SsisDataType = 'String';
    let value: any = '';
    const valNodes = asArray(v['DTS:VariableValue']);
    if (valNodes.length > 0) {
      const vn = valNodes[0];
      const dtCode = attr(vn, 'DataType');
      dataType = numericToDataType(dtCode);
      value = textContent(vn);
    }

    const unknownElements = this.collectUnknownElements(v, `Variable[${objectName}]`, new Set([
      'DTS:VariableValue', 'DTS:Property',
    ]));

    return {
      id: dtsId || `var-${idx}`,
      dtsId,
      objectName,
      namespace,
      dataType,
      value,
      expression,
      evaluateAsExpression: evalAsExpr,
      readOnly,
      unknownElements,
    };
  }

  // ---- Parameters ---------------------------------------------------------

  private parseParameters(root: any): SsisParameter[] {
    const container = root['DTS:PackageParameters'];
    if (!container) { return []; }
    const paramNodes = asArray(container['DTS:PackageParameter']);
    return paramNodes.map((p, idx) => this.parseOneParameter(p, idx));
  }

  private parseOneParameter(p: any, idx: number): SsisParameter {
    const dtsId = attr(p, 'DTSID');
    const objectName = attr(p, 'ObjectName');
    const required = attr(p, 'Required') === '1' || attr(p, 'Required').toLowerCase() === 'true';
    const sensitive = attr(p, 'Sensitive') === '1' || attr(p, 'Sensitive').toLowerCase() === 'true';
    const dataTypeCode = attr(p, 'DataType');
    const dataType = numericToDataType(dataTypeCode);

    let value: any = '';
    const propNodes = asArray(p['DTS:Property']);
    for (const prop of propNodes) {
      if (attr(prop, 'Name') === 'ParameterValue') {
        value = textContent(prop);
      }
    }

    const unknownElements = this.collectUnknownElements(p, `Parameter[${objectName}]`, new Set([
      'DTS:Property',
    ]));

    return {
      id: dtsId || `param-${idx}`,
      dtsId,
      objectName,
      dataType,
      value,
      required,
      sensitive,
      unknownElements,
    };
  }

  // ---- Executables (recursive) -------------------------------------------

  private parseExecutables(node: any): SsisExecutable[] {
    const container = node['DTS:Executables'];
    if (!container) { return []; }
    const execNodes = asArray(container['DTS:Executable']);
    return execNodes.map((e, idx) => this.parseOneExecutable(e, idx));
  }

  private parseOneExecutable(e: any, idx: number): SsisExecutable {
    const dtsId = attr(e, 'DTSID');
    const objectName = attr(e, 'ObjectName');
    const executableType = attr(e, 'ExecutableType');
    const description = attr(e, 'Description') || '';

    // Task properties from DTS:Property nodes
    const properties = this.parseProperties(e);

    // ForLoop / ForEachLoop attributes stored as XML attributes on the executable
    for (const attrName of ['InitExpression', 'EvalExpression', 'AssignExpression']) {
      const v = attr(e, attrName);
      if (v) { properties[attrName] = v; }
    }

    // Variables scoped to this executable
    const variables = this.parseVariables(e);

    // Children (for containers)
    const children = this.parseExecutables(e);
    const childConstraints = children.length > 0
      ? this.parsePrecedenceConstraints(e, children)
      : [];

    // Connection references from ObjectData
    const connectionRefs = this.parseConnectionRefs(e);

    // Collect task-specific properties from ObjectData (e.g. SQLTask:SqlTaskData)
    this.parseObjectDataProperties(e, properties);

    const unknownElements = this.collectUnknownElements(e, `Executable[${objectName}]`, KNOWN_EXECUTABLE_CHILDREN);

    return {
      id: dtsId || `exec-${idx}`,
      dtsId,
      objectName,
      executableType,
      description,
      x: 0,
      y: 0,
      width: 150,
      height: 50,
      properties,
      children: children.length > 0 ? children : undefined,
      childConstraints: childConstraints.length > 0 ? childConstraints : undefined,
      connectionRefs,
      variables,
      unknownElements,
    };
  }

  private parseConnectionRefs(e: any): ObjectDataConnectionRef[] {
    const refs: ObjectDataConnectionRef[] = [];
    const objectData = e['DTS:ObjectData'];
    if (!objectData) { return refs; }

    // SQLTask style: SQLTask:SqlTaskData[@SQLTask:Connection]
    const sqlTask = objectData['SQLTask:SqlTaskData'];
    if (sqlTask) {
      const conn = sqlTask['@_SQLTask:Connection'] || sqlTask['@_Connection'] || '';
      if (conn) {
        refs.push({ connectionManagerId: conn, connectionManagerName: '' });
      }
    }

    return refs;
  }

  private parseObjectDataProperties(e: any, properties: Record<string, any>): void {
    const objectData = e['DTS:ObjectData'];
    if (!objectData) { return; }

    // SQLTask properties
    const sqlTask = objectData['SQLTask:SqlTaskData'];
    if (sqlTask) {
      for (const key of Object.keys(sqlTask)) {
        if (key.startsWith('@_')) {
          const propName = key.replace('@_SQLTask:', '').replace('@_', '');
          properties[`SQLTask.${propName}`] = sqlTask[key];
        }
      }
    }
  }

  // ---- Precedence Constraints --------------------------------------------

  private parsePrecedenceConstraints(node: any, executables: SsisExecutable[]): PrecedenceConstraint[] {
    const container = node['DTS:PrecedenceConstraints'];
    if (!container) { return []; }
    const pcNodes = asArray(container['DTS:PrecedenceConstraint']);

    // Build a lookup from refId suffix → executable id
    const refIdToId = new Map<string, string>();
    for (const exec of executables) {
      refIdToId.set(exec.objectName, exec.id);
    }

    return pcNodes.map((pc, idx) => {
      const fromRef = attr(pc, 'From');
      const toRef = attr(pc, 'To');
      const value = attrNum(pc, 'Value');
      const expression = attr(pc, 'Expression') || undefined;
      const logicalAnd = attr(pc, 'LogicalAnd') !== '0' && attr(pc, 'LogicalAnd').toLowerCase() !== 'false';

      // Resolve refIds – the From/To are like "Package\Task1"
      const fromName = fromRef.split('\\').pop() || fromRef;
      const toName = toRef.split('\\').pop() || toRef;
      const fromId = refIdToId.get(fromName) || fromRef;
      const toId = refIdToId.get(toName) || toRef;

      let constraintType: PrecedenceConstraint['constraintType'] = 'Success';
      if (expression && !fromRef) {
        constraintType = 'Expression';
      } else if (value === 1) {
        constraintType = 'Failure';
      } else if (value === 2) {
        constraintType = 'Completion';
      }

      const unknownElements = this.collectUnknownElements(pc, `PrecedenceConstraint[${idx}]`, new Set(['DTS:Property']));

      return {
        id: attr(pc, 'DTSID') || `pc-${idx}`,
        fromExecutableId: fromId,
        toExecutableId: toId,
        constraintType,
        expression,
        logicalAnd,
        value,
        unknownElements,
      };
    });
  }

  // ---- Design-Time Properties (base64 layout XML) ------------------------

  private applyDesignTimeProperties(root: any, executables: SsisExecutable[]): void {
    const dtpRaw = root['DTS:DesignTimeProperties'];
    if (!dtpRaw) { return; }

    const base64 = typeof dtpRaw === 'object' && dtpRaw.__cdata
      ? String(dtpRaw.__cdata)
      : String(dtpRaw);

    const positions = this.parseDesignTimeProperties(base64);
    if (!positions) { return; }

    for (const exec of executables) {
      const pos = positions.get(exec.objectName) || positions.get(exec.dtsId);
      if (pos) {
        exec.x = pos.x;
        exec.y = pos.y;
        if (pos.width) { exec.width = pos.width; }
        if (pos.height) { exec.height = pos.height; }
      }
    }
  }

  /**
   * Parse design-time properties XML (may be base64-encoded or raw XML inside CDATA)
   * into a map of object name → { x, y, width?, height? }.
   */
  parseDesignTimeProperties(content: string): Map<string, { x: number; y: number; width?: number; height?: number }> | null {
    try {
      const trimmed = content.trim();
      if (!trimmed || trimmed.length === 0) { return null; }

      // Detect whether this is raw XML (CDATA content) or base64-encoded.
      // Raw XML starts with <?xml or < after trimming.
      let decoded: string;
      if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
        decoded = trimmed;
      } else {
        decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
      }
      if (!decoded || decoded.trim().length === 0) { return null; }

      const dtpParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        parseTagValue: false,
        isArray: (tagName: string) => {
          // NodeLayout and EdgeLayout can appear multiple times
          return tagName === 'NodeLayout' || tagName === 'EdgeLayout';
        },
      } as any);

      const dtpDoc = dtpParser.parse(decoded);
      const result = new Map<string, { x: number; y: number; width?: number; height?: number }>();

      // The layout XML typically has <Objects> containing <Object> entries
      // or a flat structure with package path keys.
      this.extractPositionsFromDtp(dtpDoc, result);

      return result.size > 0 ? result : null;
    } catch {
      return null;
    }
  }

  private extractPositionsFromDtp(
    node: any,
    result: Map<string, { x: number; y: number; width?: number; height?: number }>,
    currentPath: string = ''
  ): void {
    if (!node || typeof node !== 'object') { return; }

    // Look for nodes that have layout-like attributes
    for (const key of Object.keys(node)) {
      if (key.startsWith('@_')) { continue; }
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          this.extractPositionFromNode(item, key, result);
          this.extractPositionsFromDtp(item, result, `${currentPath}/${key}`);
        }
      } else if (typeof child === 'object') {
        this.extractPositionFromNode(child, key, result);
        this.extractPositionsFromDtp(child, result, `${currentPath}/${key}`);
      }
    }
  }

  private extractPositionFromNode(
    node: any,
    tagName: string,
    result: Map<string, { x: number; y: number; width?: number; height?: number }>
  ): void {
    if (!node || typeof node !== 'object') { return; }

    // --- SSIS 2019+ GraphLayout format: NodeLayout with Id, TopLeft, Size ---
    // <NodeLayout Size="150.4,41.6" Id="Package\Data Flow Task" TopLeft="299.28,71.11" />
    if (tagName === 'NodeLayout' && node['@_Id'] && node['@_TopLeft']) {
      const id = String(node['@_Id']);
      // Extract the task name from the Id path (e.g. "Package\Data Flow Task" → "Data Flow Task")
      const nameParts = id.split('\\');
      const name = nameParts[nameParts.length - 1];

      const topLeftStr = String(node['@_TopLeft']);
      const topLeftParts = topLeftStr.split(',');
      const x = parseFloat(topLeftParts[0]);
      const y = parseFloat(topLeftParts[1]);

      let width: number | undefined;
      let height: number | undefined;
      if (node['@_Size']) {
        const sizeParts = String(node['@_Size']).split(',');
        width = parseFloat(sizeParts[0]);
        height = parseFloat(sizeParts[1]);
      }

      if (Number.isFinite(x) && Number.isFinite(y)) {
        result.set(name, { x, y, width, height });
      }
      return;
    }

    // --- Legacy format: X/Y/Left/Top attributes or child elements ---
    // Look for @_Name or try tag name, and X/Y attributes or child elements
    const name = node['@_Name'] || node['@_ObjectName'] || tagName;

    const x = this.tryGetNumber(node, 'X') ?? this.tryGetNumber(node, 'Left');
    const y = this.tryGetNumber(node, 'Y') ?? this.tryGetNumber(node, 'Top');

    if (x !== null && y !== null) {
      result.set(name, {
        x,
        y,
        width: this.tryGetNumber(node, 'Width') ?? undefined,
        height: this.tryGetNumber(node, 'Height') ?? undefined,
      });
    }
  }

  private tryGetNumber(node: any, name: string): number | null {
    const val = node[`@_${name}`] ?? node[name];
    if (val === undefined || val === null) { return null; }
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  // ---- Data Flow Model parsing -------------------------------------------

  /**
   * Parse DataFlowModel from a Data Flow Task executable's ObjectData.
   */
  parseDataFlowModel(executable: any): DataFlowModel | null {
    const objectData = executable['DTS:ObjectData'];
    if (!objectData) { return null; }
    const pipeline = objectData['pipeline'] || objectData['DTS:Pipeline'] || objectData['pipeline:PipelineComponent'];
    if (!pipeline) { return null; }

    const components = this.parseDataFlowComponents(pipeline);
    const paths = this.parseDataFlowPaths(pipeline);
    const unknownElements: UnknownXmlElement[] = [];

    return { components, paths, unknownElements };
  }

  private parseDataFlowComponents(pipeline: any): DataFlowComponent[] {
    const compContainer = pipeline['components'] || pipeline['pipeline:components'];
    if (!compContainer) { return []; }
    const compNodes = asArray(compContainer['component'] || compContainer['pipeline:component']);
    return compNodes.map((c, idx) => this.parseOneDataFlowComponent(c, idx));
  }

  private parseOneDataFlowComponent(c: any, idx: number): DataFlowComponent {
    const refId = attr(c, 'refId') || c['@_refId'] || '';
    const componentClassId = attr(c, 'componentClassID') || c['@_componentClassID'] || '';
    const name = attr(c, 'name') || c['@_name'] || '';
    const description = attr(c, 'description') || c['@_description'] || '';

    // Properties
    const properties: Record<string, any> = {};
    const propContainer = c['properties'] || c['pipeline:properties'];
    if (propContainer) {
      const propNodes = asArray(propContainer['property'] || propContainer['pipeline:property']);
      for (const p of propNodes) {
        const pName = p['@_name'] || '';
        if (pName) {
          properties[pName] = textContent(p);
        }
      }
    }

    // Inputs
    const inputContainer = c['inputs'] || c['pipeline:inputs'];
    const inputs = this.parseDataFlowInputs(inputContainer);

    // Outputs
    const outputContainer = c['outputs'] || c['pipeline:outputs'];
    const outputs = this.parseDataFlowOutputs(outputContainer);

    // Connection
    const connContainer = c['connections'] || c['pipeline:connections'];
    let connectionManagerRefId: string | undefined;
    if (connContainer) {
      const connNodes = asArray(connContainer['connection'] || connContainer['pipeline:connection']);
      if (connNodes.length > 0) {
        connectionManagerRefId = connNodes[0]['@_connectionManagerRefId'] || connNodes[0]['@_connectionManagerID'] || '';
      }
    }

    return {
      id: refId || `comp-${idx}`,
      refId,
      componentClassId,
      name,
      description,
      x: 0,
      y: 0,
      properties,
      inputs,
      outputs,
      connectionManagerRefId,
      unknownElements: [],
    };
  }

  private parseDataFlowInputs(container: any): DataFlowInput[] {
    if (!container) { return []; }
    const inputNodes = asArray(container['input'] || container['pipeline:input']);
    return inputNodes.map((inp, idx) => {
      const refId = inp['@_refId'] || '';
      const name = inp['@_name'] || '';
      const colContainer = inp['inputColumns'] || inp['pipeline:inputColumns'];
      const columns = this.parseDataFlowColumns(colContainer, 'inputColumn');
      const extContainer = inp['externalMetadataColumns'] || inp['pipeline:externalMetadataColumns'];
      const externalColumns = this.parseExternalColumns(extContainer);
      return {
        id: refId || `input-${idx}`,
        refId,
        name,
        columns,
        externalColumns,
        unknownElements: [],
      };
    });
  }

  private parseDataFlowOutputs(container: any): DataFlowOutput[] {
    if (!container) { return []; }
    const outputNodes = asArray(container['output'] || container['pipeline:output']);
    return outputNodes.map((out, idx) => {
      const refId = out['@_refId'] || '';
      const name = out['@_name'] || '';
      const isErrorOutput = (out['@_isErrorOut'] === 'true' || out['@_errorRowDisposition'] !== undefined);
      const colContainer = out['outputColumns'] || out['pipeline:outputColumns'];
      const columns = this.parseDataFlowColumns(colContainer, 'outputColumn');
      const extContainer = out['externalMetadataColumns'] || out['pipeline:externalMetadataColumns'];
      const externalColumns = this.parseExternalColumns(extContainer);
      return {
        id: refId || `output-${idx}`,
        refId,
        name,
        isErrorOutput,
        columns,
        externalColumns,
        unknownElements: [],
      };
    });
  }

  private parseDataFlowColumns(container: any, tagName: string): DataFlowColumn[] {
    if (!container) { return []; }
    const colNodes = asArray(container[tagName] || container[`pipeline:${tagName}`]);
    return colNodes.map((col, idx) => ({
      id: col['@_refId'] || col['@_id'] || `col-${idx}`,
      refId: col['@_refId'] || '',
      name: col['@_name'] || '',
      dataType: col['@_dataType'] || '',
      length: col['@_length'] !== undefined ? Number(col['@_length']) : undefined,
      precision: col['@_precision'] !== undefined ? Number(col['@_precision']) : undefined,
      scale: col['@_scale'] !== undefined ? Number(col['@_scale']) : undefined,
      codePage: col['@_codePage'] !== undefined ? Number(col['@_codePage']) : undefined,
      sortKeyPosition: col['@_sortKeyPosition'] !== undefined ? Number(col['@_sortKeyPosition']) : undefined,
      expression: col['@_expression'] || undefined,
      unknownElements: [],
    }));
  }

  private parseExternalColumns(container: any): ExternalColumn[] {
    if (!container) { return []; }
    const colNodes = asArray(
      container['externalMetadataColumn'] || container['pipeline:externalMetadataColumn']
    );
    return colNodes.map((col, idx) => ({
      id: col['@_refId'] || col['@_id'] || `extcol-${idx}`,
      refId: col['@_refId'] || '',
      name: col['@_name'] || '',
      dataType: col['@_dataType'] || '',
      length: col['@_length'] !== undefined ? Number(col['@_length']) : undefined,
      precision: col['@_precision'] !== undefined ? Number(col['@_precision']) : undefined,
      scale: col['@_scale'] !== undefined ? Number(col['@_scale']) : undefined,
      codePage: col['@_codePage'] !== undefined ? Number(col['@_codePage']) : undefined,
    }));
  }

  private parseDataFlowPaths(pipeline: any): DataFlowPath[] {
    const pathContainer = pipeline['paths'] || pipeline['pipeline:paths'];
    if (!pathContainer) { return []; }
    const pathNodes = asArray(pathContainer['path'] || pathContainer['pipeline:path']);
    return pathNodes.map((p, idx) => ({
      id: p['@_refId'] || `path-${idx}`,
      refId: p['@_refId'] || '',
      name: p['@_name'] || '',
      fromOutputId: p['@_startId'] || p['@_fromOutputId'] || '',
      toInputId: p['@_endId'] || p['@_toInputId'] || '',
      unknownElements: [],
    }));
  }

  // ---- Unknown element collection ----------------------------------------

  private collectUnknownElements(
    node: any,
    parentPath: string,
    knownChildren: Set<string>
  ): UnknownXmlElement[] {
    const unknowns: UnknownXmlElement[] = [];
    if (!node || typeof node !== 'object') { return unknowns; }

    for (const key of Object.keys(node)) {
      if (key.startsWith('@_') || key === '#text' || key === '__cdata' || key === '__comment') {
        continue;
      }
      if (!knownChildren.has(key)) {
        // This is an unknown/unrecognized element – preserve its raw XML
        try {
          const rawXml = this.builder.build({ [key]: node[key] });
          unknowns.push({ rawXml: String(rawXml).trim(), parentPath });
        } catch {
          // If builder fails, store a placeholder
          unknowns.push({
            rawXml: `<!-- preserved: ${key} -->`,
            parentPath,
          });
        }
      }
    }
    return unknowns;
  }

  // =========================================================================
  // SERIALIZATION  SsisPackageModel → .dtsx XML
  // =========================================================================

  /**
   * Serialize an SsisPackageModel to .dtsx XML.
   *
   * @param model  The package model
   * @param originalXml  If provided, operates in "merge" mode: patches the
   *   original XML with model changes to preserve formatting and unknown elements.
   *   If omitted, builds the XML from scratch ("new" mode).
   */
  serialize(model: SsisPackageModel, originalXml?: string): string {
    this._connectionManagers = model.connectionManagers;
    try {
      if (originalXml) {
        return this.serializeMerge(model, originalXml);
      }
      return this.serializeNew(model);
    } finally {
      this._connectionManagers = [];
    }
  }

  // ---- "New" mode ---------------------------------------------------------

  private serializeNew(model: SsisPackageModel): string {
    const xmlObj = this.buildPackageObject(model);
    const xmlDecl = '<?xml version="1.0"?>\n';
    const body = this.builder.build(xmlObj);
    return this.normalizeXmlWhitespace(xmlDecl + body);
  }

  private buildPackageObject(model: SsisPackageModel): any {
    const pkg: any = {
      '@_xmlns:DTS': 'www.microsoft.com/SqlServer/Dts',
      '@_DTS:refId': 'Package',
      '@_DTS:CreationDate': model.creationDate || new Date().toLocaleDateString('en-US'),
      '@_DTS:LocaleID': DEFAULT_LOCALE_ID,
      '@_DTS:VersionBuild': DEFAULT_VERSION_BUILD,
      '@_DTS:LastModifiedProductVersion': DEFAULT_LAST_MODIFIED_PRODUCT_VERSION,
      '@_DTS:CreatorName': model.creatorName || '',
      '@_DTS:DTSID': model.packageId || newGuid(),
      '@_DTS:VersionGUID': newGuid(),
      '@_DTS:ExecutableType': 'Microsoft.Package',
      '@_DTS:ObjectName': model.packageName || 'Package',
    };

    if (model.description) {
      pkg['@_DTS:Description'] = model.description;
    }

    if (this.hasExecutableType(model.executables, 'Microsoft.ExecuteSQLTask')) {
      pkg['@_xmlns:SQLTask'] = SQLTASK_NAMESPACE;
    }

    // Properties
    const propArray: any[] = [];
    propArray.push(this.buildPropertyNode('PackageFormatVersion', String(model.formatVersion)));
    for (const [name, value] of Object.entries(model.properties)) {
      if (name === 'PackageFormatVersion') { continue; }
      propArray.push(this.buildPropertyNode(name, value));
    }
    if (propArray.length > 0) {
      pkg['DTS:Property'] = propArray;
    }

    // Connection managers
    if (model.connectionManagers.length > 0) {
      pkg['DTS:ConnectionManagers'] = {
        'DTS:ConnectionManager': model.connectionManagers.map(cm => this.buildConnectionManagerNode(cm)),
      };
    }

    // Variables
    if (model.variables.length > 0) {
      pkg['DTS:Variables'] = {
        'DTS:Variable': model.variables.map(v => this.buildVariableNode(v)),
      };
    }

    // Parameters
    if (model.parameters.length > 0) {
      pkg['DTS:PackageParameters'] = {
        'DTS:PackageParameter': model.parameters.map(p => this.buildParameterNode(p)),
      };
    }

    // Executables
    if (model.executables.length > 0) {
      pkg['DTS:Executables'] = {
        'DTS:Executable': model.executables.map(e => this.buildExecutableNode(e, 'Package')),
      };
    }

    // Precedence constraints
    if (model.precedenceConstraints.length > 0) {
      pkg['DTS:PrecedenceConstraints'] = {
        'DTS:PrecedenceConstraint': model.precedenceConstraints.map(pc => this.buildPrecedenceConstraintNode(pc)),
      };
    }

    // Design-time properties
    const dtpBase64 = this.serializeDesignTimeProperties(model.executables);
    if (dtpBase64) {
      pkg['DTS:DesignTimeProperties'] = { __cdata: dtpBase64 };
    }

    // Re-inject unknown elements
    for (const unk of model.unknownElements) {
      try {
        const parsed = this.parser.parse(unk.rawXml);
        for (const key of Object.keys(parsed)) {
          pkg[key] = parsed[key];
        }
      } catch {
        // skip unparseable unknowns
      }
    }

    return { 'DTS:Executable': pkg };
  }

  private buildPropertyNode(name: string, value: string): any {
    return {
      '@_DTS:Name': name,
      '#text': value,
    };
  }

  private buildConnectionManagerNode(cm: ConnectionManager): any {
    const node: any = {
      '@_DTS:refId': `Package.ConnectionManagers[${cm.objectName}]`,
      '@_DTS:CreationName': cm.creationName,
      '@_DTS:DTSID': cm.dtsId || newGuid(),
      '@_DTS:ObjectName': cm.objectName,
    };
    if (cm.description) {
      node['@_DTS:Description'] = cm.description;
    }

    // ObjectData with inner ConnectionManager — store values as attributes
    // on the inner node to match the Visual Studio .dtsx format.
    const innerCM: any = {};
    if (cm.connectionString) {
      innerCM['@_DTS:ConnectionString'] = cm.connectionString;
    }
    for (const [name, value] of Object.entries(cm.properties)) {
      if (name === 'ConnectionString') { continue; }
      innerCM[`@_DTS:${name}`] = value;
    }

    node['DTS:ObjectData'] = {
      'DTS:ConnectionManager': innerCM,
    };

    return node;
  }

  private buildVariableNode(v: SsisVariable): any {
    const DATA_TYPE_REVERSE: Record<string, number> = {};
    for (const [code, name] of Object.entries(DTS_DATA_TYPE_MAP)) {
      if (!(name in DATA_TYPE_REVERSE)) {
        DATA_TYPE_REVERSE[name] = Number(code);
      }
    }

    const node: any = {
      '@_DTS:DTSID': v.dtsId || newGuid(),
      '@_DTS:Namespace': v.namespace,
      '@_DTS:ObjectName': v.objectName,
    };
    if (v.evaluateAsExpression) {
      node['@_DTS:EvaluateAsExpression'] = '-1';
    }
    if (v.expression) {
      node['@_DTS:Expression'] = v.expression;
    }
    if (v.readOnly) {
      node['@_DTS:ReadOnly'] = '-1';
    }

    node['DTS:VariableValue'] = [{
      '@_DTS:DataType': String(DATA_TYPE_REVERSE[v.dataType] ?? 8),
      '#text': String(v.value ?? ''),
    }];

    return node;
  }

  private buildParameterNode(p: SsisParameter): any {
    const DATA_TYPE_REVERSE: Record<string, number> = {};
    for (const [code, name] of Object.entries(DTS_DATA_TYPE_MAP)) {
      if (!(name in DATA_TYPE_REVERSE)) {
        DATA_TYPE_REVERSE[name] = Number(code);
      }
    }

    const node: any = {
      '@_DTS:DTSID': p.dtsId || newGuid(),
      '@_DTS:ObjectName': p.objectName,
      '@_DTS:DataType': String(DATA_TYPE_REVERSE[p.dataType] ?? 8),
    };
    if (p.required) {
      node['@_DTS:Required'] = '1';
    }
    if (p.sensitive) {
      node['@_DTS:Sensitive'] = '1';
    }
    node['DTS:Property'] = [
      this.buildPropertyNode('ParameterValue', String(p.value ?? '')),
    ];
    return node;
  }

  private buildExecutableNode(exec: SsisExecutable, parentRef: string): any {
    const refId = `${parentRef}\\${exec.objectName}`;
    const isSqlTask = exec.executableType === 'Microsoft.ExecuteSQLTask';
    const node: any = {
      '@_DTS:refId': refId,
      '@_DTS:CreationName': exec.executableType,
      '@_DTS:DTSID': exec.dtsId || newGuid(),
      '@_DTS:ExecutableType': exec.executableType,
      '@_DTS:ObjectName': exec.objectName,
    };
    if (exec.description) {
      node['@_DTS:Description'] = exec.description;
    }

    // ForLoop / ForEachLoop attributes
    for (const attrName of ['InitExpression', 'EvalExpression', 'AssignExpression']) {
      if (exec.properties[attrName]) {
        node[`@_DTS:${attrName}`] = exec.properties[attrName];
      }
    }

    // Properties – skip SQLTask.* prefixed (emitted in ObjectData) and
    // ConnectionName (redundant with connectionRefs, not emitted by VS).
    const propArray: any[] = [];
    const skipProps = new Set(['InitExpression', 'EvalExpression', 'AssignExpression', 'ConnectionName']);
    for (const [name, value] of Object.entries(exec.properties)) {
      if (!name.startsWith('SQLTask.') && !skipProps.has(name)) {
        propArray.push(this.buildPropertyNode(name, String(value)));
      }
    }
    if (propArray.length > 0) {
      node['DTS:Property'] = propArray;
    }

    // Variables – VS always emits <DTS:Variables /> even when empty
    if (exec.variables.length > 0) {
      node['DTS:Variables'] = {
        'DTS:Variable': exec.variables.map(v => this.buildVariableNode(v)),
      };
    } else {
      node['DTS:Variables'] = '';
    }

    // ObjectData (for SQL tasks, etc.)
    if (isSqlTask) {
      const sqlTaskData: any = {};
      if (exec.connectionRefs.length > 0) {
        sqlTaskData['@_SQLTask:Connection'] = this.resolveConnectionDtsId(
          exec.connectionRefs[0].connectionManagerId,
        );
      }
      const sqlTaskProps: Record<string, string> = {};
      for (const [name, value] of Object.entries(exec.properties)) {
        if (name.startsWith('SQLTask.')) {
          sqlTaskProps[name.replace('SQLTask.', '')] = String(value);
        }
      }
      for (const [name, value] of Object.entries(sqlTaskProps)) {
        sqlTaskData[`@_SQLTask:${name}`] = value;
      }
      sqlTaskData['@_xmlns:SQLTask'] = SQLTASK_NAMESPACE;
      node['DTS:ObjectData'] = {
        'SQLTask:SqlTaskData': sqlTaskData,
      };
    }

    // Children (for containers)
    if (exec.children && exec.children.length > 0) {
      node['DTS:Executables'] = {
        'DTS:Executable': exec.children.map(child => this.buildExecutableNode(child, refId)),
      };
    }

    // Child constraints
    if (exec.childConstraints && exec.childConstraints.length > 0) {
      node['DTS:PrecedenceConstraints'] = {
        'DTS:PrecedenceConstraint': exec.childConstraints.map(pc => this.buildPrecedenceConstraintNode(pc)),
      };
    }

    // Unknown elements
    for (const unk of exec.unknownElements) {
      try {
        const parsed = this.parser.parse(unk.rawXml);
        for (const key of Object.keys(parsed)) {
          node[key] = parsed[key];
        }
      } catch {
        // skip
      }
    }

    return node;
  }

  private buildPrecedenceConstraintNode(pc: PrecedenceConstraint): any {
    const node: any = {
      '@_DTS:refId': `Package.PrecedenceConstraints[Constraint ${pc.id}]`,
      '@_DTS:From': pc.fromExecutableId,
      '@_DTS:To': pc.toExecutableId,
      '@_DTS:Value': String(pc.value),
    };
    if (pc.expression) {
      node['@_DTS:Expression'] = pc.expression;
    }
    if (!pc.logicalAnd) {
      node['@_DTS:LogicalAnd'] = '0';
    }
    return node;
  }

  private hasExecutableType(executables: SsisExecutable[], executableType: string): boolean {
    for (const executable of executables) {
      if (executable.executableType === executableType) {
        return true;
      }
      if (executable.children && this.hasExecutableType(executable.children, executableType)) {
        return true;
      }
    }
    return false;
  }

  // ---- "Merge" mode -------------------------------------------------------

  /**
   * Merge model changes back into the original XML.  This uses a "parse →
   * patch → rebuild" strategy so that unknown elements and formatting are
   * preserved as much as fast-xml-parser allows.
   */
  private serializeMerge(model: SsisPackageModel, originalXml: string): string {
    const doc = this.parser.parse(originalXml);
    const rawRoot = doc['DTS:Executable'] ?? doc['Executable'];
    if (!rawRoot) {
      // Fall back to new mode if the original is unparseable
      return this.serializeNew(model);
    }
    // Unwrap the array produced by the isArray callback (see parse()).
    const root = Array.isArray(rawRoot) ? rawRoot[0] : rawRoot;

    // Patch package-level attributes
    const existingObjectName = attr(root, 'ObjectName');
    const existingPackageId = attr(root, 'DTSID');
    const existingVersionGuid = attr(root, 'VersionGUID');
    const existingCreationDate = attr(root, 'CreationDate');
    const existingLocaleId = attr(root, 'LocaleID');
    const existingVersionBuild = attr(root, 'VersionBuild');
    const existingLastModifiedProductVersion = attr(root, 'LastModifiedProductVersion');
    const existingCreatorName = attr(root, 'CreatorName');

    root['@_DTS:ObjectName'] = model.packageName || existingObjectName || 'Package';
    root['@_DTS:DTSID'] = model.packageId || existingPackageId || newGuid();
    root['@_DTS:VersionGUID'] = existingVersionGuid || newGuid();
    root['@_DTS:CreationDate'] = model.creationDate || existingCreationDate || new Date().toLocaleDateString('en-US');
    root['@_DTS:LocaleID'] = existingLocaleId || DEFAULT_LOCALE_ID;
    root['@_DTS:VersionBuild'] = existingVersionBuild || DEFAULT_VERSION_BUILD;
    root['@_DTS:LastModifiedProductVersion'] = existingLastModifiedProductVersion || DEFAULT_LAST_MODIFIED_PRODUCT_VERSION;
    root['@_DTS:CreatorName'] = model.creatorName || existingCreatorName || '';
    if (model.description) {
      root['@_DTS:Description'] = model.description;
    }
    if (this.hasExecutableType(model.executables, 'Microsoft.ExecuteSQLTask')) {
      root['@_xmlns:SQLTask'] = SQLTASK_NAMESPACE;
    }

    // Patch properties
    this.patchProperties(root, model.properties, model.formatVersion);

    // Patch connection managers
    this.patchConnectionManagers(root, model.connectionManagers);

    // Patch variables
    this.patchVariables(root, model.variables);

    // Patch executables
    this.patchExecutables(root, model.executables, 'Package');

    // Patch precedence constraints
    this.patchPrecedenceConstraints(root, model.precedenceConstraints);

    // Patch design-time properties
    const dtpBase64 = this.serializeDesignTimeProperties(model.executables);
    if (dtpBase64) {
      root['DTS:DesignTimeProperties'] = { __cdata: dtpBase64 };
    }

    // Remove the parsed ?xml processing instruction from the doc object
    // before building, otherwise the builder includes it AND we prepend
    // our own, resulting in a duplicate declaration.
    delete doc['?xml'];
    const xmlDecl = '<?xml version="1.0"?>\n';
    const body = this.builder.build(doc);
    return this.normalizeXmlWhitespace(xmlDecl + body);
  }

  private normalizeXmlWhitespace(xml: string): string {
    // Remove trailing spaces on each line and collapse runs of blank lines
    // introduced by merge formatting while keeping readable separation.
    const withoutTrailingSpaces = xml
      .split('\n')
      .map(line => line.replace(/[\t ]+$/g, ''))
      .join('\n');

    const collapsedBlankRuns = withoutTrailingSpaces.replace(/\n{3,}/g, '\n\n');

    // Remove single blank lines that appear between two closing tags
    // (e.g. </DTS:DesignTimeProperties> ... </DTS:Executable>).
    return collapsedBlankRuns.replace(
      /(\n[ \t]*<\/[^>]+>)\n[ \t]*\n([ \t]*<\/[^>]+>)/g,
      '$1\n$2',
    );
  }

  private patchProperties(root: any, properties: Record<string, string>, formatVersion: number): void {
    // Merge into existing property nodes to preserve extra attributes like DTS:DataType
    const existingProps = asArray(root['DTS:Property']);
    const existingByName = new Map<string, any>();
    for (const p of existingProps) {
      const name = attr(p, 'Name');
      if (name) { existingByName.set(name, p); }
    }

    const allNames = new Set<string>(['PackageFormatVersion', ...Object.keys(properties)]);
    const resultProps: any[] = [];

    for (const name of allNames) {
      const value = name === 'PackageFormatVersion' ? String(formatVersion) : properties[name];
      const existing = existingByName.get(name);
      if (existing) {
        // Update value in place, preserving other attributes on the node
        existing['#text'] = value;
        resultProps.push(existing);
      } else {
        resultProps.push(this.buildPropertyNode(name, value));
      }
    }
    root['DTS:Property'] = resultProps;
  }

  private patchConnectionManagers(root: any, connectionManagers: ConnectionManager[]): void {
    if (connectionManagers.length === 0) {
      delete root['DTS:ConnectionManagers'];
      return;
    }

    const existingContainer = root['DTS:ConnectionManagers'];
    if (!existingContainer) {
      // No existing CMs — build all from scratch
      root['DTS:ConnectionManagers'] = {
        'DTS:ConnectionManager': connectionManagers.map(cm => this.buildConnectionManagerNode(cm)),
      };
      return;
    }

    const existingNodes = asArray(existingContainer['DTS:ConnectionManager']);
    const byDtsId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const node of existingNodes) {
      const id = attr(node, 'DTSID');
      const name = attr(node, 'ObjectName');
      if (id) { byDtsId.set(id, node); }
      if (name) { byName.set(name, node); }
    }

    const resultNodes = connectionManagers.map(cm => {
      const existing = (cm.dtsId ? byDtsId.get(cm.dtsId) : undefined)
                       ?? byName.get(cm.objectName);
      if (existing) {
        return this.mergeConnectionManagerNode(existing, cm);
      }
      return this.buildConnectionManagerNode(cm);
    });

    root['DTS:ConnectionManagers'] = {
      'DTS:ConnectionManager': resultNodes,
    };
  }

  /**
   * Merge model changes into an existing connection-manager XML node,
   * preserving inner attributes and elements the model doesn't represent.
   */
  private mergeConnectionManagerNode(node: any, cm: ConnectionManager): any {
    // Patch outer attributes
    node['@_DTS:refId'] = `Package.ConnectionManagers[${cm.objectName}]`;
    node['@_DTS:CreationName'] = cm.creationName;
    if (cm.dtsId) { node['@_DTS:DTSID'] = cm.dtsId; }
    node['@_DTS:ObjectName'] = cm.objectName;
    if (cm.description) {
      node['@_DTS:Description'] = cm.description;
    } else {
      delete node['@_DTS:Description'];
    }

    // Patch the inner properties inside DTS:ObjectData > DTS:ConnectionManager
    const objectData = node['DTS:ObjectData'] ?? {};
    // The isArray callback forces DTS:ConnectionManager to always be an array — unwrap it
    const innerRaw = objectData['DTS:ConnectionManager'];
    const inner = Array.isArray(innerRaw) ? (innerRaw[0] ?? {}) : (innerRaw ?? {});

    // Build a set of property names that live as attributes on the inner CM
    // (so we update them there instead of creating duplicate DTS:Property nodes)
    const innerAttrNames = new Set<string>();
    for (const key of Object.keys(inner)) {
      if (key.startsWith('@_')) {
        const attrName = key.replace('@_DTS:', '').replace('@_', '');
        innerAttrNames.add(attrName);
      }
    }

    // Always ensure ConnectionString is present and up-to-date.
    // Use attributes on the inner CM node to match Visual Studio format.
    if (cm.connectionString) {
      // If it was an existing attribute, update in place; otherwise add as new attribute
      if (innerAttrNames.has('ConnectionString')) {
        const csKey = inner['@_DTS:ConnectionString'] !== undefined ? '@_DTS:ConnectionString' : '@_ConnectionString';
        inner[csKey] = cm.connectionString;
      } else {
        // Migrate from DTS:Property to attribute
        inner['@_DTS:ConnectionString'] = cm.connectionString;
      }
    }

    // Update other model properties as attributes
    for (const [name, value] of Object.entries(cm.properties)) {
      if (name === 'ConnectionString') { continue; }
      if (innerAttrNames.has(name)) {
        const key = inner[`@_DTS:${name}`] !== undefined ? `@_DTS:${name}` : `@_${name}`;
        inner[key] = value;
      } else {
        // Add as new attribute
        inner[`@_DTS:${name}`] = value;
      }
    }

    // Remove any legacy DTS:Property children — all values are now attributes
    delete inner['DTS:Property'];

    objectData['DTS:ConnectionManager'] = inner;
    node['DTS:ObjectData'] = objectData;

    return node;
  }

  private patchVariables(root: any, variables: SsisVariable[]): void {
    if (variables.length === 0) {
      delete root['DTS:Variables'];
      return;
    }
    root['DTS:Variables'] = {
      'DTS:Variable': variables.map(v => this.buildVariableNode(v)),
    };
  }

  private patchExecutables(root: any, executables: SsisExecutable[], parentRef: string): void {
    if (executables.length === 0) {
      delete root['DTS:Executables'];
      return;
    }

    const existingContainer = root['DTS:Executables'];
    if (!existingContainer) {
      // No existing executables — build all from scratch
      root['DTS:Executables'] = {
        'DTS:Executable': executables.map(e => this.buildExecutableNode(e, parentRef)),
      };
      return;
    }

    const existingNodes = asArray(existingContainer['DTS:Executable']);
    const byDtsId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const node of existingNodes) {
      const id = attr(node, 'DTSID');
      const name = attr(node, 'ObjectName');
      if (id) { byDtsId.set(id, node); }
      if (name) { byName.set(name, node); }
    }

    const resultNodes = executables.map(exec => {
      // If the model has a DTSID, only match by DTSID. Falling back to
      // ObjectName can collide when multiple tasks share the same default
      // name (e.g. "Execute SQL Task"), causing new tasks to overwrite
      // existing nodes in merge mode.
      const existing = exec.dtsId
        ? byDtsId.get(exec.dtsId)
        : byName.get(exec.objectName);
      if (existing) {
        return this.mergeExecutableNode(existing, exec, parentRef);
      }
      // New executable — build from scratch
      return this.buildExecutableNode(exec, parentRef);
    });

    root['DTS:Executables'] = {
      'DTS:Executable': resultNodes,
    };
  }

  /**
   * Merge model changes into an existing executable XML node, preserving
   * elements the model doesn't fully represent: ObjectData for non-SQL tasks
   * (Data Flow pipelines, Script Tasks, etc.), ForEachEnumerator,
   * EventHandlers, LoggingOptions, PropertyExpression, and any other
   * child elements.
   */
  private mergeExecutableNode(node: any, exec: SsisExecutable, parentRef: string): any {
    const refId = `${parentRef}\\${exec.objectName}`;
    const isSqlTask = exec.executableType === 'Microsoft.ExecuteSQLTask';

    // Patch known attributes
    node['@_DTS:refId'] = refId;
    node['@_DTS:CreationName'] = exec.executableType;
    if (exec.dtsId) { node['@_DTS:DTSID'] = exec.dtsId; }
    node['@_DTS:ExecutableType'] = exec.executableType;
    node['@_DTS:ObjectName'] = exec.objectName;
    if (exec.description) {
      node['@_DTS:Description'] = exec.description;
    } else {
      delete node['@_DTS:Description'];
    }

    // ForLoop / ForEachLoop attributes
    for (const attrName of ['InitExpression', 'EvalExpression', 'AssignExpression']) {
      if (exec.properties[attrName]) {
        node[`@_DTS:${attrName}`] = exec.properties[attrName];
      } else {
        delete node[`@_DTS:${attrName}`];
      }
    }

    // Patch DTS:Property nodes (merge values but preserve extra attributes).
    // Skip ConnectionName — it is redundant with connectionRefs and not
    // emitted by Visual Studio.
    const existingProps = asArray(node['DTS:Property']);
    const existingPropsByName = new Map<string, any>();
    for (const p of existingProps) {
      const name = attr(p, 'Name');
      if (name) { existingPropsByName.set(name, p); }
    }

    const resultProps: any[] = [];
    const skipProps = new Set(['InitExpression', 'EvalExpression', 'AssignExpression', 'ConnectionName']);
    for (const [name, value] of Object.entries(exec.properties)) {
      if (name.startsWith('SQLTask.') || skipProps.has(name)) { continue; }
      const existing = existingPropsByName.get(name);
      if (existing) {
        existing['#text'] = String(value);
        resultProps.push(existing);
        existingPropsByName.delete(name);
      } else {
        resultProps.push(this.buildPropertyNode(name, String(value)));
      }
    }
    // Keep remaining original properties not in the model (except ConnectionName)
    for (const [name, p] of existingPropsByName) {
      if (name === 'ConnectionName') { continue; }
      resultProps.push(p);
    }
    if (resultProps.length > 0) {
      node['DTS:Property'] = resultProps;
    } else {
      delete node['DTS:Property'];
    }

    // Patch variables – VS always emits <DTS:Variables /> even when empty
    if (exec.variables.length > 0) {
      node['DTS:Variables'] = {
        'DTS:Variable': exec.variables.map(v => this.buildVariableNode(v)),
      };
    } else if (!node['DTS:Variables']) {
      node['DTS:Variables'] = '';
    }

    // Patch ObjectData ONLY for SQL Task — for all other types (Data Flow,
    // Script Task, etc.) the existing ObjectData is preserved untouched.
    if (isSqlTask) {
      const sqlTaskData: any = {};
      if (exec.connectionRefs.length > 0) {
        sqlTaskData['@_SQLTask:Connection'] = this.resolveConnectionDtsId(
          exec.connectionRefs[0].connectionManagerId,
        );
      }
      const sqlTaskProps: Record<string, string> = {};
      for (const [name, value] of Object.entries(exec.properties)) {
        if (name.startsWith('SQLTask.')) {
          sqlTaskProps[name.replace('SQLTask.', '')] = String(value);
        }
      }
      for (const [name, value] of Object.entries(sqlTaskProps)) {
        sqlTaskData[`@_SQLTask:${name}`] = value;
      }
      sqlTaskData['@_xmlns:SQLTask'] = SQLTASK_NAMESPACE;
      node['DTS:ObjectData'] = {
        'SQLTask:SqlTaskData': sqlTaskData,
      };
    }
    // All other executable types: ObjectData, ForEachEnumerator,
    // ForEachVariableMappings, EventHandlers, LoggingOptions,
    // PropertyExpression, etc. are left untouched on the node.

    // Recursively merge children (for containers like Sequence, ForEachLoop, etc.)
    if (exec.children && exec.children.length > 0) {
      this.patchExecutables(node, exec.children, refId);
    }

    // Patch child precedence constraints
    if (exec.childConstraints && exec.childConstraints.length > 0) {
      node['DTS:PrecedenceConstraints'] = {
        'DTS:PrecedenceConstraint': exec.childConstraints.map(pc => this.buildPrecedenceConstraintNode(pc)),
      };
    }

    return node;
  }

  private patchPrecedenceConstraints(root: any, constraints: PrecedenceConstraint[]): void {
    if (constraints.length === 0) {
      delete root['DTS:PrecedenceConstraints'];
      return;
    }
    root['DTS:PrecedenceConstraints'] = {
      'DTS:PrecedenceConstraint': constraints.map(pc => this.buildPrecedenceConstraintNode(pc)),
    };
  }

  // ---- Design-Time Properties serialization ------------------------------

  /**
   * Serialize executable positions into a base64-encoded design-time
   * properties XML block.
   */
  serializeDesignTimeProperties(executables: SsisExecutable[]): string | null {
    if (executables.length === 0) { return null; }

    const entries = executables.map(exec => {
      let entry = `    <Package path="\\Package\\${this.escapeXmlAttr(exec.objectName)}">\n`;
      entry += `      <LayoutInfo>\n`;
      entry += `        <Left>${exec.x}</Left>\n`;
      entry += `        <Top>${exec.y}</Top>\n`;
      entry += `        <Width>${exec.width}</Width>\n`;
      entry += `        <Height>${exec.height}</Height>\n`;
      entry += `      </LayoutInfo>\n`;
      entry += `    </Package>`;
      return entry;
    });

    const xml = `<?xml version="1.0"?>\n<!--This CDATA section contains the layout information of the package. The section includes information such as (x,y) coordinates, width, and height.-->\n<!--If you manually edit this section and make a mistake, you can delete it. -->\n<!--The package will still be able to load normally but the previous layout information will be lost and the designer will automatically re-arrange the elements on the design surface.-->\n<Objects\n  Version="8">\n${entries.join('\n')}\n</Objects>`;

    return Buffer.from(xml, 'utf-8').toString('base64');
  }

  private escapeXmlAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  /**
   * Generate a minimal valid .dtsx package XML string.
   */
  generateNewPackageXml(packageName: string = 'Package'): string {
    const model: SsisPackageModel = {
      packageName,
      packageId: newGuid(),
      creationDate: new Date().toLocaleDateString('en-US'),
      creatorName: '',
      description: '',
      formatVersion: 8,
      executables: [],
      precedenceConstraints: [],
      connectionManagers: [],
      variables: [],
      parameters: [],
      properties: {},
      unknownElements: [],
    };
    return this.serializeNew(model);
  }

  /**
   * Create a new GUID (braced, upper-case).
   */
  static newGuid(): string {
    return newGuid();
  }
}
