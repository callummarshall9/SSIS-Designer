/**
 * ExecutionHistoryPanel (webview) – React component showing past SSIS executions.
 *
 * Features:
 *   - Table with sortable columns
 *   - Status icons
 *   - Filtering by status, date range, package name
 *   - Expandable rows with messages, row counts, parameters
 *   - Auto-refresh toggle
 *   - Pagination (50 per page)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionHistoryEntry {
  executionId: number;
  folderName: string;
  projectName: string;
  packageName: string;
  status: number;
  startTime: string; // ISO string
  endTime?: string;
  executedAsName: string;
}

export interface ExecutionMessageEntry {
  messageId: number;
  messageTime: string;
  messageType: number;
  message: string;
  packageName: string;
  eventName: string;
  executionPath: string;
}

export interface DataStatisticEntry {
  dataStatisticsId: number;
  executionId: number;
  packageName: string;
  dataflowPathIdString: string;
  sourceName: string;
  destinationName: string;
  rowsSent: number;
  createdTime: string;
}

export interface ExecutionParameterEntry {
  executionId: number;
  objectType: number;
  parameterName: string;
  parameterValue: string | null;
  sensitiveParameterValue: boolean;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<number, { label: string; icon: string; className: string }> = {
  1: { label: 'Created',  icon: '🔵', className: 'status--created' },
  2: { label: 'Running',  icon: '▶️', className: 'status--running' },
  3: { label: 'Canceled', icon: '⏹',  className: 'status--canceled' },
  4: { label: 'Failed',   icon: '❌', className: 'status--failed' },
  5: { label: 'Pending',  icon: '⏸',  className: 'status--pending' },
  6: { label: 'Ended Unexpectedly', icon: '❌', className: 'status--failed' },
  7: { label: 'Succeeded', icon: '✅', className: 'status--succeeded' },
  9: { label: 'Completing', icon: '▶️', className: 'status--running' },
};

function statusInfo(s: number) {
  return STATUS_MAP[s] ?? { label: `Unknown (${s})`, icon: '❓', className: '' };
}

function formatDuration(start: string, end?: string): string {
  if (!end) { return '—'; }
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) { return `${ms}ms`; }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) { return `${seconds}s`; }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) { return `${minutes}m ${secs}s`; }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m ${secs}s`;
}

function formatTime(iso?: string): string {
  if (!iso) { return '—'; }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Msg type label
const MSG_TYPE_LABELS: Record<number, string> = {
  120: 'Error',
  130: 'Warning',
  140: 'Information',
  60: 'Progress',
  70: 'Status Change',
};

// ---------------------------------------------------------------------------
// VS Code API helper
// ---------------------------------------------------------------------------

function getVsCodeApi() {
  return (globalThis as any)._vscodeApi as
    | { postMessage(msg: any): void }
    | undefined;
}

// ---------------------------------------------------------------------------
// Sort type
// ---------------------------------------------------------------------------

type SortColumn =
  | 'executionId' | 'packageName' | 'projectName'
  | 'status' | 'startTime' | 'endTime' | 'executedAsName';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

export interface ExecutionHistoryPanelProps {
  visible: boolean;
  onClose: () => void;
}

const ExecutionHistoryPanel: React.FC<ExecutionHistoryPanelProps> = ({ visible, onClose }) => {
  const [executions, setExecutions] = useState<ExecutionHistoryEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<number | ''>('');
  const [filterPackage, setFilterPackage] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Sort
  const [sortColumn, setSortColumn] = useState<SortColumn>('executionId');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval>>();

  // Expanded rows
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<ExecutionMessageEntry[]>([]);
  const [expandedStats, setExpandedStats] = useState<DataStatisticEntry[]>([]);
  const [expandedParams, setExpandedParams] = useState<ExecutionParameterEntry[]>([]);
  const [expandedTab, setExpandedTab] = useState<'messages' | 'stats' | 'params'>('messages');

  // -----------------------------------------------------------------------
  // Fetch executions
  // -----------------------------------------------------------------------

  const fetchExecutions = useCallback(() => {
    setLoading(true);
    setError(null);
    const api = getVsCodeApi();
    api?.postMessage({
      type: 'getExecutionHistory',
      page,
      pageSize: PAGE_SIZE,
      filterStatus: filterStatus !== '' ? filterStatus : undefined,
      filterPackage: filterPackage || undefined,
      filterDateFrom: filterDateFrom || undefined,
      filterDateTo: filterDateTo || undefined,
      sortColumn,
      sortDir,
    });
  }, [page, filterStatus, filterPackage, filterDateFrom, filterDateTo, sortColumn, sortDir]);

  // -----------------------------------------------------------------------
  // Message handler
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'executionHistoryLoaded':
          setExecutions(msg.executions ?? []);
          setTotalCount(msg.totalCount ?? msg.executions?.length ?? 0);
          setLoading(false);
          break;

        case 'executionDetailsLoaded':
          setExpandedMessages(msg.messages ?? []);
          setExpandedStats(msg.statistics ?? []);
          setExpandedParams(msg.parameters ?? []);
          break;

        case 'executionHistoryError':
          setError(msg.error ?? 'Unknown error');
          setLoading(false);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // -----------------------------------------------------------------------
  // Initial fetch & auto-refresh
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (visible) { fetchExecutions(); }
  }, [visible, fetchExecutions]);

  useEffect(() => {
    if (autoRefresh && visible) {
      autoRefreshRef.current = setInterval(fetchExecutions, 5000);
    }
    return () => {
      if (autoRefreshRef.current) { clearInterval(autoRefreshRef.current); }
    };
  }, [autoRefresh, visible, fetchExecutions]);

  // -----------------------------------------------------------------------
  // Expand / collapse
  // -----------------------------------------------------------------------

  const toggleExpand = useCallback(
    (execId: number) => {
      if (expandedId === execId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(execId);
      setExpandedTab('messages');
      const api = getVsCodeApi();
      api?.postMessage({ type: 'getExecutionDetails', executionId: execId });
    },
    [expandedId],
  );

  // -----------------------------------------------------------------------
  // Sort
  // -----------------------------------------------------------------------

  const handleSort = useCallback(
    (col: SortColumn) => {
      if (sortColumn === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(col);
        setSortDir('desc');
      }
    },
    [sortColumn],
  );

  const sortIndicator = (col: SortColumn) => {
    if (sortColumn !== col) { return ''; }
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  // -----------------------------------------------------------------------
  // Pagination
  // -----------------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // -----------------------------------------------------------------------
  // View full messages
  // -----------------------------------------------------------------------

  const handleViewMessages = useCallback(
    (execId: number) => {
      const api = getVsCodeApi();
      api?.postMessage({ type: 'viewExecutionMessages', executionId: execId });
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!visible) { return null; }

  return (
    <div className="ssis-exec-history-overlay">
      <div className="ssis-exec-history">
        {/* Header */}
        <div className="ssis-exec-history__header">
          <h2 className="ssis-exec-history__title">Execution History</h2>
          <div className="ssis-exec-history__header-actions">
            <label className="ssis-exec-history__auto-refresh">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
            <button className="ssis-exec-history__refresh-btn" onClick={fetchExecutions} title="Refresh">
              🔄
            </button>
            <button className="ssis-exec-history__close-btn" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Error */}
        {error && <div className="ssis-exec-history__error">{error}</div>}

        {/* Filters */}
        <div className="ssis-exec-history__filters">
          <select
            className="ssis-exec-history__filter-select"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value === '' ? '' : Number(e.target.value));
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
          <input
            className="ssis-exec-history__filter-input"
            placeholder="Filter by package name…"
            value={filterPackage}
            onChange={(e) => { setFilterPackage(e.target.value); setPage(0); }}
          />
          <input
            className="ssis-exec-history__filter-date"
            type="date"
            title="From date"
            value={filterDateFrom}
            onChange={(e) => { setFilterDateFrom(e.target.value); setPage(0); }}
          />
          <span className="ssis-exec-history__filter-sep">–</span>
          <input
            className="ssis-exec-history__filter-date"
            type="date"
            title="To date"
            value={filterDateTo}
            onChange={(e) => { setFilterDateTo(e.target.value); setPage(0); }}
          />
        </div>

        {/* Table */}
        <div className="ssis-exec-history__table-wrapper">
          <table className="ssis-exec-history__table">
            <thead>
              <tr>
                <th onClick={() => handleSort('executionId')} className="ssis-exec-history__th--sortable">
                  ID{sortIndicator('executionId')}
                </th>
                <th onClick={() => handleSort('packageName')} className="ssis-exec-history__th--sortable">
                  Package{sortIndicator('packageName')}
                </th>
                <th onClick={() => handleSort('projectName')} className="ssis-exec-history__th--sortable">
                  Project{sortIndicator('projectName')}
                </th>
                <th onClick={() => handleSort('status')} className="ssis-exec-history__th--sortable">
                  Status{sortIndicator('status')}
                </th>
                <th onClick={() => handleSort('startTime')} className="ssis-exec-history__th--sortable">
                  Start Time{sortIndicator('startTime')}
                </th>
                <th onClick={() => handleSort('endTime')} className="ssis-exec-history__th--sortable">
                  End Time{sortIndicator('endTime')}
                </th>
                <th>Duration</th>
                <th onClick={() => handleSort('executedAsName')} className="ssis-exec-history__th--sortable">
                  Executed As{sortIndicator('executedAsName')}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && executions.length === 0 && (
                <tr>
                  <td colSpan={8} className="ssis-exec-history__loading">Loading…</td>
                </tr>
              )}
              {!loading && executions.length === 0 && (
                <tr>
                  <td colSpan={8} className="ssis-exec-history__empty">No executions found.</td>
                </tr>
              )}
              {executions.map((exec) => {
                const si = statusInfo(exec.status);
                const isExpanded = expandedId === exec.executionId;
                return (
                  <React.Fragment key={exec.executionId}>
                    <tr
                      className={`ssis-exec-history__row ${isExpanded ? 'ssis-exec-history__row--expanded' : ''}`}
                      onClick={() => toggleExpand(exec.executionId)}
                    >
                      <td>{exec.executionId}</td>
                      <td>{exec.packageName}</td>
                      <td>{exec.projectName}</td>
                      <td>
                        <span className={`ssis-exec-history__status ${si.className}`}>
                          {si.icon} {si.label}
                        </span>
                      </td>
                      <td>{formatTime(exec.startTime)}</td>
                      <td>{formatTime(exec.endTime)}</td>
                      <td>{formatDuration(exec.startTime, exec.endTime)}</td>
                      <td>{exec.executedAsName}</td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr className="ssis-exec-history__detail-row">
                        <td colSpan={8}>
                          <div className="ssis-exec-history__detail">
                            {/* Detail tabs */}
                            <div className="ssis-exec-history__detail-tabs">
                              <button
                                className={`ssis-exec-history__detail-tab ${expandedTab === 'messages' ? 'ssis-exec-history__detail-tab--active' : ''}`}
                                onClick={(e) => { e.stopPropagation(); setExpandedTab('messages'); }}
                              >
                                Messages ({expandedMessages.length})
                              </button>
                              <button
                                className={`ssis-exec-history__detail-tab ${expandedTab === 'stats' ? 'ssis-exec-history__detail-tab--active' : ''}`}
                                onClick={(e) => { e.stopPropagation(); setExpandedTab('stats'); }}
                              >
                                Row Counts ({expandedStats.length})
                              </button>
                              <button
                                className={`ssis-exec-history__detail-tab ${expandedTab === 'params' ? 'ssis-exec-history__detail-tab--active' : ''}`}
                                onClick={(e) => { e.stopPropagation(); setExpandedTab('params'); }}
                              >
                                Parameters ({expandedParams.length})
                              </button>
                              <button
                                className="ssis-exec-history__detail-tab ssis-exec-history__detail-tab--action"
                                onClick={(e) => { e.stopPropagation(); handleViewMessages(exec.executionId); }}
                              >
                                View Full Messages
                              </button>
                            </div>

                            {/* Messages tab */}
                            {expandedTab === 'messages' && (
                              <div className="ssis-exec-history__messages">
                                {expandedMessages.length === 0 ? (
                                  <p className="ssis-exec-history__detail-empty">No messages.</p>
                                ) : (
                                  <table className="ssis-exec-history__messages-table">
                                    <thead>
                                      <tr>
                                        <th>Time</th>
                                        <th>Type</th>
                                        <th>Package</th>
                                        <th>Message</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandedMessages.slice(0, 100).map((m) => (
                                        <tr
                                          key={m.messageId}
                                          className={`ssis-exec-history__msg-row ssis-exec-history__msg-row--type-${m.messageType}`}
                                        >
                                          <td className="ssis-exec-history__msg-time">
                                            {formatTime(m.messageTime)}
                                          </td>
                                          <td>{MSG_TYPE_LABELS[m.messageType] ?? m.messageType}</td>
                                          <td>{m.packageName}</td>
                                          <td className="ssis-exec-history__msg-text">{m.message}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}

                            {/* Stats tab */}
                            {expandedTab === 'stats' && (
                              <div className="ssis-exec-history__stats">
                                {expandedStats.length === 0 ? (
                                  <p className="ssis-exec-history__detail-empty">No data statistics.</p>
                                ) : (
                                  <table className="ssis-exec-history__stats-table">
                                    <thead>
                                      <tr>
                                        <th>Source</th>
                                        <th>Destination</th>
                                        <th>Rows Sent</th>
                                        <th>Time</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandedStats.map((s) => (
                                        <tr key={s.dataStatisticsId}>
                                          <td>{s.sourceName}</td>
                                          <td>{s.destinationName}</td>
                                          <td className="ssis-exec-history__cell-right">
                                            {s.rowsSent.toLocaleString()}
                                          </td>
                                          <td>{formatTime(s.createdTime)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}

                            {/* Params tab */}
                            {expandedTab === 'params' && (
                              <div className="ssis-exec-history__params">
                                {expandedParams.length === 0 ? (
                                  <p className="ssis-exec-history__detail-empty">No parameters.</p>
                                ) : (
                                  <table className="ssis-exec-history__params-table">
                                    <thead>
                                      <tr>
                                        <th>Name</th>
                                        <th>Value</th>
                                        <th>Object Type</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandedParams.map((p, idx) => (
                                        <tr key={idx}>
                                          <td>{p.parameterName}</td>
                                          <td>
                                            {p.sensitiveParameterValue
                                              ? '•••••'
                                              : String(p.parameterValue ?? '')}
                                          </td>
                                          <td>{p.objectType}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="ssis-exec-history__pagination">
          <button
            className="ssis-exec-history__page-btn"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ‹ Prev
          </button>
          <span className="ssis-exec-history__page-info">
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="ssis-exec-history__page-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExecutionHistoryPanel;
