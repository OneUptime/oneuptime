/*
 * THE DOCS' SCREENSHOTS (#6823): what each picture of the product shows, and
 * how it is made. Every shot is drawn from the real Dashboard pages of this
 * branch, by an offline browser fixture (packages/E2E/<fixture>/), in every
 * docs language the fixture can draw, light theme, at a fixed pixel ratio:
 *
 *   cd packages/E2E && npm run docs-screens
 *
 * writes Docs/Static/images/screens/<language>/<shot>.webp and the manifest
 * the docs read (DocsScreenFiles.ts), and packages/E2E/DocsScreens/README.md
 * says how it runs and what it weighs. A docs page shows a shot by its name,
 * as a Markdown image with its own alt text, in its own language:
 *
 *   ![The address typed and its first check in](screen:website-down-check)
 *
 * This file is plain data with no imports: the renderer (packages/E2E), the
 * docs server and the tests all read it.
 *
 * A shot is self-contained - a fixture, a page, the state to put it in, a
 * width, what to crop to and what to ring - and the renderer goes on from
 * the shot before it when this shot's state starts with all of that one's,
 * so a guided setup's steps are one walk, not one page load each.
 */

/*
 * The docs' languages, English first, as Common/Types/Docs/DocsLanguage
 * lists them (DocsScreenList.test.ts holds the two equal). Written out here
 * so the renderer reads this file without the Common package.
 */
export const DOCS_SCREEN_LANGUAGES: ReadonlyArray<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

/*
 * What a shot does to reach its state, as a person does it, by what is on
 * screen. The words are the Dashboard's English words, a key of its English
 * locale: the renderer finds them in the language being drawn, so the same
 * steps draw every language. Values typed and names picked are data, never
 * translated.
 */
export type DocsScreenAction =
  // A button or a link, by its words (`exact: false`: words it contains).
  | { press: string; exact?: boolean | undefined }
  // A checkbox, by its words (`asWritten`: a name that is data, not translated).
  | { tick: string; asWritten?: boolean | undefined }
  // A field, by its label (`exact: false`: words it contains).
  | { type: string; value: string; exact?: boolean | undefined }
  // An option of the list open now, by its name (data: not translated).
  | { option: string }
  // Escape: closes the list open now.
  | { escape: true }
  // Waits until the element with this data-testid shows.
  | { waitFor: string };

export interface DocsScreenFixture {
  // Its folder under packages/E2E.
  folder: string;
  // Its server, from packages/E2E.
  server: string;
  // The variable its server (and its suite's spec) read the port from.
  portVariable: string;
  /*
   * The port the docs screens run it on: one of its own, so a fixture its
   * suite left running on its usual port is never reused.
   */
  port: number;
  /*
   * How a page is drawn in a language: `storage` sets the Dashboard's own
   * language key before the page loads (a fixture mounting the Dashboard's
   * i18n, which loads every locale as the product does); `query` adds
   * `?lang=` to the address.
   */
  languageBy: "storage" | "query";
  /*
   * The docs languages it draws, or "every". A shot of a fixture that
   * cannot draw a language shows the English shot in that language.
   */
  languages: "every" | ReadonlyArray<string>;
  // The project every page of it is in.
  projectId: string;
  // The instant its clock is pinned to: relative times read the same on every run.
  now: string;
}

export const DOCS_SCREEN_FIXTURES: Readonly<Record<string, DocsScreenFixture>> =
  {
    /*
     * The whole Dashboard - App, header, products menu, every route - over a
     * project made a minute ago, kept in memory (Journeys/README.md).
     */
    Journeys: {
      folder: "Journeys",
      server: "Journeys/Fixture/server.js",
      portVariable: "JOURNEYS_FIXTURE_PORT",
      port: 6823,
      languageBy: "storage",
      languages: "every",
      projectId: "10000000-0000-4000-8000-000000006831",
      now: "2026-11-11T10:00:00.000Z",
    },
    // The incident, alert and maintenance pages, with a resolved incident's feed.
    EventOverview: {
      folder: "EventOverview",
      server: "EventOverview/Fixture/server.js",
      portVariable: "EVENT_OVERVIEW_FIXTURE_PORT",
      port: 6824,
      languageBy: "query",
      languages: "every",
      projectId: "10000000-0000-4000-8000-000000000001",
      now: "2026-09-14T18:20:00.000Z",
    },
  };

