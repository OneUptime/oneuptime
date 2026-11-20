import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../Date";
import { Translator, translationKey } from "../Translator";
import { SharedNameKind } from "./SharedNames";
import { getNameKey, normalizeName } from "./UniqueName";

/*
 * RECORDS THAT SHARE A NAME, TOLD APART WHERE THEY ARE PICKED (#10064,
 * #10314).
 *
 * Teams (#9674), labels (#9723), on-call policies and on-call schedules
 * (#9742) each have a name of their own in a project now, but records named
 * alike before that keep their names. Their lists mark each one and offer
 * Rename (#9746, #9856), yet every picker and filter drew such twins
 * alike - the very thing the marks warn about: two "Production" labels in
 * a monitor's Labels, two "Primary" schedules in an escalation rule.
 *
 * This is the one rule every picker and filter of those kinds draws them
 * by - the Dashboard's (Common/UI/Utils/SharedNameOptions) and the chats'
 * (Common/Server/Utils/Workspace/WorkspaceSharedNames) - so the places that
 * build their options cannot drift apart:
 *
 *   - an option of one of the four kinds carries what can tell its record
 *     from another (SharedNameFacts): its description and when it was
 *     made, read with its name (getSharedNameSelect, getSharedNameFacts);
 *   - options of one kind whose names read as one name (getNameKey: case
 *     and spacing aside, as the server compares them) are twins. Each is
 *     marked with the pill its list draws ("Same name as another label")
 *     and a short line that sets it apart from the others: its own
 *     description when no twin has the same one, else the day it was made,
 *     else the moment, when twins were made the same day;
 *   - an option of any other kind, or one with no twin, is drawn as
 *     before.
 *
 * Twins are found among the options a picker offers, not the project's
 * records: what matters is what reads alike in this list. A page writes
 * the day and the moment in its reader's zone and clock, and a chat in the
 * zone on its reader's account (SharedNameDates); the words are the
 * reader's either way (Translator).
 *
 * React-free and server-safe. Its words are the Dashboard's (its string
 * extractor reads them here), and the server's copies of them are the
 * Dashboard's own (Common/Scripts/I18n/ServerLocales'
 * DASHBOARD_SHARED_TEXT_SOURCES).
 */

// What an option carries of its record, to tell it from a twin.
export interface SharedNameFacts {
  kind: SharedNameKind;
  // The record's description, as its owner wrote it.
  description?: string | undefined;
  // When the record was made.
  createdAt?: Date | undefined;
}

// An option a picker or a filter draws, as far as twins are concerned.
export interface SharedNameOption {
  value: unknown;
  label: string;
  sharedName?: SharedNameFacts | undefined;
}

// How a twin is drawn, in the reader's language.
export interface SharedNameMark {
  // The pill beside its name: its list's words.
  pill: string;
  // What sets it apart from its twins; undefined when nothing it carries does.
  detail?: string | undefined;
  /*
   * The detail is the record's own words (its description): drawn as
   * written, in the direction its letters read. Otherwise it is
   * OneUptime's words, already in the reader's language.
   */
  isDetailAsWritten: boolean;
}

/*
 * How a twin's day and moment are written for its reader: a page writes
 * them in the zone and on the clock the reader picked (Common/UI/Utils/
 * ReaderMoments), a chat in the zone on the reader's account.
 */
export interface SharedNameDates {
  // "Nov 5, 2026".
  writeDay: (date: Date) => string;
  // "Nov 5, 2026, 5:14 AM": for twins made the same day.
  writeMoment: (date: Date) => string;
}

// How twins are marked for one reader.
export interface SharedNameReading {
  // The reader's words: the pill and "Created {{date}}".
  translator: Translator;
  dates: SharedNameDates;
  /*
   * How much of a description the picker shows: a sentence or so on a page
   * (SHARED_NAME_DESCRIPTION_LENGTH), less in a chat's one-line option.
   */
  descriptionLength?: number | undefined;
}

// The kinds whose twins are marked, by their table.
const KIND_BY_TABLE: Readonly<Record<string, SharedNameKind>> = {
  Team: SharedNameKind.Team,
  Label: SharedNameKind.Label,
  OnCallDutyPolicy: SharedNameKind.OnCallPolicy,
  OnCallDutyPolicySchedule: SharedNameKind.OnCallSchedule,
};

