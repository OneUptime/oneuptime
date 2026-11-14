import { AUDIT_LOG_REDACTED_VALUE } from "../../Types/AuditLog/AuditLogRedaction";
import { looksLikeSecretName } from "../../Types/AuditLog/AuditLogCoverage";
import { limitLines } from "../Workflow/WorkflowGraphChanges";
import {
  AuditLogTypedValueReading,
  readAuditLogTypedValue,
} from "./AuditLogTypedValues";

/*
 * WHAT AN AUDIT LOG ENTRY SAYS ABOUT A VALUE: readable, bounded, and never a
 * secret.
 *
 * An entry records each changed field before and after (AuditLogRecorder).
 * Most fields are a name or a switch, and are recorded as they are. Three
 * kinds are not:
 *
 *   - JSON a person filled in can hold a secret under any key: a monitor's
 *     Authorization header, a token in a step's settings. Every value under a
 *     key that says it is a secret is "[REDACTED]" (redactSecretsInJson),
 *     whatever model it belongs to.
 *   - JSON can be large - a dashboard's layout, a monitor's steps - and an
 *     entry holding two copies of it says nothing a person can read. Past
 *     AUDIT_LOG_JSON_LIMIT it is recorded by its size, and every JSON change
 *     comes with the paths that changed (getJsonChangeLines), which name keys
 *     and never quote values.
 *   - Text can be megabytes on one line (a pasted log, a screenshot as
 *     base64). Past AUDIT_LOG_TEXT_LIMIT characters an entry keeps the part
 *     around the first difference (limitChangedText), saying how much is left
 *     out on each side.
 *
 * Nothing here runs a regular expression over a value: values can be
 * megabytes long (Docs/notifications/README.md, "Megabyte-long values"). Pure:
 * no DOM, no server.
 */

// Characters of text an entry keeps of a value.
export const AUDIT_LOG_TEXT_LIMIT: number = 10000;

// Characters of JSON an entry keeps a value whole up to.
export const AUDIT_LOG_JSON_LIMIT: number = 8192;

// Lines a change summary holds, the last counting the rest.
export const AUDIT_LOG_SUMMARY_LINE_LIMIT: number = 25;

// How far into nested JSON a value is read; past it, a change is named where it starts.
const DEEPEST_LEVEL_READ: number = 32;

// Characters of what came before the first difference that an excerpt keeps.
const CONTEXT_BEFORE_DIFFERENCE: number = 200;

// Keys that name the secret held in a sibling "value": { key: "Authorization", value: "..." }.
const PAIR_NAME_KEYS: ReadonlyArray<string> = [
  "key",
  "name",
  "header",
  "headerName",
];

type PlainObject = Record<string, unknown>;

const isPlainObject: (value: unknown) => value is PlainObject = (
  value: unknown,
): value is PlainObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const isNothing: (value: unknown) => boolean = (value: unknown): boolean => {
  return value === null || value === undefined;
};

/*
 * A copy of a JSON value in which every value kept under a key that says it
 * is a secret ("password", "apiKey", "Authorization", "x-api-key", ...), the
 * "value" of a pair named like one, and a hash anywhere - written as
 * { "_type": "HashedString", "value": ... }, a secret whatever its key
 * (AuditLogTypedValues) - is "[REDACTED]". The keys stay, so an entry still
 * shows where a secret is set.
 */
export const redactSecretsInJson: (value: unknown) => unknown = (
  value: unknown,
): unknown => {
  return redactAtDepth(value, 0);
};

