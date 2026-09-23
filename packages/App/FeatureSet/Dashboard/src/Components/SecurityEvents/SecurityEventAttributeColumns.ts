import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { JSONObject } from "Common/Types/JSON";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import { readLegacySerializedArray } from "Common/Utils/LegacySerializedArray";
import UserPreferences, {
  UserPreferenceType,
} from "Common/Utils/UserPreferences";
import { SECURITY_EVENTS_TABLE_ID } from "./SecurityEventsTimeRange";

/*
 * Source attributes the viewer has chosen to see on every event row.
 *
 * A source such as Google SecOps flattens its whole payload into the event's
 * `attributes` map — hundreds of keys per detection, and a different set per
 * rule — so no fixed list of chips can carry the one fact a SOC keys off
 * (the target's first name, the office it sits in). The viewer picks those
 * keys, and each listed row grows a chip for every one of them it carries.
 *
 * Kept out of the components so App/Tests can pin the labelling, the value
 * rules and the storage shape without rendering a list.
 */

export interface SecurityEventAttributeColumn {
  // The attribute key exactly as it sits in the event's `attributes` map.
  key: string;
  // The short name the row's chip shows; the full key is its tooltip.
  label: string;
}

/*
 * The retired model table kept its layout — attribute columns included — as
 * a ModelTable ColumnPreference, and named each attribute column
 * `attributes.<key>`. Spelled out here rather than imported: those helpers
 * live beside React components, and this module has to load without React.
 */
const LEGACY_ATTRIBUTE_COLUMN_ID_PREFIX: string = "attributes.";

interface LegacyColumnPreference {
  order?: unknown;
  hidden?: unknown;
}

/*
 * A label is the key's last two segments: `user.firstName` says whose first
 * name it is, where a bare `name` or `city` would not.
 */
const MIN_LABEL_SEGMENTS: number = 2;

const NUMERIC_SEGMENT_REGEX: RegExp = /^\d+$/;

/*
 * Whatever came out of storage or a picker, as an ordered list of keys:
 * trimmed, de-duplicated, empties and non-strings dropped. The order is the
 * viewer's own and is kept — unlike the picker's key list, this one is not
 * sorted.
 */
