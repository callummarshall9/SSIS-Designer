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

// ---------------------------------------------------------------------------
// DtsxSerializer class
// ---------------------------------------------------------------------------

export class DtsxSerializer {
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor() {
    this.parser = new XMLParser(PARSER_OPTIONS as any);
    this.builder = new XMLBuilder(BUILDER_OPTIONS as any);
  }

  // =========================================================================
  // PARSING  .dtsx → SsisPackageModel
  // =========================================================================

  /**
   * Parse a raw .dtsx XML string into an SsisPackageModel.
   */
  parse(xml: string): SsisPackageModel {
    const doc = this.parser.parse(xml);
    const root = doc['DTS:Executable'] ?? doc['Executable'] ?? doc;

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
      const inner = objectData['DTS:ConnectionManager'];
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
   * Parse base64-encoded design-time properties XML into a map of
   * object name → { x, y, width?, height? }.
   */
  parseDesignTimeProperties(base64: string): Map<string, { x: number; y: number; width?: number; height?: number }> | null {
    try {
      const decoded = Buffer.from(base64.trim(), 'base64').toString('utf-8');
      if (!decoded || decoded.trim().length === 0) { return null; }

      const dtpParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        parseTagValue: false,
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
    if (originalXml) {
      return this.serializeMerge(model, originalXml);
    }
    return this.serializeNew(model);
  }

  // ---- "New" mode ---------------------------------------------------------

  private serializeNew(model: SsisPackageModel): string {
    const xmlObj = this.buildPackageObject(model);
    const xmlDecl = '<?xml version="1.0"?>\n';
    const body = this.builder.build(xmlObj);
    return xmlDecl + body;
  }

  private buildPackageObject(model: SsisPackageModel): any {
    const pkg: any = {
      '@_xmlns:DTS': 'www.microsoft.com/SqlServer/Dts',
      '@_DTS:refId': 'Package',
      '@_DTS:CreationDate': model.creationDate || new Date().toLocaleDateString('en-US'),
      '@_DTS:CreatorName': model.creatorName || '',
      '@_DTS:DTSID': model.packageId || newGuid(),
      '@_DTS:ExecutableType': 'Microsoft.Package',
      '@_DTS:ObjectName': model.packageName,
    };

    if (model.description) {
      pkg['@_DTS:Description'] = model.description;
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

    // ObjectData with inner ConnectionManager
    const innerProps: any[] = [];
    if (cm.connectionString) {
      innerProps.push(this.buildPropertyNode('ConnectionString', cm.connectionString));
    }
    for (const [name, value] of Object.entries(cm.properties)) {
      if (name === 'ConnectionString') { continue; }
      innerProps.push(this.buildPropertyNode(name, value));
    }

    node['DTS:ObjectData'] = {
      'DTS:ConnectionManager': {
        'DTS:Property': innerProps.length > 0 ? innerProps : undefined,
      },
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
    const node: any = {
      '@_DTS:refId': refId,
      '@_DTS:DTSID': exec.dtsId || newGuid(),
      '@_DTS:ExecutableType': exec.executableType,
      '@_DTS:ObjectName': exec.objectName,
    };
    if (exec.description) {
      node['@_DTS:Description'] = exec.description;
    }

    // Properties
    const propArray: any[] = [];
    for (const [name, value] of Object.entries(exec.properties)) {
      if (!name.startsWith('SQLTask.')) {
        propArray.push(this.buildPropertyNode(name, String(value)));
      }
    }
    if (propArray.length > 0) {
      node['DTS:Property'] = propArray;
    }

    // Variables
    if (exec.variables.length > 0) {
      node['DTS:Variables'] = {
        'DTS:Variable': exec.variables.map(v => this.buildVariableNode(v)),
      };
    }

    // ObjectData (for SQL tasks, etc.)
    const sqlTaskProps: Record<string, string> = {};
    for (const [name, value] of Object.entries(exec.properties)) {
      if (name.startsWith('SQLTask.')) {
        sqlTaskProps[name.replace('SQLTask.', '')] = String(value);
      }
    }
    if (exec.executableType === 'Microsoft.ExecuteSQLTask') {
      const sqlTaskData: any = {};
      if (exec.connectionRefs.length > 0) {
        sqlTaskData['@_SQLTask:Connection'] = exec.connectionRefs[0].connectionManagerId;
      }
      for (const [name, value] of Object.entries(sqlTaskProps)) {
        sqlTaskData[`@_SQLTask:${name}`] = value;
      }
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

  // ---- "Merge" mode -------------------------------------------------------

  /**
   * Merge model changes back into the original XML.  This uses a "parse →
   * patch → rebuild" strategy so that unknown elements and formatting are
   * preserved as much as fast-xml-parser allows.
   */
  private serializeMerge(model: SsisPackageModel, originalXml: string): string {
    const doc = this.parser.parse(originalXml);
    const root = doc['DTS:Executable'] ?? doc['Executable'];
    if (!root) {
      // Fall back to new mode if the original is unparseable
      return this.serializeNew(model);
    }

    // Patch package-level attributes
    root['@_DTS:ObjectName'] = model.packageName;
    root['@_DTS:DTSID'] = model.packageId;
    root['@_DTS:CreationDate'] = model.creationDate;
    root['@_DTS:CreatorName'] = model.creatorName;
    if (model.description) {
      root['@_DTS:Description'] = model.description;
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

    const xmlDecl = '<?xml version="1.0"?>\n';
    const body = this.builder.build(doc);
    return xmlDecl + body;
  }

  private patchProperties(root: any, properties: Record<string, string>, formatVersion: number): void {
    const propArray: any[] = [];
    // Always include PackageFormatVersion first
    propArray.push(this.buildPropertyNode('PackageFormatVersion', String(formatVersion)));
    for (const [name, value] of Object.entries(properties)) {
      if (name === 'PackageFormatVersion') { continue; }
      propArray.push(this.buildPropertyNode(name, value));
    }
    root['DTS:Property'] = propArray;
  }

  private patchConnectionManagers(root: any, connectionManagers: ConnectionManager[]): void {
    if (connectionManagers.length === 0) {
      delete root['DTS:ConnectionManagers'];
      return;
    }
    root['DTS:ConnectionManagers'] = {
      'DTS:ConnectionManager': connectionManagers.map(cm => this.buildConnectionManagerNode(cm)),
    };
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
    root['DTS:Executables'] = {
      'DTS:Executable': executables.map(e => this.buildExecutableNode(e, parentRef)),
    };
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
