/*
 * What a "who to page" setting holds, taken apart for the form that shows it.
 *
 * A Page step's Users, Teams, On-Call Schedules or On-Call Policies setting
 * is a list. Each entry is one of three things:
 *
 *   - a record picked from the project - a person, a team, a schedule, a
 *     policy - stored as its id;
 *   - a value from an earlier step or a variable, stored as its
 *     {{reference}}: an incident's owners, a list a webhook sent;
 *   - anything else, as it was written: an email address typed into a
 *     workflow made through the API, or text nobody can read as either.
 *
 * The form shows the first as chips with names, the second as value chips,
 * and the third as it is written, so nothing a setting holds is ever hidden
 * from the person editing it. It is saved as it was read: a list of strings,
 * the records first.
 *
 * Pure: no DOM, no network.
 */

import ObjectID from "../../../../Types/ObjectID";
import { parseTemplateExpressions } from "../../../../Types/Workflow/TemplateSyntax";

export enum RecordListEntryType {
  // One of the project's records, by its id.
  Record = "Record",
  // A value from an earlier step or a variable: text that holds a {{reference}}.
  Reference = "Reference",
  // Anything else, as written.
  Text = "Text",
}

export interface RecordListEntry {
  type: RecordListEntryType;
  // The id, the reference, or the text.
  value: string;
}

// The keys a record's own id is found under, when a whole record is stored.
const RECORD_ID_KEYS: Array<string> = ["_id", "id"];

type ClassifyFunction = (text: string) => RecordListEntryType;

const classify: ClassifyFunction = (text: string): RecordListEntryType => {
  if (parseTemplateExpressions(text).length > 0) {
    return RecordListEntryType.Reference;
  }

  if (ObjectID.isValidUUID(text)) {
    return RecordListEntryType.Record;
  }

  return RecordListEntryType.Text;
};

type EntryKeyFunction = (entry: RecordListEntry) => string;

// Ids are the same whatever their case; everything else is as written.
const entryKey: EntryKeyFunction = (entry: RecordListEntry): string => {
  return entry.type === RecordListEntryType.Record
    ? `${entry.type}:${entry.value.toLowerCase()}`
    : `${entry.type}:${entry.value}`;
};

type ReadItemFunction = (item: unknown) => string;

// One stored entry as text: a string, a record by its id, anything else as JSON.
const readItem: ReadItemFunction = (item: unknown): string => {
  if (item === undefined || item === null) {
    return "";
  }

  if (typeof item === "string") {
    return item.trim();
  }

  if (typeof item === "object" && !Array.isArray(item)) {
    const record: Record<string, unknown> = item as Record<string, unknown>;

    for (const key of RECORD_ID_KEYS) {
      const id: unknown = record[key];

      if (typeof id === "string" && id.trim()) {
        return id.trim();
      }
    }
  }

  if (typeof item === "object") {
    return JSON.stringify(item);
  }

  return String(item);
};

export type ReadRecordListEntriesFunction = (
  value: unknown,
) => Array<RecordListEntry>;

/**
 * The entries of a stored setting, each once, in the order they were stored.
 * A setting stored as one string - an older workflow, one written by hand -
 * is read as a list written as JSON when it is one, and as one entry when it
 * is not.
 */
export const readRecordListEntries: ReadRecordListEntriesFunction = (
  value: unknown,
): Array<RecordListEntry> => {
  let items: Array<unknown> = [];

  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === "string") {
    const text: string = value.trim();

    if (text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text);
        items = Array.isArray(parsed) ? parsed : [text];
      } catch {
        items = [text];
      }
    } else {
      items = [text];
    }
  } else if (value !== undefined && value !== null) {
    items = [value];
  }

  const entries: Array<RecordListEntry> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of items) {
    const text: string = readItem(item);

    if (!text) {
      continue;
    }

    const entry: RecordListEntry = { type: classify(text), value: text };
    const key: string = entryKey(entry);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    entries.push(entry);
  }

  return entries;
};

export type GetRecordIdsFunction = (
  entries: Array<RecordListEntry>,
) => Array<string>;

// The ids of the records picked, in order.
export const getRecordIds: GetRecordIdsFunction = (
  entries: Array<RecordListEntry>,
): Array<string> => {
  return entries
    .filter((entry: RecordListEntry): boolean => {
      return entry.type === RecordListEntryType.Record;
    })
    .map((entry: RecordListEntry): string => {
      return entry.value;
    });
};

export type GetOtherEntriesFunction = (
  entries: Array<RecordListEntry>,
) => Array<RecordListEntry>;

// What the setting holds that is not a picked record, in order.
export const getOtherEntries: GetOtherEntriesFunction = (
  entries: Array<RecordListEntry>,
): Array<RecordListEntry> => {
  return entries.filter((entry: RecordListEntry): boolean => {
    return entry.type !== RecordListEntryType.Record;
  });
};

export type ToStoredRecordListFunction = (data: {
  recordIds: Array<string>;
  others: Array<RecordListEntry>;
}) => Array<string>;

/**
 * The setting as it is saved: the picked records' ids, then everything else
 * it holds, each once.
 */
export const toStoredRecordList: ToStoredRecordListFunction = (data: {
  recordIds: Array<string>;
  others: Array<RecordListEntry>;
}): Array<string> => {
  return readRecordListEntries([
    ...data.recordIds,
    ...data.others.map((entry: RecordListEntry): string => {
      return entry.value;
    }),
  ]).map((entry: RecordListEntry): string => {
    return entry.value;
  });
};

export type WithReferenceFunction = (
  entries: Array<RecordListEntry>,
  reference: string,
) => Array<string>;

// The setting with a value from an earlier step added to it, once.
export const withReference: WithReferenceFunction = (
  entries: Array<RecordListEntry>,
  reference: string,
): Array<string> => {
  return readRecordListEntries([
    ...entries.map((entry: RecordListEntry): string => {
      return entry.value;
    }),
    reference,
  ]).map((entry: RecordListEntry): string => {
    return entry.value;
  });
};

export type WithoutEntryFunction = (
  entries: Array<RecordListEntry>,
  removed: RecordListEntry,
) => Array<string>;

// The setting with one entry taken out.
export const withoutEntry: WithoutEntryFunction = (
  entries: Array<RecordListEntry>,
  removed: RecordListEntry,
): Array<string> => {
  const removedKey: string = entryKey(removed);

  return entries
    .filter((entry: RecordListEntry): boolean => {
      return entryKey(entry) !== removedKey;
    })
    .map((entry: RecordListEntry): string => {
      return entry.value;
    });
};

export type GetWholeReferenceFunction = (text: string) => string | null;

/**
 * The reference an entry is, when it is exactly one {{reference}} and
 * nothing else: what a value chip can name. Null for text built around a
 * reference, or holding several.
 */
export const getWholeReference: GetWholeReferenceFunction = (
  text: string,
): string | null => {
  const trimmed: string = text.trim();
  const expressions: Array<{ startIndex: number; endIndex: number }> =
    parseTemplateExpressions(trimmed);

  if (
    expressions.length === 1 &&
    expressions[0]!.startIndex === 0 &&
    expressions[0]!.endIndex === trimmed.length
  ) {
    return trimmed;
  }

  return null;
};
