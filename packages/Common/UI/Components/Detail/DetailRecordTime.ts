import FieldType from "../Types/FieldType";
import OneUptimeDate from "../../../Types/Date";

/*
 * "Can you also show created along the same lines as ID so it doesn't take
 * space up top. Please do this everywhere."
 *
 * When a record was created - and, on the few cards that say so, when it was
 * last updated - is bookkeeping, like the record's own ID: worth a glance,
 * rarely why anyone opened the page. Yet a dozen details cards gave it a row
 * of its own, a label, a clock and a date as tall as the record's name. So
 * Detail takes it out of the grid, as it does the ID (DetailRecordId.ts),
 * and draws it on the small line under the fields, after the ID:
 *
 *   ID dafafe92… [copy]   Created Sep 30 2026, 14:25 BST
 *
 * "The record's creation time" is a FieldType.Date or FieldType.DateTime
 * field on `createdAt`; its last update, the same on `updatedAt`. Pages keep
 * declaring the field as they always have, and the line picks it up. A field
 * drawn by its own getElement is the page's to draw.
 *
 * React-free on purpose, so the rule can be read and tested on its own.
 */

export enum RecordTimeKind {
  Created = "created",
  Updated = "updated",
}

// The column each time is kept in, on every database record.
export const RECORD_TIME_KEYS: Record<RecordTimeKind, string> = {
  [RecordTimeKind.Created]: "createdAt",
  [RecordTimeKind.Updated]: "updatedAt",
};

// The order the line draws them in, after the ID.
export const RECORD_TIME_KINDS: Array<RecordTimeKind> = [
  RecordTimeKind.Created,
  RecordTimeKind.Updated,
];

/*
 * The types a page declares a time with. With a date-only type the line
 * still gives the time of day: it is one line, read the same on every card.
 */
export const RECORD_TIME_FIELD_TYPES: Array<FieldType> = [
  FieldType.Date,
  FieldType.DateTime,
];

export interface RecordTimeFieldLike {
  key?: unknown;
  fieldType?: FieldType | undefined;
  getElement?: unknown;
}

export interface RecordTime {
  kind: RecordTimeKind;
  date: Date;
}

// Which time a field is, or null when it is a field like any other.
export const getRecordTimeKind: (
  field: RecordTimeFieldLike,
) => RecordTimeKind | null = (
  field: RecordTimeFieldLike,
): RecordTimeKind | null => {
  if (
    field.getElement ||
    !field.fieldType ||
    !RECORD_TIME_FIELD_TYPES.includes(field.fieldType) ||
    field.key === null ||
    field.key === undefined
  ) {
    return null;
  }

  const key: string = String(field.key);

  for (const kind of RECORD_TIME_KINDS) {
    if (RECORD_TIME_KEYS[kind] === key) {
      return kind;
    }
  }

  return null;
};

export const isRecordTimeField: (field: RecordTimeFieldLike) => boolean = (
  field: RecordTimeFieldLike,
): boolean => {
  return getRecordTimeKind(field) !== null;
};

/*
 * A stored time, as text, starts with its date: "2026-09-30T13:25:13.000Z",
 * or "2026-09-30 13:25:13" as the database hands it back. Other text is not
 * one, and is not handed to the parser, which would only warn about it.
 */
const STORED_TIME_TEXT: RegExp = /^\d{4}-\d{2}-\d{2}/;

/*
 * The time as a Date, from whatever the item holds: a Date on a loaded
 * model, an ISO string, or the { _type: "DateTime", value } shape a JSON item
 * carries. Anything else - nothing, an empty string, text that is no date -
 * is null, which draws nothing rather than "Invalid date".
 */
export const getRecordTimeValue: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "object"
  ) {
    return null;
  }

  if (typeof value === "string" && !STORED_TIME_TEXT.test(value.trim())) {
    return null;
  }

  let date: Date;

  try {
    date = OneUptimeDate.fromString(value as string | Date);
  } catch {
    return null;
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }

  return date;
};

/*
 * The times a detail's fields declare, read off its item, in the line's
 * order. The first field of each kind counts, as with the ID: a card that
 * declared Created twice still says it once.
 */
export const getRecordTimes: <TField extends RecordTimeFieldLike>(
  fields: Array<TField>,
  readValue: (field: TField) => unknown,
) => Array<RecordTime> = <TField extends RecordTimeFieldLike>(
  fields: Array<TField>,
  readValue: (field: TField) => unknown,
): Array<RecordTime> => {
  const times: Array<RecordTime> = [];

  for (const kind of RECORD_TIME_KINDS) {
    const field: TField | undefined = fields.find(
      (candidate: TField): boolean => {
        return getRecordTimeKind(candidate) === kind;
      },
    );

    if (!field) {
      continue;
    }

    const date: Date | null = getRecordTimeValue(readValue(field));

    if (date) {
      times.push({ kind, date });
    }
  }

  return times;
};

/*
 * What the line shows: the date and the time, in the reader's time zone and
 * clock, exactly as the row it replaces did ("Sep 30 2026, 14:25 BST").
 */
export const getRecordTimeText: (date: Date) => string = (
  date: Date,
): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
};

// What hovering the time shows: all of it, to the second.
export const getRecordTimeFullText: (date: Date) => string = (
  date: Date,
): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    date,
    false,
    true,
  );
};
