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
 * Docs overhaul task 25b: the RUM nav group's other four links, in nav
 * order. RumReplayDocsFacts holds the English pages to the product, and
 * RumDocsTranslations holds every translation of all eight to its English
 * page.
 */
export const RUM_APPLICATIONS: string = "rum/applications";
export const SESSION_REPLAY: string = "telemetry/session-replay";
export const SESSION_REPLAY_TROUBLESHOOTING: string =
  "rum/session-replay-troubleshooting";
export const RUM_TROUBLESHOOTING: string = "rum/troubleshooting";

export const RUM_REPLAY_PAGES: ReadonlyArray<RumDocsPageEntry> = [
  { page: RUM_APPLICATIONS, navTitle: "Managing Applications" },
  { page: SESSION_REPLAY, navTitle: "Session Replay" },
  {
    page: SESSION_REPLAY_TROUBLESHOOTING,
    navTitle: "Session Replay Troubleshooting",
  },
  { page: RUM_TROUBLESHOOTING, navTitle: "RUM Troubleshooting" },
];

// Every page of the RUM nav group, in nav order.
export const RUM_PAGES: ReadonlyArray<RumDocsPageEntry> = [
  ...RUM_SETUP_PAGES,
  ...RUM_REPLAY_PAGES,
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
 * The options of the session list's Signal chip (SessionReplayListFilters.ts,
 * less "All", the chip cleared). The chip draws an option's label as the
 * table writes it, with no translation lookup, so every language's Dashboard
 * draws them in English, and Session Replay names them so.
 */
export const SESSION_SIGNAL_OPTIONS: ReadonlyArray<string> = [
  "Errors",
  "Frustration",
  "Identified",
  "Playable",
  "Slow",
  "Live",
  "Traced",
];

/*
 * The session list's sort order (SessionReplayListFilters.ts), the Sort
 * section of the ⋯ that ends the list's header. Each option is a menu item,
 * which looks its text up in the Dashboard's locale, so a page names them as
 * its language's Dashboard draws them.
 */
export const SESSION_SORT_OPTIONS: ReadonlyArray<string> = [
  "Newest",
  "Longest",
  "Most errors",
  "Most frustration",
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
export const CREATE_BUTTONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [RUM_INDEX]: ["Create Ingestion Key"],
  [BROWSER_SETUP]: ["Create Ingestion Key"],
  [MOBILE_SETUP]: ["Create Ingestion Key"],
  // The RUM Applications table's own.
  [RUM_APPLICATIONS]: ["Create RUM Application"],
  [SESSION_REPLAY]: ["Create Ingestion Key"],
};

/*
 * The Session Replay storage budget alerts, as a recommendation card names
 * them (RumAlertTemplates.ts): drawn as the template writes them.
 */
export const SESSION_REPLAY_BUDGET_RECOMMENDATION_NAMES: ReadonlyArray<string> =
  [
    "Session Replay Daily Budget Nearly Spent",
    "Session Replay Daily Budget Spent",
    "Session Replay Monthly Budget Nearly Spent",
    "Session Replay Monthly Budget Spent",
  ];

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
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [BROWSER_SETUP]: ["Create Telemetry Ingestion Key"],
    [WEB_VITALS]: [
      ...WEB_VITAL_RATING_LABELS,
      "P75",
      "INP by route",
      ...WEB_VITAL_RECOMMENDATION_NAMES,
    ],
    // A row's More menu, which is a symbol in every language.
    [RUM_APPLICATIONS]: ["⋯"],
    /*
     * A status at the head of a paragraph: the code is the lead, in every
     * language (the 413 one is what OtlpIngestDocsClaims reads).
     */
    [RUM_TROUBLESHOOTING]: ["`401`.", "`404`.", "`413`.", "`422`.", "`429`."],
    /*
     * - the player's, the session list's and the Health page's words that
     *   their components write with no translation lookup: the back link,
     *   the other-sessions menu's steps, the ended card's buttons, the
     *   stage fit's 1:1, the shortcuts button, the More menu, the flow
     *   map's Other pages and the Health page's four stages;
     * - links a span's and a log's details draw the same way;
     * - the budget recommendations, as their cards name them;
     * - the monitor form's Maximum Value and Ignore, enum values;
     * - a permission's Owned scope, as the team permission picker lists it.
     */
    [SESSION_REPLAY]: [
      "⋯",
      "Watch session at this span",
      "View session replay",
      "Other pages",
      "All recordings",
      "Older",
      "Newer",
      "Next session by this user",
      "Watch again",
      "1:1",
      "?",
      "Recorder loaded",
      "Recording allowed",
      "Chunks received",
      "Sessions in 24h",
      ...SESSION_REPLAY_BUDGET_RECOMMENDATION_NAMES,
      "Maximum Value",
      "Ignore",
      "Owned",
    ],
  };

/*
 * Bold names of another product's screens, kept as that product writes
 * them in every language, although the Dashboard happens to have some of
 * the same words as labels: the browser's developer tools (its panels and
 * its Network panel's type filters) and a Power Pages site's settings.
 */
export const OTHER_PRODUCTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [SESSION_REPLAY_TROUBLESHOOTING]: [
    "Network",
    "Img",
    "CSS",
    "Font",
    "Console",
    "Other",
    "Security",
    "Advanced settings",
    "CORS",
  ],
};

