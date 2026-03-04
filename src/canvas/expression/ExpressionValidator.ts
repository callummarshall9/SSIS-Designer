/**
 * Basic SSIS expression validator.
 *
 * Provides useful feedback without being a full expression parser:
 *  - Balanced parentheses and brackets
 *  - Valid function name references
 *  - Valid variable reference format: @[Namespace::Name]
 *  - Unterminated strings
 *  - Empty expression check
 */

import { tokenize, Token } from './ExpressionTokenizer';
import { SSIS_FUNCTION_NAMES } from './SsisFunctions';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export interface ValidationError {
  message: string;
  line: number;    // 1-based
  column: number;  // 1-based
  start: number;   // 0-based offset
  end: number;     // exclusive offset
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an SSIS expression and return errors with position info.
 */
export function validateExpression(expression: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!expression || expression.trim().length === 0) {
    return { valid: true, errors: [] }; // empty is valid (means "no expression")
  }

  const tokens = tokenize(expression);

  // 1. Check balanced parentheses
  checkBalancedParens(tokens, errors);

  // 2. Check unterminated strings
  checkUnterminatedStrings(expression, errors);

  // 3. Check variable reference format
  checkVariableRefs(expression, errors);

  // 4. Check function names
  checkFunctionNames(tokens, errors);

  // 5. Check for trailing/leading operators (basic)
  checkDanglingOperators(tokens, errors);

  return {
    valid: errors.filter(e => e.severity === 'error').length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkBalancedParens(tokens: Token[], errors: ValidationError[]): void {
  const stack: Token[] = [];

  for (const token of tokens) {
    if (token.type === 'paren' && token.value === '(') {
      stack.push(token);
    } else if (token.type === 'paren' && token.value === ')') {
      if (stack.length === 0) {
        errors.push({
          message: 'Unmatched closing parenthesis.',
          line: token.line,
          column: token.column,
          start: token.start,
          end: token.end,
          severity: 'error',
        });
      } else {
        stack.pop();
      }
    }
  }

  for (const unmatched of stack) {
    errors.push({
      message: 'Unmatched opening parenthesis.',
      line: unmatched.line,
      column: unmatched.column,
      start: unmatched.start,
      end: unmatched.end,
      severity: 'error',
    });
  }
}

function checkUnterminatedStrings(expression: string, errors: ValidationError[]): void {
  let inString = false;
  let stringStartPos = 0;
  let line = 1;
  let column = 1;
  let stringStartLine = 1;
  let stringStartCol = 1;

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (ch === '\n') { line++; column = 1; continue; }

    if (!inString && ch === '"') {
      inString = true;
      stringStartPos = i;
      stringStartLine = line;
      stringStartCol = column;
    } else if (inString) {
      if (ch === '\\' && i + 1 < expression.length) {
        i++; column++; // skip escaped char
      } else if (ch === '"') {
        inString = false;
      }
    }
    column++;
  }

  if (inString) {
    errors.push({
      message: 'Unterminated string literal.',
      line: stringStartLine,
      column: stringStartCol,
      start: stringStartPos,
      end: expression.length,
      severity: 'error',
    });
  }
}

function checkVariableRefs(expression: string, errors: ValidationError[]): void {
  // Find all @[ sequences and validate they close with ]
  const varRefRegex = /@\[/g;
  let match: RegExpExecArray | null;

  while ((match = varRefRegex.exec(expression)) !== null) {
    const start = match.index;
    const closeBracket = expression.indexOf(']', start + 2);

    if (closeBracket === -1) {
      const { line, column } = getLineCol(expression, start);
      errors.push({
        message: 'Unterminated variable reference. Expected closing ].',
        line,
        column,
        start,
        end: expression.length,
        severity: 'error',
      });
      continue;
    }

    const content = expression.slice(start + 2, closeBracket);
    // Check format: should contain :: separator
    if (!content.includes('::')) {
      const { line, column } = getLineCol(expression, start);
      errors.push({
        message: `Variable reference "@[${content}]" should use Namespace::Name format (e.g., @[User::VarName]).`,
        line,
        column,
        start,
        end: closeBracket + 1,
        severity: 'warning',
      });
    }
  }
}

function checkFunctionNames(tokens: Token[], errors: ValidationError[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // An unknown identifier followed by '(' is likely an invalid function call
    if (token.type === 'unknown' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(token.value)) {
      // Look for following '(' (skip whitespace)
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === 'whitespace') { j++; }
      if (j < tokens.length && tokens[j].type === 'paren' && tokens[j].value === '(') {
        const upperName = token.value.toUpperCase();
        if (!SSIS_FUNCTION_NAMES.has(upperName)) {
          errors.push({
            message: `Unknown function "${token.value}". Did you mean one of the SSIS expression functions?`,
            line: token.line,
            column: token.column,
            start: token.start,
            end: token.end,
            severity: 'warning',
          });
        }
      }
    }
  }
}

function checkDanglingOperators(tokens: Token[], errors: ValidationError[]): void {
  // Filter out whitespace tokens
  const meaningful = tokens.filter(t => t.type !== 'whitespace');

  if (meaningful.length === 0) { return; }

  // Check if expression ends with a binary operator
  const last = meaningful[meaningful.length - 1];
  const binaryOps = ['+', '-', '*', '/', '%', '==', '!=', '>', '<', '>=', '<=', '&&', '||', '&', '|', '^', '<<', '>>'];
  if (last.type === 'operator' && binaryOps.includes(last.value)) {
    errors.push({
      message: `Expression ends with operator "${last.value}". Expected an operand.`,
      line: last.line,
      column: last.column,
      start: last.start,
      end: last.end,
      severity: 'error',
    });
  }

  // Check if ternary ? is present without :
  const qCount = meaningful.filter(t => t.type === 'ternary' && t.value === '?').length;
  const cCount = meaningful.filter(t => t.type === 'ternary' && t.value === ':').length;
  if (qCount > cCount) {
    const lastQ = [...meaningful].reverse().find(t => t.type === 'ternary' && t.value === '?');
    if (lastQ) {
      errors.push({
        message: 'Ternary operator ? is missing the : branch.',
        line: lastQ.line,
        column: lastQ.column,
        start: lastQ.start,
        end: lastQ.end,
        severity: 'error',
      });
    }
  } else if (cCount > qCount) {
    const lastC = [...meaningful].reverse().find(t => t.type === 'ternary' && t.value === ':');
    if (lastC) {
      errors.push({
        message: 'Found : without matching ternary ? operator.',
        line: lastC.line,
        column: lastC.column,
        start: lastC.start,
        end: lastC.end,
        severity: 'error',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
