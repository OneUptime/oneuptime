/*
 * The Scheduled Maintenance pages docs overhaul task 35 added - the
 * overview, creating events, states, templates and recurring events, and
 * rules and settings - by the paths their suites name them with, and the
 * words a translation keeps as written or words freely.
 *
 * ScheduledMaintenanceDocsFacts holds the English pages to the Dashboard,
 * the models, the server and the workers; ScheduledMaintenanceDocs-
 * Translations holds every translation to its English page. They read the
 * lists from here, never from each other: importing a .test.ts file runs
 * its tests.
 */

export interface ScheduledMaintenanceDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const MAINTENANCE_OVERVIEW: string = "scheduled-maintenance/index";
export const CREATING_EVENTS: string = "scheduled-maintenance/creating-events";
export const MAINTENANCE_STATES: string = "scheduled-maintenance/states";
export const TEMPLATES_AND_RECURRING: string =
  "scheduled-maintenance/templates";
export const RULES_AND_SETTINGS: string = "scheduled-maintenance/settings";
export const MAINTENANCE_CALENDAR: string = "scheduled-maintenance/calendar";

/*
 * The Scheduled Maintenance nav group, page for page: the overview first,
 * so /docs/scheduled-maintenance opens it.
 */
export const SCHEDULED_MAINTENANCE_PAGES: ReadonlyArray<ScheduledMaintenanceDocsPageEntry> =
  [
    { page: MAINTENANCE_OVERVIEW, navTitle: "Scheduled Maintenance Overview" },
    { page: CREATING_EVENTS, navTitle: "Creating Maintenance Events" },
    { page: MAINTENANCE_STATES, navTitle: "Maintenance States" },
    {
      page: TEMPLATES_AND_RECURRING,
      navTitle: "Templates & Recurring Events",
    },
    { page: RULES_AND_SETTINGS, navTitle: "Maintenance Rules & Settings" },
    { page: MAINTENANCE_CALENDAR, navTitle: "Maintenance Calendar" },
  ];

/*
 * The nav group's title, its section, and the group it follows: planned
 * work is announced on status pages, so the group sits right after them in
 * Incident Response.
 */
export const SCHEDULED_MAINTENANCE_NAV_GROUP: string = "Scheduled Maintenance";
export const SCHEDULED_MAINTENANCE_NAV_SECTION: string = "Incident Response";
export const SCHEDULED_MAINTENANCE_NAV_GROUP_AFTER: string = "Status Pages";

/*
 * The roles that may create events and templates, as the English pages list
 * them (ScheduledMaintenanceDocsFacts holds them to the models' create
 * permissions). A translated page names each as its Dashboard draws it: the
 * built-in roles' names are keys of their own (DocsRoleNames), so they are
 * not kept in English with the permissions' titles.
 */
export const ROLE_NAMES: ReadonlyArray<string> = [
  "Project Owner",
  "Project Admin",
  "Project Member",
  "Scheduled Maintenance Admin",
  "Scheduled Maintenance Member",
];

/*
 * The workflow builder's components for the maintenance models: their
 * titles are made from each model's name (BaseModelComponent), in English,
 * so every language writes them as the English does.
 */
export const WORKFLOW_COMPONENTS: ReadonlyArray<string> = [
  "On Create Scheduled Maintenance Event",
  "On Update Scheduled Maintenance Event",
  "On Create or Update Scheduled Maintenance Event",
  "On Delete Scheduled Maintenance Event",
  "Create One Scheduled Maintenance Event",
  "Update One Scheduled Maintenance Event",
];

