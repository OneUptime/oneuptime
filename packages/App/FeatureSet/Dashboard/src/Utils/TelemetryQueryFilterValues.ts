import Dictionary from "Common/Types/Dictionary";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject, ObjectType } from "Common/Types/JSON";

/*
 * Readers for the filter values a STORED telemetry query holds.
 *
 * A monitor stamps its evaluation query onto the incident / alert row, and
 * the blob round-trips through `JSON.stringify` on the way in. What comes
 * back depends on whether the caller ran `JSONFunctions.deserialize`: an
 * `Includes` instance, or the plain `{ _type: "Includes", value: [...] }`
 * object it serializes to. Both shapes have to read the same, or a viewer
 * scoped from a stored query silently loses the scope on one page and keeps
 * it on another.
 *
 * Everything here is pure so App/Tests/Dashboard can exercise it without a
 * renderer. Extracted from TelemetryCompanionSignals, which had the first
 * two of these privately and now imports them, so the companion tabs and
 * the span / exception snapshot lists read a stored query identically.
 */

/** Scope-attribute values the analytics query grammar can carry verbatim. */
export type TelemetryScopeAttributeValue = string | number | boolean;

/**
 * Read the string values a query filter holds, across every shape the
 * store/load round trip can produce: an Includes instance, its serialized
 * `{ _type: "Includes", value: [...] }` form, a bare array, a single
 * string / number / ObjectID (instance or serialized).
 */
export function getFilterStringValues(value: unknown): Array<string> {
  const collect: (items: Array<unknown>) => Array<string> = (
    items: Array<unknown>,
  ): Array<string> => {
    const values: Array<string> = [];

    for (const item of items) {
      let scalar: string | number | ObjectID | null = null;

      if (
        typeof item === "string" ||
        typeof item === "number" ||
        item instanceof ObjectID
      ) {
        scalar = item;
      } else if (
        typeof item === "object" &&
        item !== null &&
        (item as JSONObject)["_type"] === ObjectType.ObjectID &&
        typeof (item as JSONObject)["value"] === "string"
      ) {
        /*
         * A membership of ObjectIDs that was NOT run through
         * JSONFunctions.deserialize still holds each id in its serialized
         * `{ _type: "ObjectID", value }` form. Missing this read an
         * `Includes` of service ids as EMPTY — a scope that fails open, so
         * the surface shows every service's rows and says nothing about it.
         */
        scalar = (item as JSONObject)["value"] as string;
      }

      if (scalar === null) {
        continue;
      }

      const stringValue: string = scalar.toString().trim();

      if (stringValue.length > 0 && !values.includes(stringValue)) {
        values.push(stringValue);
      }
    }

    return values;
  };

  if (value === null || value === undefined) {
    return [];
  }

  if (value instanceof Includes) {
    return collect(value.values as Array<unknown>);
  }

  if (Array.isArray(value)) {
    return collect(value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof ObjectID
  ) {
    return collect([value]);
  }

  if (typeof value === "object") {
    const json: JSONObject = value as JSONObject;

    if (json["_type"] === ObjectType.Includes && Array.isArray(json["value"])) {
      return collect(json["value"] as Array<unknown>);
    }

    if (
      json["_type"] === ObjectType.ObjectID &&
      typeof json["value"] === "string"
    ) {
      return collect([json["value"]]);
    }
  }

  return [];
}

/**
 * Whether a filter value carries no scope AT ALL (an empty membership, an
 * empty string) — as opposed to a value we failed to read. The former is
 * omitted silently (it filters nothing), the latter must be reported.
 */
export function isEmptyFilterValue(value: unknown): boolean {
  if (value instanceof Includes) {
    return value.values.length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (typeof value === "object" && value !== null) {
    const json: JSONObject = value as JSONObject;

    return (
      json["_type"] === ObjectType.Includes &&
      Array.isArray(json["value"]) &&
      (json["value"] as Array<unknown>).length === 0
    );
  }

  return false;
}

/**
 * The substring a `Search` filter carries, in either shape, or null when the
 * value is not a Search at all.
 *
 * Kept apart from `getFilterStringValues` on purpose: a monitor's span name
 * / exception message filter is a CONTAINS match, and reading it as an exact
 * value would scope a list to rows whose whole column equals the fragment —
 * usually none.
 */
export function getFilterSearchValue(value: unknown): string | null {
  if (value instanceof Search) {
    const searchValue: string = value.toString().trim();

    return searchValue.length > 0 ? searchValue : null;
  }

  if (typeof value === "object" && value !== null) {
    const json: JSONObject = value as JSONObject;

    if (json["_type"] === ObjectType.Search) {
      const searchValue: string = String(json["value"] ?? "").trim();

      return searchValue.length > 0 ? searchValue : null;
    }
  }

  return null;
}

/**
 * The numeric values a filter holds — `statusCode` arrives as an `Includes`
 * of `SpanStatus` members, which serialize to numbers or their decimal
 * strings depending on the round trip. Anything that is not a finite number
 * is dropped rather than coerced, so a malformed value narrows nothing
 * instead of narrowing to NaN.
 */
export function getFilterNumberValues(value: unknown): Array<number> {
  const values: Array<number> = [];

  for (const raw of getFilterStringValues(value)) {
    const parsed: number = Number(raw);

    if (Number.isFinite(parsed) && !values.includes(parsed)) {
      values.push(parsed);
    }
  }

  return values;
}

/**
 * The `attributes` record a stored query carries. Only scalar values are
 * kept: the analytics grammar compiles those to a map-subscript equality,
 * while an operator instance stored under an attribute key would have to be
 * re-serialized per transport and is reported as un-carried instead.
 */
export function getFilterAttributes(
  value: unknown,
): Dictionary<TelemetryScopeAttributeValue> {
  const attributes: Dictionary<TelemetryScopeAttributeValue> = {};

  /*
   * Plain records only. A live query operator is an object with neither a
   * `_type` marker nor an Array shape, so an `instanceof` list can never be
   * complete — `Search` slipped through one and had its private
   * `_searchValue` field read as an attribute named `_searchValue`. Testing
   * the prototype instead admits object literals and JSON.parse output, and
   * nothing else.
   */
  const prototype: unknown =
    typeof value === "object" && value !== null
      ? Object.getPrototypeOf(value)
      : null;

  /*
   * `_type` only disqualifies a record when it names a KNOWN serialized
   * operator. A telemetry attribute may legitimately be called `_type`, and
   * rejecting its whole map would unscope the list while the same filter kept
   * scoping every other surface.
   */
  const typeMarker: unknown =
    typeof value === "object" && value !== null
      ? (value as JSONObject)["_type"]
      : undefined;
  const isSerializedOperator: boolean =
    typeof typeMarker === "string" &&
    (Object.values(ObjectType) as Array<string>).includes(typeMarker);

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null) ||
    isSerializedOperator
  ) {
    return attributes;
  }

  for (const [key, attributeValue] of Object.entries(value as JSONObject)) {
    if (key.trim().length === 0) {
      continue;
    }

    if (
      typeof attributeValue === "string" ||
      typeof attributeValue === "number" ||
      typeof attributeValue === "boolean"
    ) {
      attributes[key] = attributeValue;
    }
  }

  return attributes;
}
