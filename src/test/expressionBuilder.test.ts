/**
 * Tests for Expression Builder internals — tokenizer, validator, function data.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, extractVariableRefs, extractFunctionCalls, Token } from '../canvas/expression/ExpressionTokenizer';
import { validateExpression } from '../canvas/expression/ExpressionValidator';
import { SSIS_FUNCTIONS, SSIS_FUNCTION_NAMES, SSIS_CAST_TYPES, SsisFunction } from '../canvas/expression/SsisFunctions';

// ---------------------------------------------------------------------------
// ExpressionTokenizer tests
// ---------------------------------------------------------------------------

describe('ExpressionTokenizer', () => {
  describe('basic tokenization', () => {
    it('should tokenize a simple number', () => {
      const tokens = tokenize('42');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('number');
      expect(meaningful[0].value).toBe('42');
    });

    it('should tokenize a decimal number', () => {
      const tokens = tokenize('3.14');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('number');
      expect(meaningful[0].value).toBe('3.14');
    });

    it('should tokenize a string literal', () => {
      const tokens = tokenize('"Hello World"');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('string');
      expect(meaningful[0].value).toBe('"Hello World"');
    });

    it('should tokenize a string with escape sequence', () => {
      const tokens = tokenize('"Hello \\"World\\""');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('string');
    });

    it('should tokenize operators', () => {
      const tokens = tokenize('1 + 2');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(3);
      expect(meaningful[0].type).toBe('number');
      expect(meaningful[1].type).toBe('operator');
      expect(meaningful[1].value).toBe('+');
      expect(meaningful[2].type).toBe('number');
    });

    it('should tokenize multi-char operators', () => {
      const tokens = tokenize('a == b && c != d');
      const ops = tokens.filter(t => t.type === 'operator');
      expect(ops).toHaveLength(2);
      expect(ops[0].value).toBe('==');
      expect(ops[1].value).toBe('!=');
    });

    it('should tokenize logical operators', () => {
      const tokens = tokenize('x || y');
      const ops = tokens.filter(t => t.type === 'operator');
      expect(ops).toHaveLength(1);
      expect(ops[0].value).toBe('||');
    });

    it('should tokenize parentheses', () => {
      const tokens = tokenize('(1 + 2)');
      const parens = tokens.filter(t => t.type === 'paren');
      expect(parens).toHaveLength(2);
      expect(parens[0].value).toBe('(');
      expect(parens[1].value).toBe(')');
    });

    it('should tokenize commas', () => {
      const tokens = tokenize('SUBSTRING("abc", 1, 2)');
      const commas = tokens.filter(t => t.type === 'comma');
      expect(commas).toHaveLength(2);
    });

    it('should tokenize ternary operator', () => {
      const tokens = tokenize('x > 0 ? "pos" : "neg"');
      const ternary = tokens.filter(t => t.type === 'ternary');
      expect(ternary).toHaveLength(2);
      expect(ternary[0].value).toBe('?');
      expect(ternary[1].value).toBe(':');
    });
  });

  describe('variable reference parsing', () => {
    it('should tokenize a User variable reference', () => {
      const tokens = tokenize('@[User::VarName]');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('variable');
      expect(meaningful[0].value).toBe('@[User::VarName]');
    });

    it('should tokenize a System variable reference', () => {
      const tokens = tokenize('@[System::PackageName]');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('variable');
      expect(meaningful[0].value).toBe('@[System::PackageName]');
    });

    it('should tokenize variables in an expression', () => {
      const tokens = tokenize('@[User::Count] + @[User::Offset]');
      const vars = tokens.filter(t => t.type === 'variable');
      expect(vars).toHaveLength(2);
      expect(vars[0].value).toBe('@[User::Count]');
      expect(vars[1].value).toBe('@[User::Offset]');
    });

    it('should extract variable references', () => {
      const refs = extractVariableRefs('@[User::Name] + " - " + @[System::PackageName]');
      expect(refs).toEqual(['User::Name', 'System::PackageName']);
    });
  });

  describe('cast expression parsing', () => {
    it('should tokenize a simple type cast', () => {
      const tokens = tokenize('(DT_WSTR, 50)');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('cast');
      expect(meaningful[0].value).toBe('(DT_WSTR, 50)');
    });

    it('should tokenize DT_I4 cast', () => {
      const tokens = tokenize('(DT_I4)');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('cast');
    });

    it('should tokenize cast with expression', () => {
      const tokens = tokenize('(DT_WSTR, 50) @[User::Count]');
      const casts = tokens.filter(t => t.type === 'cast');
      expect(casts).toHaveLength(1);
      const vars = tokens.filter(t => t.type === 'variable');
      expect(vars).toHaveLength(1);
    });

    it('should tokenize DT_NUMERIC cast with precision and scale', () => {
      const tokens = tokenize('(DT_NUMERIC, 10, 2)');
      const meaningful = tokens.filter(t => t.type !== 'whitespace');
      expect(meaningful).toHaveLength(1);
      expect(meaningful[0].type).toBe('cast');
      expect(meaningful[0].value).toBe('(DT_NUMERIC, 10, 2)');
    });
  });

  describe('function name recognition', () => {
    it('should recognize UPPER as a keyword', () => {
      const tokens = tokenize('UPPER("hello")');
      const keywords = tokens.filter(t => t.type === 'keyword');
      expect(keywords).toHaveLength(1);
      expect(keywords[0].value).toBe('UPPER');
    });

    it('should recognize GETDATE as a keyword', () => {
      const tokens = tokenize('GETDATE()');
      const keywords = tokens.filter(t => t.type === 'keyword');
      expect(keywords).toHaveLength(1);
      expect(keywords[0].value).toBe('GETDATE');
    });

    it('should recognize SUBSTRING as a keyword', () => {
      const tokens = tokenize('SUBSTRING("hello", 1, 3)');
      const keywords = tokens.filter(t => t.type === 'keyword');
      expect(keywords).toHaveLength(1);
      expect(keywords[0].value).toBe('SUBSTRING');
    });

    it('should not recognize unknown identifiers as keywords', () => {
      const tokens = tokenize('myVar + 1');
      const keywords = tokens.filter(t => t.type === 'keyword');
      expect(keywords).toHaveLength(0);
    });

    it('should extract function calls from expression', () => {
      const fns = extractFunctionCalls('UPPER(LEFT(@[User::Name], 5))');
      expect(fns).toContain('UPPER');
      expect(fns).toContain('LEFT');
    });
  });

  describe('complex expressions', () => {
    it('should tokenize a realistic SSIS expression', () => {
      const expr = '@[User::Count] > 0 ? UPPER(@[User::Name]) : "Unknown"';
      const tokens = tokenize(expr);
      const meaningful = tokens.filter(t => t.type !== 'whitespace');

      // @[User::Count] > 0 ? UPPER ( @[User::Name] ) : "Unknown"
      expect(meaningful.length).toBeGreaterThan(5);

      const vars = meaningful.filter(t => t.type === 'variable');
      expect(vars).toHaveLength(2);

      const keywords = meaningful.filter(t => t.type === 'keyword');
      expect(keywords).toHaveLength(1);
      expect(keywords[0].value).toBe('UPPER');
    });

    it('should track line and column numbers', () => {
      const tokens = tokenize('line1\nline2');
      const l1 = tokens.find(t => t.value === 'line1');
      const l2 = tokens.find(t => t.value === 'line2');
      expect(l1?.line).toBe(1);
      expect(l1?.column).toBe(1);
      expect(l2?.line).toBe(2);
      expect(l2?.column).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// ExpressionValidator tests
// ---------------------------------------------------------------------------

describe('ExpressionValidator', () => {
  it('should accept an empty expression', () => {
    const result = validateExpression('');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept a valid simple expression', () => {
    const result = validateExpression('@[User::Count] + 1');
    expect(result.valid).toBe(true);
  });

  it('should accept a valid function call', () => {
    const result = validateExpression('UPPER("hello")');
    expect(result.valid).toBe(true);
  });

  it('should detect unmatched opening parenthesis', () => {
    const result = validateExpression('UPPER("hello"');
    expect(result.valid).toBe(false);
    const parenErrors = result.errors.filter(e => e.message.includes('parenthesis'));
    expect(parenErrors.length).toBeGreaterThan(0);
  });

  it('should detect unmatched closing parenthesis', () => {
    const result = validateExpression('"hello")');
    expect(result.valid).toBe(false);
    const parenErrors = result.errors.filter(e => e.message.includes('parenthesis'));
    expect(parenErrors.length).toBeGreaterThan(0);
  });

  it('should detect unterminated string', () => {
    const result = validateExpression('"hello');
    expect(result.valid).toBe(false);
    const strErrors = result.errors.filter(e => e.message.includes('string'));
    expect(strErrors.length).toBeGreaterThan(0);
  });

  it('should detect unterminated variable reference', () => {
    const result = validateExpression('@[User::Name');
    expect(result.valid).toBe(false);
    const varErrors = result.errors.filter(e => e.message.includes('variable') || e.message.includes(']'));
    expect(varErrors.length).toBeGreaterThan(0);
  });

  it('should warn about variable reference without namespace separator', () => {
    const result = validateExpression('@[MyVar]');
    const warnings = result.errors.filter(e => e.severity === 'warning' && e.message.includes('Namespace'));
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should warn about unknown function names', () => {
    const result = validateExpression('NOTAFUNCTION("hello")');
    const warnings = result.errors.filter(e => e.message.includes('Unknown function'));
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should accept known function names without warning', () => {
    const result = validateExpression('LEN("hello")');
    const funcWarnings = result.errors.filter(e => e.message.includes('Unknown function'));
    expect(funcWarnings).toHaveLength(0);
  });

  it('should detect trailing operator', () => {
    const result = validateExpression('@[User::Count] +');
    expect(result.valid).toBe(false);
    const opErrors = result.errors.filter(e => e.message.includes('operator'));
    expect(opErrors.length).toBeGreaterThan(0);
  });

  it('should detect unmatched ternary ?', () => {
    const result = validateExpression('@[User::Count] > 0 ? "yes"');
    expect(result.valid).toBe(false);
    const ternaryErrors = result.errors.filter(e => e.message.includes('ternary') || e.message.includes(':'));
    expect(ternaryErrors.length).toBeGreaterThan(0);
  });

  it('should accept a complex valid expression', () => {
    const result = validateExpression(
      '@[User::Count] > 0 ? UPPER(SUBSTRING(@[User::Name], 1, 3)) : "N/A"'
    );
    expect(result.valid).toBe(true);
  });

  it('should provide position info for errors', () => {
    const result = validateExpression('UPPER("hello"');
    expect(result.errors.length).toBeGreaterThan(0);
    const err = result.errors[0];
    expect(err.line).toBeGreaterThanOrEqual(1);
    expect(err.column).toBeGreaterThanOrEqual(1);
    expect(err.start).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// SSIS_FUNCTIONS data integrity tests
// ---------------------------------------------------------------------------

describe('SSIS_FUNCTIONS', () => {
  it('should have all required fields for every function', () => {
    for (const fn of SSIS_FUNCTIONS) {
      expect(fn.name, `${fn.name} missing name`).toBeTruthy();
      expect(fn.category, `${fn.name} missing category`).toBeTruthy();
      expect(fn.signature, `${fn.name} missing signature`).toBeTruthy();
      expect(fn.description, `${fn.name} missing description`).toBeTruthy();
      expect(fn.example, `${fn.name} missing example`).toBeTruthy();
      expect(fn.returnType, `${fn.name} missing returnType`).toBeTruthy();
    }
  });

  it('should contain all string functions', () => {
    const names = SSIS_FUNCTIONS.filter(f => f.category === 'String').map(f => f.name);
    expect(names).toContain('UPPER');
    expect(names).toContain('LOWER');
    expect(names).toContain('LEN');
    expect(names).toContain('SUBSTRING');
    expect(names).toContain('REPLACE');
    expect(names).toContain('TRIM');
    expect(names).toContain('LTRIM');
    expect(names).toContain('RTRIM');
    expect(names).toContain('LEFT');
    expect(names).toContain('RIGHT');
    expect(names).toContain('REVERSE');
    expect(names).toContain('REPLICATE');
    expect(names).toContain('FINDSTRING');
    expect(names).toContain('TOKEN');
    expect(names).toContain('HEX');
    expect(names).toContain('CODEPOINT');
  });

  it('should contain all math functions', () => {
    const names = SSIS_FUNCTIONS.filter(f => f.category === 'Math').map(f => f.name);
    expect(names).toContain('ABS');
    expect(names).toContain('CEILING');
    expect(names).toContain('FLOOR');
    expect(names).toContain('ROUND');
    expect(names).toContain('POWER');
    expect(names).toContain('SQRT');
    expect(names).toContain('SQUARE');
    expect(names).toContain('EXP');
    expect(names).toContain('LN');
    expect(names).toContain('LOG');
    expect(names).toContain('SIGN');
  });

  it('should contain all date/time functions', () => {
    const names = SSIS_FUNCTIONS.filter(f => f.category === 'DateTime').map(f => f.name);
    expect(names).toContain('DATEADD');
    expect(names).toContain('DATEDIFF');
    expect(names).toContain('DATEPART');
    expect(names).toContain('DAY');
    expect(names).toContain('MONTH');
    expect(names).toContain('YEAR');
    expect(names).toContain('GETDATE');
    expect(names).toContain('GETUTCDATE');
  });

  it('should contain null functions', () => {
    const names = SSIS_FUNCTIONS.filter(f => f.category === 'Null').map(f => f.name);
    expect(names).toContain('ISNULL');
    expect(names).toContain('NULL');
    expect(names).toContain('REPLACENULL');
  });

  it('should contain type cast entries', () => {
    const casts = SSIS_FUNCTIONS.filter(f => f.category === 'TypeCast');
    expect(casts.length).toBeGreaterThanOrEqual(19); // At least 19 DT_ types
  });

  it('should have SSIS_FUNCTION_NAMES set match functions (excluding casts and ternary)', () => {
    const expectedFunctions = SSIS_FUNCTIONS
      .filter(f => f.category !== 'TypeCast' && f.category !== 'Conditional')
      .map(f => f.name.toUpperCase());
    for (const name of expectedFunctions) {
      expect(SSIS_FUNCTION_NAMES.has(name), `Missing function: ${name}`).toBe(true);
    }
  });

  it('should have SSIS_CAST_TYPES contain all cast type names', () => {
    expect(SSIS_CAST_TYPES.has('DT_WSTR')).toBe(true);
    expect(SSIS_CAST_TYPES.has('DT_I4')).toBe(true);
    expect(SSIS_CAST_TYPES.has('DT_BOOL')).toBe(true);
    expect(SSIS_CAST_TYPES.has('DT_DBTIMESTAMP')).toBe(true);
    expect(SSIS_CAST_TYPES.has('DT_NUMERIC')).toBe(true);
    expect(SSIS_CAST_TYPES.has('DT_R8')).toBe(true);
    expect(SSIS_CAST_TYPES.has('DT_BYTES')).toBe(true);
    expect(SSIS_CAST_TYPES.size).toBeGreaterThanOrEqual(19);
  });

  it('should have valid category values', () => {
    const validCategories: SsisFunction['category'][] = ['String', 'Math', 'DateTime', 'Null', 'TypeCast', 'Conditional'];
    for (const fn of SSIS_FUNCTIONS) {
      expect(validCategories).toContain(fn.category);
    }
  });
});