/*
 * Bold words every language writes as the English does, by page: the
 * permissions' titles, the workflow components and the model a component is
 * named after, and the "⋯" that opens a menu. (A built-in role's name reads
 * in the page's language, as its Dashboard draws it.)
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [MAINTENANCE_OVERVIEW]: ["Create One Scheduled Maintenance Event", "⋯"],
    [CREATING_EVENTS]: [
      "Create Scheduled Maintenance",
      "On Create Scheduled Maintenance Event",
      "Create One Scheduled Maintenance Event",
    ],
    [MAINTENANCE_STATES]: ["⋯"],
    [TEMPLATES_AND_RECURRING]: [],
    [RULES_AND_SETTINGS]: [
      "On Create Scheduled Maintenance Event",
      "On Update Scheduled Maintenance Event",
      "On Create or Update Scheduled Maintenance Event",
      "On Delete Scheduled Maintenance Event",
      "Scheduled Maintenance State Timeline",
      "Create One Scheduled Maintenance Event",
      "Update One Scheduled Maintenance Event",
      "Create Scheduled Maintenance Owner Rule",
    ],
    // The + a day of the calendar shows, and the list's menu.
    [MAINTENANCE_CALENDAR]: ["+", "⋯"],
  };

/*
 * Bold words that are a list item's lead, a table row's own name or a word
 * stressed in a sentence, not a label of the Dashboard: a translation words
 * them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [MAINTENANCE_OVERVIEW]: [
    "What it is",
    "Its monitors",
    "How it moves on",
    "When subscribers are told",
    "Numbers in a new project",
    "The form.",
    "A template.",
    "A schedule.",
    "A form.",
    "Chat.",
    "Code.",
    "Its monitors are not checked.",
    "Its other resources stay quiet.",
    "Network sites and SLOs hold back.",
    "Your status pages show it.",
    "Subscribers hear about it.",
    "Your team hears about it.",
  ],
  [CREATING_EVENTS]: [
    "Your role.",
    "Your status pages.",
    "Linked resources.",
    "Suggested status pages.",
    "It gets a number and a state.",
    "Your chat tools hear of it.",
    "Its state timeline starts.",
    "Owners and labels are added",
    "Runbook rules start",
    "Reminders are scheduled",
  ],
  [MAINTENANCE_STATES]: [
    "state",
    "The clock",
    "The header",
    "The timeline",
    "A list row",
    "Bulk change",
    "Chat",
    "The API",
    "Its monitors stop being checked",
    "Its status pages list it as in progress",
    "Its owners are told",
    "Backwards moves are refused",
    "Moving to the state it is already in is refused",
    "Pickers offer only the states after the current one",
    // Archiving a state.
    "Nobody can pick it again.",
    "Archived states are listed apart",
    "The four built-in states can't be archived",
  ],
  [TEMPLATES_AND_RECURRING]: ["Your plan.", "Your role."],
  [RULES_AND_SETTINGS]: [
    "A rule can inherit.",
    "A new rule has to add something",
  ],
  [MAINTENANCE_CALENDAR]: ["What it holds.", "A private page.", "One event."],
};

/*
 * Labels whose Dashboard key ends in a space: the event form's status page
 * field is titled "Show event on these status pages " in the code, so the
 * locales key it with the space, and draw it with one. A page names it
 * without the space, drawn as the locale words the key, trimmed.
 */
export const LABELS_KEYED_WITH_A_SPACE: ReadonlyArray<string> = [
  "Show event on these status pages",
];

/*
 * The server's own words a page quotes: the refusals of a move up the list
 * and of a move into the state an event is in. The API answers them in
 * English whatever the reader's language, so every translation quotes them
 * word for word.
 */
export const SERVER_TEXT: Readonly<Record<string, ReadonlyArray<string>>> = {
  [MAINTENANCE_STATES]: [
    "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states.",
    "Scheduled Maintenance state cannot be same as previous state.",
  ],
};

// Every diagram on these pages reads top to bottom, to fit the docs column.
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [MAINTENANCE_OVERVIEW]: "flowchart TB",
  [CREATING_EVENTS]: "flowchart TB",
  [MAINTENANCE_STATES]: "flowchart TB",
  [TEMPLATES_AND_RECURRING]: "flowchart TB",
  [RULES_AND_SETTINGS]: "flowchart TB",
  [MAINTENANCE_CALENDAR]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools and services. A line made of them alone is not a line
 * left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "Microsoft Teams",
  "Terraform",
  "Markdown",
  "Slack",
  "SLOs",
  "SLO",
  "API",
];

/*
 * The cards the introduction pages gained: Getting Started's Incident
 * Response cards open the group's overview right after Status pages, and
 * Core Concepts' status pages and maintenance cards end with it.
 */
export const GETTING_STARTED_CARD_AFTER: string = "/docs/status-pages/index";
export const CORE_CONCEPTS_CARD_AFTER: string =
  "/docs/status-pages/subscribers";

/*
 * The project's seeded event number prefix, as the pages name it.
 * ScheduledMaintenanceDocsFacts holds it to Common/Utils/Project/NumberPrefix.
 */
export const MAINTENANCE_NUMBER_PREFIX: string = "SM-";