/*
 * The pill a twin wears in a picker: the words its list's pill says
 * (SharedNameWords in the Dashboard reads these).
 */
export const SHARED_NAME_PILLS: Readonly<Record<SharedNameKind, string>> = {
  [SharedNameKind.Team]: translationKey("Same name as another team"),
  [SharedNameKind.Label]: translationKey("Same name as another label"),
  [SharedNameKind.OnCallPolicy]: translationKey("Same name as another policy"),
  [SharedNameKind.OnCallSchedule]: translationKey(
    "Same name as another schedule",
  ),
};

// A twin known by when it was made: "Created Nov 5, 2026".
export const SHARED_NAME_CREATED_DETAIL: string =
  translationKey("Created {{date}}");

/*
 * How much of a description a picker's line shows: a sentence or so. Its
 * whole is on the record's own page.
 */
export const SHARED_NAME_DESCRIPTION_LENGTH: number = 80;

/*
 * The fewest characters a description is cut to: fewer says nothing that
 * tells a record from another.
 */
const SHORTEST_DESCRIPTION_LENGTH: number = 8;

const ELLIPSIS: string = "…";

// The kind of a table's records, when its twins are marked.
export const getSharedNameKindOfTable: (
  tableName: string | null | undefined,
) => SharedNameKind | null = (
  tableName: string | null | undefined,
): SharedNameKind | null => {
  return (tableName && KIND_BY_TABLE[tableName]) || null;
};

/*
 * The columns a read of a model selects beside its name, so its twins can
 * be told apart: none for a model of any other kind.
 */
export const getSharedNameSelect: (
  model: BaseModel | { new (): BaseModel } | null | undefined,
) => Record<string, true> = (
  model: BaseModel | { new (): BaseModel } | null | undefined,
): Record<string, true> => {
  if (!model) {
    return {};
  }

  const instance: BaseModel = typeof model === "function" ? new model() : model;

  if (!getSharedNameKindOfTable(instance.tableName)) {
    return {};
  }

  return { description: true, createdAt: true };
};

// A date as a record holds it: a Date, or the text the API sent.
const toDate: (value: unknown) => Date | undefined = (
  value: unknown,
): Date | undefined => {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "string" && value.trim()) {
    const date: Date = OneUptimeDate.fromString(value);

    return isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
};

/*
 * What an option of a record carries to tell it from a twin: its kind,
 * description and when it was made. Undefined for a record of any other
 * kind, so its option is drawn as before.
 */
export const getSharedNameFacts: (
  record: BaseModel | null | undefined,
) => SharedNameFacts | undefined = (
  record: BaseModel | null | undefined,
): SharedNameFacts | undefined => {
  const kind: SharedNameKind | null = getSharedNameKindOfTable(
    record?.tableName,
  );

  if (!record || !kind) {
    return undefined;
  }

  const fields: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;
  const description: unknown = fields["description"];

  return {
    kind: kind,
    description: typeof description === "string" ? description : undefined,
    createdAt: toDate(fields["createdAt"]),
  };
};

/*
 * A description as a picker's line shows it: on one line, the spaces of
 * its paragraphs one space, cut after a word with "..." past `length`
 * characters - a sentence or so on a page. Empty for none. Cut, it is at
 * most `length` characters and the "...".
 */
export const getShortDescription: (
  description: unknown,
  length?: number,
) => string = (
  description: unknown,
  length: number = SHARED_NAME_DESCRIPTION_LENGTH,
): string => {
  const text: string = normalizeName(description);
  const room: number = Math.max(
    SHORTEST_DESCRIPTION_LENGTH,
    Math.floor(length),
  );

  if (text.length <= room) {
    return text;
  }

  const cut: string = text.slice(0, room);
  const lastSpace: number = cut.lastIndexOf(" ");

  return `${(lastSpace > room / 2
    ? cut.slice(0, lastSpace)
    : cut
  ).trimEnd()}${ELLIPSIS}`;
};

// The option's key in the marks: its value as text.
export const getSharedNameOptionKey: (value: unknown) => string = (
  value: unknown,
): string => {
  return String(value);
};

/*
 * What sets one twin apart from the others: its description when none of
 * them has the same - as far as the picker shows it; else the day it was
 * made when none was made that day; else the moment.
 */