/*
 * Bold labels of the Admin Dashboard, which a self-hosted installation's
 * administrator reads: drawn from its own locale files
 * (AdminDashboard/src/Locales), not the Dashboard's.
 */
export const ADMIN_DASHBOARD_LABELS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [SESSION_REPLAY]: ["Monitor Metric Retention (Days)", "Data Retention"],
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
  [RUM_TROUBLESHOOTING]: [
    "A Content Security Policy error in the console.",
    "A CORS error.",
    "`403` with an HTML page, or an empty body.",
    "Check the time range.",
    "Wait a few minutes.",
    "Check the project.",
    "Safari and Firefox.",
    "A mobile SDK that sets only `device.manufacturer`.",
    "A sampler may drop everything.",
    "The app may send telemetry only on some interactions",
    "The key may have been revoked or switched off",
  ],
  [SESSION_REPLAY_TROUBLESHOOTING]: [
    "If `OneUptimeReplay is not defined`",
    "The deployment has no recorder artifact.",
    "Filter for `session-replay`, not for the app identifier.",
    "Is there a `GET .../session-replay/v1/config`?",
    "No, and no `loader-start` in the console",
    "No, but `privacy-signal` is in the console",
    "Yes, non-2xx",
    "Is there no chunk `POST`?",
    "Still nothing after `captureSession()`?",
    "A hole at the very end",
    "A hole in the middle",
    "The same gap in the same place on every session, on a page with a large DOM",
    "Read the capture notes under the player.",
    "Check the masking mode.",
    "Check whether it failed for your user too.",
    "Did the recorder add the headers?",
    "`tracestate` but no `traceparent`?",
    "Is your API on another origin?",
    "Does your backend continue W3C trace context?",
    "Did the request already carry a `tracestate`?",
    "Traces there, Logs empty?",
    "Sampled away?",
    "_Visitor_ on every row",
    "_Anonymous_ rather than _Visitor_",
    "A different _Visitor_ id on every page load from one browser",
    "_Visitor_ even though your page does call `identify()`",
    "Some of a signed-in user's sessions say _Visitor_, others name them",
  ],
  [SESSION_REPLAY]: [
    "One `GET .../session-replay/v1/config`",
    "A `POST .../session-replay/v1/chunk` about every 15 seconds while the user is doing something",
    "When a mobile session ends idle.",
    "The identity belongs to the session, not just the page.",
    "A different user gets a session of their own.",
    "nothing at all",
    "at load time",
    "It is not an identity.",
    "It is not governed by Capture end-user identity.",
    "It follows the consent rules of the session id.",
    "It never travels on your own requests.",
    "It cannot be the target of an erasure request.",
    "replaces",
    // The JavaScript API's onSessionChange row: emphasis, not a field.
    "Optional",
    "Masking happens at capture, on the end user's device, before anything is uploaded.",
    "On the key.",
    "On the application.",
    "not",
    "Passwords",
    "Card fields",
    "One-time codes",
    "File input values",
    "Query strings and fragments",
    "Clipboard events",
    "Keystroke timing",
    "Request and response bodies and headers",
    "Click labels",
    "add",
    "Which requests.",
    "own origin",
    "uploading",
    "What the session id is.",
    "Where it goes.",
    "What it links.",
    "Who can assert it.",
    "and",
    "to its own origin",
    "every service that continues W3C trace context",
    "by trace id",
    "only to the service(s) your pages call directly",
    "Requests the recorder does not see:",
    "Requests made before the recorder starts",
    "Requests made while the session is not uploading:",
    "Requests that already carry a `tracestate`",
    "Requests without a `traceparent`.",
    "Requests another tracing agent was set up to trace but sent without a W3C `traceparent`.",
    "Your page's own OpenTelemetry exports.",
    "Backends that do not continue W3C trace context:",
    "APIs on another origin",
    "Pages without a real origin of their own:",
    "React Native.",
    "When a session ends idle.",
    "When a session is finalized.",
    "Search.",
    "When every session is anonymous.",
    "This person's other sessions.",
    "The timeline",
    "Tabs.",
    "Playing a whole visit.",
    "Live sessions.",
    "Theater and links.",
    "Setting them up.",
    "One daily monitor covers the project.",
    "The metrics.",
    "When no point is written.",
    "Building your own monitor.",
    "When alerts open and resolve.",
    "Retention and usage.",
    "30 days",
    "What counts as someone being there.",
    "The first five minutes are recorded as usual.",
    "After five minutes without input, recording pauses.",
    "The next input resumes the same session.",
    "Duration counts footage, not absence.",
    "Playback skips the paused stretch.",
    "Storage and cost.",
    "Not a setting.",
    "React Native",
    "An outage is not a failure.",
    "It uploads as soon as it can.",
    "A closed tab or a killed app loses nothing.",
    "Recordings keep their real time.",
    "Bounded and private.",
    "Playback loads those files from their original addresses, in your browser, while you watch.",
    "It needs no sign-in.",
    "It does not insist on a `Referer` from your site.",
    "Its server lets other sites use it.",
    "It still exists.",
    "Your browser can reach it.",
    "It is served over `https` when the dashboard is.",
    "Nothing in your own browser refuses it.",
    "Self-hosted:",
    "From the server's side",
    "From the browser's side",
  ],
};
