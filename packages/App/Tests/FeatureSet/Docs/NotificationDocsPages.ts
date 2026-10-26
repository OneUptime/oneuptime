/*
 * The Notifications pages, by the paths their suites name them with, and the
 * words a translation keeps as written or words freely. Docs overhaul task
 * 33 added the group: how OneUptime reaches you, notification methods,
 * personal on-call rules and notification settings - everything a person
 * sets up under User Settings so that pages and updates reach them.
 *
 * NotificationDocsFacts holds the English pages to the Dashboard, the models,
 * the server and the workers, and NotificationDocsTranslations holds every
 * translation to its English page. They read the page lists and the kept
 * words from here, never from each other: importing a .test.ts file runs its
 * tests.
 */

export interface NotificationDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const REACHING_YOU: string = "notifications/index";
export const NOTIFICATION_METHODS: string =
  "notifications/notification-methods";
export const PERSONAL_ON_CALL_RULES: string = "notifications/on-call-rules";
export const NOTIFICATION_SETTINGS: string =
  "notifications/notification-settings";

// The Notifications nav group, page for page.
export const NOTIFICATION_PAGES: ReadonlyArray<NotificationDocsPageEntry> = [
  { page: REACHING_YOU, navTitle: "How OneUptime Reaches You" },
  { page: NOTIFICATION_METHODS, navTitle: "Notification Methods" },
  { page: PERSONAL_ON_CALL_RULES, navTitle: "Personal On-Call Rules" },
  { page: NOTIFICATION_SETTINGS, navTitle: "Notification Settings" },
];

// The nav group's title, its section, and the group it follows there.
export const NOTIFICATIONS_NAV_GROUP: string = "Notifications";
export const NOTIFICATIONS_NAV_SECTION: string = "Incident Response";
export const NOTIFICATIONS_NAV_GROUP_AFTER: string = "On Call";

/*
 * The group's title in each docs language is the Dashboard's own word for
 * "Notifications" (its Project Settings section), except where that word is
 * already the title of another group of the same section. The Norwegian
 * Dashboard reads "Varsler" for Notifications and Alerts alike, and the
 * Alerts group is "Varsler", so the Notifications group takes the word the
 * Norwegian User Settings menu uses for it in "Varsler og notifikasjoner"
 * (Alerts & Notifications): two groups called "Varsler" side by side would
 * leave a reader guessing.
 */
export const NOTIFICATIONS_GROUP_TITLE_OVERRIDES: Readonly<
  Record<string, string>
> = {
  no: "Notifikasjoner",
};

/*
 * Bold words every language writes as the English does: the names of the
 * Billing Admin role and the Manage Billing permission, which the Dashboard
 * shows as written in every language, as the on-call pages keep them.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [NOTIFICATION_METHODS]: ["Manage Billing"],
    [PERSONAL_ON_CALL_RULES]: ["Manage Billing"],
  };

/*
 * Text every translation keeps in English, word for word, outside bold:
 * what OneUptime's emails say, which are written in English whatever
 * language the reader's Dashboard is in.
 */
export const ENGLISH_TEXT: Readonly<Record<string, ReadonlyArray<string>>> = {
  [NOTIFICATION_SETTINGS]: ["Manage notification preferences"],
};

/*
 * Bold words that are a list item's lead, not a label of the Dashboard: a
 * translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [NOTIFICATION_METHODS]: ["A phone.", "This browser."],
};

/*
 * How each page draws its diagrams: every one reads top to bottom, so it
 * fits the docs column.
 */
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [REACHING_YOU]: "flowchart TB",
  [NOTIFICATION_METHODS]: "flowchart TB",
  [PERSONAL_ON_CALL_RULES]: "flowchart TB",
  [NOTIFICATION_SETTINGS]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools, the mobile app and the switch it draws in English, and
 * the terms OneUptime's own pages keep. A line made of them alone is not a
 * line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "Critical On-Call Alerts",
  "OneUptime On-Call",
  "OneUptime Cloud",
  "OneUptime",
  "Microsoft Teams",
  "WhatsApp",
  "Telegram",
  "Twilio",
  "Slack",
  "HMAC-SHA256",
  "HTTPS",
  "JSON",
  "SMS",
  "API",
];

/*
 * The webhook a page posts, as the methods page shows one: the event types
 * an on-call webhook is sent under, each with the key its record is under,
 * and the two headers every request carries.
 */
export const WEBHOOK_EVENT_TYPES: ReadonlyArray<{
  eventType: string;
  recordKey: string;
}> = [
  { eventType: "on-call.incident.created", recordKey: "incident" },
  { eventType: "on-call.alert.created", recordKey: "alert" },
  {
    eventType: "on-call.incidentEpisode.created",
    recordKey: "incidentEpisode",
  },
  { eventType: "on-call.alertEpisode.created", recordKey: "alertEpisode" },
];

export const WEBHOOK_EVENT_HEADER: string = "X-OneUptime-Event";
export const WEBHOOK_SIGNATURE_HEADER: string = "X-OneUptime-Signature";
