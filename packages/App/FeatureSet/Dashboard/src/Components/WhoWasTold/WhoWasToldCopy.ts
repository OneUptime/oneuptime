import { WhoWasToldStatus } from "Common/Types/Notification/WhoWasTold";
import { PluralTemplate, translationKey } from "Common/Types/Translator";
import { PillTone } from "Common/UI/Components/Pill/PillTone";

/*
 * "WHO WAS TOLD"'S OWN WORDS (#7075): the card's title, sentences and the
 * statuses a person's or a channel's line shows - plain English keys, looked
 * up in the reader's language where they are drawn. Kept apart from
 * WhoWasToldWords, which words what the server says with the on-call logs'
 * and the workspace logs' own helpers, so a test that reads only the words
 * (the docs' facts) needs no browser to import them.
 */

export const WHO_WAS_TOLD_COPY: Readonly<{
  title: string;
  incidentDescription: string;
  alertDescription: string;
  error: string;
  nobodyYetIncident: string;
  nobodyYetAlert: string;
  acknowledgedAfter: string;
  acknowledged: string;
  toldPeopleAndChannels: string;
  pagedDirectly: string;
  pagedBy: string;
  people: string;
  notPaged: string;
  channels: string;
  subscribers: string;
  truncated: string;
  notificationLogs: string;
  updated: string;
  showDetails: string;
  hideDetails: string;
  showFewer: string;
  someone: string;
}> = {
  title: translationKey("Who Was Told"),
  incidentDescription: translationKey(
    "Who OneUptime told about this incident, by what, and what failed, as it happened.",
  ),
  alertDescription: translationKey(
    "Who OneUptime told about this alert, by what, and what failed, as it happened.",
  ),
  error: translationKey("Couldn't read who was told. {{error}}"),
  nobodyYetIncident: translationKey(
    "Nobody has been told about this incident yet.",
  ),
  nobodyYetAlert: translationKey("Nobody has been told about this alert yet."),
  acknowledgedAfter: translationKey(
    "{{name}} acknowledged it {{time}} after the first page.",
  ),
  acknowledged: translationKey("{{name}} acknowledged it."),
  toldPeopleAndChannels: translationKey(
    "OneUptime told {{people}} and posted to {{channels}}.",
  ),
  pagedDirectly: translationKey("Paged directly"),
  pagedBy: translationKey("Paged by {{policy}}"),
  people: translationKey("People"),
  notPaged: translationKey("Not paged"),
  channels: translationKey("Channels"),
  subscribers: translationKey("Status Page Subscribers"),
  truncated: translationKey(
    "Only the latest notifications are listed. Notification Logs lists every one.",
  ),
  notificationLogs: translationKey("Notification Logs"),
  updated: translationKey("Updated {{time}}"),
  showDetails: translationKey("Show details"),
  hideDetails: translationKey("Hide details"),
  showFewer: translationKey("Show fewer"),
  someone: translationKey("Someone"),
};

export const WHO_WAS_TOLD_PLURALS: Readonly<{
  toldPeople: PluralTemplate;
  postedChannels: PluralTemplate;
  people: PluralTemplate;
  channels: PluralTemplate;
  failed: PluralTemplate;
  failedCount: PluralTemplate;
  hiddenNotifications: PluralTemplate;
  hiddenRuns: PluralTemplate;
  subscribersSent: PluralTemplate;
  showMore: PluralTemplate;
}> = {
  toldPeople: {
    one: "OneUptime told {{count}} person.",
    other: "OneUptime told {{count}} people.",
  },
  postedChannels: {
    one: "OneUptime posted to {{count}} channel.",
    other: "OneUptime posted to {{count}} channels.",
  },
  // The pieces of "OneUptime told {{people}} and posted to {{channels}}."
  people: { one: "{{count}} person", other: "{{count}} people" },
  channels: { one: "{{count}} channel", other: "{{count}} channels" },
  failed: {
    one: "{{count}} notification failed.",
    other: "{{count}} notifications failed.",
  },
  // Beside a person's or a channel's channels: how many of theirs failed.
  failedCount: { one: "{{count}} failed", other: "{{count}} failed" },
  hiddenNotifications: {
    one: "{{count}} notification isn't listed: you can't open its log.",
    other: "{{count}} notifications aren't listed: you can't open their logs.",
  },
  hiddenRuns: {
    one: "{{count}} on-call policy run isn't listed: you can't see its policy.",
    other:
      "{{count}} on-call policy runs aren't listed: you can't see their policies.",
  },
  subscribersSent: {
    one: "{{count}} notification sent",
    other: "{{count}} notifications sent",
  },
  showMore: { one: "Show {{count}} more", other: "Show {{count}} more" },
};

// A chip's words, in English for the chip to look up once, and its tone.
export interface WhoWasToldChip {
  text: string;
  tone: PillTone;
}

// Where a person or a channel stands.
export const STATUS_CHIPS: Readonly<Record<WhoWasToldStatus, WhoWasToldChip>> =
  {
    [WhoWasToldStatus.Acknowledged]: {
      text: translationKey("Acknowledged"),
      tone: PillTone.Success,
    },
    [WhoWasToldStatus.Told]: {
      text: translationKey("Notified"),
      tone: PillTone.Info,
    },
    [WhoWasToldStatus.Sending]: {
      text: translationKey("Sending"),
      tone: PillTone.Neutral,
    },
    [WhoWasToldStatus.Failed]: {
      text: translationKey("Failed"),
      tone: PillTone.Danger,
    },
    [WhoWasToldStatus.Skipped]: {
      text: translationKey("Not paged"),
      tone: PillTone.Warning,
    },
  };
