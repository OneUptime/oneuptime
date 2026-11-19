import { SharedNameKind } from "Common/Types/Database/SharedNames";
import { PluralTemplate } from "Common/Types/Translator";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A LIST SAYS OF RECORDS THAT SHARE A NAME (#9746), by kind.
 *
 * Teams (#9674), on-call policies and on-call schedules (#9742) each have a
 * name of their own in a project now, but records named alike before that
 * keep their names, and every picker draws them alike. Their list marks
 * each with a pill beside its name, says above the list how many there are
 * and how to tell them apart - what each one does, which its name cannot
 * say - and gives each its Rename.
 *
 * React-free, so tests read the words without rendering the page.
 */
export interface SharedNameWords {
  // The pill beside a record's name.
  pill: string;
  // Under the pointer on the pill: why it is there, and what to do.
  pillTooltip: string;
  // Above the list: how many share a name, and how to tell them apart.
  note: PluralTemplate;
  // The row's Rename, and its dialog's title and button.
  rename: string;
  // Under the dialog's title.
  renameDescription: string;
}

export const SHARED_NAME_WORDS: Record<SharedNameKind, SharedNameWords> = {
  [SharedNameKind.Team]: {
    pill: translationKey("Same name as another team"),
    pillTooltip: translationKey(
      "Another team in this project has this name, so pickers can't tell them apart. Compare their members, then rename one.",
    ),
    note: {
      one: translationKey(
        "{{count}} team has the same name as another team, and pickers can't tell them apart. Compare their members, then rename one.",
      ),
      other: translationKey(
        "{{count}} teams have the same name as another team, and pickers can't tell them apart. Compare their members, then rename one.",
      ),
    },
    rename: translationKey("Rename Team"),
    renameDescription: translationKey(
      "Pickers show a team by its name alone. Give this one a name no other team has.",
    ),
  },
  [SharedNameKind.OnCallPolicy]: {
    pill: translationKey("Same name as another policy"),
    pillTooltip: translationKey(
      "Another on-call policy in this project has this name, so pickers can't tell them apart. It may be archived. Compare their escalation rules, then rename one.",
    ),
    note: {
      one: translationKey(
        "{{count}} on-call policy has the same name as another policy, and pickers can't tell them apart. Compare their escalation rules, then rename one.",
      ),
      other: translationKey(
        "{{count}} on-call policies have the same name as another policy, and pickers can't tell them apart. Compare their escalation rules, then rename one.",
      ),
    },
    rename: translationKey("Rename On-Call Policy"),
    renameDescription: translationKey(
      "Pickers show an on-call policy by its name alone. Give this one a name no other policy has.",
    ),
  },
  [SharedNameKind.OnCallSchedule]: {
    pill: translationKey("Same name as another schedule"),
    pillTooltip: translationKey(
      "Another on-call schedule in this project has this name, so pickers can't tell them apart. Compare their layers, then rename one.",
    ),
    note: {
      one: translationKey(
        "{{count}} on-call schedule has the same name as another schedule, and pickers can't tell them apart. Compare their layers, then rename one.",
      ),
      other: translationKey(
        "{{count}} on-call schedules have the same name as another schedule, and pickers can't tell them apart. Compare their layers, then rename one.",
      ),
    },
    rename: translationKey("Rename On-Call Schedule"),
    renameDescription: translationKey(
      "Pickers show an on-call schedule by its name alone. Give this one a name no other schedule has.",
    ),
  },
};

// The row's one button on a marked row: short, as the row names its record.
export const SHARED_NAME_RENAME_BUTTON: string = translationKey("Rename");
