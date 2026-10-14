/*
 * A Page step in one line, for its card on the canvas: who it pages and
 * what the page is about - "2 users · New alert", "On call in 1 schedule ·
 * Incident" - in place of the description every step of its kind shares, so
 * a workflow that pages different people on different paths can be read
 * without opening each step.
 *
 * Two short phrases, each a whole translation of its own, joined by a dot:
 * neither is built word by word. The canvas has no names to hand - a pick
 * is stored as an id - so it counts the picks, and says when the people
 * come from an earlier step instead.
 */

import { JSONObject } from "../../../../Types/JSON";
import {
  PageStepTarget,
  PageTargetKind,
  getPageStepTarget,
} from "../../../../Types/Workflow/Components/OnCall";
import {
  PAGE_ARGUMENT_IDS,
  PageAbout,
  readPageAbout,
} from "../../../../Types/Workflow/Components/OnCallPageSettings";
import {
  PluralTemplate,
  translatePlural,
  translateText,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import {
  RecordListEntry,
  RecordListEntryType,
  getOtherEntries,
  getRecordIds,
  readRecordListEntries,
} from "../RecordList/RecordListValue";

// How many of each kind a step pages, as a phrase.
export const PAGE_TARGET_COUNT_TEMPLATES: Record<
  PageTargetKind,
  PluralTemplate
> = {
  [PageTargetKind.User]: {
    one: "{{count}} user",
    other: "{{count}} users",
  },
  [PageTargetKind.Team]: {
    one: "{{count}} team",
    other: "{{count}} teams",
  },
  [PageTargetKind.OnCallSchedule]: {
    one: "On call in {{count}} schedule",
    other: "On call in {{count}} schedules",
  },
  [PageTargetKind.OnCallPolicy]: {
    one: "{{count}} on-call policy",
    other: "{{count}} on-call policies",
  },
};

// Who is paged is only known when the step runs.
export const PAGE_TARGET_FROM_VALUE: Record<PageTargetKind, string> = {
  [PageTargetKind.User]: translationKey("Users from an earlier step"),
  [PageTargetKind.Team]: translationKey("Teams from an earlier step"),
  [PageTargetKind.OnCallSchedule]: translationKey(
    "On call in schedules from an earlier step",
  ),
  [PageTargetKind.OnCallPolicy]: translationKey(
    "On-call policies from an earlier step",
  ),
};

// What the page is about, as a phrase.
export const PAGE_ABOUT_PHRASE: Record<PageAbout, string> = {
  [PageAbout.NewAlert]: translationKey("New alert"),
  [PageAbout.Incident]: translationKey("Incident"),
  [PageAbout.Alert]: translationKey("Alert"),
};

export const PAGE_SUMMARY_SEPARATOR: string = " · ";

export type SummarizePageStepFunction = (
  metadataId: string,
  args: JSONObject | undefined,
) => string | null;

/**
 * The step's line on the canvas, or null: for a step that is not a Page
 * step, and for one that names nobody yet - it says "Click to set up"
 * instead.
 */
export const summarizePageStep: SummarizePageStepFunction = (
  metadataId: string,
  args: JSONObject | undefined,
): string | null => {
  const target: PageStepTarget | null = getPageStepTarget(metadataId);

  if (!target) {
    return null;
  }

  const values: JSONObject = args || {};
  const entries: Array<RecordListEntry> = readRecordListEntries(
    values[target.argumentId],
  );

  if (entries.length === 0) {
    return null;
  }

  const pickedCount: number = getRecordIds(entries).length;
  const hasValues: boolean = getOtherEntries(entries).some(
    (entry: RecordListEntry): boolean => {
      return entry.type === RecordListEntryType.Reference;
    },
  );

  /*
   * A value from an earlier step can name any number of records, so a step
   * that holds one is not counted: the count would be wrong as often as
   * not.
   */
  const who: string = hasValues
    ? translateText(PAGE_TARGET_FROM_VALUE[target.kind]) ||
      PAGE_TARGET_FROM_VALUE[target.kind]
    : translatePlural(
        PAGE_TARGET_COUNT_TEMPLATES[target.kind],
        // Entries that are neither picks nor values - an email address - count too.
        Math.max(pickedCount, entries.length),
      );

  const about: PageAbout | null = readPageAbout(
    values[PAGE_ARGUMENT_IDS.about],
  );

  // A Page About that is a value, or unknown: who alone.
  if (!about) {
    return who;
  }

  return `${who}${PAGE_SUMMARY_SEPARATOR}${
    translateText(PAGE_ABOUT_PHRASE[about]) || PAGE_ABOUT_PHRASE[about]
  }`;
};
