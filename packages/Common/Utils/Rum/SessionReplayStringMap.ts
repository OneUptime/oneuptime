/*
 * Sanitising of the small string maps a host page hands the recorder:
 * identify() traits, setTags()/addTag() tags and track() properties.
 *
 * Isomorphic on purpose. The recorder bundle imports this file through
 * esbuild and runs it on third-party pages, and the ingest worker runs the
 * SAME function over the same bytes at the same caps. One implementation
 * on both sides is what makes "the server keeps exactly what the client
 * sent" true rather than hoped for, so nothing here may touch Node, the
 * DOM, or anything outside plain ECMAScript.
 *
 * Two rules the whole file serves:
 *   1. Never throw. This runs inside a customer's page on values the page
 *      author typed; a recorder that takes the host page down over a bad
 *      tag is a worse bug than any tag.
 *   2. Be deterministic. Insertion order is preserved and every cap is
 *      applied the same way every time, so the recorder's copy, the
 *      header row and the list cell all show the same map.
 */

export interface SessionReplayStringMapLimits {
  /* Distinct keys kept; later keys are dropped once this is reached. */
  maxKeys: number;
  /* Keys longer than this are truncated (never dropped) to this length. */
  maxKeyLength: number;
  /* Values longer than this are truncated to this length. */
  maxValueLength: number;
}

/*
 * Assigning through this key on a plain object rewrites its prototype
 * instead of adding a property, so a page calling
 * setTags({ __proto__: ... }) would otherwise hand us an object whose
 * later reads fall through to attacker-chosen defaults.
 */
const PROTOTYPE_KEY: string = "__proto__";

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/*
 * The only value types accepted, stringified the way a page author would
 * expect. Anything else (objects, arrays, functions, symbols, null,
 * undefined, NaN and the infinities) is dropped rather than rendered as
 * "[object Object]" or "NaN": a value nobody can search for is not a tag.
 */
function stringifyValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return null;
}

/*
 * Own, enumerable string keys in insertion order, or null when the input
 * is not a usable object. Wrapped because Object.keys can throw on an
 * exotic object (a revoked Proxy), and rule 1 says we do not.
 */
function readOwnKeys(input: unknown): Array<string> | null {
  if (input === null || typeof input !== "object") {
    return null;
  }

  /*
   * Array.isArray itself throws on a revoked Proxy ("Cannot perform
   * 'IsArray' on a proxy that has been revoked"), so it sits inside the
   * guard too.
   */
  try {
    if (Array.isArray(input)) {
      return null;
    }

    return Object.keys(input as Record<string, unknown>);
  } catch {
    return null;
  }
}

/*
 * True when the value already has the shape this module produces: a plain
 * object whose every value is a string. Used as the type guard for the
 * tags / traits / properties fields on custom-event payloads that cross
 * the wire, where "shaped like a map" is the minimum worth trusting.
 */
export function isSessionReplayStringMap(
  value: unknown,
): value is Record<string, string> {
  const keys: Array<string> | null = readOwnKeys(value);

  if (keys === null) {
    return false;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return keys.every((key: string): boolean => {
    return typeof record[key] === "string";
  });
}

/*
 * Coerce an untrusted value into a bounded Record<string, string>.
 *
 * - Non-objects, arrays and null yield {}.
 * - Keys are truncated to maxKeyLength; a key that is empty (before or
 *   after truncation) is dropped, and a truncated key that collides with
 *   an earlier one overwrites it, which is what a plain object would do.
 * - Values are accepted when string, finite number or boolean and are
 *   stringified then truncated to maxValueLength. Anything else is dropped
 *   with its key.
 * - Once maxKeys distinct keys are kept, further NEW keys are dropped;
 *   a repeated key still overwrites, so the count never exceeds the cap.
 * - Insertion order is the input's own key order.
 */
export function sanitizeSessionReplayStringMap(
  input: unknown,
  limits: SessionReplayStringMapLimits,
): Record<string, string> {
  const result: Record<string, string> = {};
  const keys: Array<string> | null = readOwnKeys(input);

  if (keys === null) {
    return result;
  }

  const record: Record<string, unknown> = input as Record<string, unknown>;
  let keptCount: number = 0;

  for (const rawKey of keys) {
    const key: string = truncate(rawKey, limits.maxKeyLength);

    if (key.length === 0 || key === PROTOTYPE_KEY) {
      continue;
    }

    let stringValue: string | null;

    try {
      stringValue = stringifyValue(record[rawKey]);
    } catch {
      /* A throwing getter is the page's problem, not the recorder's. */
      continue;
    }

    if (stringValue === null) {
      continue;
    }

    const isNewKey: boolean = !Object.prototype.hasOwnProperty.call(
      result,
      key,
    );

    if (isNewKey && keptCount >= limits.maxKeys) {
      continue;
    }

    result[key] = truncate(stringValue, limits.maxValueLength);

    if (isNewKey) {
      keptCount++;
    }
  }

  return result;
}

/*
 * The addTag()/setTags() merge: entries in `patch` overwrite entries in
 * `base`; both sides are sanitised first so a stale or oversized base can
 * never leak past the caps. When the union would exceed maxKeys, the
 * EXISTING keys win and the patch's surplus new keys are dropped: a page
 * that keeps adding tags past the cap gets a stable map rather than one
 * whose oldest entries silently rotate away, and the same rule on the
 * server keeps the header identical to what the recorder held.
 */
export function mergeSessionReplayStringMaps(
  base: unknown,
  patch: unknown,
  limits: SessionReplayStringMapLimits,
): Record<string, string> {
  const merged: Record<string, string> = sanitizeSessionReplayStringMap(
    base,
    limits,
  );
  const sanitizedPatch: Record<string, string> = sanitizeSessionReplayStringMap(
    patch,
    limits,
  );

  let keptCount: number = Object.keys(merged).length;

  for (const key of Object.keys(sanitizedPatch)) {
    const isNewKey: boolean = !Object.prototype.hasOwnProperty.call(
      merged,
      key,
    );

    if (isNewKey && keptCount >= limits.maxKeys) {
      continue;
    }

    merged[key] = sanitizedPatch[key] as string;

    if (isNewKey) {
      keptCount++;
    }
  }

  return merged;
}
