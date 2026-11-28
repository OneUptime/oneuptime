import { SHARED_NAME_CREATED_DETAIL } from "../../../Types/Database/SharedNameMarks";
import { SharedNamesAnswer } from "../../../Types/Database/SharedNames";
import OneUptimeDate from "../../../Types/Date";
import { PluralTemplate } from "../../../Types/Translator";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * RECORDS OF A LIST THAT SHARE A NAME, MARKED (#11021).
 *
 * While a project requires unique names (#10761), no new monitor, template,
 * API key or pipeline can take a name another of its kind has; records that
 * shared one before keep it, valid, until someone renames them. Project
 * Settings > Project lists them, but a list of monitors drew two "API Health
 * Check" rows alike, and so did every picker.
 *
 * Every list of a kind Require Unique Names holds (@UniqueNameWhenRequired)
 * now marks a record whose name another of its kind has, as the lists of
 * teams, labels, on-call policies and schedules do (#9746): a pill beside
 * its name - "Same name as another monitor" - and the day it was made, to
 * tell the twins apart, with a note above the list that counts them. The
 * shared list does it (ModelTable, TwinMarks), keyed off the decorator, so a
 * kind marked tomorrow is marked in its list without a line of its own; a
 * list drawn by hand marks its records with the same pieces.
 *
 * Which records are twins is the server's to say (GET /shared-names/<Table>,
 * Types/Database/SharedNames): a list's page may hold one twin of two, and
 * only twins the reader may read are ever marked - a mark never says that a
 * record they may not read has the name.
 *
 * React-free: the words and the rule are read by tests without rendering.
 */

// The pill beside a twin's name: "Same name as another monitor".
export const TWIN_MARK_PILL: string = translationKey(
  "Same name as another {{kind}}",
);

// Under the pointer on the pill: why it is there, and what to do.
export const TWIN_MARK_TOOLTIP: string = translationKey(
  "Another {{kind}} in this project has this name, so pickers can't tell them apart. Open each to see which is which, then rename one.",
);

// Above the list while records share a name: how many, and what to do.
export const TWIN_MARKS_NOTE: PluralTemplate = {
  one: translationKey(
    "{{count}} {{kind}} has the same name as another {{kind}}, and pickers can't tell them apart. Open each to see which is which, then rename one.",
  ),
  other: translationKey(
    "{{count}} {{kinds}} have the same name as another {{kind}}, and pickers can't tell them apart. Open each to see which is which, then rename one.",
  ),
};

// Beside the pill: "Created Nov 5, 2026", the words the pickers use (#10064).
export const TWIN_MARK_CREATED: string = SHARED_NAME_CREATED_DETAIL;

// The marks' test ids: the pill and the note are the four kinds' (#9746).
export const TWIN_MARK_PILL_TEST_ID: string = "shared-name-pill";
export const TWIN_MARKS_NOTE_TEST_ID: string = "shared-names-note";
export const TWIN_MARK_CREATED_TEST_ID: string = "shared-name-created";

// How a twin's day and moment are written for its reader (ReaderMoments).
export interface TwinDates {
  // "Nov 5, 2026".
  writeDay: (date: Date) => string;
  // "Nov 5, 2026, 5:14 AM": for twins made the same day.
  writeMoment: (date: Date) => string;
}

// The twins of an answer: each record's group, and when each was made.
export interface Twins {
  // A twin's id, in lower case, to the ids of its group, itself included.
  groupOf: Map<string, ReadonlyArray<string>>;
  createdAt: Map<string, Date>;
}

export const NO_TWINS: Twins = {
  groupOf: new Map<string, ReadonlyArray<string>>(),
  createdAt: new Map<string, Date>(),
};

// A record's id as the answer writes it.
export const getTwinId: (id: unknown) => string = (id: unknown): string => {
  return id ? String(id).toLowerCase() : "";
};

// A date as the answer writes it: a Date, or nothing for one that is not.
const toDate: (value: string | undefined) => Date | undefined = (
  value: string | undefined,
): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const date: Date = OneUptimeDate.fromString(value);

  return isNaN(date.getTime()) ? undefined : date;
};

/*
 * The twins an answer names. A group is two records or more (the server
 * answers no other for these kinds); one of fewer marks nothing.
 */
export const getTwins: (answer: SharedNamesAnswer) => Twins = (
  answer: SharedNamesAnswer,
): Twins => {
  const groupOf: Map<string, ReadonlyArray<string>> = new Map<
    string,
    ReadonlyArray<string>
  >();
  const createdAt: Map<string, Date> = new Map<string, Date>();

  for (const group of answer.groups) {
    const ids: Array<string> = Array.from(
      new Set(group.map(getTwinId).filter(Boolean)),
    );

    if (ids.length < 2) {
      continue;
    }

    for (const id of ids) {
      groupOf.set(id, ids);

      const date: Date | undefined = toDate(answer.createdAt?.[id]);

      if (date) {
        createdAt.set(id, date);
      }
    }
  }

  return { groupOf, createdAt };
};

// How many records the twins are.
export const getTwinCount: (twins: Twins) => number = (
  twins: Twins,
): number => {
  return twins.groupOf.size;
};

/*
 * When a twin was made, as its mark writes it: its day - or the moment,
 * when another twin of its group was made the same day, so the two still
 * read apart. Null for a record that is no twin, or whose date is unknown.
 */
export const getTwinCreatedText: (data: {
  twins: Twins;
  id: unknown;
  dates: TwinDates;
}) => string | null = (data: {
  twins: Twins;
  id: unknown;
  dates: TwinDates;
}): string | null => {
  const id: string = getTwinId(data.id);
  const group: ReadonlyArray<string> | undefined = data.twins.groupOf.get(id);
  const createdAt: Date | undefined = data.twins.createdAt.get(id);

  if (!group || !createdAt) {
    return null;
  }

  const day: string = data.dates.writeDay(createdAt);

  const isSameDayAsAnother: boolean = group.some((other: string): boolean => {
    const otherCreatedAt: Date | undefined = data.twins.createdAt.get(other);

    return (
      other !== id &&
      Boolean(otherCreatedAt) &&
      data.dates.writeDay(otherCreatedAt!) === day
    );
  });

  return isSameDayAsAnother ? data.dates.writeMoment(createdAt) : day;
};
