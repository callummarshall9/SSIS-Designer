/**
 * Data flow–specific models for the SSIS pipeline layout.
 */

import { UnknownXmlElement } from './SsisPackageModel';

/** The data-flow model embedded inside a Data Flow Task executable */
export interface DataFlowModel {
  components: DataFlowComponent[];
  paths: DataFlowPath[];
  unknownElements: UnknownXmlElement[];
}

/** A single pipeline component (source, transform, or destination) */
export interface DataFlowComponent {
  id: string;
  refId: string;            // Pipeline component refId
  componentClassId: string;  // e.g., "Microsoft.OLEDBSource"
  name: string;
  description: string;

  // Canvas position
  x: number;
  y: number;

  // Component-specific properties
  properties: Record<string, any>;

  // Input/output columns
  inputs: DataFlowInput[];
  outputs: DataFlowOutput[];

  // Connection reference
  connectionManagerRefId?: string;

  unknownElements: UnknownXmlElement[];
}

/** An input on a data-flow component */
export interface DataFlowInput {
  id: string;
  refId: string;
  name: string;
  columns: DataFlowColumn[];
  externalColumns: ExternalColumn[];
  unknownElements: UnknownXmlElement[];
}

/** An output on a data-flow component */
export interface DataFlowOutput {
  id: string;
  refId: string;
  name: string;
  isErrorOutput: boolean;
  columns: DataFlowColumn[];
  externalColumns: ExternalColumn[];
  unknownElements: UnknownXmlElement[];
}

/** A column within a data-flow input or output */
export interface DataFlowColumn {
  id: string;
  refId: string;
  name: string;
  dataType: string;
  length?: number;
  precision?: number;
  scale?: number;
  codePage?: number;
  sortKeyPosition?: number;
  /** Expression for derived columns */
  expression?: string;
  unknownElements: UnknownXmlElement[];
}

/** A column representing an external metadata column */
export interface ExternalColumn {
  id: string;
  refId: string;
  name: string;
  dataType: string;
  length?: number;
  precision?: number;
  scale?: number;
  codePage?: number;
}

/** A path connecting an output of one component to the input of another */
export interface DataFlowPath {
  id: string;
  refId: string;
  name: string;
  fromOutputId: string;
  toInputId: string;
  unknownElements: UnknownXmlElement[];
}
