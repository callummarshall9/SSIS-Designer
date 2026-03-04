/**
 * Core model representing an SSIS package (.dtsx).
 * This is the canonical in-memory representation used by the canvas and serializer.
 */

/** Represents the entire .dtsx package */
export interface SsisPackageModel {
  packageName: string;
  packageId: string;        // GUID
  creationDate: string;
  creatorName: string;
  description: string;
  formatVersion: number;     // e.g., 8 for SQL 2019

  // Control flow
  executables: SsisExecutable[];
  precedenceConstraints: PrecedenceConstraint[];

  // Package-level
  connectionManagers: ConnectionManager[];
  variables: SsisVariable[];
  parameters: SsisParameter[];

  // Properties
  properties: Record<string, string>;

  // Unknown/unrecognized XML elements preserved for round-trip
  unknownElements: UnknownXmlElement[];
}

/** An executable (task, container, or data flow) within the control flow */
export interface SsisExecutable {
  id: string;               // Unique ID for canvas
  dtsId: string;            // DTS:DTSID GUID
  objectName: string;       // DTS:ObjectName
  executableType: string;   // e.g., "Microsoft.ExecuteSQLTask", "STOCK:FORLOOP", etc.
  description: string;

  // Canvas position (stored as DTS:Annotations / DesignTimeProperties)
  x: number;
  y: number;
  width: number;
  height: number;

  // Task-specific properties
  properties: Record<string, any>;

  // For containers (ForLoop, ForEachLoop, Sequence)
  children?: SsisExecutable[];
  childConstraints?: PrecedenceConstraint[];

  // Connection references
  connectionRefs: ObjectDataConnectionRef[];

  // Variables scoped to this executable
  variables: SsisVariable[];

  // Unknown elements
  unknownElements: UnknownXmlElement[];
}

/** A precedence constraint connecting two executables */
export interface PrecedenceConstraint {
  id: string;
  fromExecutableId: string;
  toExecutableId: string;
  constraintType: 'Success' | 'Failure' | 'Completion' | 'Expression';
  expression?: string;
  logicalAnd: boolean;      // AND/OR for multiple constraints
  value: number;            // 0=Success, 1=Failure, 2=Completion
  unknownElements: UnknownXmlElement[];
}

/** A package- or project-level connection manager */
export interface ConnectionManager {
  id: string;
  dtsId: string;
  objectName: string;
  connectionString: string;
  creationName: string;     // e.g., "OLEDB", "FLATFILE", "ADO.NET"
  description: string;
  properties: Record<string, string>;
  unknownElements: UnknownXmlElement[];
}

/** A variable scoped to the package or an executable */
export interface SsisVariable {
  id: string;
  dtsId: string;
  objectName: string;
  namespace: string;        // "User" or "System"
  dataType: SsisDataType;
  value: any;
  expression?: string;
  evaluateAsExpression: boolean;
  readOnly: boolean;
  unknownElements: UnknownXmlElement[];
}

/** A package parameter */
export interface SsisParameter {
  id: string;
  dtsId: string;
  objectName: string;
  dataType: SsisDataType;
  value: any;
  required: boolean;
  sensitive: boolean;
  unknownElements: UnknownXmlElement[];
}

/** SSIS data type names as used in DTS:DataType values */
export type SsisDataType =
  | 'Boolean'
  | 'Byte'
  | 'Char'
  | 'DateTime'
  | 'DBNull'
  | 'Decimal'
  | 'Double'
  | 'Empty'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Object'
  | 'SByte'
  | 'Single'
  | 'String'
  | 'UInt32'
  | 'UInt64';

/** Map from DTS numeric data-type codes to SsisDataType */
export const DTS_DATA_TYPE_MAP: Record<number, SsisDataType> = {
  2: 'Int16',
  3: 'Int32',
  4: 'Single',
  5: 'Double',
  6: 'Decimal',
  7: 'DateTime',
  8: 'String',
  11: 'Boolean',
  13: 'Object',
  14: 'Decimal',
  16: 'SByte',
  17: 'Byte',
  18: 'Char',
  19: 'UInt64',
  20: 'Int64',
  21: 'UInt32',
  22: 'UInt64',
};

/** Connection reference inside ObjectData of a task */
export interface ObjectDataConnectionRef {
  connectionManagerId: string;  // DTSID reference
  connectionManagerName: string;
}

/** Preserves unrecognized XML so round-trip serialization is lossless */
export interface UnknownXmlElement {
  rawXml: string;           // Preserved raw XML string
  parentPath: string;       // XPath-like location in the document
}
