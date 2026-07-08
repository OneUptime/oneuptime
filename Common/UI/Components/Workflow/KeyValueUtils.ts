/*
 * Pure (React-free) helpers for editing a StringDictionary argument (HTTP
 * headers, query params, …) as key/value rows instead of raw JSON. The stored
 * value stays a JSON string — the server JSON-parses it either way — so a
 * workflow round-trips to the same parsed object and nothing about execution
 * changes.
 */

export interface KeyValueRow {
  key: string;
  value: string;
}

export type ParseKeyValueFunction = (
  value: string,
) => Array<KeyValueRow> | null;

/*
 * Parse the stored JSON string into rows. Returns null when the value can't be
 * shown as simple key/value pairs (invalid JSON, an array, or a nested
 * object) — the caller then falls back to the raw JSON editor.
 */
export const parseKeyValue: ParseKeyValueFunction = (
  value: string,
): Array<KeyValueRow> | null => {
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

  const rows: Array<KeyValueRow> = [];
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    const raw: unknown = (parsed as Record<string, unknown>)[key];
    if (raw !== null && typeof raw === "object") {
      // Nested object/array — can't represent as a flat row.
      return null;
    }
    rows.push({
      key: key,
      value: raw === null || raw === undefined ? "" : String(raw),
    });
  }

  return rows;
};

export type SerializeKeyValueFunction = (rows: Array<KeyValueRow>) => string;

/*
 * Serialize rows back to a JSON string. Rows with an empty key are dropped;
 * an empty result serializes to "" (an unset optional argument).
 */
export const serializeKeyValue: SerializeKeyValueFunction = (
  rows: Array<KeyValueRow>,
): string => {
  const object: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() === "") {
      continue;
    }
    object[row.key] = row.value;
  }

  if (Object.keys(object).length === 0) {
    return "";
  }

  return JSON.stringify(object, null, 2);
};
