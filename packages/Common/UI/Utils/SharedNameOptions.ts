import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { SharedNameKind } from "../../Types/Database/SharedNames";
import { getNameKey, normalizeName } from "../../Types/Database/UniqueName";
import OneUptimeDate from "../../Types/Date";
import { writeReaderDay, writeReaderMoment } from "./ReaderMoments";
import { Translator, translationKey } from "./TranslateTemplate";

/*
 * RECORDS THAT SHARE A NAME, TOLD APART WHERE THEY ARE PICKED (#10064).
 *
 * Teams (#9674), labels (#9723), on-call policies and on-call schedules
 * (#9742) each have a name of their own in a project now, but records named
 * alike before that keep their names. Their lists mark each one and offer
 * Rename (#9746, #9856), yet every picker and filter drew such twins
 * alike - the very thing the marks warn about: two "Production" labels in
 * a monitor's Labels, two "Primary" schedules in an escalation rule.
 *
 * This is the one rule every picker and filter of those kinds draws them
 * by, so the places that build their options cannot drift apart:
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
 * records: what matters is what reads alike in this list. The Dropdown and
 * the facet chips draw the marks (getSharedNameMarks), in the reader's
 * language; the builders only hand each option its facts.
 *
 * React-free: the builders, the components and the tests read the same
 * rule. A source of the Dashboard's string extractor (Common/UI).
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
 * its paragraphs one space, cut after a word with "..." past a sentence or
 * so. Empty for none.
 */
export const getShortDescription: (description: unknown) => string = (
  description: unknown,
): string => {
  const text: string = normalizeName(description);

  if (text.length <= SHARED_NAME_DESCRIPTION_LENGTH) {
    return text;
  }

  const cut: string = text.slice(0, SHARED_NAME_DESCRIPTION_LENGTH);
  const lastSpace: number = cut.lastIndexOf(" ");

  return `${(lastSpace > SHARED_NAME_DESCRIPTION_LENGTH / 2
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
 * them has the same; else the day it was made when none was made that day;
 * else the moment.
 */
const getDetail: (data: {
  twin: SharedNameFacts;
  others: Array<SharedNameFacts>;
  translator: Translator;
}) => { detail?: string | undefined; isDetailAsWritten: boolean } = (data: {
  twin: SharedNameFacts;
  others: Array<SharedNameFacts>;
  translator: Translator;
}): { detail?: string | undefined; isDetailAsWritten: boolean } => {
  const description: string = getShortDescription(data.twin.description);

  if (
    description &&
    !data.others.some((other: SharedNameFacts): boolean => {
      return (
        getShortDescription(other.description).toLowerCase() ===
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

  const day: string = writeReaderDay(createdAt);
  const sameDay: boolean = data.others.some(
    (other: SharedNameFacts): boolean => {
      return (
        Boolean(other.createdAt) && writeReaderDay(other.createdAt!) === day
      );
    },
  );

  return {
    detail: data.translator.translateTemplate(SHARED_NAME_CREATED_DETAIL, {
      date: sameDay ? writeReaderMoment(createdAt) : day,
    }),
    isDetailAsWritten: false,
  };
};

/*
 * THE TWINS AMONG A PICKER'S OPTIONS, each with its mark, by its value
 * (getSharedNameOptionKey). An option appears once whatever group of the
 * menu holds it; options of different kinds are never twins, and an
 * option without facts is never marked.
 */
export const getSharedNameMarks: (
  options: ReadonlyArray<SharedNameOption>,
  translator: Translator,
) => Map<string, SharedNameMark> = (
  options: ReadonlyArray<SharedNameOption>,
  translator: Translator,
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
        pill: translator.translateText(SHARED_NAME_PILLS[twin.kind]) || "",
        ...getDetail({ twin, others, translator }),
      });
    }
  }

  return marks;
};
