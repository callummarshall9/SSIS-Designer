/**
 * Expression Builder Component — full-featured SSIS expression editor.
 *
 * Features:
 *  - Syntax-highlighted code editor (custom tokenizer, no external lib)
 *  - Autocomplete dropdown (functions, variables, columns)
 *  - Function reference panel (grouped by category)
 *  - Variable browser
 *  - Live validation preview
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { SsisVariable } from '../models/SsisPackageModel';
import { DataFlowColumn } from '../models/DataFlowModel';
import { tokenize, Token, extractVariableRefs } from './expression/ExpressionTokenizer';
import { validateExpression, ValidationError } from './expression/ExpressionValidator';
import {
  SSIS_FUNCTIONS,
  SsisFunction,
  FUNCTION_CATEGORIES,
  getFunctionsByCategory,
  SSIS_OPERATORS,
} from './expression/SsisFunctions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExpressionBuilderProps {
  value: string;
  onChange: (expr: string) => void;
  variables: SsisVariable[];
  columns?: DataFlowColumn[];
  onClose: () => void;
  title?: string;
}

// ---------------------------------------------------------------------------
// Autocomplete item
// ---------------------------------------------------------------------------

interface AutocompleteItem {
  label: string;
  insertText: string;
  detail: string;
  kind: 'function' | 'variable' | 'column' | 'cast';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_CLASS_MAP: Record<string, string> = {
  keyword: 'ssis-expr-token-keyword',
  string: 'ssis-expr-token-string',
  number: 'ssis-expr-token-number',
  variable: 'ssis-expr-token-variable',
  operator: 'ssis-expr-token-operator',
  cast: 'ssis-expr-token-cast',
  paren: 'ssis-expr-token-paren',
  bracket: 'ssis-expr-token-bracket',
  comma: 'ssis-expr-token-comma',
  ternary: 'ssis-expr-token-operator',
  whitespace: '',
  unknown: '',
};

// ---------------------------------------------------------------------------
// Highlighted code renderer
// ---------------------------------------------------------------------------

function renderHighlightedTokens(tokens: Token[]): React.ReactNode[] {
  return tokens.map((token, i) => {
    const cls = TOKEN_CLASS_MAP[token.type];
    if (!cls) {
      // whitespace or unknown — render as plain text, preserving whitespace
      return <span key={i}>{token.value}</span>;
    }
    return (
      <span key={i} className={cls}>
        {token.value}
      </span>
    );
  });
}

// ---------------------------------------------------------------------------
// Expression Builder Component
// ---------------------------------------------------------------------------

const ExpressionBuilder: React.FC<ExpressionBuilderProps> = ({
  value,
  onChange,
  variables,
  columns,
  onClose,
  title = 'Expression Builder',
}) => {
  // State
  const [expression, setExpression] = useState(value);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [activeFuncCategory, setActiveFuncCategory] = useState<SsisFunction['category']>('String');
  const [activeTab, setActiveTab] = useState<'functions' | 'variables'>('functions');
  const [funcSearch, setFuncSearch] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Derived
  const tokens = useMemo(() => tokenize(expression), [expression]);
  const validation = useMemo(() => validateExpression(expression), [expression]);
  const usedVarRefs = useMemo(() => extractVariableRefs(expression), [expression]);

  // Autocomplete items
  const autocompleteItems = useMemo((): AutocompleteItem[] => {
    const items: AutocompleteItem[] = [];

    // Functions
    for (const fn of SSIS_FUNCTIONS) {
      if (fn.category === 'Conditional') { continue; }
      items.push({
        label: fn.name,
        insertText: fn.category === 'TypeCast' ? fn.name : `${fn.name}(`,
        detail: fn.signature,
        kind: fn.category === 'TypeCast' ? 'cast' : 'function',
      });
    }

    // Variables
    for (const v of variables) {
      items.push({
        label: `@[${v.namespace}::${v.objectName}]`,
        insertText: `@[${v.namespace}::${v.objectName}]`,
        detail: `${v.dataType} variable`,
        kind: 'variable',
      });
    }

    // Columns
    if (columns) {
      for (const col of columns) {
        items.push({
          label: col.name,
          insertText: col.name,
          detail: `Column (${col.dataType})`,
          kind: 'column',
        });
      }
    }

    return items;
  }, [variables, columns]);

  const filteredAutocomplete = useMemo(() => {
    if (!autocompleteFilter) { return autocompleteItems.slice(0, 50); }
    const lower = autocompleteFilter.toLowerCase();
    return autocompleteItems
      .filter(item => item.label.toLowerCase().includes(lower))
      .slice(0, 50);
  }, [autocompleteItems, autocompleteFilter]);

  // Functions filtered for reference panel
  const filteredFunctions = useMemo(() => {
    let fns = getFunctionsByCategory(activeFuncCategory);
    if (funcSearch) {
      const lower = funcSearch.toLowerCase();
      fns = fns.filter(f =>
        f.name.toLowerCase().includes(lower) ||
        f.description.toLowerCase().includes(lower)
      );
    }
    return fns;
  }, [activeFuncCategory, funcSearch]);

  // Grouped variables for browser
  const groupedVariables = useMemo(() => {
    const groups: Record<string, SsisVariable[]> = {};
    for (const v of variables) {
      const scope = v.namespace || 'User';
      (groups[scope] ??= []).push(v);
    }
    return groups;
  }, [variables]);

  // -- Handlers -----------------------------------------------------------

  const handleExpressionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setExpression(newVal);

    // Determine autocomplete filter from cursor position
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newVal.slice(0, cursorPos);
    const wordMatch = textBeforeCursor.match(/([A-Za-z_@\[]\w*)$/);
    if (wordMatch && wordMatch[1].length >= 1) {
      setAutocompleteFilter(wordMatch[1]);
      setShowAutocomplete(true);
      setAutocompleteIndex(0);
    } else {
      setShowAutocomplete(false);
      setAutocompleteFilter('');
    }
  }, []);

  const insertAtCursor = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) { return; }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // Find start of current word to replace
    const beforeCursor = expression.slice(0, start);
    const wordMatch = beforeCursor.match(/([A-Za-z_@\[]\w*)$/);
    const replaceStart = wordMatch ? start - wordMatch[1].length : start;

    const newExpr = expression.slice(0, replaceStart) + text + expression.slice(end);
    setExpression(newExpr);
    setShowAutocomplete(false);
    setAutocompleteFilter('');

    // Restore focus and cursor
    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = replaceStart + text.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  }, [expression]);

  const handleAutocompleteSelect = useCallback((item: AutocompleteItem) => {
    insertAtCursor(item.insertText);
  }, [insertAtCursor]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Space => open autocomplete
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      setShowAutocomplete(true);
      setAutocompleteIndex(0);
      const cursorPos = e.currentTarget.selectionStart;
      const textBefore = expression.slice(0, cursorPos);
      const wordMatch = textBefore.match(/([A-Za-z_@\[]\w*)$/);
      setAutocompleteFilter(wordMatch ? wordMatch[1] : '');
      return;
    }

    if (!showAutocomplete || filteredAutocomplete.length === 0) { return; }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAutocompleteIndex(i => Math.min(i + 1, filteredAutocomplete.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAutocompleteIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleAutocompleteSelect(filteredAutocomplete[autocompleteIndex]);
    } else if (e.key === 'Escape') {
      setShowAutocomplete(false);
    }
  }, [showAutocomplete, filteredAutocomplete, autocompleteIndex, handleAutocompleteSelect, expression]);

  const handleInsertFunction = useCallback((fn: SsisFunction) => {
    if (fn.category === 'TypeCast') {
      insertAtCursor(fn.name + ' ');
    } else if (fn.category === 'Conditional') {
      insertAtCursor(' ? : ');
    } else {
      insertAtCursor(`${fn.name}(`);
    }
  }, [insertAtCursor]);

  const handleInsertVariable = useCallback((v: SsisVariable) => {
    insertAtCursor(`@[${v.namespace}::${v.objectName}]`);
  }, [insertAtCursor]);

  const handleInsertColumn = useCallback((col: DataFlowColumn) => {
    insertAtCursor(col.name);
  }, [insertAtCursor]);

  const handleApply = useCallback(() => {
    onChange(expression);
    onClose();
  }, [expression, onChange, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Scroll autocomplete into view
  useEffect(() => {
    if (showAutocomplete && autocompleteRef.current) {
      const active = autocompleteRef.current.querySelector('.ssis-expr-ac-item--active');
      active?.scrollIntoView({ block: 'nearest' });
    }
  }, [autocompleteIndex, showAutocomplete]);

  // -- Render -------------------------------------------------------------

  const errorCount = validation.errors.filter(e => e.severity === 'error').length;
  const warningCount = validation.errors.filter(e => e.severity === 'warning').length;

  return (
    <div className="ssis-expr-builder-overlay">
      <div className="ssis-expr-builder">
        {/* Header */}
        <div className="ssis-expr-builder__header">
          <span className="ssis-expr-builder__title">{title}</span>
          <div className="ssis-expr-builder__header-actions">
            <button className="ssis-expr-builder__btn ssis-expr-builder__btn--apply" onClick={handleApply}>
              Apply
            </button>
            <button className="ssis-expr-builder__btn ssis-expr-builder__btn--cancel" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>

        <div className="ssis-expr-builder__body">
          {/* Left: Reference panel */}
          <div className="ssis-expr-builder__sidebar">
            {/* Tab bar */}
            <div className="ssis-expr-builder__tab-bar">
              <button
                className={`ssis-expr-builder__tab ${activeTab === 'functions' ? 'ssis-expr-builder__tab--active' : ''}`}
                onClick={() => setActiveTab('functions')}
              >
                Functions
              </button>
              <button
                className={`ssis-expr-builder__tab ${activeTab === 'variables' ? 'ssis-expr-builder__tab--active' : ''}`}
                onClick={() => setActiveTab('variables')}
              >
                Variables
              </button>
            </div>

            {activeTab === 'functions' && (
              <div className="ssis-expr-builder__func-panel">
                {/* Search */}
                <input
                  type="text"
                  className="ssis-expr-builder__search"
                  placeholder="Search functions..."
                  value={funcSearch}
                  onChange={e => setFuncSearch(e.target.value)}
                />

                {/* Category tabs */}
                <div className="ssis-expr-builder__categories">
                  {FUNCTION_CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      className={`ssis-expr-builder__cat-btn ${activeFuncCategory === cat ? 'ssis-expr-builder__cat-btn--active' : ''}`}
                      onClick={() => setActiveFuncCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Function list */}
                <div className="ssis-expr-builder__func-list">
                  {filteredFunctions.map(fn => (
                    <div
                      key={fn.name}
                      className="ssis-expr-builder__func-item"
                      onClick={() => handleInsertFunction(fn)}
                      title={`Click to insert\n\n${fn.description}\n\nExample: ${fn.example}`}
                    >
                      <div className="ssis-expr-builder__func-name">{fn.name}</div>
                      <div className="ssis-expr-builder__func-sig">{fn.signature}</div>
                      <div className="ssis-expr-builder__func-desc">{fn.description}</div>
                    </div>
                  ))}
                  {filteredFunctions.length === 0 && (
                    <div className="ssis-expr-builder__empty">No functions found</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'variables' && (
              <div className="ssis-expr-builder__var-panel">
                {/* Variable groups */}
                {Object.entries(groupedVariables).map(([scope, vars]) => (
                  <div key={scope} className="ssis-expr-builder__var-group">
                    <div className="ssis-expr-builder__var-group-header">{scope} Variables</div>
                    {vars.map(v => (
                      <div
                        key={v.id}
                        className="ssis-expr-builder__var-item"
                        onDoubleClick={() => handleInsertVariable(v)}
                        title={`Double-click to insert @[${v.namespace}::${v.objectName}]\nType: ${v.dataType}\nValue: ${v.value}`}
                      >
                        <span className="ssis-expr-builder__var-icon">x</span>
                        <span className="ssis-expr-builder__var-name">{v.objectName}</span>
                        <span className="ssis-expr-builder__var-type">{v.dataType}</span>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Columns (if in data flow context) */}
                {columns && columns.length > 0 && (
                  <div className="ssis-expr-builder__var-group">
                    <div className="ssis-expr-builder__var-group-header">Columns</div>
                    {columns.map(col => (
                      <div
                        key={col.id}
                        className="ssis-expr-builder__var-item"
                        onDoubleClick={() => handleInsertColumn(col)}
                        title={`Double-click to insert ${col.name}\nType: ${col.dataType}`}
                      >
                        <span className="ssis-expr-builder__var-icon">▦</span>
                        <span className="ssis-expr-builder__var-name">{col.name}</span>
                        <span className="ssis-expr-builder__var-type">{col.dataType}</span>
                      </div>
                    ))}
                  </div>
                )}

                {variables.length === 0 && (!columns || columns.length === 0) && (
                  <div className="ssis-expr-builder__empty">No variables or columns available</div>
                )}
              </div>
            )}
          </div>

          {/* Right: Editor + preview */}
          <div className="ssis-expr-builder__editor-area">
            {/* Code editor */}
            <div className="ssis-expr-builder__editor-container">
              <div className="ssis-expr-builder__editor-label">Expression</div>
              <div className="ssis-expr-builder__code-editor">
                {/* Syntax-highlighted overlay */}
                <pre className="ssis-expr-builder__highlight-layer" aria-hidden="true">
                  <code>{renderHighlightedTokens(tokens)}</code>
                </pre>
                {/* Actual textarea for input */}
                <textarea
                  ref={textareaRef}
                  className="ssis-expr-builder__textarea"
                  value={expression}
                  onChange={handleExpressionChange}
                  onKeyDown={handleKeyDown}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Enter SSIS expression..."
                />

                {/* Autocomplete dropdown */}
                {showAutocomplete && filteredAutocomplete.length > 0 && (
                  <div className="ssis-expr-ac" ref={autocompleteRef}>
                    {filteredAutocomplete.map((item, i) => (
                      <div
                        key={item.label + item.kind}
                        className={`ssis-expr-ac-item ${i === autocompleteIndex ? 'ssis-expr-ac-item--active' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); handleAutocompleteSelect(item); }}
                      >
                        <span className={`ssis-expr-ac-icon ssis-expr-ac-icon--${item.kind}`}>
                          {item.kind === 'function' ? 'ƒ' : item.kind === 'variable' ? 'x' : item.kind === 'column' ? '▦' : 'T'}
                        </span>
                        <span className="ssis-expr-ac-label">{item.label}</span>
                        <span className="ssis-expr-ac-detail">{item.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Validation / Preview */}
            <div className="ssis-expr-builder__preview">
              <div className="ssis-expr-builder__preview-header">
                <span>Validation</span>
                <span className="ssis-expr-builder__validation-badge">
                  {errorCount === 0 && warningCount === 0 && expression.trim().length > 0 && (
                    <span className="ssis-expr-builder__badge--ok">✓ Valid</span>
                  )}
                  {errorCount > 0 && (
                    <span className="ssis-expr-builder__badge--error">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
                  )}
                  {warningCount > 0 && (
                    <span className="ssis-expr-builder__badge--warning">{warningCount} warning{warningCount > 1 ? 's' : ''}</span>
                  )}
                </span>
              </div>
              <div className="ssis-expr-builder__preview-body">
                {validation.errors.length === 0 && expression.trim().length > 0 && (
                  <div className="ssis-expr-builder__preview-ok">
                    Expression syntax looks correct.
                    {usedVarRefs.length > 0 && (
                      <div className="ssis-expr-builder__preview-vars">
                        Referenced variables: {usedVarRefs.map(r => `@[${r}]`).join(', ')}
                      </div>
                    )}
                  </div>
                )}
                {validation.errors.length === 0 && expression.trim().length === 0 && (
                  <div className="ssis-expr-builder__preview-empty">Enter an expression above.</div>
                )}
                {validation.errors.map((err, i) => (
                  <div
                    key={i}
                    className={`ssis-expr-builder__error-item ssis-expr-builder__error-item--${err.severity}`}
                  >
                    <span className="ssis-expr-builder__error-icon">
                      {err.severity === 'error' ? '✕' : '⚠'}
                    </span>
                    <span className="ssis-expr-builder__error-msg">{err.message}</span>
                    <span className="ssis-expr-builder__error-pos">Ln {err.line}, Col {err.column}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Operators quick-insert toolbar */}
            <div className="ssis-expr-builder__operators">
              <div className="ssis-expr-builder__operators-label">Operators</div>
              <div className="ssis-expr-builder__operators-row">
                {SSIS_OPERATORS.map(op => (
                  <button
                    key={op.symbol}
                    className="ssis-expr-builder__op-btn"
                    title={op.description}
                    onClick={() => insertAtCursor(` ${op.symbol} `)}
                  >
                    {op.symbol}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExpressionBuilder;