const redactAtDepth: (value: unknown, depth: number) => unknown = (
  value: unknown,
  depth: number,
): unknown => {
  if (depth > DEEPEST_LEVEL_READ) {
    // Too deep to read: nothing of it is kept.
    return isNothing(value) ? value : AUDIT_LOG_REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return redactAtDepth(item, depth + 1);
    });
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (
    readAuditLogTypedValue(value)?.reading === AuditLogTypedValueReading.Secret
  ) {
    return AUDIT_LOG_REDACTED_VALUE;
  }

  const isSecretPair: boolean = PAIR_NAME_KEYS.some(
    (nameKey: string): boolean => {
      const name: unknown = value[nameKey];
      return typeof name === "string" && looksLikeSecretName(name);
    },
  );

  const copy: PlainObject = {};

  for (const key of Object.keys(value)) {
    const item: unknown = value[key];

    if (
      !isNothing(item) &&
      (looksLikeSecretName(key) || (isSecretPair && key === "value"))
    ) {
      copy[key] = AUDIT_LOG_REDACTED_VALUE;
      continue;
    }

    copy[key] = redactAtDepth(item, depth + 1);
  }

  return copy;
};

// Whether a recorded value is JSON (an object or a list) rather than a scalar.
export const isJsonStructure: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return value !== null && typeof value === "object";
};

// The length of a value written as JSON; a value that cannot be is endless.
export const getJsonLength: (value: unknown) => number = (
  value: unknown,
): number => {
  try {
    const text: string | undefined = JSON.stringify(value);
    return text === undefined ? 0 : text.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

// 1234567 as "1,234,567", without a locale.
export const formatCount: (count: number) => string = (
  count: number,
): string => {
  const digits: string = String(Math.max(0, Math.floor(count)));
  let formatted: string = "";

  for (let index: number = 0; index < digits.length; index++) {
    if (index > 0 && (digits.length - index) % 3 === 0) {
      formatted += ",";
    }

    formatted += digits.charAt(index);
  }

  return formatted;
};

// What an entry records in place of JSON too large to keep: "[12.3 KB of JSON]".
export const describeLargeJson: (length: number) => string = (
  length: number,
): string => {
  if (!Number.isFinite(length)) {
    return "[JSON too large to record]";
  }

  const kilobytes: number = length / 1024;
  const size: string =
    kilobytes >= 1024
      ? `${(kilobytes / 1024).toFixed(1)} MB`
      : `${kilobytes.toFixed(1)} KB`;

  return `[${size} of JSON]`;
};

// Whether JSON is too large to record whole.
export const isLargeJson: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return isJsonStructure(value) && getJsonLength(value) > AUDIT_LOG_JSON_LIMIT;
};

/*
 * Whether two JSON values hold the same: object keys in any order, nothing
 * and null alike.
 */
export const isSameJson: (before: unknown, after: unknown) => boolean = (
  before: unknown,
  after: unknown,
): boolean => {
  return isSameAtDepth(before, after, 0);
};

const isSameAtDepth: (
  before: unknown,
  after: unknown,
  depth: number,
) => boolean = (before: unknown, after: unknown, depth: number): boolean => {
  if (isNothing(before) && isNothing(after)) {
    return true;
  }

  if (depth > DEEPEST_LEVEL_READ) {
    return getJsonText(before) === getJsonText(after);
  }

  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      return false;
    }

    if (before.length !== after.length) {
      return false;
    }

    return before.every((item: unknown, index: number): boolean => {
      return isSameAtDepth(item, after[index], depth + 1);
    });
  }

  if (isPlainObject(before) || isPlainObject(after)) {
    if (!isPlainObject(before) || !isPlainObject(after)) {
      return false;
    }

    const keys: Set<string> = new Set<string>([
      ...Object.keys(before),
      ...Object.keys(after),
    ]);

    for (const key of keys) {
      if (!isSameAtDepth(before[key], after[key], depth + 1)) {
        return false;
      }
    }

    return true;
  }

  return before === after;
};

const getJsonText: (value: unknown) => string = (value: unknown): string => {
  try {
    return JSON.stringify(value) || "";
  } catch {
    return String(value);
  }
};

// The id an item of a list goes by, when its list gives every item a different one.
const ITEM_ID_KEYS: ReadonlyArray<string> = ["_id", "id", "key"];

