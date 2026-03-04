/**
 * Custom tokenizer for SSIS expression language.
 * Produces tokens for syntax highlighting and basic validation.
 * Does NOT require external libraries — uses simple regex-based scanning.
 */

import { SSIS_FUNCTION_NAMES, SSIS_CAST_TYPES } from './SsisFunctions';

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type TokenType =
  | 'keyword'     // function names like UPPER, LEN, GETDATE
  | 'string'      // "..." string literals
  | 'number'      // numeric literals
  | 'variable'    // @[User::VarName] or @[System::PackageName]
  | 'operator'    // +, -, *, /, ==, !=, &&, ||, etc.
  | 'cast'        // (DT_WSTR, 50) type cast expressions
  | 'paren'       // ( or ) that are NOT part of a cast
  | 'bracket'     // [ or ]
  | 'comma'       // ,
  | 'whitespace'  // spaces, tabs, newlines
  | 'ternary'     // ? or :
  | 'unknown';    // unrecognized characters

export interface Token {
  type: TokenType;
  value: string;
  start: number;  // 0-based offset in source
  end: number;    // exclusive end offset
  line: number;   // 1-based line number
  column: number; // 1-based column number
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize an SSIS expression string into an array of tokens.
 * Handles @[Namespace::Variable] syntax, (DT_TYPE) casts,
 * string literals with \" escape sequences, and all SSIS operators.
 */
export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  while (pos < expression.length) {
    const ch = expression[pos];

    // -- Whitespace --------------------------------------------------------
    if (/\s/.test(ch)) {
      const start = pos;
      const startLine = line;
      const startCol = column;
      while (pos < expression.length && /\s/.test(expression[pos])) {
        if (expression[pos] === '\n') {
          line++;
          column = 1;
        } else {
          column++;
        }
        pos++;
      }
      tokens.push({
        type: 'whitespace',
        value: expression.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // -- Variable: @[Namespace::VarName] -----------------------------------
    if (ch === '@' && pos + 1 < expression.length && expression[pos + 1] === '[') {
      const start = pos;
      const startLine = line;
      const startCol = column;
      pos += 2; // skip @[
      column += 2;
      while (pos < expression.length && expression[pos] !== ']') {
        if (expression[pos] === '\n') { line++; column = 1; } else { column++; }
        pos++;
      }
      if (pos < expression.length) {
        pos++; // skip ]
        column++;
      }
      tokens.push({
        type: 'variable',
        value: expression.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // -- String literal: "..." with \" escape ------------------------------
    if (ch === '"') {
      const start = pos;
      const startLine = line;
      const startCol = column;
      pos++; // skip opening quote
      column++;
      while (pos < expression.length) {
        if (expression[pos] === '\\' && pos + 1 < expression.length) {
          pos += 2; // skip escaped char
          column += 2;
        } else if (expression[pos] === '"') {
          pos++;
          column++;
          break;
        } else {
          if (expression[pos] === '\n') { line++; column = 1; } else { column++; }
          pos++;
        }
      }
      tokens.push({
        type: 'string',
        value: expression.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // -- Cast type: (DT_XXXX) or (DT_XXXX, ...) --------------------------
    if (ch === '(') {
      // Look ahead for (DT_ pattern
      const castMatch = expression.slice(pos).match(/^\(\s*(DT_[A-Z0-9]+)(?:\s*,\s*[^)]+)?\s*\)/i);
      if (castMatch) {
        const castTypeName = castMatch[1].toUpperCase();
        if (SSIS_CAST_TYPES.has(castTypeName)) {
          const start = pos;
          const startLine = line;
          const startCol = column;
          const len = castMatch[0].length;
          pos += len;
          column += len;
          tokens.push({
            type: 'cast',
            value: castMatch[0],
            start,
            end: pos,
            line: startLine,
            column: startCol,
          });
          continue;
        }
      }

      // Regular parenthesis
      tokens.push({
        type: 'paren',
        value: '(',
        start: pos,
        end: pos + 1,
        line,
        column,
      });
      pos++;
      column++;
      continue;
    }

    if (ch === ')') {
      tokens.push({
        type: 'paren',
        value: ')',
        start: pos,
        end: pos + 1,
        line,
        column,
      });
      pos++;
      column++;
      continue;
    }

    // -- Brackets ---------------------------------------------------------
    if (ch === '[' || ch === ']') {
      tokens.push({
        type: 'bracket',
        value: ch,
        start: pos,
        end: pos + 1,
        line,
        column,
      });
      pos++;
      column++;
      continue;
    }

    // -- Comma ------------------------------------------------------------
    if (ch === ',') {
      tokens.push({
        type: 'comma',
        value: ',',
        start: pos,
        end: pos + 1,
        line,
        column,
      });
      pos++;
      column++;
      continue;
    }

    // -- Ternary: ? and : -------------------------------------------------
    if (ch === '?') {
      tokens.push({
        type: 'ternary',
        value: '?',
        start: pos,
        end: pos + 1,
        line,
        column,
      });
      pos++;
      column++;
      continue;
    }

    if (ch === ':') {
      // Could be part of :: in a variable reference (shouldn't appear standalone)
      // but if inside @[...] it's already consumed
      tokens.push({
        type: 'ternary',
        value: ':',
        start: pos,
        end: pos + 1,
        line,
        column,
      });
      pos++;
      column++;
      continue;
    }

    // -- Multi-char operators: ==, !=, >=, <=, &&, ||, <<, >> -------------
    const twoChar = expression.slice(pos, pos + 2);
    if (['==', '!=', '>=', '<=', '&&', '||', '<<', '>>'].includes(twoChar)) {
      tokens.push({
        type: 'operator',
        value: twoChar,
        start: pos,
        end: pos + 2,
        line,
        column,
      });
      pos += 2;
      column += 2;
      continue;
    }

    // -- Single-char operators: + - * / % > < ! & | ^ ~ ------------------
    if (['+', '-', '*', '/', '%', '>', '<', '!', '&', '|', '^', '~'].includes(ch)) {
      tokens.push({
        type: 'operator',
        value: ch,
        start: pos,
        end: pos + 1,
        line,
        column,
      });
      pos++;
      column++;
      continue;
    }

    // -- Numbers: integer and decimal -------------------------------------
    if (/[0-9]/.test(ch) || (ch === '.' && pos + 1 < expression.length && /[0-9]/.test(expression[pos + 1]))) {
      const start = pos;
      const startLine = line;
      const startCol = column;
      // Integer part
      while (pos < expression.length && /[0-9]/.test(expression[pos])) {
        pos++;
        column++;
      }
      // Decimal part
      if (pos < expression.length && expression[pos] === '.' && pos + 1 < expression.length && /[0-9]/.test(expression[pos + 1])) {
        pos++; column++; // skip .
        while (pos < expression.length && /[0-9]/.test(expression[pos])) {
          pos++;
          column++;
        }
      }
      tokens.push({
        type: 'number',
        value: expression.slice(start, pos),
        start,
        end: pos,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // -- Identifiers (function names, keywords) ---------------------------
    if (/[A-Za-z_]/.test(ch)) {
      const start = pos;
      const startLine = line;
      const startCol = column;
      while (pos < expression.length && /[A-Za-z0-9_]/.test(expression[pos])) {
        pos++;
        column++;
      }
      const word = expression.slice(start, pos);
      const isFunction = SSIS_FUNCTION_NAMES.has(word.toUpperCase());
      tokens.push({
        type: isFunction ? 'keyword' : 'unknown',
        value: word,
        start,
        end: pos,
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // -- Unknown character ------------------------------------------------
    tokens.push({
      type: 'unknown',
      value: ch,
      start: pos,
      end: pos + 1,
      line,
      column,
    });
    pos++;
    column++;
  }

  return tokens;
}

/**
 * Extract variable references from an expression string.
 * Returns the variable names in @[Namespace::VarName] format.
 */
export function extractVariableRefs(expression: string): string[] {
  const regex = /@\[([^\]]+)\]/g;
  const refs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(expression)) !== null) {
    refs.push(match[1]); // e.g., "User::VarName"
  }
  return refs;
}

/**
 * Extract function calls from an expression string.
 * Returns function names found in the expression.
 */
export function extractFunctionCalls(expression: string): string[] {
  const tokens = tokenize(expression);
  return tokens
    .filter(t => t.type === 'keyword')
    .map(t => t.value.toUpperCase());
}
