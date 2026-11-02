/**
 * Filter Check
 * Refuses a filter the API would not read as one, before it reaches the API.
 *
 * A list or count tool takes any field (Tools/ToolGenerator), so its schema
 * does not show each field's operators, and a filter written some other way -
 * {"$gt": ...} as MongoDB writes it, or {"_type": "Contains"} for an operator
 * OneUptime does not have - passes the API's checks untouched. On a text
 * column the database then compares the column with the object's JSON, which
 * matches nothing, so an agent is told there are no such records. On a date it
 * fails with an error that does not say why.
 *
 * The API reads a filter with JSONFunctions.deserialize, so a value that is
 * still a plain object after it is one the API would not read as a filter.
 * Two kinds of field do take a plain object, and are left to the API: a
 * relation, filtered by its own fields ({"currentIncidentState":
 * {"isResolvedState": false}}), and a column that stores an object, such as a
 * telemetry map filtered by its keys ({"attributes": {"http.method": "GET"}}).
 */

import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { findModelClass } from "../Services/SelectFieldGenerator";
import { McpToolInfo } from "../Types/McpTypes";
import ModelType from "../Types/ModelType";

// The column types a plain object is a filter on.
const OBJECT_FILTER_TYPES: Set<string> = new Set<string>([
  TableColumnType.Entity,
  TableColumnType.EntityArray,
  TableColumnType.JSON,
  TableColumnType.MonitorSteps,
  TableColumnType.Permission,
  TableColumnType.CustomFieldType,
  AnalyticsColumnType.MapStringString,
  AnalyticsColumnType.JSON,
  AnalyticsColumnType.JSONArray,
]);

// How much of a refused value an error quotes.
const MAX_QUOTED_LENGTH: number = 120;

// A model's columns do not change while the process runs.
const columnTypesByTable: Map<string, Map<string, string>> = new Map();

function getColumnTypes(tool: McpToolInfo): Map<string, string> {
  const cached: Map<string, string> | undefined = columnTypesByTable.get(
    tool.tableName,
  );

  if (cached) {
    return cached;
  }

  const columnTypes: Map<string, string> = new Map();
  const ModelClass:
    | { new (): DatabaseBaseModel }
    | { new (): AnalyticsBaseModel }
    | null = findModelClass(tool.tableName, tool.modelType);

  if (ModelClass && tool.modelType === ModelType.Database) {
    const columns: Record<string, TableColumnMetadata> = getTableColumns(
      new ModelClass() as DatabaseBaseModel,
    );

    for (const [name, column] of Object.entries(columns)) {
      columnTypes.set(name, column.type);
    }
  } else if (ModelClass) {
    for (const column of (
      new ModelClass() as AnalyticsBaseModel
    ).getTableColumns()) {
      columnTypes.set(column.key, column.type);
    }
  }

  columnTypesByTable.set(tool.tableName, columnTypes);

  return columnTypes;
}

function isPlainObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function quote(value: unknown): string {
  const text: string = JSON.stringify(value) ?? String(value);

  return text.length > MAX_QUOTED_LENGTH
    ? `${text.slice(0, MAX_QUOTED_LENGTH)}...`
    : text;
}

/*
 * Why the API would not read a list or count tool's `query` as a filter, or
 * null when it would. A field the model does not have is left for the API to
 * refuse, as it does, by name.
 */
export function getFilterProblem(
  tool: McpToolInfo,
  query: unknown,
): string | null {
  if (query === undefined || query === null) {
    return null;
  }

  if (!isPlainObject(query)) {
    return `query is an object of field names, such as {"title": "Checkout is down"}, not ${quote(query)}.`;
  }

  const columnTypes: Map<string, string> = getColumnTypes(tool);
  const unread: Array<string> = [];

  for (const [field, value] of Object.entries(
    query as Record<string, unknown>,
  )) {
    const columnType: string | undefined = columnTypes.get(field);

    if (
      !isPlainObject(value) ||
      columnType === undefined ||
      OBJECT_FILTER_TYPES.has(columnType)
    ) {
      continue;
    }

    let read: unknown;

    try {
      read = JSONFunctions.deserializeValue(value as JSONValue);
    } catch {
      // The API reads it the same way, and refuses it with its own error.
      continue;
    }

    if (isPlainObject(read)) {
      unread.push(`${field} ${quote(value)}`);
    }
  }

  if (unread.length === 0) {
    return null;
  }

  return `Not a value or an operator OneUptime reads: ${unread.join(", ")}. A filter is a value, for an exact match, or an operator, such as {"_type":"Search","value":"checkout"} or {"_type":"GreaterThan","value":"2026-01-01T00:00:00Z"}.`;
}
