/*
 * Pure (React-free) helpers for editing a database Query argument as simple
 * "field = value" filter rows instead of raw JSON. Each row carries an explicit
 * type so the serialized value keeps its JSON type (a number stays a number),
 * i.e. it produces exactly the query object an author would hand-write. The
 * stored value remains a JSON string, so the server parses it identically and
 * execution is unchanged.
 *
 * Only flat equality queries are representable as rows. Anything richer (an
 * operator object like {"createdAt": {"_type": "GreaterThan", …}}, an array,
 * or invalid JSON) returns null so the caller falls back to the raw editor.
 */

export type QueryFieldType = "text" | "number" | "boolean";

export interface QueryFilterRow {
  field: string;
  type: QueryFieldType;
  value: string;
}

export type ParseQueryFunction = (
  value: string,
) => Array<QueryFilterRow> | null;

export const parseQuery: ParseQueryFunction = (
  value: string,
): Array<QueryFilterRow> | null => {
  const trimmed: string = (value || "").trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const rows: Array<QueryFilterRow> = [];
  for (const field of Object.keys(parsed as Record<string, unknown>)) {
    const raw: unknown = (parsed as Record<string, unknown>)[field];

    if (raw !== null && typeof raw === "object") {
      // An operator object / nested query — not representable as a flat row.
      return null;
    }

    if (typeof raw === "number") {
      rows.push({ field: field, type: "number", value: String(raw) });
    } else if (typeof raw === "boolean") {
      rows.push({
        field: field,
        type: "boolean",
        value: raw ? "true" : "false",
      });
    } else {
      rows.push({
        field: field,
        type: "text",
        value: raw === null || raw === undefined ? "" : String(raw),
      });
    }
  }

  return rows;
};

export type SerializeQueryFunction = (rows: Array<QueryFilterRow>) => string;

export const serializeQuery: SerializeQueryFunction = (
  rows: Array<QueryFilterRow>,
): string => {
  const object: Record<string, unknown> = {};

  for (const row of rows) {
    if (row.field.trim() === "") {
      continue;
    }

    if (row.type === "number") {
      const asNumber: number = Number(row.value);
      /*
       * Keep the raw string for in-progress / non-numeric input rather than
       * writing NaN (which would serialize to null and query for null).
       */
      object[row.field] =
        row.value.trim() === "" || Number.isNaN(asNumber)
          ? row.value
          : asNumber;
    } else if (row.type === "boolean") {
      object[row.field] = row.value.trim().toLowerCase() === "true";
    } else {
      object[row.field] = row.value;
    }
  }

  if (Object.keys(object).length === 0) {
    return "";
  }

  return JSON.stringify(object, null, 2);
};
