/*
 * The On Call pages docs overhaul task 34 added - the overview, on-call
 * policies, user overrides, and readiness & reports - by the paths their
 * suites name them with, the whole On Call group in nav order, and the words
 * a translation keeps as written.
 *
 * OnCallAdministrationDocsFacts holds the English pages to the Dashboard, the
 * models, the server and the workers; OnCallAdministrationDocsTranslations
 * holds every translation to its English page. They read the lists from
 * here, never from each other: importing a .test.ts file runs its tests.
 */

export interface OnCallDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const ON_CALL_OVERVIEW: string = "on-call/index";
export const ON_CALL_POLICIES: string = "on-call/policies";
export const USER_OVERRIDES: string = "on-call/user-overrides";
export const READINESS_AND_REPORTS: string = "on-call/readiness";

// The four pages task 34 added.
export const NEW_ON_CALL_PAGES: ReadonlyArray<OnCallDocsPageEntry> = [
  { page: ON_CALL_OVERVIEW, navTitle: "On-Call Overview" },
  { page: ON_CALL_POLICIES, navTitle: "On-Call Policies" },
  { page: USER_OVERRIDES, navTitle: "User Overrides" },
  { page: READINESS_AND_REPORTS, navTitle: "Readiness & Reports" },
];

export const ON_CALL_NAV_GROUP: string = "On Call";
export const ON_CALL_NAV_SECTION: string = "Incident Response";

/*
 * The On Call group, page for page: the overview first (so /docs/on-call
 * opens it), the policies and their levels, the schedules and what is drawn
 * from them, overrides, calendars, the phone pages, and readiness last.
 */
export const ON_CALL_GROUP_PAGES: ReadonlyArray<OnCallDocsPageEntry> = [
  { page: ON_CALL_OVERVIEW, navTitle: "On-Call Overview" },
  { page: ON_CALL_POLICIES, navTitle: "On-Call Policies" },
  { page: "on-call/escalation-rules", navTitle: "Escalation Rules" },
  { page: "on-call/schedules", navTitle: "On-Call Schedules" },
  { page: "on-call/schedule-timeline", navTitle: "Schedule Timeline" },
  { page: USER_OVERRIDES, navTitle: "User Overrides" },
  { page: "on-call/calendar-feeds", navTitle: "Calendar Feeds" },
  { page: "on-call/incoming-call-policy", navTitle: "Incoming Call Policy" },
  {
    page: "on-call/phone-number-whitelist",
    navTitle: "Phone Number Whitelist",
  },
  { page: READINESS_AND_REPORTS, navTitle: "Readiness & Reports" },
];

/*
 * Nav titles that are a label of the Dashboard's On-Call Duty side menu: in
 * every language the page is titled as that language's Dashboard names the
 * menu entry it documents.
 */
export const NAV_TITLES_FROM_THE_DASHBOARD: ReadonlyArray<string> = [
  "On-Call Policies",
  "User Overrides",
];

/*
 * The roles the on-call pages name, as their English pages list them
 * (OnCallAdministrationDocsFacts holds them to the policies' permissions).
 * A translated page names each as its Dashboard draws it: the built-in roles'
 * names are keys of their own (DocsRoleNames), so they are no longer kept in
 * English with the permissions' titles.
 */
export const ROLE_NAMES: ReadonlyArray<string> = [
  "Project Owner",
  "Project Admin",
  "Project Member",
  "On-Call Admin",
  "On-Call Member",
  "Viewer",
  "On-Call Viewer",
];

/*
 * Bold words every language writes as the English does, by page:
 *
 *   - "Level 1": the name the server gives a policy's first escalation rule
 *     (EscalationRuleDefaults), as the other on-call pages keep it;
 *   - the execution statuses the Dashboard shows in English (Executing,
 *     Execution Completed, Execution Completed - No One Notified): its pill
 *     translates only the statuses its locales hold;
 *   - the workflow builder's "Page an On-Call Policy" step, whose component
 *     titles are not translated;
 *   - the custom permissions' titles, which the permission picker draws as
 *     they are.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [ON_CALL_OVERVIEW]: ["Level 1", "Execution Completed - No One Notified"],
    [ON_CALL_POLICIES]: [
      "Level 1",
      "Page an On-Call Policy",
      "Executing",
      "Execution Completed",
      "Execution Completed - No One Notified",
      "Create On-Call Duty Policy",
      "Edit On-Call Duty Policy",
      "Delete On-Call Duty Policy",
      "Read On-Call Duty Policy",
    ],
    [USER_OVERRIDES]: [
      "Create On-Call Duty Policy User Override",
      "Delete On-Call Duty Policy User Override",
      "Read On-Call Duty Policy User Override",
    ],
    [READINESS_AND_REPORTS]: ["Edit On-Call Duty Policy"],
  };

/*
 * Bold words that are not a label of the Dashboard: a translation words them
 * freely. None on these pages - a list item's lead is plain text.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {};

// Every diagram on these pages reads top to bottom, to fit the docs column.
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [ON_CALL_OVERVIEW]: "flowchart TB",
  [ON_CALL_POLICIES]: "flowchart TB",
  [USER_OVERRIDES]: "flowchart TB",
  [READINESS_AND_REPORTS]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools and services. A line made of them alone is not a line left
 * untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "Microsoft Teams",
  "Terraform",
  "WhatsApp",
  "Telegram",
  "Slack",
  "SMS",
  "API",
];

/*
 * The links the existing On Call pages gained into the new pages and the
 * Notifications group: page -> link targets, each written on the English
 * line's place in every language.
 */
export const LINKS_ADDED_TO_EXISTING_PAGES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  "on-call/escalation-rules": [
    "/docs/notifications/on-call-rules",
    "/docs/on-call/user-overrides",
  ],
  "on-call/schedules": [
    "/docs/on-call/user-overrides",
    "/docs/notifications/on-call-rules",
  ],
  "on-call/incoming-call-policy": [
    "/docs/notifications/notification-methods",
    "/docs/notifications/notification-settings",
  ],
  "on-call/schedule-timeline": ["/docs/on-call/readiness#user-on-call-time"],
  "on-call/calendar-feeds": [
    "/docs/on-call/user-overrides",
    "/docs/on-call/readiness#user-on-call-time",
  ],
  "on-call/phone-number-whitelist": [
    "/docs/notifications/notification-methods",
  ],
};