const getItemIdKey: (items: Array<unknown>) => string | null = (
  items: Array<unknown>,
): string | null => {
  if (items.length === 0) {
    return null;
  }

  for (const idKey of ITEM_ID_KEYS) {
    const ids: Set<string> = new Set<string>();
    let isEveryItemNamed: boolean = true;

    for (const item of items) {
      const id: unknown = isPlainObject(item) ? item[idKey] : undefined;

      if (
        (typeof id !== "string" && typeof id !== "number") ||
        ids.has(String(id))
      ) {
        isEveryItemNamed = false;
        break;
      }

      ids.add(String(id));
    }

    if (isEveryItemNamed) {
      return idKey;
    }
  }

  return null;
};

interface JsonChangeWalk {
  lines: Array<string>;
}

const PATH_SEPARATOR: string = " › ";

const describePath: (path: Array<string>) => string = (
  path: Array<string>,
): string => {
  return path.length === 0 ? "the value" : path.join(PATH_SEPARATOR);
};

const walkJsonChanges: (data: {
  before: unknown;
  after: unknown;
  path: Array<string>;
  depth: number;
  walk: JsonChangeWalk;
}) => void = (data: {
  before: unknown;
  after: unknown;
  path: Array<string>;
  depth: number;
  walk: JsonChangeWalk;
}): void => {
  const { before, after, path, depth, walk } = data;

  if (isSameAtDepth(before, after, depth)) {
    return;
  }

  if (depth >= DEEPEST_LEVEL_READ) {
    walk.lines.push(`Changed ${describePath(path)}`);
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const idKey: string | null =
      getItemIdKey(before) && getItemIdKey(after) === getItemIdKey(before)
        ? getItemIdKey(before)
        : null;

    if (idKey) {
      const itemsBefore: Map<string, unknown> = new Map(
        before.map((item: unknown): [string, unknown] => {
          return [String((item as PlainObject)[idKey]), item];
        }),
      );
      const itemsAfter: Map<string, unknown> = new Map(
        after.map((item: unknown): [string, unknown] => {
          return [String((item as PlainObject)[idKey]), item];
        }),
      );

      for (const [id, item] of itemsAfter) {
        if (!itemsBefore.has(id)) {
          walk.lines.push(`Added ${describePath([...path, id])}`);
          continue;
        }

        walkJsonChanges({
          before: itemsBefore.get(id),
          after: item,
          path: [...path, id],
          depth: depth + 1,
          walk,
        });
      }

      for (const id of itemsBefore.keys()) {
        if (!itemsAfter.has(id)) {
          walk.lines.push(`Removed ${describePath([...path, id])}`);
        }
      }

      return;
    }

    const length: number = Math.max(before.length, after.length);

    for (let index: number = 0; index < length; index++) {
      const itemPath: Array<string> = [...path, String(index + 1)];

      if (index >= before.length) {
        walk.lines.push(`Added ${describePath(itemPath)}`);
        continue;
      }

      if (index >= after.length) {
        walk.lines.push(`Removed ${describePath(itemPath)}`);
        continue;
      }

      walkJsonChanges({
        before: before[index],
        after: after[index],
        path: itemPath,
        depth: depth + 1,
        walk,
      });
    }

    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys: Array<string> = Array.from(
      new Set<string>([...Object.keys(before), ...Object.keys(after)]),
    ).sort((a: string, b: string): number => {
      return a.localeCompare(b);
    });

    for (const key of keys) {
      const keyPath: Array<string> = [...path, key];

      if (isNothing(before[key]) && !isNothing(after[key])) {
        walk.lines.push(`Added ${describePath(keyPath)}`);
        continue;
      }

      if (!isNothing(before[key]) && isNothing(after[key])) {
        walk.lines.push(`Removed ${describePath(keyPath)}`);
        continue;
      }

      walkJsonChanges({
        before: before[key],
        after: after[key],
        path: keyPath,
        depth: depth + 1,
        walk,
      });
    }

    return;
  }

  walk.lines.push(`Changed ${describePath(path)}`);
};