const getDetail: (data: {
  twin: SharedNameFacts;
  others: Array<SharedNameFacts>;
  reading: SharedNameReading;
}) => { detail?: string | undefined; isDetailAsWritten: boolean } = (data: {
  twin: SharedNameFacts;
  others: Array<SharedNameFacts>;
  reading: SharedNameReading;
}): { detail?: string | undefined; isDetailAsWritten: boolean } => {
  const length: number =
    data.reading.descriptionLength ?? SHARED_NAME_DESCRIPTION_LENGTH;
  const description: string = getShortDescription(
    data.twin.description,
    length,
  );

  if (
    description &&
    !data.others.some((other: SharedNameFacts): boolean => {
      return (
        getShortDescription(other.description, length).toLowerCase() ===
        description.toLowerCase()
      );
    })
  ) {
    return { detail: description, isDetailAsWritten: true };
  }

  const createdAt: Date | undefined = data.twin.createdAt;

  if (!createdAt) {
    return { detail: undefined, isDetailAsWritten: false };
  }

  const dates: SharedNameDates = data.reading.dates;
  const day: string = dates.writeDay(createdAt);
  const sameDay: boolean = data.others.some(
    (other: SharedNameFacts): boolean => {
      return (
        Boolean(other.createdAt) && dates.writeDay(other.createdAt!) === day
      );
    },
  );

  return {
    detail: data.reading.translator.translateTemplate(
      SHARED_NAME_CREATED_DETAIL,
      {
        date: sameDay ? dates.writeMoment(createdAt) : day,
      },
    ),
    isDetailAsWritten: false,
  };
};

/*
 * THE TWINS AMONG A PICKER'S OPTIONS, each with its mark, by its value
 * (getSharedNameOptionKey), for one reader. An option appears once
 * whatever group of the menu holds it; options of different kinds are
 * never twins, and an option without facts is never marked.
 */
export const getSharedNameMarksFor: (
  options: ReadonlyArray<SharedNameOption>,
  reading: SharedNameReading,
) => Map<string, SharedNameMark> = (
  options: ReadonlyArray<SharedNameOption>,
  reading: SharedNameReading,
): Map<string, SharedNameMark> => {
  const marks: Map<string, SharedNameMark> = new Map<string, SharedNameMark>();
  const twinsByName: Map<string, Map<string, SharedNameFacts>> = new Map<
    string,
    Map<string, SharedNameFacts>
  >();

  for (const option of options) {
    const nameKey: string = getNameKey(option.label);

    if (!option.sharedName || !nameKey) {
      continue;
    }

    const groupKey: string = `${option.sharedName.kind}\u0000${nameKey}`;
    const twins: Map<string, SharedNameFacts> =
      twinsByName.get(groupKey) || new Map<string, SharedNameFacts>();

    twins.set(getSharedNameOptionKey(option.value), option.sharedName);
    twinsByName.set(groupKey, twins);
  }

  for (const twins of twinsByName.values()) {
    if (twins.size < 2) {
      continue;
    }

    for (const [key, twin] of twins) {
      const others: Array<SharedNameFacts> = Array.from(twins.entries())
        .filter((entry: [string, SharedNameFacts]): boolean => {
          return entry[0] !== key;
        })
        .map((entry: [string, SharedNameFacts]): SharedNameFacts => {
          return entry[1];
        });

      marks.set(key, {
        pill:
          reading.translator.translateText(SHARED_NAME_PILLS[twin.kind]) || "",
        ...getDetail({ twin, others, reading }),
      });
    }
  }

  return marks;
};

// Whether any two of the options are twins: nothing to mark otherwise.
export const hasSharedNameTwins: (
  options: ReadonlyArray<SharedNameOption>,
) => boolean = (options: ReadonlyArray<SharedNameOption>): boolean => {
  const seen: Map<string, string> = new Map<string, string>();

  for (const option of options) {
    const nameKey: string = getNameKey(option.label);

    if (!option.sharedName || !nameKey) {
      continue;
    }

    const groupKey: string = `${option.sharedName.kind}\u0000${nameKey}`;
    const key: string = getSharedNameOptionKey(option.value);
    const first: string | undefined = seen.get(groupKey);

    if (first === undefined) {
      seen.set(groupKey, key);
      continue;
    }

    if (first !== key) {
      return true;
    }
  }

  return false;
};
