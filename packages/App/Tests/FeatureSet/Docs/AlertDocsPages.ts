/*
 * The Alerts pages, by the paths their suites name them with, and the words
 * a translation keeps as written or words freely. Docs overhaul task 32
 * added the group: the overview, alert states and severities, episodes and
 * grouping rules, and alert rules and settings.
 *
 * AlertDocsFacts holds the English pages to the Dashboard, the models and
 * the server, and AlertDocsTranslations holds every translation to its
 * English page. They read the page lists and the kept words from here,
 * never from each other: importing a .test.ts file runs its tests.
 */

export interface AlertDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const ALERTS_OVERVIEW: string = "alerts/index";
export const ALERT_STATES: string = "alerts/states-and-severities";
export const ALERT_EPISODES: string = "alerts/episodes";
export const ALERT_SETTINGS: string = "alerts/settings";

// The Alerts nav group, page for page.
export const ALERT_PAGES: ReadonlyArray<AlertDocsPageEntry> = [
  { page: ALERTS_OVERVIEW, navTitle: "Alerts Overview" },
  { page: ALERT_STATES, navTitle: "Alert States & Severities" },
  { page: ALERT_EPISODES, navTitle: "Alert Episodes & Grouping Rules" },
  { page: ALERT_SETTINGS, navTitle: "Alert Rules & Settings" },
];

// The nav group's title, and the group it follows in Incident Response.
export const ALERTS_NAV_GROUP: string = "Alerts";
export const ALERTS_NAV_GROUP_AFTER: string = "Incidents";

/*
 * Bold words every language writes as the English does: the names of the
 * workflow components (the builder names them in English, from the model's
 * name), the alert roles (named in English in the Dashboard), and the "⋯"
 * that opens a menu.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [ALERTS_OVERVIEW]: ["Create One Alert", "On Create Alert", "⋯"],
    [ALERT_STATES]: ["⋯"],
    [ALERT_EPISODES]: ["⋯"],
    [ALERT_SETTINGS]: [
      "On Create Alert",
      "On Update Alert",
      "On Create or Update Alert",
      "On Delete Alert",
      "Create One Alert",
      "Update One Alert",
    ],
  };

/*
 * Text every translation keeps in English, word for word, because the
 * Dashboard shows it as a new project stores it: the descriptions the two
 * alert severities are seeded with.
 */
export const SEEDED_TEXT: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ALERT_STATES]: [
    "Issues causing very high impact to customers. Immediate attention is required.",
    "Issues causing low impact to customers.",
  ],
};

/*
 * Bold words that are a list item's lead, a table row's own name or a
 * word stressed in a sentence, not a label of the Dashboard: a translation
 * words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ALERTS_OVERVIEW]: [
    "Rules shape it.",
    "On-call policies page people.",
    "Episodes group the noise.",
    "What it is",
    "On status pages",
    "Starting states",
    "Starting severities",
    "Numbers in a new project",
    "A monitor's criteria.",
    "By hand.",
    "An SLO's burn rate.",
    "Network sites and security events.",
    "A page.",
    "The API, Terraform and workflows.",
    "It gets a number and a state.",
    "Privacy rules run first",
    "The feed and your chat tools hear of it.",
    "Owners and labels are added",
    "On-call rules add their policies",
    "On-call policies run.",
    "Grouping rules put it into an episode",
    "Reminders are scheduled",
    "At or past your acknowledged state",
    "At or past your resolved state",
    "On call.",
    "Its owners.",
    "Your chat tools.",
  ],
  [ALERT_STATES]: [
    "state",
    "severity",
    "Backwards moves are refused",
    "Moving to the state it is already in is refused",
    "Pickers offer only the states after the current one",
    "Header buttons",
    "List row",
    "Bulk change",
    "On-call stops paging for it.",
    "Acknowledge is no longer offered",
    "The time to acknowledge is set",
    "It leaves Active Alerts",
    "Its reminders stop",
    "Its episode can resolve.",
    "Its monitor can raise a new alert.",
    // Archiving a state or severity.
    "Nobody can pick it again.",
    "Alerts keep it.",
    "Archived values are listed apart",
    "Some can't be archived.",
  ],
  [ALERT_EPISODES]: [
    "The rule's conditions",
    "The grouping key",
    "The time window",
    "Its severity rises with its alerts.",
    "Its state moves its alerts.",
    "It resolves itself",
    "It can reopen.",
    "A new episode",
    "An alert joining an open episode",
    "Answering an episode's page",
  ],
  [ALERT_SETTINGS]: ["A rule can inherit.", "A new rule has to add something"],
};

/*
 * How each page draws its diagrams: every one reads top to bottom, so it
 * fits the docs column.
 */
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [ALERTS_OVERVIEW]: "flowchart TB",
  [ALERT_STATES]: "flowchart TB",
  [ALERT_EPISODES]: "flowchart TB",
  [ALERT_SETTINGS]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools and the terms OneUptime's own pages keep. A line made of
 * them alone is not a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime AI",
  "OneUptime Cloud",
  "OneUptime",
  "Microsoft Teams",
  "Slack",
  "Terraform",
  "Kubernetes",
  "SLOs",
  "SLO",
  "API",
];

/*
 * The project's seeded alert numbers' prefixes, and the episode's, as the
 * pages name them. AlertDocsFacts holds them to Common/Utils/Project/
 * NumberPrefix.
 */
export const ALERT_NUMBER_PREFIX: string = "ALT-";
export const ALERT_EPISODE_NUMBER_PREFIX: string = "AE-";
