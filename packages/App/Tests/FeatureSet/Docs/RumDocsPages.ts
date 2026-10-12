/*
 * The Real User Monitoring setup pages of the docs, by the paths their
 * suites name them with, and the words they keep as the product writes them.
 *
 * Docs overhaul task 25a rewrote these four pages: RumDocsFacts holds the
 * English pages to the product, RumDocsTranslations holds every translation
 * to its English page. Both read the page list and the kept words from here,
 * never from each other: importing a .test.ts file runs its tests.
 */

export interface RumDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const RUM_INDEX: string = "rum/index";
export const BROWSER_SETUP: string = "rum/browser-setup";
export const MOBILE_SETUP: string = "rum/mobile-setup";
export const WEB_VITALS: string = "rum/web-vitals";

// The RUM nav group's first four links, in nav order.
export const RUM_SETUP_PAGES: ReadonlyArray<RumDocsPageEntry> = [
  { page: RUM_INDEX, navTitle: "RUM Overview" },
  { page: BROWSER_SETUP, navTitle: "Browser Setup" },
  { page: MOBILE_SETUP, navTitle: "Mobile Setup" },
  { page: WEB_VITALS, navTitle: "Core Web Vitals" },
];

/*
 * The rating chips of the Core Web Vitals card (ratingLabel in
 * WebVitalsCard.tsx). The card writes them without a translation lookup, so
 * every language's Dashboard draws them in English, and every page names
 * them so.
 */
export const WEB_VITAL_RATING_LABELS: ReadonlyArray<string> = [
  "Good",
  "Needs work",
  "Poor",
];

/*
 * The web vital monitors the Recommendations page offers
 * (RumAlertTemplates.ts). A recommendation card draws its name as the
 * template writes it, with no translation lookup, so it reads in English in
 * every language.
 */
export const WEB_VITAL_RECOMMENDATION_NAMES: ReadonlyArray<string> = [
  "Poor Largest Contentful Paint",
  "Poor Interaction to Next Paint",
  "Poor Cumulative Layout Shift",
  "Slow First Contentful Paint",
  "Slow Time to First Byte",
];

/*
 * The application's side menu, section by section, as the index page lists
 * it (Pages/Rum/View/SideMenu.tsx and the Developer section it adds).
 */
export const APPLICATION_SIDE_MENU: ReadonlyArray<{
  section: string;
  items: ReadonlyArray<string>;
}> = [
  {
    section: "Basic",
    items: ["Overview", "Recommendations", "Documentation"],
  },
  { section: "Observability", items: ["Metrics", "Logs", "Traces", "Clients"] },
  {
    section: "Session Replay",
    items: [
      "Session Replay",
      "User Flows",
      "Replay Users",
      "Health",
      "Replay Policy",
      "Replay Access Log",
      "Documentation",
    ],
  },
  { section: "Settings", items: ["Settings"] },
  { section: "Developer", items: ["Terraform", "API", "AI Assistants"] },
  { section: "Advanced", items: ["Delete Application"] },
];

/*
 * A table's create button, drawn as translateNamedAction draws it
 * (drawnCreateButton): the Telemetry Ingestion Keys table's.
 */
export const CREATE_BUTTONS: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [RUM_INDEX]: ["Create Ingestion Key"],
    [BROWSER_SETUP]: ["Create Ingestion Key"],
    [MOBILE_SETUP]: ["Create Ingestion Key"],
  };

/*
 * Bold names every language's Dashboard draws in English, so every page
 * keeps them as written:
 *
 *   - a permission's name, as the team and API key permission pickers list
 *     it (Permission.ts's title, which no locale translates);
 *   - the Core Web Vitals card's rating chips and its INP by route title,
 *     which the card writes with no translation lookup;
 *   - the metric explorer's P75 aggregation, an enum value;
 *   - the web vital recommendations' names, which a recommendation card
 *     draws as the template writes them.
 */
export const KEPT_AS_WRITTEN: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [BROWSER_SETUP]: ["Create Telemetry Ingestion Key"],
  [WEB_VITALS]: [
    ...WEB_VITAL_RATING_LABELS,
    "P75",
    "INP by route",
    ...WEB_VITAL_RECOMMENDATION_NAMES,
  ],
};

/*
 * Bold words that are emphasis or a lead-in, not a Dashboard label: a
 * translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [RUM_INDEX]: [
    "One application per app.",
    "Never counted twice.",
    "Session Replay is a separate, optional layer.",
    "resource attributes",
    "browser",
    "mobile",
  ],
  [BROWSER_SETUP]: ["backend"],
  [WEB_VITALS]: [
    "mean",
    "one value per page load",
    "caused",
    "pattern",
    "drop `onINP`",
  ],
};
