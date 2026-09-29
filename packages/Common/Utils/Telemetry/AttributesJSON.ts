import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";

/*
 * Telemetry attributes (on a span, a log, a span event, an exception
 * occurrence) as JSON someone can paste into a ticket, a test fixture or a
 * `jq` pipeline.
 *
 * Two shapes, because both are what people reach for:
 *
 *   flat     {"http.request.method": "GET", "http.response.status_code": 200}
 *            The keys exactly as the SDK recorded them - what the attribute
 *            list shows and what the search bar's `@key:value` matches.
 *   nested   {"http": {"request": {"method": "GET"}, "response": {...}}}
 *            The dots expanded into objects, which reads better and is what
 *            most JSON tooling expects.
 *
 * The copy has to be faithful to the stored value, not to how a row renders
 * it: a status code stays a number, `true` stays a boolean and an array stays
 * an array. (The previous copy stringified every value, so pasting a span's
 * attributes into a fixture silently changed their types.)
 *
 * Attribute keys are whatever a sender put on the wire, so they are only ever
 * written into null-prototype objects: a key such as `__proto__` becomes an
 * ordinary own property instead of reaching Object.prototype.
 */

export type AttributesJSONFormat = "flat" | "nested";

export const ATTRIBUTES_JSON_FORMATS: ReadonlyArray<AttributesJSONFormat> = [
  "flat",
  "nested",
];

// Written in place of a value that refers back to one of its own ancestors.
export const CIRCULAR_REFERENCE_PLACEHOLDER: string = "[Circular]";

type UnknownRecord = Record<string, unknown>;

// An object or array already being walked, to recognise a circular reference.
type Container = UnknownRecord | Array<unknown>;

function createSafeObject(): JSONObject {
  return Object.create(null) as JSONObject;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareKeys(left: string, right: string): number {
  return left.localeCompare(right);
}

/*
 * One value made safe for JSON.stringify without changing what it means.
 * `undefined` is returned for the values JSON has no way to carry (functions,
 * symbols, undefined itself) so the caller can drop the key, as
 * JSON.stringify would.
 */
function toJSONSafeValue(
  value: unknown,
  ancestors: Array<Container>,
): JSONValue | undefined {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      /*
       * JSON.stringify writes NaN and Infinity as null, which would turn a
       * recorded value into "no value". Keep what was recorded, as text.
       */
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
      // JSON.stringify throws on a bigint; text keeps every digit.
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    default:
      break;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  }

  const objectValue: Container = value as Container;

  if (ancestors.includes(objectValue)) {
    return CIRCULAR_REFERENCE_PLACEHOLDER;
  }

  ancestors.push(objectValue);

  try {
    if (Array.isArray(objectValue)) {
      return objectValue.map((item: unknown): JSONValue => {
        const safeItem: JSONValue | undefined = toJSONSafeValue(
          item,
          ancestors,
        );
        // JSON.stringify writes a missing array element as null too.
        return safeItem === undefined ? null : safeItem;
      }) as JSONArray;
    }

    const result: JSONObject = createSafeObject();

    for (const key of Object.keys(objectValue).sort(compareKeys)) {
      const safeValue: JSONValue | undefined = toJSONSafeValue(
        objectValue[key],
        ancestors,
      );

      if (safeValue !== undefined) {
        result[key] = safeValue;
      }
    }

    return result;
  } finally {
    ancestors.pop();
  }
}

/*
 * Spans store attributes as a JSON column, so a sender that nested them
 * (`{"http": {"method": "GET"}}`) arrives nested; logs store a flat map. The
 * flat shape walks into plain objects and joins the path with dots. An empty
 * object and an array are values in their own right and stay as they are.
 */
function flattenInto(
  target: JSONObject,
  source: UnknownRecord,
  prefix: string,
  ancestors: Array<Container>,
): void {
  if (ancestors.includes(source)) {
    if (prefix && !Object.prototype.hasOwnProperty.call(target, prefix)) {
      target[prefix] = CIRCULAR_REFERENCE_PLACEHOLDER;
    }
    return;
  }

  ancestors.push(source);

  try {
    for (const key of Object.keys(source)) {
      const value: unknown = source[key];
      const fullKey: string = prefix ? `${prefix}.${key}` : key;

      if (
        isRecord(value) &&
        !(value instanceof Date) &&
        Object.keys(value).length > 0
      ) {
        flattenInto(target, value, fullKey, ancestors);
        continue;
      }

      const safeValue: JSONValue | undefined = toJSONSafeValue(
        value,
        ancestors,
      );

      /*
       * `{"a.b": 1, "a": {"b": 2}}` names the same flat key twice. There is
       * no lossless answer, so the first one seen is kept - deterministically,
       * rather than whichever happened to be written last.
       */
      if (
        safeValue === undefined ||
        Object.prototype.hasOwnProperty.call(target, fullKey)
      ) {
        continue;
      }

      target[fullKey] = safeValue;
    }
  } finally {
    ancestors.pop();
  }
}

