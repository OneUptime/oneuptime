/*
 * The three pages docs overhaul task 36 added - Monitor Criteria & Statuses
 * and Monitor Groups in the Monitor group, Postmortems in the Incidents
 * group - by the paths their suites name them with, where each sits in the
 * nav, and the words a translation keeps as written or words freely.
 *
 * CriteriaGroupsPostmortemsDocsFacts holds the English pages to the
 * Dashboard, the models, the server and the workers; CriteriaGroups-
 * PostmortemsDocsTranslations holds every translation to its English page.
 * They read the lists from here, never from each other: importing a
 * .test.ts file runs its tests.
 */

export interface CriteriaGroupsPostmortemsDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
  // The nav group it is listed in, and the link right before it there.
  navGroup: string;
  after: string;
}

export const CRITERIA_AND_STATUSES: string = "monitor/criteria-and-statuses";
export const MONITOR_GROUPS: string = "monitor/monitor-groups";
export const POSTMORTEMS: string = "incidents/postmortems";

/*
 * The pages, each after the page a reader comes from: what criteria and
 * statuses mean right after creating a monitor and its templates, monitor
 * groups after the statuses they roll up, and postmortems after episodes,
 * the last thing that happens to an incident before its settings.
 */
export const CRITERIA_GROUPS_POSTMORTEMS_PAGES: ReadonlyArray<CriteriaGroupsPostmortemsDocsPageEntry> =
  [
    {
      page: CRITERIA_AND_STATUSES,
      navTitle: "Monitor Criteria & Statuses",
      navGroup: "Monitor",
      after: "Monitor Templates",
    },
    {
      page: MONITOR_GROUPS,
      navTitle: "Monitor Groups",
      navGroup: "Monitor",
      after: "Monitor Criteria & Statuses",
    },
    {
      page: POSTMORTEMS,
      navTitle: "Postmortems",
      navGroup: "Incidents",
      after: "Episodes",
    },
  ];

/*
 * Bold words every language writes as the English does, by page: the
 * criteria editor's filter and window names that no Dashboard locale has a
 * wording for (the dropdowns draw them as they are), and the built-in
 * outlines of Generate Postmortem with AI, which the dialog lists by their
 * English names in every language.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    // The "⋯" that opens a row's menu, drawn the same in every language.
    [CRITERIA_AND_STATUSES]: ["Is Online", "All Values", "⋯"],
    [POSTMORTEMS]: [
      "Standard Postmortem",
      "Detailed Technical Postmortem",
      "Brief Postmortem",
    ],
  };

/*
 * Bold words that are a list item's lead, not a label of the Dashboard: a
 * translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [CRITERIA_AND_STATUSES]: [
    "One at a time.",
    "Closing.",
    "Several probes.",
    "A parent monitor that is down.",
    "Scheduled maintenance.",
    // Archiving a monitor status.
    "Nobody can pick it again.",
    "Archived statuses are listed apart",
    "The built-in statuses can't be archived.",
  ],
  [MONITOR_GROUPS]: [
    "Archived monitors do not count.",
    "An empty group is operational.",
    "The order is yours.",
    "Your plan.",
    "The switch.",
    "Your role.",
    "Its status.",
    "Its incidents.",
    "Its subscribers.",
  ],
  [POSTMORTEMS]: [
    "The incident must be on the status page.",
    "The note must say something.",
    "Subscribers are told once",
    "Notify Subscribers is read when the notification goes out.",
  ],
};

// Every diagram on these pages reads top to bottom, to fit the docs column.
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [CRITERIA_AND_STATUSES]: "flowchart TB",
  [MONITOR_GROUPS]: "flowchart TB",
  [POSTMORTEMS]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools and services. A line made of them alone is not a line
 * left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime AI",
  "OneUptime",
  "Microsoft Teams",
  "Slack",
  "Terraform",
  "Markdown",
  "Kubernetes",
  "SLOs",
  "API",
];

/*
 * The seeded monitor statuses, in the order a new project lists them, as
 * the criteria page's table names them. CriteriaGroupsPostmortemsDocsFacts
 * holds them to ProjectService's seeding.
 */
export const SEEDED_MONITOR_STATUSES: ReadonlyArray<{
  name: string;
  place: number;
  color: string;
}> = [
  { name: "Operational", place: 1, color: "Green" },
  { name: "Degraded", place: 2, color: "Yellow" },
  { name: "Offline", place: 3, color: "Red" },
];

/*
 * The built-in outlines Generate Postmortem with AI offers before the
 * project's own templates, by name. The facts suite holds them to
 * Common/UI/Components/AI/AITemplates.
 */
export const BUILT_IN_POSTMORTEM_OUTLINES: ReadonlyArray<string> = [
  "Standard Postmortem",
  "Detailed Technical Postmortem",
  "Brief Postmortem",
];
