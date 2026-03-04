/**
 * ValidationOverlay – renders validation indicators on canvas nodes.
 *
 * Subscribes to `validationResults` from the Zustand store and renders
 * positioned badges on each node that has issues.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useCanvasStore, ValidationResultEntry } from './shared/CanvasState';

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

function severityIcon(severity: 'error' | 'warning' | 'info'): string {
  switch (severity) {
    case 'error':   return '❌';
    case 'warning': return '⚠️';
    case 'info':    return 'ℹ️';
    default:        return '❓';
  }
}

function severityClass(severity: 'error' | 'warning' | 'info'): string {
  switch (severity) {
    case 'error':   return 'ssis-validation-badge--error';
    case 'warning': return 'ssis-validation-badge--warning';
    case 'info':    return 'ssis-validation-badge--info';
    default:        return '';
  }
}

function worstSeverity(results: ValidationResultEntry[]): 'error' | 'warning' | 'info' {
  if (results.some(r => r.severity === 'error')) { return 'error'; }
  if (results.some(r => r.severity === 'warning')) { return 'warning'; }
  return 'info';
}

// ---------------------------------------------------------------------------
// Tooltip component
// ---------------------------------------------------------------------------

interface TooltipProps {
  results: ValidationResultEntry[];
  onClickIssue?: (result: ValidationResultEntry) => void;
}

const ValidationTooltip: React.FC<TooltipProps> = ({ results, onClickIssue }) => (
  <div className="ssis-validation-tooltip">
    <div className="ssis-validation-tooltip__header">
      {results.length} issue{results.length !== 1 ? 's' : ''}
    </div>
    <ul className="ssis-validation-tooltip__list">
      {results.map((r, idx) => (
        <li
          key={idx}
          className={`ssis-validation-tooltip__item ssis-validation-tooltip__item--${r.severity}`}
          onClick={() => onClickIssue?.(r)}
          title="Click to show in property panel"
        >
          <span className="ssis-validation-tooltip__icon">{severityIcon(r.severity)}</span>
          <span className="ssis-validation-tooltip__message">{r.message}</span>
        </li>
      ))}
    </ul>
  </div>
);

// ---------------------------------------------------------------------------
// Badge for a single node
// ---------------------------------------------------------------------------

interface NodeBadgeProps {
  nodeId: string;
  results: ValidationResultEntry[];
}

const NodeValidationBadge: React.FC<NodeBadgeProps> = ({ nodeId, results }) => {
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const worst = worstSeverity(results);
  const icon = severityIcon(worst);
  const count = results.length;

  const handleClick = useCallback(
    (result: ValidationResultEntry) => {
      // Post message to extension host to scroll property panel to the issue
      const api = (globalThis as any)._vscodeApi;
      api?.postMessage({
        type: 'scrollToProperty',
        nodeId,
        property: result.location,
        message: result.message,
      });
    },
    [nodeId],
  );

  return (
    <div
      className={`ssis-validation-badge ${severityClass(worst)}`}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      data-node-id={nodeId}
    >
      <span className="ssis-validation-badge__icon">{icon}</span>
      {count > 1 && (
        <span className="ssis-validation-badge__count">{count}</span>
      )}
      {tooltipVisible && (
        <ValidationTooltip results={results} onClickIssue={handleClick} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Valid indicator (shown only when validation has been run and node is clean)
// ---------------------------------------------------------------------------

const ValidBadge: React.FC = () => (
  <div className="ssis-validation-badge ssis-validation-badge--valid">
    <span className="ssis-validation-badge__icon">✅</span>
  </div>
);

// ---------------------------------------------------------------------------
// Main overlay component
// ---------------------------------------------------------------------------

export interface ValidationOverlayProps {
  /** Set of all node IDs currently on the canvas */
  nodeIds: string[];
}

const ValidationOverlay: React.FC<ValidationOverlayProps> = ({ nodeIds }) => {
  const validationResults = useCanvasStore((s) => s.validationResults);
  const validationRun = useCanvasStore((s) => s.validationRun);

  const badges = useMemo(() => {
    if (!validationResults || validationResults.size === 0) {
      if (!validationRun) { return null; }
      // Validation was run but no issues — show green checks
      return nodeIds.map((nid) => (
        <div key={nid} className="ssis-validation-overlay__node" data-overlay-node={nid}>
          <ValidBadge />
        </div>
      ));
    }

    return nodeIds.map((nid) => {
      const issues = validationResults.get(nid);
      if (!issues || issues.length === 0) {
        return validationRun ? (
          <div key={nid} className="ssis-validation-overlay__node" data-overlay-node={nid}>
            <ValidBadge />
          </div>
        ) : null;
      }
      return (
        <div key={nid} className="ssis-validation-overlay__node" data-overlay-node={nid}>
          <NodeValidationBadge nodeId={nid} results={issues} />
        </div>
      );
    });
  }, [nodeIds, validationResults, validationRun]);

  if (!badges) { return null; }

  return <div className="ssis-validation-overlay">{badges}</div>;
};

export default ValidationOverlay;