function sortObjectKeys(source: JSONObject): JSONObject {
  const sorted: JSONObject = createSafeObject();

  for (const key of Object.keys(source).sort(compareKeys)) {
    sorted[key] = source[key] as JSONValue;
  }

  return sorted;
}

/**
 * Attributes as one level of dotted keys, sorted, with every value keeping
 * its type. Anything that is not an attribute map (null, an array, a
 * primitive) yields an empty object.
 */
export function toFlatAttributesJSON(attributes: unknown): JSONObject {
  const flat: JSONObject = createSafeObject();

  if (!isRecord(attributes)) {
    return flat;
  }

  flattenInto(flat, attributes, "", []);

  return sortObjectKeys(flat);
}

/**
 * Attributes with their dotted keys expanded into nested objects.
 *
 * OpenTelemetry keys are not a tree: `db.system` and `db.system.name` are
 * both valid attributes on the same span, and `db.system` cannot be a string
 * and an object at once. Rather than drop one (what a naive unflatten does),
 * the rest of a clashing path is kept as a dotted key inside the deepest
 * object it can reach: `{"db": {"system": "postgresql", "system.name": ...}}`.
 * Keys with an empty segment (`.leading`, `trailing.`, `a..b`) are not paths
 * at all and are kept verbatim.
 */
export function toNestedAttributesJSON(attributes: unknown): JSONObject {
  const flat: JSONObject = toFlatAttributesJSON(attributes);
  const nested: JSONObject = createSafeObject();

  /*
   * Only objects this function created while expanding a path may be walked
   * into. An object that is itself an attribute value (an empty `{}`) is data
   * and is never merged into.
   */
  const containers: WeakSet<JSONObject> = new WeakSet<JSONObject>();
  containers.add(nested);

  /*
   * Sorted keys put a path before every key it prefixes (`db.system` before
   * `db.system.name`), so a leaf is always placed before anything that would
   * have to walk through it.
   */
  for (const key of Object.keys(flat)) {
    const value: JSONValue = flat[key] as JSONValue;
    const segments: Array<string> = key.split(".");

    if (
      segments.length === 1 ||
      segments.some((segment: string): boolean => {
        return segment.length === 0;
      })
    ) {
      if (!Object.prototype.hasOwnProperty.call(nested, key)) {
        nested[key] = value;
      }
      continue;
    }

    let node: JSONObject = nested;

    for (let index: number = 0; index < segments.length; index++) {
      const segment: string = segments[index] as string;
      const isLast: boolean = index === segments.length - 1;
      const existing: JSONValue | undefined =
        Object.prototype.hasOwnProperty.call(node, segment)
          ? (node[segment] as JSONValue)
          : undefined;

      if (isLast) {
        if (existing === undefined) {
          node[segment] = value;
        }
        break;
      }

      if (existing === undefined) {
        const child: JSONObject = createSafeObject();
        containers.add(child);
        node[segment] = child;
        node = child;
        continue;
      }

      if (isRecord(existing) && containers.has(existing as JSONObject)) {
        node = existing as JSONObject;
        continue;
      }

      // A value already lives here: keep the rest of the path as one key.
      const remainder: string = segments.slice(index).join(".");

      if (!Object.prototype.hasOwnProperty.call(node, remainder)) {
        node[remainder] = value;
      }
      break;
    }
  }

  return nested;
}

export function toAttributesJSON(
  attributes: unknown,
  format: AttributesJSONFormat,
): JSONObject {
  return format === "nested"
    ? toNestedAttributesJSON(attributes)
    : toFlatAttributesJSON(attributes);
}

/**
 * The text the "Copy JSON" affordances put on the clipboard: pretty-printed
 * with two spaces by default, `indent: 0` for a single line.
 */
export function stringifyAttributesJSON(
  attributes: unknown,
  format: AttributesJSONFormat,
  options?: { indent?: number | undefined } | undefined,
): string {
  const indent: number =
    options?.indent === undefined ? 2 : Math.max(0, options.indent);

  return JSON.stringify(
    toAttributesJSON(attributes, format),
    null,
    indent || undefined,
  );
}

/** How many attributes a copy will contain (flat keys). */
export function countAttributes(attributes: unknown): number {
  return Object.keys(toFlatAttributesJSON(attributes)).length;
}

/**
 * A one-line taste of what a format looks like for these attributes - the
 * first attribute only, followed by an ellipsis when there are more - for
 * the format picker. Empty when there is nothing to copy.
 */
export function previewAttributesJSON(
  attributes: unknown,
  format: AttributesJSONFormat,
): string {
  const flat: JSONObject = toFlatAttributesJSON(attributes);
  const keys: Array<string> = Object.keys(flat);
  const firstKey: string | undefined = keys[0];

  if (firstKey === undefined) {
    return "";
  }

  const first: JSONObject = createSafeObject();
  first[firstKey] = flat[firstKey] as JSONValue;

  const compact: string = JSON.stringify(
    format === "nested" ? toNestedAttributesJSON(first) : first,
  );

  if (keys.length === 1) {
    return compact;
  }

  return `${compact.slice(0, -1)}, …}`;
}
