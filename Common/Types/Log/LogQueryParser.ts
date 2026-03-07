/**
 * LogQueryParser
 *
 * Parses a Datadog-style log search query string into structured filter tokens.
 *
 * Supported syntax:
 *   - Free text:           `connection refused`       → body ILIKE '%connection refused%'
 *   - Quoted phrase:       `"connection refused"`     → body ILIKE '%connection refused%'
 *   - Field-specific:      `severity:error`           → severityText = 'error'
 *   - Attribute access:    `@http.status_code:500`    → attributes.http.status_code = '500'
 *   - Negation (prefix):   `-severity:debug`          → severityText != 'debug'
 *   - Wildcard:            `service:api-*`            → serviceId ILIKE 'api-%'
 *   - Numeric range:       `@duration:>1000`          → attributes.duration > 1000
 *   - Boolean:             `severity:error AND service:api` (AND is default between tokens)
 *
 * Produces an array of ParsedToken objects consumed by the search bar and query builder.
 */

export enum TokenType {
  FreeText = "FreeText",
  FieldFilter = "FieldFilter",
  AttributeFilter = "AttributeFilter",
}

export enum FilterOperator {
  Equals = "Equals",
  NotEquals = "NotEquals",
  Contains = "Contains",
  NotContains = "NotContains",
  GreaterThan = "GreaterThan",
  GreaterThanOrEqual = "GreaterThanOrEqual",
  LessThan = "LessThan",
  LessThanOrEqual = "LessThanOrEqual",
  Wildcard = "Wildcard",
}

export interface ParsedToken {
  type: TokenType;
  field?: string;
  operator: FilterOperator;
  value: string;
  negated: boolean;
  raw: string;
}

const FIELD_ALIASES: Record<string, string> = {
  severity: "severityText",
  level: "severityText",
  service: "serviceId",
  trace: "traceId",
  span: "spanId",
  message: "body",
  msg: "body",
  log: "body",
};

const BOOLEAN_KEYWORDS: Set<string> = new Set(["AND", "OR", "NOT"]);

function resolveFieldName(raw: string): string {
  const lower: string = raw.toLowerCase();
  return FIELD_ALIASES[lower] || raw;
}

function detectOperator(value: string): {
  operator: FilterOperator;
  cleanValue: string;
} {
  if (value.startsWith(">=")) {
    return {
      operator: FilterOperator.GreaterThanOrEqual,
      cleanValue: value.slice(2),
    };
  }

  if (value.startsWith("<=")) {
    return {
      operator: FilterOperator.LessThanOrEqual,
      cleanValue: value.slice(2),
    };
  }

  if (value.startsWith(">")) {
    return {
      operator: FilterOperator.GreaterThan,
      cleanValue: value.slice(1),
    };
  }

  if (value.startsWith("<")) {
    return {
      operator: FilterOperator.LessThan,
      cleanValue: value.slice(1),
    };
  }

  if (value.includes("*")) {
    return {
      operator: FilterOperator.Wildcard,
      cleanValue: value,
    };
  }

  return {
    operator: FilterOperator.Equals,
    cleanValue: value,
  };
}

function tokenizeRawInput(input: string): Array<string> {
  const tokens: Array<string> = [];
  let current: string = "";
  let inQuotes: boolean = false;

  for (let i: number = 0; i < input.length; i++) {
    const char: string = input[i]!;

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (char === " " && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFieldToken(raw: string): ParsedToken {
  let workingRaw: string = raw;
  let negated: boolean = false;

  if (workingRaw.startsWith("-")) {
    negated = true;
    workingRaw = workingRaw.slice(1);
  }

  const isAttribute: boolean = workingRaw.startsWith("@");

  if (isAttribute) {
    workingRaw = workingRaw.slice(1);
  }

  const colonIndex: number = workingRaw.indexOf(":");

  if (colonIndex === -1) {
    return {
      type: TokenType.FreeText,
      operator: FilterOperator.Contains,
      value: stripQuotes(workingRaw),
      negated,
      raw,
    };
  }

  const rawField: string = workingRaw.slice(0, colonIndex);
  const rawValue: string = stripQuotes(workingRaw.slice(colonIndex + 1));

  const { operator, cleanValue } = detectOperator(rawValue);

  const field: string = isAttribute ? rawField : resolveFieldName(rawField);

  return {
    type: isAttribute ? TokenType.AttributeFilter : TokenType.FieldFilter,
    field,
    operator:
      negated && operator === FilterOperator.Equals
        ? FilterOperator.NotEquals
        : operator,
    value: cleanValue,
    negated,
    raw,
  };
}

export function parseLogQuery(query: string): Array<ParsedToken> {
  const trimmed: string = query.trim();

  if (trimmed.length === 0) {
    return [];
  }

  const rawTokens: Array<string> = tokenizeRawInput(trimmed);
  const tokens: Array<ParsedToken> = [];
  const freeTextParts: Array<string> = [];

  const flushFreeText: () => void = (): void => {
    if (freeTextParts.length > 0) {
      const combined: string = freeTextParts.join(" ");
      tokens.push({
        type: TokenType.FreeText,
        operator: FilterOperator.Contains,
        value: combined,
        negated: false,
        raw: combined,
      });
      freeTextParts.length = 0;
    }
  };

  for (const rawToken of rawTokens) {
    if (BOOLEAN_KEYWORDS.has(rawToken)) {
      continue;
    }

    const hasColon: boolean =
      rawToken.includes(":") && !rawToken.startsWith('"');

    const isNegatedField: boolean =
      rawToken.startsWith("-") && rawToken.slice(1).includes(":");

    if (hasColon || isNegatedField) {
      flushFreeText();
      tokens.push(parseFieldToken(rawToken));
    } else {
      freeTextParts.push(stripQuotes(rawToken));
    }
  }

  flushFreeText();

  return tokens;
}

export function tokensToDisplayString(tokens: Array<ParsedToken>): string {
  return tokens
    .map((t: ParsedToken) => {
      return t.raw;
    })
    .join(" ");
}

export default parseLogQuery;
