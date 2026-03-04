/**
 * Shared CSS-in-JS styles and helpers for custom React Flow nodes.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Color palette for node top bars
// ---------------------------------------------------------------------------

export const NODE_COLORS: Record<string, string> = {
  executeSql: '#4CAF50',
  dataFlow: '#FF9800',
  forLoop: '#9C27B0',
  forEachLoop: '#7B1FA2',
  sequence: '#03A9F4',
  scriptTask: '#FF5722',
  genericTask: '#757575',
};

// ---------------------------------------------------------------------------
// Data flow color palette
// ---------------------------------------------------------------------------

export const DATAFLOW_COLORS = {
  source: '#2196F3',
  transform: '#FF9800',
  destination: '#4CAF50',
  error: '#F44336',
  generic: '#757575',
} as const;

// ---------------------------------------------------------------------------
// Dimension defaults
// ---------------------------------------------------------------------------

export const NODE_DEFAULT_WIDTH = 200;
export const NODE_DEFAULT_HEIGHT = 80;
export const CONTAINER_DEFAULT_WIDTH = 300;
export const CONTAINER_DEFAULT_HEIGHT = 200;
export const DF_NODE_DEFAULT_WIDTH = 220;
export const DF_NODE_DEFAULT_HEIGHT = 90;

// ---------------------------------------------------------------------------
// CSS-in-JS styles
// ---------------------------------------------------------------------------

export const nodeShellStyle: React.CSSProperties = {
  background: 'var(--node-bg, #252526)',
  border: '1px solid var(--node-border, #454545)',
  borderRadius: 4,
  minWidth: NODE_DEFAULT_WIDTH,
  minHeight: NODE_DEFAULT_HEIGHT,
  fontFamily: 'var(--vscode-font-family, "Segoe UI", sans-serif)',
  fontSize: 'var(--vscode-font-size, 13px)',
  color: 'var(--canvas-fg, #cccccc)',
  overflow: 'hidden',
  cursor: 'grab',
};

export const nodeShellSelectedStyle: React.CSSProperties = {
  borderColor: 'var(--node-selected-border, #007fd4)',
  boxShadow: '0 0 0 1px var(--node-selected-border, #007fd4)',
};

export const containerShellStyle: React.CSSProperties = {
  ...nodeShellStyle,
  minWidth: CONTAINER_DEFAULT_WIDTH,
  minHeight: CONTAINER_DEFAULT_HEIGHT,
};

export const topBarStyle = (color: string): React.CSSProperties => ({
  height: 4,
  backgroundColor: color,
  borderRadius: '4px 4px 0 0',
});

export const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px 2px 10px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export const bodyStyle: React.CSSProperties = {
  padding: '0 10px 6px 10px',
  fontSize: '0.85em',
  opacity: 0.75,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export const iconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
};

export const handleCommonStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: 'var(--node-selected-border, #007fd4)',
  border: '2px solid var(--node-bg, #252526)',
};
