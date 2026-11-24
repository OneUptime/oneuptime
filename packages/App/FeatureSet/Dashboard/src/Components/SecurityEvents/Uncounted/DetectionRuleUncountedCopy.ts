import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF WHAT A DETECTION RULE COULD NOT COUNT, ON ITS ROW (#10547).
 * A rule that counts per value leaves out the matching events that have no
 * value for its field; its row on Detection Rules says how many in the last
 * day, and the dialog that line opens says why in the words Run on Past
 * Events uses (UNCOUNTED_* in Retrohunt/RetrohuntCopy). Each is an en.json
 * key, looked up where it is drawn. React-free, so a plain test reads them.
 */

// The line under the rule's name: some of what it matched it could not count.
export const UNCOUNTED_ROW_LINE: { one: string; other: string } = {
  one: translationKey("Couldn't count {{count}} event in the last day"),
  other: translationKey("Couldn't count {{count}} events in the last day"),
};

// The line under the rule's name when it could count none of what it matched.
export const UNCOUNTED_ROW_LINE_NOTHING: { one: string; other: string } = {
  one: translationKey(
    "Couldn't count the {{count}} event it matched in the last day",
  ),
  other: translationKey(
    "Couldn't count any of the {{count}} events it matched in the last day",
  ),
};

// The dialog the line opens: its title is the rule's name.
export const UNCOUNTED_DIALOG_DESCRIPTION: string = translationKey(
  "What this rule matched in the last day and couldn't count.",
);

// Said when it could count none of it: plainly, it cannot fire.
export const UNCOUNTED_NOTHING_CANT_FIRE: string = translationKey(
  "That is every event it matched, so it can't fire.",
);

// Why such events are left out.
export const UNCOUNTED_WHY: string = translationKey(
  "A rule that counts per value leaves out events with none, so they never add up as one value.",
);

export const UNCOUNTED_TEST_IDS: Readonly<{
  rowLine: string;
  dialog: string;
  scrubRulesLink: string;
}> = {
  rowLine: "detection-rule-uncounted",
  dialog: "detection-rule-uncounted-dialog",
  scrubRulesLink: "detection-rule-uncounted-scrub-rules",
};