export interface DocsScreen {
  // The file's name, and how a docs page asks for it: "screen:<name>".
  name: string;
  // What it shows, in English, for the README and the staleness issue.
  shows: string;
  // A key of DOCS_SCREEN_FIXTURES.
  fixture: string;
  // The Dashboard page, by its PageMap key.
  page: string;
  /*
   * The page's address, as RouteMap writes it: ":projectId" is the
   * fixture's project, and `params` fills the rest.
   */
  path: string;
  params?: Readonly<Record<string, string>> | undefined;
  // Query parameters the fixture reads (a seed, billing), with their "?".
  query?: string | undefined;
  // The browser's width and height, in CSS pixels.
  width: number;
  height: number;
  // What to do first, in order.
  state: ReadonlyArray<DocsScreenAction>;
  // What the picture is cropped to: a CSS selector, its first visible match.
  crop: string;
  // Space around the crop, in CSS pixels, kept inside the page.
  padding: number;
  // What is ringed: a button by its English words, the next thing to press.
  highlight?: string | undefined;
}

// The address the website-down shots check, and the project's people.
const ADDRESS: string = "https://acme-commerce.example";
// Incident #1042 of the event overview fixture.
const INCIDENT_1042_ID: string = "20000000-0000-4000-8000-000000001042";
// The code the journeys fixture accepts in a Verify dialog.
const VERIFICATION_CODE: string = "123456";

const GUIDED_SETUP_WIDTH: number = 1280;
// Home's question, two goals to a row: narrow enough to read in the docs' column.
const HOME_WIDTH: number = 1000;
const GUIDED_SETUP_HEIGHT: number = 1000;

// The website-down guided setup (#6804), walked step by step.
const WEBSITE_DOWN_ADDRESS: ReadonlyArray<DocsScreenAction> = [
  { type: "Website or API address", value: ADDRESS },
];
const WEBSITE_DOWN_CHECKED: ReadonlyArray<DocsScreenAction> = [
  ...WEBSITE_DOWN_ADDRESS,
  { press: "Start checking" },
  { waitFor: "guided-setup-first-check" },
];
const WEBSITE_DOWN_WHO: ReadonlyArray<DocsScreenAction> = [
  ...WEBSITE_DOWN_CHECKED,
  { press: "Continue" },
];
const WEBSITE_DOWN_TEST: ReadonlyArray<DocsScreenAction> = [
  ...WEBSITE_DOWN_WHO,
  { press: "Save and continue" },
];
const WEBSITE_DOWN_DONE: ReadonlyArray<DocsScreenAction> = [
  ...WEBSITE_DOWN_TEST,
  { press: "Send me a test page" },
  { press: "Send test page" },
  { press: "Continue" },
  { waitFor: "guided-setup-summary" },
];

// The on-call guided setup (#6805), on OneUptime Cloud, walked step by step.
const PAGING_PHONE: ReadonlyArray<DocsScreenAction> = [
  { press: "Turn on SMS and phone calls" },
  { press: "Add balance" },
  { type: "Amount (USD)", value: "20", exact: false },
  { press: "Recharge" },
];
const PAGING_WHO_ELSE: ReadonlyArray<DocsScreenAction> = [
  ...PAGING_PHONE,
  { type: "Your phone number", value: "+15550100123" },
  { press: "Text me a code" },
  { type: "Verification Code", value: VERIFICATION_CODE, exact: false },
  { press: "Verify" },
  { waitFor: "on-call-setup-reach-phone-value" },
  { press: "Continue" },
];
const PAGING_NO_ANSWER: ReadonlyArray<DocsScreenAction> = [
  ...PAGING_WHO_ELSE,
  { press: "Save and continue" },
  { press: "Add teammates" },
  { option: "Grace Hopper" },
  { escape: true },
];
const PAGING_TEST: ReadonlyArray<DocsScreenAction> = [
  ...PAGING_NO_ANSWER,
  { press: "Save and continue" },
];
const PAGING_DONE: ReadonlyArray<DocsScreenAction> = [
  ...PAGING_TEST,
  { press: "Test this policy" },
  { press: "Send test page" },
  { press: "Continue" },
  { waitFor: "guided-setup-summary" },
];

// The status page guided setup (#6806), with the website monitor there.
const STATUS_PAGE_PICK: ReadonlyArray<DocsScreenAction> = [
  { waitFor: "guided-setup" },
  // The seeded monitor, by its name: data, so it reads the same in every language.
  { tick: "Acme website", asWritten: true },
];
const STATUS_PAGE_REVIEW: ReadonlyArray<DocsScreenAction> = [
  ...STATUS_PAGE_PICK,
  { press: "Create the status page" },
];
const STATUS_PAGE_DONE: ReadonlyArray<DocsScreenAction> = [
  ...STATUS_PAGE_REVIEW,
  { press: "Looks good" },
  { waitFor: "guided-setup-summary" },
];

