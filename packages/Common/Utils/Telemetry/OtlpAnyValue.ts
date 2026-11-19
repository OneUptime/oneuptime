import { JSONValue } from "../../Types/JSON";

/*
 * AN OTLP VALUE AS THE PLAIN VALUE IT CARRIES.
 *
 * A log record's body (and an attribute's value) is an OTLP AnyValue: a
 * string arrives as {"stringValue":"x"}, a map as {"kvlistValue":{"values":
 * [{"key":"Name","value":{"stringValue":"shop_data"}}]}}, a list as
 * {"arrayValue":{"values":[...]}} - camelCase from OTLP/JSON, snake_case
 * (kvlist_value) where protobufjs decoded it. A collector that moves a
 * parsed JSON line into the body (the filelog receiver's `move` operator,
 * as the Docker Swarm agent's inventory does) sends a map, and the ingest
 * writes it as that JSON: read here as the object it is, its types kept -
 * a count a number, a flag a boolean.
 *
 * Bounded, as everything read from a record is: so deep, so many entries.
 */

export const OTLP_ANY_VALUE_MAX_DEPTH: number = 16;
export const OTLP_ANY_VALUE_MAX_ENTRIES: number = 10000;

type JSONRecord = { [key: string]: JSONValue };

function asRecord(value: unknown): JSONRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONRecord)
    : null;
}

function field(wrapper: JSONRecord, camel: string, snake: string): unknown {
  return wrapper[camel] !== undefined ? wrapper[camel] : wrapper[snake];
}

// Whether a value is an OTLP map (a kvlistValue), as a map body arrives.
export function isOtlpKvlistValue(value: unknown): boolean {
  const wrapper: JSONRecord | null = asRecord(value);
  return Boolean(
    wrapper && asRecord(field(wrapper, "kvlistValue", "kvlist_value")),
  );
}

export function readOtlpAnyValue(value: unknown, depth: number = 0): JSONValue {
  const wrapper: JSONRecord | null = asRecord(value);

  if (!wrapper || depth > OTLP_ANY_VALUE_MAX_DEPTH) {
    return null;
  }

  const text: unknown = field(wrapper, "stringValue", "string_value");
  if (text !== undefined) {
    return typeof text === "string" ? text : String(text);
  }

  // int64 arrives as a string in OTLP/JSON: a number all the same.
  for (const [camel, snake] of [
    ["intValue", "int_value"],
    ["doubleValue", "double_value"],
  ] as Array<[string, string]>) {
    const number: unknown = field(wrapper, camel, snake);
    if (number !== undefined) {
      const parsed: number = Number(number);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  const flag: unknown = field(wrapper, "boolValue", "bool_value");
  if (flag !== undefined) {
    return flag === true || flag === "true";
  }

  const kvlist: JSONRecord | null = asRecord(
    field(wrapper, "kvlistValue", "kvlist_value"),
  );
  if (kvlist) {
    const result: JSONRecord = {};
    const entries: unknown = kvlist["values"];
    if (Array.isArray(entries)) {
      for (const entry of entries.slice(0, OTLP_ANY_VALUE_MAX_ENTRIES)) {
        const pair: JSONRecord | null = asRecord(entry);
        const key: unknown = pair ? pair["key"] : undefined;
        if (!pair || typeof key !== "string" || key === "__proto__") {
          continue;
        }
        result[key] = readOtlpAnyValue(pair["value"], depth + 1);
      }
    }
    return result;
  }

  const array: JSONRecord | null = asRecord(
    field(wrapper, "arrayValue", "array_value"),
  );
  if (array) {
    const items: unknown = array["values"];
    return Array.isArray(items)
      ? items.slice(0, OTLP_ANY_VALUE_MAX_ENTRIES).map((item: unknown) => {
          return readOtlpAnyValue(item, depth + 1);
        })
      : [];
  }

  return null;
}
