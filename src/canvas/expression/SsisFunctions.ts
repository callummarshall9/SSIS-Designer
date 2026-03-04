/**
 * Complete SSIS expression function reference data.
 * Used by the Expression Builder for autocomplete, reference panel, and validation.
 */

export interface SsisFunction {
  name: string;
  category: 'String' | 'Math' | 'DateTime' | 'Null' | 'TypeCast' | 'Conditional';
  signature: string;
  description: string;
  example: string;
  returnType: string;
}

export const SSIS_FUNCTIONS: SsisFunction[] = [
  // ---------------------------------------------------------------------------
  // String Functions
  // ---------------------------------------------------------------------------
  {
    name: 'CODEPOINT',
    category: 'String',
    signature: 'CODEPOINT(character_expression)',
    description: 'Returns the Unicode code point value of the leftmost character of a character expression.',
    example: 'CODEPOINT("A") → 65',
    returnType: 'DT_UI4',
  },
  {
    name: 'FINDSTRING',
    category: 'String',
    signature: 'FINDSTRING(character_expression, searchstring, occurrence)',
    description: 'Returns the one-based index of the specified occurrence of a search string within an expression.',
    example: 'FINDSTRING("New York, New York", "New", 2) → 11',
    returnType: 'DT_I4',
  },
  {
    name: 'HEX',
    category: 'String',
    signature: 'HEX(integer_expression)',
    description: 'Returns a string representing the hexadecimal value of an integer.',
    example: 'HEX(255) → "FF"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'LEFT',
    category: 'String',
    signature: 'LEFT(character_expression, number)',
    description: 'Returns the specified number of characters from the leftmost part of the given character expression.',
    example: 'LEFT("Hello World", 5) → "Hello"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'LEN',
    category: 'String',
    signature: 'LEN(character_expression)',
    description: 'Returns the number of characters in a character expression.',
    example: 'LEN("Hello") → 5',
    returnType: 'DT_I4',
  },
  {
    name: 'LOWER',
    category: 'String',
    signature: 'LOWER(character_expression)',
    description: 'Returns a character expression after converting uppercase characters to lowercase.',
    example: 'LOWER("HELLO") → "hello"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'LTRIM',
    category: 'String',
    signature: 'LTRIM(character_expression)',
    description: 'Returns a character expression after removing leading spaces.',
    example: 'LTRIM("  Hello") → "Hello"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'REPLACE',
    category: 'String',
    signature: 'REPLACE(character_expression1, character_expression2, character_expression3)',
    description: 'Returns a character expression after replacing a string within the expression with either a different string or an empty string.',
    example: 'REPLACE("Hello World", "World", "SSIS") → "Hello SSIS"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'REPLICATE',
    category: 'String',
    signature: 'REPLICATE(character_expression, times)',
    description: 'Returns a character expression that is replicated a specified number of times.',
    example: 'REPLICATE("ab", 3) → "ababab"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'REVERSE',
    category: 'String',
    signature: 'REVERSE(character_expression)',
    description: 'Returns a character expression in reverse order.',
    example: 'REVERSE("Hello") → "olleH"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'RIGHT',
    category: 'String',
    signature: 'RIGHT(character_expression, number)',
    description: 'Returns the specified number of characters from the rightmost part of the given character expression.',
    example: 'RIGHT("Hello World", 5) → "World"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'RTRIM',
    category: 'String',
    signature: 'RTRIM(character_expression)',
    description: 'Returns a character expression after removing trailing spaces.',
    example: 'RTRIM("Hello  ") → "Hello"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'SUBSTRING',
    category: 'String',
    signature: 'SUBSTRING(character_expression, position, length)',
    description: 'Returns a part of a character expression. Position is one-based.',
    example: 'SUBSTRING("Hello World", 7, 5) → "World"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'TOKEN',
    category: 'String',
    signature: 'TOKEN(character_expression, delimiter_string, occurrence)',
    description: 'Returns a token (substring) from a string based on the specified delimiters and token number.',
    example: 'TOKEN("a|b|c", "|", 2) → "b"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'TRIM',
    category: 'String',
    signature: 'TRIM(character_expression)',
    description: 'Returns a character expression after removing leading and trailing spaces.',
    example: 'TRIM("  Hello  ") → "Hello"',
    returnType: 'DT_WSTR',
  },
  {
    name: 'UPPER',
    category: 'String',
    signature: 'UPPER(character_expression)',
    description: 'Returns a character expression after converting lowercase characters to uppercase.',
    example: 'UPPER("hello") → "HELLO"',
    returnType: 'DT_WSTR',
  },

  // ---------------------------------------------------------------------------
  // Math Functions
  // ---------------------------------------------------------------------------
  {
    name: 'ABS',
    category: 'Math',
    signature: 'ABS(numeric_expression)',
    description: 'Returns the absolute, positive value of a numeric expression.',
    example: 'ABS(-5) → 5',
    returnType: 'Matches input type',
  },
  {
    name: 'CEILING',
    category: 'Math',
    signature: 'CEILING(numeric_expression)',
    description: 'Returns the smallest integer that is greater than or equal to a numeric expression.',
    example: 'CEILING(2.3) → 3',
    returnType: 'Matches input type',
  },
  {
    name: 'EXP',
    category: 'Math',
    signature: 'EXP(numeric_expression)',
    description: 'Returns the exponent to base e of the specified expression.',
    example: 'EXP(1) → 2.71828...',
    returnType: 'DT_R8',
  },
  {
    name: 'FLOOR',
    category: 'Math',
    signature: 'FLOOR(numeric_expression)',
    description: 'Returns the largest integer that is less than or equal to a numeric expression.',
    example: 'FLOOR(2.7) → 2',
    returnType: 'Matches input type',
  },
  {
    name: 'LN',
    category: 'Math',
    signature: 'LN(numeric_expression)',
    description: 'Returns the natural logarithm of a numeric expression.',
    example: 'LN(10) → 2.302585...',
    returnType: 'DT_R8',
  },
  {
    name: 'LOG',
    category: 'Math',
    signature: 'LOG(numeric_expression)',
    description: 'Returns the base-10 logarithm of a numeric expression.',
    example: 'LOG(100) → 2',
    returnType: 'DT_R8',
  },
  {
    name: 'POWER',
    category: 'Math',
    signature: 'POWER(numeric_expression, power)',
    description: 'Returns the result of raising a numeric expression to a power.',
    example: 'POWER(2, 10) → 1024',
    returnType: 'DT_R8',
  },
  {
    name: 'ROUND',
    category: 'Math',
    signature: 'ROUND(numeric_expression, length)',
    description: 'Returns a numeric expression that is rounded to the specified length or precision.',
    example: 'ROUND(3.14159, 2) → 3.14',
    returnType: 'Matches input type',
  },
  {
    name: 'SIGN',
    category: 'Math',
    signature: 'SIGN(numeric_expression)',
    description: 'Returns the positive (+1), zero (0), or negative (-1) sign of a numeric expression.',
    example: 'SIGN(-42) → -1',
    returnType: 'DT_I4',
  },
  {
    name: 'SQUARE',
    category: 'Math',
    signature: 'SQUARE(numeric_expression)',
    description: 'Returns the square of a numeric expression.',
    example: 'SQUARE(5) → 25',
    returnType: 'DT_R8',
  },
  {
    name: 'SQRT',
    category: 'Math',
    signature: 'SQRT(numeric_expression)',
    description: 'Returns the square root of a numeric expression.',
    example: 'SQRT(25) → 5',
    returnType: 'DT_R8',
  },

  // ---------------------------------------------------------------------------
  // Date/Time Functions
  // ---------------------------------------------------------------------------
  {
    name: 'DATEADD',
    category: 'DateTime',
    signature: 'DATEADD(datepart, number, date)',
    description: 'Returns a new date value by adding an interval to the specified datepart of a date. Datepart can be "Year", "Month", "Day", "Hour", "Minute", "Second", "Millisecond".',
    example: 'DATEADD("Month", 1, GETDATE())',
    returnType: 'DT_DBTIMESTAMP',
  },
  {
    name: 'DATEDIFF',
    category: 'DateTime',
    signature: 'DATEDIFF(datepart, startdate, enddate)',
    description: 'Returns the number of date and time boundaries crossed between two specified dates.',
    example: 'DATEDIFF("Day", (DT_DBTIMESTAMP)"2024-01-01", GETDATE())',
    returnType: 'DT_I4',
  },
  {
    name: 'DATEPART',
    category: 'DateTime',
    signature: 'DATEPART(datepart, date)',
    description: 'Returns an integer representing a datepart of a date.',
    example: 'DATEPART("Month", GETDATE())',
    returnType: 'DT_I4',
  },
  {
    name: 'DAY',
    category: 'DateTime',
    signature: 'DAY(date)',
    description: 'Returns an integer that represents the day datepart of the specified date.',
    example: 'DAY(GETDATE())',
    returnType: 'DT_I4',
  },
  {
    name: 'GETDATE',
    category: 'DateTime',
    signature: 'GETDATE()',
    description: 'Returns the current date and time of the system.',
    example: 'GETDATE()',
    returnType: 'DT_DBTIMESTAMP',
  },
  {
    name: 'GETUTCDATE',
    category: 'DateTime',
    signature: 'GETUTCDATE()',
    description: 'Returns the current UTC date and time of the system.',
    example: 'GETUTCDATE()',
    returnType: 'DT_DBTIMESTAMP',
  },
  {
    name: 'MONTH',
    category: 'DateTime',
    signature: 'MONTH(date)',
    description: 'Returns an integer that represents the month datepart of the specified date.',
    example: 'MONTH(GETDATE())',
    returnType: 'DT_I4',
  },
  {
    name: 'YEAR',
    category: 'DateTime',
    signature: 'YEAR(date)',
    description: 'Returns an integer that represents the year datepart of the specified date.',
    example: 'YEAR(GETDATE())',
    returnType: 'DT_I4',
  },

  // ---------------------------------------------------------------------------
  // NULL Functions
  // ---------------------------------------------------------------------------
  {
    name: 'ISNULL',
    category: 'Null',
    signature: 'ISNULL(expression)',
    description: 'Returns a Boolean result based on whether an expression is null.',
    example: 'ISNULL(@[User::MyVar]) ? "null" : "not null"',
    returnType: 'DT_BOOL',
  },
  {
    name: 'NULL',
    category: 'Null',
    signature: 'NULL(type)',
    description: 'Returns a null value of a requested data type.',
    example: 'NULL(DT_WSTR, 50)',
    returnType: 'Specified type',
  },
  {
    name: 'REPLACENULL',
    category: 'Null',
    signature: 'REPLACENULL(expression, replacement_expression)',
    description: 'Returns the value of the second expression parameter if the first expression parameter is NULL.',
    example: 'REPLACENULL(@[User::Name], "Unknown")',
    returnType: 'Matches input type',
  },

  // ---------------------------------------------------------------------------
  // Type Cast Expressions
  // ---------------------------------------------------------------------------
  {
    name: '(DT_BOOL)',
    category: 'TypeCast',
    signature: '(DT_BOOL) expression',
    description: 'Casts an expression to a Boolean data type.',
    example: '(DT_BOOL) 1',
    returnType: 'DT_BOOL',
  },
  {
    name: '(DT_BYTES)',
    category: 'TypeCast',
    signature: '(DT_BYTES, length) expression',
    description: 'Casts an expression to a byte array with the specified length.',
    example: '(DT_BYTES, 16) @[User::GuidVal]',
    returnType: 'DT_BYTES',
  },
  {
    name: '(DT_DATE)',
    category: 'TypeCast',
    signature: '(DT_DATE) expression',
    description: 'Casts an expression to a date data type (DT_DATE uses floating point).',
    example: '(DT_DATE) "2024-01-15"',
    returnType: 'DT_DATE',
  },
  {
    name: '(DT_DBDATE)',
    category: 'TypeCast',
    signature: '(DT_DBDATE) expression',
    description: 'Casts an expression to a database date type (date only, no time).',
    example: '(DT_DBDATE) GETDATE()',
    returnType: 'DT_DBDATE',
  },
  {
    name: '(DT_DBTIME)',
    category: 'TypeCast',
    signature: '(DT_DBTIME) expression',
    description: 'Casts an expression to a database time type (time only, no date).',
    example: '(DT_DBTIME) GETDATE()',
    returnType: 'DT_DBTIME',
  },
  {
    name: '(DT_DBTIMESTAMP)',
    category: 'TypeCast',
    signature: '(DT_DBTIMESTAMP) expression',
    description: 'Casts an expression to a database timestamp (date and time).',
    example: '(DT_DBTIMESTAMP) "2024-01-15 14:30:00"',
    returnType: 'DT_DBTIMESTAMP',
  },
  {
    name: '(DT_DECIMAL)',
    category: 'TypeCast',
    signature: '(DT_DECIMAL, scale) expression',
    description: 'Casts an expression to a decimal data type with the specified scale.',
    example: '(DT_DECIMAL, 2) 3.14159',
    returnType: 'DT_DECIMAL',
  },
  {
    name: '(DT_I1)',
    category: 'TypeCast',
    signature: '(DT_I1) expression',
    description: 'Casts an expression to a one-byte signed integer.',
    example: '(DT_I1) 42',
    returnType: 'DT_I1',
  },
  {
    name: '(DT_I2)',
    category: 'TypeCast',
    signature: '(DT_I2) expression',
    description: 'Casts an expression to a two-byte signed integer.',
    example: '(DT_I2) 1000',
    returnType: 'DT_I2',
  },
  {
    name: '(DT_I4)',
    category: 'TypeCast',
    signature: '(DT_I4) expression',
    description: 'Casts an expression to a four-byte signed integer.',
    example: '(DT_I4) @[User::StringCount]',
    returnType: 'DT_I4',
  },
  {
    name: '(DT_I8)',
    category: 'TypeCast',
    signature: '(DT_I8) expression',
    description: 'Casts an expression to an eight-byte signed integer.',
    example: '(DT_I8) 9999999999',
    returnType: 'DT_I8',
  },
  {
    name: '(DT_NUMERIC)',
    category: 'TypeCast',
    signature: '(DT_NUMERIC, precision, scale) expression',
    description: 'Casts an expression to a numeric data type with the specified precision and scale.',
    example: '(DT_NUMERIC, 10, 2) 12345.678',
    returnType: 'DT_NUMERIC',
  },
  {
    name: '(DT_R4)',
    category: 'TypeCast',
    signature: '(DT_R4) expression',
    description: 'Casts an expression to a single-precision floating-point value.',
    example: '(DT_R4) 3.14',
    returnType: 'DT_R4',
  },
  {
    name: '(DT_R8)',
    category: 'TypeCast',
    signature: '(DT_R8) expression',
    description: 'Casts an expression to a double-precision floating-point value.',
    example: '(DT_R8) 3.14159265',
    returnType: 'DT_R8',
  },
  {
    name: '(DT_STR)',
    category: 'TypeCast',
    signature: '(DT_STR, length, code_page) expression',
    description: 'Casts an expression to an ANSI string with the specified length and code page.',
    example: '(DT_STR, 50, 1252) @[User::UnicodeVal]',
    returnType: 'DT_STR',
  },
  {
    name: '(DT_UI1)',
    category: 'TypeCast',
    signature: '(DT_UI1) expression',
    description: 'Casts an expression to a one-byte unsigned integer.',
    example: '(DT_UI1) 200',
    returnType: 'DT_UI1',
  },
  {
    name: '(DT_UI2)',
    category: 'TypeCast',
    signature: '(DT_UI2) expression',
    description: 'Casts an expression to a two-byte unsigned integer.',
    example: '(DT_UI2) 50000',
    returnType: 'DT_UI2',
  },
  {
    name: '(DT_UI4)',
    category: 'TypeCast',
    signature: '(DT_UI4) expression',
    description: 'Casts an expression to a four-byte unsigned integer.',
    example: '(DT_UI4) @[User::Count]',
    returnType: 'DT_UI4',
  },
  {
    name: '(DT_UI8)',
    category: 'TypeCast',
    signature: '(DT_UI8) expression',
    description: 'Casts an expression to an eight-byte unsigned integer.',
    example: '(DT_UI8) 18446744073709551615',
    returnType: 'DT_UI8',
  },
  {
    name: '(DT_WSTR)',
    category: 'TypeCast',
    signature: '(DT_WSTR, length) expression',
    description: 'Casts an expression to a Unicode string with the specified length.',
    example: '(DT_WSTR, 100) @[User::IntVal]',
    returnType: 'DT_WSTR',
  },

  // ---------------------------------------------------------------------------
  // Conditional
  // ---------------------------------------------------------------------------
  {
    name: '? :',
    category: 'Conditional',
    signature: 'boolean_expression ? expression_if_true : expression_if_false',
    description: 'Returns one of two expressions based on the evaluation of a Boolean expression (ternary operator).',
    example: '@[User::Count] > 0 ? "Has data" : "Empty"',
    returnType: 'Depends on branch types',
  },
];

