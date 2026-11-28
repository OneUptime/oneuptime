import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A TEMPLATE'S PAGE SAYS ABOUT ITS LINKED MONITORS (#7678).
 *
 * The sync buttons say how many monitors they reach ("Sync Criteria to 3
 * Linked Monitors"), the Linked Monitors card carries the count in its
 * title, and Sync from Template says what it did. Those were built in
 * English with template literals, so every language read them in English,
 * with Latin digits. Each is a sentence of the Dashboard's locales now, its
 * count written the way the reader's language writes numbers, and a
 * monitor's name kept as written inside it. Link Existing Monitors and
 * Unlink from Template say theirs in the template change's own words
 * (Components/Monitor/TemplateChange/MonitorTemplateChangeModel, #11260,
 * #11266).
 *
 * Kept React-free, so App tests can read the words without a renderer: the
 * docs name a sync button with its count as each language's Dashboard
 * draws it.
 */

// The sync buttons once the count is read: each says how many monitors it reaches.
export const SYNC_TO_LINKED_MONITORS_TITLES: {
  criteria: PluralTemplate;
  interval: PluralTemplate;
  labels: PluralTemplate;
  customFields: PluralTemplate;
} = {
  criteria: {
    one: "Sync Criteria to {{count}} Linked Monitor",
    other: "Sync Criteria to {{count}} Linked Monitors",
  },
  interval: {
    one: "Sync Interval to {{count}} Linked Monitor",
    other: "Sync Interval to {{count}} Linked Monitors",
  },
  labels: {
    one: "Sync Labels to {{count}} Linked Monitor",
    other: "Sync Labels to {{count}} Linked Monitors",
  },
  customFields: {
    one: "Sync Custom Fields to {{count}} Linked Monitor",
    other: "Sync Custom Fields to {{count}} Linked Monitors",
  },
};

// The Linked Monitors card once the count is read.
export const LINKED_MONITORS_TITLE: string = translationKey(
  "Linked Monitors ({{count}})",
);

// What Sync from Template says, the monitor's name in it.
export const SYNCED_MONITOR_RESULT: string = translationKey(
  'Synced "{{monitorName}}" from this template.',
);