/*
 * What changed in a JSON value, one line per place: "Changed requestHeaders ›
 * Authorization", "Added widgets › 4", "Removed filters › service". Keys are
 * named and values never quoted, so a line can name where a secret changed
 * without saying what it is. A list whose items all have their own id is
 * compared item by item by that id, so one inserted at the top is one line.
 */
export const getJsonChangeLines: (data: {
  before: unknown;
  after: unknown;
  limit?: number | undefined;
}) => Array<string> = (data: {
  before: unknown;
  after: unknown;
  limit?: number | undefined;
}): Array<string> => {
  const walk: JsonChangeWalk = { lines: [] };

  walkJsonChanges({
    before: data.before,
    after: data.after,
    path: [],
    depth: 0,
    walk,
  });

  return limitLines({
    lines: walk.lines,
    limit: data.limit || AUDIT_LOG_SUMMARY_LINE_LIMIT,
    noun: "change",
  });
};

// Where two texts first differ: the length of what they start with in common.
export const getFirstDifference: (before: string, after: string) => number = (
  before: string,
  after: string,
): number => {
  const length: number = Math.min(before.length, after.length);

  for (let index: number = 0; index < length; index++) {
    if (before.charCodeAt(index) !== after.charCodeAt(index)) {
      return index;
    }
  }

  return length;
};

const isLowSurrogate: (code: number) => boolean = (code: number): boolean => {
  return code >= 0xdc00 && code <= 0xdfff;
};

const isHighSurrogate: (code: number) => boolean = (code: number): boolean => {
  return code >= 0xd800 && code <= 0xdbff;
};

/*
 * The characters of a text from `start`, at most `limit` of them, saying how
 * many are left out on either side. Never cuts a character written as two
 * (an emoji) in half.
 */
const excerpt: (text: string, start: number, limit: number) => string = (
  text: string,
  start: number,
  limit: number,
): string => {
  let from: number = Math.max(0, Math.min(start, text.length));
  let to: number = Math.min(text.length, from + limit);

  if (from > 0 && from < text.length && isLowSurrogate(text.charCodeAt(from))) {
    from += 1;
  }

  if (
    to < text.length &&
    to > from &&
    isHighSurrogate(text.charCodeAt(to - 1))
  ) {
    to -= 1;
  }

  const before: string = from > 0 ? `[… ${formatCount(from)} characters] ` : "";
  const after: string =
    to < text.length
      ? ` [… ${formatCount(text.length - to)} more characters]`
      : "";

  return `${before}${text.slice(from, to)}${after}`;
};

// A text as an entry keeps it: whole up to the limit, else its start.
export const limitText: (text: string, limit?: number | undefined) => string = (
  text: string,
  limit?: number | undefined,
): string => {
  const max: number = limit || AUDIT_LOG_TEXT_LIMIT;

  return text.length <= max ? text : excerpt(text, 0, max);
};

/*
 * Two texts as an entry keeps them: whole when both fit, else the same
 * window of each, starting a little before where they first differ - so a
 * change to the end of a long description still shows what changed.
 */
export const limitChangedText: (data: {
  before: string;
  after: string;
  limit?: number | undefined;
}) => { before: string; after: string } = (data: {
  before: string;
  after: string;
  limit?: number | undefined;
}): { before: string; after: string } => {
  const max: number = data.limit || AUDIT_LOG_TEXT_LIMIT;

  if (data.before.length <= max && data.after.length <= max) {
    return { before: data.before, after: data.after };
  }

  const start: number = Math.max(
    0,
    getFirstDifference(data.before, data.after) - CONTEXT_BEFORE_DIFFERENCE,
  );

  return {
    before: excerpt(data.before, Math.min(start, data.before.length), max),
    after: excerpt(data.after, Math.min(start, data.after.length), max),
  };
};
