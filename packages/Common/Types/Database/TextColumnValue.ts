import { JSONObject, JSONValue, ObjectType } from "../JSON";
import Name from "../Name";
import { TableColumnMetadata } from "./TableColumn";
import TableColumnType from "./TableColumnType";

/*
 * A NAME SENT AS AN OBJECT IS THE TEXT A TEXT COLUMN STORES.
 *
 * Thirty-one display names - a cloud connection's, a probe's, an LLM
 * provider's, a pipeline's, a saved view's - were typed the person's-name
 * type (TableColumnType.Name), so the API's schema, the MCP tools and the
 * docs asked for {"_type":"Name","value":"..."} where people send text.
 * They are text now (ShortText; NameColumnsArePeoplesNames holds the rule).
 * A client written against the old schema - a script, an AI agent through
 * MCP - still sends the object: JSONFunctions.deserialize makes it a Name,
 * and a text column with no transformer would hand that to the database,
 * which stored its JSON, '{"_type":"Name","value":"web-alb"}', as the name.
 *
 * So a write's text columns take a Name's text - an object deserialized or
 * still as it came - before anything reads them: the API on the way in
 * (BaseModel.fromJSON for a create, coerceTextColumnsInJSON beside the
 * number, date and boolean coercions for an update). Plain text, null and
 * everything else are left as they are, and a person's name (a Name column,
 * which keeps its Name) is not touched.
 */

// Column types whose value is text the database stores as it is.
const TEXT_TABLE_COLUMN_TYPES: Set<TableColumnType> = new Set<TableColumnType>([
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
  TableColumnType.Description,
  TableColumnType.Markdown,
]);

export function isTextTableColumnType(
  type: TableColumnType | undefined | null,
): boolean {
  if (!type) {
    return false;
  }

  return TEXT_TABLE_COLUMN_TYPES.has(type);
}

/*
 * The text of a name sent as the person's-name object - a Name, or the
 * {"_type":"Name","value":"..."} it is sent as - or the value as it is.
 */
export function coerceTextColumnValue(value: unknown): unknown {
  if (value instanceof Name) {
    return value.toString();
  }

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as JSONObject)["_type"] === ObjectType.Name &&
    typeof (value as JSONObject)["value"] === "string"
  ) {
    return (value as JSONObject)["value"] as string;
  }

  return value;
}

/*
 * The minimum a model has to offer for its text columns to be found. Every
 * DatabaseBaseModel satisfies it.
 */
export interface ColumnMetadataSource {
  getTableColumnMetadata: (columnName: string) => TableColumnMetadata;
}

/*
 * Coerce the text columns of a write, in place: a name sent as the
 * person's-name object becomes its text. Columns of other types, and every
 * other value, are left exactly as they are. Works on a plain object of
 * columns and on a model alike.
 */
export function coerceTextColumnsInJSON(
  json: JSONObject,
  model: ColumnMetadataSource,
): JSONObject {
  for (const key of Object.keys(json)) {
    const tableColumnMetadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(key);

    if (
      !tableColumnMetadata ||
      !isTextTableColumnType(tableColumnMetadata.type)
    ) {
      continue;
    }

    const value: unknown = json[key];
    const text: unknown = coerceTextColumnValue(value);

    if (text !== value) {
      json[key] = text as JSONValue;
    }
  }

  return json;
}