const step: (key: string) => string = (key: string): string => {
  return `[data-testid="guided-setup-step-${key}"]`;
};

export const DOCS_SCREENS: ReadonlyArray<DocsScreen> = [
  {
    name: "home-goal-website",
    shows:
      "Home in a new project, asking what the person came to do, with Know when my website or API is down ticked",
    fixture: "Journeys",
    page: "HOME",
    path: "/dashboard/:projectId/home/",
    width: HOME_WIDTH,
    height: 1000,
    state: [
      { waitFor: "welcome-question" },
      { tick: "Know when my website or API is down" },
    ],
    crop: '[data-testid="welcome-question"]',
    padding: 12,
    highlight: "Continue",
  },
  {
    name: "home-goal-paging",
    shows:
      "Home in a new project, with Page the right person when something breaks ticked",
    fixture: "Journeys",
    page: "HOME",
    path: "/dashboard/:projectId/home/",
    width: HOME_WIDTH,
    height: 1000,
    state: [
      { waitFor: "welcome-question" },
      { tick: "Page the right person when something breaks" },
    ],
    crop: '[data-testid="welcome-question"]',
    padding: 12,
    highlight: "Continue",
  },
  {
    name: "home-goal-status-page",
    shows:
      "Home in a new project, with Tell my customers with a status page ticked",
    fixture: "Journeys",
    page: "HOME",
    path: "/dashboard/:projectId/home/",
    width: HOME_WIDTH,
    height: 1000,
    state: [
      { waitFor: "welcome-question" },
      { tick: "Tell my customers with a status page" },
    ],
    crop: '[data-testid="welcome-question"]',
    padding: 12,
    highlight: "Continue",
  },
  {
    name: "home-goals-three",
    shows:
      "Home in a new project, with the three goals of the Quickstart ticked",
    fixture: "Journeys",
    page: "HOME",
    path: "/dashboard/:projectId/home/",
    width: HOME_WIDTH,
    height: 1000,
    state: [
      { waitFor: "welcome-question" },
      { tick: "Know when my website or API is down" },
      { tick: "Page the right person when something breaks" },
      { tick: "Tell my customers with a status page" },
    ],
    crop: '[data-testid="welcome-question"]',
    padding: 12,
    highlight: "Continue",
  },
  {
    name: "website-down-address",
    shows: "The website-down guided setup's first step, the address typed",
    fixture: "Journeys",
    page: "MONITOR_GUIDED_SETUP",
    path: "/dashboard/:projectId/monitors/setup",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: WEBSITE_DOWN_ADDRESS,
    crop: step("check"),
    padding: 0,
    highlight: "Start checking",
  },
  {
    name: "website-down-who",
    shows: "The website-down guided setup: who should be told",
    fixture: "Journeys",
    page: "MONITOR_GUIDED_SETUP",
    path: "/dashboard/:projectId/monitors/setup",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: WEBSITE_DOWN_WHO,
    crop: step("who_is_told"),
    padding: 0,
    highlight: "Save and continue",
  },
  {
    name: "website-down-test",
    shows: "The website-down guided setup: send yourself a test",
    fixture: "Journeys",
    page: "MONITOR_GUIDED_SETUP",
    path: "/dashboard/:projectId/monitors/setup",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: WEBSITE_DOWN_TEST,
    crop: step("test"),
    padding: 0,
    highlight: "Send me a test page",
  },
  {
    name: "website-down-summary",
    shows: "The website-down guided setup's summary, read from the records",
    fixture: "Journeys",
    page: "MONITOR_GUIDED_SETUP",
    path: "/dashboard/:projectId/monitors/setup",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: WEBSITE_DOWN_DONE,
    crop: '[data-testid="guided-setup-summary"]',
    padding: 0,
  },
  {
    name: "paging-reach-you",
    shows:
      "The on-call guided setup on OneUptime Cloud: how should we reach you, SMS and calls still off",
    fixture: "Journeys",
    page: "ON_CALL_DUTY_GUIDED_SETUP",
    path: "/dashboard/:projectId/on-call-duty/setup",
    query: "?billing=on",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: [{ waitFor: "guided-setup" }],
    crop: step("reach_you"),
    padding: 0,
    highlight: "Turn on SMS and phone calls",
  },
  {
    name: "paging-phone",
    shows:
      "The on-call guided setup: SMS and calls on, and the phone number field",
    fixture: "Journeys",
    page: "ON_CALL_DUTY_GUIDED_SETUP",
    path: "/dashboard/:projectId/on-call-duty/setup",
    query: "?billing=on",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: PAGING_PHONE,
    crop: step("reach_you"),
    padding: 0,
    highlight: "Text me a code",
  },
  {
    name: "paging-who-else",
    shows: "The on-call guided setup: who else is on call",
    fixture: "Journeys",
    page: "ON_CALL_DUTY_GUIDED_SETUP",
    path: "/dashboard/:projectId/on-call-duty/setup",
    query: "?billing=on",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: PAGING_WHO_ELSE,
    crop: step("who_else"),
    padding: 0,
    highlight: "Save and continue",
  },
  {
    name: "paging-no-answer",
    shows:
      "The on-call guided setup: what if nobody answers, with a teammate paged next",
    fixture: "Journeys",
    page: "ON_CALL_DUTY_GUIDED_SETUP",
    path: "/dashboard/:projectId/on-call-duty/setup",
    query: "?billing=on",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: PAGING_NO_ANSWER,
    crop: step("no_answer"),
    padding: 0,
    highlight: "Save and continue",
  },
  {
    name: "paging-test",
    shows: "The on-call guided setup: send a test page",
    fixture: "Journeys",
    page: "ON_CALL_DUTY_GUIDED_SETUP",
    path: "/dashboard/:projectId/on-call-duty/setup",
    query: "?billing=on",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: PAGING_TEST,
    crop: step("test"),
    padding: 0,
    highlight: "Test this policy",
  },
  {
    name: "paging-summary",
    shows: "The on-call guided setup's summary: Paging is set up",
    fixture: "Journeys",
    page: "ON_CALL_DUTY_GUIDED_SETUP",
    path: "/dashboard/:projectId/on-call-duty/setup",
    query: "?billing=on",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: PAGING_DONE,
    crop: '[data-testid="guided-setup-summary"]',
    padding: 0,
  },
  {
    name: "status-page-pick",
    shows:
      "The status page guided setup: name it, and pick the monitors it shows",
    fixture: "Journeys",
    page: "STATUS_PAGES_GUIDED_SETUP",
    path: "/dashboard/:projectId/status-pages/setup",
    query: "?seed=monitor",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: STATUS_PAGE_PICK,
    crop: step("pick"),
    padding: 0,
    highlight: "Create the status page",
  },
  {
    name: "status-page-review",
    shows:
      "The status page guided setup: what your customers see, and the public link",
    fixture: "Journeys",
    page: "STATUS_PAGES_GUIDED_SETUP",
    path: "/dashboard/:projectId/status-pages/setup",
    query: "?seed=monitor",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: STATUS_PAGE_REVIEW,
    crop: step("review"),
    padding: 0,
    highlight: "Looks good",
  },
  {
    name: "status-page-summary",
    shows: "The status page guided setup's summary, with Make it yours",
    fixture: "Journeys",
    page: "STATUS_PAGES_GUIDED_SETUP",
    path: "/dashboard/:projectId/status-pages/setup",
    query: "?seed=monitor",
    width: GUIDED_SETUP_WIDTH,
    height: GUIDED_SETUP_HEIGHT,
    state: STATUS_PAGE_DONE,
    crop: '[data-testid="guided-setup-summary"]',
    padding: 0,
    highlight: "Your own domain",
  },
  {
    name: "incident-feed",
    shows:
      "A resolved incident's feed: who was paged, each state change, and the notes, newest first",
    fixture: "EventOverview",
    page: "INCIDENT_VIEW",
    path: "/dashboard/:projectId/incidents/:id",
    params: { id: INCIDENT_1042_ID },
    query: "?ai=none",
    width: 1280,
    height: 1000,
    state: [{ waitFor: "feed-day" }],
    crop: '[data-testid="card"]:has([data-testid="feed"])',
    padding: 0,
  },
  {
    name: "incident-resolve",
    shows: "An acknowledged incident's header, with Resolve",
    fixture: "EventOverview",
    page: "INCIDENT_VIEW",
    path: "/dashboard/:projectId/incidents/:id",
    params: { id: INCIDENT_1042_ID },
    query: "?ai=none&state=ongoing",
    width: 1280,
    height: 1000,
    state: [{ waitFor: "event-header" }],
    crop: '[data-testid="event-header"]',
    padding: 0,
    highlight: "Resolve",
  },
];