export function normalizeSecurityEventAttributeColumnKeys(
  keys: unknown,
): Array<string> {
  const values: Array<unknown> | null = readLegacySerializedArray(keys);

  if (!values) {
    return [];
  }

  const seen: Set<string> = new Set();
  const normalized: Array<string> = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed: string = value.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function isNumericSegment(segment: string | undefined): boolean {
  return NUMERIC_SEGMENT_REGEX.test(segment || "");
}

/*
 * The first label length worth trying for one key: its last two segments,
 * and one more for every array index the label would otherwise start on —
 * `detectionFields.0.value` rather than `0.value`.
 */
function getInitialLabelSegmentCount(segments: Array<string>): number {
  let count: number = Math.min(MIN_LABEL_SEGMENTS, segments.length);

  while (
    count < segments.length &&
    isNumericSegment(segments[segments.length - count])
  ) {
    count++;
  }

  return count;
}

/*
 * The chosen keys with the chip label each one reads as on a row.
 *
 * Labels are short suffixes of the key, grown only as far as it takes to
 * tell the chosen keys apart: `principal.user.firstName` and
 * `target.user.firstName` would both read `user.firstName`, which on a SIEM
 * row is the one mix-up that matters, so both grow a segment until they
 * differ.
 */
export function buildSecurityEventAttributeColumns(
  keys: Array<string>,
): Array<SecurityEventAttributeColumn> {
  const normalizedKeys: Array<string> =
    normalizeSecurityEventAttributeColumnKeys(keys);

  const segmentsByKey: Array<Array<string>> = normalizedKeys.map(
    (key: string): Array<string> => {
      return key.split(".");
    },
  );

  const counts: Array<number> = segmentsByKey.map(
    (segments: Array<string>): number => {
      return getInitialLabelSegmentCount(segments);
    },
  );

  const labelAt: (index: number) => string = (index: number): string => {
    const segments: Array<string> = segmentsByKey[index] || [];
    return segments.slice(segments.length - (counts[index] || 0)).join(".");
  };

  /*
   * Terminates: every pass either lengthens a label or stops, and a label
   * cannot grow past its whole key — two distinct keys never share one.
   */
  let isGrowing: boolean = true;

  while (isGrowing) {
    isGrowing = false;

    const indexesByLabel: Map<string, Array<number>> = new Map();

    normalizedKeys.forEach((_key: string, index: number) => {
      const label: string = labelAt(index);
      indexesByLabel.set(label, [...(indexesByLabel.get(label) || []), index]);
    });

    for (const indexes of indexesByLabel.values()) {
      if (indexes.length < 2) {
        continue;
      }

      for (const index of indexes) {
        const segments: Array<string> = segmentsByKey[index] || [];

        if ((counts[index] || 0) < segments.length) {
          counts[index] = (counts[index] || 0) + 1;
          isGrowing = true;
        }
      }
    }
  }

  return normalizedKeys.map(
    (key: string, index: number): SecurityEventAttributeColumn => {
      return { key: key, label: labelAt(index) };
    },
  );
}

/*
 * One attribute of one event, as the text its chip shows. Absent, null and
 * whitespace-only all read as "" — the row then leaves the chip off, the same
 * as it does for a typed field the source did not send.
 */
export function getSecurityEventAttributeValue(
  event: SecurityEvent,
  key: string,
): string {
  const attributes: JSONObject = (event.attributes || {}) as JSONObject;
  const value: unknown = attributes[key];

  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

/*
 * Adds a key that is not chosen yet, or removes one that is — what the
 * drawer's per-attribute toggle does.
 */
export function toggleSecurityEventAttributeColumnKey(
  keys: Array<string>,
  key: string,
): Array<string> {
  const trimmed: string = key.trim();

  if (!trimmed) {
    return normalizeSecurityEventAttributeColumnKeys(keys);
  }

  if (keys.includes(trimmed)) {
    return keys.filter((existing: string): boolean => {
      return existing !== trimmed;
    });
  }

  return normalizeSecurityEventAttributeColumnKeys([...keys, trimmed]);
}

/*
 * Moves one chosen key a step earlier (-1) or later (1). A step off either
 * end leaves the order alone.
 */
export function moveSecurityEventAttributeColumnKey(
  keys: Array<string>,
  key: string,
  direction: -1 | 1,
): Array<string> {
  const index: number = keys.indexOf(key);
  const nextIndex: number = index + direction;

  if (index === -1 || nextIndex < 0 || nextIndex >= keys.length) {
    return keys;
  }

  const next: Array<string> = [...keys];
  next[index] = keys[nextIndex] as string;
  next[nextIndex] = key;

  return next;
}

export interface SecurityEventAttributeKeySearchResult {
  // The first `limit` keys that match, in the order they were given.
  keys: Array<string>;
  // How many keys matched in all, so the picker can say it is showing a slice.
  total: number;
}

/*
 * The picker's search over the project's attribute keys.
 *
 * Every whitespace-separated word has to appear somewhere in the key, in any
 * order and any case — `user firstname` finds
 * `collectionElements.0.references.0.event.target.user.firstName` without
 * the reader typing the path. Keys already chosen are left out.
 */
export function searchSecurityEventAttributeKeys(data: {
  keys: Array<string>;
  query: string;
  excludeKeys?: Array<string> | undefined;
  limit: number;
}): SecurityEventAttributeKeySearchResult {
  const words: Array<string> = data.query
    .toLowerCase()
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  const excluded: Set<string> = new Set(data.excludeKeys || []);
  const matches: Array<string> = [];
  let total: number = 0;

  for (const key of data.keys) {
    if (excluded.has(key)) {
      continue;
    }

    const lowerKey: string = key.toLowerCase();

    const isMatch: boolean = words.every((word: string): boolean => {
      return lowerKey.includes(word);
    });

    if (!isMatch) {
      continue;
    }

    total++;

    if (matches.length < data.limit) {
      matches.push(key);
    }
  }

  return { keys: matches, total: total };
}

/*
 * The keys the picker offers: every key the project's events have been seen
 * with, plus every key on the events listed right now. The server's list is
 * sampled from recent events and capped, so an attribute the reader can see
 * on a row must not be missing from the picker just because it fell outside
 * that sample.
 */
export function mergeSecurityEventAttributeKeys(data: {
  attributeKeys: Array<string>;
  events: Array<SecurityEvent>;
}): Array<string> {
  const keys: Set<string> = new Set(
    data.attributeKeys.filter((key: string): boolean => {
      return typeof key === "string" && key.trim().length > 0;
    }),
  );

  for (const event of data.events) {
    for (const key of Object.keys(event.attributes || {})) {
      if (key.trim()) {
        keys.add(key);
      }
    }
  }

  return Array.from(keys).sort((a: string, b: string): number => {
    return a.localeCompare(b);
  });
}

// --- Where the choice lives ---

/*
 * A personal, presentational preference, so it lives in this browser next to
 * the other explorers' column layouts rather than on the server — the same
 * call the logs explorer and the retired model table made. Per project,
 * because two projects fed by different sources share no attribute keys.
 */
export function getSecurityEventAttributeColumnsStorageKey(
  projectId: string,
): string {
  return `security-events-attribute-columns:${projectId || "global"}`;
}

/*
 * The attribute columns the retired model table was showing for this browser.
 *
 * That table stored its layout under one key for every project, as column
 * ids in `order` with the switched-off ones in `hidden`. Only the columns it
 * was actually showing are carried over.
 */
export function readLegacySecurityEventAttributeColumnKeys(): Array<string> {
  let preference: LegacyColumnPreference | null = null;

  try {
    preference = UserPreferences.getUserPreferenceByTypeAsJSON({
      key: SECURITY_EVENTS_TABLE_ID,
      userPreferenceType: UserPreferenceType.BaseModelTableColumns,
    }) as LegacyColumnPreference | null;
  } catch {
    return [];
  }

  if (!preference) {
    return [];
  }

  const order: Array<unknown> =
    readLegacySerializedArray(preference.order) || [];
  const hidden: Set<unknown> = new Set(
    readLegacySerializedArray(preference.hidden) || [],
  );

  const keys: Array<string> = [];

  for (const columnId of order) {
    if (
      typeof columnId !== "string" ||
      hidden.has(columnId) ||
      !columnId.startsWith(LEGACY_ATTRIBUTE_COLUMN_ID_PREFIX)
    ) {
      continue;
    }

    keys.push(columnId.slice(LEGACY_ATTRIBUTE_COLUMN_ID_PREFIX.length));
  }

  return normalizeSecurityEventAttributeColumnKeys(keys);
}

/*
 * The viewer's chosen keys for this project. Nothing stored yet means they
 * have never touched the picker here, so whatever the retired table was
 * showing is carried over; an empty list stored means they cleared it, and
 * stays cleared. Storage that is unavailable or holds garbage reads as no
 * columns, never as a broken page.
 */
export function readSecurityEventAttributeColumnKeys(
  projectId: string,
): Array<string> {
  let stored: unknown = null;

  try {
    stored = LocalStorage.getItem(
      getSecurityEventAttributeColumnsStorageKey(projectId),
    );
  } catch {
    return [];
  }

  if (stored === null || stored === undefined) {
    return readLegacySecurityEventAttributeColumnKeys();
  }

  return normalizeSecurityEventAttributeColumnKeys(stored);
}

export function writeSecurityEventAttributeColumnKeys(
  projectId: string,
  keys: Array<string>,
): void {
  try {
    LocalStorage.setItem(
      getSecurityEventAttributeColumnsStorageKey(projectId),
      normalizeSecurityEventAttributeColumnKeys(keys),
    );
  } catch {
    // Not remembering the choice is fine; the rows still show it.
  }
}
