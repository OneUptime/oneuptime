/**
 * Converts parsed log query tokens into a Query<Log> object compatible with
 * the AnalyticsDatabaseService query system.
 */

import {
  ParsedToken,
  TokenType,
  FilterOperator,
  parseLogQuery,
} from "./LogQueryParser";
import Search from "../BaseDatabase/Search";
import NotEqual from "../BaseDatabase/NotEqual";
import GreaterThan from "../BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../BaseDatabase/GreaterThanOrEqual";
import LessThan from "../BaseDatabase/LessThan";
import LessThanOrEqual from "../BaseDatabase/LessThanOrEqual";

export interface LogFilter {
  body?: string | Search<string>;
  severityText?: string;
  serviceId?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

const TOP_LEVEL_FIELDS: Set<string> = new Set([
  "severityText",
  "serviceId",
  "traceId",
  "spanId",
  "body",
]);

// Severity values stored in the database use title case (e.g. "Error", "Debug").
// Normalise user input so that "error" matches "Error", etc.
const SEVERITY_CANONICAL: Record<string, string> = {
  fatal: "Fatal",
  error: "Error",
  warning: "Warning",
  warn: "Warning",
  information: "Information",
  info: "Information",
  debug: "Debug",
  trace: "Trace",
  unspecified: "Unspecified",
};

function normalizeSeverityValue(value: string): string {
  return SEVERITY_CANONICAL[value.toLowerCase()] || value;
}

function applyFieldFilter(filter: LogFilter, token: ParsedToken): void {
  if (!token.field) {
    return;
  }

  let value: string = token.value;

  // Normalise severity values to match database casing
  if (token.field === "severityText") {
    value = normalizeSeverityValue(value);
  }

  if (TOP_LEVEL_FIELDS.has(token.field)) {
    applyTopLevelFilter(filter, token.field, value, token.operator);
  } else {
    applyAttributeFilter(filter, token.field, value, token.operator);
  }
}

function applyTopLevelFilter(
  filter: LogFilter,
  field: string,
  value: string,
  operator: FilterOperator,
): void {
  switch (operator) {
    case FilterOperator.Contains:
    case FilterOperator.Wildcard:
      filter[field] = new Search(value.replace(/\*/g, ""));
      break;
    case FilterOperator.GreaterThan:
      filter[field] = new GreaterThan(parseNumericOrString(value));
      break;
    case FilterOperator.GreaterThanOrEqual:
      filter[field] = new GreaterThanOrEqual(parseNumericOrString(value));
      break;
    case FilterOperator.LessThan:
      filter[field] = new LessThan(parseNumericOrString(value));
      break;
    case FilterOperator.LessThanOrEqual:
      filter[field] = new LessThanOrEqual(parseNumericOrString(value));
      break;
    case FilterOperator.NotEquals:
      filter[field] = new NotEqual(value);
      break;
    case FilterOperator.Equals:
    default:
      filter[field] = value;
      break;
  }
}

function applyAttributeFilter(
  filter: LogFilter,
  field: string,
  value: string,
  operator: FilterOperator,
): void {
  if (!filter.attributes) {
    filter.attributes = {};
  }

  switch (operator) {
    case FilterOperator.Contains:
    case FilterOperator.Wildcard:
      filter.attributes[field] = new Search(value.replace(/\*/g, ""));
      break;
    case FilterOperator.NotEquals:
      filter.attributes[field] = new NotEqual(value);
      break;
    case FilterOperator.GreaterThan:
      filter.attributes[field] = new GreaterThan(parseNumericOrString(value));
      break;
    case FilterOperator.GreaterThanOrEqual:
      filter.attributes[field] = new GreaterThanOrEqual(
        parseNumericOrString(value),
      );
      break;
    case FilterOperator.LessThan:
      filter.attributes[field] = new LessThan(parseNumericOrString(value));
      break;
    case FilterOperator.LessThanOrEqual:
      filter.attributes[field] = new LessThanOrEqual(
        parseNumericOrString(value),
      );
      break;
    case FilterOperator.Equals:
    default:
      filter.attributes[field] = value;
      break;
  }
}

function applyFreeTextFilter(filter: LogFilter, token: ParsedToken): void {
  if (filter.body && filter.body instanceof Search) {
    const existing: string = filter.body.toString();
    filter.body = new Search(`${existing} ${token.value}`);
  } else if (filter.body && typeof filter.body === "string") {
    filter.body = new Search(`${filter.body} ${token.value}`);
  } else {
    filter.body = new Search(token.value);
  }
}

function parseNumericOrString(value: string): number | string {
  const num: number = Number(value);
  return isNaN(num) ? value : num;
}

export function queryStringToFilter(queryString: string): LogFilter {
  const tokens: Array<ParsedToken> = parseLogQuery(queryString);
  const filter: LogFilter = {};

  for (const token of tokens) {
    switch (token.type) {
      case TokenType.FreeText:
        applyFreeTextFilter(filter, token);
        break;
      case TokenType.FieldFilter:
        applyFieldFilter(filter, token);
        break;
      case TokenType.AttributeFilter:
        applyFieldFilter(filter, token);
        break;
    }
  }

  return filter;
}

export default queryStringToFilter;