/** Valid SSIS function names for validation (excludes type casts and ternary) */
export const SSIS_FUNCTION_NAMES: Set<string> = new Set(
  SSIS_FUNCTIONS
    .filter(f => f.category !== 'TypeCast' && f.category !== 'Conditional')
    .map(f => f.name.toUpperCase())
);

/** Valid SSIS cast type names */
export const SSIS_CAST_TYPES: Set<string> = new Set([
  'DT_BOOL', 'DT_BYTES', 'DT_DATE', 'DT_DBDATE', 'DT_DBTIME',
  'DT_DBTIMESTAMP', 'DT_DECIMAL', 'DT_I1', 'DT_I2', 'DT_I4',
  'DT_I8', 'DT_NUMERIC', 'DT_R4', 'DT_R8', 'DT_STR', 'DT_UI1',
  'DT_UI2', 'DT_UI4', 'DT_UI8', 'DT_WSTR',
]);

/** Get functions by category */
export function getFunctionsByCategory(category: SsisFunction['category']): SsisFunction[] {
  return SSIS_FUNCTIONS.filter(f => f.category === category);
}

/** All categories in display order */
export const FUNCTION_CATEGORIES: SsisFunction['category'][] = [
  'String', 'Math', 'DateTime', 'Null', 'TypeCast', 'Conditional',
];

/** SSIS expression operators */
export const SSIS_OPERATORS = [
  { symbol: '+', description: 'Add / String concatenate' },
  { symbol: '-', description: 'Subtract / Negate' },
  { symbol: '*', description: 'Multiply' },
  { symbol: '/', description: 'Divide' },
  { symbol: '%', description: 'Modulo' },
  { symbol: '==', description: 'Equal' },
  { symbol: '!=', description: 'Not equal' },
  { symbol: '>', description: 'Greater than' },
  { symbol: '<', description: 'Less than' },
  { symbol: '>=', description: 'Greater than or equal' },
  { symbol: '<=', description: 'Less than or equal' },
  { symbol: '&&', description: 'Logical AND' },
  { symbol: '||', description: 'Logical OR' },
  { symbol: '!', description: 'Logical NOT' },
  { symbol: '&', description: 'Bitwise AND' },
  { symbol: '|', description: 'Bitwise OR' },
  { symbol: '^', description: 'Bitwise XOR' },
  { symbol: '~', description: 'Bitwise NOT' },
  { symbol: '<<', description: 'Left shift' },
  { symbol: '>>', description: 'Right shift' },
];
