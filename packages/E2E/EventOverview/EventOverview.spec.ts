import {
  ElementHandle,
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Renders the real Incident, Alert, Scheduled Maintenance, Incident Episode
 * and Alert Episode overview pages against the offline fixture
 * (Fixture/Fixture.js). The layouts, side menus and pages are production
 * components; only the data boundary is synthetic. Every test runs with the
 * browser clock pinned to the fixture's NOW and a network fence that aborts
 * anything leaving the fixture server, and fails on uncaught page errors or
 * on any request the fixture does not model.
 */

// The fixture server's port: EVENT_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

const INCIDENT_ID: string = uuid("20000000", 1042);
const ALERT_ID: string = uuid("30000000", 311);
const SCHEDULED_MAINTENANCE_ID: string = uuid("40000000", 58);
const INCIDENT_EPISODE_ID: string = uuid("50000000", 12);
const ALERT_EPISODE_ID: string = uuid("60000000", 7);
const INCIDENT_RUN_ID: string = uuid("77000000", 1);
const ALERT_RUN_ID: string = uuid("77000000", 2);
const FIX_TASK_ID: string = uuid("82000000", 1);
const RESOLVED_INCIDENT_STATE_ID: string = uuid("21000000", 3);
const ACKNOWLEDGED_ALERT_STATE_ID: string = uuid("31000000", 2);

const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;

// The Retry confirmation of the incident-created notification (SubscriberNotificationResendCopy).
const INCIDENT_CREATED_RETRY_DESCRIPTION: string =
  "Retry resumes after the status pages that were already reached: only the pages of this incident's current scope that were not sent the notification in full are sent it now, including pages added since. Unlike notes and state changes, which are sent to every page again, the pages already reached are not sent it twice.";
const INCIDENT_PATH: string = `${DASHBOARD}/incidents/${INCIDENT_ID}`;
const ALERT_PATH: string = `${DASHBOARD}/alerts/${ALERT_ID}`;
const SCHEDULED_MAINTENANCE_PATH: string = `${DASHBOARD}/scheduled-maintenance-events/${SCHEDULED_MAINTENANCE_ID}`;
const INCIDENT_EPISODE_PATH: string = `${DASHBOARD}/incidents/episodes/${INCIDENT_EPISODE_ID}`;
const ALERT_EPISODE_PATH: string = `${DASHBOARD}/alerts/episodes/${ALERT_EPISODE_ID}`;

function incidentPath(number: number): string {
  return `${DASHBOARD}/incidents/${uuid("20000000", number)}`;
}

function alertPath(number: number): string {
  return `${DASHBOARD}/alerts/${uuid("30000000", number)}`;
}

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-overview-ui",
);

const INCIDENT_TLDR: string =
  "checkout-api restarted at 17:52 with its database pool cut from 40 to 10 connections, so checkout requests queued and p95 latency passed 2s — the same pool exhaustion as #1017, #1029 and #1036.";
// The header summary's text colours: text-gray-900, and text-gray-600 once rejected.
const SUMMARY_COLOR: string = "rgb(17, 24, 39)";
const REJECTED_SUMMARY_COLOR: string = "rgb(75, 85, 99)";

// ?tldr=long: a TL;DR at the server's 320-character cap.
const INCIDENT_LONG_TLDR: string =
  "checkout-api release 2026.09.14-2 restarted at 17:52:04 with DB_POOL_MAX=10 instead of 40, so requests waited up to 2s in pg.pool.connect for an orders-db connection and p95 latency rose from ~310 ms to 2.35 s (db.client.connections.usage pinned at 10/10). Rolling back to 2026.09.14-1 cleared it, as in #1017 and #1029.";
const ALERT_TLDR: string =
  "A 17:35 config reload cut the ledger client timeout from 5s to 1s, so slow ledger writes fail and payment webhooks return 502 — the same cause as alert #298.";

/*
 * The code-fix action on a completed investigation, which the AI card's
 * Remediation step offers (block 43); the docs name it too.
 */
const OPEN_FIX_PR: string = "Open fix pull request";

/*
 * A finished investigation folds to its summary on the AI card (block 43):
 * the toggle that opens the whole report, its working and the verdict.
 */
const SHOW_FULL_REPORT: string = "Show full report";

// The investigation's guarantee, shown whether or not its details are open.
const READ_ONLY: string = "Read-only — nothing in your systems was changed";

/*
 * The line that closes a published report. It only renders beside a report,
 * so the pages use it to know the AI card has finished loading.
 */
const REPORT_CAVEAT: string = "AI-generated first pass — verify before acting.";

// The rating row's question, which also names its two-answer group.
const VERDICT_QUESTION: string = "Was this analysis correct?";

/*
 * "Declare Incident" in an alert's header, after the state actions
 * (Components/Alert/DeclareIncidentFromAlert.ts). It opens the create-incident
 * page prefilled from the alert.
 */
const DECLARE_INCIDENT: string = "Declare Incident";
const DECLARE_INCIDENT_BUTTON_ID: string = "alert-declare-incident-btn";
const DECLARE_INCIDENT_FROM_ALERT_PATH: string = `${DASHBOARD}/incidents/create?alertIds=${ALERT_ID}`;
// Its disabled reason for someone who may not create incidents (PermissionGate).
const DECLARE_INCIDENT_DENIED: string =
  "You do not have permission to create this Incident. You need this permission: Create Incident.";

interface RecordedApiRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

interface RecordedModelRequest {
  modelName: string;
  id?: string;
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  skip?: number;
  limit?: number;
  analytics?: boolean;
}

interface RecordedWrite {
  modelName: string;
  id?: string;
  data?: Record<string, unknown>;
  miscDataProps?: Record<string, unknown>;
}

interface UnhandledRequest {
  kind: string;
  modelName?: string;
  method?: string;
  url?: string;
}

interface FixtureState {
  now: string;
  scenario: Record<string, unknown>;
  getItemRequests: Array<RecordedModelRequest>;
  listRequests: Array<RecordedModelRequest>;
  countRequests: Array<RecordedModelRequest>;
  apiRequests: Array<RecordedApiRequest>;
  updates: Array<RecordedWrite>;
  creates: Array<RecordedWrite>;
  deletes: Array<RecordedWrite>;
  unhandled: Array<UnhandledRequest>;
}

interface FixtureApiResult {
  status: number;
  data?: Record<string, unknown>;
  message?: string;
}

interface LabelledValue {
  label: string;
  value: string;
}

interface StatCell {
  label: string;
  value: string;
  // A second reading of the value, under it: "3 minutes after impact began".
  note?: string;
  description?: string;
}

interface EventPage {
  // Screenshot name and test title.
  name: string;
  path: string;
  // The ModelPage <h1>: "<noun> - <title>".
  pageTitle: string;
  title: string;
  identifier: string;
  // Heading of the page's activity feed card.
  feed: string;
  /*
   * Text that only appears once every asynchronously loaded card on the page
   * has its data, so assertions and screenshots never catch a loader.
   */
  readyTexts: ReadonlyArray<string>;
  // Hero pills: current state, severity and the duration pill.
  state: string;
  severity?: string;
  duration: string;
  facts: ReadonlyArray<LabelledValue>;
  statBar: string;
  stats: ReadonlyArray<StatCell>;
  // Right-hand column cards, top to bottom.
  rightColumn: ReadonlyArray<string>;
  detailsCard: string;
  // Field labels of the details card, in order.
  detailLabels: ReadonlyArray<string>;
  // The record's own ID, on the small line the details card ends with.
  recordId: string;
  /*
   * When the record was created, on that same line after the ID, for the
   * cards that show it. An incident's card does not: when it was declared,
   * and by whom, is the stat bar's Declared tile, and nowhere else.
   */
  recordCreated?: string | undefined;
  /*
   * The What happened card that opens the left column: the record's
   * description, and its root cause or null for none yet. Left out on a page
   * without the card (scheduled maintenance).
   */
  whatHappened?: { description: string; rootCause: string | null } | undefined;
}

const INCIDENT_PAGE: EventPage = {
  name: "incident-overview",
  path: INCIDENT_PATH,
  // Its number first, then its title (Utils/Project/RecordNumber).
  pageTitle: "#1042 Checkout API p95 latency above 2s",
  title: "Checkout API p95 latency above 2s",
  identifier: "#1042",
  feed: "Incident Feed",
  readyTexts: [
    REPORT_CAVEAT,
    "Rolling checkout-api back to 2026.09.14-1",
    "Communications Lead",
    "By eu-west-1 probe",
    "4 resources",
    // The Measurements card, which reads its own rows.
    "Time to postmortem",
  ],
  state: "Resolved",
  severity: "SEV-2",
  duration: "Lasted 11 minutes",
  /*
   * Who is on it before what it touched: the Incident Commander (the roles
   * card's primary role) and the owners, teams first.
   */
  facts: [
    { label: "Incident Commander", value: "Maya Chen" },
    { label: "Owners", value: "Checkout SRE, Sam Rivera" },
    {
      label: "Monitors",
      value: "Checkout API p95 latency, Orders DB connection pool",
    },
  ],
  statBar: "Incident response times",
  /*
   * When it was declared, how long after the impact began and by whom, then
   * the response. How long it lasted is the header's, beside its state.
   */
  stats: [
    {
      label: "Declared",
      value: "Sep 14, 06:01 PM GMT",
      note: "3 minutes after impact began",
      description: "By eu-west-1 probe",
    },
    {
      label: "Acknowledged in",
      value: "3 minutes",
      description: "Sep 14 2026, 06:04 PM GMT",
    },
    {
      label: "Resolved in",
      value: "11 minutes",
      description: "Sep 14 2026, 06:12 PM GMT",
    },
  ],
  // What it touched leads the column.
  rightColumn: [
    "Affected Resources",
    "Incident Details",
    "Measurements",
    "Incident Roles",
  ],
  detailsCard: "Incident Details",
  detailLabels: [
    "On-Call Duty Policies",
    "Subscriber Notification Status",
    // The status pages the incident is limited to, read only.
    "Status Page Scope",
    "Labels",
    "Incident Number",
  ],
  recordId: INCIDENT_ID,
  whatHappened: {
    description:
      "The API monitor for POST /api/checkout reported p95 latency of 2.4s for 3 consecutive checks from the eu-west-1 probe.",
    rootCause:
      "checkout-api 2026.09.14-2 started with DB_POOL_MAX=10 (was 40). Rolled back at 18:10.",
  },
};

const ALERT_PAGE: EventPage = {
  name: "alert-overview",
  path: ALERT_PATH,
  pageTitle: "#311 Payment webhook 5xx rate above 5%",
  title: "Payment webhook 5xx rate above 5%",
  identifier: "#311",
  feed: "Alert Feed",
  readyTexts: [
    REPORT_CAVEAT,
    "Alert #311 Created:",
    "Payments on-call",
    // Its monitor and its one service.
    "2 resources",
    // The Measurements card, which reads its own rows.
    "Time to resolve",
  ],
  state: "Resolved",
  severity: "High",
  duration: "Lasted 9 minutes",
  // An alert has no roles: its owners lead.
  facts: [
    { label: "Owners", value: "Payments" },
    { label: "Monitor", value: "Payment webhook error rate" },
    { label: "Episode", value: "Payment webhook failures — Sep 14" },
  ],
  statBar: "Alert response times",
  stats: [
    {
      label: "Created",
      value: "Sep 14, 06:06 PM GMT",
      description: "By eu-west-1 probe",
    },
    {
      label: "Acknowledged in",
      value: "2 minutes",
      description: "Sep 14 2026, 06:08 PM GMT",
    },
    {
      label: "Resolved in",
      value: "9 minutes",
      description: "Sep 14 2026, 06:15 PM GMT",
    },
  ],
  rightColumn: ["Affected Resources", "Alert Details", "Measurements"],
  detailsCard: "Alert Details",
  detailLabels: [
    "Monitor",
    "Episode",
    "On-Call Duty Policies",
    "Labels",
    "Alert Number",
  ],
  recordId: ALERT_ID,
  recordCreated: "Sep 14 2026, 06:06 PM GMT",
  whatHappened: {
    description:
      "payments-webhooks returned 5xx for 7.8% of payment provider callbacks over the last 5 minutes.",
    rootCause: null,
  },
};

const SCHEDULED_MAINTENANCE_PAGE: EventPage = {
  name: "scheduled-maintenance-overview",
  path: SCHEDULED_MAINTENANCE_PATH,
  pageTitle: "#58 Primary database failover drill",
  title: "Primary database failover drill",
  identifier: "#58",
  feed: "Scheduled Maintenance Feed",
  readyTexts: [
    "Subscribers notified",
    "Acme Internal Status",
    "4 resources",
    "Mark as Ongoing",
    // The Measurements card, which reads its own rows.
    "Maintenance duration",
  ],
  state: "Scheduled",
  duration: "Starts in 2 hours",
  /*
   * Who owns it (teams first), where it shows - each status page a link -
   * and who created it.
   */
  facts: [
    { label: "Owners", value: "Database Reliability, Jordan Patel" },
    {
      label: "Status pages",
      value: "Acme Commerce Status, Acme Internal Status",
    },
    { label: "Created by", value: "Jordan Patel" },
  ],
  statBar: "Maintenance window",
  stats: [
    {
      label: "Starts",
      value: "Sep 14 2026, 08:20 PM GMT",
      description: "in 2 hours",
    },
    {
      label: "Ends",
      value: "Sep 14 2026, 09:20 PM GMT",
      description: "in 3 hours",
    },
    {
      label: "Duration",
      value: "1 hour",
      description: "Planned window · times in GMT",
    },
  ],
  rightColumn: ["Maintenance Details", "Measurements", "Affected Resources"],
  detailsCard: "Maintenance Details",
  detailLabels: [
    "Starts At",
    "Ends At",
    "Shown on Status Pages",
    "Subscriber Reminders",
    "Subscriber Notifications",
    "Labels",
    "Scheduled Maintenance Number",
  ],
  recordId: SCHEDULED_MAINTENANCE_ID,
  recordCreated: "Sep 10 2026, 09:00 AM GMT",
};

const INCIDENT_EPISODE_PAGE: EventPage = {
  name: "incident-episode-overview",
  path: INCIDENT_EPISODE_PATH,
  pageTitle: "#12 Checkout degradation — Sep 14",
  title: "Checkout degradation — Sep 14",
  identifier: "#12",
  feed: "Episode Feed",
  readyTexts: [
    "was added to this episode",
    "Incident Commander",
    "Incident Count",
    "Checkout synthetic check failing in eu-west-1",
  ],
  state: "Resolved",
  severity: "SEV-2",
  duration: "Lasted 18 minutes",
  facts: [
    { label: "Incident Commander", value: "Maya Chen" },
    { label: "Owners", value: "Checkout SRE, Sam Rivera" },
    { label: "Grouping", value: "Checkout incidents within 30 minutes" },
    { label: "Last incident added", value: "19 minutes ago" },
  ],
  statBar: "Episode timing",
  stats: [
    // A grouping rule opened it: nobody to name.
    {
      label: "Declared",
      value: "Sep 14, 05:56 PM GMT",
      description: "Automatically",
    },
    { label: "Acknowledged in", value: "8 minutes" },
    { label: "Resolved in", value: "18 minutes" },
    { label: "Incidents", value: "4" },
  ],
  rightColumn: ["Episode Details", "Episode Roles"],
  detailsCard: "Episode Details",
  detailLabels: [
    "Episode Number",
    "Current State",
    "Episode Severity",
    "Incident Count",
    "Grouping Rule",
    "On-Call Duty Policies",
    "Labels",
  ],
  recordId: INCIDENT_EPISODE_ID,
  recordCreated: "Sep 14 2026, 05:56 PM GMT",
  whatHappened: {
    description:
      "Grouped automatically: four checkout incidents opened within 30 minutes of each other.",
    rootCause: null,
  },
};

const ALERT_EPISODE_PAGE: EventPage = {
  name: "alert-episode-overview",
  path: ALERT_EPISODE_PATH,
  pageTitle: "#7 Payment webhook failures — Sep 14",
  title: "Payment webhook failures — Sep 14",
  identifier: "#7",
  feed: "Episode Feed",
  readyTexts: [
    "was added to this episode",
    "Payments webhook alerts",
    "Alert Count",
    "Refund callback queue backlog above 500",
  ],
  state: "Resolved",
  severity: "High",
  duration: "Lasted 36 minutes",
  facts: [
    { label: "Owners", value: "Payments" },
    { label: "Grouping", value: "Payments webhook alerts" },
    { label: "Last alert added", value: "14 minutes ago" },
  ],
  statBar: "Episode timing",
  stats: [
    {
      label: "Created",
      value: "Sep 14, 05:40 PM GMT",
      description: "Automatically",
    },
    { label: "Acknowledged in", value: "15 minutes" },
    { label: "Resolved in", value: "36 minutes" },
    { label: "Alerts", value: "5" },
  ],
  rightColumn: ["Episode Details"],
  detailsCard: "Episode Details",
  detailLabels: [
    "Episode Number",
    "Current State",
    "Episode Severity",
    "Alert Count",
    "Grouping Rule",
    "On-Call Duty Policies",
    "Labels",
  ],
  recordId: ALERT_EPISODE_ID,
  recordCreated: "Sep 14 2026, 05:40 PM GMT",
  whatHappened: {
    description:
      "Grouped automatically: payment webhook alerts from the same monitor group.",
    rootCause: null,
  },
};

const EVENT_PAGES: ReadonlyArray<EventPage> = [
  INCIDENT_PAGE,
  ALERT_PAGE,
  SCHEDULED_MAINTENANCE_PAGE,
  INCIDENT_EPISODE_PAGE,
  ALERT_EPISODE_PAGE,
];

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });

  // Every fixture date is relative to NOW; timers keep running.
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __eventOverviewFixture?: unknown })
          .__eventOverviewFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

async function open(
  page: Page,
  pagePath: string,
  query: string = "",
): Promise<void> {
  await page.goto(`${pagePath}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function expectPageReady(
  page: Page,
  eventPage: EventPage,
  readyTexts: ReadonlyArray<string> = eventPage.readyTexts,
): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    eventPage.pageTitle,
    { timeout: 30000 },
  );
  for (const text of readyTexts) {
    /*
     * The report's closing line is under the fold: a page that waits for
     * it reads the whole report, as a reader who opens it does.
     */
    if (text === REPORT_CAVEAT) {
      await showFullReport(page);
    }
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 30000 });
  }
  /*
   * A page that leads with What happened also names its owners in the
   * header, read on their own: wait for both, so nothing moves after.
   */
  if (eventPage.whatHappened) {
    await expect(hero(page).getByTestId("event-owners")).toBeVisible({
      timeout: 30000,
    });
    await expectWhatHappenedSettled(page);
  }
}

/*
 * What happened leads the left column of an incident, alert or episode, and
 * the markdown viewer that draws its text loads on its own: every card under
 * it moves down when the viewer lands. Anything that measures the page waits
 * for it.
 */
async function expectWhatHappenedSettled(page: Page): Promise<void> {
  const whatHappened: Locator = page.getByTestId("what-happened");
  await expect(whatHappened).toBeVisible({ timeout: 30000 });
  await expect(whatHappened.getByRole("status")).toHaveCount(0, {
    timeout: 30000,
  });
}

async function openReady(
  page: Page,
  eventPage: EventPage,
  query: string = "",
  readyTexts: ReadonlyArray<string> = eventPage.readyTexts,
): Promise<void> {
  await open(page, eventPage.path, query);
  await expectPageReady(page, eventPage, readyTexts);
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __eventOverviewFixture: FixtureState })
          .__eventOverviewFixture,
      ),
    ) as FixtureState;
  });
}

async function apiRequestsTo(
  page: Page,
  route: string,
): Promise<Array<RecordedApiRequest>> {
  return (await fixture(page)).apiRequests.filter(
    (request: RecordedApiRequest): boolean => {
      return request.url.endsWith(route);
    },
  );
}

async function evidenceRequestsFor(
  page: Page,
  citationId: string,
): Promise<Array<RecordedApiRequest>> {
  return (await apiRequestsTo(page, "/ai-investigation/evidence")).filter(
    (request: RecordedApiRequest): boolean => {
      return request.body["citationId"] === citationId;
    },
  );
}

async function callFixtureApi(
  page: Page,
  method: string,
  route: string,
  body: Record<string, unknown>,
): Promise<FixtureApiResult> {
  return page.evaluate(
    async ({
      method,
      route,
      body,
    }: {
      method: string;
      route: string;
      body: Record<string, unknown>;
    }): Promise<FixtureApiResult> => {
      return (
        window as unknown as {
          __eventOverviewFixture: {
            callApi: (
              method: string,
              route: string,
              body: Record<string, unknown>,
            ) => Promise<FixtureApiResult>;
          };
        }
      ).__eventOverviewFixture.callApi(method, route, body);
    },
    { method, route, body },
  );
}

async function screenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: options.fullPage !== false,
    animations: "disabled",
  });
}

async function screenshotElement(
  locator: Locator,
  name: string,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

// Screenshot of the page area from the top of `from` to the bottom of `to`.
async function screenshotBetween(
  page: Page,
  from: Locator,
  to: Locator,
  name: string,
  padding: number = 12,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await from.scrollIntoViewIfNeeded();
  const top: Box = await documentBox(from);
  const bottom: Box = await documentBox(to);
  const x: number = Math.max(0, Math.min(top.x, bottom.x) - padding);
  const right: number = Math.max(top.x + top.width, bottom.x + bottom.width);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
    clip: {
      x,
      y: Math.max(0, top.y - padding),
      width: right - x + padding,
      height: bottom.y + bottom.height - top.y + 2 * padding,
    },
  });
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A bounding box in document coordinates (independent of scroll).
async function documentBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element: Element): Box => {
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

/*
 * The document boxes of several elements, read from one layout, for checks
 * of where they sit against each other. documentBox() is a round trip of its
 * own, and a card still filling in above them moves them all between two of
 * those: on a busy runner the AI card draws its investigation after its
 * conversation has loaded, and the composer below moves down by hundreds of
 * pixels while its parts are read one by one.
 */
async function documentBoxes(
  page: Page,
  locators: Array<Locator>,
): Promise<Array<Box>> {
  const elements: Array<ElementHandle<Element>> = [];

  for (const locator of locators) {
    const element: ElementHandle<Element> | null =
      await locator.elementHandle();
    expect(element).not.toBeNull();
    elements.push(element!);
  }

  return page.evaluate((nodes: Array<Element>): Array<Box> => {
    return nodes.map((node: Element): Box => {
      const rect: DOMRect = node.getBoundingClientRect();
      return {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      };
    });
  }, elements);
}

async function expectAbove(
  upper: Locator,
  lower: Locator,
  message: string,
): Promise<void> {
  const upperBox: Box = await documentBox(upper);
  const lowerBox: Box = await documentBox(lower);
  expect(upperBox.y + upperBox.height, message).toBeLessThanOrEqual(
    lowerBox.y + 1,
  );
}

/*
 * Where a card header keeps what the card offers (Edit, Create, the ⋯ menu,
 * a status pill): at the header's right edge, and under the title only when
 * it does not fit beside it - never at the left, never centred. "Why are
 * edit buttons not on the right?" And the description stays right under the
 * title ("There's a lot of gap between the title of the card and the
 * description of the card"): beside the title the actions come before it,
 * which runs under both; on a line of their own they follow it.
 */
async function expectHeaderActionsOnTheRight(
  cardLocator: Locator,
  label: string,
  options?: { onTitleLine?: boolean | undefined } | undefined,
): Promise<void> {
  const header: Locator = cardLocator.getByTestId("card-header").first();
  const title: Box = await documentBox(
    header.getByTestId("card-details-heading"),
  );
  const actions: Box = await documentBox(
    header.getByTestId("card-header-actions"),
  );
  const headerBox: Box = await documentBox(header);
  const isOnTitleLine: boolean =
    actions.y < title.y + title.height && actions.y + actions.height > title.y;

  expect(
    Math.abs(headerBox.x + headerBox.width - (actions.x + actions.width)),
    `${label} ends at the header's right edge`,
  ).toBeLessThanOrEqual(1);

  if (isOnTitleLine) {
    expect(actions.x, `${label} sits right of the title`).toBeGreaterThan(
      title.x + 1,
    );
  } else {
    expect(
      actions.y,
      `${label} is under the title when it is not beside it`,
    ).toBeGreaterThanOrEqual(title.y + title.height - 1);
  }

  if (options?.onTitleLine !== undefined) {
    expect(isOnTitleLine, `${label} on the title's line`).toBe(
      options.onTitleLine,
    );
  }

  /*
   * The description stays right under the title: beside the title the
   * actions come before it (it runs under both, or beside them in the
   * default header); on a line of their own they follow it.
   */
  const description: Locator = header.getByTestId("card-description");
  if ((await description.count()) > 0 && (await description.isVisible())) {
    const descriptionBox: Box = await documentBox(description);

    if (isOnTitleLine) {
      expect(actions.y, `${label} is not under the description`).toBeLessThan(
        descriptionBox.y + 1,
      );
    } else {
      expect(
        descriptionBox.y - (title.y + title.height),
        `${label}'s description right under the title`,
      ).toBeLessThanOrEqual(7);
      expect(
        actions.y,
        `${label} follows the description on a line of its own`,
      ).toBeGreaterThanOrEqual(descriptionBox.y + descriptionBox.height - 1);
    }
  }
}

function sideMenu(page: Page): Locator {
  return page
    .locator("aside[role='navigation'][aria-label='Main navigation']")
    .first();
}

function card(page: Page, heading: string | RegExp): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: heading,
      exact: typeof heading === "string",
    }),
  });
}

// The one AI card: its two steps, Investigation and Remediation (block 43).
function investigationCard(page: Page): Locator {
  return card(page, "OneUptime AI");
}

function investigationStep(page: Page): Locator {
  return page.getByTestId("ai-card-step-investigation");
}

function remediationStep(page: Page): Locator {
  return page.getByTestId("ai-card-step-remediation");
}

// Each step of the AI card: its section, its title and its pill's name.
interface AiCardStepNames {
  testId: string;
  title: string;
  pill: string;
}

const STEP_TITLES_AND_PILLS: ReadonlyArray<AiCardStepNames> = [
  {
    testId: "ai-card-step-investigation",
    title: "Investigation",
    pill: "Investigation status",
  },
  {
    testId: "ai-card-step-remediation",
    title: "Remediation",
    pill: "Remediation status",
  },
];

function stepTitle(page: Page, step: AiCardStepNames): Locator {
  return page
    .getByTestId(step.testId)
    .getByRole("heading", { level: 3, name: step.title, exact: true });
}

function reportToggle(page: Page): Locator {
  return page.getByTestId("investigation-report-toggle");
}

// A finished investigation folded to its answer: the TL;DR, or its Summary.
function foldedReportSummary(page: Page): Locator {
  return investigationStep(page).getByTestId("investigation-report-summary");
}

/*
 * Opens a finished investigation's folded report: its sections, its working
 * and the verdict. A no-op once it is open.
 */
async function showFullReport(page: Page): Promise<void> {
  const toggle: Locator = reportToggle(page);
  await expect(toggle).toBeVisible({ timeout: 30000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

// The card that opens an incident's, alert's or episode's left column.
function whatHappenedCard(page: Page): Locator {
  return card(page, "What happened");
}

/*
 * The header: every incident, alert, episode and maintenance event draws one
 * (EventStatusPanel). A record with nothing left to do has no actions group,
 * so the header is found by its own name, not through its buttons.
 */
function hero(page: Page): Locator {
  return page.getByTestId("event-header");
}

// The number and the pills: state, severity, Private.
function heroChips(page: Page): Locator {
  return hero(page).getByTestId("event-header-chips");
}

// The hero's action row: state buttons, other actions, then "More actions".
function heroActions(page: Page): Locator {
  return page.getByRole("group", { name: "Event actions" });
}

function summarySection(page: Page): Locator {
  return page.getByRole("region", {
    name: "Investigation summary",
    exact: true,
  });
}

function reportSection(page: Page): Locator {
  return page.getByRole("region", {
    name: "Investigation report",
    exact: true,
  });
}

/*
 * The one section under the report that holds what the run did: the queries
 * it ran, the steps it took and what it cost. It starts collapsed.
 */
function investigationDetails(page: Page): Locator {
  return page.getByTestId("investigation-details");
}

function detailsToggle(page: Page): Locator {
  return page.getByTestId("investigation-details-toggle");
}

type DetailsTabName = "Evidence" | "Activity";

/*
 * A tab of the details (or its panel, which the tab names) by the start of
 * its name: every tab name ends with its count. Phones draw a shorter
 * "Evidence" label, but the name stays "Evidence checked".
 */
function detailsTab(page: Page, name: DetailsTabName): Locator {
  return investigationDetails(page).getByRole("tab", {
    name: new RegExp(`^${name}\\b`),
    includeHidden: true,
  });
}

function detailsPanel(page: Page, name: DetailsTabName): Locator {
  return investigationDetails(page).getByRole("tabpanel", {
    name: new RegExp(`^${name}\\b`),
    includeHidden: true,
  });
}

// Hidden lists count too: the details body stays mounted while collapsed.
function namedList(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("list", { name, exact: true, includeHidden: true });
}

function evidenceList(page: Page): Locator {
  return namedList(page, "Evidence checked");
}

function evidenceRow(page: Page, citationId: string): Locator {
  return evidenceList(page).locator(`li[data-citation-id="${citationId}"]`);
}

function evidenceToggle(row: Locator): Locator {
  return row.locator(":scope > button");
}

function evidenceDetails(row: Locator): Locator {
  return row.locator(":scope > [role='region']");
}

/*
 * An incident/alert reference link in the report prose, by its visible text
 * ("#1017"). Its accessible name is the longer title.
 */
function referenceLink(scope: Locator, text: string): Locator {
  return scope.locator("a[href]").filter({ hasText: new RegExp(`^${text}$`) });
}

function citationChip(scope: Locator, citationId: string): Locator {
  return scope.locator(`button[data-citation-id="${citationId}"]`);
}

// Opens the collapsed details; a no-op once they are open.
async function openInvestigationDetails(page: Page): Promise<Locator> {
  const toggle: Locator = detailsToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return investigationDetails(page);
}

/*
 * The queries sit behind the collapsed details, on the Evidence tab. Safe to
 * call again: it only opens and selects what is not open and selected yet.
 */
async function openEvidence(page: Page): Promise<Locator> {
  await openInvestigationDetails(page);
  const tab: Locator = detailsTab(page, "Evidence");
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const list: Locator = evidenceList(page);
  await expect(list).toBeVisible();
  return list;
}

async function expandEvidence(
  page: Page,
  citationId: string,
): Promise<Locator> {
  await openEvidence(page);
  const row: Locator = evidenceRow(page, citationId);
  await evidenceToggle(row).click();
  await expect(evidenceToggle(row)).toHaveAttribute("aria-expanded", "true");
  const details: Locator = evidenceDetails(row);
  await expect(details).toBeVisible();
  return details;
}

async function expectRowsLoaded(details: Locator): Promise<void> {
  await expect(details.getByRole("group", { name: "Rows" })).toBeVisible();
  await expect(details.getByText("Loading rows")).toHaveCount(0);
}

async function definitionPairs(scope: Locator): Promise<Array<LabelledValue>> {
  return scope
    .locator("dl > div")
    .evaluateAll((rows: Array<Element>): Array<LabelledValue> => {
      return rows.map((row: Element): LabelledValue => {
        return {
          label: (row.querySelector("dt")?.textContent || "").trim(),
          value: (row.querySelector("dd")?.textContent || "").trim(),
        };
      });
    });
}

/*
 * Each tile of a stat bar: its label, value, note (the value's second
 * reading, as large as body text) and description (the small print). A start
 * time keeps its date and its time whole with no-break spaces; it is read
 * here with plain ones, and the start tile's own tests check the spaces.
 */
async function statCells(page: Page, name: string): Promise<Array<StatCell>> {
  return page
    .getByRole("group", { name, exact: true })
    .locator(":scope > div")
    .evaluateAll((cells: Array<Element>): Array<StatCell> => {
      const noBreakSpace: string = String.fromCharCode(0xa0);
      const text: (element: Element | undefined) => string = (
        element: Element | undefined,
      ): string => {
        return (element?.textContent || "")
          .split(noBreakSpace)
          .join(" ")
          .trim();
      };
      return cells.map((cell: Element): StatCell => {
        const lines: Array<Element> = Array.from(cell.children);
        const result: StatCell = {
          label: text(lines[0]),
          value: text(lines[1]),
        };
        for (const line of lines.slice(2)) {
          if (line.classList.contains("text-xs")) {
            result.description = text(line);
          } else {
            result.note = text(line);
          }
        }
        return result;
      });
    });
}

/*
 * The header's facts as they read, after how long (heroDuration reads that
 * one): a fact that names people - the Incident Commander, the owners -
 * lists their names, without the avatars' initials; one that names things -
 * monitors, an episode, status pages, one under another - lists them, then
 * how many more.
 */
async function heroFacts(header: Locator): Promise<Array<LabelledValue>> {
  return header
    .locator("dl > div")
    .evaluateAll((rows: Array<Element>): Array<LabelledValue> => {
      return rows
        .filter((row: Element): boolean => {
          return !row.querySelector("[data-testid='event-header-duration']");
        })
        .map((row: Element): LabelledValue => {
          const value: Element | null = row.querySelector("dd");
          const names: Array<string> = Array.from(
            value?.querySelectorAll("[data-testid='event-person-name']") || [],
          ).map((name: Element): string => {
            return (name.textContent || "").trim();
          });
          const list: Element | null =
            value?.querySelector("[data-testid$='-links']") || null;
          const listed: Array<string> = list
            ? Array.from(list.children).map((child: Element): string => {
                return (child.textContent || "").trim();
              })
            : [];
          const more: Array<string> = listed.filter((text: string): boolean => {
            return text.startsWith("+");
          });
          const things: string = listed
            .filter((text: string): boolean => {
              return !text.startsWith("+");
            })
            .join(", ");
          return {
            label: (row.querySelector("dt")?.textContent || "").trim(),
            value:
              names.length > 0
                ? names.join(", ")
                : list && listed.length > 0
                  ? [things, ...more].join(" ")
                  : (value?.textContent || "").trim(),
          };
        });
    });
}

/*
 * How long, as the header's first fact says it: its label over the
 * duration, read as "Lasted 11 minutes". The label is drawn in capitals, so
 * its words are read as written (textContent), not as drawn.
 */
async function heroDuration(header: Locator): Promise<string> {
  const duration: Locator = header.getByTestId("event-header-duration");

  if ((await duration.count()) === 0) {
    return "";
  }

  return duration.evaluate((value: Element): string => {
    const fact: Element | null = value.closest("dl > div");
    const label: string = (fact?.querySelector("dt")?.textContent || "").trim();

    return `${label} ${(value.textContent || "").trim()}`;
  });
}

async function expectHeroDuration(
  header: Locator,
  text: string,
): Promise<void> {
  await expect
    .poll(async (): Promise<string> => {
      return heroDuration(header);
    })
    .toBe(text);
}

async function detailLabels(scope: Locator): Promise<Array<string>> {
  return (await scope.locator("label").allInnerTexts())
    .map((text: string): string => {
      return text.trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

/*
 * Pills and their neighbours are separate inline elements with no text
 * between them, so the rendered text (innerText) is what reads "Lasted 11
 * minutes"; textContent would run the words together.
 */
async function expectRenderedText(
  locator: Locator,
  text: string,
): Promise<void> {
  await expect(locator).toContainText(text, { useInnerText: true });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

// Whether an element cuts its own content off (a clamp or a truncation).
async function isOverflowing(locator: Locator): Promise<boolean> {
  return locator.evaluate((element: Element): boolean => {
    return (
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1
    );
  });
}

async function expectNoErrorStates(page: Page): Promise<void> {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByText("An unexpected error has occurred")).toHaveCount(
    0,
  );
  await expect(page.getByText(/^Cannot load /)).toHaveCount(0);
  await expect(page.getByText(/^Could not refresh /)).toHaveCount(0);
}

/*
 * Records whether the first-load skeleton is ever mounted again, so a test
 * can prove a refresh happened in place.
 */
async function watchForSkeleton(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const target: { __skeletonSeen?: boolean } = window as unknown as {
      __skeletonSeen?: boolean;
    };
    target.__skeletonSeen = false;
    new MutationObserver((): void => {
      if (
        document.querySelector("[data-testid='event-overview-skeleton-hero']")
      ) {
        target.__skeletonSeen = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function skeletonWasSeen(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return Boolean(
      (window as unknown as { __skeletonSeen?: boolean }).__skeletonSeen,
    );
  });
}

/*
 * ---------------------------------------------------------------------------
 * AI investigation report
 * ---------------------------------------------------------------------------
 */

test.describe("AI investigation report", () => {
  test("the summary is the card's first section, above the report", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const investigation: Locator = investigationCard(page);
    await expect(investigation.getByLabel("Investigation status")).toHaveText(
      "Completed",
    );
    await expect(investigation).toContainText(
      "What OneUptime AI found, and what it is doing about it.",
    );

    const summary: Locator = summarySection(page);
    await expect(summary.getByRole("heading", { level: 3 })).toHaveText(
      "Summary",
    );
    // The TL;DR is the section's lead line; it no longer wears a chip.
    await expect(summary.getByText("TL;DR", { exact: true })).toHaveCount(0);
    await expect(
      summary.getByText(INCIDENT_TLDR, { exact: true }),
    ).toBeVisible();
    await expect(summary).toContainText(
      "Checkout API p95 latency passed 2s at 18:01 UTC because checkout-api restarted at 17:52",
    );
    // The raw marker never reaches the page: it is a chip.
    await expect(summary).not.toContainText("[C2]");
    await expectAbove(summary, reportSection(page), "summary before report");

    const requests: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/ai-investigation/incident",
    );
    expect(requests[0]?.body).toEqual({ incidentId: INCIDENT_ID });
  });

  test("the report lays out its sections in order without the brand heading or server blocks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const investigation: Locator = investigationCard(page);
    const report: Locator = reportSection(page);
    /*
     * No title of its own: the card's title already names the report, whose
     * sections sit directly in the card under h3s like the Summary's.
     */
    await expect(
      report.getByRole("heading", { name: "Investigation report" }),
    ).toHaveCount(0);
    await expect(report.getByRole("heading", { level: 3 })).toHaveText([
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
    // The Summary was lifted out, not repeated.
    await expect(report.getByRole("heading", { name: "Summary" })).toHaveCount(
      0,
    );

    /*
     * The caveat and Copy report close the report, after its last section.
     * There is no separate "AI generated" pill beside Copy report.
     */
    const caveat: Locator = report.getByText(REPORT_CAVEAT, { exact: true });
    await expect(caveat).toBeVisible();
    await expect(report.getByText("AI generated", { exact: true })).toHaveCount(
      0,
    );
    const copyReport: Locator = report.getByRole("button", {
      name: "Copy report",
    });
    await expect(copyReport).toBeVisible();
    await expectAbove(
      report.getByRole("heading", { name: "Suggested next steps" }),
      caveat,
      "the last section before the caveat",
    );

    // The root cause is a plain section, not an amber callout.
    const rootCause: Locator = report.locator(
      "section[data-section-kind='RootCause']",
    );
    await expect(rootCause).not.toHaveClass(/border|bg-|ring|rounded|shadow/);
    await expect(rootCause).toContainText(
      "Release 2026.09.14-2 of checkout-api started at 17:52:04",
    );
    await expect(
      report.locator("section[data-section-kind='Evidence'] li"),
    ).toHaveCount(5);
    await expect(
      report.locator("section[data-section-kind='NextSteps'] li"),
    ).toHaveCount(3);

    await expect(investigation).not.toContainText(
      "Automated Root Cause Analysis",
    );
    /*
     * The report is prose only: the queries it cites live in the details
     * section below it, not in the report and not in its markdown block.
     */
    await expect(report).not.toContainText("Evidence checked");
    await expect(report).not.toContainText("row(s)");
    await expect(report).not.toContainText(
      "Investigated automatically by OneUptime AI",
    );
    await expect(evidenceList(page)).toHaveCount(1);
    await expect(namedList(report, "Evidence checked")).toHaveCount(0);
    await expectAbove(report, investigationDetails(page), "report first");

    /*
     * What the run did and the read-only guarantee stay on the card while the
     * details are collapsed; tokens and the model wait inside them.
     */
    const usage: Locator = namedList(
      investigationDetails(page),
      "Investigation usage",
    );
    await expect(usage).toBeVisible();
    await expect(usage.getByRole("listitem")).toHaveText([
      "10 telemetry queries",
      "14 steps",
      READ_ONLY,
    ]);
    await expect(namedList(investigation, "Investigation usage")).toHaveCount(
      1,
    );
    const cost: Locator = namedList(
      investigationDetails(page),
      "Model and tokens",
    );
    await expect(cost).toBeHidden();
    await openInvestigationDetails(page);
    await expect(cost.getByRole("listitem")).toHaveText([
      "48,212 tokens",
      "Model claude-sonnet-4-5",
    ]);
  });

  test("Copy report copies the report exactly as published", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.addInitScript((): void => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string): Promise<void> => {
            (window as unknown as { __copiedText?: string }).__copiedText =
              text;
          },
        },
      });
    });
    await openReady(page, INCIDENT_PAGE);

    await reportSection(page)
      .getByRole("button", { name: "Copy report" })
      .click();
    await expect
      .poll(async (): Promise<string> => {
        return page.evaluate((): string => {
          return (
            (window as unknown as { __copiedText?: string }).__copiedText || ""
          );
        });
      })
      .toMatch(/^## .*AI — Automated Root Cause Analysis/);

    const copied: string = await page.evaluate((): string => {
      return (
        (window as unknown as { __copiedText?: string }).__copiedText || ""
      );
    });
    expect(copied).toContain("**Summary** — Checkout API p95 latency");
    expect(copied).toContain("**Evidence checked**");
    expect(copied).toContain("- **[C10]** Incident #1042 timeline (1 entry)");
    expect(copied).toContain("*Investigated automatically by OneUptime AI");
  });

  test("incident references link to the incidents the server resolved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const summary: Locator = summarySection(page);
    const references: ReadonlyArray<{
      number: number;
      title: string;
    }> = [
      {
        number: 1017,
        title: "#1017 · Checkout API p95 latency above 2s · Resolved",
      },
      {
        number: 1029,
        title: "#1029 · Checkout requests timing out on orders-db · Resolved",
      },
      {
        number: 1036,
        title: "#1036 · Checkout API p95 latency above 2s · Resolved",
      },
    ];
    for (const reference of references) {
      const link: Locator = referenceLink(summary, `#${reference.number}`);
      await expect(link).toHaveAttribute(
        "href",
        incidentPath(reference.number),
      );
      await expect(link).toHaveAttribute("title", reference.title);
      await expect(
        summary.getByRole("link", { name: reference.title, exact: true }),
      ).toHaveCount(1);
      await expect(link).toHaveClass(/bg-indigo-50/);
    }

    // Summary, root cause and next steps each mention all three.
    const investigation: Locator = investigationCard(page);
    await expect(
      investigation.locator("a[href]").filter({ hasText: /^#10(17|29|36)$/ }),
    ).toHaveCount(9);

    // Report prose never links anywhere but a resolved dashboard page.
    const hrefs: Array<string> = await reportSection(page)
      .locator("a[href]")
      .evaluateAll((links: Array<Element>): Array<string> => {
        return links.map((link: Element): string => {
          return link.getAttribute("href") || "";
        });
      });
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(new RegExp(`^${DASHBOARD}/incidents/20000000-`));
    }
  });

  test("clicking a reference opens that incident on the same route and loads its data", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    await referenceLink(summarySection(page), "#1029").click();

    await expect(page).toHaveURL(new RegExp(`${incidentPath(1029)}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "#1029 Checkout requests timing out on orders-db",
    );
    await expect(hero(page).getByRole("heading", { level: 2 })).toHaveText(
      "Checkout requests timing out on orders-db",
    );
    await expect(hero(page)).toContainText("#1029");
    await expectHeroDuration(hero(page), "Lasted 51 minutes");
    await expect(
      page.getByText("Checkout requests timing out on orders-db").first(),
    ).toBeVisible();

    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return (await apiRequestsTo(page, "/ai-investigation/incident")).map(
          (request: RecordedApiRequest): unknown => {
            return request.body["incidentId"];
          },
        );
      })
      .toContain(uuid("20000000", 1029));
    const state: FixtureState = await fixture(page);
    expect(
      state.getItemRequests.some((request: RecordedModelRequest): boolean => {
        return (
          request.modelName === "Incident" &&
          request.id === uuid("20000000", 1029)
        );
      }),
    ).toBe(true);

    /*
     * #1029 has no investigation: the card says so in its own words, with
     * nothing of #1042's report, and there is no header summary.
     */
    await expect(card(page, "Incident Feed")).toBeVisible();
    await expect(
      investigationCard(page).getByLabel("Investigation status"),
    ).toHaveText("Not investigated");
    await expect(summarySection(page)).toHaveCount(0);
    await expect(reportSection(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "View full report" }),
    ).toHaveCount(0);
    await expect(page.getByText(INCIDENT_TLDR)).toHaveCount(0);

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      INCIDENT_PAGE.pageTitle,
    );
    // Back on #1042, its report is folded to its summary again.
    await expect(foldedReportSummary(page)).toHaveText(INCIDENT_TLDR);
    await expect(reportToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expectNoErrorStates(page);
  });

  test("a citation chip expands its evidence row and loads the rows once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const summary: Locator = summarySection(page);
    await expect(summary.locator("button[data-citation-id]")).toHaveText([
      "C2",
      "C3",
      "C6",
      "C1",
    ]);
    const chip: Locator = summary.getByRole("button", {
      name: 'Citation C1: Incident search "checkout latency" (3 found)',
      exact: true,
    });
    await expect(chip).toHaveAttribute(
      "title",
      'Incident search "checkout latency" (3 found)',
    );
    // The tooltip keeps the raw label; the spoken label reads local times.
    await expect(citationChip(summary, "C2")).toHaveAttribute(
      "title",
      "P95(http.server.request.duration), 2026-09-14T17:00:00.000Z – 2026-09-14T18:20:00.000Z",
    );
    await expect(citationChip(summary, "C2")).toHaveAttribute(
      "aria-label",
      "Citation C2: P95(http.server.request.duration), Sep 14, 5:00 PM – 6:20 PM",
    );

    expect(await evidenceRequestsFor(page, "C1")).toEqual([]);
    /*
     * The queries start collapsed behind the details, so the chip has to open
     * them itself before it can reveal its row.
     */
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(evidenceList(page)).toBeHidden();
    await chip.click();

    // First: the highlight only lasts two seconds.
    const row: Locator = evidenceRow(page, "C1");
    await expect(row).toHaveAttribute("data-highlighted", "true");
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(detailsTab(page, "Evidence")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const toggle: Locator = evidenceToggle(row);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(row).toBeInViewport();
    await expect(toggle).toBeFocused();

    const details: Locator = evidenceDetails(row);
    await expect(details).toHaveAttribute(
      "id",
      (await toggle.getAttribute("aria-controls")) || "missing",
    );
    await expectRowsLoaded(details);
    await expect(
      details.getByRole("button", { name: /^#1036 · Checkout API p95/ }),
    ).toBeVisible();

    const requests: Array<RecordedApiRequest> = await evidenceRequestsFor(
      page,
      "C1",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.body).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID,
      investigationRunId: INCIDENT_RUN_ID,
      citationId: "C1",
    });

    // The highlight is brief.
    await expect(row).not.toHaveAttribute("data-highlighted", "true", {
      timeout: 6000,
    });

    // Collapse and expand again: cached, no second request.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(details).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      details.getByRole("button", { name: /^#1029 · Checkout requests/ }),
    ).toBeVisible();
    await expect(details.getByText("Loading rows")).toHaveCount(0);

    // A chip for an already expanded row keeps it open, still one request.
    await citationChip(reportSection(page), "C1").first().click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(row).toHaveAttribute("data-highlighted", "true");
    expect(await evidenceRequestsFor(page, "C1")).toHaveLength(1);
    expect(
      await apiRequestsTo(page, "/ai-investigation/evidence"),
    ).toHaveLength(1);
  });

  test("the header summary shows the TL;DR and View full report focuses the panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const header: Locator = hero(page);
    await expect(
      header.getByText("AI root cause analysis", { exact: true }),
    ).toBeVisible();
    await expect(
      header.getByText(INCIDENT_TLDR, { exact: true }),
    ).toBeVisible();
    const viewReport: Locator = header.getByRole("button", {
      name: "View full report",
    });
    await expect(viewReport).toHaveAttribute(
      "aria-controls",
      "ai-investigation",
    );
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "AI root cause analysis ready." }),
    ).toHaveCount(1);

    await viewReport.click();
    const panel: Locator = page.locator("#ai-investigation");
    await expect(panel).toBeFocused();
    await expect(panel).toBeInViewport();
    await expect(panel).toHaveAttribute("role", "region");
  });

  test("the header summary keeps View full report beside its heading on a wide screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const header: Locator = hero(page);
    const heading: Locator = header.getByRole("heading", {
      level: 3,
      name: "AI root cause analysis",
    });
    const viewReport: Locator = header.getByRole("button", {
      name: "View full report",
    });
    const tldr: Locator = header.getByText(INCIDENT_TLDR, { exact: true });
    await expect(tldr).toBeVisible();

    const headingBox: Box = await documentBox(heading);
    const buttonBox: Box = await documentBox(viewReport);
    expect(
      Math.abs(
        buttonBox.y +
          buttonBox.height / 2 -
          (headingBox.y + headingBox.height / 2),
      ),
      "View full report shares the heading's row",
    ).toBeLessThanOrEqual(2);
    await expectAbove(viewReport, tldr, "the summary starts below that row");
    // A short TL;DR fits in three lines: nothing to expand.
    await expect(
      header.getByRole("button", { name: /^Show (more|less)$/ }),
    ).toHaveCount(0);
  });

  test("a long header TL;DR arrives whole, clamps on a phone and expands in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE, "tldr=long");

    const header: Locator = hero(page);
    const heading: Locator = header.getByRole("heading", {
      level: 3,
      name: "AI root cause analysis",
    });
    const tldr: Locator = header.getByText(INCIDENT_LONG_TLDR, {
      exact: true,
    });
    const viewReport: Locator = header.getByRole("button", {
      name: "View full report",
    });

    // All 320 characters the server stored, with no ellipsis of our own.
    expect(INCIDENT_LONG_TLDR).toHaveLength(320);
    await expect(tldr).toHaveText(INCIDENT_LONG_TLDR);

    // The heading gets the whole row on a phone, so it is not cut short.
    expect(await isOverflowing(heading), "heading is truncated").toBe(false);

    const showMore: Locator = header.getByRole("button", {
      name: "Show more",
    });
    await expect(showMore).toBeVisible();
    await expect(showMore).toHaveAttribute("aria-expanded", "false");
    expect(await isOverflowing(tldr), "summary is clamped").toBe(true);

    // View full report drops below the summary, level with Show more.
    await expectAbove(
      tldr,
      viewReport,
      "View full report is under the summary",
    );
    const toggleBox: Box = await documentBox(showMore);
    const buttonBox: Box = await documentBox(viewReport);
    expect(
      Math.abs(
        buttonBox.y +
          buttonBox.height / 2 -
          (toggleBox.y + toggleBox.height / 2),
      ),
      "View full report shares Show more's row",
    ).toBeLessThanOrEqual(2);
    expect(buttonBox.x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width);

    await showMore.click();
    const showLess: Locator = header.getByRole("button", {
      name: "Show less",
    });
    await expect(showLess).toHaveAttribute("aria-expanded", "true");
    expect(await isOverflowing(tldr), "expanded summary is clipped").toBe(
      false,
    );
    await expectNoHorizontalOverflow(page);

    await showLess.click();
    await expect(showMore).toHaveAttribute("aria-expanded", "false");
    await expect(showMore).toBeFocused();
    expect(await isOverflowing(tldr)).toBe(true);

    await viewReport.click();
    await expect(page.locator("#ai-investigation")).toBeFocused();
  });

  test("verdict buttons record Confirmed, then a changed verdict", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const investigation: Locator = investigationCard(page);
    const rating: Locator = investigation.getByRole("group", {
      name: VERDICT_QUESTION,
    });
    await rating.getByRole("button", { name: "Confirmed" }).click();
    await expect(
      investigation.getByText("You confirmed this analysis"),
    ).toBeVisible();

    await expect
      .poll(async (): Promise<number> => {
        return (await apiRequestsTo(page, "/ai-investigation/verdict")).length;
      })
      .toBe(1);
    expect(
      (await apiRequestsTo(page, "/ai-investigation/verdict"))[0]?.body,
    ).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID,
      investigationRunId: INCIDENT_RUN_ID,
      verdict: "Confirmed",
    });

    await investigation
      .getByRole("button", { name: "Change", exact: true })
      .click();
    await rating.getByRole("button", { name: "Rejected" }).click();
    await expect(
      investigation.getByText("You rejected this analysis"),
    ).toBeVisible();
    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return (await apiRequestsTo(page, "/ai-investigation/verdict")).map(
          (request: RecordedApiRequest): unknown => {
            return request.body["verdict"];
          },
        );
      })
      .toEqual(["Confirmed", "Rejected"]);
  });

  test("?fail=verdict rolls the verdict back and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "fail=verdict");

    const investigation: Locator = investigationCard(page);
    await investigation
      .getByRole("group", { name: VERDICT_QUESTION })
      .getByRole("button", { name: "Confirmed" })
      .click();
    await expect(
      investigation.getByText("Could not save your verdict"),
    ).toBeVisible();
    await expect(investigation).toContainText(
      "You do not have permission to rate this investigation.",
    );
    await expect(
      investigation.getByText("You confirmed this analysis"),
    ).toHaveCount(0);
    // The header rolls back with the panel.
    await expect(hero(page).getByText(/by a responder$/)).toHaveCount(0);
    await expect(
      hero(page).getByText(INCIDENT_TLDR, { exact: true }),
    ).toHaveCSS("color", SUMMARY_COLOR);
  });

  test("a rating shows in the header at once, and a changed one replaces it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const header: Locator = hero(page);
    const investigation: Locator = investigationCard(page);
    const rating: Locator = investigation.getByRole("group", {
      name: VERDICT_QUESTION,
    });
    const tldr: Locator = header.getByText(INCIDENT_TLDR, { exact: true });
    const rejected: Locator = header.getByText("Rejected by a responder", {
      exact: true,
    });
    const confirmed: Locator = header.getByText("Confirmed by a responder", {
      exact: true,
    });

    await expect(tldr).toHaveCSS("color", SUMMARY_COLOR);
    await expect(header.getByText(/by a responder$/)).toHaveCount(0);

    await rating.getByRole("button", { name: "Rejected" }).click();
    await expect(rejected).toBeVisible();
    await expect(rejected).toHaveAttribute("data-verdict", "Rejected");
    // Still there to read, no longer presented as the root cause.
    await expect(tldr).toBeVisible();
    await expect(tldr).toHaveCSS("color", REJECTED_SUMMARY_COLOR);

    await investigation
      .getByRole("button", { name: "Change", exact: true })
      .click();
    await rating.getByRole("button", { name: "Confirmed" }).click();
    await expect(confirmed).toBeVisible();
    await expect(rejected).toHaveCount(0);
    await expect(tldr).toHaveCSS("color", SUMMARY_COLOR);

    // Both ratings were saved, in order.
    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return (await apiRequestsTo(page, "/ai-investigation/verdict")).map(
          (request: RecordedApiRequest): unknown => {
            return request.body["verdict"];
          },
        );
      })
      .toEqual(["Rejected", "Confirmed"]);
  });

  test("a saved verdict shows beside the heading when the page opens", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "verdict=confirmed");

    const header: Locator = hero(page);
    const heading: Locator = header.getByRole("heading", {
      level: 3,
      name: "AI root cause analysis",
    });
    const badge: Locator = header.getByText("Confirmed by a responder", {
      exact: true,
    });
    await expect(badge).toBeVisible();
    await expect(
      investigationCard(page).getByText("You confirmed this analysis"),
    ).toBeVisible();
    await expect(header.getByText(INCIDENT_TLDR, { exact: true })).toHaveCSS(
      "color",
      SUMMARY_COLOR,
    );

    // One row: icon and heading, the badge, then View full report.
    const headingBox: Box = await documentBox(heading);
    const badgeBox: Box = await documentBox(badge);
    const buttonBox: Box = await documentBox(
      header.getByRole("button", { name: "View full report" }),
    );
    const middle: (box: Box) => number = (box: Box): number => {
      return box.y + box.height / 2;
    };
    expect(Math.abs(middle(badgeBox) - middle(headingBox))).toBeLessThanOrEqual(
      2,
    );
    expect(
      Math.abs(middle(buttonBox) - middle(headingBox)),
    ).toBeLessThanOrEqual(2);
    expect(badgeBox.x).toBeGreaterThanOrEqual(headingBox.x + headingBox.width);
    expect(buttonBox.x).toBeGreaterThanOrEqual(badgeBox.x + badgeBox.width);
  });

  test("the alert header shows its own saved verdict", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE, "verdict=rejected");

    const header: Locator = hero(page);
    await expect(
      header.getByText("Rejected by a responder", { exact: true }),
    ).toBeVisible();
    await expect(header.getByText(ALERT_TLDR, { exact: true })).toHaveCSS(
      "color",
      REJECTED_SUMMARY_COLOR,
    );
  });

  test("on a phone a verdict wraps under the heading without cutting it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE, "verdict=rejected&tldr=long");

    const header: Locator = hero(page);
    const heading: Locator = header.getByRole("heading", {
      level: 3,
      name: "AI root cause analysis",
    });
    const badge: Locator = header.getByText("Rejected by a responder", {
      exact: true,
    });
    const tldr: Locator = header.getByText(INCIDENT_LONG_TLDR, {
      exact: true,
    });
    await expect(badge).toBeVisible();

    expect(await isOverflowing(heading), "heading is truncated").toBe(false);
    expect(await isOverflowing(badge), "badge is cut off").toBe(false);
    const headingBox: Box = await documentBox(heading);
    const badgeBox: Box = await documentBox(badge);
    expect(badgeBox.y).toBeGreaterThanOrEqual(headingBox.y + headingBox.height);
    await expectAbove(badge, tldr, "the badge is above the summary");
    await expect(tldr).toHaveCSS("color", REJECTED_SUMMARY_COLOR);
    await expectNoHorizontalOverflow(page);
  });

  test("beside a tablet's side menu the heading keeps its row whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    // 768px: the side menu is out and the header card is at its narrowest.
    await page.setViewportSize({ width: 768, height: 1024 });
    await openReady(page, INCIDENT_PAGE, "verdict=rejected");

    const header: Locator = hero(page);
    const heading: Locator = header.getByRole("heading", {
      level: 3,
      name: "AI root cause analysis",
    });
    const badge: Locator = header.getByText("Rejected by a responder", {
      exact: true,
    });
    const tldr: Locator = header.getByText(INCIDENT_TLDR, { exact: true });
    const viewReport: Locator = header.getByRole("button", {
      name: "View full report",
    });
    await expect(badge).toBeVisible();

    expect(await isOverflowing(heading), "heading is truncated").toBe(false);
    // The report button waits in the bottom row, under the summary.
    await expectAbove(
      tldr,
      viewReport,
      "View full report is under the summary",
    );
    await expectAbove(badge, tldr, "the badge is above the summary");
    await expectNoHorizontalOverflow(page);

    await viewReport.click();
    await expect(page.locator("#ai-investigation")).toBeFocused();
  });

  /*
   * The fix in the code the investigation recommends is a fix, so the
   * Remediation step offers it (block 43): "Act on this investigation" was
   * a row of the investigation's own.
   */
  test("?codefix=act: Open fix pull request on the Remediation step starts one from this run", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "codefix=act");

    const remediation: Locator = remediationStep(page);
    const codeFix: Locator = remediation.getByTestId("remediation-code-fix");
    await expect(codeFix.getByTestId("remediation-code-fix-text")).toHaveText(
      "The investigation found the cause in the code.",
    );
    // Why OneUptime AI did not open it on its own, and the switch that would.
    await expect(codeFix.getByTestId("remediation-code-fix-why")).toHaveText(
      'OneUptime AI opens one on its own only while "Fix new incidents automatically" is on.',
    );
    await expect(
      codeFix.getByRole("link", { name: "Turn on for incidents" }),
    ).toHaveAttribute("href", INCIDENT_AI_SETTINGS_HREF);
    await expect(
      investigationCard(page).getByRole("heading", {
        name: "Act on this investigation",
      }),
    ).toHaveCount(0);
    await expect(
      investigationStep(page).getByRole("button", { name: OPEN_FIX_PR }),
    ).toHaveCount(0);

    await codeFix
      .getByRole("button", { name: OPEN_FIX_PR, exact: true })
      .click();

    // Asked for: it is being written now, with where to follow it.
    await expect(codeFix.getByTestId("remediation-code-fix-text")).toHaveText(
      "A pull request that fixes the code is being written.",
    );
    await expect(
      codeFix.getByRole("link", { name: "View progress" }),
    ).toHaveAttribute("href", new RegExp(`${FIX_TASK_ID}$`));
    await expect(remediation.getByLabel("Remediation status")).toHaveText(
      "Fixing…",
    );
    const requests: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/ai-investigation/create-fix-task",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID,
      investigationRunId: INCIDENT_RUN_ID,
    });
  });

  test("?codefix=act&fail=create-fix-task says why no pull request was opened", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "codefix=act&fail=create-fix-task");

    const codeFix: Locator = remediationStep(page).getByTestId(
      "remediation-code-fix",
    );
    await codeFix
      .getByRole("button", { name: OPEN_FIX_PR, exact: true })
      .click();
    const notice: Locator = codeFix.getByTestId("remediation-code-fix-error");
    await expect(notice).toContainText("Could not open the pull request");
    await expect(notice).toContainText(
      "No AI agent is online for this project.",
    );
    // Still on offer: nothing was started.
    await expect(codeFix.getByTestId("remediation-code-fix-text")).toHaveText(
      "The investigation found the cause in the code.",
    );
    await expect(
      codeFix.getByRole("button", { name: OPEN_FIX_PR, exact: true }),
    ).toBeEnabled();
  });

  test("the feed shows a compact AI item and unfolds the full report in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const feed: Locator = card(page, "Incident Feed");
    const item: Locator = feed
      .getByRole("listitem")
      .filter({ hasText: "OneUptime AI posted a root cause analysis" });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Most likely root cause:");
    await expect(item).toContainText(
      "This is the same pool exhaustion recorded on prior incidents #1017, #1029 and #1036.",
    );
    await expect(item).not.toContainText("[C");
    await expect(item).not.toContainText("Evidence checked");
    await expect(item).not.toContainText("Automated Root Cause Analysis");
    await expect(item).not.toContainText("Suggested next steps");

    const toggle: Locator = item.getByRole("button", {
      name: "Show the full report",
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();

    // Under the entry, where it was asked for: no dialog over the page.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const report: Locator = item.getByTestId("feed-entry-details");
    await expect(report).toBeVisible();
    await expect(
      item.getByRole("button", { name: "Hide details" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(report).toContainText("Most likely root cause");
    await expect(report).toContainText("Suggested next steps");
    await expect(report).toContainText("Evidence checked");
    await expect(report).toContainText(
      "Incident #1042 timeline (1 entry) — 1 row(s)",
    );
    await expect(report).toContainText(
      "Investigated automatically by OneUptime AI",
    );
    // Safe mode: nothing in the report is an image.
    await expect(report.locator("img")).toHaveCount(0);

    await item.getByRole("button", { name: "Hide details" }).click();
    await expect(report).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the alert page shows its report, references and header summary", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);

    const investigation: Locator = investigationCard(page);
    await expect(investigation).toContainText(
      "What OneUptime AI found, and what it is doing about it.",
    );
    await expect(summarySection(page)).toContainText(ALERT_TLDR);
    const reference: Locator = referenceLink(summarySection(page), "#298");
    await expect(reference).toHaveAttribute("href", alertPath(298));
    await expect(reference).toHaveAttribute(
      "title",
      "#298 · Payment webhook 5xx rate above 5% · Resolved",
    );
    await expect(
      reportSection(page).getByRole("heading", { level: 3 }),
    ).toHaveText([
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
    // The alert's run keeps the same collapsed details under its report.
    await expect(detailsToggle(page)).toHaveAccessibleName(
      "Evidence and activity",
    );
    await openInvestigationDetails(page);
    await expect(
      namedList(investigationDetails(page), "Model and tokens").getByRole(
        "listitem",
      ),
    ).toHaveText(["41,876 tokens", "Model claude-sonnet-4-5"]);

    const header: Locator = hero(page);
    await expect(header.getByText(ALERT_TLDR, { exact: true })).toBeVisible();
    await header.getByRole("button", { name: "View full report" }).click();
    await expect(page.locator("#ai-investigation")).toBeFocused();

    const requests: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/ai-investigation/alert",
    );
    expect(requests[0]?.body).toEqual({ alertId: ALERT_ID });

    // An alert reference opens the alert.
    await reference.click();
    await expect(page).toHaveURL(new RegExp(`${alertPath(298)}$`));
    await expect(hero(page)).toContainText("#298");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "#298 Payment webhook 5xx rate above 5%",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Investigation details (evidence, activity and usage)
 * ---------------------------------------------------------------------------
 */

test.describe("investigation details", () => {
  /*
   * The report is the answer; the queries, the steps and the run's cost are
   * its working. They share one section under the report that stays out of
   * the way until a responder asks for it.
   */
  test("evidence, activity and usage share one section that starts collapsed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const investigation: Locator = investigationCard(page);
    const details: Locator = investigationDetails(page);
    await expect(details).toHaveCount(1);
    await expect(
      investigation.getByRole("region", {
        name: "Evidence and activity",
        exact: true,
      }),
    ).toBeVisible();
    await expectAbove(reportSection(page), details, "report before details");
    await expectAbove(
      details,
      investigation.getByRole("heading", { name: VERDICT_QUESTION }),
      "details before the rating",
    );
    // Neither the old usage strip nor the old activity disclosure is left.
    await expect(namedList(investigation, "Investigation usage")).toHaveCount(
      1,
    );
    await expect(investigation.getByText("Investigation activity")).toHaveCount(
      0,
    );

    const toggle: Locator = detailsToggle(page);
    await expect(details.getByRole("heading", { level: 3 })).toHaveText(
      "Evidence and activity",
    );
    await expect(toggle).toHaveAccessibleName("Evidence and activity");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const body: Locator = page.locator(
      `[id="${(await toggle.getAttribute("aria-controls")) || "missing"}"]`,
    );
    await expect(body).toHaveCount(1);
    await expect(body).toBeHidden();
    await expect(
      details.getByRole("tablist", {
        name: "Investigation details",
        includeHidden: true,
      }),
    ).toBeHidden();
    await expect(evidenceList(page)).toBeHidden();
    await expect(namedList(details, "Model and tokens")).toBeHidden();
    await expect(namedList(details, "Investigation usage")).toBeVisible();

    // Enter on the toggle opens it like a click.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(body).toBeVisible();
    await expect(evidenceList(page)).toBeVisible();
    await expect(
      namedList(details, "Model and tokens").getByRole("listitem"),
    ).toHaveText(["48,212 tokens", "Model claude-sonnet-4-5"]);
    await expect(namedList(details, "Investigation usage")).toBeVisible();
    // Opening the section re-runs nothing.
    expect(await apiRequestsTo(page, "/ai-investigation/evidence")).toEqual([]);

    /*
     * The toggle stretches over the whole header, so a click on the usage
     * line under the title collapses the section too.
     */
    const usage: Locator = namedList(details, "Investigation usage");
    await usage.scrollIntoViewIfNeeded();
    const usageBox: Box | null = await usage.boundingBox();
    expect(usageBox, "usage line is on screen").not.toBeNull();
    await page.mouse.click(
      (usageBox?.x || 0) + (usageBox?.width || 0) / 2,
      (usageBox?.y || 0) + (usageBox?.height || 0) / 2,
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(body).toBeHidden();
    await expect(evidenceList(page)).toBeHidden();
  });

  test("the Evidence and Activity tabs switch panels by click and arrow keys", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const details: Locator = await openInvestigationDetails(page);
    const evidenceTab: Locator = detailsTab(page, "Evidence");
    const activityTab: Locator = detailsTab(page, "Activity");
    const evidencePanel: Locator = detailsPanel(page, "Evidence");
    const activityPanel: Locator = detailsPanel(page, "Activity");
    await expect(
      details
        .getByRole("tablist", { name: "Investigation details" })
        .getByRole("tab"),
    ).toHaveCount(2);
    // Each tab names its panel and carries its count.
    await expect(evidenceTab).toHaveAccessibleName("Evidence checked 10");
    await expect(activityTab).toHaveAccessibleName("Activity 14");
    await expect(evidencePanel).toHaveAttribute(
      "id",
      (await evidenceTab.getAttribute("aria-controls")) || "missing",
    );
    await expect(activityPanel).toHaveAttribute(
      "id",
      (await activityTab.getAttribute("aria-controls")) || "missing",
    );

    // Evidence first, and only the selected tab is in the Tab order.
    await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    await expect(evidenceTab).toHaveAttribute("tabindex", "0");
    await expect(activityTab).toHaveAttribute("aria-selected", "false");
    await expect(activityTab).toHaveAttribute("tabindex", "-1");
    await expect(evidencePanel).toBeVisible();
    await expect(activityPanel).toBeHidden();

    await activityTab.click();
    await expect(activityTab).toHaveAttribute("aria-selected", "true");
    await expect(evidenceTab).toHaveAttribute("aria-selected", "false");
    await expect(activityPanel).toBeVisible();
    await expect(evidencePanel).toBeHidden();
    // A finished run shows its whole trail, not the live panel's recent tail.
    await expect(activityPanel).toContainText("Starting investigation");
    await expect(activityPanel).toContainText("Searching logs");
    await expect(activityPanel).toContainText("Reading trace");
    await expect(activityPanel).not.toContainText("earlier step");
    // The section keeps its name whichever tab is showing.
    await expect(detailsToggle(page)).toHaveAccessibleName(
      "Evidence and activity",
    );

    // Arrow keys, Home and End move the selection and focus together.
    await expect(activityTab).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(evidenceTab).toBeFocused();
    await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    await expect(evidencePanel).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(activityTab).toBeFocused();
    await expect(activityPanel).toBeVisible();
    await page.keyboard.press("Home");
    await expect(evidenceTab).toBeFocused();
    await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(activityTab).toBeFocused();
    await expect(activityTab).toHaveAttribute("aria-selected", "true");

    // The activity has nothing focusable, so its panel takes the next Tab.
    await page.keyboard.press("Tab");
    await expect(activityPanel).toBeFocused();

    // Collapsing and reopening keeps the reader on the tab they chose.
    await detailsToggle(page).click();
    await expect(activityPanel).toBeHidden();
    await openInvestigationDetails(page);
    await expect(activityTab).toHaveAttribute("aria-selected", "true");
    await expect(activityPanel).toBeVisible();
  });

  /*
   * A chip is the reader asking "what did you look at?": it opens collapsed
   * details on the Evidence tab, whatever tab they were left on, and hands
   * the row to the evidence list.
   */
  test("a citation chip opens the collapsed details on the Evidence tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    await openInvestigationDetails(page);
    await detailsTab(page, "Activity").click();
    await expect(detailsPanel(page, "Activity")).toBeVisible();
    await detailsToggle(page).click();
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(evidenceList(page)).toBeHidden();

    await citationChip(summarySection(page), "C3").click();
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(detailsTab(page, "Evidence")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(detailsPanel(page, "Activity")).toBeHidden();
    const row: Locator = evidenceRow(page, "C3");
    await expect(evidenceToggle(row)).toHaveAttribute("aria-expanded", "true");
    await expect(evidenceToggle(row)).toBeFocused();
    await expect(row).toHaveAttribute("data-highlighted", "true");
    await expect(row).toBeInViewport();
    await expectRowsLoaded(evidenceDetails(row));
    expect(await evidenceRequestsFor(page, "C3")).toHaveLength(1);

    // Again from the open section on Activity: back to the row, no refetch.
    await detailsTab(page, "Activity").click();
    await expect(evidenceList(page)).toBeHidden();
    await citationChip(reportSection(page), "C3").first().click();
    await expect(detailsTab(page, "Evidence")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(evidenceToggle(row)).toHaveAttribute("aria-expanded", "true");
    await expect(evidenceToggle(row)).toBeFocused();
    await expect(row).toBeInViewport();
    expect(await evidenceRequestsFor(page, "C3")).toHaveLength(1);
  });

  test("?ai=pending keeps the finished steps behind the details, with no tabs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=pending");

    const investigation: Locator = investigationCard(page);
    await expect(investigation.getByLabel("Investigation status")).toHaveText(
      "Preparing report…",
      { timeout: 30000 },
    );
    const details: Locator = investigationDetails(page);
    const toggle: Locator = detailsToggle(page);
    // No report means no evidence, so the section is named for its steps.
    await expect(toggle).toHaveAccessibleName("Investigation activity");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      namedList(details, "Investigation usage").getByRole("listitem"),
    ).toHaveText(["10 telemetry queries", "14 steps", READ_ONLY]);
    await expectAbove(
      investigation.getByText("Preparing the final report"),
      details,
      "notice before details",
    );

    await openInvestigationDetails(page);
    // One panel needs no tabs.
    await expect(
      details.getByRole("tablist", { includeHidden: true }),
    ).toHaveCount(0);
    await expect(
      details.getByRole("tabpanel", { includeHidden: true }),
    ).toHaveCount(0);
    await expect(evidenceList(page)).toHaveCount(0);
    await expect(details).toContainText("Starting investigation");
    await expect(details).toContainText("Reading trace");
    await expect(details).not.toContainText("earlier step");
    // The model is only named next to a report.
    await expect(
      namedList(details, "Model and tokens").getByRole("listitem"),
    ).toHaveText(["48,212 tokens"]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Evidence checked
 * ---------------------------------------------------------------------------
 */

interface EvidenceCase {
  citationId: string;
  // What the rows render as, for the test title.
  kind: string;
  label: string;
  description: string;
  rowCount: string;
  query: ReadonlyArray<LabelledValue>;
  openIn?: { name: string; href: string } | undefined;
  isPinned: boolean;
  expectRows: (details: Locator) => Promise<void>;
}

const RAN_AT: LabelledValue = { label: "Ran at", value: "Sep 14, 6:01 PM GMT" };

const INCIDENT_EVIDENCE: ReadonlyArray<EvidenceCase> = [
  {
    citationId: "C1",
    kind: "an incident list",
    label: 'Incident search "checkout latency" (3 found)',
    description: "Searched past incidents · Sep 14, 6:01 PM GMT",
    rowCount: "3 rows",
    query: [
      { label: "Search", value: "“checkout latency”" },
      { label: "Time window", value: "Created within the last 90 days" },
      { label: "Limit", value: "10" },
      RAN_AT,
      { label: "Took", value: "412 ms" },
      { label: "Tool", value: "search_incidents" },
    ],
    openIn: { name: "Open in Incidents", href: `${DASHBOARD}/incidents` },
    isPinned: false,
    expectRows: async (details: Locator): Promise<void> => {
      await expect(details).toContainText('Incident search "checkout latency"');
      await expect(
        details.getByRole("button", { name: /^#\d+ · / }),
      ).toHaveCount(3);
      await expect(
        details.getByRole("button", { name: /^#\d+ · / }).first(),
      ).toContainText("#1036 · Checkout API p95 latency above 2s");
      await expect(details).toContainText("Created 12 days ago");
    },
  },
  {
    citationId: "C2",
    kind: "a time series chart",
    label: "P95(http.server.request.duration), Sep 14, 5:00 PM – 6:20 PM",
    description: "Queried a metric · Sep 14, 6:01 PM GMT",
    rowCount: "80 rows",
    query: [
      { label: "Time window", value: "Sep 14, 5:00 PM – 6:20 PM GMT" },
      { label: "Metric", value: "http.server.request.duration" },
      { label: "Aggregation", value: "P95" },
      { label: "Entity", value: "75000000…" },
      RAN_AT,
      { label: "Took", value: "1.2 s" },
      { label: "Tool", value: "query_metrics" },
    ],
    openIn: { name: "Open in Metrics", href: `${DASHBOARD}/metrics` },
    isPinned: true,
    expectRows: async (details: Locator): Promise<void> => {
      await expect(details).toContainText(
        "p95 request duration — checkout-api",
      );
      const chart: Locator = details.getByRole("application");
      await expect(chart).toBeVisible();
      /*
       * The axis writes its values as the dashboards do, each on one line:
       * "2,600 ms" did not fit its 64 px and was drawn as "2,600" over
       * "ms" (Ask AI's UI review, #5349).
       */
      await expect(chart).toContainText("2.6 s");
      await expect(chart).toContainText("650 ms");
    },
  },
  {
    citationId: "C3",
    kind: "a table",
    label: "Logs Sep 14, 5:45 PM – 6:15 PM (50 shown)",
    description: "Searched logs · Sep 14, 6:01 PM GMT",
    rowCount: "50 rows",
    query: [
      { label: "Time window", value: "Sep 14, 5:45 PM – 6:15 PM GMT" },
      { label: "Search", value: "“pool”" },
      { label: "Service", value: "75000000…" },
      { label: "Limit", value: "50" },
      RAN_AT,
      { label: "Took", value: "864 ms" },
      { label: "Tool", value: "search_logs" },
    ],
    openIn: { name: "Open in Logs", href: `${DASHBOARD}/logs` },
    isPinned: true,
    expectRows: async (details: Locator): Promise<void> => {
      await expect(
        details.getByText("The result was long, so only part of it is shown."),
      ).toBeVisible();
      const table: Locator = details.getByRole("table");
      await expect(table.getByRole("columnheader")).toHaveText([
        "Time",
        "Severity",
        "Message",
        "Trace",
      ]);
      await expect(table.locator("tbody tr")).toHaveCount(5);
      await expect(table).toContainText(
        "db pool at capacity: 10/10 connections in use, 14 waiting",
      );
    },
  },
  {
    citationId: "C5",
    kind: "plain text",
    label: "Changes Sep 13, 6:02 PM → Sep 14, 6:02 PM (3 events)",
    description: "Checked recent changes · Sep 14, 6:01 PM GMT",
    rowCount: "3 rows",
    query: [
      { label: "Time window", value: "Sep 13, 6:02 PM – Sep 14, 6:02 PM GMT" },
      { label: "Limit per source", value: "20" },
      RAN_AT,
      { label: "Took", value: "522 ms" },
      { label: "Tool", value: "recent_changes" },
    ],
    isPinned: true,
    expectRows: async (details: Locator): Promise<void> => {
      const text: Locator = details.locator("pre");
      await expect(text).toBeVisible();
      await expect(text).toHaveClass(/max-h-80/);
      await expect(text).toContainText(
        "monitor status change      Orders DB connection pool: Operational → Degraded",
      );
    },
  },
  {
    citationId: "C7",
    kind: "a trace waterfall",
    label: "Trace 5c1e0b7a9d2f4e6b8a3c1d5e7f9b2a4c (38 spans)",
    description: "Opened a trace · Sep 14, 6:01 PM GMT",
    rowCount: "38 rows",
    query: [
      { label: "Trace", value: "5c1e0b7a…" },
      RAN_AT,
      { label: "Took", value: "640 ms" },
      { label: "Tool", value: "get_trace" },
    ],
    openIn: {
      name: "Open in Trace",
      href: `${DASHBOARD}/traces/view/5c1e0b7a9d2f4e6b8a3c1d5e7f9b2a4c`,
    },
    isPinned: true,
    expectRows: async (details: Locator): Promise<void> => {
      await expect(details).toContainText(
        "Trace 5c1e0b7a…2a4c — POST /api/checkout",
      );
      await expect(
        details.getByTitle("pg.pool.connect · 1940 ms"),
      ).toBeVisible();
      await expect(details.getByTitle("Span recorded an error")).toHaveCount(2);
      await expect(details).toContainText("1,940 ms");
    },
  },
  {
    citationId: "C8",
    kind: "no rows with the server's explanation",
    label: "Top exceptions, last 1h (0 found)",
    description: "Listed top exceptions · Sep 14, 6:01 PM GMT",
    rowCount: "No rows",
    query: [
      { label: "Time window", value: "Last seen within the last 1 hour" },
      { label: "Include resolved", value: "No" },
      { label: "Limit", value: "10" },
      RAN_AT,
      { label: "Took", value: "288 ms" },
      { label: "Tool", value: "top_exceptions" },
    ],
    openIn: {
      name: "Open in Exceptions",
      href: `${DASHBOARD}/exceptions/unresolved`,
    },
    isPinned: false,
    expectRows: async (details: Locator): Promise<void> => {
      await expect(details.getByText("No rows returned.")).toBeVisible();
      await expect(
        details.getByText(
          "No unresolved exception groups were seen in the last 1 hour for checkout-api or orders-db.",
        ),
      ).toBeVisible();
      await expect(details.locator("pre")).toHaveCount(0);
      await expect(details.getByRole("table")).toHaveCount(0);
    },
  },
  {
    citationId: "C10",
    kind: "a timeline table",
    label: "Incident #1042 timeline (1 entry)",
    description: "Read an incident timeline · Sep 14, 6:01 PM GMT",
    rowCount: "1 row",
    query: [
      { label: "Incident", value: "20000000…" },
      { label: "Limit", value: "50" },
      RAN_AT,
      { label: "Took", value: "204 ms" },
      { label: "Tool", value: "get_incident_timeline" },
    ],
    openIn: { name: "Open in Incident", href: INCIDENT_PATH },
    isPinned: false,
    expectRows: async (details: Locator): Promise<void> => {
      const table: Locator = details.getByRole("table");
      await expect(table.getByRole("columnheader")).toHaveText([
        "At",
        "State",
        "By",
      ]);
      await expect(table.locator("tbody tr")).toHaveCount(1);
      await expect(table).toContainText("eu-west-1 probe");
    },
  },
];

test.describe("evidence checked", () => {
  test("lists every query in citation order with plain-language rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    /*
     * The details section frames the list: its Evidence tab carries the name
     * and the count, the panel the description, and the list is a named list
     * rather than a second landmark inside that section.
     */
    const list: Locator = await openEvidence(page);
    await expect(detailsTab(page, "Evidence")).toHaveAccessibleName(
      "Evidence checked 10",
    );
    await expect(detailsPanel(page, "Evidence")).toContainText(
      "Every query OneUptime AI ran. Expand one to see what it asked and the rows it returned.",
    );
    await expect(
      page.getByRole("region", { name: "Evidence checked" }),
    ).toHaveCount(0);
    await expect(list.getByRole("heading")).toHaveCount(0);
    await expect(list.locator(":scope > li")).toHaveCount(10);
    await expect(list.locator("li[data-citation-id]")).toHaveCount(10);
    expect(
      await list
        .locator("li[data-citation-id]")
        .evaluateAll((rows: Array<Element>): Array<string> => {
          return rows.map((row: Element): string => {
            return row.getAttribute("data-citation-id") || "";
          });
        }),
    ).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]);

    for (const evidence of INCIDENT_EVIDENCE) {
      const row: Locator = evidenceRow(page, evidence.citationId);
      const toggle: Locator = evidenceToggle(row);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toContainText(evidence.label);
      await expect(toggle).toContainText(evidence.description);
      await expect(toggle).toContainText(evidence.rowCount);
      await expect(evidenceDetails(row)).toBeHidden();
    }

    // Local times in the row; the raw ISO label only in its tooltip.
    const c3: Locator = evidenceToggle(evidenceRow(page, "C3"));
    await expect(c3).not.toContainText("2026-09-14T");
    await expect(
      c3.getByTitle(
        "Logs 2026-09-14T17:45:00.000Z – 2026-09-14T18:15:00.000Z (50 shown)",
        { exact: true },
      ),
    ).toBeVisible();

    // A query with no rows gets the muted badge.
    await expect(
      evidenceToggle(evidenceRow(page, "C8")).getByText("C8", { exact: true }),
    ).toHaveClass(/bg-gray-200/);
    await expect(
      evidenceToggle(evidenceRow(page, "C1")).getByText("C1", { exact: true }),
    ).toHaveClass(/bg-gray-900/);

    // Opening the details fetches nothing; only opening a row does.
    expect(await apiRequestsTo(page, "/ai-investigation/evidence")).toEqual([]);
  });

  for (const evidence of INCIDENT_EVIDENCE) {
    test(`${evidence.citationId} shows what was queried and ${evidence.kind}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE);

      const details: Locator = await expandEvidence(page, evidence.citationId);
      await expect(details).toHaveAttribute(
        "aria-label",
        `${evidence.label} details`,
      );
      await expect(
        details.getByRole("heading", { name: "What was queried" }),
      ).toBeVisible();
      expect(await definitionPairs(details)).toEqual(evidence.query);

      if (evidence.openIn) {
        await expect(
          details.getByRole("link", {
            name: evidence.openIn.name,
            exact: true,
          }),
        ).toHaveAttribute("href", evidence.openIn.href);
      } else {
        await expect(
          details.getByRole("link", { name: /^Open in / }),
        ).toHaveCount(0);
      }

      await expectRowsLoaded(details);
      await evidence.expectRows(details);
      if (evidence.isPinned) {
        await expect(details).toContainText(
          "Re-run with your permissions over the same time window the AI used.",
        );
      } else {
        await expect(details).toContainText(
          "Shows current data with your permissions — it may differ from what the AI saw at Sep 14, 6:01 PM GMT.",
        );
      }

      const requests: Array<RecordedApiRequest> = await evidenceRequestsFor(
        page,
        evidence.citationId,
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body).toEqual({
        subjectType: "incident",
        subjectId: INCIDENT_ID,
        investigationRunId: INCIDENT_RUN_ID,
        citationId: evidence.citationId,
      });
    });
  }

  test("a query that cannot be re-run shows its arguments and never requests rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const details: Locator = await expandEvidence(page, "C4");
    expect(await definitionPairs(details)).toEqual([
      { label: "Looked up", value: "Service" },
      { label: "Search", value: "“checkout”" },
      RAN_AT,
      { label: "Took", value: "96 ms" },
      { label: "Tool", value: "lookup_context" },
    ]);
    await expect(details).toContainText(
      "This query can't be re-run from the dashboard, so its rows aren't available here.",
    );
    await expect(details.getByRole("group", { name: "Rows" })).toHaveCount(0);
    await expect(details.getByRole("link")).toHaveCount(0);
    expect(await apiRequestsTo(page, "/ai-investigation/evidence")).toEqual([]);
  });

  test("an incident row inside the evidence opens that incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const details: Locator = await expandEvidence(page, "C1");
    await expectRowsLoaded(details);
    await details
      .getByRole("button", {
        name: /^#1017 · Checkout API p95 latency above 2s/,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`${incidentPath(1017)}$`));
    await expect(hero(page)).toContainText("#1017");
    await expectHeroDuration(hero(page), "Lasted 38 minutes");
  });

  test("?fail=evidence shows the error and Try again requests the rows again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "fail=evidence");

    const details: Locator = await expandEvidence(page, "C2");
    const message: string =
      "The evidence query could not be re-run: the telemetry store rejected the time range.";
    await expect(details.getByText("Could not load these rows")).toBeVisible();
    await expect(details).toContainText(message);
    expect(await evidenceRequestsFor(page, "C2")).toHaveLength(1);

    // The query description stays usable next to the error.
    await expect(
      details.getByRole("link", { name: "Open in Metrics" }),
    ).toBeVisible();

    await details.getByRole("button", { name: "Try again" }).click();
    await expect
      .poll(async (): Promise<number> => {
        return (await evidenceRequestsFor(page, "C2")).length;
      })
      .toBe(2);
    await expect(details.getByText("Could not load these rows")).toBeVisible();
    await expect(
      details.getByRole("button", { name: "Try again" }),
    ).toBeVisible();
    // Keyboard focus never falls back to the page.
    await expect
      .poll(async (): Promise<string | null> => {
        return page.evaluate((): string | null => {
          return (
            document.activeElement
              ?.closest("li[data-citation-id]")
              ?.getAttribute("data-citation-id") || null
          );
        });
      })
      .toBe("C2");
    expect(
      await apiRequestsTo(page, "/ai-investigation/evidence"),
    ).toHaveLength(2);
  });

  test("the alert evidence renders alert and exception lists", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);

    const alerts: Locator = await expandEvidence(page, "C1");
    await expectRowsLoaded(alerts);
    await expect(
      alerts.getByRole("button", {
        name: /^#298 · Payment webhook 5xx rate above 5%/,
      }),
    ).toBeVisible();
    await expect(
      alerts.getByRole("link", { name: "Open in Alerts" }),
    ).toHaveAttribute("href", `${DASHBOARD}/alerts`);

    const exceptions: Locator = await expandEvidence(page, "C8");
    await expectRowsLoaded(exceptions);
    await expect(exceptions).toContainText("LedgerTimeoutError");
    await expect(exceptions).toContainText(
      "ledger write timed out after 1000ms",
    );
    await expect(exceptions).toContainText("318×");
    await expect(exceptions).toContainText("UpstreamResponseError");

    const timeline: Locator = await expandEvidence(page, "C10");
    await expect(
      timeline.getByRole("link", { name: "Open in Alert", exact: true }),
    ).toHaveAttribute("href", ALERT_PATH);

    const requests: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/ai-investigation/evidence",
    );
    expect(
      requests.map((request: RecordedApiRequest): Record<string, unknown> => {
        return request.body;
      }),
    ).toEqual(
      ["C1", "C8", "C10"].map((citationId: string): Record<string, unknown> => {
        return {
          subjectType: "alert",
          subjectId: ALERT_ID,
          investigationRunId: ALERT_RUN_ID,
          citationId,
        };
      }),
    );
  });

  test("?ai=legacy shows the report's own evidence list without rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "ai=legacy");

    const payload: FixtureApiResult = await callFixtureApi(
      page,
      "POST",
      "/ai-investigation/incident",
      { incidentId: INCIDENT_ID },
    );
    expect(payload.data?.["analysisMarkdown"]).toContain(
      "**Evidence checked**",
    );
    expect(Object.keys(payload.data || {})).not.toContain("evidence");
    expect(Object.keys(payload.data || {})).not.toContain("references");

    const list: Locator = await openEvidence(page);
    const panel: Locator = detailsPanel(page, "Evidence");
    await expect(panel).toContainText(
      "Every query OneUptime AI ran while investigating.",
    );
    await expect(panel).not.toContainText("Expand one");
    await expect(detailsTab(page, "Evidence")).toHaveAccessibleName(
      "Evidence checked 10",
    );
    await expect(list.locator("li[data-citation-id]")).toHaveCount(10);
    await expect(list.getByRole("button")).toHaveCount(0);
    await expect(evidenceRow(page, "C1")).toContainText(
      'Incident search "checkout latency" (3 found)',
    );
    await expect(evidenceRow(page, "C1")).toContainText("3 rows");
    await expect(evidenceRow(page, "C2")).toContainText(
      "P95(http.server.request.duration), Sep 14, 5:00 PM – 6:20 PM",
    );
    await expect(evidenceRow(page, "C8")).toContainText("No rows");
    await expect(evidenceRow(page, "C10")).toContainText(
      "Incident #1042 timeline (1 entry)",
    );

    // Without resolved references the numbers stay plain text.
    const summary: Locator = summarySection(page);
    await expect(summary).toContainText("#1017, #1029 and #1036");
    await expect(
      investigationCard(page).locator("a[href]").filter({ hasText: /^#10/ }),
    ).toHaveCount(0);

    /*
     * Chips still reveal the legacy row, from collapsed details too, and
     * nothing is re-run. A legacy row has no toggle, so the row itself takes
     * keyboard focus.
     */
    await detailsToggle(page).click();
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(list).toBeHidden();
    await citationChip(summary, "C3").click();
    await expect(detailsToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(evidenceRow(page, "C3")).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    await expect(evidenceRow(page, "C3")).toBeInViewport();
    await expect(evidenceRow(page, "C3")).toBeFocused();
    expect(await apiRequestsTo(page, "/ai-investigation/evidence")).toEqual([]);
  });

  test("the fixture serves structured evidence and rows per citation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH);

    const report: FixtureApiResult = await callFixtureApi(
      page,
      "POST",
      "/ai-investigation/incident",
      { incidentId: INCIDENT_ID },
    );
    expect(report.status).toBe(200);
    const evidence: Array<Record<string, unknown>> = report.data?.[
      "evidence"
    ] as Array<Record<string, unknown>>;
    expect(
      evidence.map((item: Record<string, unknown>) => {
        return item["citationId"];
      }),
    ).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]);
    expect(
      (report.data?.["references"] as Array<Record<string, unknown>>).map(
        (item: Record<string, unknown>) => {
          return item["displayNumber"];
        },
      ),
    ).toEqual(["#1017", "#1029", "#1036"]);

    const incidentList: FixtureApiResult = await callFixtureApi(
      page,
      "POST",
      "/ai-investigation/evidence",
      { subjectType: "incident", subjectId: INCIDENT_ID, citationId: "C1" },
    );
    expect(incidentList.data?.["widget"]).toMatchObject({
      type: "IncidentList",
      citationId: "C1",
    });

    const text: FixtureApiResult = await callFixtureApi(
      page,
      "POST",
      "/ai-investigation/evidence",
      { subjectType: "incident", subjectId: INCIDENT_ID, citationId: "C5" },
    );
    expect(text.data?.["text"]).toContain("monitor status change");

    const empty: FixtureApiResult = await callFixtureApi(
      page,
      "POST",
      "/ai-investigation/evidence",
      { subjectType: "incident", subjectId: INCIDENT_ID, citationId: "C8" },
    );
    expect(empty.data?.["rowCount"]).toBe(0);
    expect(empty.data?.["widget"]).toBeUndefined();
    expect(empty.data?.["text"]).toContain("No unresolved exception groups");

    const notRerunnable: FixtureApiResult = await callFixtureApi(
      page,
      "POST",
      "/ai-investigation/evidence",
      { subjectType: "incident", subjectId: INCIDENT_ID, citationId: "C4" },
    );
    expect(notRerunnable.status).toBe(400);
  });

  test("?fail=evidence makes the evidence endpoint refuse", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "fail=evidence");
    const refused: FixtureApiResult = await callFixtureApi(
      page,
      "POST",
      "/ai-investigation/evidence",
      { subjectType: "incident", subjectId: INCIDENT_ID, citationId: "C2" },
    );
    expect(refused.status).toBe(400);
    expect(refused.message).toContain("could not be re-run");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Investigation lifecycle states
 * ---------------------------------------------------------------------------
 */

interface InvestigationStateCase {
  ai: string;
  badge: string;
  bodyTexts: ReadonlyArray<string>;
  // The notice in the event header, if this state earns one.
  headerText?: string | undefined;
  /*
   * The usage list inside the "Investigation activity" section. Only a run
   * that has stopped gets one: a queued run's counts are all zero, and "ran
   * 0 queries" under "waiting for a worker" would report on work that has
   * not begun.
   */
  usage?: ReadonlyArray<string> | undefined;
  // A finished run keeps its steps behind the collapsed details.
  hasDetails: boolean;
}

const INVESTIGATION_STATES: ReadonlyArray<InvestigationStateCase> = [
  {
    ai: "running",
    badge: "Investigating…",
    bodyTexts: [
      "OneUptime AI is investigating",
      "Reading this project's own telemetry and narrating every step.",
    ],
    headerText: "AI is investigating",
    hasDetails: false,
  },
  {
    ai: "queued",
    badge: "Queued",
    bodyTexts: [
      "OneUptime AI is investigating",
      "Waiting for a worker to pick this up.",
    ],
    headerText: "AI investigation queued",
    hasDetails: false,
  },
  {
    ai: "failed",
    badge: "Did not finish",
    bodyTexts: [
      "The investigation stopped before it could report.",
      "The LLM provider returned 529 Overloaded three times; the investigation stopped after 4 of 12 planned tool calls.",
      "What the investigation got through",
    ],
    // The framed steps end with what the run spent before it stopped.
    usage: ["4 telemetry queries", "12,840 tokens", READ_ONLY],
    hasDetails: false,
  },
  {
    ai: "pending",
    badge: "Preparing report…",
    bodyTexts: [
      "Preparing the final report",
      "The investigation is complete. OneUptime AI is organizing the findings and evidence.",
    ],
    usage: ["10 telemetry queries", "14 steps", READ_ONLY],
    hasDetails: true,
  },
];

test.describe("investigation states", () => {
  for (const scenario of INVESTIGATION_STATES) {
    test(`?ai=${scenario.ai} renders the ${scenario.ai} run`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, INCIDENT_PATH, `ai=${scenario.ai}`);

      const investigation: Locator = investigationCard(page);
      await expect(investigation.getByLabel("Investigation status")).toHaveText(
        scenario.badge,
        { timeout: 30000 },
      );
      for (const text of scenario.bodyTexts) {
        await expect(investigation).toContainText(text);
      }
      // No report yet: no summary, report or evidence sections.
      await expect(summarySection(page)).toHaveCount(0);
      await expect(reportSection(page)).toHaveCount(0);
      await expect(evidenceList(page)).toHaveCount(0);
      // Nor a rating: there is nothing to judge, even once the run completes.
      await expect(investigation.getByText(VERDICT_QUESTION)).toHaveCount(0);
      await expect(
        investigation.getByRole("button", { name: "Confirmed" }),
      ).toHaveCount(0);
      await expect(
        investigation.getByRole("button", { name: "Rejected" }),
      ).toHaveCount(0);

      if (scenario.usage) {
        const activity: Locator = investigation.getByRole("region", {
          name: "Investigation activity",
          exact: true,
        });
        await expect(
          namedList(activity, "Investigation usage").getByRole("listitem"),
        ).toHaveText(scenario.usage);
      } else {
        await expect(
          namedList(investigation, "Investigation usage"),
        ).toHaveCount(0);
      }
      await expect(investigationDetails(page)).toHaveCount(
        scenario.hasDetails ? 1 : 0,
      );

      if (scenario.headerText) {
        await expect(hero(page)).toContainText(scenario.headerText);
        await hero(page)
          .getByRole("button", {
            name: "View live AI investigation progress",
          })
          .click();
        await expect(page.locator("#ai-investigation")).toBeFocused();
      } else {
        await expect(
          hero(page).getByRole("button", { name: "View full report" }),
        ).toHaveCount(0);
        await expect(hero(page)).not.toContainText("AI is investigating");
      }
    });
  }

  /*
   * With no run the slot keeps the same card, header and pill a run gets,
   * and says why nothing was investigated instead of a report. The
   * conversation closes that card too (see "one AI card" below).
   */
  test("?ai=none explains the missing run in the same card, with no header notice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=none");
    await expect(card(page, "Incident Feed")).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText("Rolling checkout-api back").first(),
    ).toBeVisible();

    const investigation: Locator = investigationCard(page);
    await expect(investigation).toHaveCount(1);
    await expect(investigation.getByLabel("Investigation status")).toHaveText(
      "Not investigated",
      { timeout: 30000 },
    );
    await expect(
      investigation.getByRole("heading", {
        level: 3,
        name: "No investigation has been recorded",
      }),
    ).toBeVisible();
    await expect(
      investigation.getByRole("heading", { level: 3, name: "What you can do" }),
    ).toBeVisible();
    await expect(
      investigation.getByRole("link", { name: "Review incident AI settings" }),
    ).toBeVisible();
    // Nothing a run would show: no report, details or rating.
    await expect(summarySection(page)).toHaveCount(0);
    await expect(reportSection(page)).toHaveCount(0);
    await expect(investigationDetails(page)).toHaveCount(0);
    await expect(investigation.getByText(VERDICT_QUESTION)).toHaveCount(0);
    await expect(
      hero(page).getByRole("button", { name: "View full report" }),
    ).toHaveCount(0);
    await expect(
      card(page, "Incident Feed").getByText(
        "OneUptime AI posted a root cause analysis",
      ),
    ).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * An investigation rule's wait (issue #5074)
 * ---------------------------------------------------------------------------
 */

/*
 * While an investigation rule makes OneUptime AI wait, the AI card says when
 * it investigates - eight minutes from the pinned clock, a 10-minute wait -
 * if the record is still open, with a "Waiting" pill rather than "Not
 * investigated". Whoever may change the record can start it at once with
 * Investigate now; everyone else is told who can.
 */
const WAIT_TIME: string = "(6:28 PM|18:28)";
const WAITING_INCIDENT_TITLE: RegExp = new RegExp(
  `^OneUptime AI investigates at ${WAIT_TIME} if this incident is still open$`,
);
const WAITING_ALERT_TITLE: RegExp = new RegExp(
  `^OneUptime AI investigates at ${WAIT_TIME} if this alert is still open$`,
);
const WAITING_INCIDENT_DESCRIPTION: string =
  "An AI rule makes OneUptime AI wait 10 minutes, so incidents resolved by then are not investigated.";
const WAITING_ALERT_DESCRIPTION: string =
  "An AI rule makes OneUptime AI wait 10 minutes, so alerts resolved by then are not investigated.";
// InvestigationRuleWait's refusal when the project's own daily limit is reached.
const DAILY_LIMIT_REFUSAL: string =
  "This project has reached its own daily AI limit. It resets at midnight UTC.";

function waitingBody(page: Page): Locator {
  return investigationCard(page).getByTestId("investigation-waiting");
}

async function openWaiting(
  page: Page,
  pagePath: string,
  query: string = "ai=waiting",
): Promise<Locator> {
  await open(page, pagePath, query);
  await expect(
    investigationCard(page).getByLabel("Investigation status"),
  ).toHaveText("Waiting", { timeout: 30000 });
  return waitingBody(page);
}

test.describe("an investigation rule's wait (issue #5074)", () => {
  test("?ai=waiting says when OneUptime AI investigates the incident, and why it waits, in the same card", async ({
    page,
  }: {
    page: Page;
  }) => {
    const waiting: Locator = await openWaiting(page, INCIDENT_PATH);
    const investigation: Locator = investigationCard(page);

    await expect(waiting.getByRole("heading", { level: 3 })).toHaveText(
      WAITING_INCIDENT_TITLE,
    );
    await expect(waiting).toContainText(WAITING_INCIDENT_DESCRIPTION);
    await expect(waiting).toHaveAttribute("aria-live", "polite");

    /*
     * Nothing was skipped: no "Not investigated" pill, and no reason why
     * (exact: the wait's own sentence ends "are not investigated.").
     */
    await expect(
      investigation.getByTestId("investigation-not-started"),
    ).toHaveCount(0);
    await expect(
      investigation.getByText("Not investigated", { exact: true }),
    ).toHaveCount(0);
    // Nothing a run shows yet.
    await expect(summarySection(page)).toHaveCount(0);
    await expect(reportSection(page)).toHaveCount(0);
    await expect(investigationDetails(page)).toHaveCount(0);
    await expect(investigation.getByText(VERDICT_QUESTION)).toHaveCount(0);

    // Someone who may change the incident is offered Investigate now.
    await expect(
      waiting.getByRole("button", { name: "Investigate now" }),
    ).toBeEnabled();
    await expect(waiting.getByTestId("investigate-now-who")).toHaveCount(0);
    await expect(waiting.getByTestId("investigate-now-error")).toHaveCount(0);
  });

  test("Investigate now starts it at once, once, for this incident, and the card turns to the queued run", async ({
    page,
  }: {
    page: Page;
  }) => {
    const waiting: Locator = await openWaiting(page, INCIDENT_PATH);
    const investigation: Locator = investigationCard(page);

    await waiting.getByRole("button", { name: "Investigate now" }).click();

    await expect(investigation.getByLabel("Investigation status")).toHaveText(
      "Queued",
      { timeout: 30000 },
    );
    await expect(waitingBody(page)).toHaveCount(0);

    const started: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/ai-investigation/investigate-now",
    );
    expect(started).toHaveLength(1);
    expect(started[0]!.method).toBe("POST");
    expect(started[0]!.body).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID,
    });
  });

  test("a refusal says why in the server's words, and the button stays for another try", async ({
    page,
  }: {
    page: Page;
  }) => {
    const waiting: Locator = await openWaiting(
      page,
      INCIDENT_PATH,
      "ai=waiting&fail=investigate-now",
    );

    await waiting.getByRole("button", { name: "Investigate now" }).click();

    const error: Locator = waiting.getByTestId("investigate-now-error");
    await expect(error).toHaveText(DAILY_LIMIT_REFUSAL);
    await expect(error).toHaveAttribute("role", "alert");
    await expect(
      waiting.getByRole("button", { name: "Investigate now" }),
    ).toBeEnabled();
    await expect(
      investigationCard(page).getByLabel("Investigation status"),
    ).toHaveText("Waiting");
  });

  test("?ai=waiting-viewer: someone who may not change the incident is told who can, and gets no button", async ({
    page,
  }: {
    page: Page;
  }) => {
    const waiting: Locator = await openWaiting(
      page,
      INCIDENT_PATH,
      "ai=waiting-viewer",
    );

    await expect(waiting.getByTestId("investigate-now-who")).toHaveText(
      "Someone who can edit this incident can start the investigation now.",
    );
    await expect(
      waiting.getByRole("button", { name: "Investigate now" }),
    ).toHaveCount(0);
  });

  /*
   * A day's wait from an incident declared late in the day ends tomorrow:
   * the heading says so, rather than "at 15 Sep, 5:20 PM".
   */
  test("?wait=tomorrow: a wait that ends after midnight says tomorrow at its time", async ({
    page,
  }: {
    page: Page;
  }) => {
    const waiting: Locator = await openWaiting(
      page,
      INCIDENT_PATH,
      "ai=waiting&wait=tomorrow",
    );

    await expect(waiting.getByRole("heading", { level: 3 })).toHaveText(
      /^OneUptime AI investigates tomorrow at (5:20 PM|17:20) if this incident is still open$/,
    );
    await expect(waiting).toContainText(
      "An AI rule makes OneUptime AI wait 1,440 minutes, so incidents resolved by then are not investigated.",
    );
  });

  /*
   * The rule-wait job takes a record within the minute its wait ends, and
   * the card shows the run once it reads it. Until then the card names no
   * time gone by: OneUptime AI investigates shortly. Still waiting, still
   * startable.
   */
  test("?wait=ended: once the time has come, the card says shortly, naming no time gone by", async ({
    page,
  }: {
    page: Page;
  }) => {
    const waiting: Locator = await openWaiting(
      page,
      ALERT_PATH,
      "ai=waiting&wait=ended",
    );

    await expect(waiting.getByRole("heading", { level: 3 })).toHaveText(
      "OneUptime AI investigates shortly if this alert is still open",
    );
    await expect(
      waiting.getByRole("button", { name: "Investigate now" }),
    ).toBeEnabled();
  });

  test("an alert's wait names the alert, and Investigate now starts it on the alert's lane", async ({
    page,
  }: {
    page: Page;
  }) => {
    const waiting: Locator = await openWaiting(page, ALERT_PATH);

    await expect(waiting.getByRole("heading", { level: 3 })).toHaveText(
      WAITING_ALERT_TITLE,
    );
    await expect(waiting).toContainText(WAITING_ALERT_DESCRIPTION);

    await waiting.getByRole("button", { name: "Investigate now" }).click();

    await expect(
      investigationCard(page).getByLabel("Investigation status"),
    ).toHaveText("Queued", { timeout: 30000 });
    expect(
      (await apiRequestsTo(page, "/ai-investigation/investigate-now")).map(
        (request: RecordedApiRequest): Record<string, unknown> => {
          return request.body;
        },
      ),
    ).toEqual([{ subjectType: "alert", subjectId: ALERT_ID }]);
  });

  test("on a phone the waiting card fits the screen, its button and words inside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const waiting: Locator = await openWaiting(page, INCIDENT_PATH);
    const button: Locator = waiting.getByRole("button", {
      name: "Investigate now",
    });

    await button.scrollIntoViewIfNeeded();
    const body: Box = await documentBox(waiting);
    const buttonBox: Box = await documentBox(button);

    expect(buttonBox.x).toBeGreaterThanOrEqual(body.x - 0.5);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(
      body.x + body.width + 0.5,
    );
    // The page never scrolls sideways.
    expect(
      await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      }),
    ).toBe(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A page OneUptime AI holds (#5351)
 * ---------------------------------------------------------------------------
 */

/*
 * An on-call rule set to After OneUptime AI tries holds the record's page
 * while OneUptime AI works on it (?hold=1): the AI card says so before
 * anything else, with when paging starts unless OneUptime AI resolves the
 * record - 18:31 for incident #1042 and 18:36 for alert #311, 30 minutes from
 * when each was declared - and Page now, for anyone who wants a person on it
 * at once. Someone acknowledging a record ends its hold, so the held pages
 * are opened before anybody did (?state=created). The notice reads the
 * record's on-call runs that wait, marked Holding, and nothing more.
 */
const ON_CALL_RUNS: string = "OnCallDutyPolicyExecutionLog";
const HOLD_QUERY: string = "state=created&hold=1";
const AI_HOLD_TITLE: string = "OneUptime AI is on it";
const PAGE_NOW: string = "Page now";
// AiFirstResponderAPI's refusal for someone who may not page on-call policies.
const PAGE_NOW_REFUSAL: string =
  "You need permission to page on-call policies to page now.";

interface HeldRecord {
  kind: "incident" | "alert";
  path: string;
  // The record the notice reads the held runs of, as the fixture records it.
  recordQuery: Record<string, unknown>;
  sentence: RegExp;
}

const INCIDENT_HOLD: HeldRecord = {
  kind: "incident",
  path: INCIDENT_PATH,
  recordQuery: {
    triggeredByIncidentId: { _type: "ObjectID", value: INCIDENT_ID },
  },
  sentence:
    /^On-call paging starts at (6:31 PM|18:31) unless OneUptime AI resolves this incident first\.$/,
};

const ALERT_HOLD: HeldRecord = {
  kind: "alert",
  path: ALERT_PATH,
  recordQuery: { triggeredByAlertId: { _type: "ObjectID", value: ALERT_ID } },
  sentence:
    /^On-call paging starts at (6:36 PM|18:36) unless OneUptime AI resolves this alert first\.$/,
};

function aiHoldNotice(page: Page): Locator {
  return investigationCard(page).getByTestId("ai-hold-notice");
}

// What the page asked of the on-call runs: the notice's reads, and only them.
async function onCallRunReads(
  page: Page,
): Promise<Array<RecordedModelRequest>> {
  return (await fixture(page)).listRequests.filter(
    (request: RecordedModelRequest): boolean => {
      return request.modelName === ON_CALL_RUNS;
    },
  );
}

// The notice's one read: the record's runs OneUptime AI holds, the first to page.
function heldRunsRead(
  recordQuery: Record<string, unknown>,
): RecordedModelRequest {
  return {
    modelName: ON_CALL_RUNS,
    query: { ...recordQuery, status: "Waiting", aiHoldOutcome: "Holding" },
    select: { _id: true, pagingStartsAt: true },
    sort: { pagingStartsAt: "ASC" },
    skip: 0,
    limit: 1,
  };
}

async function openHeld(
  page: Page,
  pagePath: string,
  query: string = HOLD_QUERY,
): Promise<Locator> {
  await open(page, pagePath, query);
  await expect(aiHoldNotice(page)).toBeVisible({ timeout: 30000 });
  return aiHoldNotice(page);
}

// Two frames on: an answer that has already arrived has been drawn.
async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate((): Promise<void> => {
    return new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => {
        requestAnimationFrame((): void => {
          resolve();
        });
      });
    });
  });
}

// A translucent colour laid over an opaque one, as the browser paints it.
function paintedOver(top: string, bottom: string): string {
  const [red, green, blue, alpha]: Array<number> = (
    top.match(/[\d.]+/g) || []
  ).map(Number);
  const under: Array<number> = (bottom.match(/[\d.]+/g) || []).map(Number);
  const opacity: number = alpha === undefined ? 1 : alpha;
  const mix: (front: number, back: number) => number = (
    front: number,
    back: number,
  ): number => {
    return Math.round(front * opacity + back * (1 - opacity));
  };

  return `rgb(${mix(red || 0, under[0] || 0)}, ${mix(green || 0, under[1] || 0)}, ${mix(blue || 0, under[2] || 0)})`;
}

test.describe("a page OneUptime AI holds (#5351)", () => {
  for (const held of [INCIDENT_HOLD, ALERT_HOLD]) {
    test(`the ${held.kind}'s AI card says first that OneUptime AI is on it, when paging starts, and offers Page now, reading only this ${held.kind}'s held pages (?hold=1)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const notice: Locator = await openHeld(page, held.path);

      await expect(
        notice.getByText(AI_HOLD_TITLE, { exact: true }),
      ).toBeVisible();
      await expect(notice.getByText(held.sentence)).toBeVisible();
      await expect(
        notice.getByRole("button", { name: PAGE_NOW }),
      ).toBeEnabled();
      // Read out as it changes, without taking the reader's focus.
      await expect(notice).toHaveAttribute("aria-live", "polite");
      // Nothing went wrong: no refusal under the words.
      await expect(notice.getByRole("alert")).toHaveCount(0);

      // The first thing in the card's region, above the report it holds.
      expect(
        await page
          .locator("#ai-investigation")
          .evaluate((region: Element): string | null => {
            return (
              region.firstElementChild?.getAttribute("data-testid") || null
            );
          }),
      ).toBe("ai-hold-notice");
      await expect(
        investigationCard(page).getByLabel("Investigation status"),
      ).toHaveText("Completed", { timeout: 30000 });

      /*
       * Every read of the on-call runs was the notice's, for this record's
       * held pages only: it reads again while a page is held.
       */
      const reads: Array<RecordedModelRequest> = await onCallRunReads(page);
      expect(reads.length).toBeGreaterThanOrEqual(1);
      for (const read of reads) {
        expect(read).toEqual(heldRunsRead(held.recordQuery));
      }

      await screenshotElement(notice, `ai-card-hold-${held.kind}`);
    });
  }

  test("with nothing held the card says nothing of it, though it asked: an incident and an alert, and an incident while others' pages are held", async ({
    page,
  }: {
    page: Page;
  }) => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      [INCIDENT_PATH, "state=created", INCIDENT_HOLD.recordQuery],
      [ALERT_PATH, "state=created", ALERT_HOLD.recordQuery],
      // OneUptime AI holds #1042's and #311's pages; #1029's hold ended long ago.
      [
        incidentPath(1029),
        "hold=1",
        {
          triggeredByIncidentId: {
            _type: "ObjectID",
            value: uuid("20000000", 1029),
          },
        },
      ],
    ];

    for (const [pagePath, query, recordQuery] of cases) {
      await open(page, pagePath, query);
      await expect
        .poll(
          async (): Promise<number> => {
            return (await onCallRunReads(page)).length;
          },
          { timeout: 30000 },
        )
        .toBeGreaterThan(0);
      await afterNextPaint(page);

      await expect(aiHoldNotice(page)).toHaveCount(0);
      for (const read of await onCallRunReads(page)) {
        expect(read).toEqual(heldRunsRead(recordQuery));
      }
      expect(
        (await fixture(page)).unhandled,
        "requests the fixture does not model",
      ).toEqual([]);
    }
  });

  test("a reader who may not read on-call runs is told nothing, and nothing is read (?role=alert-member)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, `${HOLD_QUERY}&role=alert-member`);
    // The card has drawn what it reads on its own.
    await expect(
      investigationCard(page).getByLabel("Investigation status"),
    ).toHaveText("Completed", { timeout: 30000 });
    await afterNextPaint(page);

    expect(await onCallRunReads(page)).toEqual([]);
    await expect(aiHoldNotice(page)).toHaveCount(0);
  });

  test("Page now pages people at once, once, for this incident, and the notice goes", async ({
    page,
  }: {
    page: Page;
  }) => {
    const notice: Locator = await openHeld(page, INCIDENT_PATH);
    const readsBefore: number = (await onCallRunReads(page)).length;

    await notice.getByRole("button", { name: PAGE_NOW }).click();

    /*
     * Gone at once: the notice reads the hold again as soon as paging has
     * started, not on its next read every 15 seconds while a page is held.
     */
    await expect(aiHoldNotice(page)).toHaveCount(0, { timeout: 5000 });
    const pagesNow: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/ai-first-responder/page-now",
    );
    expect(pagesNow).toHaveLength(1);
    expect(pagesNow[0]!.method).toBe("POST");
    expect(pagesNow[0]!.body).toEqual({ incidentId: INCIDENT_ID });
    // It read the hold again once paging had started, and found none.
    expect((await onCallRunReads(page)).length).toBeGreaterThan(readsBefore);
  });

  test("a refusal says why in the server's words, and Page now stays for another try (?fail=page-now)", async ({
    page,
  }: {
    page: Page;
  }) => {
    const notice: Locator = await openHeld(
      page,
      INCIDENT_PATH,
      `${HOLD_QUERY}&fail=page-now`,
    );

    await notice.getByRole("button", { name: PAGE_NOW }).click();

    await expect(notice.getByRole("alert")).toHaveText(PAGE_NOW_REFUSAL);
    await expect(notice.getByText(INCIDENT_HOLD.sentence)).toBeVisible();
    await expect(notice.getByRole("button", { name: PAGE_NOW })).toBeEnabled();
  });

  test("on a 390px phone the notice fits the card, Page now and its words inside it, and nothing scrolls sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const notice: Locator = await openHeld(page, INCIDENT_PATH);
    // What happened sits above the card: measure only once it stops moving.
    await expectWhatHappenedSettled(page);
    const button: Locator = notice.getByRole("button", { name: PAGE_NOW });
    await button.scrollIntoViewIfNeeded();

    const cardBox: Box = await documentBox(investigationCard(page));
    const noticeBox: Box = await documentBox(notice);
    const buttonBox: Box = await documentBox(button);

    expect(noticeBox.x).toBeGreaterThanOrEqual(cardBox.x - 0.5);
    expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width + 0.5,
    );
    expect(buttonBox.x).toBeGreaterThanOrEqual(noticeBox.x - 0.5);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(
      noticeBox.x + noticeBox.width + 0.5,
    );
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(
      noticeBox.y + noticeBox.height + 0.5,
    );
    // The sentence wraps rather than being cut.
    expect(await isOverflowing(notice.getByText(INCIDENT_HOLD.sentence))).toBe(
      false,
    );
    await expectNoHorizontalOverflow(page);

    await screenshotElement(notice, "ai-card-hold-mobile");
  });

  test("in the dark theme the notice takes the dark card's colours, its words readable on it (?theme=dark)", async ({
    page,
  }: {
    page: Page;
  }) => {
    const notice: Locator = await openHeld(
      page,
      INCIDENT_PATH,
      `${HOLD_QUERY}&theme=dark`,
    );
    await expect(
      investigationCard(page).getByLabel("Investigation status"),
    ).toHaveText("Completed", { timeout: 30000 });

    const look: {
      wash: string;
      edge: string;
      surface: string;
      mark: string;
      title: string;
      sentence: string;
    } = await notice.evaluate(
      (
        element: Element,
      ): {
        wash: string;
        edge: string;
        surface: string;
        mark: string;
        title: string;
        sentence: string;
      } => {
        const zeroAlpha: RegExp = /rgba\([^)]*,\s*0\)$/;
        const style: CSSStyleDeclaration = window.getComputedStyle(element);
        const words: Array<Element> = Array.from(element.querySelectorAll("p"));
        let surface: string = "";
        let ancestor: Element | null = element.parentElement;

        // The card's own surface, under the notice's translucent wash.
        while (ancestor && !surface) {
          const background: string =
            window.getComputedStyle(ancestor).backgroundColor;

          if (background !== "transparent" && !zeroAlpha.test(background)) {
            surface = background;
          }

          ancestor = ancestor.parentElement;
        }

        return {
          wash: style.backgroundColor,
          edge: style.borderTopColor,
          surface: surface,
          mark: window.getComputedStyle(element.querySelector("svg") as Element)
            .color,
          title: words[0] ? window.getComputedStyle(words[0]).color : "",
          sentence: words[1] ? window.getComputedStyle(words[1]).color : "",
        };
      },
    );

    // Theme.css's dark indigo wash and edge, not the light ones.
    expect(look.wash).toBe("rgba(49, 46, 129, 0.35)");
    expect(look.edge).toBe("rgba(129, 140, 248, 0.45)");
    // The dark card's surface under it.
    expect(look.surface).toBe("rgb(23, 32, 51)");
    // Light words, and the light indigo mark.
    expect(look.title).toBe("rgb(248, 250, 252)");
    expect(look.sentence).toBe("rgb(226, 232, 240)");
    expect(look.mark).toBe("rgb(165, 180, 252)");

    const ground: string = paintedOver(look.wash, look.surface);
    expect(contrastRatio(look.title, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(look.sentence, ground)).toBeGreaterThanOrEqual(4.5);

    await screenshotElement(notice, "ai-card-hold-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * One flat card
 * ---------------------------------------------------------------------------
 */

interface PanelOffender {
  tag: string;
  className: string;
  reason: string;
}

/*
 * Everything inside the AI card that paints a panel of its own, read from the
 * browser's computed styles: a tinted background, a frame on all four sides,
 * or a shadow, on anything big enough to be a region (small marks such as a
 * spinner are not panels). Controls (buttons, links, tabs, the verdict's
 * answer group, the rows block of an evidence query, and the conversation's
 * text box together with the frame drawn around it), inline code and
 * collapsed content are left out. So are the two things in an answer that
 * keep a frame on purpose, each a named group: a chart or table (a figure,
 * framed wherever it is drawn) and an action waiting for approval - and each
 * step's status pill (block 43), a pill on its title's line as the card's
 * header pill was, never a panel around content. The card
 * used to hold a tinted summary box, a report box with an amber callout
 * inside it, a details box and an actions box, and its conversation gray
 * steps, a red error, bordered action rows and source pills.
 *
 * The card is read at rest. A row's hover wash is not a panel, but one caught
 * fading out reads as a tinted background: clicking an evidence row moves the
 * pointer off the Evidence and activity header it opened, whose wash then
 * fades for 150ms. So the pointer is parked off the card and transitions are
 * suspended while the styles are read, which settles every wash at once.
 */
async function panelsInsideTheCard(page: Page): Promise<Array<PanelOffender>> {
  await page.mouse.move(0, 0);

  return page
    .locator("#ai-investigation")
    .evaluate((region: Element): Array<PanelOffender> => {
      const offenders: Array<PanelOffender> = [];
      const atRest: HTMLStyleElement = document.createElement("style");
      atRest.textContent =
        "*, *::before, *::after { transition: none !important; }";
      document.head.appendChild(atRest);
      // Declared in here: this callback runs in the page, not in Node.
      const zeroAlphaRgba: RegExp = /rgba\([^)]*,\s*0\)$/;
      const isTransparent: (color: string) => boolean = (
        color: string,
      ): boolean => {
        return (
          color === "transparent" ||
          zeroAlphaRgba.test(color) ||
          color === "rgba(0, 0, 0, 0)"
        );
      };

      const isFramed: (element: Element) => boolean = (
        element: Element,
      ): boolean => {
        const style: CSSStyleDeclaration = window.getComputedStyle(element);

        return ["top", "right", "bottom", "left"].every(
          (side: string): boolean => {
            return (
              parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
              style.getPropertyValue(`border-${side}-style`) !== "none"
            );
          },
        );
      };

      /*
       * A textarea draws no border of its own: the frame around it (the
       * nearest framed ancestor) is what shows it as a text box, so the two
       * are one control, like a button.
       */
      const textBoxFrames: Array<Element> = [];

      for (const textBox of Array.from(region.querySelectorAll("textarea"))) {
        let ancestor: Element | null = textBox.parentElement;

        while (ancestor && ancestor !== region) {
          if (isFramed(ancestor)) {
            textBoxFrames.push(ancestor);
            break;
          }

          ancestor = ancestor.parentElement;
        }
      }

      for (const element of Array.from(region.querySelectorAll("*"))) {
        if (
          element.closest(
            "button, a, [role='tab'], [role='group'], code, pre, kbd, [hidden], textarea, [data-testid='ai-card-step-investigation-status'], [data-testid='ai-card-step-remediation-status']",
          ) ||
          textBoxFrames.some((frame: Element): boolean => {
            return frame.contains(element);
          })
        ) {
          continue;
        }

        const rect: DOMRect = element.getBoundingClientRect();

        if (rect.width < 40 || rect.height < 24) {
          continue;
        }

        const style: CSSStyleDeclaration = window.getComputedStyle(element);
        const shadowColors: Array<string> =
          style.boxShadow === "none"
            ? []
            : style.boxShadow.match(/rgba?\([^)]*\)/g) || [];
        const hasShadow: boolean = shadowColors.some(
          (color: string): boolean => {
            return !isTransparent(color);
          },
        );
        const reasons: Array<string> = [];

        if (!isTransparent(style.backgroundColor)) {
          reasons.push(`background ${style.backgroundColor}`);
        }

        if (isFramed(element)) {
          reasons.push("framed");
        }

        if (hasShadow) {
          reasons.push(`shadow ${style.boxShadow}`);
        }

        if (reasons.length > 0) {
          offenders.push({
            tag: element.tagName.toLowerCase(),
            className: element.getAttribute("class") || "",
            reason: reasons.join(", "),
          });
        }
      }

      atRest.remove();

      return offenders;
    });
}

interface CardState {
  name: string;
  query: string;
  badge: string;
}

const CARD_STATES: ReadonlyArray<CardState> = [
  { name: "a completed report", query: "", badge: "Completed" },
  {
    name: "a report with cluster access notes",
    query: "clusters=mixed",
    badge: "Completed",
  },
  { name: "a legacy report", query: "ai=legacy", badge: "Completed" },
  {
    name: "a running investigation",
    query: "ai=running",
    badge: "Investigating…",
  },
  {
    name: "a running investigation with cluster access notes",
    query: "ai=running&clusters=mixed",
    badge: "Investigating…",
  },
  { name: "a queued investigation", query: "ai=queued", badge: "Queued" },
  {
    name: "a failed investigation",
    query: "ai=failed",
    badge: "Did not finish",
  },
  {
    name: "a report being prepared",
    query: "ai=pending",
    badge: "Preparing report…",
  },
  { name: "no investigation", query: "ai=none", badge: "Not investigated" },
  // An incident checked again after an alert opened (?linked=followup).
  {
    name: "a follow-up check's report",
    query: "linked=followup",
    badge: "Completed",
  },
  {
    name: "a follow-up check running",
    query: "ai=running&linked=followup",
    badge: "Investigating…",
  },
  // An investigation rule's wait (issue #5074, ?ai=waiting).
  {
    name: "an investigation waiting for its rule",
    query: "ai=waiting",
    badge: "Waiting",
  },
];

async function openCardState(page: Page, state: CardState): Promise<Locator> {
  await open(page, INCIDENT_PATH, state.query);
  const investigation: Locator = investigationCard(page);
  await expect(investigation.getByLabel("Investigation status")).toHaveText(
    state.badge,
    { timeout: 30000 },
  );
  // What happened sits above the card: measure only once it stops moving.
  await expectWhatHappenedSettled(page);
  return investigation;
}

test.describe("one flat AI investigation card", () => {
  for (const state of CARD_STATES) {
    test(`${state.name} is one card with no panel inside it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const investigation: Locator = await openCardState(page, state);

      // No card inside the card.
      await expect(investigation.getByTestId("card")).toHaveCount(0);
      expect(await panelsInsideTheCard(page)).toEqual([]);
    });
  }

  test("an open section and an expanded evidence row still draw no panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const details: Locator = await expandEvidence(page, "C5");
    await expect(details.locator("pre")).toBeVisible();

    expect(await panelsInsideTheCard(page)).toEqual([]);
  });

  test("every heading in the card shares one size, weight and colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "clusters=mixed");

    const headings: Array<{ text: string; style: string }> = await page
      .locator("#ai-investigation h3")
      .evaluateAll(
        (elements: Array<Element>): Array<{ text: string; style: string }> => {
          return elements
            .filter((element: Element): boolean => {
              return !element.closest("[hidden]");
            })
            .map((element: Element): { text: string; style: string } => {
              const style: CSSStyleDeclaration =
                window.getComputedStyle(element);
              return {
                text: element.textContent || "",
                style: [
                  style.fontSize,
                  style.fontWeight,
                  style.color,
                  style.textTransform,
                  style.letterSpacing,
                ].join(" "),
              };
            });
        },
      );

    expect(
      headings.map((heading: { text: string }): string => {
        return heading.text;
      }),
    ).toEqual([
      // The first step, its report opened: what OneUptime AI found.
      "Investigation",
      "Summary",
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
      "Evidence and activity",
      VERDICT_QUESTION,
      // The second step: what OneUptime AI is doing to fix it (block 43).
      "Remediation",
      // The shared conversation under both.
      "Ask OneUptime AI",
    ]);
    expect(
      new Set(
        headings.map((heading: { style: string }): string => {
          return heading.style;
        }),
      ).size,
    ).toBe(1);
    // A plain title: 14px semibold near-black, never an uppercase label.
    expect(headings[0]!.style).toBe("14px 600 rgb(17, 24, 39) none normal");
  });

  test("the status pill is the same neutral pill in every state", async ({
    page,
  }: {
    page: Page;
  }) => {
    const looks: Array<string> = [];

    for (const state of CARD_STATES) {
      const investigation: Locator = await openCardState(page, state);
      looks.push(
        await investigation
          .getByLabel("Investigation status")
          .evaluate((element: Element): string => {
            const style: CSSStyleDeclaration = window.getComputedStyle(element);
            return [
              style.backgroundColor,
              style.color,
              style.boxShadow,
              style.borderRadius,
            ].join(" | ");
          }),
      );
    }

    expect(new Set(looks).size).toBe(1);
    // gray-50 behind gray-700 text: the colour is only in the small mark.
    expect(looks[0]).toContain("rgb(249, 250, 251) | rgb(55, 65, 81)");
  });

  test("the report opens the investigation step and the rating closes it, before Remediation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "clusters=mixed");
    const investigation: Locator = investigationCard(page);

    await expectAbove(
      investigation.getByTestId("card-description"),
      summarySection(page),
      "the title before the summary",
    );
    await expectAbove(
      page.getByTestId("investigation-report-footer"),
      page.getByTestId("cluster-access-notice"),
      "the report before the cluster notes",
    );
    await expectAbove(
      page.getByTestId("cluster-access-notice"),
      investigationDetails(page),
      "the cluster notes before the working",
    );
    await expectAbove(
      investigationDetails(page),
      page.getByTestId("investigation-actions"),
      "the working before the rating",
    );
    /*
     * The rating is all that is left of the actions: the fix pull request
     * is the Remediation step's (block 43).
     */
    await expect(
      page
        .getByTestId("investigation-actions")
        .getByRole("heading", { level: 3 }),
    ).toHaveText([VERDICT_QUESTION]);
    await expectAbove(
      page.getByTestId("investigation-actions"),
      reportToggle(page),
      "the rating, then Show less",
    );
    await expectAbove(
      reportToggle(page),
      remediationStep(page),
      "the investigation, then the remediation",
    );
  });

  test("hairlines, not boxes, split the report from its working and its actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    for (const locator of [
      investigationDetails(page),
      page.getByTestId("investigation-actions"),
    ]) {
      const borders: Array<string> = await locator.evaluate(
        (element: Element): Array<string> => {
          const style: CSSStyleDeclaration = window.getComputedStyle(element);
          return [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ];
        },
      );
      expect(borders).toEqual(["1px", "0px", "0px", "0px"]);
    }
  });

  test("cluster access notes are plain lines, and the fix link opens the cluster's AI agent page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "clusters=mixed");
    const notice: Locator = page.getByTestId("cluster-access-notice");

    await expect(page.getByTestId("cluster-access-run-usage")).toHaveText(
      "This investigation used OneUptime data only — no kubectl commands were run.",
    );
    const reachable: Locator = page.getByTestId("cluster-access-reachable");
    await expect(reachable).toHaveText(
      "OneUptime AI currently has read-only kubectl access to prod-eu-west-1 (fixes ask for your approval).",
    );
    await expect(
      reachable.getByRole("link", { name: "prod-eu-west-1" }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/kubernetes/83000000-0000-4000-8000-000000000001/ai/agent`,
    );

    const unreachable: Locator = page.getByTestId("cluster-access-unreachable");
    await expect(unreachable).toContainText(
      'OneUptime AI cannot currently reach cluster "staging-us-east-1" with kubectl',
    );
    await expect(unreachable).toContainText(
      "Why: The Kubernetes AI agent is not connected.",
    );
    await expect(unreachable).toContainText(
      "What to do: Install the Kubernetes AI agent",
    );

    // Each note is a line with a mark, not a tinted box.
    for (const row of await notice.locator(":scope > div").all()) {
      const look: { background: string; border: string } = await row.evaluate(
        (element: Element): { background: string; border: string } => {
          const style: CSSStyleDeclaration = window.getComputedStyle(element);
          return {
            background: style.backgroundColor,
            border: style.borderTopWidth,
          };
        },
      );
      expect(look).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px" });
      await expect(row.locator("svg").first()).toBeVisible();
    }

    await unreachable
      .getByRole("link", { name: "Open the cluster's AI agent page" })
      .click();
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "KUBERNETES_CLUSTER_VIEW_AI_AGENT",
    );
    expect(new URL(page.url()).pathname).toBe(
      `${DASHBOARD}/kubernetes/83000000-0000-4000-8000-000000000002/ai/agent`,
    );
  });

  test("a live run lists its cluster access before its steps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=running&clusters=mixed");
    const live: Locator = investigationCard(page).getByRole("region", {
      name: "Live investigation",
      exact: true,
    });

    await expect(
      live.getByRole("heading", {
        level: 3,
        name: "OneUptime AI is investigating",
      }),
    ).toBeVisible({ timeout: 30000 });
    await expect(live).toContainText(
      "Reading this project's telemetry and running read-only kubectl on the cluster, narrating every step. Nothing is changed.",
    );
    await expect(page.getByTestId("cluster-access-unreachable")).toContainText(
      'Investigating with OneUptime data only — no kubectl access to cluster "staging-us-east-1"',
    );
    // What the run did is only said once it has finished.
    await expect(page.getByTestId("cluster-access-run-usage")).toHaveCount(0);
    await expectAbove(
      page.getByTestId("cluster-access-notice"),
      live.getByText("Starting investigation", { exact: true }),
      "cluster access before the steps",
    );
  });

  test("a chip's highlight reaches past the text while the row and its divider stay put", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const list: Locator = await openEvidence(page);
    const tabs: Locator = investigationDetails(page).getByRole("tablist");
    const row: Locator = evidenceRow(page, "C3");
    const restingBox: Box = await documentBox(row);

    await citationChip(summarySection(page), "C3").click();
    await expect(row).toHaveAttribute("data-highlighted", "true");

    // The wash fades in over 300ms, so read it once it has settled.
    await expect
      .poll(
        async (): Promise<{
          left: string;
          right: string;
          background: string;
        }> => {
          return row.evaluate(
            (
              element: Element,
            ): { left: string; right: string; background: string } => {
              const style: CSSStyleDeclaration = window.getComputedStyle(
                element,
                "::before",
              );
              return {
                left: style.left,
                right: style.right,
                background: style.backgroundColor,
              };
            },
          );
        },
      )
      .toEqual({
        left: "-12px",
        right: "-12px",
        // indigo-50 at 70%.
        background: "rgba(238, 242, 255, 0.7)",
      });

    // The row itself does not move, so its divider keeps to the text width.
    const highlightedBox: Box = await documentBox(row);
    expect(highlightedBox.x).toBeCloseTo(restingBox.x, 0);
    expect(highlightedBox.width).toBeCloseTo(restingBox.width, 0);
    const listBox: Box = await documentBox(list);
    const tabsBox: Box = await documentBox(tabs);
    expect(highlightedBox.width).toBeCloseTo(listBox.width, 0);
    expect(listBox.x).toBeCloseTo(tabsBox.x, 0);
    expect(listBox.width).toBeCloseTo(tabsBox.width, 0);

    // The highlight fades after two seconds.
    await expect(row).not.toHaveAttribute("data-highlighted", "true", {
      timeout: 5000,
    });
  });

  test("in the dark theme a chip's highlight uses the dark indigo wash", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "theme=dark");
    await openEvidence(page);
    const row: Locator = evidenceRow(page, "C3");

    await citationChip(summarySection(page), "C3").click();
    await expect(row).toHaveAttribute("data-highlighted", "true");
    // The wash fades in over 300ms, so read it once it has settled.
    await expect
      .poll(async (): Promise<string> => {
        return row.evaluate((element: Element): string => {
          return window.getComputedStyle(element, "::before").backgroundColor;
        });
      })
      .toBe("rgba(49, 46, 129, 0.35)");
  });
});

/*
 * ---------------------------------------------------------------------------
 * One AI card: the investigation and the conversation
 * ---------------------------------------------------------------------------
 * The investigation and "Ask OneUptime AI" used to read as two cards. With no
 * run they were two (the explanation of why nothing was investigated, and the
 * conversation in a card of its own under it); with a run the conversation
 * sat in the card behind an icon tile and a header of its own. The card now
 * closes with the conversation in every state, drawn like its other rows.
 */

const CONVERSATION_TITLE: string = "Ask OneUptime AI";
const WORKING_PLACEHOLDER: string =
  "Type your next question — send it when this answer finishes…";
const SENT_ANSWER: string =
  "checkout-api is still the only service above its latency threshold: its p95 is back under 500 ms since 18:12 and no other monitor has changed state";
const USUAL_SUGGESTIONS: ReadonlyArray<string> = [
  "What should I do right now?",
  "What changed just before this?",
  "Is anything else affected?",
  "Draft a status update",
  "Acknowledge this incident",
];
const ROOT_CAUSE_SUGGESTION: string = "What is the root cause?";
// A resolved incident's, in the places of what to do now and what else it affects.
const RESOLVED_SUGGESTIONS: ReadonlyArray<string> = [
  "Prevent a repeat",
  "What changed just before this?",
  "Response timeline",
  "Draft a status update",
];
// indigo-600: the page's primary buttons, and OneUptime AI's mark.
const INDIGO_600: string = "rgb(79, 70, 229)";
// The font the dashboard ships (views/index.ejs); the fixture does not load it.
const INTER_FONT_FILE: string = path.resolve(
  __dirname,
  "../../Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

function conversation(page: Page): Locator {
  return page.getByTestId("investigation-conversation");
}

function composerBox(page: Page): Locator {
  return conversation(page).getByRole("textbox", { name: CONVERSATION_TITLE });
}

// The frame drawn around the text box, its mode picker and Send.
function composerFrame(page: Page): Locator {
  return conversation(page)
    .getByTestId("investigation-conversation-composer")
    .locator(":scope > div")
    .first();
}

function sendButton(page: Page): Locator {
  return conversation(page).getByTitle("Send (Enter)");
}

function stopButton(page: Page): Locator {
  return conversation(page).getByTitle("Stop generating");
}

function modePicker(page: Page): Locator {
  return conversation(page).getByTitle("Choose what the AI is allowed to do");
}

function modeCaption(page: Page): Locator {
  return conversation(page).getByTestId("investigation-conversation-mode");
}

function suggestions(page: Page): Locator {
  return conversation(page)
    .getByRole("group", { name: "Suggested questions" })
    .getByRole("button");
}

function questions(page: Page): Locator {
  return conversation(page).getByTestId("investigation-conversation-question");
}

function answers(page: Page): Locator {
  return conversation(page).getByTestId("investigation-conversation-answer");
}

function thread(page: Page): Locator {
  return conversation(page).getByRole("log");
}

function showEarlier(page: Page): Locator {
  return conversation(page).getByTestId(
    "investigation-conversation-show-earlier",
  );
}

function sources(answer: Locator): Locator {
  return answer
    .getByTestId("investigation-conversation-sources")
    .getByRole("listitem");
}

async function openConversation(
  page: Page,
  query: string,
  pagePath: string = INCIDENT_PATH,
): Promise<Locator> {
  await open(page, pagePath, query);
  await expect(
    conversation(page).getByRole("heading", {
      level: 3,
      name: CONVERSATION_TITLE,
    }),
  ).toBeVisible({ timeout: 30000 });
  // The thread has loaded: either it shows messages or it suggests some.
  await expect(
    conversation(page).getByText("Loading the conversation…"),
  ).toHaveCount(0);
  return conversation(page);
}

interface TextLook {
  fontSize: string;
  fontWeight: string;
  color: string;
}

async function textLook(locator: Locator): Promise<TextLook> {
  return locator.evaluate((element: Element): TextLook => {
    const style: CSSStyleDeclaration = window.getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
    };
  });
}

interface FrameLook {
  background: string;
  borders: Array<string>;
  shadow: string;
}

async function frameLook(locator: Locator): Promise<FrameLook> {
  return locator.evaluate((element: Element): FrameLook => {
    const style: CSSStyleDeclaration = window.getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borders: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      shadow: style.boxShadow,
    };
  });
}

const NO_FRAME: FrameLook = {
  background: "rgba(0, 0, 0, 0)",
  borders: ["0px", "0px", "0px", "0px"],
  shadow: "none",
};

test.describe("one AI card: the investigation and the conversation", () => {
  for (const state of CARD_STATES) {
    test(`${state.name}: the conversation closes the one AI card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const investigation: Locator = await openCardState(page, state);
      await expect(
        conversation(page).getByRole("heading", {
          level: 3,
          name: CONVERSATION_TITLE,
        }),
      ).toBeVisible();

      // One AI card on the page, and the conversation is inside it.
      await expect(investigation).toHaveCount(1);
      await expect(
        investigation.getByTestId("investigation-conversation"),
      ).toHaveCount(1);
      await expect(conversation(page)).toHaveCount(1);
      await expect(
        page.getByTestId("card").filter({ has: conversation(page) }),
      ).toHaveCount(1);

      // No card, and no card-level heading, of its own.
      await expect(card(page, CONVERSATION_TITLE)).toHaveCount(0);
      await expect(
        page.getByRole("heading", { level: 2, name: CONVERSATION_TITLE }),
      ).toHaveCount(0);
      await expect(conversation(page).getByTestId("card")).toHaveCount(0);

      // It is the last thing in the card's region.
      expect(
        await page
          .locator("#ai-investigation")
          .evaluate((region: Element): string | null => {
            return region.lastElementChild?.getAttribute("data-testid") || null;
          }),
      ).toBe("investigation-conversation");

      // And the card ends with its composer: nothing follows it but padding.
      const cardBox: Box = await documentBox(
        investigation.locator(":scope > div").first(),
      );
      const composer: Box = await documentBox(
        conversation(page).getByTestId("investigation-conversation-composer"),
      );
      const gap: number =
        cardBox.y + cardBox.height - (composer.y + composer.height);
      expect(gap).toBeGreaterThanOrEqual(20);
      expect(gap).toBeLessThanOrEqual(32);
    });
  }

  test("the alert page has the same one card", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A new alert (?state=created): nobody has acknowledged it yet.
    for (const query of ["state=created", "state=created&ai=none"]) {
      await openConversation(page, query, ALERT_PATH);

      await expect(investigationCard(page)).toHaveCount(1);
      await expect(
        investigationCard(page).getByTestId("investigation-conversation"),
      ).toHaveCount(1);
      await expect(card(page, CONVERSATION_TITLE)).toHaveCount(0);
      await expect(
        suggestions(page).filter({ hasText: "Acknowledge this alert" }),
      ).toHaveCount(1);
    }
  });

  test("the conversation is drawn like the card's other rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const section: Locator = conversation(page);
    const heading: Locator = section.getByRole("heading", {
      level: 3,
      name: CONVERSATION_TITLE,
    });
    const verdictHeading: Locator = page
      .getByTestId("investigation-actions")
      .getByRole("heading", { level: 3, name: VERDICT_QUESTION });

    // A hairline above it and nothing else around it.
    expect(await frameLook(section)).toEqual({
      background: "rgba(0, 0, 0, 0)",
      borders: ["1px", "0px", "0px", "0px"],
      shadow: "none",
    });

    // The same title and the same quieter line under it as the verdict row.
    expect(await textLook(heading)).toEqual(await textLook(verdictHeading));
    const description: Locator = heading.locator("xpath=following-sibling::p");
    const verdictDescription: Locator = verdictHeading.locator(
      "xpath=following-sibling::p",
    );
    await expect(description).toHaveText(
      "Ask a follow-up question, or ask it to act. Everyone on this incident sees this conversation.",
    );
    expect(await textLook(description)).toEqual(
      await textLook(verdictDescription),
    );

    /*
     * The title starts at the card's left edge, where the steps' marks do:
     * the conversation follows both steps rather than sitting in one, and
     * there is no icon tile in front of it.
     */
    const headingBox: Box = await documentBox(heading);
    const sectionBox: Box = await documentBox(section);
    const markBox: Box = await documentBox(
      page.getByTestId("ai-card-step-investigation-mark"),
    );
    expect(headingBox.x).toBeCloseTo(sectionBox.x, 0);
    expect(headingBox.x).toBeCloseTo(markBox.x, 0);
    await expect(heading.locator("xpath=..").locator("svg")).toHaveCount(0);
  });

  test("each step's status pill sits on its title's line and ends at the edge the card's content ends at", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const investigation: Locator = investigationCard(page);
    const section: Box = await documentBox(conversation(page));

    // The default header: the card's title and description, no pill.
    await expect(investigation.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "default",
    );
    await expect(
      investigation.getByTestId("card-header").getByLabel(/status$/),
    ).toHaveCount(0);

    for (const step of STEP_TITLES_AND_PILLS) {
      const pill: Box = await documentBox(
        page.getByTestId(step.testId).getByLabel(step.pill, { exact: true }),
      );
      const title: Box = await documentBox(stepTitle(page, step));
      // Beside the step's title, on its line.
      expect(pill.y, step.title).toBeLessThan(title.y + title.height);
      expect(pill.x, step.title).toBeGreaterThan(title.x + title.width);
      // At the card's content edge, where the hairlines end.
      expect(pill.x + pill.width, step.title).toBeCloseTo(
        section.x + section.width,
        0,
      );
    }
  });

  test.describe("what it suggests", () => {
    const CASES: ReadonlyArray<{
      name: string;
      query: string;
      description: string;
      labels: ReadonlyArray<string>;
    }> = [
      {
        name: "under a report it offers follow-ups",
        query: "state=created",
        description:
          "Ask a follow-up question, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
      },
      {
        name: "with nothing investigated it leads with the root-cause question",
        query: "ai=none&state=created",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: [ROOT_CAUSE_SUGGESTION, ...USUAL_SUGGESTIONS],
      },
      {
        name: "after a run that stopped it leads with the root-cause question",
        query: "ai=failed&state=created",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: [ROOT_CAUSE_SUGGESTION, ...USUAL_SUGGESTIONS],
      },
      {
        name: "while a run is investigating it does not",
        query: "ai=running&state=created",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
      },
      {
        name: "while a run is queued it does not",
        query: "ai=queued&state=created",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
      },
      {
        name: "while the report is being written it does not",
        query: "ai=pending&state=created",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
      },
      /*
       * Where the incident stands: one acknowledged is not asked to be
       * acknowledged again, and a resolved one (the fixture's own) is asked
       * how the response went and what would stop it coming back.
       */
      {
        name: "an acknowledged incident is not asked to be acknowledged again",
        query: "state=ongoing",
        description:
          "Ask a follow-up question, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS.filter((label: string): boolean => {
          return label !== "Acknowledge this incident";
        }),
      },
      {
        name: "a resolved incident is asked how the response went and what would stop it coming back",
        query: "",
        description:
          "Ask a follow-up question, or ask it to act. Everyone on this incident sees this conversation.",
        labels: RESOLVED_SUGGESTIONS,
      },
      {
        name: "a resolved incident with nothing investigated still leads with the root-cause question",
        query: "ai=none",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: [ROOT_CAUSE_SUGGESTION, ...RESOLVED_SUGGESTIONS],
      },
    ];

    for (const scenario of CASES) {
      test(scenario.name, async ({ page }: { page: Page }) => {
        const section: Locator = await openConversation(page, scenario.query);

        await expect(suggestions(page)).toHaveText([...scenario.labels]);
        await expect(
          section
            .getByRole("heading", { level: 3 })
            .locator("xpath=following-sibling::p"),
        ).toHaveText(scenario.description);
      });
    }

    test("the suggestions are plain chips straight above the composer", async ({
      page,
    }: {
      page: Page;
    }) => {
      // A new incident, so its one request to act is offered.
      const section: Locator = await openConversation(
        page,
        "ai=none&state=created",
      );
      const group: Locator = section.getByRole("group", {
        name: "Suggested questions",
      });

      // The sentence that only said the thread was empty is gone.
      await expect(section).not.toContainText("Nobody has asked anything yet");
      await expectAbove(group, composerFrame(page), "chips above the box");
      const groupBox: Box = await documentBox(group);
      const frameBox: Box = await documentBox(composerFrame(page));
      expect(frameBox.y - (groupBox.y + groupBox.height)).toBeLessThanOrEqual(
        20,
      );

      // Only the request to act carries a mark.
      const marked: Array<string> = await suggestions(page).evaluateAll(
        (chips: Array<Element>): Array<string> => {
          return chips
            .filter((chip: Element): boolean => {
              return chip.querySelector("svg") !== null;
            })
            .map((chip: Element): string => {
              return chip.textContent || "";
            });
        },
      );
      expect(marked).toEqual(["Acknowledge this incident"]);

      // White pills on a hairline: no shadow under them.
      for (const chip of await suggestions(page).all()) {
        const look: FrameLook = await frameLook(chip);
        expect(look.background).toBe("rgb(255, 255, 255)");
        expect(look.borders).toEqual(["1px", "1px", "1px", "1px"]);
        expect(look.shadow).toBe("none");
      }
    });
  });

  test.describe("asking", () => {
    test("a suggested question is asked on the click, answered live and cited", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(page, "ai=none");

      await suggestions(page)
        .filter({ hasText: ROOT_CAUSE_SUGGESTION })
        .click();

      // The question is in the thread at once, as the viewer's.
      await expect(questions(page)).toHaveCount(1);
      await expect(questions(page).first()).toContainText("You");
      await expect(questions(page).first()).toContainText(
        "What is the most likely root cause of this incident? Investigate it and cite the evidence.",
      );

      const sent: Array<RecordedApiRequest> = await apiRequestsTo(
        page,
        "/ai-investigation/conversation/send-message",
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toEqual({
        subjectType: "incident",
        subjectId: INCIDENT_ID,
        content:
          "What is the most likely root cause of this incident? Investigate it and cite the evidence.",
        permissionMode: "AutoRun",
      });

      // While it is written: a status line, Stop instead of Send.
      const answer: Locator = answers(page).first();
      await expect(answer.getByRole("status")).toHaveText(
        "OneUptime AI is working on your question…",
      );
      await expect(stopButton(page)).toBeVisible();
      await expect(sendButton(page)).toHaveCount(0);
      await expect(composerBox(page)).toHaveAttribute(
        "placeholder",
        WORKING_PLACEHOLDER,
      );
      // The suggestions leave once someone has asked.
      await expect(suggestions(page)).toHaveCount(0);

      // Then the answer, its citation and its source.
      await expect(answer).toContainText(SENT_ANSWER, { timeout: 20000 });
      await expect(answer).toHaveAttribute("data-status", "Completed");
      await expect(
        answer.getByRole("button", {
          name: "Citation C1: Monitors attached to checkout-api, right now",
        }),
      ).toBeVisible();
      await expect(sources(answer)).toHaveText([
        "C1Monitors attached to checkout-api, right now · 2 rows",
      ]);
      await expect(answer.getByRole("status")).toHaveCount(0);
      await expect(sendButton(page)).toBeVisible();
      await expect(stopButton(page)).toHaveCount(0);
      await expect(
        section.getByLabel("1 person has asked in this conversation"),
      ).toBeVisible();
      // Still one card.
      await expect(
        page.getByTestId("card").filter({ has: section }),
      ).toHaveCount(1);
    });

    test("a suggested action is put in the composer, never sent on the click", async ({
      page,
    }: {
      page: Page;
    }) => {
      // A new incident: nobody has acknowledged it yet.
      await openConversation(page, "state=created");

      await suggestions(page)
        .filter({ hasText: "Acknowledge this incident" })
        .click();

      await expect(composerBox(page)).toHaveValue("Acknowledge this incident.");
      await expect(sendButton(page)).toBeEnabled();
      await expect(questions(page)).toHaveCount(0);
      expect(
        await apiRequestsTo(
          page,
          "/ai-investigation/conversation/send-message",
        ),
      ).toEqual([]);
    });

    test("typing: Enter sends, Shift+Enter is a new line, and nothing is sent while an answer is written", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "");
      const box: Locator = composerBox(page);

      await expect(sendButton(page)).toBeDisabled();
      await box.click();
      await page.keyboard.type("Which deploy changed");
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.type("DB_POOL_MAX?");

      await expect(box).toHaveValue("Which deploy changed\nDB_POOL_MAX?");
      expect(
        await apiRequestsTo(
          page,
          "/ai-investigation/conversation/send-message",
        ),
      ).toEqual([]);
      await expect(sendButton(page)).toBeEnabled();

      await page.keyboard.press("Enter");

      await expect(box).toHaveValue("");
      await expect(questions(page).first()).toContainText(
        "Which deploy changed",
      );
      // Focus stays in the box for the next question.
      await expect(box).toBeFocused();

      // Typing goes on; sending waits for the answer.
      await expect(stopButton(page)).toBeVisible();
      await page.keyboard.type("And who shipped it?");
      await page.keyboard.press("Enter");
      await expect(box).toHaveValue("And who shipped it?");
      expect(
        await apiRequestsTo(
          page,
          "/ai-investigation/conversation/send-message",
        ),
      ).toHaveLength(1);

      // Once it is answered the next one goes.
      await expect(answers(page).first()).toHaveAttribute(
        "data-status",
        "Completed",
        { timeout: 20000 },
      );
      await expect(sendButton(page)).toBeEnabled();
      await page.keyboard.press("Enter");
      await expect(questions(page)).toHaveCount(2);
      await expect(questions(page).nth(1)).toContainText("And who shipped it?");
      await expect(answers(page).nth(1)).toHaveAttribute(
        "data-status",
        "Completed",
        { timeout: 20000 },
      );
    });

    test("an answer being written can be stopped", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=working");
      const answer: Locator = answers(page).last();

      await expect(answer.getByRole("status")).toHaveText(
        "OneUptime AI is working on Sam Rivera's question…",
      );
      await stopButton(page).click();

      const cancelled: Array<RecordedApiRequest> = await apiRequestsTo(
        page,
        "/ai-investigation/conversation/cancel-run",
      );
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]!.body).toEqual({
        subjectType: "incident",
        subjectId: INCIDENT_ID,
      });
      await expect(answer).toHaveAttribute("data-status", "Cancelled");
      await expect(answer).toContainText(
        "Stopped before the answer was finished.",
      );
      await expect(answer.getByRole("status")).toHaveCount(0);
      await expect(
        answer.getByTestId("investigation-conversation-live-steps"),
      ).toHaveCount(0);
      await expect(sendButton(page)).toBeVisible();
    });

    test("?fail=conversation-send says why in a notice that can be put away", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(
        page,
        "fail=conversation-send",
      );

      await composerBox(page).fill("What changed?");
      await sendButton(page).click();

      const notice: Locator = section.getByTestId(
        "investigation-conversation-error",
      );
      await expect(notice).toHaveAttribute("role", "alert");
      await expect(notice).toContainText(
        "AI is turned off for this project. Turn it on in Project Settings → AI → AI Features, then ask again.",
      );
      // A line with a red mark: it was a red box.
      expect(await frameLook(notice)).toEqual(NO_FRAME);
      await expect(notice.locator("svg").first()).toBeVisible();
      await expectAbove(notice, composerFrame(page), "notice above the box");
      // What was typed is handed back, and nothing was added to the thread.
      await expect(composerBox(page)).toHaveValue("What changed?");
      await expect(questions(page)).toHaveCount(0);
      expect(await panelsInsideTheCard(page)).toEqual([]);

      await notice.getByRole("button", { name: "Dismiss" }).click();

      await expect(notice).toHaveCount(0);
      await expect(composerBox(page)).toHaveValue("What changed?");
    });

    test("?fail=conversation says the thread could not be loaded, and can retry", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(
        page,
        "fail=conversation",
      );

      await expect(section).toContainText(
        "Could not load the conversation: The conversation service is unavailable.",
      );
      await expect(suggestions(page)).toHaveCount(0);
      // The composer stays: the card still ends with it.
      await expect(composerBox(page)).toBeEnabled();

      const before: number = (
        await apiRequestsTo(page, "/ai-investigation/conversation")
      ).length;
      await section.getByRole("button", { name: "Try again" }).click();
      await expect
        .poll(async (): Promise<number> => {
          return (await apiRequestsTo(page, "/ai-investigation/conversation"))
            .length;
        })
        .toBeGreaterThan(before);
    });
  });

  test.describe("a shared thread", () => {
    test("?thread=answered shows who asked what and whom each answer was for", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(page, "thread=answered");

      await expect(questions(page)).toHaveCount(2);
      await expect(answers(page)).toHaveCount(2);
      await expect(questions(page).nth(0)).toContainText("Sam Rivera");
      await expect(questions(page).nth(0)).toContainText(
        "Is anything else affected by this incident?",
      );
      await expect(questions(page).nth(1)).toContainText("You");
      await expect(questions(page).nth(1)).toContainText(
        "Acknowledge this incident and tell me who is on call for checkout.",
      );
      // An answer to someone else says whose it is; the viewer's own does not.
      await expect(answers(page).nth(0)).toContainText("to Sam Rivera");
      await expect(answers(page).nth(1)).not.toContainText("to Maya Chen");
      // When each was said, against the page's pinned clock.
      await expect(questions(page).nth(0).locator("time")).toHaveText(
        "9 minutes ago",
      );
      await expect(answers(page).nth(0).locator("time")).toHaveText(
        "8 minutes ago",
      );

      await expect(
        section.getByLabel("2 people have asked in this conversation"),
      ).toHaveAttribute("title", "Sam Rivera, You");
      // An answered thread has no suggestions.
      await expect(suggestions(page)).toHaveCount(0);
    });

    test("an answer lists its sources, and one with a page of its own opens it", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=answered");
      const answer: Locator = answers(page).first();

      await expect(
        answer.getByRole("heading", { level: 4, name: "Sources" }),
      ).toBeVisible();
      await expect(sources(answer)).toHaveText([
        "C1db.client.connections.usage for orders-db, 17:30 – 18:15 UTC · 45 rows",
        'C2Logs matching "timeout acquiring connection" in cart-api · no rows',
        "C3Monitors attached to checkout-api, cart-api and orders-db · 4 rows",
      ]);

      // A quiet list: no pill around a source.
      for (const row of await sources(answer).all()) {
        expect(await frameLook(row)).toEqual(NO_FRAME);
        expect(await frameLook(row.locator(":scope > *").first())).toEqual(
          NO_FRAME,
        );
      }

      // Two have a page (metrics, logs); the third is a plain line.
      await expect(sources(answer).nth(0).getByRole("button")).toHaveCount(1);
      await expect(sources(answer).nth(1).getByRole("button")).toHaveAttribute(
        "title",
        'Logs matching "timeout acquiring connection" in cart-api — checked, found nothing',
      );
      await expect(sources(answer).nth(2).getByRole("button")).toHaveCount(0);

      await sources(answer).nth(0).getByRole("button").click();
      await expect(page.getByTestId("stub-page")).toHaveAttribute(
        "data-page",
        "METRICS",
      );

      // Back on the incident the thread is still there.
      await page.goBack();
      await expect(answers(page)).toHaveCount(2, { timeout: 30000 });
    });

    test("a citation in the answer's text opens the same evidence", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=answered");
      const answer: Locator = answers(page).first();
      const chip: Locator = answer.getByRole("button", {
        name: 'Citation C2: Logs matching "timeout acquiring connection" in cart-api',
      });

      await expect(chip).toHaveText("C2");
      // Evidence with no page of its own is a chip, never a dead button.
      await expect(
        answer.getByLabel(
          "Citation C3: Monitors attached to checkout-api, cart-api and orders-db",
        ),
      ).toHaveJSProperty("tagName", "SPAN");

      await chip.click();
      await expect(page.getByTestId("stub-page")).toHaveAttribute(
        "data-page",
        "LOGS",
      );
    });

    test("charts and tables are shown to the person who asked, as a figure of the answer", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=answered");

      // Sam's answer comes without its rows; the viewer's own has them.
      await expect(
        answers(page)
          .nth(0)
          .getByRole("group", { name: "Data from this answer" }),
      ).toHaveCount(0);
      const figure: Locator = answers(page)
        .nth(1)
        .getByRole("group", { name: "Data from this answer" });
      await expect(figure).toContainText("Checkout on-call — current shift");
      await expect(figure).toContainText("Jordan Patel");
      await expect(figure).toContainText("Alex Kim");
    });

    test("an action that ran is a line of the answer, and the answer can be copied", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.addInitScript((): void => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text: string): Promise<void> => {
              (window as unknown as { __copiedText?: string }).__copiedText =
                text;
            },
          },
        });
      });
      await openConversation(page, "thread=answered");
      const answer: Locator = answers(page).nth(1);
      const actions: Locator = answer.getByRole("list", { name: "Actions" });

      await expect(actions.getByRole("listitem")).toHaveText([
        "Acknowledge incident #1042 · Done",
      ]);
      await expect(actions.getByRole("listitem")).toHaveAttribute(
        "data-status",
        "Executed",
      );
      // A line with a mark: no bordered row, no chip, nothing to press.
      expect(await frameLook(actions.getByRole("listitem"))).toEqual(NO_FRAME);
      await expect(actions.getByRole("button")).toHaveCount(0);
      await expect(
        answer.getByRole("group", { name: "Actions waiting for approval" }),
      ).toHaveCount(0);

      await answer.getByRole("button", { name: "Copy" }).click();
      await expect(
        answer.getByRole("button", { name: "Copied" }),
      ).toBeVisible();
      expect(
        await page.evaluate((): string => {
          return (
            (window as unknown as { __copiedText?: string }).__copiedText || ""
          );
        }),
      ).toBe(
        "Done — incident #1042 is acknowledged. **Jordan Patel** is on call for Checkout on-call until 20:00 UTC [C1].",
      );
    });

    test("?thread=working narrates the answer being written on a rule, with no box", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=working");
      const answer: Locator = answers(page).last();
      const steps: Locator = answer.getByTestId(
        "investigation-conversation-live-steps",
      );

      await expect(answer).toContainText("to Sam Rivera");
      await expect(steps).toContainText("Checking recent changes");
      await expect(steps).toContainText("Searching logs");
      expect(await frameLook(steps)).toEqual({
        background: "rgba(0, 0, 0, 0)",
        borders: ["0px", "0px", "0px", "2px"],
        shadow: "none",
      });
      await expectAbove(
        answer.getByRole("status"),
        steps,
        "what it is doing, then the steps",
      );
      await expect(composerBox(page)).toHaveAttribute(
        "placeholder",
        WORKING_PLACEHOLDER,
      );
      // The earlier, finished answer narrates nothing.
      await expect(
        answers(page)
          .first()
          .getByTestId("investigation-conversation-live-steps"),
      ).toHaveCount(0);
    });

    test("?thread=error says what went wrong in lines, not boxes", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=error");
      const failed: Locator = answers(page).nth(0);
      const stopped: Locator = answers(page).nth(1);
      const failure: Locator = failed.getByTestId(
        "investigation-conversation-answer-error",
      );

      await expect(failed).toHaveAttribute("data-status", "Error");
      await expect(failure).toHaveText(
        "The LLM provider returned 529 Overloaded three times. Nothing was changed.Ask again to retry.",
      );
      expect(await frameLook(failure)).toEqual(NO_FRAME);
      // The mark carries the colour (red-600).
      expect(
        await failure.locator("svg").evaluate((icon: Element): string => {
          return window.getComputedStyle(icon).color;
        }),
      ).toBe("rgb(220, 38, 38)");

      await expect(stopped).toHaveAttribute("data-status", "Cancelled");
      await expect(stopped).toContainText(
        "Stopped before the answer was finished.",
      );
      // The stop mark is a circle with a square in it, not an empty ring.
      expect(
        await stopped
          .locator("svg path")
          .last()
          .evaluate((mark: Element): number => {
            return (mark.getAttribute("d") || "").split("Z").length - 1;
          }),
      ).toBe(2);
      // Neither answer can be copied or has sources.
      await expect(
        conversation(page).getByRole("button", { name: "Copy" }),
      ).toHaveCount(0);
      // A thread whose last answer failed can be asked again.
      await expect(sendButton(page)).toBeVisible();
    });
  });

  test.describe("an action waiting for approval", () => {
    test("?thread=approval asks for a decision, and running it settles into a line", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=approval");
      const answer: Locator = answers(page).first();
      const prompt: Locator = answer.getByRole("group", {
        name: "Actions waiting for approval",
      });

      await expect(answer).toContainText(
        "I'd like to take this action. Review it and approve to continue.",
      );
      await expect(prompt).toContainText("The AI wants to perform 1 action");
      await expect(prompt).toContainText("Acknowledge incident #1042");
      // Nothing settled yet, and an answer is in flight.
      await expect(answer.getByRole("list", { name: "Actions" })).toHaveCount(
        0,
      );
      await expect(stopButton(page)).toBeVisible();

      await prompt.getByRole("button", { name: /Run 1 action/ }).click();

      const decisions: Array<RecordedApiRequest> = await apiRequestsTo(
        page,
        "/ai-investigation/conversation/respond-to-approval",
      );
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.body["subjectType"]).toBe("incident");
      expect(decisions[0]!.body["subjectId"]).toBe(INCIDENT_ID);
      expect(decisions[0]!.body["decisions"]).toEqual([
        { toolCallId: "call_acknowledge", approved: true },
      ]);

      await expect(answer).toContainText(
        "Done — incident #1042 is acknowledged.",
      );
      await expect(prompt).toHaveCount(0);
      await expect(
        answer.getByRole("list", { name: "Actions" }).getByRole("listitem"),
      ).toHaveText(["Acknowledge incident #1042 · Done"]);
      await expect(sendButton(page)).toBeVisible();
    });

    test("denying it leaves the incident alone and says so", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=approval");
      const answer: Locator = answers(page).first();

      await answer.getByRole("button", { name: "Deny all" }).click();

      const decisions: Array<RecordedApiRequest> = await apiRequestsTo(
        page,
        "/ai-investigation/conversation/respond-to-approval",
      );
      expect(decisions[0]!.body["decisions"]).toEqual([
        { toolCallId: "call_acknowledge", approved: false },
      ]);
      await expect(answer).toContainText(
        "Okay — I left incident #1042 as it is.",
      );
      const line: Locator = answer
        .getByRole("list", { name: "Actions" })
        .getByRole("listitem");
      await expect(line).toHaveText(["Acknowledge incident #1042 · Denied"]);
      await expect(line).toHaveAttribute("data-status", "Denied");
    });
  });

  test.describe("a long thread", () => {
    test("?thread=crowded opens on its newest messages, with the rest one click away", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(page, "thread=crowded");

      // Twelve messages: the last three exchanges show.
      await expect(showEarlier(page)).toHaveText("Show 6 earlier messages");
      await expect(questions(page)).toHaveCount(3);
      await expect(answers(page)).toHaveCount(3);
      await expect(questions(page).first()).toContainText("Alex Kim");
      await expectAbove(showEarlier(page), thread(page), "the fold on top");

      // Everyone who asked is counted, folded messages included.
      const participants: Locator = section.getByLabel(
        "6 people have asked in this conversation",
      );
      await expect(participants).toHaveAttribute(
        "title",
        "Sam Rivera, You, Jordan Patel, Alex Kim, Priya Nair, Diego Santos",
      );
      await expect(participants).toContainText("+2");

      await showEarlier(page).focus();
      await page.keyboard.press("Enter");

      await expect(questions(page)).toHaveCount(6);
      await expect(answers(page)).toHaveCount(6);
      await expect(questions(page).first()).toContainText("Sam Rivera");
      await expect(showEarlier(page)).toHaveCount(0);
      // The pressed button is gone, so the thread it revealed takes focus.
      await expect(thread(page)).toBeFocused();
    });

    test("no avatar hides the next one's initials", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(page, "thread=crowded");
      const marks: Array<Box> = [];

      for (const mark of await section
        .getByLabel("6 people have asked in this conversation")
        .locator(":scope > div > div")
        .all()) {
        marks.push(await documentBox(mark));
      }

      expect(marks).toHaveLength(4);
      for (let index: number = 1; index < marks.length; index++) {
        const overlap: number =
          marks[index - 1]!.x + marks[index - 1]!.width - marks[index]!.x;
        // They used to overlap by 8px of a 24px disc, over the second letter.
        expect(overlap).toBeGreaterThan(0);
        expect(overlap).toBeLessThanOrEqual(4);
      }
    });

    test("the thread is part of the page, not a scrolling box inside the card", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "thread=crowded");
      await showEarlier(page).click();
      await expect(answers(page)).toHaveCount(6);

      // Nothing between the thread and the card clips or scrolls it.
      const clippers: Array<string> = await thread(page).evaluate(
        (log: Element): Array<string> => {
          const found: Array<string> = [];
          let element: Element | null = log;

          while (element && element.getAttribute("data-testid") !== "card") {
            const style: CSSStyleDeclaration = window.getComputedStyle(element);

            if (
              style.overflowY !== "visible" ||
              style.maxHeight !== "none" ||
              element.scrollHeight > element.clientHeight + 1
            ) {
              found.push(
                `${element.tagName.toLowerCase()}.${element.getAttribute("class")}`,
              );
            }

            element = element.parentElement;
          }

          return found;
        },
      );
      expect(clippers).toEqual([]);

      // It is as tall as its twelve messages: taller than the 640px box it had.
      expect((await documentBox(thread(page))).height).toBeGreaterThan(640);
      // And every message can be reached by scrolling the page alone.
      await questions(page).first().scrollIntoViewIfNeeded();
      await expect(questions(page).first()).toBeInViewport();
    });
  });

  test.describe("the composer", () => {
    test("is one framed control: the text, the mode with what it means, and Send", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "");
      const frame: Locator = composerFrame(page);

      // The dashboard's input frame: white, a gray-300 hairline all round.
      const look: {
        background: string;
        border: string;
        widths: Array<string>;
      } = await frame.evaluate(
        (
          element: Element,
        ): { background: string; border: string; widths: Array<string> } => {
          const style: CSSStyleDeclaration = window.getComputedStyle(element);
          return {
            background: style.backgroundColor,
            border: style.borderTopColor,
            widths: [
              style.borderTopWidth,
              style.borderRightWidth,
              style.borderBottomWidth,
              style.borderLeftWidth,
            ],
          };
        },
      );
      expect(look).toEqual({
        background: "rgb(255, 255, 255)",
        border: "rgb(209, 213, 219)",
        widths: ["1px", "1px", "1px", "1px"],
      });

      // Everything it needs is inside that frame (one layout: documentBoxes).
      const [frameBox, ...partBoxes]: Array<Box> = await documentBoxes(page, [
        frame,
        composerBox(page),
        modePicker(page),
        modeCaption(page),
        sendButton(page),
      ]);
      for (const box of partBoxes) {
        expect(box.x).toBeGreaterThanOrEqual(frameBox!.x);
        expect(box.x + box.width).toBeLessThanOrEqual(
          frameBox!.x + frameBox!.width,
        );
        expect(box.y).toBeGreaterThanOrEqual(frameBox!.y);
        expect(box.y + box.height).toBeLessThanOrEqual(
          frameBox!.y + frameBox!.height,
        );
      }

      await expect(composerBox(page)).toHaveAttribute(
        "placeholder",
        "Ask about this incident, or ask OneUptime AI to act…",
      );
      await expect(modePicker(page)).toHaveText("Auto-run");
      await expect(modeCaption(page)).toHaveText(
        "Acts on clear requests right away, within your permissions.",
      );

      // One row under the text: the picker, its caption, then Send at the end.
      const [picker, caption, send]: Array<Box> = await documentBoxes(page, [
        modePicker(page),
        modeCaption(page),
        sendButton(page),
      ]);
      expect(caption!.x).toBeGreaterThan(picker!.x + picker!.width);
      expect(send!.x).toBeGreaterThan(caption!.x + caption!.width - 1);
      expect(
        Math.abs(picker!.y + picker!.height / 2 - (send!.y + send!.height / 2)),
      ).toBeLessThanOrEqual(3);
      // The caption fits on one line of the row.
      expect(caption!.height).toBeLessThanOrEqual(22);
    });

    test("does not take focus when the page loads, and shows an indigo focus when used", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "");

      expect(
        await page.evaluate((): string => {
          return document.activeElement?.tagName || "";
        }),
      ).toBe("BODY");
      expect(
        await page.evaluate((): number => {
          return window.scrollY;
        }),
      ).toBe(0);

      await composerBox(page).click();

      await expect
        .poll(async (): Promise<string> => {
          return composerFrame(page).evaluate((element: Element): string => {
            return window.getComputedStyle(element).borderTopColor;
          });
        })
        .toBe("rgb(99, 102, 241)");
      // And a 1px ring of the same indigo round it, once it has faded in.
      await expect
        .poll(async (): Promise<string> => {
          return composerFrame(page).evaluate((element: Element): string => {
            return window.getComputedStyle(element).boxShadow;
          });
        })
        .toContain("rgb(99, 102, 241) 0px 0px 0px 1px");
    });

    test("Send lights up in the page's primary colour once there is something to send", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "");
      const background: () => Promise<string> = async (): Promise<string> => {
        return sendButton(page).evaluate((button: Element): string => {
          return window.getComputedStyle(button).backgroundColor;
        });
      };

      await expect(sendButton(page)).toBeDisabled();
      expect(await background()).toBe("rgb(243, 244, 246)");

      await composerBox(page).fill("What changed?");

      await expect(sendButton(page)).toBeEnabled();
      await expect.poll(background).toBe(INDIGO_600);
    });

    for (const width of [1440, 390]) {
      test(`the mode's menu opens inside the card at ${width}px`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openConversation(page, "ai=none");
        const cardBox: Box = await documentBox(
          investigationCard(page).locator(":scope > div").first(),
        );

        await modePicker(page).click();
        const menu: Locator = conversation(page).getByRole("menu", {
          name: "AI permissions",
        });
        await expect(menu).toBeVisible();
        await expect(modePicker(page)).toHaveAttribute("aria-expanded", "true");

        // It used to open some 150px past the card's left edge.
        const menuBox: Box = await documentBox(menu);
        const picker: Box = await documentBox(modePicker(page));
        expect(menuBox.x).toBeGreaterThanOrEqual(cardBox.x);
        expect(menuBox.x).toBeCloseTo(picker.x, 0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
        // Above the picker, not over it.
        expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(picker.y);

        await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
        await expect(
          menu.getByRole("menuitemradio", { checked: true }),
        ).toContainText("Auto-run");

        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(modePicker(page)).toBeFocused();
        await expectNoHorizontalOverflow(page);
      });
    }

    test("a chosen mode changes the caption and what the next question is sent with", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "");

      await modePicker(page).click();
      await conversation(page)
        .getByRole("menuitemradio", { name: /^Read-only/ })
        .click();

      await expect(modePicker(page)).toHaveText("Read-only");
      await expect(modeCaption(page)).toHaveText(
        "Only reads and answers. It never changes anything.",
      );
      await expect(conversation(page).getByRole("menu")).toHaveCount(0);

      await composerBox(page).fill("What changed?");
      await sendButton(page).click();

      await expect
        .poll(async (): Promise<Array<unknown>> => {
          return (
            await apiRequestsTo(
              page,
              "/ai-investigation/conversation/send-message",
            )
          ).map((request: RecordedApiRequest): unknown => {
            return request.body["permissionMode"];
          });
        })
        .toEqual(["ReadOnly"]);
      await expect(answers(page).first()).toHaveAttribute(
        "data-status",
        "Completed",
        { timeout: 20000 },
      );
    });

    test("with production's font the caption keeps to the picker's row in the two-thirds column of a 1280px page", async ({
      page,
    }: {
      page: Page;
    }) => {
      /*
       * Whether the caption fits beside the picker depends on the glyphs'
       * width. The fixture falls back to the system font, which is wider
       * than the Inter the dashboard ships, so this one test loads Inter the
       * way views/index.ejs declares it.
       */
      await page.route(
        "**/dashboard/assets/fonts/InterVariable.woff2",
        async (route: PlaywrightRoute) => {
          await route.fulfill({ path: INTER_FONT_FILE });
        },
      );
      await page.setViewportSize({ width: 1280, height: 900 });
      await openConversation(page, "");
      await page.addStyleTag({
        content:
          '@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/dashboard/assets/fonts/InterVariable.woff2) format("woff2")} *{font-family:Inter,ui-sans-serif,system-ui,sans-serif}',
      });
      expect(
        await page.evaluate(async (): Promise<number> => {
          return (await document.fonts.load("500 12px Inter")).length;
        }),
        "Inter loaded",
      ).toBeGreaterThan(0);

      const picker: Box = await documentBox(modePicker(page));
      const caption: Box = await documentBox(modeCaption(page));
      const send: Box = await documentBox(sendButton(page));

      for (const mode of ["Ask to act", "Read-only", "Auto-run"]) {
        await modePicker(page).click();
        await conversation(page)
          .getByRole("menuitemradio", { name: new RegExp(`^${mode}`) })
          .click();

        const fitted: Box = await documentBox(modeCaption(page));
        // One line of 12px text, between the picker and Send.
        expect(fitted.height, `${mode} caption height`).toBeLessThanOrEqual(22);
        expect(fitted.x).toBeGreaterThan(picker.x);
        expect(fitted.x + fitted.width).toBeLessThanOrEqual(send.x);
      }

      expect(caption.x).toBeGreaterThan(picker.x + picker.width);
    });
  });

  test.describe("no panel inside the card, whatever the thread holds", () => {
    const THREAD_STATES: ReadonlyArray<{ name: string; query: string }> = [
      { name: "an answered thread under a report", query: "thread=answered" },
      {
        name: "an answered thread with nothing investigated",
        query: "ai=none&thread=answered",
      },
      { name: "an answer being written", query: "thread=working" },
      { name: "a failed and a stopped answer", query: "thread=error" },
      { name: "a long thread", query: "ai=running&thread=crowded" },
      { name: "an action waiting for approval", query: "thread=approval" },
    ];

    for (const state of THREAD_STATES) {
      test(`${state.name} draws no panel`, async ({ page }: { page: Page }) => {
        await openConversation(page, state.query);

        /*
         * Two things keep a frame on purpose, each a named group: a chart or
         * table (a figure, framed wherever it is drawn) and an action waiting
         * for someone to approve it (the one place the card raises its voice).
         */
        expect(await panelsInsideTheCard(page)).toEqual([]);
        await expect(investigationCard(page).getByTestId("card")).toHaveCount(
          0,
        );
      });
    }

    test("the fix pull request and verdict messages are lines of their rows", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(
        page,
        INCIDENT_PAGE,
        "codefix=act&fail=verdict,create-fix-task",
      );
      const investigation: Locator = investigationCard(page);

      await remediationStep(page)
        .getByRole("button", { name: OPEN_FIX_PR })
        .click();
      await investigation.getByRole("button", { name: "Confirmed" }).click();

      const fixError: Locator = remediationStep(page).getByTestId(
        "remediation-code-fix-error",
      );
      const verdictError: Locator = investigation.getByTestId(
        "investigation-verdict-error",
      );
      await expect(fixError).toContainText("Could not open the pull request");
      await expect(verdictError).toContainText("Could not save your verdict");

      // They were red alert boxes, the loudest things in the card.
      for (const notice of [fixError, verdictError]) {
        await expect(notice).toHaveAttribute("role", "alert");
        expect(await frameLook(notice)).toEqual(NO_FRAME);
      }
      expect(await panelsInsideTheCard(page)).toEqual([]);
    });

    test("a pull request asked for is a line with a mark and a link to its progress", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE, "codefix=act");
      const codeFix: Locator = remediationStep(page).getByTestId(
        "remediation-code-fix",
      );

      await codeFix.getByRole("button", { name: OPEN_FIX_PR }).click();

      await expect(codeFix).toHaveAttribute("data-offer", "InProgress");
      await expect(codeFix).toContainText(
        "A pull request that fixes the code is being written.",
      );
      expect(await frameLook(codeFix)).toEqual(NO_FRAME);
      // indigo-600: on its way, like a decision line that waits.
      expect(
        await codeFix
          .locator("svg")
          .first()
          .evaluate((icon: Element): string => {
            return window.getComputedStyle(icon).color;
          }),
      ).toBe("rgb(79, 70, 229)");
      await expect(
        codeFix.getByRole("link", { name: "View progress" }),
      ).toHaveAttribute("href", new RegExp(`${FIX_TASK_ID}$`));
      expect(await panelsInsideTheCard(page)).toEqual([]);
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the card with a thread does not scroll sideways, and a message's text takes the full width", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(page, "thread=answered");
      await expectNoHorizontalOverflow(page);

      const answer: Locator = answers(page).first();
      const mark: Box = await documentBox(
        answer.locator(":scope > div").nth(0),
      );
      const byline: Box = await documentBox(
        answer.locator(":scope > div").nth(1),
      );
      const body: Box = await documentBox(
        answer.locator(":scope > div").nth(2),
      );
      const sectionBox: Box = await documentBox(section);

      // Who and when sit beside the mark; what was said starts under it.
      expect(byline.x).toBeGreaterThan(mark.x + mark.width);
      expect(body.y).toBeGreaterThanOrEqual(mark.y + mark.height);
      expect(body.x).toBeCloseTo(sectionBox.x, 0);
      expect(body.width).toBeCloseTo(sectionBox.width, 0);
    });

    test("the composer keeps the picker and Send on one row, with the caption under them", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "ai=none");

      const picker: Box = await documentBox(modePicker(page));
      const send: Box = await documentBox(sendButton(page));
      const caption: Box = await documentBox(modeCaption(page));
      const frame: Box = await documentBox(composerFrame(page));

      expect(send.x).toBeGreaterThan(picker.x + picker.width);
      expect(
        Math.abs(picker.y + picker.height / 2 - (send.y + send.height / 2)),
      ).toBeLessThanOrEqual(3);
      expect(caption.y).toBeGreaterThanOrEqual(
        Math.max(picker.y + picker.height, send.y + send.height) - 1,
      );
      expect(caption.y + caption.height).toBeLessThanOrEqual(
        frame.y + frame.height,
      );
      // A keyboard hint is no use on a phone.
      await expect(conversation(page).getByText("to send")).toBeHidden();
      await expectNoHorizontalOverflow(page);
    });

    test("the status pill sits beside the title when it fits and under it, at the right edge, when it does not", async ({
      page,
    }: {
      page: Page;
    }) => {
      // "Completed" fits beside the Investigation step's title.
      let investigation: Locator = await openCardState(page, CARD_STATES[0]!);
      let title: Box = await documentBox(
        stepTitle(page, STEP_TITLES_AND_PILLS[0]!),
      );
      let pill: Box = await documentBox(
        investigation.getByLabel("Investigation status"),
      );
      let section: Box = await documentBox(conversation(page));

      // One line: the title's 28px line, level with the step's mark.
      expect(title.height).toBeLessThanOrEqual(28);
      expect(pill.x).toBeGreaterThan(title.x + title.width);
      expect(pill.y).toBeLessThan(title.y + title.height);
      // At the card's content edge, not centred under the title.
      expect(pill.x + pill.width).toBeCloseTo(section.x + section.width, 0);

      /*
       * "Preparing report…" may not: then it goes under the title - still at
       * the card's right edge, as every card header's actions do - and never
       * to the left or the middle.
       */
      investigation = await openCardState(page, CARD_STATES[7]!);
      title = await documentBox(stepTitle(page, STEP_TITLES_AND_PILLS[0]!));
      pill = await documentBox(
        investigation.getByLabel("Investigation status"),
      );
      section = await documentBox(conversation(page));

      // The title is never the one that gives way.
      expect(title.height).toBeLessThanOrEqual(28);
      expect(pill.x + pill.width).toBeCloseTo(section.x + section.width, 0);
      if (pill.y >= title.y + title.height) {
        expect(pill.x).toBeGreaterThan(title.x);
      } else {
        expect(pill.x).toBeGreaterThan(title.x + title.width);
      }
      await expectNoHorizontalOverflow(page);
    });
  });

  test("from sm up a message's text lines up under its author's name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConversation(page, "thread=answered");
    const answer: Locator = answers(page).first();
    const mark: Box = await documentBox(answer.locator(":scope > div").nth(0));
    const byline: Box = await documentBox(
      answer.locator(":scope > div").nth(1),
    );
    const body: Box = await documentBox(answer.locator(":scope > div").nth(2));

    expect(mark.width).toBeCloseTo(32, 0);
    expect(byline.x).toBeCloseTo(mark.x + mark.width + 12, 0);
    expect(body.x).toBeCloseTo(byline.x, 0);
    // The text starts straight under the name, beside the mark.
    expect(body.y).toBeLessThan(mark.y + mark.height);
    expect(body.y).toBeGreaterThanOrEqual(byline.y + byline.height - 1);
  });

  test.describe("in the dark theme", () => {
    test("the conversation uses the card's dark colours", async ({
      page,
    }: {
      page: Page;
    }) => {
      const section: Locator = await openConversation(
        page,
        "theme=dark&thread=answered",
      );

      // Light text on the dark card.
      expect(
        (
          await textLook(
            section.getByRole("heading", {
              level: 3,
              name: CONVERSATION_TITLE,
            }),
          )
        ).color,
      ).toBe("rgb(248, 250, 252)");

      // The composer is the card's surface with a slate frame, not a white box.
      const composer: { background: string; border: string } =
        await composerFrame(page).evaluate(
          (element: Element): { background: string; border: string } => {
            const style: CSSStyleDeclaration = window.getComputedStyle(element);
            return {
              background: style.backgroundColor,
              border: style.borderTopColor,
            };
          },
        );
      expect(composer).toEqual({
        background: "rgb(23, 32, 51)",
        border: "rgb(100, 116, 139)",
      });

      // OneUptime AI's mark stays the solid indigo sparkle.
      expect(
        await answers(page)
          .first()
          .locator("[aria-hidden='true']")
          .first()
          .evaluate((mark: Element): string => {
            return window.getComputedStyle(mark).backgroundColor;
          }),
      ).toBe(INDIGO_600);

      // The hairline above the section is a dark rule.
      expect(
        await section.evaluate((element: Element): string => {
          return window.getComputedStyle(element).borderTopColor;
        }),
      ).toBe("rgb(71, 85, 105)");
    });

    test("no responder's avatar stays a pale disc", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openConversation(page, "theme=dark&thread=crowded");
      await showEarlier(page).click();
      await expect(questions(page)).toHaveCount(6);

      const grounds: Array<string> = await questions(page).evaluateAll(
        (items: Array<Element>): Array<string> => {
          return items.map((item: Element): string => {
            return window.getComputedStyle(
              item.querySelector("[aria-hidden='true']") as Element,
            ).backgroundColor;
          });
        },
      );

      expect(grounds).toHaveLength(6);
      for (const ground of grounds) {
        /*
         * Every tone's dark rule is a translucent wash of its hue. A tone
         * without one (lime was) keeps an opaque pastel: rgb(...), no alpha.
         */
        expect(ground).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d+\)$/);
      }
    });
  });

  test("moving to another incident never brings the previous thread along", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "thread=answered");
    await expect(questions(page)).toHaveCount(2);
    await composerBox(page).fill("A question for #1042 only");

    await referenceLink(summarySection(page), "#1017").click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Checkout API p95 latency above 2s",
    );
    await expect(page).toHaveURL(new RegExp(`${incidentPath(1017)}`));
    // #1017 was never investigated and nobody has asked about it.
    await expect(
      investigationCard(page).getByLabel("Investigation status"),
    ).toHaveText("Not investigated", { timeout: 30000 });
    await expect(questions(page)).toHaveCount(0);
    await expect(composerBox(page)).toHaveValue("");
    await expect(suggestions(page).first()).toHaveText(ROOT_CAUSE_SUGGESTION);
    await expect(investigationCard(page)).toHaveCount(1);

    await page.goBack();

    await expect(questions(page)).toHaveCount(2, { timeout: 30000 });
  });
});

/*
 * ---------------------------------------------------------------------------
 * The AI card as one line, when AI was off for the record (?ai=off-*)
 * ---------------------------------------------------------------------------
 * "When AI investigation and remediation are off, can we please collapse
 * this card into one simple line that says, 'AI investigation is off.
 * Here's why.' ... Then you can expand that card to see what more you can
 * do to enable AI." - the maintainer.
 *
 * When OneUptime AI neither investigated nor fixed the record because
 * something was off for it - automatic investigation (?ai=off-switch),
 * Enable AI (off-project), the AI rules (off-rules) or the minimum severity
 * (off-severity), with fixing off beside it (?fixing=) - the AI card is one
 * line: what is off and why, Ask OneUptime AI while AI is on, and a chevron
 * that opens what to turn on, where, and who can. The Remediation step
 * leaves saying why nothing was fixed to it. When fixing did something
 * (?fixing=acted), the card stays whole, with both its steps.
 */

const AI_OFF_TITLE: string = "AI investigation is off";
// Once what would have the next one investigated is on now.
const AI_WAS_OFF_TITLE: string = "AI investigation was off";
const PROJECT_AI_OFF_TITLE: string = "AI is off for this project";
// The chevron's name, and its tooltip: what it opens.
const WHAT_YOU_CAN_DO: string = "What you can do";
const INCIDENT_AI_SETTINGS_HREF: string = `${DASHBOARD}/incidents/ai/settings`;
const ALERT_AI_SETTINGS_HREF: string = `${DASHBOARD}/alerts/ai/settings`;
const AI_FEATURES_HREF: string = `${DASHBOARD}/settings/ai-features`;
// What opens ends with this: none of it reaches back to the record.
const INCIDENT_NOTE_WITH_ASK: string =
  "This applies to new incidents only, not to this one. You can still ask OneUptime AI about it.";
const INCIDENT_NOTE_AI_OFF: string =
  "This applies to new incidents only, not to this one.";
const WHO_CAN_CHANGE_INCIDENT_SETTINGS: string =
  "A project owner or admin can make these changes in Incidents → AI → Settings.";
const WHO_CAN_CHANGE_INCIDENT_RULES: string =
  "A project owner or admin, or someone who may edit AI rules, can change them in Incidents → AI → Settings.";
const WHO_CAN_TURN_AI_ON: string =
  "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI → AI Features.";

interface AiOffStepRow {
  step: string | null;
  done: string | null;
  text: string;
}

interface AiOffLinkRow {
  text: string;
  href: string | null;
}

function aiOffLine(page: Page): Locator {
  return page.getByTestId("ai-off-summary");
}

// The AI card, folded: the line is its header and all it shows at rest.
function aiOffCard(page: Page): Locator {
  return page.getByTestId("card").filter({ has: aiOffLine(page) });
}

function aiOffTitle(page: Page): Locator {
  return aiOffLine(page).getByTestId("ai-off-summary-title");
}

function aiOffReason(page: Page): Locator {
  return aiOffLine(page).getByTestId("ai-off-summary-reason");
}

function aiOffToggle(page: Page): Locator {
  return aiOffLine(page).getByRole("button", {
    name: WHAT_YOU_CAN_DO,
    exact: true,
  });
}

function aiOffAsk(page: Page): Locator {
  return aiOffLine(page).getByRole("button", {
    name: CONVERSATION_TITLE,
    exact: true,
  });
}

function aiOffStepsPanel(page: Page): Locator {
  return aiOffLine(page).getByTestId("ai-off-summary-steps");
}

/*
 * What OneUptime AI is doing to fix the record: the AI card's second step
 * (block 43), which was a card of its own far down the page.
 */
function remediationCard(page: Page): Locator {
  return remediationStep(page);
}

async function openAiOffLine(
  page: Page,
  pagePath: string,
  query: string,
  title: string = AI_OFF_TITLE,
): Promise<Locator> {
  await open(page, pagePath, query);
  await expect(aiOffLine(page).getByRole("heading", { level: 2 })).toHaveText(
    title,
    { timeout: 30000 },
  );
  // What happened sits above the card: measure only once it stops moving.
  await expectWhatHappenedSettled(page);
  return aiOffLine(page);
}

async function openAiOffSteps(page: Page): Promise<Locator> {
  await aiOffToggle(page).click();
  const steps: Locator = aiOffStepsPanel(page);
  await expect(steps).toBeVisible();
  return steps;
}

async function aiOffStepRows(page: Page): Promise<Array<AiOffStepRow>> {
  return aiOffLine(page)
    .getByTestId("ai-off-summary-step")
    .evaluateAll((items: Array<Element>): Array<AiOffStepRow> => {
      return items.map((item: Element): AiOffStepRow => {
        return {
          step: item.getAttribute("data-step"),
          done: item.getAttribute("data-done"),
          text: (item.textContent || "").trim(),
        };
      });
    });
}

async function aiOffLinkRows(page: Page): Promise<Array<AiOffLinkRow>> {
  return aiOffLine(page)
    .getByTestId("ai-off-summary-links")
    .getByRole("link")
    .evaluateAll((links: Array<Element>): Array<AiOffLinkRow> => {
      return links.map((link: Element): AiOffLinkRow => {
        return {
          text: (link.textContent || "").trim(),
          href: link.getAttribute("href"),
        };
      });
    });
}

function aiOffStep(
  key: string,
  text: string,
  isDone: boolean = false,
): AiOffStepRow {
  return { step: key, done: isDone ? "true" : "false", text };
}

// WCAG's relative luminance of an rgb()/rgba() colour, its alpha left out.
function relativeLuminance(color: string): number {
  const channels: Array<number> = (color.match(/[\d.]+/g) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const first: number = relativeLuminance(foreground);
  const second: number = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

interface AiOffLineLook {
  // The surface the line is drawn on: the card's.
  surface: string;
  mark: string;
  texts: Array<{ name: string; color: string }>;
}

// The colours of the line and what it opened, and of the card under them.
async function aiOffLineLook(page: Page): Promise<AiOffLineLook> {
  return aiOffLine(page).evaluate((line: Element): AiOffLineLook => {
    const zeroAlpha: RegExp = /rgba\([^)]*,\s*0\)$/;
    let surface: string = "";
    let ancestor: Element | null = line;

    while (ancestor && !surface) {
      const background: string =
        window.getComputedStyle(ancestor).backgroundColor;

      if (background !== "transparent" && !zeroAlpha.test(background)) {
        surface = background;
      }

      ancestor = ancestor.parentElement;
    }

    const colorOf: (selector: string) => string = (
      selector: string,
    ): string => {
      const element: Element | null = line.querySelector(selector);
      return element ? window.getComputedStyle(element).color : "";
    };
    const mark: Element | null = line.querySelector(
      "[data-testid='ai-off-summary-mark']",
    );

    return {
      surface,
      mark: mark ? window.getComputedStyle(mark).backgroundColor : "",
      texts: [
        { name: "title", selector: "[data-testid='ai-off-summary-title']" },
        { name: "reason", selector: "[data-testid='ai-off-summary-reason']" },
        { name: "step", selector: "[data-testid='ai-off-summary-step'] p" },
        { name: "link", selector: "[data-testid='ai-off-summary-links'] a" },
        { name: "note", selector: "[data-testid='ai-off-summary-note']" },
        { name: "ask", selector: "[data-testid='ai-off-summary-ask']" },
      ].map(
        (entry: {
          name: string;
          selector: string;
        }): { name: string; color: string } => {
          return { name: entry.name, color: colorOf(entry.selector) };
        },
      ),
    };
  });
}

interface AiOffCase {
  name: string;
  query: string;
  title: string;
  reason: string;
  steps: Array<AiOffStepRow>;
  links: Array<AiOffLinkRow>;
  // Whether the line offers Ask OneUptime AI: only while AI is on.
  hasAsk: boolean;
  note: string;
}

const AI_OFF_CASES: ReadonlyArray<AiOffCase> = [
  {
    name: "automatic investigation was off when it was created (?ai=off-switch)",
    query: "ai=off-switch",
    title: AI_OFF_TITLE,
    reason:
      "“Investigate new incidents” was off when this incident was created.",
    steps: [
      aiOffStep("investigate-switch", "Turn on “Investigate new incidents”."),
      aiOffStep("fix-switch", "Turn on “Fix new incidents automatically”."),
    ],
    // Both switches are on one page: one link.
    links: [{ text: "Incident AI settings", href: INCIDENT_AI_SETTINGS_HREF }],
    hasAsk: true,
    note: INCIDENT_NOTE_WITH_ASK,
  },
  {
    name: "AI is off for the project (?ai=off-project)",
    query: "ai=off-project",
    title: PROJECT_AI_OFF_TITLE,
    reason: "OneUptime AI did not investigate or fix this incident.",
    steps: [
      aiOffStep("enable-ai", "Turn on “Enable AI”."),
      aiOffStep("investigate-switch", "Turn on “Investigate new incidents”."),
      aiOffStep("fix-switch", "Turn on “Fix new incidents automatically”."),
    ],
    links: [
      { text: "AI Features", href: AI_FEATURES_HREF },
      { text: "Incident AI settings", href: INCIDENT_AI_SETTINGS_HREF },
    ],
    hasAsk: false,
    note: INCIDENT_NOTE_AI_OFF,
  },
  {
    name: "it matched none of the AI rules that investigate (?ai=off-rules)",
    query: "ai=off-rules",
    title: AI_OFF_TITLE,
    reason: "This incident matched none of the AI rules that investigate.",
    // A rule that matches it investigates it and can fix it: one step.
    steps: [
      aiOffStep(
        "investigate-rules",
        "Add or change an AI rule so it matches incidents like this one.",
      ),
    ],
    links: [
      {
        text: "Incident AI rules",
        href: `${INCIDENT_AI_SETTINGS_HREF}#AiRules`,
      },
    ],
    hasAsk: true,
    note: INCIDENT_NOTE_WITH_ASK,
  },
  {
    name: "its severity was below the minimum (?ai=off-severity)",
    query: "ai=off-severity",
    title: AI_OFF_TITLE,
    reason:
      "This incident's severity was below the minimum for AI investigation.",
    steps: [
      aiOffStep(
        "minimum-severity",
        "Lower or clear the minimum severity for AI investigation.",
      ),
      aiOffStep("fix-switch", "Turn on “Fix new incidents automatically”."),
    ],
    // The minimum severity's card by its own name, then the page's switches.
    links: [
      {
        text: "Which incidents are investigated",
        href: `${INCIDENT_AI_SETTINGS_HREF}#WhichAreInvestigated`,
      },
      { text: "Incident AI settings", href: INCIDENT_AI_SETTINGS_HREF },
    ],
    hasAsk: true,
    note: INCIDENT_NOTE_WITH_ASK,
  },
];

test.describe("the AI card as one line when AI was off for the record (?ai=off-*)", () => {
  for (const scenario of AI_OFF_CASES) {
    test(`${scenario.name}: one line says what is off and why, closed`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAiOffLine(page, INCIDENT_PATH, scenario.query, scenario.title);

      await expect(aiOffReason(page)).toHaveText(scenario.reason);
      await expect(aiOffToggle(page)).toHaveAttribute("aria-expanded", "false");
      await expect(aiOffToggle(page)).toHaveAttribute("title", WHAT_YOU_CAN_DO);
      await expect(aiOffStepsPanel(page)).toBeHidden();
      await expect(aiOffAsk(page)).toHaveCount(scenario.hasAsk ? 1 : 0);

      // One AI card, folded: no header, pill or anything the full card shows.
      await expect(aiOffCard(page)).toHaveCount(1);
      await expect(investigationCard(page)).toHaveCount(0);
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: "OneUptime AI",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.getByLabel("Investigation status")).toHaveCount(0);
      await expect(page.getByLabel("Remediation status")).toHaveCount(0);
      await expect(page.getByTestId("investigation-not-started")).toHaveCount(
        0,
      );
      await expect(
        aiOffCard(page).getByRole("heading", {
          level: 3,
          name: WHAT_YOU_CAN_DO,
        }),
      ).toHaveCount(0);
      // Nobody has asked: no conversation until someone does.
      await expect(conversation(page)).toHaveCount(0);
      // The line says why nothing was fixed: no Remediation step.
      await expect(remediationCard(page)).toHaveCount(0);
      // Nothing in the header says AI is working on it.
      await expect(
        hero(page).getByRole("button", { name: "View full report" }),
      ).toHaveCount(0);
      // The region the header points at, settled, and no panel inside it.
      await expect(
        aiOffCard(page).locator("#ai-investigation"),
      ).toHaveAttribute("aria-busy", "false");
      await expect(aiOffCard(page).getByTestId("card")).toHaveCount(0);
      expect(await panelsInsideTheCard(page)).toEqual([]);
    });

    test(`${scenario.name}: its chevron opens what to turn on and where, and that it does not reach back`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openAiOffLine(page, INCIDENT_PATH, scenario.query, scenario.title);

      const steps: Locator = await openAiOffSteps(page);
      await expect(aiOffToggle(page)).toHaveAttribute("aria-expanded", "true");
      // The chevron names what it opens.
      expect(
        await steps.evaluate((element: Element): string => {
          return element.id;
        }),
      ).toBe(await aiOffToggle(page).getAttribute("aria-controls"));

      expect(await aiOffStepRows(page)).toEqual(scenario.steps);
      expect(await aiOffLinkRows(page)).toEqual(scenario.links);
      // A Project Owner may make every change: nobody to ask.
      await expect(steps.getByTestId("ai-off-summary-who")).toHaveCount(0);
      await expect(steps.getByTestId("ai-off-summary-note")).toHaveText(
        scenario.note,
      );
      // The line keeps saying what is off and why above it.
      await expect(aiOffTitle(page)).toHaveText(scenario.title);
      await expect(aiOffReason(page)).toHaveText(scenario.reason);
      expect(await panelsInsideTheCard(page)).toEqual([]);

      // And it closes again.
      await aiOffToggle(page).click();
      await expect(steps).toBeHidden();
      await expect(aiOffToggle(page)).toHaveAttribute("aria-expanded", "false");
    });
  }

  test("the chevron opens and closes from the keyboard, its focus ring kept", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch");

    await aiOffToggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(aiOffStepsPanel(page)).toBeVisible();
    await expect(aiOffToggle(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(aiOffStepsPanel(page)).toBeHidden();
    await expect(aiOffToggle(page)).toHaveAttribute("aria-expanded", "false");

    /*
     * The chevron is the line's first control and Ask OneUptime AI its
     * next, in the order the eye meets them on every width: Tab goes from
     * the chevron to Ask, and Shift+Tab back.
     */
    await aiOffToggle(page).focus();
    await page.keyboard.press("Tab");
    await expect(aiOffAsk(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(aiOffToggle(page)).toBeFocused();
  });

  /*
   * The changes made in one place go together, with that place's link
   * under them: "Turn on Enable AI" over AI Features, the two switches over
   * the incident's AI settings - not every link in a row at the end, for
   * the reader to match to the steps.
   */
  for (const width of [1280, 390]) {
    test(`at ${width}px each place's link sits under the steps made there, lined up with their words (?ai=off-project)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAiOffLine(
        page,
        INCIDENT_PATH,
        "ai=off-project",
        PROJECT_AI_OFF_TITLE,
      );
      await openAiOffSteps(page);

      const groups: Locator = aiOffLine(page).getByTestId(
        "ai-off-summary-group",
      );
      await expect(groups).toHaveCount(2);
      const stepWords: (key: string) => Locator = (key: string): Locator => {
        return aiOffLine(page).locator(
          `[data-testid='ai-off-summary-step'][data-step='${key}'] p`,
        );
      };

      const enableAi: Box = await documentBox(stepWords("enable-ai"));
      const aiFeatures: Box = await documentBox(
        groups.nth(0).getByRole("link", { name: "AI Features" }),
      );
      const investigate: Box = await documentBox(
        stepWords("investigate-switch"),
      );
      const fix: Box = await documentBox(stepWords("fix-switch"));
      const settings: Box = await documentBox(
        groups.nth(1).getByRole("link", { name: "Incident AI settings" }),
      );

      // In reading order: Enable AI, its page, the two switches, theirs.
      expect(aiFeatures.y).toBeGreaterThanOrEqual(
        enableAi.y + enableAi.height - 1,
      );
      expect(investigate.y).toBeGreaterThanOrEqual(
        aiFeatures.y + aiFeatures.height,
      );
      expect(fix.y).toBeGreaterThanOrEqual(investigate.y + investigate.height);
      expect(settings.y).toBeGreaterThanOrEqual(fix.y + fix.height - 1);
      // Each link starts where the words of its steps do.
      expect(Math.abs(aiFeatures.x - enableAi.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(settings.x - fix.x)).toBeLessThanOrEqual(1);
      /*
       * A group stands apart from the next: more room between groups than
       * between the two switches in one.
       */
      expect(
        investigate.y - (aiFeatures.y + aiFeatures.height),
      ).toBeGreaterThan(fix.y - (investigate.y + investigate.height));
      await expectNoHorizontalOverflow(page);
    });
  }

  test("a click on what is off or on why opens it too, as a folded section's header does; Ask OneUptime AI does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch");

    await aiOffTitle(page).click();
    await expect(aiOffStepsPanel(page)).toBeVisible();
    await expect(aiOffToggle(page)).toHaveAttribute("aria-expanded", "true");

    await aiOffReason(page).click();
    await expect(aiOffStepsPanel(page)).toBeHidden();
    await expect(aiOffToggle(page)).toHaveAttribute("aria-expanded", "false");

    // The pointer says the line opens.
    expect(
      await aiOffTitle(page).evaluate((element: Element): string => {
        return window.getComputedStyle(element).cursor;
      }),
    ).toBe("pointer");

    await aiOffAsk(page).click();
    await expect(composerBox(page)).toBeFocused();
    await expect(aiOffStepsPanel(page)).toBeHidden();
  });

  test("someone who may not change the switches is told who can, with no links (?role=member)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch&role=member");

    const steps: Locator = await openAiOffSteps(page);
    expect(await aiOffStepRows(page)).toEqual(AI_OFF_CASES[0]!.steps);
    await expect(steps.getByTestId("ai-off-summary-links")).toHaveCount(0);
    await expect(steps.getByRole("link")).toHaveCount(0);
    // Once, for both switches.
    await expect(
      steps.getByTestId("ai-off-summary-who").locator("p"),
    ).toHaveText([WHO_CAN_CHANGE_INCIDENT_SETTINGS]);
    await expect(steps.getByTestId("ai-off-summary-note")).toHaveText(
      INCIDENT_NOTE_WITH_ASK,
    );
  });

  test("someone who may not edit AI rules is told who can (?ai=off-rules&role=member)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-rules&role=member");

    const steps: Locator = await openAiOffSteps(page);
    await expect(steps.getByRole("link")).toHaveCount(0);
    await expect(
      steps.getByTestId("ai-off-summary-who").locator("p"),
    ).toHaveText([WHO_CAN_CHANGE_INCIDENT_RULES]);
  });

  test("someone who may not turn AI on is told who can, for Enable AI and for the switches (?ai=off-project&role=member)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(
      page,
      INCIDENT_PATH,
      "ai=off-project&role=member",
      PROJECT_AI_OFF_TITLE,
    );

    const steps: Locator = await openAiOffSteps(page);
    await expect(steps.getByRole("link")).toHaveCount(0);
    await expect(
      steps.getByTestId("ai-off-summary-who").locator("p"),
    ).toHaveText([WHO_CAN_TURN_AI_ON, WHO_CAN_CHANGE_INCIDENT_SETTINGS]);
    await expect(steps.getByTestId("ai-off-summary-note")).toHaveText(
      INCIDENT_NOTE_AI_OFF,
    );
  });

  test("switches turned on since are said done, and the line says AI investigation was off for this incident (?switches=on)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(
      page,
      INCIDENT_PATH,
      "ai=off-switch&switches=on",
      AI_WAS_OFF_TITLE,
    );

    await expect(aiOffReason(page)).toHaveText(
      "“Investigate new incidents” was off when this incident was created.",
    );
    const steps: Locator = await openAiOffSteps(page);
    expect(await aiOffStepRows(page)).toEqual([
      aiOffStep(
        "investigate-switch",
        "“Investigate new incidents” is on now.",
        true,
      ),
      aiOffStep(
        "fix-switch",
        "“Fix new incidents automatically” is on now.",
        true,
      ),
    ]);
    // Nothing left to change: no link, nobody to ask.
    await expect(steps.getByTestId("ai-off-summary-links")).toHaveCount(0);
    await expect(steps.getByTestId("ai-off-summary-who")).toHaveCount(0);
    // And it still does not reach back.
    await expect(steps.getByTestId("ai-off-summary-note")).toHaveText(
      INCIDENT_NOTE_WITH_ASK,
    );
  });

  test("AI turned on for the project since: it was off when this incident was created, and Ask OneUptime AI is back (?ai=off-project&switches=on)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(
      page,
      INCIDENT_PATH,
      "ai=off-project&switches=on",
      AI_WAS_OFF_TITLE,
    );

    await expect(aiOffReason(page)).toHaveText(
      "AI was off for this project when this incident was created.",
    );
    await expect(aiOffAsk(page)).toBeVisible();
    await openAiOffSteps(page);
    expect(await aiOffStepRows(page)).toEqual([
      aiOffStep("enable-ai", "“Enable AI” is on now.", true),
    ]);
    expect(await aiOffLinkRows(page)).toEqual([]);
  });

  test("a reason read from today's settings, none recorded, says how things are now (?decided=now)", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [query, reason] of [
      ["ai=off-switch&decided=now", "“Investigate new incidents” is off."],
      [
        "ai=off-rules&decided=now",
        "This incident matches none of the AI rules that investigate.",
      ],
      [
        "ai=off-severity&decided=now",
        "This incident's severity is below the minimum for AI investigation.",
      ],
    ] as Array<[string, string]>) {
      await openAiOffLine(page, INCIDENT_PATH, query);
      await expect(aiOffReason(page)).toHaveText(reason);
    }
  });

  test("the one AI rule that matched only investigates: set it to fix too, on the same link (?ai=off-rules&fixing=rules-investigate)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(
      page,
      INCIDENT_PATH,
      "ai=off-rules&fixing=rules-investigate",
    );

    await openAiOffSteps(page);
    expect(await aiOffStepRows(page)).toEqual([
      aiOffStep(
        "investigate-rules",
        "Add or change an AI rule so it matches incidents like this one.",
      ),
      aiOffStep(
        "fix-rules",
        "Set AI rule “Checkout investigations” to fix too, or add a rule that does.",
      ),
    ]);
    expect(await aiOffLinkRows(page)).toEqual([
      {
        text: "Incident AI rules",
        href: `${INCIDENT_AI_SETTINGS_HREF}#AiRules`,
      },
    ]);
  });

  test("nothing recorded about fixing, as for an incident from before: still one line, asking only for the investigation (?fixing=none)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch&fixing=none");

    await openAiOffSteps(page);
    expect(await aiOffStepRows(page)).toEqual([
      aiOffStep("investigate-switch", "Turn on “Investigate new incidents”."),
    ]);
    await expect(remediationCard(page)).toHaveCount(0);
  });

  test("when fixing did something, both cards stay whole (?fixing=acted)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=off-switch&fixing=acted");

    const investigation: Locator = investigationCard(page);
    await expect(investigation.getByLabel("Investigation status")).toHaveText(
      "Not investigated",
      { timeout: 30000 },
    );
    await expect(remediationCard(page)).toBeVisible({ timeout: 30000 });
    await expect(remediationCard(page)).toContainText("prod-eu-west-1");
    await expect(
      investigation.getByRole("heading", {
        level: 3,
        name: "Automatic incident investigation was off at creation",
      }),
    ).toBeVisible();
    // The full card, closed by its conversation, and no line.
    await expect(
      investigation.getByTestId("investigation-conversation"),
    ).toHaveCount(1);
    await expect(aiOffLine(page)).toHaveCount(0);
  });

  test("Ask OneUptime AI on the line opens the conversation in the same card, its box focused, and the line stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch");
    await expect(conversation(page)).toHaveCount(0);

    await aiOffAsk(page).click();

    await expect(
      conversation(page).getByRole("heading", {
        level: 3,
        name: CONVERSATION_TITLE,
      }),
    ).toBeVisible();
    await expect(composerBox(page)).toBeFocused();
    // In the folded card, under the line, which no longer offers it.
    await expect(
      aiOffCard(page).getByTestId("investigation-conversation"),
    ).toHaveCount(1);
    await expect(aiOffAsk(page)).toHaveCount(0);
    await expect(aiOffTitle(page)).toHaveText(AI_OFF_TITLE);
    await expectAbove(
      aiOffLine(page),
      conversation(page),
      "the conversation opens under the line",
    );
    await expect(suggestions(page).first()).toHaveText(ROOT_CAUSE_SUGGESTION);

    // A question being typed survives opening and closing the fold.
    await composerBox(page).fill("Why was this incident not investigated?");
    await openAiOffSteps(page);
    await aiOffToggle(page).click();
    await expect(composerBox(page)).toHaveValue(
      "Why was this incident not investigated?",
    );
    expect(await panelsInsideTheCard(page)).toEqual([]);
  });

  test("a conversation someone already started shows under the line by itself, with no Ask on the line (?thread=answered)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch&thread=answered");

    await expect(questions(page)).toHaveCount(2, { timeout: 30000 });
    await expect(aiOffAsk(page)).toHaveCount(0);
    await expect(
      aiOffCard(page).getByTestId("investigation-conversation"),
    ).toHaveCount(1);
    await expectAbove(
      aiOffLine(page),
      conversation(page),
      "the thread runs under the line",
    );
    await expect(remediationCard(page)).toHaveCount(0);
  });

  test("the alert page folds its AI card the same way, in an alert's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, ALERT_PATH, "ai=off-switch");

    await expect(aiOffReason(page)).toHaveText(
      "“Investigate new alerts” was off when this alert was created.",
    );
    await expect(aiOffAsk(page)).toBeVisible();
    const steps: Locator = await openAiOffSteps(page);
    expect(await aiOffStepRows(page)).toEqual([
      aiOffStep("investigate-switch", "Turn on “Investigate new alerts”."),
      aiOffStep("fix-switch", "Turn on “Fix new alerts automatically”."),
    ]);
    expect(await aiOffLinkRows(page)).toEqual([
      { text: "Alert AI settings", href: ALERT_AI_SETTINGS_HREF },
    ]);
    await expect(steps.getByTestId("ai-off-summary-note")).toHaveText(
      "This applies to new alerts only, not to this one. You can still ask OneUptime AI about it.",
    );
    await expect(remediationCard(page)).toHaveCount(0);
    await expect(investigationCard(page)).toHaveCount(0);
    expect(await panelsInsideTheCard(page)).toEqual([]);
  });

  test("an alert that matched none of the AI rules links to the alert AI rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openAiOffLine(page, ALERT_PATH, "ai=off-rules");

    await expect(aiOffReason(page)).toHaveText(
      "This alert matched none of the AI rules that investigate.",
    );
    await openAiOffSteps(page);
    expect(await aiOffLinkRows(page)).toEqual([
      { text: "Alert AI rules", href: `${ALERT_AI_SETTINGS_HREF}#AiRules` },
    ]);
  });

  test("an episode has no AI card to fold", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_EPISODE_PAGE, "ai=off-switch");

    await expect(aiOffLine(page)).toHaveCount(0);
    await expect(investigationCard(page)).toHaveCount(0);
  });

  /*
   * The same order on every width, the order Tab meets them: what is off
   * with the chevron at its end, why under it, and Ask OneUptime AI under
   * why - Ask no longer sits between the title and the chevron on a wide
   * card, before the chevron in tab order while a phone drew it last.
   */
  test("at 1280px what is off and the chevron share the first row, why runs under them, and Ask OneUptime AI under why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch");

    const title: Box = await documentBox(aiOffTitle(page));
    const ask: Box = await documentBox(aiOffAsk(page));
    const toggle: Box = await documentBox(aiOffToggle(page));
    const reason: Box = await documentBox(aiOffReason(page));
    const line: Box = await documentBox(aiOffLine(page));

    expect(Math.abs(centreOf(toggle) - centreOf(title))).toBeLessThanOrEqual(2);
    expect(toggle.x).toBeGreaterThan(title.x);
    // The chevron ends where the line does, as a card that opens has it.
    expect(line.x + line.width - (toggle.x + toggle.width)).toBeLessThanOrEqual(
      8,
    );
    // Why runs under them, from where the title starts.
    expect(reason.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
    expect(Math.abs(reason.x - title.x)).toBeLessThanOrEqual(1);
    // Ask follows why, its words lined up with why's.
    expect(ask.y).toBeGreaterThanOrEqual(reason.y + reason.height - 1);
    expect(
      Math.abs(
        (await documentBox(aiOffAsk(page).locator("svg").first())).x - reason.x,
      ),
    ).toBeLessThanOrEqual(1);
  });

  test("on a 390px phone the chevron keeps the title's row and Ask OneUptime AI follows why, nothing past the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-switch");

    const title: Box = await documentBox(aiOffTitle(page));
    const ask: Box = await documentBox(aiOffAsk(page));
    const toggle: Box = await documentBox(aiOffToggle(page));
    const reason: Box = await documentBox(aiOffReason(page));
    const cardBox: Box = await documentBox(aiOffCard(page));

    expect(Math.abs(centreOf(toggle) - centreOf(title))).toBeLessThanOrEqual(2);
    expect(toggle.x).toBeGreaterThan(title.x);
    // Ask comes after why, its words lined up with why's.
    expect(ask.y).toBeGreaterThanOrEqual(reason.y + reason.height - 1);
    expect(
      Math.abs(
        (await documentBox(aiOffAsk(page).locator("svg").first())).x - reason.x,
      ),
    ).toBeLessThanOrEqual(1);

    await openAiOffSteps(page);
    for (const part of [
      title,
      ask,
      toggle,
      reason,
      await documentBox(aiOffStepsPanel(page)),
    ]) {
      expect(part.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(part.x + part.width).toBeLessThanOrEqual(
        cardBox.x + cardBox.width,
      );
    }
    await expectNoHorizontalOverflow(page);
  });

  /*
   * "Which incidents are investigated" wraps in a phone's card: its arrow
   * ends the name, on its last line right after its last word, rather than
   * sitting alone at the card's far edge.
   */
  test("on a 390px phone a link's arrow follows its last word, wherever the name wraps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAiOffLine(page, INCIDENT_PATH, "ai=off-severity");
    await openAiOffSteps(page);

    const links: Locator = aiOffLine(page)
      .getByTestId("ai-off-summary-links")
      .getByRole("link");
    await expect(links).toHaveCount(2);

    for (const index of [0, 1]) {
      const placement: { gap: number; onLastLine: boolean } = await links
        .nth(index)
        .evaluate((link: Element): { gap: number; onLastLine: boolean } => {
          // The name's own text, without the no-break space after it.
          const range: Range = document.createRange();
          range.selectNodeContents(link.firstChild as Node);
          const lines: Array<DOMRect> = Array.from(range.getClientRects());
          const last: DOMRect = lines[lines.length - 1] as DOMRect;
          const arrow: DOMRect = (
            link.querySelector(
              "[data-testid='ai-off-summary-link-arrow']",
            ) as Element
          ).getBoundingClientRect();

          return {
            gap: arrow.left - last.right,
            onLastLine: arrow.top < last.bottom && arrow.bottom > last.top,
          };
        });

      expect(placement.onLastLine).toBe(true);
      // Only the no-break space between them.
      expect(placement.gap).toBeGreaterThanOrEqual(0);
      expect(placement.gap).toBeLessThanOrEqual(8);
    }
  });

  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 390]) {
      test(`in the ${theme} theme at ${width}px every word on the line reads on the card, and the line draws no panel`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openAiOffLine(
          page,
          INCIDENT_PATH,
          `ai=off-severity${theme === "dark" ? "&theme=dark" : ""}`,
        );
        await screenshotElement(
          aiOffCard(page),
          `incident-ai-off-line-${width}-${theme}`,
        );

        await openAiOffSteps(page);
        const look: AiOffLineLook = await aiOffLineLook(page);
        const surfaceLuminance: number = relativeLuminance(look.surface);

        // The card's own surface: white, or the dark card.
        if (theme === "dark") {
          expect(surfaceLuminance).toBeLessThan(0.05);
          // The mark is a quiet tile on it, not a light square.
          expect(relativeLuminance(look.mark)).toBeLessThan(0.1);
        } else {
          expect(surfaceLuminance).toBeGreaterThan(0.9);
        }

        for (const text of look.texts) {
          expect({
            text: text.name,
            readable: contrastRatio(text.color, look.surface) >= 4.5,
          }).toEqual({ text: text.name, readable: true });
        }

        expect(await panelsInsideTheCard(page)).toEqual([]);
        await expectNoHorizontalOverflow(page);
        await screenshotElement(
          aiOffCard(page),
          `incident-ai-off-line-${width}-${theme}-open`,
        );
      });
    }
  }

  /*
   * "KI ist für dieses Projekt ausgeschaltet" takes two lines in a phone's
   * card: its lines stay close, and the chevron stays level with the first
   * one rather than dropping between them.
   */
  test("on a 390px phone a title that wraps keeps its lines close and its chevron level with its first line (?ai=off-project&lang=de)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAiOffLine(
      page,
      INCIDENT_PATH,
      "ai=off-project&lang=de",
      "KI ist für dieses Projekt ausgeschaltet",
    );

    const title: Box = await documentBox(aiOffTitle(page));
    const toggle: Locator = aiOffLine(page).getByRole("button", {
      name: "Was Sie tun können",
      exact: true,
    });
    const chevron: Box = await documentBox(toggle);
    const mark: Box = await documentBox(
      aiOffLine(page).getByTestId("ai-off-summary-mark"),
    );
    const lineHeight: string = await aiOffTitle(page).evaluate(
      (element: Element): string => {
        return window.getComputedStyle(element).lineHeight;
      },
    );

    // Two lines of 24px, inside the 2px above and under one.
    expect(lineHeight).toBe("24px");
    expect(title.height).toBeGreaterThanOrEqual(2 * 24);
    expect(title.height).toBeLessThanOrEqual(2 * 24 + 4 + 1);
    // The chevron and the mark start where the title does.
    expect(Math.abs(chevron.y - title.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(mark.y - title.y)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
  });

  for (const width of [1280, 390]) {
    test(`reads in German at ${width}px (?lang=de)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAiOffLine(
        page,
        INCIDENT_PATH,
        "ai=off-switch&lang=de",
        "KI-Untersuchung ist aus",
      );

      await expect(aiOffReason(page)).toHaveText(
        "„Neue Vorfälle untersuchen“ war ausgeschaltet, als dieser Vorfall erstellt wurde.",
      );
      const toggle: Locator = aiOffLine(page).getByRole("button", {
        name: "Was Sie tun können",
        exact: true,
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();

      expect(await aiOffStepRows(page)).toEqual([
        aiOffStep(
          "investigate-switch",
          "Schalten Sie „Neue Vorfälle untersuchen“ ein.",
        ),
        aiOffStep(
          "fix-switch",
          "Schalten Sie „Neue Vorfälle automatisch beheben“ ein.",
        ),
      ]);
      expect(await aiOffLinkRows(page)).toEqual([
        {
          text: "KI-Einstellungen für Vorfälle",
          href: INCIDENT_AI_SETTINGS_HREF,
        },
      ]);
      await expect(
        aiOffStepsPanel(page).getByTestId("ai-off-summary-note"),
      ).toHaveText(
        "Das gilt nur für neue Vorfälle, nicht für diesen. Sie können OneUptime AI trotzdem dazu befragen.",
      );

      await expectNoHorizontalOverflow(page);
      await screenshotElement(
        aiOffCard(page),
        `incident-ai-off-line-${width}-de-open`,
      );
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * Incident and alert overview
 * ---------------------------------------------------------------------------
 */

async function expectHero(page: Page, eventPage: EventPage): Promise<void> {
  const header: Locator = hero(page);
  await expect(header.getByRole("heading", { level: 2 })).toHaveText(
    eventPage.title,
  );
  await expect(header.getByTitle("Number", { exact: true })).toHaveText(
    eventPage.identifier,
  );
  await expectRenderedText(heroChips(page), eventPage.state);
  if (eventPage.severity) {
    await expectRenderedText(heroChips(page), eventPage.severity);
  }
  await expectHeroDuration(header, eventPage.duration);
  expect(await heroFacts(header)).toEqual(eventPage.facts);
}

async function expectRightColumn(
  page: Page,
  eventPage: EventPage,
): Promise<void> {
  const feed: Box = await documentBox(card(page, eventPage.feed));
  let previousBottom: number = -1;
  for (const heading of eventPage.rightColumn) {
    const rightCard: Locator = card(page, heading);
    await expect(rightCard).toBeVisible();
    const box: Box = await documentBox(rightCard);
    expect(box.x, `${heading} sits beside the feed`).toBeGreaterThanOrEqual(
      feed.x + feed.width,
    );
    expect(box.y, `${heading} order`).toBeGreaterThan(previousBottom);
    previousBottom = box.y + box.height - 1;

    /*
     * Narrow column: the title and what the card offers share the first
     * line, and the description runs under both, across the card's width.
     */
    await expect(rightCard.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
  }
  const details: Locator = card(page, eventPage.detailsCard);
  await expect(
    details
      .getByTestId("card-header-actions")
      .getByRole("button", { name: "Edit" }),
  ).toBeVisible();
  // "Why are edit buttons not on the right?" On the title's line, at the right.
  await expectHeaderActionsOnTheRight(
    details,
    `${eventPage.detailsCard}'s Edit`,
    { onTitleLine: true },
  );
  expect(await detailLabels(details)).toEqual(eventPage.detailLabels);

  /*
   * The record's ID is not a field of the card any more: it is the small
   * line the card ends with - "ID", the ID's first characters, and a copy
   * button - with the whole ID in its text, clipped in the narrow column.
   */
  const idLine: Locator = details.getByTestId("detail-id-line");
  const idValue: Locator = idLine.getByTestId("detail-id-value");
  await expect(idLine).toBeVisible();
  await expect(idLine.getByTestId("detail-id-label")).toHaveText("ID");
  await expect(idValue).toHaveText(eventPage.recordId);
  await expect(
    idLine.getByRole("button", { name: "Copy ID to clipboard" }),
  ).toBeVisible();
  const idWidths: { shown: number; whole: number } = await idValue.evaluate(
    (element: HTMLElement): { shown: number; whole: number } => {
      return { shown: element.clientWidth, whole: element.scrollWidth };
    },
  );
  expect(idWidths.shown, "the ID shows only its start").toBeLessThan(
    idWidths.whole,
  );
  expect(idWidths.shown, "about nine characters wide").toBeLessThan(90);
  await expectAbove(
    details.locator("label").last(),
    idLine,
    "the ID line ends the card",
  );

  /*
   * "Can you also show created along the same lines as ID so it doesn't
   * take space up top." When the record was created is not a row of the
   * card: it follows the ID on the same small line, and moves under the ID
   * - whole - only when the narrow column has no room for both.
   */
  const recordLine: Locator = details.getByTestId("detail-record-line");
  const created: Locator = recordLine.getByTestId("detail-created-at");
  await expect(recordLine).toContainText("ID");
  expect(await detailLabels(details)).not.toContain("Created At");
  if (!eventPage.recordCreated) {
    await expect(created).toHaveCount(0);
    return;
  }
  await expect(created.getByTestId("detail-created-at-label")).toHaveText(
    "Created",
  );
  await expect(created.getByTestId("detail-created-at-value")).toHaveText(
    eventPage.recordCreated,
  );
  const lineBox: Box = await documentBox(recordLine);
  const idBox: Box = await documentBox(idLine);
  const createdBox: Box = await documentBox(created);
  if (idBox.width + createdBox.width + 16 <= lineBox.width) {
    expect(
      Math.abs(
        createdBox.y + createdBox.height / 2 - (idBox.y + idBox.height / 2),
      ),
      "Created sits level with the ID when both fit",
    ).toBeLessThanOrEqual(2);
    expect(createdBox.x, "after the ID").toBeGreaterThan(idBox.x + idBox.width);
  } else {
    expect(createdBox.y, "under the ID, whole").toBeGreaterThanOrEqual(
      idBox.y + idBox.height - 1,
    );
    expect(
      Math.abs(createdBox.x - idBox.x),
      "flush with the ID",
    ).toBeLessThanOrEqual(1);
  }
  // Inside the card, under its last field.
  expect(createdBox.x + createdBox.width).toBeLessThanOrEqual(
    lineBox.x + lineBox.width + 1,
  );
  await expectAbove(
    details.locator("label").last(),
    created,
    "Created is on the line under the fields",
  );
}

test.describe("incident and alert overview", () => {
  for (const eventPage of [INCIDENT_PAGE, ALERT_PAGE]) {
    test(`${eventPage.name} hero shows identifier, title, state, severity and facts`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);
      await expect(sideMenu(page)).toBeVisible();
      await expectHero(page, eventPage);
      /*
       * Resolved: no forward state actions left. An alert still offers to
       * declare an incident from it; an incident has nothing.
       */
      const actions: Locator = heroActions(page);
      if (eventPage === ALERT_PAGE) {
        await expect(actions.getByRole("button")).toHaveText([
          DECLARE_INCIDENT,
        ]);
      } else {
        await expect(actions.getByRole("button")).toHaveCount(0);
        await expect(
          hero(page).getByRole("button", { name: DECLARE_INCIDENT }),
        ).toHaveCount(0);
        await expect(
          page.locator(`#${DECLARE_INCIDENT_BUTTON_ID}`),
        ).toHaveCount(0);
      }
      // The state track under the title.
      await expectRenderedText(
        hero(page).getByTestId("event-state-track"),
        "Created Acknowledged Resolved",
      );
      await expectNoErrorStates(page);
    });

    test(`${eventPage.name} stat bar sits under the hero with response times`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);
      expect(await statCells(page, eventPage.statBar)).toEqual(eventPage.stats);
      const statBar: Locator = page.getByRole("group", {
        name: eventPage.statBar,
      });
      await expectAbove(hero(page), statBar, "hero before stat bar");
      await expectAbove(
        statBar,
        investigationCard(page),
        "stat bar before the AI card",
      );
    });

    test(`${eventPage.name} leads with the AI report and keeps details in the right column`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);
      await expectAbove(
        investigationCard(page),
        card(page, eventPage.feed),
        "AI card before the feed",
      );
      const investigation: Box = await documentBox(investigationCard(page));
      const feed: Box = await documentBox(card(page, eventPage.feed));
      expect(Math.abs(investigation.x - feed.x)).toBeLessThanOrEqual(1);
      await expectRightColumn(page, eventPage);
    });

    test(`${eventPage.name} copies the whole ID from the details card's ID line`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.addInitScript((): void => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text: string): Promise<void> => {
              (window as unknown as { __copiedText?: string }).__copiedText =
                text;
            },
          },
        });
      });
      await openReady(page, eventPage);

      const idLine: Locator = card(page, eventPage.detailsCard).getByTestId(
        "detail-id-line",
      );
      const copiedText: () => Promise<string> = async (): Promise<string> => {
        return page.evaluate((): string => {
          return (
            (window as unknown as { __copiedText?: string }).__copiedText || ""
          );
        });
      };

      // Hovering the clipped ID shows all of it.
      await idLine.getByTestId("detail-id-value").hover();
      await expect(page.getByRole("tooltip")).toHaveText(eventPage.recordId);

      await idLine
        .getByRole("button", { name: "Copy ID to clipboard" })
        .click();
      await expect.poll(copiedText).toBe(eventPage.recordId);
      await expect(idLine.getByRole("status")).toHaveText(
        "Copied to clipboard",
      );
    });
  }

  test("alert-overview gives its creation time to the second on hover", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);

    const created: Locator = card(page, ALERT_PAGE.detailsCard).getByTestId(
      "detail-created-at-value",
    );

    await expect(created).toHaveText("Sep 14 2026, 06:06 PM GMT");
    await expect(created).toHaveAttribute(
      "datetime",
      "2026-09-14T18:06:00.000Z",
    );
    await created.hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "Sep 14 2026, 06:06:00 PM GMT",
    );
  });

  test("incident links in the hero facts open the monitors", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const facts: Locator = hero(page).getByTestId("event-status-facts");
    await expect(
      facts.getByRole("link", { name: "Checkout API p95 latency" }),
    ).toHaveAttribute("href", `${DASHBOARD}/monitors/${uuid("70000000", 1)}`);
    await expect(
      facts.getByRole("link", { name: "Orders DB connection pool" }),
    ).toHaveAttribute("href", `${DASHBOARD}/monitors/${uuid("70000000", 2)}`);
    await expect(
      card(page, "Incident Roles").getByText("Maya Chen").first(),
    ).toBeVisible();
  });

  test("alert hero links its monitor and episode", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);
    const facts: Locator = hero(page).getByTestId("event-status-facts");
    await expect(
      facts.getByRole("link", { name: "Payment webhook error rate" }),
    ).toHaveAttribute("href", `${DASHBOARD}/monitors/${uuid("70000000", 3)}`);
    const episode: Locator = facts.getByRole("link", {
      name: "Payment webhook failures — Sep 14",
    });
    await expect(episode).toHaveAttribute("href", ALERT_EPISODE_PATH);
    await episode.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      ALERT_EPISODE_PAGE.pageTitle,
    );
    await expect(hero(page)).toContainText("#7");
  });

  test("?state=ongoing: Resolve from the hero refreshes the incident in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=ongoing");

    const actions: Locator = page.getByRole("group", { name: "Event actions" });
    await expect(actions.getByRole("button")).toHaveText(["Resolve"]);
    await expectRenderedText(heroChips(page), "Acknowledged SEV-2");
    await expectHeroDuration(hero(page), "Ongoing for 19 minutes");
    // How long it has run is the header's, beside its state.
    expect(await statCells(page, INCIDENT_PAGE.statBar)).toEqual([
      INCIDENT_PAGE.stats[0],
      INCIDENT_PAGE.stats[1],
      { label: "Resolved in", value: "Not yet resolved" },
    ]);

    const incidentReadsBefore: number = (await fixture(page)).getItemRequests
      .length;
    await watchForSkeleton(page);
    await page.locator("#incident-resolve-btn").click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Resolve Incident",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "This marks the incident as resolved on the incident timeline.",
    );
    // A confirm: whether subscribers hear about it, and the note folded.
    await expect(
      dialog.getByRole("checkbox", { name: "Notify Status Page Subscribers" }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Add a public note" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(dialog.getByTestId("markdown-editor-toolbar")).toBeHidden();
    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    await expect(actions.getByRole("button")).toHaveCount(0);
    await expectRenderedText(heroChips(page), "Resolved SEV-2");
    await expectHeroDuration(hero(page), "Lasted 19 minutes");
    await expect
      .poll(async (): Promise<number> => {
        return (await fixture(page)).getItemRequests.length;
      })
      .toBeGreaterThan(incidentReadsBefore);

    const creates: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "IncidentStateTimeline";
      },
    );
    expect(creates).toHaveLength(1);
    expect(JSON.stringify(creates[0]?.data)).toContain(
      RESOLVED_INCIDENT_STATE_ID,
    );
    expect(JSON.stringify(creates[0]?.data)).toContain(INCIDENT_ID);

    // The AI report and the feed stayed mounted the whole time.
    expect(await skeletonWasSeen(page)).toBe(false);
    await expect(summarySection(page)).toContainText(INCIDENT_TLDR);
    await expectNoErrorStates(page);
  });

  test("?state=created: Acknowledge from the alert hero opens the state modal", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE, "state=created");

    const actions: Locator = page.getByRole("group", { name: "Event actions" });
    await expect(actions.getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
      DECLARE_INCIDENT,
    ]);
    expect(await statCells(page, ALERT_PAGE.statBar)).toEqual([
      ALERT_PAGE.stats[0],
      { label: "Acknowledged in", value: "Not yet acknowledged" },
      { label: "Resolved in", value: "Not yet resolved" },
    ]);

    await watchForSkeleton(page);
    await actions.getByRole("button", { name: "Acknowledge" }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Acknowledge Alert",
    });
    await expect(dialog).toBeVisible();
    /*
     * A plain confirm: one sentence, the private note folded, Cancel /
     * Acknowledge - in the short dialog, not the wide editor one.
     */
    await expect(dialog).toContainText(
      "This records an acknowledgement on the alert timeline and stops any on-call escalation for this alert.",
    );
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Add a private note" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(dialog.getByTestId("markdown-editor-toolbar")).toBeHidden();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(512);
    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Acknowledge", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    // Declare Incident stays after the remaining state action.
    await expect(actions.getByRole("button")).toHaveText([
      "Resolve",
      DECLARE_INCIDENT,
    ]);
    await expectRenderedText(heroChips(page), "Acknowledged High");
    await expectHeroDuration(hero(page), "Ongoing for 14 minutes");
    const creates: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "AlertStateTimeline";
      },
    );
    expect(creates).toHaveLength(1);
    expect(JSON.stringify(creates[0]?.data)).toContain(
      ACKNOWLEDGED_ALERT_STATE_ID,
    );
    expect(await skeletonWasSeen(page)).toBe(false);
  });

  test("?state=created: the alert's folded note opens in the wide dialog and goes with the acknowledgement", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE, "state=created");

    const actions: Locator = page.getByRole("group", { name: "Event actions" });
    await actions.getByRole("button", { name: "Acknowledge" }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Acknowledge Alert",
    });
    await expect(dialog).toBeVisible();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(512);

    const noteFold: Locator = dialog.getByRole("button", {
      name: "Add a private note",
    });
    await noteFold.click();
    await expect(noteFold).toHaveAttribute("aria-expanded", "true");

    // Opened to write, the dialog grows so the toolbar keeps its one line.
    const toolbar: Locator = dialog.getByTestId("markdown-editor-toolbar");
    await expect(toolbar).toBeVisible();
    await expect
      .poll(async (): Promise<number> => {
        return (await dialog.boundingBox())!.width;
      })
      .toBeGreaterThan(1000);
    await expect(toolbar.getByTitle("Bold (Ctrl+B)")).toBeVisible();

    await dialog.locator('[contenteditable="true"]').first().click();
    await page.keyboard.type("Paged the payments team.");

    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Acknowledge", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    const creates: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "AlertStateTimeline";
      },
    );
    expect(creates).toHaveLength(1);
    expect(JSON.stringify(creates[0]?.data)).toContain(
      ACKNOWLEDGED_ALERT_STATE_ID,
    );
    expect(String(creates[0]?.miscDataProps?.["privateNote"])).toContain(
      "Paged the payments team.",
    );
    await expectNoErrorStates(page);
  });

  test("?fail=resend keeps the incident page and shows why the resend failed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "fail=resend");

    const details: Locator = card(page, "Incident Details");
    await expect(details).toContainText("Failed");
    await details.getByRole("button", { name: "more details" }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Notification Status Details",
    });
    await expect(dialog).toContainText(
      "The email provider rejected the batch: 421 too many connections.",
    );
    await dialog.getByRole("button", { name: "Retry" }).click();

    /*
     * Retry asks first: it resumes after the pages already reached, and
     * says who it reaches now - without them.
     */
    const confirm: Locator = page.getByRole("dialog", {
      name: "Retry this notification?",
    });
    await expect(
      confirm.getByTestId("subscriber-notification-resend-description"),
    ).toHaveText(INCIDENT_CREATED_RETRY_DESCRIPTION);
    const retryAudience: Locator = confirm.getByTestId(
      "incident-created-retry-audience",
    );
    await expect(retryAudience).toContainText(
      "Acme EU (up to 1284 email, 3 webhook)",
    );
    await expect(retryAudience).toContainText(
      "Acme US (already sent this notification in full)",
    );
    expect((await fixture(page)).updates).toEqual([]);

    await confirm.getByRole("button", { name: "Retry", exact: true }).click();

    await expect(details.getByRole("alert")).toHaveText(
      "Could not resend notifications: Notifications cannot be resent while the email provider is rate limiting this project.",
    );
    const updates: Array<RecordedWrite> = (await fixture(page)).updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      modelName: "Incident",
      id: INCIDENT_ID,
    });
    await expect(hero(page)).toContainText(INCIDENT_PAGE.title);
  });

  test("Retry with every status page ticked resends to all pages, through the server's request", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "fail=resend");

    const details: Locator = card(page, "Incident Details");
    await details.getByRole("button", { name: "more details" }).click();
    await page
      .getByRole("dialog", { name: "Notification Status Details" })
      .getByRole("button", { name: "Retry" })
      .click();

    const confirm: Locator = page.getByRole("dialog", {
      name: "Retry this notification?",
    });
    await confirm
      .getByText(
        "Send it to every status page again, including the pages already reached",
      )
      .click();

    // Every page it reaches now, the ones already reached included.
    await expect(
      confirm.getByTestId("incident-created-resend-audience"),
    ).toContainText("Acme US (up to 1284 email, 3 webhook)");
    await expect(
      confirm.getByTestId("incident-created-retry-audience"),
    ).toHaveCount(0);

    await confirm.getByRole("button", { name: "Resend to all pages" }).click();
    await expect(confirm).toHaveCount(0);

    const resends: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "Incident";
      },
    );
    expect(resends).toHaveLength(1);
    expect(
      resends[0]!.data!["subscriberNotificationStatusOnIncidentCreated"],
    ).toBe("Pending");
    expect(resends[0]!.miscDataProps).toEqual({
      resendIncidentCreatedToAllStatusPages: true,
    });
    // Not the plain Retry.
    expect((await fixture(page)).updates).toEqual([]);
  });

  test("a notification that went out can be resent to every page, after confirming", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const details: Locator = card(page, "Incident Details");
    await expect(details).toContainText("Notifications Sent");
    await details.getByRole("button", { name: "more details" }).click();
    await page
      .getByRole("dialog", { name: "Notification Status Details" })
      .getByRole("button", { name: "Resend" })
      .click();

    const confirm: Locator = page.getByRole("dialog", {
      name: "Send this notification again?",
    });
    await expect(
      confirm.getByTestId("incident-created-resend-audience"),
    ).toContainText("Acme US (up to 1284 email, 3 webhook)");
    await confirm.getByRole("button", { name: "Resend", exact: true }).click();
    await expect(confirm).toHaveCount(0);

    const resends: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "Incident";
      },
    );
    expect(resends).toHaveLength(1);
    expect(resends[0]!.miscDataProps).toEqual({
      resendIncidentCreatedToAllStatusPages: true,
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Declare an incident from the alert header
 * ---------------------------------------------------------------------------
 */

// The hero actions' Tailwind colours (EventStatusPanel).
const PRIMARY_ACTION_BACKGROUND: string = "rgb(79, 70, 229)"; // indigo-600
const NEUTRAL_ACTION_BACKGROUND: string = "rgb(255, 255, 255)"; // white
const NEUTRAL_ACTION_BORDER: string = "rgb(209, 213, 219)"; // gray-300
const NEUTRAL_ACTION_TEXT: string = "rgb(55, 65, 81)"; // gray-700
// focus-visible:ring-indigo-500, drawn as a box-shadow.
const FOCUS_RING: RegExp = /rgb\(99, 102, 241\) 0px 0px 0px 4px/;

interface AlertHeroState {
  // Test title and screenshot name.
  name: string;
  // The fixture's ?state= for alert #311 ("" is the default, resolved).
  query: string;
  // The state buttons, in order, before Declare Incident.
  stateActions: ReadonlyArray<string>;
  // The one indigo (primary) state action, when there is one.
  primaryAction?: string | undefined;
}

const CREATED_ALERT: AlertHeroState = {
  name: "created",
  query: "state=created",
  stateActions: ["Acknowledge", "Resolve"],
  primaryAction: "Acknowledge",
};

const ACKNOWLEDGED_ALERT: AlertHeroState = {
  name: "acknowledged",
  query: "state=ongoing",
  stateActions: ["Resolve"],
  primaryAction: "Resolve",
};

const RESOLVED_ALERT: AlertHeroState = {
  name: "resolved",
  query: "",
  stateActions: [],
};

const ALERT_HERO_STATES: ReadonlyArray<AlertHeroState> = [
  CREATED_ALERT,
  ACKNOWLEDGED_ALERT,
  RESOLVED_ALERT,
];

// Phone, tablet beside the side menu, small laptop, laptop.
const HERO_WIDTHS: ReadonlyArray<number> = [390, 768, 1024, 1280];

function declareIncidentButton(page: Page): Locator {
  return heroActions(page).locator(`#${DECLARE_INCIDENT_BUTTON_ID}`);
}

function declareIncidentWrapper(page: Page): Locator {
  return heroActions(page).getByTestId(
    `${DECLARE_INCIDENT_BUTTON_ID}-disabled-wrapper`,
  );
}

function heroActionButton(page: Page, label: string): Locator {
  return heroActions(page).getByRole("button", { name: label, exact: true });
}

interface ActionPosition {
  label: string;
  top: number;
  left: number;
}

// The hero's buttons, grouped into the rows they wrap onto, top to bottom.
async function heroActionRows(page: Page): Promise<Array<Array<string>>> {
  const positions: Array<ActionPosition> = await heroActions(page)
    .getByRole("button")
    .evaluateAll((buttons: Array<Element>): Array<ActionPosition> => {
      return buttons.map((button: Element): ActionPosition => {
        const rect: DOMRect = button.getBoundingClientRect();
        return {
          label: (button.textContent || "").trim(),
          top: rect.top,
          left: rect.left,
        };
      });
    });
  const rows: Array<Array<ActionPosition>> = [];
  for (const position of [...positions].sort(
    (a: ActionPosition, b: ActionPosition): number => {
      return a.top - b.top || a.left - b.left;
    },
  )) {
    const row: Array<ActionPosition> | undefined = rows.find(
      (candidate: Array<ActionPosition>): boolean => {
        return Math.abs(candidate[0]!.top - position.top) <= 2;
      },
    );
    if (row) {
      row.push(position);
    } else {
      rows.push([position]);
    }
  }
  return rows.map((row: Array<ActionPosition>): Array<string> => {
    return row.map((position: ActionPosition): string => {
      return position.label;
    });
  });
}

/*
 * Records whether a dialog is ever mounted, so a test can prove an action
 * went straight to its page without opening the state-change modal on the
 * way. Client-side navigation keeps the window, so this survives it.
 */
async function watchForDialog(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const target: { __dialogSeen?: boolean } = window as unknown as {
      __dialogSeen?: boolean;
    };
    target.__dialogSeen = Boolean(document.querySelector("[role='dialog']"));
    new MutationObserver((): void => {
      if (document.querySelector("[role='dialog']")) {
        target.__dialogSeen = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function dialogWasSeen(page: Page): Promise<boolean> {
  return page.evaluate((): boolean => {
    return Boolean(
      (window as unknown as { __dialogSeen?: boolean }).__dialogSeen,
    );
  });
}

// The create-incident page for alert #311, and nothing written on the way.
async function expectDeclaringFromAlert(page: Page): Promise<void> {
  await expect(page.getByTestId("stub-page")).toHaveAttribute(
    "data-page",
    "INCIDENT_CREATE",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Create Incident",
  );
  expect(page.url()).toBe(
    `http://127.0.0.1:${PORT}${DECLARE_INCIDENT_FROM_ALERT_PATH}`,
  );
  const url: URL = new URL(page.url());
  expect(url.pathname).toBe(`${DASHBOARD}/incidents/create`);
  // Only this alert, and none of the alert page's own ?state= scenario.
  expect(url.search).toBe(`?alertIds=${ALERT_ID}`);
  expect(url.searchParams.getAll("alertIds")).toEqual([ALERT_ID]);

  expect(await dialogWasSeen(page), "a dialog opened on the way").toBe(false);
  const state: FixtureState = await fixture(page);
  expect(state.creates, "records created").toEqual([]);
  expect(state.updates, "records updated").toEqual([]);
  expect(state.deletes, "records deleted").toEqual([]);
}

test.describe("declare an incident from the alert hero", () => {
  for (const alertState of ALERT_HERO_STATES) {
    test(`${alertState.name} alert: Declare Incident follows the state actions as an outline button and opens the create page`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, ALERT_PAGE, alertState.query);

      const actions: Locator = heroActions(page);
      await expect(actions.getByRole("button")).toHaveText([
        ...alertState.stateActions,
        DECLARE_INCIDENT,
      ]);
      // Declaring is not a state, so it never adds a "More actions" menu.
      await expect(
        actions.getByRole("button", { name: "More actions" }),
      ).toHaveCount(0);

      const declare: Locator = declareIncidentButton(page);
      await expect(declare).toBeVisible();
      await expect(declare).toBeEnabled();
      await expect(declare).toHaveAttribute("type", "button");
      await expect(declare).toHaveAttribute("title", DECLARE_INCIDENT);
      await expect(declare).toHaveAccessibleName(DECLARE_INCIDENT);
      await expect(declare.locator("svg")).toHaveCount(1);
      // Allowed: a plain button, with no disabled-reason wrapper around it.
      await expect(declareIncidentWrapper(page)).toHaveCount(0);

      // Neutral outline, the same size as the state actions.
      await expect(declare).toHaveCSS(
        "background-color",
        NEUTRAL_ACTION_BACKGROUND,
      );
      await expect(declare).toHaveCSS(
        "border-top-color",
        NEUTRAL_ACTION_BORDER,
      );
      await expect(declare).toHaveCSS("color", NEUTRAL_ACTION_TEXT);
      await expect(declare).toHaveCSS("height", "36px");

      // The state action stays the only primary (indigo) button.
      const backgrounds: Array<string> = await actions
        .getByRole("button")
        .evaluateAll((buttons: Array<Element>): Array<string> => {
          return buttons.map((button: Element): string => {
            return window.getComputedStyle(button).backgroundColor;
          });
        });
      expect(
        backgrounds.filter((color: string): boolean => {
          return color === PRIMARY_ACTION_BACKGROUND;
        }),
      ).toHaveLength(alertState.primaryAction ? 1 : 0);
      if (alertState.primaryAction) {
        await expect(
          heroActionButton(page, alertState.primaryAction),
        ).toHaveCSS("background-color", PRIMARY_ACTION_BACKGROUND);
      }

      // Last in the row, on the same line as the state actions.
      const declareBox: Box = await documentBox(declare);
      for (const label of alertState.stateActions) {
        const box: Box = await documentBox(heroActionButton(page, label));
        expect(
          Math.abs(box.y - declareBox.y),
          `${label} shares the row`,
        ).toBeLessThanOrEqual(1);
        expect(declareBox.x, `after ${label}`).toBeGreaterThanOrEqual(
          box.x + box.width,
        );
        await expect(heroActionButton(page, label)).toHaveCSS("height", "36px");
      }

      // Offering the action is a permission check: nothing is fetched for it.
      const readModels: Array<string> = (await fixture(page)).listRequests.map(
        (request: RecordedModelRequest): string => {
          return request.modelName;
        },
      );
      expect(readModels).not.toContain("IncidentAlert");

      await watchForDialog(page);
      await declare.click();
      await expectDeclaringFromAlert(page);
    });
  }

  test("the create page is a new history entry: Back returns to the alert", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE, CREATED_ALERT.query);
    await watchForDialog(page);
    await declareIncidentButton(page).click();
    await expectDeclaringFromAlert(page);

    await page.goBack();
    expect(new URL(page.url()).pathname).toBe(ALERT_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      ALERT_PAGE.pageTitle,
    );
    await expect(heroActions(page).getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
      DECLARE_INCIDENT,
    ]);
  });

  test("keyboard: Tab reaches Declare Incident after Resolve and Enter opens the create page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE, CREATED_ALERT.query);
    const acknowledge: Locator = heroActionButton(page, "Acknowledge");
    const resolve: Locator = heroActionButton(page, "Resolve");
    const declare: Locator = declareIncidentButton(page);

    await acknowledge.focus();
    await page.keyboard.press("Tab");
    await expect(resolve).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(declare).toBeFocused();
    // Keyboard focus draws the indigo ring.
    await expect(declare).toHaveCSS("box-shadow", FOCUS_RING);

    await page.keyboard.press("Shift+Tab");
    await expect(resolve).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(declare).toBeFocused();

    await watchForDialog(page);
    await page.keyboard.press("Enter");
    await expectDeclaringFromAlert(page);
  });

  test("keyboard: Space on Declare Incident opens the create page from a resolved alert", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);
    const declare: Locator = declareIncidentButton(page);
    await declare.focus();
    await expect(declare).toBeFocused();
    await watchForDialog(page);
    await page.keyboard.press("Space");
    await expectDeclaringFromAlert(page);
  });

  test("?role=alert-member: Declare Incident is disabled and says which permission is missing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      ALERT_PAGE,
      `${CREATED_ALERT.query}&role=alert-member`,
    );

    // An alert member may still acknowledge and resolve.
    const actions: Locator = heroActions(page);
    await expect(actions.getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
      DECLARE_INCIDENT,
    ]);
    await expect(heroActionButton(page, "Acknowledge")).toBeEnabled();
    await expect(heroActionButton(page, "Resolve")).toBeEnabled();

    const declare: Locator = declareIncidentButton(page);
    const wrapper: Locator = declareIncidentWrapper(page);
    await expect(declare).toBeDisabled();
    await expect(declare).toHaveAttribute("aria-disabled", "true");
    expect(await declare.getAttribute("title")).toBeNull();
    await expect(declare).toHaveCSS("opacity", "0.5");
    await expect(declare).toHaveCSS(
      "background-color",
      NEUTRAL_ACTION_BACKGROUND,
    );
    await expect(wrapper).toHaveAttribute("tabindex", "0");
    await expect(wrapper.locator(`#${DECLARE_INCIDENT_BUTTON_ID}`)).toHaveCount(
      1,
    );

    // Pointing at it says why, and the wrapper is described by that reason.
    await wrapper.hover();
    const tooltip: Locator = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(DECLARE_INCIDENT_DENIED);
    await expect(wrapper).toHaveAccessibleDescription(DECLARE_INCIDENT_DENIED);

    // Clicking it goes nowhere and writes nothing.
    await watchForDialog(page);
    await wrapper.click();
    await expect(page.getByTestId("stub-page")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(ALERT_PATH);

    // The keyboard reaches it too and hears why; Enter or Space does nothing.
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await heroActionButton(page, "Resolve").focus();
    await page.keyboard.press("Tab");
    await expect(wrapper).toBeFocused();
    await expect(page.getByRole("tooltip")).toHaveText(DECLARE_INCIDENT_DENIED);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(page.getByTestId("stub-page")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(ALERT_PATH);
    expect(await dialogWasSeen(page), "a dialog opened").toBe(false);
    const state: FixtureState = await fixture(page);
    expect(state.creates).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  test("?role=loading: the header offers no action until the permission snapshot arrives", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Without permissions the details card has nothing it may show.
    await openReady(page, ALERT_PAGE, `${CREATED_ALERT.query}&role=loading`, [
      REPORT_CAVEAT,
    ]);
    /*
     * Who may acknowledge, resolve or declare is not known yet: the header
     * offers none of them rather than accuse the reader of lacking a
     * permission they may hold, and still says what the alert is.
     */
    await expect(heroActions(page)).toHaveCount(0);
    await expect(page.locator(`#${DECLARE_INCIDENT_BUTTON_ID}`)).toHaveCount(0);
    await expect(declareIncidentWrapper(page)).toHaveCount(0);
    await expect(hero(page).getByTestId("event-header-more-place")).toHaveCount(
      0,
    );
    await expect(heroTitle(page)).toHaveText(ALERT_PAGE.title);
    await expectRenderedText(heroChips(page), "Created High");
    await expect(hero(page)).toHaveAttribute(
      "data-actions-beside-from",
      "never",
    );
  });

  // Resolved and ongoing incidents are covered in "incident and alert overview".
  test("a created incident's hero keeps only its state actions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=created");
    await expect(heroActions(page).getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
    ]);
    await expect(page.locator(`#${DECLARE_INCIDENT_BUTTON_ID}`)).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The header, by its own width
 * ---------------------------------------------------------------------------
 * The header sits beside the record's side menu, so it lays itself out by
 * its own width (container queries), never the window's: the number and the
 * pills, then the title on a line of its own across the whole header - a
 * long title takes another line, never cut short or squeezed beside the
 * buttons - and the actions beside the pills from the width they need, or
 * on a row of their own under the title, at the right, below it. The header
 * works that width out from its buttons' words in the reader's language and
 * says it (data-actions-beside-from). The ⋯ (the other states) keeps the
 * top corner at every width.
 *
 * Production ships Inter (views/index.ejs), and the header's widths are
 * worked out for it; the fixture falls back to the system font, which is
 * wider, so these tests load Inter the way production declares it.
 */

// gap-y-2: between the pills, the title and the actions' own row.
const TOP_ROW_GAP_Y: number = 8;
// gap-x-4: between the pills and the actions beside them.
const TOP_ROW_GAP_X: number = 16;
// A button's height, and so the line of pills beside the buttons (min-h-9).
const ACTION_HEIGHT: number = 36;
const PX_PER_REM: number = 16;

const PRODUCTION_FONT_CSS: string =
  '@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/dashboard/assets/fonts/InterVariable.woff2) format("woff2")} *{font-family:Inter,ui-sans-serif,system-ui,sans-serif}';

// Draws the page in production's Inter, as views/index.ejs declares it.
async function loadProductionFont(page: Page): Promise<void> {
  await page.route(
    "**/dashboard/assets/fonts/InterVariable.woff2",
    async (route: PlaywrightRoute) => {
      await route.fulfill({ path: INTER_FONT_FILE });
    },
  );
  await page.addStyleTag({ content: PRODUCTION_FONT_CSS });
  expect(
    await page.evaluate(async (): Promise<number> => {
      return (await document.fonts.load("600 14px Inter")).length;
    }),
    "Inter loaded",
  ).toBeGreaterThan(0);
}

function heroTopRow(page: Page): Locator {
  return hero(page).getByTestId("event-header-top");
}

// The actions' group in any language: its name is the reader's ("Ereignisaktionen").
function heroActionsGroup(page: Page): Locator {
  return hero(page).getByTestId("event-header-actions");
}

function heroTitle(page: Page): Locator {
  return hero(page).getByRole("heading", { level: 2 });
}

interface HeroTopRowBoxes {
  // The number and pills, the title and the actions, inside the padding.
  row: Box;
  chips: Box;
  title: Box;
  actions: Box;
}

async function heroTopRowBoxes(page: Page): Promise<HeroTopRowBoxes> {
  return {
    row: await documentBox(heroTopRow(page)),
    chips: await documentBox(heroChips(page)),
    title: await documentBox(heroTitle(page)),
    actions: await documentBox(heroActionsGroup(page)),
  };
}

// The width the header's container queries read: the card's, inside its border.
async function heroQueryWidth(page: Page): Promise<number> {
  return hero(page).evaluate((element: Element): number => {
    return (element as HTMLElement).clientWidth;
  });
}

// From what width the header says its actions sit beside the pills, in px.
async function heroBesideFromPx(page: Page): Promise<number | null> {
  const value: string | null = await hero(page).getAttribute(
    "data-actions-beside-from",
  );
  expect(value, "the header says where its actions go").toMatch(
    /^(never|\d+rem)$/,
  );
  return value === "never"
    ? null
    : Number((value || "").replace("rem", "")) * PX_PER_REM;
}

async function isHeroBeside(page: Page): Promise<boolean> {
  const from: number | null = await heroBesideFromPx(page);
  return from !== null && (await heroQueryWidth(page)) >= from;
}

/*
 * Narrower than its actions need: the pills, the title one gap under them,
 * then the actions one gap under the title, on a row as wide as the header.
 */
function expectActionsUnderTitle(boxes: HeroTopRowBoxes, at: string): void {
  expect(
    Math.abs(boxes.chips.y - boxes.row.y),
    `${at}: the pills lead the header`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      boxes.title.y - (boxes.chips.y + boxes.chips.height) - TOP_ROW_GAP_Y,
    ),
    `${at}: the title starts one gap under the pills`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      boxes.actions.y - (boxes.title.y + boxes.title.height) - TOP_ROW_GAP_Y,
    ),
    `${at}: the actions start one gap under the title`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.actions.x - boxes.row.x),
    `${at}: the actions' row starts where the header does`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.actions.width - boxes.row.width),
    `${at}: the actions' row spans the header`,
  ).toBeLessThanOrEqual(1);
}

/*
 * As wide as its actions need, or wider: the pills at the start of the
 * first line and the actions on one row at its end, level with them, and the
 * title one gap under both.
 */
function expectActionsBesidePills(boxes: HeroTopRowBoxes, at: string): void {
  expect(
    Math.abs(boxes.chips.x - boxes.row.x),
    `${at}: the pills start where the header does`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.actions.y - boxes.row.y) +
      Math.abs(boxes.chips.y - boxes.row.y),
    `${at}: the actions are level with the pills`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      boxes.actions.x + boxes.actions.width - (boxes.row.x + boxes.row.width),
    ),
    `${at}: the actions end where the header does`,
  ).toBeLessThanOrEqual(1);
  expect(
    boxes.actions.x - (boxes.chips.x + boxes.chips.width),
    `${at}: the gap between the pills and the actions`,
  ).toBeGreaterThanOrEqual(TOP_ROW_GAP_X - 1);
  // Neither wraps: the pills keep one line and the buttons one row.
  expect(
    Math.abs(boxes.chips.height - ACTION_HEIGHT),
    `${at}: the pills keep one line, as tall as the buttons`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.actions.height - ACTION_HEIGHT),
    `${at}: the buttons keep one row`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.title.y - (boxes.row.y + ACTION_HEIGHT) - TOP_ROW_GAP_Y),
    `${at}: the title starts one gap under them`,
  ).toBeLessThanOrEqual(1);
}

/*
 * The title is never cut short or squeezed beside the buttons: it has the
 * whole width of the header and shows whole, in as many lines as it needs.
 */
async function expectTitleWhole(
  page: Page,
  boxes: { row: Box; title: Box },
  at: string,
): Promise<void> {
  expect(
    Math.abs(boxes.title.x - boxes.row.x),
    `${at}: the title starts where the header does`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.title.width - boxes.row.width),
    `${at}: the title spans the header`,
  ).toBeLessThanOrEqual(1);
  expect(await isOverflowing(heroTitle(page)), `${at}: the title is cut`).toBe(
    false,
  );
}

interface HeroButtonLook {
  label: string;
  box: Box;
  isCut: boolean;
}

async function heroButtonLooks(page: Page): Promise<Array<HeroButtonLook>> {
  return heroActionsGroup(page)
    .getByRole("button")
    .evaluateAll((buttons: Array<Element>): Array<HeroButtonLook> => {
      return buttons.map((button: Element): HeroButtonLook => {
        const rect: DOMRect = button.getBoundingClientRect();
        const label: Element | null = button.querySelector("span.truncate");
        return {
          label:
            (button.textContent || "").trim() ||
            button.getAttribute("aria-label") ||
            "",
          box: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          },
          isCut: label ? label.scrollWidth > label.clientWidth + 1 : false,
        };
      });
    });
}

/*
 * Every button the header offers - the ⋯ too - inside the card, as tall as
 * the others, its words whole.
 */
async function expectHeroButtonsWhole(page: Page, at: string): Promise<void> {
  const header: Box = await documentBox(hero(page));
  const looks: Array<HeroButtonLook> = await heroButtonLooks(page);

  expect(looks.length, `${at}: buttons`).toBeGreaterThan(0);
  for (const look of looks) {
    expect({ at, button: look.label, cut: look.isCut }).toEqual({
      at,
      button: look.label,
      cut: false,
    });
    expect(
      Math.abs(look.box.height - ACTION_HEIGHT),
      `${at}: ${look.label} is 36px tall`,
    ).toBeLessThanOrEqual(0.5);
    expect(
      look.box.x,
      `${at}: ${look.label} starts inside the header`,
    ).toBeGreaterThanOrEqual(header.x);
    expect(
      look.box.x + look.box.width,
      `${at}: ${look.label} ends inside the header`,
    ).toBeLessThanOrEqual(header.x + header.width);
    expect(
      look.box.y + look.box.height,
      `${at}: ${look.label} ends inside the header`,
    ).toBeLessThanOrEqual(header.y + header.height);
  }
}

/*
 * The ⋯ keeps the header's top corner at every width: level with the top
 * row, at its end, never over a pill and never alone on a row after the
 * buttons.
 */
async function expectMoreInTheCorner(page: Page, at: string): Promise<void> {
  const place: Locator = hero(page).getByTestId("event-header-more-place");

  if ((await place.count()) === 0) {
    return;
  }

  const row: Box = await documentBox(heroTopRow(page));
  const more: Box = await documentBox(place);
  expect(
    Math.abs(more.y - row.y),
    `${at}: the ⋯ is level with the top row`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(more.x + more.width - (row.x + row.width)),
    `${at}: the ⋯ ends the top row`,
  ).toBeLessThanOrEqual(1);

  const pillEnds: Array<number> = await heroChips(page).evaluate(
    (chips: Element): Array<number> => {
      return Array.from(chips.children).map((child: Element): number => {
        return child.getBoundingClientRect().right + window.scrollX;
      });
    },
  );
  for (const end of pillEnds) {
    expect(end, `${at}: a pill runs under the ⋯`).toBeLessThanOrEqual(
      more.x - 4,
    );
  }
}

/*
 * The track's current state - the name the reader most needs - is never
 * cut: its share grows to hold it ("زمان‌بندی‌شده", Scheduled, is wider
 * than a quarter of a phone's header).
 */
async function expectCurrentStateWhole(page: Page, at: string): Promise<void> {
  const current: Locator = hero(page)
    .getByTestId("event-state-track")
    .locator("li[aria-current='step'] span[title]");

  if ((await current.count()) === 0) {
    return;
  }

  expect(
    await isOverflowing(current),
    `${at}: the current state's name is cut`,
  ).toBe(false);
}

interface NoticeControlLook {
  label: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  isCut: boolean;
}

/*
 * The band at the foot of the header: its buttons and links - View full
 * report, Show more - inside the card, their words whole, and never run
 * into each other. In German on a phone "Mehr anzeigen" and "Vollständigen
 * Bericht anzeigen" once shared a line too narrow for both and overlapped.
 */
async function expectNoticeTidy(page: Page, at: string): Promise<void> {
  const band: Locator = hero(page).getByTestId("event-header-notice");

  if ((await band.count()) === 0) {
    return;
  }

  const bandBox: Box = await documentBox(band);
  const controls: Array<NoticeControlLook> = await band
    .locator("button, a")
    .evaluateAll((elements: Array<Element>): Array<NoticeControlLook> => {
      return elements.map((element: Element): NoticeControlLook => {
        const rect: DOMRect = element.getBoundingClientRect();
        return {
          label: (element.textContent || "").trim(),
          left: rect.left + window.scrollX,
          right: rect.right + window.scrollX,
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
          isCut: element.scrollWidth > element.clientWidth + 1,
        };
      });
    });

  for (const control of controls) {
    expect({ at, control: control.label, cut: control.isCut }).toEqual({
      at,
      control: control.label,
      cut: false,
    });
    expect(
      control.left,
      `${at}: ${control.label} starts in the band`,
    ).toBeGreaterThanOrEqual(bandBox.x - 1);
    expect(
      control.right,
      `${at}: ${control.label} ends in the band`,
    ).toBeLessThanOrEqual(bandBox.x + bandBox.width + 1);
  }

  for (let first: number = 0; first < controls.length; first++) {
    for (let second: number = first + 1; second < controls.length; second++) {
      const a: NoticeControlLook = controls[first]!;
      const b: NoticeControlLook = controls[second]!;
      const overlapX: number =
        Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY: number =
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      expect(
        overlapX > 1 && overlapY > 1,
        `${at}: "${a.label}" and "${b.label}" overlap`,
      ).toBe(false);
    }
  }
}

// EventHeaderLayout's EVENT_HEADER_FACT_COLUMN_STEPS.
const FACT_COLUMN_STEPS: ReadonlyArray<{ columns: number; widthRem: number }> =
  [
    { columns: 2, widthRem: 18 },
    { columns: 3, widthRem: 34 },
    { columns: 4, widthRem: 50 },
    { columns: 5, widthRem: 64 },
  ];

interface HeroFactsLook {
  columns: number;
  count: number;
  cut: Array<string>;
}

/*
 * The facts on a grid that follows the header's width - one column in the
 * narrowest place, up to five on a wide screen - in as few rows as that
 * allows, shared out evenly (four facts where three fit are two rows of
 * two, never three and one left alone), every label and value whole.
 */
async function expectFactsOnTheirGrid(page: Page, at: string): Promise<void> {
  const width: number = await heroQueryWidth(page);
  const look: HeroFactsLook = await hero(page)
    .getByTestId("event-status-facts")
    .evaluate((facts: Element): HeroFactsLook => {
      return {
        columns: window
          .getComputedStyle(facts)
          .gridTemplateColumns.split(" ")
          .filter((column: string): boolean => {
            return column.length > 0;
          }).length,
        count: facts.children.length,
        cut: Array.from(facts.querySelectorAll("dt, dd"))
          .filter((element: Element): boolean => {
            return element.scrollWidth > element.clientWidth + 1;
          })
          .map((element: Element): string => {
            return (element.textContent || "").trim();
          }),
      };
    });
  const allowed: number = FACT_COLUMN_STEPS.reduce(
    (most: number, step: { columns: number; widthRem: number }): number => {
      return width >= step.widthRem * PX_PER_REM ? step.columns : most;
    },
    1,
  );
  const rows: number = Math.ceil(look.count / Math.min(look.count, allowed));
  const columns: number = Math.ceil(look.count / rows);

  expect({ at, columns: look.columns }).toEqual({ at, columns });
  // No row is left with a lone fact under a fuller one, where that can be helped.
  if (look.count > columns) {
    expect(
      look.count % columns === 0 || look.count % columns >= columns - 1,
      `${at}: ${look.count} facts in ${columns} columns`,
    ).toBe(true);
  }
  expect({ at, cut: look.cut }).toEqual({ at, cut: [] });
}

/*
 * The header at the width it has: its actions beside the pills from the
 * width it says they need and under the title below it, the title whole,
 * every button whole and inside the card, the ⋯ in the corner, the facts
 * on their grid, and nothing wider than the page.
 */
async function expectHeaderAtItsWidth(page: Page, at: string): Promise<void> {
  if ((await heroActionsGroup(page).count()) > 0) {
    const boxes: HeroTopRowBoxes = await heroTopRowBoxes(page);
    if (await isHeroBeside(page)) {
      expectActionsBesidePills(boxes, at);
    } else {
      expectActionsUnderTitle(boxes, at);
    }
    await expectTitleWhole(page, boxes, at);
    await expectHeroButtonsWhole(page, at);
    await expectMoreInTheCorner(page, at);
  } else {
    await expectTitleWhole(
      page,
      {
        row: await documentBox(heroTopRow(page)),
        title: await documentBox(heroTitle(page)),
      },
      at,
    );
  }
  await expectCurrentStateWhole(page, at);
  await expectFactsOnTheirGrid(page, at);
  await expectNoticeTidy(page, at);
  await expectNoHorizontalOverflow(page);
}

interface HeroLayoutCase {
  // Test title.
  title: string;
  // Screenshot name, before the width.
  screenshot: string;
  eventPage: EventPage;
  query: string;
  // The header's buttons, in order.
  labels: ReadonlyArray<string>;
  // From what width it says they sit beside the pills.
  besideFrom: string;
  // The rows they wrap onto at each of HERO_WIDTHS, top to bottom.
  rows: Readonly<Record<number, ReadonlyArray<ReadonlyArray<string>>>>;
  // The widths, of HERO_WIDTHS, at which they sit beside the pills.
  besideAt: ReadonlyArray<number>;
}

const ALL_CREATED_ALERT_ACTIONS: ReadonlyArray<string> = [
  ...CREATED_ALERT.stateActions,
  DECLARE_INCIDENT,
];

// ?title=long: Alert #311 with a title longer than a laptop's header is wide.
const ALERT_LONG_TITLE: string =
  "Payment webhook 5xx rate above 5% on the eu-west-1 checkout cluster";
const LONG_TITLE_ALERT_PAGE: EventPage = {
  ...ALERT_PAGE,
  pageTitle: `#311 ${ALERT_LONG_TITLE}`,
  title: ALERT_LONG_TITLE,
};

/*
 * The header is 324px wide inside its border on a 390px phone, 414px beside
 * the side menu at 768px, 618px at 1024px and 874px at 1280px. A created
 * alert's three buttons need 48rem (768px) beside its pills, so they sit
 * there only from 1280px; a resolved alert's Declare Incident needs 32rem
 * and a created incident's two buttons 38rem, so theirs do from 1024px.
 * Under the title, a phone's or a 768px window's buttons grow to fill their
 * rows - Acknowledge and Resolve sharing one, Declare Incident the next -
 * and a 1024px window's keep their own width, right-aligned on one row.
 */
const HERO_LAYOUT_CASES: ReadonlyArray<HeroLayoutCase> = [
  {
    title: "created alert",
    screenshot: "alert-hero-created",
    eventPage: ALERT_PAGE,
    query: CREATED_ALERT.query,
    labels: ALL_CREATED_ALERT_ACTIONS,
    besideFrom: "48rem",
    rows: {
      390: [["Acknowledge", "Resolve"], [DECLARE_INCIDENT]],
      768: [["Acknowledge", "Resolve"], [DECLARE_INCIDENT]],
      1024: [ALL_CREATED_ALERT_ACTIONS],
      1280: [ALL_CREATED_ALERT_ACTIONS],
    },
    besideAt: [1280],
  },
  {
    title: "resolved alert",
    screenshot: "alert-hero-resolved",
    eventPage: ALERT_PAGE,
    query: RESOLVED_ALERT.query,
    labels: [DECLARE_INCIDENT],
    besideFrom: "32rem",
    rows: {
      390: [[DECLARE_INCIDENT]],
      768: [[DECLARE_INCIDENT]],
      1024: [[DECLARE_INCIDENT]],
      1280: [[DECLARE_INCIDENT]],
    },
    besideAt: [1024, 1280],
  },
  {
    title: "created incident",
    screenshot: "incident-hero-created",
    eventPage: INCIDENT_PAGE,
    query: "state=created",
    labels: ["Acknowledge", "Resolve"],
    besideFrom: "38rem",
    rows: {
      390: [["Acknowledge", "Resolve"]],
      768: [["Acknowledge", "Resolve"]],
      1024: [["Acknowledge", "Resolve"]],
      1280: [["Acknowledge", "Resolve"]],
    },
    besideAt: [1024, 1280],
  },
];

test.describe("the header's top row, by its own width", () => {
  for (const layoutCase of HERO_LAYOUT_CASES) {
    for (const width of HERO_WIDTHS) {
      const isBeside: boolean = layoutCase.besideAt.includes(width);
      test(`${layoutCase.title} header at ${width}px: the actions sit ${
        isBeside ? "beside the pills" : "under the title"
      }, whole and inside the header`, async ({ page }: { page: Page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openReady(page, layoutCase.eventPage, layoutCase.query);
        await loadProductionFont(page);

        const labels: Array<string> = [...layoutCase.labels];
        await expect(heroActions(page).getByRole("button")).toHaveText(labels);
        await expect(heroTitle(page)).toHaveText(layoutCase.eventPage.title);
        await expect(hero(page)).toHaveAttribute(
          "data-actions-beside-from",
          layoutCase.besideFrom,
        );
        expect(await isHeroBeside(page), "beside the pills").toBe(isBeside);

        await expectHeaderAtItsWidth(page, `${width}px`);

        const rows: Array<Array<string>> = await heroActionRows(page);
        expect(rows, `rows at ${width}px`).toEqual(layoutCase.rows[width]);
        // Wrapping keeps the reading order: state actions, then Declare Incident.
        expect(
          rows.reduce(
            (all: Array<string>, row: Array<string>): Array<string> => {
              return all.concat(row);
            },
            [],
          ),
        ).toEqual(labels);

        // Every row ends at the end of the actions.
        const actions: Box = await documentBox(heroActions(page));
        for (const row of rows) {
          const last: Box = await documentBox(
            heroActionButton(page, row[row.length - 1]!),
          );
          expect(
            Math.abs(last.x + last.width - (actions.x + actions.width)),
            `row "${row.join(", ")}" is right-aligned`,
          ).toBeLessThanOrEqual(1);
        }

        if (width === 390 && rows[rows.length - 1]!.length === 1) {
          // On a phone a button alone on its row fills it.
          const lastBox: Box = await documentBox(
            heroActionButton(page, rows[rows.length - 1]![0]!),
          );
          expect(Math.abs(lastBox.x - actions.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(lastBox.width - actions.width)).toBeLessThanOrEqual(
            1,
          );
        }

        await page.mouse.move(0, 0);
        await screenshotElement(
          hero(page),
          `${layoutCase.screenshot}-${width}`,
        );
      });
    }
  }

  test("the actions move beside the pills once the header is as wide as they need, not a pixel earlier", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page, ALERT_PAGE, CREATED_ALERT.query);
    await loadProductionFont(page);
    await expect(hero(page)).toHaveAttribute(
      "data-actions-beside-from",
      "48rem",
    );
    const switchAt: number = 48 * PX_PER_REM;
    // How much of the window is not the header: the side menu and the margins.
    const around: number = 1280 - (await heroQueryWidth(page));

    // One pixel short: the widest header that keeps them under the title.
    await page.setViewportSize({ width: around + switchAt - 1, height: 900 });
    await expect
      .poll(async (): Promise<number> => {
        return heroQueryWidth(page);
      })
      .toBe(switchAt - 1);
    const under: HeroTopRowBoxes = await heroTopRowBoxes(page);
    expectActionsUnderTitle(under, `${switchAt - 1}px`);
    expect(await heroActionRows(page)).toEqual([ALL_CREATED_ALERT_ACTIONS]);
    const underHeight: number = (await documentBox(hero(page))).height;

    // At the width they need, the same page draws them beside the pills.
    await page.setViewportSize({ width: around + switchAt, height: 900 });
    await expect
      .poll(async (): Promise<number> => {
        return heroQueryWidth(page);
      })
      .toBe(switchAt);
    const beside: HeroTopRowBoxes = await heroTopRowBoxes(page);
    expectActionsBesidePills(beside, `${switchAt}px`);
    expect(await heroActionRows(page)).toEqual([ALL_CREATED_ALERT_ACTIONS]);
    await expectHeroButtonsWhole(page, `${switchAt}px`);
    // Their own row is gone, so the header is shorter.
    expect(
      (await documentBox(hero(page))).height,
      "the header beside the pills",
    ).toBeLessThan(underHeight - TOP_ROW_GAP_Y);
  });

  for (const width of [390, 1024, 1280]) {
    test(`a long alert title at ${width}px reads whole across the header, in as many lines as it needs, and the actions keep their rows`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReady(
        page,
        LONG_TITLE_ALERT_PAGE,
        `${CREATED_ALERT.query}&title=long`,
      );
      await loadProductionFont(page);
      await expect(heroTitle(page)).toHaveText(ALERT_LONG_TITLE);
      await expect(heroActions(page).getByRole("button")).toHaveText([
        ...ALL_CREATED_ALERT_ACTIONS,
      ]);

      await expectHeaderAtItsWidth(page, `${width}px`);
      // Never truncated: no tooltip is needed to read it.
      await expect(heroTitle(page)).not.toHaveClass(/\btruncate\b/);
      const lineHeight: number = await heroTitle(page).evaluate(
        (title: Element): number => {
          return parseFloat(window.getComputedStyle(title).lineHeight);
        },
      );
      const lines: number = Math.round(
        (await documentBox(heroTitle(page))).height / lineHeight,
      );
      // Wider than a phone's header and a laptop's, not a desktop's.
      expect(lines, "the title's lines").toBe(
        width === 1280 ? 1 : width === 1024 ? 2 : 3,
      );
      expect(await heroActionRows(page)).toEqual(
        width === 390
          ? [["Acknowledge", "Resolve"], [DECLARE_INCIDENT]]
          : [ALL_CREATED_ALERT_ACTIONS],
      );
      await page.mouse.move(0, 0);
      await screenshotElement(hero(page), `alert-hero-long-title-${width}`);
    });
  }

  test("on a phone an acknowledged alert keeps Declare Incident's whole label", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Phone buttons grow from their own width (flex-auto) rather than
     * splitting the row evenly, which would cut "Declare Incident" short.
     */
    await page.setViewportSize({ width: 390, height: 900 });
    await openReady(page, ALERT_PAGE, ACKNOWLEDGED_ALERT.query);
    await loadProductionFont(page);
    await expect(heroActions(page).getByRole("button")).toHaveText([
      ...ACKNOWLEDGED_ALERT.stateActions,
      DECLARE_INCIDENT,
    ]);
    expect(
      await isOverflowing(declareIncidentButton(page).locator("span.truncate")),
      "Declare Incident is cut off",
    ).toBe(false);
  });
});

interface HeaderKind {
  // Test title: "a new incident's".
  name: string;
  // Screenshot name.
  screenshot: string;
  eventPage: EventPage;
  query: string;
  // The buttons the header offers, the ⋯ among them.
  buttonCount: number;
}

// The four headers, each with something to do: an episode of each kind.
const HEADER_KINDS: ReadonlyArray<HeaderKind> = [
  {
    name: "a new incident's",
    screenshot: "incident",
    eventPage: INCIDENT_PAGE,
    query: "state=created",
    buttonCount: 2,
  },
  {
    name: "a new alert's",
    screenshot: "alert",
    eventPage: ALERT_PAGE,
    query: "state=created",
    buttonCount: 3,
  },
  {
    name: "a new incident episode's",
    screenshot: "incident-episode",
    eventPage: INCIDENT_EPISODE_PAGE,
    query: "state=created",
    buttonCount: 2,
  },
  {
    name: "a new alert episode's",
    screenshot: "alert-episode",
    eventPage: ALERT_EPISODE_PAGE,
    query: "state=created",
    buttonCount: 2,
  },
  {
    name: "a scheduled maintenance event's",
    screenshot: "scheduled-maintenance",
    eventPage: SCHEDULED_MAINTENANCE_PAGE,
    query: "",
    // Mark as Ongoing, Mark as Ended and the ⋯.
    buttonCount: 3,
  },
];

// Phone, tablet and laptops beside the side menu, and a wide screen.
const HEADER_WIDTHS: ReadonlyArray<number> = [390, 768, 1024, 1280, 1440];

const HEADER_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "fa", name: "Persian" },
  { code: "ja", name: "Japanese" },
];

// Opens a header in a language and a theme, settled: nothing moves after.
async function openHeader(
  page: Page,
  kind: HeaderKind,
  language: string,
  theme: string,
): Promise<void> {
  const query: string = [
    kind.query,
    language === "en" ? "" : `lang=${language}`,
    theme === "dark" ? "theme=dark" : "",
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join("&");

  if (language === "en") {
    await openReady(page, kind.eventPage, query);
  } else {
    // The page's own words are another language's: wait for its records.
    await open(page, kind.eventPage.path, query);
    await expect(heroTitle(page)).toHaveText(kind.eventPage.title, {
      timeout: 30000,
    });
    if (kind.eventPage.whatHappened) {
      await expect(hero(page).getByTestId("event-owners")).toBeVisible({
        timeout: 30000,
      });
      await expectWhatHappenedSettled(page);
    }
  }

  await expect(heroActionsGroup(page).getByRole("button")).toHaveCount(
    kind.buttonCount,
    { timeout: 30000 },
  );
  // The group is named in the reader's language.
  if (language !== "en") {
    await expect(heroActionsGroup(page)).not.toHaveAttribute(
      "aria-label",
      "Event actions",
    );
  }
  // How long, then every fact the page names.
  await expect(
    hero(page).getByTestId("event-status-facts").locator(":scope > div"),
  ).toHaveCount(kind.eventPage.facts.length + 1, { timeout: 30000 });
  await loadProductionFont(page);
}

interface HeaderColours {
  // The card's own surface.
  surface: string;
  // Panels inside the card as light as a light theme's (dark theme only).
  lightPanels: Array<string>;
  // Words that read at less than 4.5:1 on what they are drawn on.
  unreadable: Array<string>;
}

/*
 * What the header's words are drawn on, every layer of it, from the card
 * up: its own surface, a band's wash, a button's fill. The pills take their
 * colours from the record's own state and severity, so they are left out.
 */
async function headerColours(page: Page): Promise<HeaderColours> {
  return hero(page).evaluate((header: Element): HeaderColours => {
    type Rgba = [number, number, number, number];

    const parse: (color: string) => Rgba = (color: string): Rgba => {
      // A colour mixed in CSS: color(srgb 0.1 0.2 0.3 / 0.5).
      const srgb: RegExpMatchArray | null = color.match(
        /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/,
      );
      if (srgb) {
        return [
          Number(srgb[1]) * 255,
          Number(srgb[2]) * 255,
          Number(srgb[3]) * 255,
          srgb[4] === undefined ? 1 : Number(srgb[4]),
        ];
      }
      const parts: Array<number> = (color.match(/[\d.]+/g) || []).map(Number);
      return [
        parts[0] || 0,
        parts[1] || 0,
        parts[2] || 0,
        parts.length > 3 ? parts[3]! : 1,
      ];
    };
    const over: (top: Rgba, bottom: Rgba) => Rgba = (
      top: Rgba,
      bottom: Rgba,
    ): Rgba => {
      const alpha: number = top[3];
      return [
        top[0] * alpha + bottom[0] * (1 - alpha),
        top[1] * alpha + bottom[1] * (1 - alpha),
        top[2] * alpha + bottom[2] * (1 - alpha),
        1,
      ];
    };
    const luminance: (color: Rgba) => number = (color: Rgba): number => {
      const channel: (value: number) => number = (value: number): number => {
        const c: number = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return (
        0.2126 * channel(color[0]) +
        0.7152 * channel(color[1]) +
        0.0722 * channel(color[2])
      );
    };
    const contrast: (a: Rgba, b: Rgba) => number = (
      a: Rgba,
      b: Rgba,
    ): number => {
      const first: number = luminance(a);
      const second: number = luminance(b);
      return (
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      );
    };
    // What an element is drawn on: every background from the card up to it.
    const backdrop: (element: Element) => Rgba = (element: Element): Rgba => {
      const layers: Array<Rgba> = [];
      let current: Element | null = element;
      while (current) {
        layers.unshift(parse(window.getComputedStyle(current).backgroundColor));
        if (current === header) {
          break;
        }
        current = current.parentElement;
      }
      let color: Rgba = [255, 255, 255, 1];
      for (const layer of layers) {
        color = over(layer, color);
      }
      return color;
    };
    const isShown: (element: Element) => boolean = (
      element: Element,
    ): boolean => {
      const rect: DOMRect = element.getBoundingClientRect();
      const style: CSSStyleDeclaration = window.getComputedStyle(element);
      return (
        rect.width > 1 &&
        rect.height > 1 &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    };

    const surface: Rgba = parse(
      window.getComputedStyle(header).backgroundColor,
    );
    const isDark: boolean = document.documentElement.classList.contains("dark");
    const lightPanels: Array<string> = [];
    const unreadable: Array<string> = [];

    // Drawn over a picture or a gradient: what is behind it cannot be read here.
    const isOverImage: (element: Element) => boolean = (
      element: Element,
    ): boolean => {
      let current: Element | null = element;
      while (current && current !== header) {
        if (window.getComputedStyle(current).backgroundImage !== "none") {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    };

    for (const element of Array.from(header.querySelectorAll("*"))) {
      /*
       * The pills take the record's own colours, and an avatar's initials
       * are decoration (aria-hidden) on the person's own picture or tile.
       */
      if (
        element.closest("[data-testid='pill']") ||
        element.closest("[aria-hidden='true']") ||
        isOverImage(element) ||
        !isShown(element)
      ) {
        continue;
      }
      const background: Rgba = parse(
        window.getComputedStyle(element).backgroundColor,
      );
      if (
        isDark &&
        background[3] > 0 &&
        luminance(backdrop(element)) > 0.4 &&
        !element.closest("img")
      ) {
        lightPanels.push(
          `${element.tagName.toLowerCase()} "${(element.textContent || "")
            .trim()
            .slice(0, 40)}"`,
        );
      }
      const ownText: string = Array.from(element.childNodes)
        .filter((node: ChildNode): boolean => {
          return node.nodeType === Node.TEXT_NODE;
        })
        .map((node: ChildNode): string => {
          return node.textContent || "";
        })
        .join("")
        .trim();
      if (!ownText) {
        continue;
      }
      const style: CSSStyleDeclaration = window.getComputedStyle(element);
      const behind: Rgba = backdrop(element);
      const ratio: number = contrast(over(parse(style.color), behind), behind);
      if (ratio < 4.5) {
        unreadable.push(`"${ownText.slice(0, 40)}" at ${ratio.toFixed(2)}:1`);
      }
    }

    return {
      surface: `rgb(${surface[0]}, ${surface[1]}, ${surface[2]})`,
      lightPanels,
      unreadable,
    };
  });
}

test.describe("the header, by its own width", () => {
  /*
   * Each kind of header, in each language, at five widths: whatever the
   * words, the actions are beside the pills exactly from the width the
   * header says they need and under the title below it, never wrapped
   * beside the pills, never cut, never over the ⋯ - and every word reads.
   */
  for (const kind of HEADER_KINDS) {
    for (const language of HEADER_LANGUAGES) {
      test(`${kind.name} header in ${language.name} at ${HEADER_WIDTHS.join(
        ", ",
      )}px`, async ({ page }: { page: Page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openHeader(page, kind, language.code, "light");

        for (const width of HEADER_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          const at: string = `${language.code} ${width}px`;
          await expectHeaderAtItsWidth(page, at);
          expect((await headerColours(page)).unreadable, at).toEqual([]);
          await page.mouse.move(0, 0);
          await screenshotElement(
            hero(page),
            `event-header-${kind.screenshot}-${language.code}-${width}`,
          );
        }
      });
    }

    test(`${kind.name} header in the dark theme: the dark card, no light panel on it, every word readable`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openHeader(page, kind, "en", "dark");

      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const at: string = `dark ${width}px`;
        const colours: HeaderColours = await headerColours(page);
        expect(
          relativeLuminance(colours.surface),
          `${at}: the card`,
        ).toBeLessThan(0.05);
        expect(colours.lightPanels, `${at}: light panels`).toEqual([]);
        expect(colours.unreadable, `${at}: unreadable words`).toEqual([]);
        await expectHeaderAtItsWidth(page, at);
        await page.mouse.move(0, 0);
        await screenshotElement(
          hero(page),
          `event-header-${kind.screenshot}-dark-${width}`,
        );
      }
    });
  }

  for (const theme of ["light", "dark"]) {
    test(`the AI root cause analysis closes the incident's header in a band of its own, edge to edge (${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openReady(
        page,
        INCIDENT_PAGE,
        theme === "dark" ? "theme=dark" : "",
      );
      await loadProductionFont(page);

      const band: Locator = hero(page).getByTestId("event-header-notice");
      await expect(band).toHaveAttribute("data-tone", "ai");
      await expect(band).toContainText("AI root cause analysis");
      await expect(
        band.getByRole("button", { name: "View full report" }),
      ).toBeVisible();

      // The card's last piece, inside its 1px border, from edge to edge.
      const header: Box = await documentBox(hero(page));
      const box: Box = await documentBox(band);
      expect(
        Math.abs(box.x - (header.x + 1)),
        "band start",
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.width - (header.width - 2)),
        "band width",
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.y + box.height - (header.y + header.height - 1)),
        "band end",
      ).toBeLessThanOrEqual(1);
      // A hairline over it, and no box around it.
      expect(
        await band.evaluate((element: Element): Array<string> => {
          const style: CSSStyleDeclaration = window.getComputedStyle(element);
          return [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ];
        }),
      ).toEqual(["1px", "0px", "0px", "0px"]);
      expect((await headerColours(page)).unreadable).toEqual([]);

      // View full report reads on the label's line, its words level with the label's.
      const middles: Array<number> = await band.evaluate(
        (element: Element): Array<number> => {
          const textMiddle: (root: Element) => number = (
            root: Element,
          ): number => {
            const range: Range = document.createRange();
            range.selectNodeContents(root);
            const box: DOMRect = range.getBoundingClientRect();
            return box.top + box.height / 2;
          };
          const label: Element = element.querySelector("h3")!;
          const report: Element = Array.from(
            element.querySelectorAll("button"),
          ).find((button: Element): boolean => {
            return (button.textContent || "").includes("View full report");
          })!;
          return [textMiddle(label), textMiddle(report)];
        },
      );
      expect(
        Math.abs(middles[0]! - middles[1]!),
        "View full report is level with the label",
      ).toBeLessThanOrEqual(0.5);

      await page.mouse.move(0, 0);
      await screenshotElement(hero(page), `event-header-ai-band-${theme}`);
    });
  }

  test("a maintenance event that missed its start says so in an amber band at the foot of its header", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "sm=overdue");
    await loadProductionFont(page);

    const band: Locator = hero(page).getByTestId("event-header-notice");
    await expect(band).toHaveAttribute("data-tone", "warning");
    await expect(band).toContainText("Start overdue");
    await expect(band).toContainText(
      "Planned to start at Sep 14 2026, 06:00 PM GMT, but it has not been marked as Ongoing yet.",
    );
    await expectHeroDuration(hero(page), "Start overdue by 20 minutes");
    expect((await headerColours(page)).unreadable).toEqual([]);
    await page.mouse.move(0, 0);
    await screenshotElement(hero(page), "event-header-maintenance-overdue");
  });

  /*
   * An event kept to the team until its publish time (#5249) says so in the
   * header's quiet band: not on its status pages yet, from when, and that
   * its subscribers are told then - with Publish Now, which asks first and
   * clears the time. Its Maintenance Details card lists the time and says
   * the 'scheduled' notification waits for it.
   */
  test("a maintenance event not published yet says so in its header, and Publish Now publishes it after asking (?publish=later)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // Nobody has been told about it yet: no feed item says so.
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "publish=later", [
      "Acme Internal Status",
      "4 resources",
      "Mark as Ongoing",
      "Maintenance duration",
    ]);
    await loadProductionFont(page);

    const band: Locator = hero(page).getByTestId("event-header-notice");
    await expect(band).toHaveAttribute("data-tone", "neutral");
    const notice: Locator = band.getByTestId(
      "scheduled-maintenance-publishing-notice",
    );
    await expect(notice).toContainText("Not on status pages yet");
    await expect(notice).toContainText(
      "It shows on its status pages from Sep 14 2026, 07:30 PM GMT, when their subscribers are told it is scheduled.",
    );
    // The state actions stay where they were; the band holds its own.
    await expect(
      heroActions(page).getByRole("button", { name: "Mark as Ongoing" }),
    ).toBeVisible();

    const details: Locator = card(page, "Maintenance Details");
    await expect(
      details.getByTestId("scheduled-maintenance-publish-on-status-pages"),
    ).toHaveText("Sep 14 2026, 07:30 PM GMT");
    await expect(details).toContainText("Sent when it is published");

    expect((await headerColours(page)).unreadable).toEqual([]);
    await page.mouse.move(0, 0);
    await screenshotElement(
      hero(page),
      "event-header-maintenance-not-published-yet",
    );

    await notice.getByRole("button", { name: "Publish Now" }).click();
    const confirm: Locator = page.getByRole("dialog", {
      name: "Publish this event now?",
    });
    await expect(confirm).toContainText(
      "It shows on its status pages at once, and their subscribers are told it is scheduled.",
    );
    // Nothing is written until it is confirmed.
    expect((await fixture(page)).updates).toEqual([]);

    await confirm.getByRole("button", { name: "Publish Now" }).click();
    await expect(confirm).toHaveCount(0);

    expect((await fixture(page)).updates).toEqual([
      {
        modelName: "ScheduledMaintenance",
        id: SCHEDULED_MAINTENANCE_ID,
        data: { publishOnStatusPageAt: null },
      },
    ]);
    // Read again: published from now, so the band is gone.
    await expect(
      hero(page).getByTestId("scheduled-maintenance-publishing-notice"),
    ).toHaveCount(0);
    await expect(
      details.getByTestId("scheduled-maintenance-publish-on-status-pages"),
    ).toHaveCount(0);
  });

  /*
   * The band follows the header's own width (UI review of #5249): beside
   * the words on a wide header, Publish Now's label level with "Not on
   * status pages yet"; on a narrow one - a phone, or the header beside the
   * side menu at 768px - on the line under them. At the end of the band
   * either way, and sized to its label: as a NORMAL button it kept a dialog
   * footer's 12px margin and was pushed off both.
   */
  test("the band keeps Publish Now at its end: beside the words on a wide header, level with them, and under them on a narrow one (?publish=later)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "publish=later", [
      "Acme Internal Status",
      "Mark as Ongoing",
      "Maintenance duration",
    ]);
    await loadProductionFont(page);

    const notice: Locator = hero(page).getByTestId(
      "scheduled-maintenance-publishing-notice",
    );

    for (const [width, isBeside] of [
      [1280, true],
      [1024, true],
      [768, false],
      [390, false],
    ] as Array<[number, boolean]>) {
      await page.setViewportSize({ width, height: 900 });
      await expect(notice).toBeVisible();

      const boxes: {
        contentLeft: number;
        contentRight: number;
        words: { left: number; right: number; bottom: number };
        button: { left: number; right: number; top: number; width: number };
        titleMiddle: number;
        labelMiddle: number;
      } = await notice.evaluate(
        (
          element: Element,
        ): {
          contentLeft: number;
          contentRight: number;
          words: { left: number; right: number; bottom: number };
          button: { left: number; right: number; top: number; width: number };
          titleMiddle: number;
          labelMiddle: number;
        } => {
          const band: Element = element.closest(
            "[data-testid=event-header-notice]",
          )!;
          const bandBox: DOMRect = band.getBoundingClientRect();
          const style: CSSStyleDeclaration = window.getComputedStyle(band);
          const words: DOMRect =
            element.firstElementChild!.getBoundingClientRect();
          const button: Element = element.querySelector(
            "[data-testid=scheduled-maintenance-publish-now]",
          )!;
          const buttonBox: DOMRect = button.getBoundingClientRect();
          const middleOf: (node: Node) => number = (node: Node): number => {
            const range: Range = document.createRange();
            range.selectNodeContents(node);
            const first: DOMRect = range.getClientRects()[0]!;
            return first.top + first.height / 2;
          };
          const label: Node = Array.from(button.childNodes).find(
            (node: Node): boolean => {
              return (
                node.nodeType === Node.TEXT_NODE &&
                (node.textContent || "").trim().length > 0
              );
            },
          )!;

          return {
            contentLeft: bandBox.left + parseFloat(style.paddingLeft),
            contentRight: bandBox.right - parseFloat(style.paddingRight),
            words: {
              left: words.left,
              right: words.right,
              bottom: words.bottom,
            },
            button: {
              left: buttonBox.left,
              right: buttonBox.right,
              top: buttonBox.top,
              width: buttonBox.width,
            },
            titleMiddle: middleOf(element.querySelector("p")!),
            labelMiddle: middleOf(label),
          };
        },
      );

      // At the band's end, at every width - never 12px in from it.
      expect(
        Math.abs(boxes.button.right - boxes.contentRight),
        `${width}px: Publish Now ends where the band's words may end`,
      ).toBeLessThanOrEqual(1);
      // Sized to its label, never stretched across a phone.
      expect(
        boxes.button.width,
        `${width}px: Publish Now is as wide as its label`,
      ).toBeLessThan((boxes.contentRight - boxes.contentLeft) / 2);
      expect(
        Math.abs(boxes.words.left - boxes.contentLeft),
        `${width}px: the words start the band`,
      ).toBeLessThanOrEqual(1);

      if (isBeside) {
        expect(
          boxes.button.left,
          `${width}px: Publish Now is beside the words`,
        ).toBeGreaterThan(boxes.words.right);
        expect(
          Math.abs(boxes.titleMiddle - boxes.labelMiddle),
          `${width}px: Publish Now's label is level with the band's title`,
        ).toBeLessThanOrEqual(0.5);
      } else {
        expect(
          boxes.button.top,
          `${width}px: Publish Now is on the line under the words`,
        ).toBeGreaterThanOrEqual(boxes.words.bottom);
      }

      await page.mouse.move(0, 0);
      await screenshotElement(
        hero(page),
        `event-header-maintenance-not-published-yet-${width}`,
      );
    }
  });

  test("a refused Publish Now says why in its dialog, and the event keeps waiting (?publish=later&fail=publish)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      SCHEDULED_MAINTENANCE_PAGE,
      "publish=later&fail=publish",
      ["Acme Internal Status", "Mark as Ongoing", "Maintenance duration"],
    );

    const notice: Locator = hero(page).getByTestId(
      "scheduled-maintenance-publishing-notice",
    );
    await notice.getByRole("button", { name: "Publish Now" }).click();

    const confirm: Locator = page.getByRole("dialog", {
      name: "Publish this event now?",
    });
    await confirm.getByRole("button", { name: "Publish Now" }).click();

    // The dialog stays, saying why, and nothing is read as published.
    await expect(confirm).toContainText(
      "This scheduled maintenance event could not be updated. Please try again.",
    );
    expect((await fixture(page)).updates).toEqual([
      {
        modelName: "ScheduledMaintenance",
        id: SCHEDULED_MAINTENANCE_ID,
        data: { publishOnStatusPageAt: null },
      },
    ]);
    await expect(
      confirm.getByRole("button", { name: "Publish Now" }),
    ).toBeEnabled();

    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(notice).toContainText("Not on status pages yet");
    await expect(
      card(page, "Maintenance Details").getByTestId(
        "scheduled-maintenance-publish-on-status-pages",
      ),
    ).toHaveText("Sep 14 2026, 07:30 PM GMT");
  });

  test("the details say a reminder due before the event is published is not sent (?publish=later), and say nothing once it is (?publish=past)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "publish=later", [
      "Acme Internal Status",
      "Maintenance duration",
    ]);

    // The 1-hour reminder (19:20) comes before the publish time (19:30).
    const details: Locator = card(page, "Maintenance Details");
    await expect(details).toContainText(
      "Next reminder: Sep 14 2026, 07:20 PM GMT",
    );
    await expect(
      details.getByTestId("scheduled-maintenance-next-reminder-not-sent"),
    ).toHaveText("Reminders due before the event is published are not sent.");

    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "publish=past", [
      "Acme Internal Status",
      "Maintenance duration",
    ]);
    await expect(
      card(page, "Maintenance Details").getByTestId(
        "scheduled-maintenance-publish-on-status-pages",
      ),
    ).toHaveText("Sep 14 2026, 12:00 PM GMT");
    await expect(
      card(page, "Maintenance Details").getByTestId(
        "scheduled-maintenance-next-reminder-not-sent",
      ),
    ).toHaveCount(0);
  });

  test("a maintenance event whose publish time has come shows no band, and its details list the time (?publish=past)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "publish=past");

    await expect(hero(page).getByTestId("event-header-notice")).toHaveCount(0);
    await expect(
      card(page, "Maintenance Details").getByTestId(
        "scheduled-maintenance-publish-on-status-pages",
      ),
    ).toHaveText("Sep 14 2026, 12:00 PM GMT");
  });

  test("someone who may not change an incident's state sees its state actions locked, each saying which permission (?role=alert-member)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page, INCIDENT_PAGE, "state=created&role=alert-member", [
      "Rolling checkout-api back to 2026.09.14-1",
    ]);
    await loadProductionFont(page);

    // What they pressed, in their words - not "create this Incident State Timeline".
    const reason: string =
      "You do not have permission to change this incident's state. You need this permission: Create Incident State Timeline.";
    await expect(heroActions(page).getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
    ]);
    // No ⋯ of other states to move it to either.
    await expect(hero(page).getByTestId("event-header-more-place")).toHaveCount(
      0,
    );

    for (const action of ["incident-acknowledge-btn", "incident-resolve-btn"]) {
      const button: Locator = hero(page).locator(`#${action}`);
      const wrapper: Locator = hero(page).getByTestId(
        `${action}-disabled-wrapper`,
      );
      await expect(button).toBeDisabled();
      await expect(button).toHaveCSS("opacity", "0.5");
      await expect(wrapper).toHaveAttribute("tabindex", "0");
      await wrapper.hover();
      await expect(page.getByRole("tooltip")).toHaveText(reason);
      await wrapper.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.evaluate((): void => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }

    // Locked, they still lay out as the buttons they would be.
    await expectHeaderAtItsWidth(page, "locked 1280px");
    expect((await fixture(page)).creates).toEqual([]);
    // Nor is Add owners offered: an Alert Member may not add an incident's owners.
    await expect(ownersFact(page).getByTestId("event-person-name")).toHaveText([
      "Checkout SRE",
      "Sam Rivera",
    ]);
    await expect(ownersFact(page).getByRole("link")).toHaveCount(0);
    await expect(ownersFact(page).getByRole("button")).toHaveCount(0);
  });

  /*
   * The facts side by side share their rows: a label that wraps makes the
   * row's label line taller for all of them, every value of the row starts
   * on one line and each label sits right above its value. On a phone
   * "INCIDENT COMMANDER" wraps, and the commander's name sat a line lower
   * than "19 minutes" beside it.
   */
  for (const language of ["en", "de"]) {
    test(`the facts of a row start on one line even where a label wraps (${language}, 390px)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await open(
        page,
        INCIDENT_PATH,
        language === "de" ? "state=ongoing&lang=de" : "state=ongoing",
      );
      await expect(
        commanderFact(page).getByTestId("event-person-name"),
      ).toHaveText(["Maya Chen"], { timeout: 30000 });
      await expect(
        hero(page).getByTestId("event-header-duration"),
      ).toBeVisible();
      await loadProductionFont(page);

      const duration: { label: number; value: number; height: number } =
        await factTextTops(hero(page).getByTestId("event-header-duration"));
      const commander: Locator = commanderFact(page);
      const tops: { label: number; value: number; height: number } =
        await factTextTops(commander);
      const labels: Array<{ height: number; bottom: number }> = await hero(page)
        .getByTestId("event-status-facts")
        .locator("dt")
        .evaluateAll(
          (
            elements: Array<Element>,
          ): Array<{ height: number; bottom: number }> => {
            return elements.slice(0, 2).map((element: Element) => {
              const box: DOMRect = element.getBoundingClientRect();
              return { height: box.height, bottom: box.bottom };
            });
          },
        );

      // The commander's label takes two lines; how long's, one.
      expect(labels[1]!.height).toBeGreaterThan(labels[0]!.height + 8);
      // Each label right above its value, at the foot of the shared row.
      expect(
        Math.abs(labels[0]!.bottom - labels[1]!.bottom),
      ).toBeLessThanOrEqual(0.5);
      // And the values on one line.
      expect(
        Math.abs(tops.value - duration.value),
        "the name is level with how long",
      ).toBeLessThanOrEqual(0.5);
      await page.mouse.move(0, 0);
      await screenshotElement(
        hero(page),
        `event-header-facts-row-${language}-390`,
      );
    });
  }

  /*
   * People are listed one a line, as monitors are, at every width - never
   * two names side by side and a third under them - and on an open record
   * the list ends with Add, the same control as on a record nobody owns.
   */
  for (const width of [1280, 1024, 390]) {
    test(`an open incident's owners, one a line, end with Add (${width}px)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReady(page, INCIDENT_PAGE, "state=ongoing&owners=many");
      await loadProductionFont(page);

      const owners: Locator = ownersFact(page);
      const lines: Array<{ left: number; top: number }> = await owners
        .locator(":scope > *")
        .evaluateAll(
          (elements: Array<Element>): Array<{ left: number; top: number }> => {
            return elements.map((element: Element) => {
              const box: DOMRect = element.getBoundingClientRect();
              return { left: box.left, top: box.top };
            });
          },
        );

      // Three people, +3 more, then Add: five lines, one under another.
      expect(lines).toHaveLength(5);
      for (let index: number = 1; index < lines.length; index++) {
        expect(lines[index]!.top, `line ${index + 1}`).toBeGreaterThan(
          lines[index - 1]!.top + 16,
        );
      }

      const add: Locator = owners.getByRole("button", { name: "Add owners" });
      await expect(add).toHaveAttribute("data-testid", "event-owners-add-more");
      await expect(add).toHaveAttribute("title", "Add owners");
      await expect(add).toHaveAttribute("aria-haspopup", "dialog");
      await expect(add).toHaveAttribute("aria-expanded", "false");
      // Visibly "Add", as on a record nobody owns; heard as "Add owners".
      await expect(
        add.locator(":scope > [aria-hidden='true']").last(),
      ).toHaveText("Add");
      await expectEmptyPlace(add);
      // The list's last line, its circle under the avatars.
      expect(
        await owners.evaluate((element: Element): boolean => {
          return Boolean(
            element.lastElementChild?.querySelector(
              ":scope > [data-testid='event-owners-add-more']",
            ),
          );
        }),
      ).toBe(true);
      const avatar: Box = await documentBox(
        owners
          .getByTestId("event-owner")
          .first()
          .locator(":scope > span")
          .first(),
      );
      const place: Box = await documentBox(
        add.getByTestId("event-empty-place"),
      );
      expect(Math.abs(place.x - avatar.x)).toBeLessThanOrEqual(1);

      await page.mouse.move(0, 0);
      await screenshotElement(hero(page), `event-header-owners-add-${width}`);

      /*
       * Add opens the Add owners list right there - nobody leaves the page
       * to add an owner - with whoever owns it already left out: of the
       * project's four people and four teams, Maya Chen and Payments.
       */
      await add.click();
      const list: Locator = addOwnersList(page);
      await expect(list).toBeVisible();
      await expect(add).toHaveAttribute("aria-expanded", "true");
      await expect
        .poll(async (): Promise<Array<string>> => {
          return listedNames(list);
        })
        .toEqual(["Maya Chen", "Payments"]);
      await expectListWhole(page, list);
      expect(new URL(page.url()).pathname).toBe(INCIDENT_PATH);
      await expect(page.getByTestId("stub-page")).toHaveCount(0);
    });
  }

  test("the state track is a 4px line under the states' names", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page, INCIDENT_PAGE, "state=created");

    const heights: Array<number> = await hero(page)
      .getByTestId("event-state-track-segment")
      .evaluateAll((segments: Array<Element>): Array<number> => {
        return segments.map((segment: Element): number => {
          return segment.getBoundingClientRect().height;
        });
      });

    expect(heights).toEqual([4, 4, 4]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Scheduled maintenance
 * ---------------------------------------------------------------------------
 */

interface MaintenancePhase {
  sm: string;
  state: string;
  duration: string;
  actions: ReadonlyArray<string>;
  starts: StatCell;
  ends: StatCell;
  readyText: string;
  overdueNotice?: string | undefined;
}

const MAINTENANCE_PHASES: ReadonlyArray<MaintenancePhase> = [
  {
    sm: "scheduled",
    state: "Scheduled",
    duration: "Starts in 2 hours",
    actions: ["Mark as Ongoing", "Mark as Ended", "More actions"],
    starts: {
      label: "Starts",
      value: "Sep 14 2026, 08:20 PM GMT",
      description: "in 2 hours",
    },
    ends: {
      label: "Ends",
      value: "Sep 14 2026, 09:20 PM GMT",
      description: "in 3 hours",
    },
    readyText: "Next reminder: Sep 14 2026, 07:20 PM GMT",
  },
  {
    sm: "ongoing",
    state: "Ongoing",
    duration: "In progress for 15 minutes",
    actions: ["Mark as Ended", "More actions"],
    starts: {
      label: "Starts",
      value: "Sep 14 2026, 06:05 PM GMT",
      description: "15 minutes ago",
    },
    ends: {
      label: "Ends",
      value: "Sep 14 2026, 07:05 PM GMT",
      description: "in 45 minutes",
    },
    readyText: "Failover started.",
  },
  {
    sm: "ended",
    state: "Ended",
    duration: "Completed in 1 hour, 2 minutes",
    actions: ["More actions"],
    starts: {
      label: "Starts",
      value: "Sep 14 2026, 04:00 PM GMT",
      description: "2 hours ago",
    },
    ends: {
      label: "Ends",
      value: "Sep 14 2026, 05:00 PM GMT",
      description: "1 hour ago",
    },
    readyText: "Failover started.",
  },
  {
    sm: "overdue",
    state: "Scheduled",
    duration: "Start overdue by 20 minutes",
    actions: ["Mark as Ongoing", "Mark as Ended", "More actions"],
    starts: {
      label: "Starts",
      value: "Sep 14 2026, 06:00 PM GMT",
      description: "20 minutes ago",
    },
    ends: {
      label: "Ends",
      value: "Sep 14 2026, 07:00 PM GMT",
      description: "in 40 minutes",
    },
    readyText: "No upcoming reminders",
    overdueNotice: "Start overdue",
  },
  {
    sm: "overrun",
    state: "Ongoing",
    duration: "Overrunning by 30 minutes",
    actions: ["Mark as Ended", "More actions"],
    starts: {
      label: "Starts",
      value: "Sep 14 2026, 04:50 PM GMT",
      description: "2 hours ago",
    },
    ends: {
      label: "Ends",
      value: "Sep 14 2026, 05:50 PM GMT",
      description: "30 minutes ago",
    },
    readyText: "Failover started.",
    overdueNotice: "Overrunning",
  },
];

test.describe("alert affected resources", () => {
  /*
   * An alert names its monitor under Resources Affected in its "created"
   * feed item. The Affected Resources card used to hide monitors, so an
   * alert raised on one read "No resources affected." beside that feed item.
   */
  test("the card lists the monitor the alert was raised on beside its service", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);

    const resources: Locator = card(page, "Affected Resources");
    await expect(
      resources.getByText("Monitors", { exact: true }),
    ).toBeVisible();
    await expect(
      resources.getByText("Payment webhook error rate", { exact: true }),
    ).toBeVisible();
    await expect(
      resources.getByText("payments-webhooks", { exact: true }),
    ).toBeVisible();
    await expect(resources.getByText("across 2 categories")).toBeVisible();
    await expect(resources.getByText("No resources affected.")).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Affected Resources card
 * ---------------------------------------------------------------------------
 *
 * Each category used to be a card of its own - bordered, shadowed, with a
 * coloured bar across its top - inside the page's "Affected Resources" card,
 * so the right column read as cards nested in a card. The categories are now
 * sections of the one card: a tinted icon, the label and its count, then the
 * resources indented under the label, split by hairlines. Every row is one
 * link (the resource's link stretched over the row).
 */

interface ResourcesCase {
  eventPage: EventPage;
  headings: ReadonlyArray<string>;
  summary: string;
  rows: number;
}

const RESOURCES_CASES: ReadonlyArray<ResourcesCase> = [
  {
    eventPage: INCIDENT_PAGE,
    headings: ["Monitors 2", "Services 2"],
    summary: "4 resources across 2 categories",
    rows: 4,
  },
  {
    eventPage: ALERT_PAGE,
    headings: ["Monitors 1", "Services 1"],
    summary: "2 resources across 2 categories",
    rows: 2,
  },
  {
    eventPage: SCHEDULED_MAINTENANCE_PAGE,
    headings: ["Monitors 2", "Services 2"],
    summary: "4 resources across 2 categories",
    rows: 4,
  },
];

// ?resources=many attaches Incident #1042 to five categories.
const MANY_RESOURCES_HEADINGS: ReadonlyArray<string> = [
  "Monitors 6",
  "Hosts 2",
  "Kubernetes Clusters 1",
  "Services 3",
  "SLOs 1",
];
const MANY_RESOURCES_READY: ReadonlyArray<string> = [
  REPORT_CAVEAT,
  "13 resources",
];
const LONG_MONITOR_NAME: string =
  "Checkout web journey (synthetic) from eu-west-1 and us-east-1";

const SLO_HINT: string =
  "SLOs are linked automatically when their burn rate rules fire.";

function resourcesCard(page: Page): Locator {
  return card(page, "Affected Resources");
}

function resourceSections(page: Page): Locator {
  return resourcesCard(page).getByTestId("affected-resource-category");
}

function resourceRows(page: Page): Locator {
  return resourcesCard(page).getByRole("listitem");
}

// The display's root: the summary and the grid of sections.
function resourcesBody(page: Page): Locator {
  return resourcesCard(page)
    .getByTestId("affected-resources-grid")
    .locator("xpath=..");
}

async function resourceHeadings(page: Page): Promise<Array<string>> {
  return resourcesCard(page)
    .getByRole("heading", { level: 3 })
    .evaluateAll((headings: Array<Element>): Array<string> => {
      return headings.map((heading: Element): string => {
        return (heading.textContent || "").replace(/\s+/g, " ").trim();
      });
    });
}

/*
 * What would make something inside the card a card of its own: a shadow, a
 * border (other than the hairline above each section but the first) or a
 * white fill. Read from computed styles, so a class that sneaks it back in
 * any other way is caught too.
 */
async function nestedCardChrome(root: Locator): Promise<Array<string>> {
  return root.evaluate((element: Element): Array<string> => {
    const findings: Array<string> = [];
    const sections: Array<Element> = Array.from(
      element.querySelectorAll("[data-testid='affected-resource-category']"),
    );

    for (const node of [
      element,
      ...Array.from(element.querySelectorAll("*")),
    ]) {
      const style: CSSStyleDeclaration = getComputedStyle(node);
      const name: string = `${node.tagName.toLowerCase()}${
        node.getAttribute("data-testid")
          ? `[${node.getAttribute("data-testid")}]`
          : ""
      } "${(node.textContent || "").trim().slice(0, 24)}"`;

      if (style.boxShadow !== "none") {
        findings.push(`${name}: box-shadow ${style.boxShadow}`);
      }

      for (const side of ["top", "right", "bottom", "left"]) {
        const width: string = style.getPropertyValue(`border-${side}-width`);

        if (width === "0px") {
          continue;
        }

        if (side === "top" && sections.indexOf(node) > 0 && width === "1px") {
          continue;
        }

        findings.push(`${name}: border-${side} ${width}`);
      }

      if (style.backgroundColor === "rgb(255, 255, 255)") {
        findings.push(`${name}: white fill`);
      }
    }

    return findings;
  });
}

// Where the text of an element ends, not the (block-wide) element itself.
async function textRight(locator: Locator): Promise<number> {
  return locator.evaluate((element: Element): number => {
    const walker: TreeWalker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );
    let right: number = 0;

    for (
      let node: Node | null = walker.nextNode();
      node;
      node = walker.nextNode()
    ) {
      if (!(node.textContent || "").trim()) {
        continue;
      }

      const range: Range = document.createRange();
      range.selectNodeContents(node);
      right = Math.max(right, range.getBoundingClientRect().right);
    }

    return right + window.scrollX;
  });
}

async function computed(
  locator: Locator,
  property: string,
  pseudo?: string,
): Promise<string> {
  return locator.evaluate(
    (
      element: Element,
      args: { property: string; pseudo: string | undefined },
    ): string => {
      return getComputedStyle(element, args.pseudo || null).getPropertyValue(
        args.property,
      );
    },
    { property, pseudo },
  );
}

async function expectStubPage(
  page: Page,
  pageKey: string,
  pathname: string,
): Promise<void> {
  const stub: Locator = page.getByTestId("stub-page");
  await expect(stub).toHaveAttribute("data-page", pageKey);
  await expect(stub).toHaveText(pathname);
  expect(new URL(page.url()).pathname).toBe(pathname);
}

test.describe("affected resources card", () => {
  for (const resourcesCase of RESOURCES_CASES) {
    const eventPage: EventPage = resourcesCase.eventPage;

    test(`${eventPage.name} lists resources as sections of its card, not cards inside it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);
      await page.mouse.move(0, 0);

      const resources: Locator = resourcesCard(page);
      expect(await resourceHeadings(page)).toEqual(resourcesCase.headings);
      await expect(
        resources.getByTestId("affected-resources-summary"),
      ).toHaveText(resourcesCase.summary);
      await expect(resourceRows(page)).toHaveCount(resourcesCase.rows);

      // Nothing inside the card is boxed: no shadow, border or white fill.
      expect(await nestedCardChrome(resourcesBody(page))).toEqual([]);

      // The page's card is the one card, and it still draws as one.
      const cardSurface: Locator = resources.locator(":scope > div").first();
      expect(await computed(cardSurface, "box-shadow")).not.toBe("none");
      expect(await computed(cardSurface, "border-top-width")).toBe("1px");

      /*
       * The sections span the card's body evenly. The maintenance card once
       * used the default detail style, whose -mx-3 row at full width ended
       * the display 24px short of the card's right edge.
       */
      const surfaceBox: Box = await documentBox(cardSurface);
      const gridBox: Box = await documentBox(
        resources.getByTestId("affected-resources-grid"),
      );
      const leftInset: number = gridBox.x - surfaceBox.x;
      const rightInset: number =
        surfaceBox.x + surfaceBox.width - (gridBox.x + gridBox.width);
      expect(Math.abs(leftInset - rightInset)).toBeLessThanOrEqual(1);

      // Hovering the body washes nothing between it and the card in grey.
      await resources.getByTestId("affected-resources-summary").hover();
      expect(
        await resourcesBody(page).evaluate(
          (element: Element): Array<string> => {
            const washed: Array<string> = [];
            for (
              let node: Element | null = element;
              node &&
              node.parentElement?.getAttribute("data-testid") !== "card";
              node = node.parentElement
            ) {
              const background: string = getComputedStyle(node).backgroundColor;
              if (background !== "rgba(0, 0, 0, 0)") {
                washed.push(`${node.className}: ${background}`);
              }
            }
            return washed;
          },
        ),
      ).toEqual([]);
      await page.mouse.move(0, 0);

      // A hairline between the sections, none above the first.
      const sections: Locator = resourceSections(page);
      await expect(sections).toHaveCount(resourcesCase.headings.length);
      expect(await computed(sections.nth(0), "border-top-width")).toBe("0px");
      expect(await computed(sections.nth(1), "border-top-width")).toBe("1px");
      expect(await computed(sections.nth(1), "border-top-color")).toBe(
        "rgb(243, 244, 246)",
      );
      for (const index of [0, 1]) {
        const section: Locator = sections.nth(index);
        expect(await computed(section, "background-color")).toBe(
          "rgba(0, 0, 0, 0)",
        );
        expect(await computed(section, "border-top-left-radius")).toBe("0px");
      }

      await screenshotElement(
        resources,
        `${eventPage.name}-affected-resources`,
      );
    });
  }

  test("each resource lines up under its label, past a tinted icon, with the count beside the label", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const section: Locator = resourceSections(page).first();
    const heading: Locator = section.getByRole("heading", { level: 3 });
    const label: Locator = heading.getByText("Monitors", { exact: true });
    const count: Locator = section.getByTestId(
      "affected-resource-category-count",
    );
    const tile: Locator = section.locator(":scope > div > div").first();
    const firstItem: Locator = section
      .getByTestId("affected-resource-item")
      .first();

    const labelBox: Box = await documentBox(label);
    const countBox: Box = await documentBox(count);
    const tileBox: Box = await documentBox(tile);
    const itemBox: Box = await documentBox(firstItem);
    const sectionBox: Box = await documentBox(section);

    // A 24px tinted tile at the section's left edge.
    expect(tileBox.width).toBeCloseTo(24, 0);
    expect(tileBox.height).toBeCloseTo(24, 0);
    expect(Math.abs(tileBox.x - sectionBox.x)).toBeLessThanOrEqual(1);
    expect(await computed(tile, "background-color")).toBe("rgb(239, 246, 255)");
    expect(await computed(tile.locator("svg"), "color")).toBe(
      "rgb(37, 99, 235)",
    );
    // The label starts past it, and the names start where the label does.
    expect(labelBox.x).toBeGreaterThan(tileBox.x + tileBox.width);
    expect(Math.abs(itemBox.x - labelBox.x)).toBeLessThanOrEqual(1);
    // The count follows the label rather than sitting at the far edge.
    const gap: number = countBox.x - (labelBox.x + labelBox.width);
    expect(gap).toBeGreaterThanOrEqual(4);
    expect(gap).toBeLessThanOrEqual(12);
    await expect(count).toHaveText("2");
    // Rows are a comfortable target.
    for (const row of await resourceRows(page).all()) {
      expect((await documentBox(row)).height).toBeGreaterThanOrEqual(32);
    }
  });

  test("a click anywhere on a row opens that resource, not only on its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const clickRowEdge: (row: Locator) => Promise<void> = async (
      row: Locator,
    ): Promise<void> => {
      await row.scrollIntoViewIfNeeded();
      const rowBox: Box = await documentBox(row);
      const nameEnds: number = await textRight(row);
      const x: number = rowBox.width - 4;

      // The point clicked is past the end of the name.
      expect(rowBox.x + x).toBeGreaterThan(nameEnds + 8);
      await row.click({ position: { x, y: rowBox.height / 2 } });
    };

    const monitorRow: Locator = resourceRows(page).filter({
      hasText: "Checkout API p95 latency",
    });
    await expect(monitorRow.getByRole("link")).toHaveAttribute(
      "href",
      `${DASHBOARD}/monitors/${uuid("70000000", 1)}`,
    );
    await clickRowEdge(monitorRow);
    await expectStubPage(
      page,
      "MONITOR_VIEW",
      `${DASHBOARD}/monitors/${uuid("70000000", 1)}`,
    );

    await page.goBack();
    await expectPageReady(page, INCIDENT_PAGE);

    const serviceRow: Locator = resourceRows(page).filter({
      hasText: "orders-db",
    });
    const serviceHref: string = (await serviceRow
      .getByRole("link")
      .getAttribute("href"))!;
    expect(serviceHref).toBe(`${DASHBOARD}/service/${uuid("75000000", 2)}`);
    await clickRowEdge(serviceRow);
    await expectStubPage(page, "SERVICE_VIEW", serviceHref);
  });

  test("hovering a row lights up the whole row and underlines its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    await page.mouse.move(0, 0);

    const row: Locator = resourceRows(page).first();
    const link: Locator = row.getByRole("link");
    await row.scrollIntoViewIfNeeded();
    expect(await computed(row, "background-color")).toBe("rgba(0, 0, 0, 0)");
    expect(await computed(link, "text-decoration-line")).toBe("none");

    // Over the empty end of the row, well past the name.
    const rowBox: DOMRect = await row.evaluate((element: Element): DOMRect => {
      return element.getBoundingClientRect();
    });
    await page.mouse.move(
      rowBox.x + rowBox.width - 4,
      rowBox.y + rowBox.height / 2,
    );

    await expect
      .poll(async (): Promise<string> => {
        return computed(row, "background-color");
      })
      .toBe("rgb(249, 250, 251)");
    expect(await computed(link, "text-decoration-line")).toBe("underline");
    expect(await computed(link, "cursor")).toBe("pointer");
    // The pointer is over the link's stretched overlay, not dead space.
    expect(
      await page.evaluate(
        ({ x, y }: { x: number; y: number }): string | undefined => {
          return document
            .elementFromPoint(x, y)
            ?.closest("a")
            ?.textContent?.trim();
        },
        { x: rowBox.x + rowBox.width - 4, y: rowBox.y + rowBox.height / 2 },
      ),
    ).toBe("Checkout API p95 latency");
  });

  test("keyboard: Tab from Edit reaches each resource with a ring round its row, and Enter opens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    await resourcesCard(page)
      .getByTestId("card-header-actions")
      .getByRole("button", { name: "Edit" })
      .focus();
    await page.keyboard.press("Tab");

    const firstLink: Locator = resourceRows(page).first().getByRole("link");
    await expect(firstLink).toBeFocused();
    // The ring is drawn by the stretched overlay, around the whole row.
    expect(await computed(firstLink, "box-shadow", "::after")).toContain(
      "rgb(99, 102, 241)",
    );
    expect(await computed(firstLink, "position", "::after")).toBe("absolute");
    // The link's own outline, which the truncation would clip, is off.
    expect(await computed(firstLink, "outline-color")).toBe("rgba(0, 0, 0, 0)");

    await page.keyboard.press("Tab");
    const secondLink: Locator = resourceRows(page).nth(1).getByRole("link");
    await expect(secondLink).toBeFocused();
    expect(await computed(firstLink, "box-shadow", "::after")).not.toContain(
      "rgb(99, 102, 241)",
    );

    await page.keyboard.press("Enter");
    await expectStubPage(
      page,
      "MONITOR_VIEW",
      `${DASHBOARD}/monitors/${uuid("70000000", 2)}`,
    );
  });

  test("?resources=many: five categories, and Show more opens the rest in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "resources=many",
      MANY_RESOURCES_READY,
    );

    const resources: Locator = resourcesCard(page);
    expect(await resourceHeadings(page)).toEqual(MANY_RESOURCES_HEADINGS);
    await expect(
      resources.getByTestId("affected-resources-summary"),
    ).toHaveText("13 resources across 5 categories");
    expect(await nestedCardChrome(resourcesBody(page))).toEqual([]);

    // No label is cut short in the sidebar, the longest included.
    const labels: Locator = resources
      .getByRole("heading", { level: 3 })
      .locator(":scope > span:first-child");
    await expect(labels).toHaveText([
      "Monitors",
      "Hosts",
      "Kubernetes Clusters",
      "Services",
      "SLOs",
    ]);
    for (const label of await labels.all()) {
      expect(await isOverflowing(label)).toBe(false);
    }

    const monitors: Locator = resources.getByRole("list", {
      name: "Monitors 6",
    });
    await expect(monitors.getByRole("listitem")).toHaveCount(4);
    // By what it controls, since its name changes when it is pressed.
    const listId: string = (await monitors.getAttribute("id"))!;
    const toggle: Locator = resources.locator(
      `button[aria-controls="${listId}"]`,
    );
    await expect(toggle).toHaveText("Show 2 more");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(resources.getByText("Cart API p99 latency")).toHaveCount(0);

    /*
     * A name wider than the sidebar ends in an ellipsis, whole in its title.
     * The element's own flex name span is what truncates: the row turns it
     * into a truncating block.
     */
    const longItem: Locator = resources.getByTitle(LONG_MONITOR_NAME);
    await expect(longItem).toBeVisible();
    const longName: Locator = longItem.locator("span.flex");
    expect(await isOverflowing(longName)).toBe(true);
    expect(await computed(longName, "text-overflow")).toBe("ellipsis");
    expect(await computed(longName, "white-space")).toBe("nowrap");

    const hostsBefore: Box = await documentBox(
      resources.getByRole("list", { name: "Hosts 2" }),
    );

    await toggle.click();
    await expect(monitors.getByRole("listitem")).toHaveCount(6);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("Show less");
    await expect(monitors.getByText("Cart API p99 latency")).toBeVisible();
    await expect(monitors.getByText("CDN edge eu-west")).toBeVisible();
    // In place: the sections below make room.
    const hostsAfter: Box = await documentBox(
      resources.getByRole("list", { name: "Hosts 2" }),
    );
    expect(hostsAfter.y).toBeGreaterThan(hostsBefore.y + 50);

    await page.mouse.move(0, 0);
    await screenshotElement(resources, "incident-affected-resources-many");

    await toggle.click();
    await expect(monitors.getByRole("listitem")).toHaveCount(4);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveText("Show 2 more");
    await expect(resources.getByText("Cart API p99 latency")).toHaveCount(0);
  });

  test("?resources=many: host, cluster and SLO rows open their own pages", async ({
    page,
  }: {
    page: Page;
  }) => {
    const targets: ReadonlyArray<[string, string, string]> = [
      ["checkout-api-7f9c", "HOST_VIEW", uuid("84000000", 1)],
      ["prod-eks-eu-west-1", "KUBERNETES_CLUSTER_VIEW", uuid("85000000", 1)],
      ["Checkout availability 99.9%", "SLO_VIEW", uuid("86000000", 1)],
    ];

    for (const [name, pageKey, id] of targets) {
      await openReady(
        page,
        INCIDENT_PAGE,
        "resources=many",
        MANY_RESOURCES_READY,
      );
      const link: Locator = resourceRows(page)
        .filter({ hasText: name })
        .getByRole("link");
      const href: string = (await link.getAttribute("href"))!;
      expect(href).toContain(id);
      await link.click();
      await expectStubPage(page, pageKey, href);
    }
  });

  test("?resources=many fits a 390px phone, expanded too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(
      page,
      INCIDENT_PAGE,
      "resources=many",
      MANY_RESOURCES_READY,
    );

    const resources: Locator = resourcesCard(page);
    await resources.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    await resources.getByRole("button", { name: "Show 2 more" }).click();
    await expect(resourceRows(page)).toHaveCount(13);
    await expectNoHorizontalOverflow(page);

    const cardBox: Box = await documentBox(resources);
    for (const row of await resourceRows(page).all()) {
      const rowBox: Box = await documentBox(row);
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(
        cardBox.x + cardBox.width,
      );
    }
    // The long name is cut with an ellipsis rather than widening the card.
    const longName: Locator = resources
      .getByTitle(LONG_MONITOR_NAME)
      .locator("span.flex");
    expect(await isOverflowing(longName)).toBe(true);
    expect(await computed(longName, "text-overflow")).toBe("ellipsis");
    await page.mouse.move(0, 0);
    await screenshotElement(resources, "incident-affected-resources-mobile");
  });

  test("?resources=none: the incident's empty state is open text that says SLOs are linked for it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "resources=none", [
      REPORT_CAVEAT,
      "No resources affected.",
    ]);

    const resources: Locator = resourcesCard(page);
    const empty: Locator = resources.getByTestId("affected-resources-empty");
    await expect(empty).toContainText("No resources affected.");
    await expect(empty).toContainText(SLO_HINT);
    await expect(resources.getByTestId("affected-resources-grid")).toHaveCount(
      0,
    );
    await expect(resources.getByRole("heading", { level: 3 })).toHaveCount(0);
    // No dashed, tinted box inside the card.
    expect(await nestedCardChrome(empty)).toEqual([]);
    expect(await computed(empty, "border-top-width")).toBe("0px");
    expect(await computed(empty, "background-color")).toBe("rgba(0, 0, 0, 0)");
    await screenshotElement(resources, "incident-affected-resources-empty");
  });

  test("?resources=none: scheduled maintenance never promises SLOs, which nothing links to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "resources=none", [
      "Subscribers notified",
      "No resources affected.",
    ]);

    const empty: Locator = resourcesCard(page).getByTestId(
      "affected-resources-empty",
    );
    await expect(empty).toContainText("No resources affected.");
    await expect(empty).toContainText(
      "Attach monitors, hosts, clusters, or services",
    );
    await expect(empty).not.toContainText("SLOs");
  });

  const THEMES: ReadonlyArray<{
    theme: string;
    query: string;
    label: string;
    item: string;
    countFill: string;
    countText: string;
    divider: string;
    hover: string;
    tile: string;
  }> = [
    {
      theme: "light",
      query: "",
      label: "rgb(17, 24, 39)",
      item: "rgb(55, 65, 81)",
      countFill: "rgb(243, 244, 246)",
      countText: "rgb(75, 85, 99)",
      divider: "rgb(243, 244, 246)",
      hover: "rgb(249, 250, 251)",
      tile: "rgb(239, 246, 255)",
    },
    {
      /*
       * Theme.css: --ou-text-primary, --ou-text-secondary,
       * --ou-surface-tertiary, --ou-text-muted, --ou-border-subtle,
       * --ou-surface-secondary and blue-50's remap.
       */
      theme: "dark",
      query: "theme=dark",
      label: "rgb(248, 250, 252)",
      item: "rgb(226, 232, 240)",
      countFill: "rgb(39, 52, 73)",
      countText: "rgb(203, 213, 225)",
      divider: "rgb(51, 65, 85)",
      hover: "rgb(30, 41, 59)",
      tile: "rgba(30, 64, 175, 0.28)",
    },
  ];

  for (const colours of THEMES) {
    test(`${colours.theme} theme: labels, rows, counts, hairlines and hover use its palette`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE, colours.query);
      await page.mouse.move(0, 0);

      const section: Locator = resourceSections(page).first();
      const row: Locator = resourceRows(page).first();
      const count: Locator = section.getByTestId(
        "affected-resource-category-count",
      );

      expect(
        await computed(section.getByText("Monitors", { exact: true }), "color"),
      ).toBe(colours.label);
      expect(await computed(row, "color")).toBe(colours.item);
      expect(await computed(count, "background-color")).toBe(colours.countFill);
      expect(await computed(count, "color")).toBe(colours.countText);
      expect(
        await computed(resourceSections(page).nth(1), "border-top-color"),
      ).toBe(colours.divider);
      expect(
        await computed(
          section.locator(":scope > div > div").first(),
          "background-color",
        ),
      ).toBe(colours.tile);

      await row.hover({ position: { x: 4, y: 4 } });
      await expect
        .poll(async (): Promise<string> => {
          return computed(row, "background-color");
        })
        .toBe(colours.hover);

      await page.mouse.move(0, 0);
      await screenshotElement(
        resourcesCard(page),
        `incident-affected-resources-${colours.theme}`,
      );
    });
  }
});

test.describe("scheduled maintenance overview", () => {
  for (const phase of MAINTENANCE_PHASES) {
    test(`?sm=${phase.sm} shows "${phase.duration}", its actions and the window`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, SCHEDULED_MAINTENANCE_PAGE, `sm=${phase.sm}`, [
        "Subscribers notified",
        "Acme Internal Status",
        "4 resources",
        phase.readyText,
      ]);

      const header: Locator = hero(page);
      await expect(header.getByRole("heading", { level: 2 })).toHaveText(
        SCHEDULED_MAINTENANCE_PAGE.title,
      );
      await expect(header.getByTitle("Number", { exact: true })).toHaveText(
        "#58",
      );
      await expectRenderedText(heroChips(page), phase.state);
      await expectHeroDuration(header, phase.duration);
      expect(await heroFacts(header)).toEqual(SCHEDULED_MAINTENANCE_PAGE.facts);

      const actions: Locator = page.getByRole("group", {
        name: "Event actions",
      });
      await expect(actions.getByRole("button")).toHaveCount(
        phase.actions.length,
      );
      for (const action of phase.actions) {
        await expect(
          actions.getByRole("button", { name: action, exact: true }),
        ).toBeVisible();
      }

      const notice: Locator = page.getByTestId(
        "scheduled-maintenance-overdue-notice",
      );
      if (phase.overdueNotice) {
        await expect(notice).toBeVisible();
        await expect(notice).toContainText(phase.overdueNotice);
        await expect(notice).toContainText(
          phase.sm === "overdue"
            ? "Planned to start at Sep 14 2026, 06:00 PM GMT"
            : "Planned to end at Sep 14 2026, 05:50 PM GMT",
        );
      } else {
        await expect(notice).toHaveCount(0);
      }

      expect(await statCells(page, "Maintenance window")).toEqual([
        phase.starts,
        phase.ends,
        {
          label: "Duration",
          value: "1 hour",
          description: "Planned window · times in GMT",
        },
      ]);
      await expect(card(page, "Scheduled Maintenance Feed")).toBeVisible();
      await expectNoErrorStates(page);
    });
  }

  test("the details card, feed and affected resources sit in their columns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE);
    await expectRightColumn(page, SCHEDULED_MAINTENANCE_PAGE);

    const details: Locator = card(page, "Maintenance Details");
    await expect(
      details.getByRole("link", { name: "Acme Commerce Status" }),
    ).toHaveAttribute(
      "href",
      `${DASHBOARD}/status-pages/${uuid("74000000", 1)}`,
    );
    await expect(details).toContainText("1 Day before the event begins");
    await expect(details).toContainText("1 Hour before the event begins");
    await expect(details).toContainText("Notifications Sent");

    const feed: Locator = card(page, "Scheduled Maintenance Feed");
    await expect(feed.getByRole("listitem")).toHaveCount(3);
    await expect(feed).toContainText("Public note");
    await expectAbove(
      page.getByRole("group", { name: "Maintenance window" }),
      feed,
      "stat bar before the feed",
    );
  });

  test("Mark as Ongoing refreshes the event in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE);

    await watchForSkeleton(page);
    const actions: Locator = page.getByRole("group", { name: "Event actions" });
    await actions.getByRole("button", { name: "Mark as Ongoing" }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Mark Scheduled Maintenance as Ongoing",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("This updates the event timeline.");
    await expect(
      dialog.getByRole("checkbox", { name: "Notify Status Page Subscribers" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Add a public note" }),
    ).toHaveAttribute("aria-expanded", "false");
    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Mark as Ongoing", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    await expectRenderedText(heroChips(page), "Ongoing");
    await expect
      .poll(async (): Promise<string> => {
        return heroDuration(hero(page));
      })
      .toMatch(/^In progress for /);
    await expect(
      actions.getByRole("button", { name: "Mark as Ongoing" }),
    ).toHaveCount(0);
    const creates: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "ScheduledMaintenanceStateTimeline";
      },
    );
    expect(creates).toHaveLength(1);
    expect(await skeletonWasSeen(page)).toBe(false);
    await expectNoErrorStates(page);
  });

  test("?fail=resend shows the resend error inline", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "fail=resend", [
      "Acme Internal Status",
      "4 resources",
    ]);

    const details: Locator = card(page, "Maintenance Details");
    await details.getByRole("button", { name: "more details" }).click();
    await page
      .getByRole("dialog", { name: "Notification Status Details" })
      .getByRole("button", { name: "Retry" })
      .click();
    await expect(details.getByRole("alert")).toHaveText(
      "Could not resend notifications: Notifications cannot be resent while the email provider is rate limiting this project.",
    );
    expect((await fixture(page)).updates).toHaveLength(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Episodes
 * ---------------------------------------------------------------------------
 */

interface EpisodeCase {
  page: EventPage;
  /*
   * How the members card reads its rows: the episode's membership rows, then
   * the members they name, by id. A member's own incidentEpisodeId /
   * alertEpisodeId names only the latest episode it is in, so it is never
   * asked.
   */
  membershipModel: string;
  memberIdField: string;
  memberModel: string;
  episodeIdField: string;
  sortField: string;
  // Every member's id, in the order they joined the episode.
  memberIds: ReadonlyArray<string>;
  membersCard: string;
  count: string;
  viewAll: { name: string; href: string; stubPage: string };
  members: ReadonlyArray<{
    number: string;
    title: string;
    href: string;
    severity: string;
  }>;
}

const EPISODES: ReadonlyArray<EpisodeCase> = [
  {
    page: INCIDENT_EPISODE_PAGE,
    membershipModel: "IncidentEpisodeMember",
    memberIdField: "incidentId",
    memberModel: "Incident",
    episodeIdField: "incidentEpisodeId",
    sortField: "declaredAt",
    memberIds: [1038, 1040, 1041, 1042].map((number: number): string => {
      return uuid("20000000", number);
    }),
    membersCard: "Incidents in this episode",
    count: "4 incidents",
    viewAll: {
      name: "View all incidents",
      href: `${INCIDENT_EPISODE_PATH}/incidents`,
      stubPage: "INCIDENT_EPISODE_VIEW_INCIDENTS",
    },
    members: [
      {
        number: "#1042",
        title: "Checkout API p95 latency above 2s",
        href: incidentPath(1042),
        severity: "SEV-2",
      },
      {
        number: "#1041",
        title: "Checkout synthetic check failing in eu-west-1",
        href: incidentPath(1041),
        severity: "SEV-2",
      },
      {
        number: "#1040",
        title: "Orders DB connection pool saturated",
        href: incidentPath(1040),
        severity: "SEV-2",
      },
      {
        // Also in a later episode, which its own incidentEpisodeId names.
        number: "#1038",
        title: "Cart service 5xx rate above 2%",
        href: incidentPath(1038),
        severity: "SEV-3",
      },
    ],
  },
  {
    page: ALERT_EPISODE_PAGE,
    membershipModel: "AlertEpisodeMember",
    memberIdField: "alertId",
    memberModel: "Alert",
    episodeIdField: "alertEpisodeId",
    sortField: "createdAt",
    memberIds: [305, 307, 309, 310, 311].map((number: number): string => {
      return uuid("30000000", number);
    }),
    membersCard: "Alerts in this episode",
    count: "5 alerts",
    viewAll: {
      name: "View all alerts",
      href: `${ALERT_EPISODE_PATH}/alerts`,
      stubPage: "ALERT_EPISODE_VIEW_ALERTS",
    },
    members: [
      {
        number: "#311",
        title: "Payment webhook 5xx rate above 5%",
        href: alertPath(311),
        severity: "High",
      },
      {
        number: "#310",
        title: "Payment provider callback retries above 50/min",
        href: alertPath(310),
        severity: "High",
      },
      {
        number: "#309",
        title: "Refund callback queue backlog above 500",
        href: alertPath(309),
        severity: "Low",
      },
      {
        number: "#307",
        title: "Payment webhook 5xx rate above 2%",
        href: alertPath(307),
        severity: "Low",
      },
      {
        // Also in a later episode, which its own alertEpisodeId names.
        number: "#305",
        title: "Payment webhook latency above 3s",
        href: alertPath(305),
        severity: "Low",
      },
    ],
  },
];

test.describe("episode overviews", () => {
  for (const episode of EPISODES) {
    const eventPage: EventPage = episode.page;
    const noun: string =
      eventPage === INCIDENT_EPISODE_PAGE ? "incident" : "alert";

    test(`${eventPage.name} hero and stat bar`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);
      await expectHero(page, eventPage);
      await expect(
        page.getByRole("group", { name: "Event actions" }).getByRole("button"),
      ).toHaveCount(0);
      expect(await statCells(page, eventPage.statBar)).toEqual(eventPage.stats);
      await expectAbove(
        hero(page),
        page.getByRole("group", { name: eventPage.statBar }),
        "hero before stat bar",
      );
    });

    test(`${eventPage.name} members card previews the newest ${noun}s`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);

      const members: Locator = card(
        page,
        new RegExp(`^${episode.membersCard}`),
      );
      await expect(members.getByTestId("episode-members-count")).toHaveText(
        episode.count,
      );
      const rows: Locator = members.getByTestId("episode-member-row");
      await expect(rows).toHaveCount(episode.members.length);
      for (const [index, member] of episode.members.entries()) {
        const row: Locator = rows.nth(index);
        await expect(row.getByTestId("episode-member-number")).toHaveText(
          member.number,
        );
        const link: Locator = row.getByRole("link", {
          name: member.title,
          exact: true,
        });
        await expect(link).toHaveAttribute("href", member.href);
        await expect(link).toHaveAttribute("title", member.title);
        await expect(row.getByTestId("episode-member-state")).toHaveText(
          "Resolved",
        );
        await expect(row.getByTestId("episode-member-state")).toHaveAttribute(
          "title",
          "State: Resolved",
        );
        await expect(row.getByTestId("episode-member-severity")).toHaveText(
          member.severity,
        );
      }

      const viewAll: Locator = members.getByRole("link", {
        name: episode.viewAll.name,
      });
      await expect(viewAll).toHaveAttribute("href", episode.viewAll.href);
      await expectAbove(
        members,
        card(page, eventPage.feed),
        "members before feed",
      );

      const requests: Array<RecordedModelRequest> = (await fixture(page))
        .listRequests;

      // The episode's membership: the page's snapshot and the card each read it.
      const membershipReads: Array<RecordedModelRequest> = requests.filter(
        (request: RecordedModelRequest): boolean => {
          return request.modelName === episode.membershipModel;
        },
      );
      expect(membershipReads, "membership reads").toHaveLength(2);
      for (const read of membershipReads) {
        expect(Object.keys(read.query || {})).toEqual([episode.episodeIdField]);
        expect(JSON.stringify(read.query)).toContain(
          eventPage === INCIDENT_EPISODE_PAGE
            ? INCIDENT_EPISODE_ID
            : ALERT_EPISODE_ID,
        );
        expect(read.select).toEqual({ [episode.memberIdField]: true });
      }

      // Then the members it names, by id: newest first, up to eight.
      const list: RecordedModelRequest | undefined = requests.find(
        (request: RecordedModelRequest): boolean => {
          return (
            request.modelName === episode.memberModel && request.limit === 8
          );
        },
      );
      expect(list, "members preview request").toBeDefined();
      expect(list?.skip).toBe(0);
      expect(list?.sort).toEqual({ [episode.sortField]: "DESC" });
      expect(list?.query).toEqual({
        _id: { _type: "Includes", value: episode.memberIds },
      });

      // The telemetry snapshot's first member comes from the same membership.
      const firstMember: RecordedModelRequest | undefined = requests.find(
        (request: RecordedModelRequest): boolean => {
          return (
            request.modelName === episode.memberModel && request.limit === 1
          );
        },
      );
      expect(firstMember, "first member request").toBeDefined();
      expect(firstMember?.sort).toEqual({ [episode.sortField]: "ASC" });
      expect(firstMember?.query).toEqual({
        _id: { _type: "Includes", value: episode.memberIds },
      });

      // No read asks for members by their own episode link.
      for (const request of requests) {
        if (request.modelName === episode.memberModel) {
          expect(Object.keys(request.query || {})).not.toContain(
            episode.episodeIdField,
          );
        }
      }

      await viewAll.click();
      await expect(page.getByTestId("stub-page")).toHaveAttribute(
        "data-page",
        episode.viewAll.stubPage,
      );
    });

    test(`${eventPage.name} details card and right column`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);
      await expectRightColumn(page, eventPage);
      const details: Locator = card(page, "Episode Details");
      await expect(details).toContainText(
        eventPage === INCIDENT_EPISODE_PAGE
          ? "Checkout incidents within 30 minutes"
          : "Payments webhook alerts",
      );
      /*
       * The episode's ID is no longer a full-width pill among the fields: it
       * is the card's ID line, the whole ID in its text and one click from
       * the clipboard.
       */
      await expect(
        details.getByRole("button", { name: /^[0-9a-f-]{36}$/ }),
      ).toHaveCount(0);
      await expect(details.getByTestId("detail-id-value")).toHaveText(
        eventPage === INCIDENT_EPISODE_PAGE
          ? INCIDENT_EPISODE_ID
          : ALERT_EPISODE_ID,
      );
    });

    test(`${eventPage.name} ?state=ongoing resolves from the hero in place`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage, "state=ongoing");

      const actions: Locator = page.getByRole("group", {
        name: "Event actions",
      });
      await expect(actions.getByRole("button")).toHaveText(["Resolve"]);
      await expect(page.locator("#episode-resolve-btn")).toBeVisible();
      await expectRenderedText(
        heroChips(page),
        `Acknowledged ${eventPage.severity || ""}`,
      );

      await watchForSkeleton(page);
      await actions.getByRole("button", { name: "Resolve" }).click();
      const dialog: Locator = page.getByRole("dialog", {
        name: "Resolve Episode",
      });
      await expect(dialog).toBeVisible();
      await dialog
        .getByTestId("modal-footer")
        .getByRole("button", { name: "Resolve", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);

      await expect(actions.getByRole("button")).toHaveCount(0);
      await expectRenderedText(
        heroChips(page),
        `Resolved ${eventPage.severity || ""}`,
      );
      expect(await skeletonWasSeen(page)).toBe(false);
      await expect(
        card(page, new RegExp(`^${episode.membersCard}`)).getByTestId(
          "episode-member-row",
        ),
      ).toHaveCount(episode.members.length);
    });
  }

  test("?state=created episode offers Acknowledge and Resolve", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_EPISODE_PAGE, "state=created");
    const actions: Locator = page.getByRole("group", { name: "Event actions" });
    await expect(actions.getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
    ]);
    await expect(page.locator("#episode-acknowledge-btn")).toBeVisible();
    await actions.getByRole("button", { name: "Acknowledge" }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Acknowledge Episode",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("close-button").click();
    await expect(dialog).toHaveCount(0);
    expect((await fixture(page)).creates).toEqual([]);
  });

  test("the incident episode roles card lists its assignments", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_EPISODE_PAGE);
    const roles: Locator = card(page, "Episode Roles");
    await expect(roles).toContainText("Incident Commander");
    await expect(roles).toContainText("Maya Chen");
    await expect(roles).toContainText("Communications Lead");
    await expect(
      roles.getByRole("button", {
        name: "Reassign Incident Commander from Maya Chen",
      }),
    ).toBeVisible();
    await expectAbove(
      card(page, "Episode Details"),
      roles,
      "details before roles",
    );
  });

  test("a member row opens the incident", async ({ page }: { page: Page }) => {
    await openReady(page, INCIDENT_EPISODE_PAGE);
    await card(page, /^Incidents in this episode/)
      .getByRole("link", { name: "Orders DB connection pool saturated" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${incidentPath(1040)}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "#1040 Orders DB connection pool saturated",
    );
    await expect(hero(page)).toContainText("#1040");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Notes from the feed
 * ---------------------------------------------------------------------------
 */

/*
 * "Add Public Note" and "Add Private Note" in a feed's Actions menu open the
 * event's Notes page composer in a dialog: one step, with templates, Draft
 * with AI and who the note reaches. They used to open a two-step form with a
 * Summary page and a required Posted At.
 */
interface FeedNoteCase {
  eventPage: EventPage;
  action: "Add Public Note" | "Add Private Note";
  modelName: string;
  parentIdField: string;
  feedModelName: string;
  submitLabel: string;
}

const FEED_NOTES: ReadonlyArray<FeedNoteCase> = [
  {
    eventPage: INCIDENT_PAGE,
    action: "Add Public Note",
    modelName: "IncidentPublicNote",
    parentIdField: "incidentId",
    feedModelName: "IncidentFeed",
    submitLabel: "Post update",
  },
  {
    eventPage: INCIDENT_PAGE,
    action: "Add Private Note",
    modelName: "IncidentInternalNote",
    parentIdField: "incidentId",
    feedModelName: "IncidentFeed",
    submitLabel: "Add note",
  },
  {
    eventPage: ALERT_PAGE,
    action: "Add Private Note",
    modelName: "AlertInternalNote",
    parentIdField: "alertId",
    feedModelName: "AlertFeed",
    submitLabel: "Add note",
  },
  {
    eventPage: SCHEDULED_MAINTENANCE_PAGE,
    action: "Add Public Note",
    modelName: "ScheduledMaintenancePublicNote",
    parentIdField: "scheduledMaintenanceId",
    feedModelName: "ScheduledMaintenanceFeed",
    submitLabel: "Post update",
  },
  {
    eventPage: INCIDENT_EPISODE_PAGE,
    action: "Add Public Note",
    modelName: "IncidentEpisodePublicNote",
    parentIdField: "incidentEpisodeId",
    feedModelName: "IncidentEpisodeFeed",
    submitLabel: "Post update",
  },
  {
    eventPage: ALERT_EPISODE_PAGE,
    action: "Add Private Note",
    modelName: "AlertEpisodeInternalNote",
    parentIdField: "alertEpisodeId",
    feedModelName: "AlertEpisodeFeed",
    submitLabel: "Add note",
  },
];

async function openFeedNoteDialog(
  page: Page,
  noteCase: FeedNoteCase,
): Promise<Locator> {
  await card(page, noteCase.eventPage.feed)
    .getByTestId("feed-actions-button")
    .click();
  await page
    .getByRole("menuitem", { name: noteCase.action, exact: true })
    .click();
  const dialog: Locator = page.getByRole("dialog", { name: noteCase.action });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function feedReads(page: Page, modelName: string): Promise<number> {
  return (await fixture(page)).listRequests.filter(
    (request: RecordedModelRequest): boolean => {
      return request.modelName === modelName;
    },
  ).length;
}

async function notesPosted(
  page: Page,
  modelName: string,
): Promise<Array<RecordedWrite>> {
  return (await fixture(page)).creates.filter(
    (write: RecordedWrite): boolean => {
      return write.modelName === modelName;
    },
  );
}

test.describe("notes from the feed", () => {
  for (const noteCase of FEED_NOTES) {
    test(`${noteCase.eventPage.name}: ${noteCase.action} is the Notes page composer, in one step`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, noteCase.eventPage);
      const readsBefore: number = await feedReads(page, noteCase.feedModelName);

      const dialog: Locator = await openFeedNoteDialog(page, noteCase);
      const composer: Locator = dialog.getByTestId("note-composer");
      const submit: Locator = dialog.getByTestId("modal-footer-submit-button");

      await expect(composer).toBeVisible();
      await expect(dialog.getByTestId("note-audience")).toContainText(
        noteCase.action === "Add Public Note"
          ? "Visible on your status page"
          : "Only your team can see this",
      );
      // No wizard, no Summary page, no Posted At up front.
      await expect(
        dialog.getByRole("button", { name: "Next", exact: true }),
      ).toHaveCount(0);
      await expect(dialog.getByText("Summary", { exact: true })).toHaveCount(0);
      await expect(dialog.getByTestId("note-posted-at-input")).toHaveCount(0);
      await expect(submit).toHaveText(noteCase.submitLabel);
      await expect(submit).toBeDisabled();

      // The cursor is in the note.
      const editor: Locator = composer.locator('[contenteditable="true"]');
      await expect(editor).toBeFocused();
      await page.keyboard.type("Rolled back the deploy; watching p95.");
      await expect(submit).toBeEnabled();
      await submit.click();

      await expect(dialog).toHaveCount(0);

      const posted: Array<RecordedWrite> = await notesPosted(
        page,
        noteCase.modelName,
      );
      expect(posted).toHaveLength(1);
      expect(posted[0]!.data!["note"]).toBe(
        "Rolled back the deploy; watching p95.",
      );
      expect(
        JSON.stringify(posted[0]!.data![noteCase.parentIdField]),
      ).toContain(noteCase.eventPage.recordId);

      if (noteCase.action === "Add Public Note") {
        // Always sent, never left to the server; posted now.
        expect(
          typeof posted[0]!.data![
            "shouldStatusPageSubscribersBeNotifiedOnNoteCreated"
          ],
        ).toBe("boolean");
        expect(posted[0]!.data!["postedAt"]).toBeTruthy();
      } else {
        expect(
          posted[0]!.data![
            "shouldStatusPageSubscribersBeNotifiedOnNoteCreated"
          ],
        ).toBeUndefined();
      }

      // The feed reads itself again, in place.
      await expect
        .poll(async (): Promise<number> => {
          return feedReads(page, noteCase.feedModelName);
        })
        .toBeGreaterThan(readsBefore);
    });
  }

  test("the incident's public note says who it reaches and can be previewed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const dialog: Locator = await openFeedNoteDialog(page, FEED_NOTES[0]!);

    await expect(dialog.getByTestId("note-notify-checkbox")).toBeVisible();
    await expect(
      dialog.getByTestId("incident-public-note-audience"),
    ).toBeVisible();
    await expect(
      dialog.getByTestId("incident-public-note-preview-notification"),
    ).toBeVisible();
    expect(
      (await apiRequestsTo(page, "/incident/subscriber-audience")).length,
    ).toBeGreaterThan(0);
  });

  /*
   * "This preview notification button is quite big. Can we please improve
   * the UI?" In the feed's dialog too, 'Preview' is a small link on the
   * notify box's line - grey, and saying why, until the note has text.
   */
  test("the incident's public note puts a small Preview link beside the notify box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const dialog: Locator = await openFeedNoteDialog(page, FEED_NOTES[0]!);

    const line: Locator = dialog.getByTestId("note-notify-line");
    const label: Locator = line.getByText("Notify status page subscribers", {
      exact: true,
    });
    const preview: Locator = dialog.getByTestId(
      "incident-public-note-preview-notification",
    );

    await expect(preview).toBeVisible();
    await expect(preview).toHaveText("Preview");
    await expect(preview).toHaveAccessibleName("Preview notification");
    await expect(line).toContainText("Preview");

    // On the box's line, to the right of its label, a word wide.
    const labelBox: { x: number; y: number; width: number; height: number } =
      (await label.boundingBox())!;
    const previewBox: { x: number; y: number; width: number; height: number } =
      (await preview.boundingBox())!;
    expect(
      Math.abs(
        labelBox.y +
          labelBox.height / 2 -
          (previewBox.y + previewBox.height / 2),
      ),
    ).toBeLessThanOrEqual(2);
    expect(previewBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
    expect(previewBox.height).toBeLessThanOrEqual(24);
    expect(previewBox.width).toBeLessThan(100);

    // Nothing written yet: grey, still reachable, and it says why.
    await expect(preview).toHaveAttribute("aria-disabled", "true");
    await expect(preview).toHaveAccessibleDescription(
      "Write the note first to preview the email it sends.",
    );

    // Once there is a note, it is ready to open.
    await expect(
      dialog.getByTestId("note-composer").locator('[contenteditable="true"]'),
    ).toBeFocused();
    await page.keyboard.type("Rolled back the deploy.");
    await expect(preview).not.toHaveAttribute("aria-disabled", "true");
    await expect(preview).not.toHaveAttribute("aria-describedby");

    // Nothing was asked of the preview API: it is only asked when pressed.
    expect(
      (await fixture(page)).apiRequests.filter(
        (request: RecordedApiRequest): boolean => {
          return request.url.includes("/subscriber-notification-preview/");
        },
      ),
    ).toEqual([]);
  });

  test("the template menu opens over the dialog, whole and inside the window", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const dialog: Locator = await openFeedNoteDialog(page, FEED_NOTES[1]!);

    await dialog.getByTestId("note-template-menu-button").click();
    const menu: Locator = page.getByTestId("note-template-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("No note templates yet");

    // Inside the window, top to bottom: nothing of it is cut off.
    const edges: { top: number; bottom: number; windowHeight: number } =
      await menu.evaluate(
        (
          element: Element,
        ): { top: number; bottom: number; windowHeight: number } => {
          const rect: DOMRect = element.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            windowHeight: window.innerHeight,
          };
        },
      );
    expect(edges.top).toBeGreaterThanOrEqual(0);
    expect(edges.bottom).toBeLessThanOrEqual(edges.windowHeight);

    // Nothing of the dialog paints over it.
    const isOnTop: boolean = await menu.evaluate(
      (element: Element): boolean => {
        const rect: DOMRect = element.getBoundingClientRect();
        const hit: Element | null = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return Boolean(hit && element.contains(hit));
      },
    );
    expect(isOnTop).toBe(true);

    // Escape puts the menu away and leaves the note being written.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test("Cancel with a draft asks before it is lost", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const dialog: Locator = await openFeedNoteDialog(page, FEED_NOTES[1]!);

    await page.keyboard.type("Half a thought.");
    await dialog.getByTestId("modal-footer-close-button").click();

    const confirm: Locator = page.getByRole("dialog", {
      name: "Discard this draft?",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Keep writing" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(dialog.locator('[contenteditable="true"]')).toContainText(
      "Half a thought.",
    );

    await dialog.getByTestId("modal-footer-close-button").click();
    await page
      .getByRole("dialog", { name: "Discard this draft?" })
      .getByRole("button", { name: "Discard draft" })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(await notesPosted(page, "IncidentInternalNote")).toHaveLength(0);
  });

  test("someone who may not write incident notes sees them locked, with the reason", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Only the feed is waited for: an alert member does not see every card.
    await openReady(page, INCIDENT_PAGE, "role=alert-member", [
      "Rolling checkout-api back to 2026.09.14-1",
    ]);

    await card(page, "Incident Feed")
      .getByTestId("feed-actions-button")
      .click();
    for (const action of ["Add Public Note", "Add Private Note"]) {
      await expect(
        page.getByRole("menuitem", { name: action, exact: true }),
      ).toHaveAttribute("aria-disabled", "true");
    }
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the dialog fits the screen", async ({ page }: { page: Page }) => {
      await openReady(page, INCIDENT_PAGE);
      const dialog: Locator = await openFeedNoteDialog(page, FEED_NOTES[0]!);

      await expect(dialog.getByTestId("note-composer")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const box: Box = await documentBox(dialog);
      expect(box.width).toBeLessThanOrEqual(390);
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Navigation
 * ---------------------------------------------------------------------------
 */

test.describe("navigation", () => {
  test("a linked prior incident opens directly on the incident view route", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, incidentPath(1017));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "#1017 Checkout API p95 latency above 2s",
    );
    await expect(hero(page).getByTitle("Number", { exact: true })).toHaveText(
      "#1017",
    );
    await expect(card(page, "Incident Feed")).toBeVisible();
    await expectNoErrorStates(page);
  });

  test("side menu targets land on fixture stub pages", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH);
    await sideMenu(page)
      .getByRole("link", { name: "Roles", exact: true })
      .click();
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "INCIDENT_VIEW_ROLES",
    );
    expect(new URL(page.url()).pathname).toBe(`${INCIDENT_PATH}/roles`);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Responsive
 * ---------------------------------------------------------------------------
 */

test.describe("responsive", () => {
  for (const eventPage of EVENT_PAGES) {
    test(`${eventPage.name} does not scroll sideways at 390px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openReady(page, eventPage);
      await expect(card(page, eventPage.feed)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      // The stat bar stacks into one column.
      const cells: Locator = page
        .getByRole("group", { name: eventPage.statBar })
        .locator(":scope > div");
      const first: Box = await documentBox(cells.nth(0));
      const second: Box = await documentBox(cells.nth(1));
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
      await screenshot(page, `${eventPage.name}-mobile`, { fullPage: false });
    });
  }

  test("expanded evidence rows fit a 390px screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE);
    await expectNoHorizontalOverflow(page);
    for (const citationId of ["C1", "C3", "C7"]) {
      await expectRowsLoaded(await expandEvidence(page, citationId));
    }
    await expectNoHorizontalOverflow(page);

    /*
     * Phones draw the short "Evidence" so both tabs share one row. Both
     * labels are whole translated strings, never "Evidence" plus a hidden
     * " checked", so the short one is drawn from an attribute and kept out
     * of the name: a screen reader still hears the whole name, and the
     * count still follows it.
     */
    const evidenceTab: Locator = detailsTab(page, "Evidence");
    const activityTab: Locator = detailsTab(page, "Activity");
    await expect(evidenceTab).toHaveAccessibleName("Evidence checked 10");
    const shortLabel: Locator = evidenceTab.locator("[data-short-label]");
    await expect(shortLabel).toHaveAttribute("aria-hidden", "true");
    expect(
      await shortLabel.evaluate((element: Element): string => {
        return window.getComputedStyle(element, "::before").content;
      }),
      "the tab draws the short label",
    ).toBe('"Evidence"');
    const shortLabelBox: Box = await documentBox(shortLabel);
    expect(shortLabelBox.width, "the short label takes room").toBeGreaterThan(
      0,
    );
    const fullLabelBox: Box = await documentBox(
      evidenceTab.getByText("Evidence checked", { exact: true }),
    );
    expect(
      Math.max(fullLabelBox.width, fullLabelBox.height),
      "the whole name is for screen readers only",
    ).toBeLessThanOrEqual(1);
    const evidenceBox: Box = await documentBox(evidenceTab);
    const activityBox: Box = await documentBox(activityTab);
    expect(
      Math.abs(evidenceBox.y - activityBox.y),
      "tabs share a row",
    ).toBeLessThanOrEqual(1);
    expect(activityBox.x).toBeGreaterThan(evidenceBox.x + evidenceBox.width);
  });

  /*
   * "Why are edit buttons not on the right?" Every card on the page - the
   * wide ones on the left, the narrow column on the right - keeps what it
   * offers at its header's right edge: on the title's line on a desktop, and
   * under the title, still at the right edge, only where the two do not fit
   * - after the title's description, which stays right under the title.
   * Never at the left or in the middle.
   */
  for (const eventPage of EVENT_PAGES) {
    for (const width of [1440, 1280, 390]) {
      test(`${eventPage.name} keeps every card's actions at the right edge at ${width}px`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openReady(page, eventPage);

        const cards: Locator = page
          .getByTestId("card")
          .filter({ has: page.getByTestId("card-header-actions") })
          .filter({ has: page.getByTestId("card-details-heading") });
        const count: number = await cards.count();

        expect(count, "cards with actions").toBeGreaterThan(1);

        for (let index: number = 0; index < count; index++) {
          const each: Locator = cards.nth(index);
          const name: string = (
            await each.getByTestId("card-details-heading").first().innerText()
          ).trim();

          await expectHeaderActionsOnTheRight(
            each,
            `${name} at ${width}px`,
            width === 1440 ? { onTitleLine: true } : undefined,
          );
        }
        await expectNoHorizontalOverflow(page);
      });
    }
  }

  /*
   * A card's title stands at the card's padding whatever its header holds:
   * What happened (Edit at the right of its title's line, as the wide
   * column's cards have it) opens the left column, and the first card of the
   * right one - Affected Resources on an incident or an alert, Episode
   * Details on an episode (Edit, centred on its title, as the narrow
   * column's stacked headers have it) - opens the right, side by side, and
   * their titles line up.
   */
  for (const [eventPage, rightTitle] of [
    [INCIDENT_PAGE, "Affected Resources"],
    [ALERT_PAGE, "Affected Resources"],
    [INCIDENT_EPISODE_PAGE, "Episode Details"],
    [ALERT_EPISODE_PAGE, "Episode Details"],
  ] as Array<[EventPage, string]>) {
    test(`${eventPage.name} lines up the titles of the two cards that open its columns at 1280px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openReady(page, eventPage);

      const left: Locator = whatHappenedCard(page);
      const right: Locator = card(page, rightTitle).first();
      const leftBox: Box = await documentBox(left);
      const rightBox: Box = await documentBox(right);
      const leftTitleBox: Box = await documentBox(
        left.getByTestId("card-details-heading").first(),
      );
      const rightTitleBox: Box = await documentBox(
        right.getByTestId("card-details-heading").first(),
      );
      const edit: Box = await documentBox(
        right.getByTestId("card-header-actions").first(),
      );

      expect(rightBox.x, `${rightTitle} is beside it`).toBeGreaterThan(
        leftBox.x + leftBox.width,
      );
      expect(
        Math.abs(leftBox.y - rightBox.y),
        "the two cards start the row together",
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(leftTitleBox.y - rightTitleBox.y),
        "their titles line up",
      ).toBeLessThanOrEqual(1);
      await expectHeaderActionsOnTheRight(left, "What happened's Edit", {
        onTitleLine: true,
      });
      expect(
        Math.abs(
          edit.y +
            edit.height / 2 -
            (rightTitleBox.y + rightTitleBox.height / 2),
        ),
        `${rightTitle}'s Edit is centred on its title`,
      ).toBeLessThanOrEqual(1);
    });
  }

  for (const eventPage of EVENT_PAGES) {
    test(`${eventPage.name} right column is not cramped at 1280px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openReady(page, eventPage);
      const feed: Box = await documentBox(card(page, eventPage.feed));
      for (const heading of eventPage.rightColumn) {
        const rightCard: Locator = card(page, heading);
        const box: Box = await documentBox(rightCard);
        expect(box.x, `${heading} is a column`).toBeGreaterThanOrEqual(
          feed.x + feed.width,
        );
        const title: Box = await documentBox(
          rightCard.getByRole("heading", { level: 2 }),
        );
        expect(title.width, `${heading} title width`).toBeGreaterThan(120);
      }
      await expectNoHorizontalOverflow(page);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * Measurements
 * ---------------------------------------------------------------------------
 * "Someone who sets up 'Time to mitigate' opens an incident and finds it
 * nowhere." Each event's page lists the project's measurements for it, in a
 * card under its details: each one's name, what it measures, and what it
 * reads - a number, a clock still running, or why there is none. The
 * fixture works the values out with the real MeasurementEvaluator over its
 * own timelines (see Fixture.js, Measurements).
 */

interface MeasurementRow {
  name: string;
  summary: string;
  value: string;
  reason: string | null;
}

function measurementsCard(page: Page): Locator {
  return card(page, "Measurements");
}

async function measurementRows(page: Page): Promise<Array<MeasurementRow>> {
  return measurementsCard(page)
    .getByTestId("event-measurement")
    .evaluateAll((rows: Array<Element>): Array<MeasurementRow> => {
      return rows.map((row: Element): MeasurementRow => {
        const text: (testId: string) => string | null = (
          testId: string,
        ): string | null => {
          const element: Element | null = row.querySelector(
            `[data-testid="${testId}"]`,
          );
          return element ? (element as HTMLElement).innerText.trim() : null;
        };

        return {
          name: text("event-measurement-name") || "",
          // The arrow is spaced by its margins, which innerText leaves out.
          summary: (text("measurement-summary") || "")
            .replace("→", " → ")
            .replace(/\s+/g, " "),
          value: text("event-measurement-value") || "",
          reason: text("event-measurement-reason"),
        };
      });
    });
}

// The ready text each page's Measurements card adds: a measurement's name.
const MEASUREMENT_READY_TEXT: RegExp = /^(Time to|Maintenance duration)/;

async function measurementRequests(
  page: Page,
): Promise<Array<RecordedModelRequest>> {
  return (await fixture(page)).listRequests.filter(
    (request: RecordedModelRequest): boolean => {
      return request.modelName.includes("Measurement");
    },
  );
}

const INCIDENT_MEASUREMENTS: Array<MeasurementRow> = [
  {
    name: "Time to acknowledge",
    summary: "Declared → Acknowledged",
    value: "3 minutes",
    reason: null,
  },
  {
    name: "Time to mitigate",
    summary: "Declared → Mitigated",
    value: "Not measured",
    reason: "Mitigated was skipped",
  },
  {
    name: "Time to resolve",
    summary: "Declared → Resolved",
    value: "11 minutes",
    reason: null,
  },
  {
    name: "Time to postmortem",
    summary: "Resolved → Postmortem published",
    value: "Running for 8 minutes",
    reason: null,
  },
];

test.describe("measurements", () => {
  test("incident-overview lists the incident's measurements under its details, in their order", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    await expect(measurementsCard(page)).toBeVisible();
    await expect(measurementsCard(page)).toContainText(
      "Your team's measurements, worked out for this incident.",
    );
    // Kept off incident pages, and switched off: neither is shown.
    expect(await measurementRows(page)).toEqual(INCIDENT_MEASUREMENTS);

    // In the right-hand column, straight under the details card.
    const details: Box = await documentBox(
      card(page, INCIDENT_PAGE.detailsCard),
    );
    const measurements: Box = await documentBox(measurementsCard(page));
    expect(Math.abs(measurements.x - details.x)).toBeLessThanOrEqual(1);
    expect(measurements.y).toBeGreaterThan(details.y + details.height - 1);
    await expectAbove(
      measurementsCard(page),
      card(page, "Incident Roles"),
      "measurements before roles",
    );
    // Out of the hero and the stat bar.
    await expectAbove(
      page.getByRole("group", { name: INCIDENT_PAGE.statBar }),
      measurementsCard(page),
      "stat bar before measurements",
    );
    await expectNoErrorStates(page);
  });

  test("incident-overview asks for the measurements shown on incident pages, then this incident's values", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    await expect(measurementsCard(page)).toBeVisible();

    const requests: Array<RecordedModelRequest> =
      await measurementRequests(page);
    const definitions: RecordedModelRequest | undefined = requests.find(
      (request: RecordedModelRequest): boolean => {
        return request.modelName === "IncidentMeasurement";
      },
    );
    const values: RecordedModelRequest | undefined = requests.find(
      (request: RecordedModelRequest): boolean => {
        return request.modelName === "IncidentMeasurementValue";
      },
    );

    expect(definitions?.query).toEqual({
      isEnabled: true,
      showOnIncidentView: true,
    });
    expect(definitions?.sort).toEqual({ order: "ASC" });
    expect(JSON.stringify(values?.query)).toContain(INCIDENT_ID);
    expect(Object.keys(values?.query || {})).toEqual(["incidentId"]);

    /*
     * Read once. The AI report arriving refreshes the feed, not the
     * measurements: only a state change moves them. (A refresh is followed
     * by one more read three seconds later, so wait past that.)
     */
    await expect(summarySection(page)).toContainText(INCIDENT_TLDR);
    await page.waitForTimeout(3500);
    expect(await measurementRequests(page)).toHaveLength(2);
  });

  test("alert-overview lists the alert's measurements, each in its own unit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);

    await expect(measurementsCard(page)).toContainText(
      "Your team's measurements, worked out for this alert.",
    );
    expect(await measurementRows(page)).toEqual([
      {
        name: "Time to acknowledge",
        summary: "Created → Acknowledged",
        value: "2 minutes",
        reason: null,
      },
      {
        // Pinned to minutes.
        name: "Time to resolve",
        summary: "Created → Resolved",
        value: "9 minutes",
        reason: null,
      },
    ]);
    // Under the details card; what the alert touched leads the column.
    await expectAbove(
      card(page, "Affected Resources"),
      card(page, ALERT_PAGE.detailsCard),
      "resources lead the right column",
    );
    await expectAbove(
      card(page, ALERT_PAGE.detailsCard),
      measurementsCard(page),
      "measurements under the details",
    );
  });

  const MAINTENANCE_CASES: Array<{
    sm: string;
    values: Array<string>;
  }> = [
    // Starts in two hours: no clock has started.
    {
      sm: "scheduled",
      values: ["Not started yet", "Not started yet", "Not started yet"],
    },
    // Still Scheduled 20 minutes after its start: running late.
    {
      sm: "overdue",
      values: ["Running for 20 minutes", "Not started yet", "Not started yet"],
    },
    // Started on time, still Ongoing.
    {
      sm: "ongoing",
      values: ["0 seconds", "Not started yet", "Running for 15 minutes"],
    },
    // Ended two minutes past its planned end.
    { sm: "ended", values: ["0 seconds", "2 minutes", "1 hour, 2 minutes"] },
  ];

  for (const maintenance of MAINTENANCE_CASES) {
    test(`scheduled-maintenance-overview ?sm=${maintenance.sm} reads its measurements`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(
        page,
        SCHEDULED_MAINTENANCE_PAGE,
        `sm=${maintenance.sm}`,
        ["Maintenance duration"],
      );

      const rows: Array<MeasurementRow> = await measurementRows(page);

      expect(
        rows.map((row: MeasurementRow): string => {
          return row.name;
        }),
      ).toEqual(["Start delay", "Overrun", "Maintenance duration"]);
      expect(
        rows.map((row: MeasurementRow): string => {
          return row.value;
        }),
      ).toEqual(maintenance.values);
      expect(rows[0]!.summary).toBe("Scheduled start → Started");
    });
  }

  test("?state=ongoing: clocks still running count from the declaration, and resolving turns them into numbers in place", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=ongoing");

    expect(await measurementRows(page)).toEqual([
      INCIDENT_MEASUREMENTS[0],
      {
        name: "Time to mitigate",
        summary: "Declared → Mitigated",
        value: "Running for 19 minutes",
        reason: null,
      },
      {
        name: "Time to resolve",
        summary: "Declared → Resolved",
        value: "Running for 19 minutes",
        reason: null,
      },
      {
        name: "Time to postmortem",
        summary: "Resolved → Postmortem published",
        value: "Not started yet",
        reason: null,
      },
    ]);

    const readsBefore: Array<RecordedModelRequest> =
      await measurementRequests(page);

    await watchForSkeleton(page);
    await page.locator("#incident-resolve-btn").click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Resolve Incident",
    });
    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    await expect
      .poll(async (): Promise<Array<string>> => {
        return (await measurementRows(page)).map(
          (row: MeasurementRow): string => {
            return row.value;
          },
        );
      })
      .toEqual([
        "3 minutes",
        // The incident went straight to resolved.
        "Not measured",
        "19 minutes",
        "Running for less than a minute",
      ]);
    expect(await skeletonWasSeen(page)).toBe(false);

    /*
     * One read of the values, and only them: the fixture works them out as
     * the timeline entry is saved, so the first read already has values
     * newer than the ones on screen, and the card stops waiting. (It would
     * read again after 3 seconds otherwise: wait past that.)
     */
    await page.waitForTimeout(3500);

    const readsAfter: Array<RecordedModelRequest> = (
      await measurementRequests(page)
    ).slice(readsBefore.length);

    expect(
      readsAfter.map((request: RecordedModelRequest): string => {
        return request.modelName;
      }),
    ).toEqual(["IncidentMeasurementValue"]);
    await expectNoErrorStates(page);
  });

  test("?state=created: an incident nobody has answered yet runs every clock it has started", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=created");

    expect(
      (await measurementRows(page)).map((row: MeasurementRow): string => {
        return row.value;
      }),
    ).toEqual([
      "Running for 19 minutes",
      "Running for 19 minutes",
      "Running for 19 minutes",
      "Not started yet",
    ]);
  });

  test("?measurements=states: an end before its start is called out, and a measurement just changed is not worked out yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "measurements=states", [
      "Time to close",
    ]);

    const rows: Array<MeasurementRow> = await measurementRows(page);

    expect(rows.slice(0, 4)).toEqual(INCIDENT_MEASUREMENTS);
    expect(rows.slice(4)).toEqual([
      {
        name: "Time to impact",
        summary: "Declared → Impact started",
        value: "Ends before it starts",
        reason: "Impact Started At precedes Declared At by 3m",
      },
      {
        name: "Time to close",
        summary: "Declared → Resolved (last time)",
        value: "Not worked out yet",
        reason: "OneUptime works it out in the background.",
      },
    ]);

    // The one worth fixing is drawn as a warning, the rest as states.
    const values: Locator = measurementsCard(page).getByTestId(
      "event-measurement-value",
    );
    await expect(values.nth(4)).toHaveCSS("color", "rgb(180, 83, 9)");
    await expect(values.nth(5)).toHaveCSS("color", "rgb(107, 114, 128)");
  });

  for (const eventPage of [
    INCIDENT_PAGE,
    ALERT_PAGE,
    SCHEDULED_MAINTENANCE_PAGE,
  ]) {
    test(`${eventPage.name} ?measurements=none draws no card and reads no values`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(
        page,
        eventPage,
        "measurements=none",
        eventPage.readyTexts.filter((text: string): boolean => {
          return !MEASUREMENT_READY_TEXT.test(text);
        }),
      );
      await expect(card(page, eventPage.feed)).toBeVisible();

      await expect
        .poll(async (): Promise<number> => {
          return (await measurementRequests(page)).length;
        })
        .toBe(1);
      await expect(measurementsCard(page)).toHaveCount(0);
      await expect(page.getByTestId("event-measurements")).toHaveCount(0);
    });
  }

  test("the card reads well in the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "theme=dark&measurements=states", [
      "Time to close",
    ]);

    const values: Locator = measurementsCard(page).getByTestId(
      "event-measurement-value",
    );

    // Light text on the dark card: neither the light theme's grey-900 nor its amber.
    for (const index of [0, 4, 5]) {
      const color: string = await values
        .nth(index)
        .evaluate((element: Element): string => {
          return getComputedStyle(element).color;
        });
      const channels: Array<number> = (color.match(/\d+/g) || [])
        .slice(0, 3)
        .map(Number);
      const brightness: number =
        (channels[0]! * 299 + channels[1]! * 587 + channels[2]! * 114) / 1000;
      expect(brightness, `value ${index} is light on dark`).toBeGreaterThan(
        120,
      );
    }

    await page.mouse.move(0, 0);
    await screenshotElement(
      measurementsCard(page),
      "incident-measurements-dark",
    );
  });

  test("a phone shows every measurement without sideways scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE);

    expect(await measurementRows(page)).toEqual(INCIDENT_MEASUREMENTS);
    await expectNoHorizontalOverflow(page);
    await screenshotElement(
      measurementsCard(page),
      "incident-measurements-mobile",
    );
  });

  test("screenshot of the incident's measurements", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "measurements=states", [
      "Time to close",
    ]);
    await page.mouse.move(0, 0);
    await screenshotElement(measurementsCard(page), "incident-measurements");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The feed, as a timeline
 * ---------------------------------------------------------------------------
 *
 * Datadog's timeline, which the maintainer pointed at: a date and a time on
 * every entry, never only "x days ago". Each day under a heading of its own
 * (with Today / Yesterday beside it and the zone the times are in), each
 * entry with the time it happened - a short "8 min. ago" only for the last
 * hour - and its icon on a rail. The clock is pinned at 18:20 UTC on Monday,
 * September 14, 2026, and the browser is in UTC.
 */

// Intl writes a narrow no-break space before AM/PM; read it as a space.
const WHITESPACE_RUN: RegExp = /\s+/g;

async function plainText(locator: Locator): Promise<string> {
  return ((await locator.innerText()) || "")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

function feedEntry(feed: Locator, text: string): Locator {
  return feed.getByTestId("feed-entry").filter({ hasText: text });
}

test.describe("the feed, as a timeline", () => {
  test("the day is a heading with its date, Today beside it, and the zone the times are in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const feed: Locator = card(page, "Incident Feed");
    const day: Locator = feed.getByTestId("feed-day");

    await expect(day).toHaveCount(1);
    await expect(
      day.getByRole("heading", {
        level: 3,
        name: "Monday, September 14, 2026",
      }),
    ).toBeVisible();
    await expect(day.getByTestId("feed-day-relative")).toHaveText("Today");
    /*
     * The zone the dashboard reads every date in (OneUptimeDate's current
     * timezone): for this browser's UTC clock, moment-timezone's guess,
     * whose name is GMT - the same clock.
     */
    await expect(day.getByTestId("feed-day-zone")).toHaveText("GMT");
    // The day's section is named by its heading.
    await expect(
      feed.getByRole("region", { name: "Monday, September 14, 2026" }),
    ).toHaveCount(1);
  });

  test("every entry has the time it happened, newest first, and the last hour also says how long ago", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const feed: Locator = card(page, "Incident Feed");

    expect(
      await plainText(
        feedEntry(feed, "Rolling checkout-api back").getByTestId(
          "feed-entry-time",
        ),
      ),
    ).toBe("6:09 PM 11 min. ago");

    const times: Array<string> = [];
    for (const time of await feed.getByTestId("feed-entry-time").all()) {
      times.push(await plainText(time));
    }

    /*
     * 18:12 resolved, 18:09 note, 18:05 commander, 18:04 acknowledged,
     * 18:03 the AI report, 18:01 the on-call policy and, in the same minute,
     * the incident itself: its time is not said twice.
     */
    expect(times).toEqual([
      "6:12 PM 8 min. ago",
      "6:09 PM 11 min. ago",
      "6:05 PM 15 min. ago",
      "6:04 PM 16 min. ago",
      "6:03 PM 17 min. ago",
      "6:01 PM 19 min. ago",
      "",
    ]);

    // The time is a <time> with the instant it stands for.
    await expect(
      feedEntry(feed, "Rolling checkout-api back").locator("time"),
    ).toHaveAttribute("datetime", "2026-09-14T18:09:00.000Z");
  });

  test("an entry reads as a sentence that starts with who did it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const feed: Locator = card(page, "Incident Feed");

    // "✅ Changed Incident #1042 State to Resolved", by Maya Chen.
    const resolved: Locator = feedEntry(feed, "Resolved").first();
    expect(await plainText(resolved.getByTestId("feed-entry-lead"))).toBe(
      "Maya Chen changed Incident #1042 State to Resolved",
    );
    expect(await plainText(resolved)).not.toContain("✅");

    // A note is hers too, her name above what she wrote.
    const note: Locator = feedEntry(feed, "Rolling checkout-api back");
    await expect(note.getByTestId("feed-entry-author")).toHaveText("Maya Chen");
    expect(await plainText(note)).not.toContain("🔒");
    // The rail's icon says what kind of entry it is.
    await expect(note.getByTestId("feed-entry-icon")).toBeVisible();
    await expect(note).toHaveAttribute("data-event-type", "PrivateNote");
  });

  test("a phone keeps the time above each entry, without sideways scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE);

    const feed: Locator = card(page, "Incident Feed");
    const note: Locator = feedEntry(feed, "Rolling checkout-api back");
    const time: Box = await documentBox(note.getByTestId("feed-entry-time"));
    const body: Box = await documentBox(note.getByTestId("feed-entry-author"));

    expect(time.y + time.height).toBeLessThanOrEqual(body.y + 1);
    await expectNoHorizontalOverflow(page);
    await page.mouse.move(0, 0);
    await screenshotElement(feed, "incident-feed-mobile");
  });

  test("screenshot of the incident feed", async ({ page }: { page: Page }) => {
    await openReady(page, INCIDENT_PAGE);
    await page.mouse.move(0, 0);
    await screenshotElement(card(page, "Incident Feed"), "incident-feed");
  });

  test("what someone wrote is set apart in a card, as the Notes page draws a note", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const feed: Locator = card(page, "Incident Feed");

    // Maya's note: her name above it, her words in the card.
    const note: Locator = feedEntry(feed, "Rolling checkout-api back");
    const noteCard: Locator = note.getByTestId("feed-entry-body");
    await expect(noteCard).toHaveAttribute("data-note", "true");
    await expect(noteCard).toContainText("Rolling checkout-api back");
    await expect(noteCard).toHaveCSS("border-top-width", "1px");
    await expect(noteCard).toHaveCSS("border-top-left-radius", "8px");
    await expect(noteCard).toHaveCSS("background-color", "rgb(255, 255, 255)");
    expect(
      (await documentBox(noteCard)).y,
      "the card is under her name",
    ).toBeGreaterThan(
      (await documentBox(note.getByTestId("feed-entry-author"))).y,
    );

    // What the AI wrote is in a card too, the sentence that says so above it.
    const report: Locator = feedEntry(
      feed,
      "OneUptime AI posted a root cause analysis",
    );
    await expect(report.getByTestId("feed-entry-intro")).toHaveText(
      "OneUptime AI posted a root cause analysis",
    );
    await expect(report.getByTestId("feed-entry-body")).toHaveAttribute(
      "data-note",
      "true",
    );
    await expect(report.getByTestId("feed-entry-body")).not.toContainText(
      "OneUptime AI posted",
    );

    // Something that happened is a sentence, not a card.
    const resolved: Locator = feedEntry(feed, "Resolved").first();
    await expect(resolved.locator("[data-note]")).toHaveCount(0);
  });

  test("a note's card follows the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "theme=dark");

    const noteCard: Locator = feedEntry(
      card(page, "Incident Feed"),
      "Rolling checkout-api back",
    ).getByTestId("feed-entry-body");

    await expect(noteCard).toHaveAttribute("data-note", "true");
    await expect(noteCard).not.toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(noteCard).not.toHaveCSS("color", "rgb(31, 41, 55)");
  });

  test("a maintenance event's created entry reads as the sentence of whoever created it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE);

    const created: Locator = feedEntry(
      card(page, "Scheduled Maintenance Feed"),
      "Primary database failover drill",
    );

    expect(await plainText(created.getByTestId("feed-entry-lead"))).toBe(
      "Jordan Patel created Scheduled Maintenance #58",
    );
    // The heading it was written with is not drawn as one.
    await expect(created.getByRole("heading")).toHaveCount(0);
    await expect(created).not.toContainText("🕒");
  });

  test("an on-call run folds into its newest entry, unfolds in place with Show fewer at its end, and keyboard focus follows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "feed=oncall-run");

    const feed: Locator = card(page, "Incident Feed");
    const head: Locator = feedEntry(feed, "Sam Rivera acknowledged the page");
    const showMore: Locator = feed.getByRole("button", {
      name: "Show 3 more on-call updates",
    });

    // Folded: one entry, its button under it, the rest out of the feed.
    await expect(head).toHaveCount(1);
    await expect(head.getByTestId("feed-burst-toggle")).toHaveText(
      "Show 3 more on-call updates",
    );
    await expect(feedEntry(feed, "paged nobody")).toHaveCount(0);
    await expect(feedEntry(feed, "Started Executing")).toHaveCount(0);

    await showMore.focus();
    await page.keyboard.press("Enter");

    // Unfolded in place, in order, ending with the run's start.
    const run: Array<string> = [];
    for (const entry of await feed
      .locator('[data-testid="feed-entry"][data-event-type="OnCallPolicy"]')
      .all()) {
      run.push(await plainText(entry));
    }
    expect(run.length).toBe(4);
    expect(run[0]).toContain("Sam Rivera acknowledged the page");
    expect(run[1]).toContain(
      "paged nobody at Platform leads (Level 2 of 3): nobody was on call",
    );
    expect(run[2]).toContain(
      "paged Sam Rivera at First responders (Level 1 of 3, schedule EU days).",
    );
    expect(run[3]).toContain("Started Executing");

    // Show fewer ends the group, under its last entry, not after its first.
    const showFewer: Locator = feed.getByRole("button", { name: "Show fewer" });
    await expect(showFewer).toHaveCount(1);
    await expect(
      feedEntry(feed, "Started Executing").getByRole("button", {
        name: "Show fewer",
      }),
    ).toHaveCount(1);
    await expect(head.getByTestId("feed-burst-toggle")).toHaveCount(0);

    // The button pressed went away: focus is on the first entry it unfolded.
    const focused: string = await page.evaluate((): string => {
      return document.activeElement?.textContent || "";
    });
    expect(focused).toContain("paged nobody at Platform leads");

    // Folding it again hands focus back to the button that unfolds it.
    await showFewer.focus();
    await page.keyboard.press("Enter");
    await expect(feedEntry(feed, "paged nobody")).toHaveCount(0);
    await expect(showMore).toBeFocused();

    await expectNoHorizontalOverflow(page);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Links and quotes in a note
 * ---------------------------------------------------------------------------
 *
 * A customer's feedback: a link in a note - the file a saved Slack message
 * carried, an attachment - took over the OneUptime tab, and quoted text
 * showed an amber exclamation mark, as if it were a warning.
 * ?feed=links-and-quotes adds a private note saved from a Slack message to
 * incident #1042's feed: a quote, the message's file, a callout, links to
 * another incident and to the docs, and the note's attachment. Here each
 * link is opened, and the quote and the callout are measured, in a real
 * browser with the real Markdown parser.
 */
const SLACK_FILE_URL: string =
  "https://acme.slack.com/files/U0123ABCD/F0123ABCD/image.png";
const NOTE_ATTACHMENT_PATH: string = `/api/incident-internal-note/attachment/${PROJECT_ID}/${uuid("91000000", 1)}/${uuid("92000000", 1)}`;
const QUOTED_WORDS: string = "They said the payment provider is degraded";

function savedNote(page: Page): Locator {
  return feedEntry(card(page, "Incident Feed"), QUOTED_WORDS);
}

async function computedStyleOf(
  locator: Locator,
  properties: Array<string>,
): Promise<Record<string, string>> {
  return await locator.evaluate(
    (element: Element, names: Array<string>): Record<string, string> => {
      const style: CSSStyleDeclaration = window.getComputedStyle(element);
      const values: Record<string, string> = {};
      for (const name of names) {
        values[name] = style.getPropertyValue(name);
      }
      return values;
    },
    properties,
  );
}

test.describe("links and quotes in a note", () => {
  test("the file a saved Slack message carried opens in a new tab, and the incident stays open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page
      .context()
      .route("https://acme.slack.com/**", async (route: PlaywrightRoute) => {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: "image.png",
        });
      });
    await openReady(page, INCIDENT_PAGE, "feed=links-and-quotes");

    const fileLink: Locator = savedNote(page).getByRole("link", {
      name: "image.png",
    });

    await expect(fileLink).toHaveAttribute("href", SLACK_FILE_URL);
    await expect(fileLink).toHaveAttribute("target", "_blank");
    await expect(fileLink).toHaveAttribute("rel", "noopener noreferrer");
    await expect(fileLink).toHaveAttribute(
      "aria-description",
      "Opens in a new tab",
    );

    const [tab] = await Promise.all([
      page.context().waitForEvent("page"),
      fileLink.click(),
    ]);
    await tab.waitForLoadState();

    expect(tab.url()).toBe(SLACK_FILE_URL);
    // Cut loose from the page that opened it.
    expect(
      await tab.evaluate((): boolean => {
        return window.opener === null;
      }),
    ).toBe(true);

    // The incident is still open, where it was.
    expect(new URL(page.url()).pathname).toBe(INCIDENT_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      INCIDENT_PAGE.pageTitle,
    );
    await tab.close();
  });

  test("the note's attachment opens in a new tab once the session is refreshed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page
      .context()
      .route(`**${NOTE_ATTACHMENT_PATH}`, async (route: PlaywrightRoute) => {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: "runbook",
        });
      });
    await openReady(page, INCIDENT_PAGE, "feed=links-and-quotes");

    const attachment: Locator = savedNote(page).getByRole("link", {
      name: "runbook.pdf",
    });

    await expect(attachment).toHaveAttribute("href", NOTE_ATTACHMENT_PATH);
    await expect(attachment).toHaveAttribute("target", "_blank");
    await expect(attachment).toHaveAttribute("rel", "noopener noreferrer");

    const [tab] = await Promise.all([
      page.context().waitForEvent("page"),
      attachment.click(),
    ]);
    await tab.waitForURL(`**${NOTE_ATTACHMENT_PATH}`);

    expect(new URL(tab.url()).pathname).toBe(NOTE_ATTACHMENT_PATH);
    expect(new URL(page.url()).pathname).toBe(INCIDENT_PATH);
    expect((await apiRequestsTo(page, "/identity/refresh-token")).length).toBe(
      1,
    );
    await tab.close();
  });

  test("a link to another incident stays in the tab; one to the docs opens a new one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "feed=links-and-quotes");

    const otherIncident: Locator = savedNote(page).getByRole("link", {
      name: "Incident #1036",
    });
    const docs: Locator = savedNote(page).getByRole("link", {
      name: "failover runbook",
    });

    await expect(docs).toHaveAttribute("target", "_blank");
    await expect(docs).toHaveAttribute("rel", "noopener noreferrer");

    await expect(otherIncident).not.toHaveAttribute("target", /.*/);
    await expect(otherIncident).not.toHaveAttribute("rel", /.*/);
    await expect(otherIncident).not.toHaveAttribute("aria-description", /.*/);

    let openedTabs: number = 0;
    page.context().on("page", () => {
      openedTabs += 1;
    });

    // A mark on this page's window: a page loaded again would not have it.
    await page.evaluate((): void => {
      (window as unknown as { keptAcrossTheLink: boolean }).keptAcrossTheLink =
        true;
    });

    await Promise.all([
      page.waitForURL(`**${incidentPath(1036)}`),
      otherIncident.click(),
    ]);

    expect(openedTabs).toBe(0);
    expect(page.context().pages()).toHaveLength(1);
    // Opened inside the app, as its own links open: the app was not loaded again.
    expect(
      await page.evaluate((): boolean => {
        return Boolean(
          (window as unknown as { keptAcrossTheLink?: boolean })
            .keptAcrossTheLink,
        );
      }),
    ).toBe(true);
  });

  test("quoted text is a quote: a grey bar and lighter text, with no icon", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "feed=links-and-quotes");

    const quote: Locator = savedNote(page)
      .locator("blockquote")
      .filter({ hasText: QUOTED_WORDS });

    await expect(quote).toBeVisible();
    await expect(quote.locator("svg")).toHaveCount(0);
    await expect(quote).not.toHaveAttribute("role", /.*/);

    expect(
      await computedStyleOf(quote, [
        "border-left-width",
        "border-left-style",
        "border-left-color",
        "border-top-width",
        "background-color",
        "padding-left",
      ]),
    ).toEqual({
      "border-left-width": "3px",
      "border-left-style": "solid",
      // border-gray-300, as the editor draws a quote.
      "border-left-color": "rgb(209, 213, 219)",
      "border-top-width": "0px",
      "background-color": "rgba(0, 0, 0, 0)",
      "padding-left": "12px",
    });
    // text-gray-600: lighter than the note's own text-gray-700.
    expect(await computedStyleOf(quote.locator("p"), ["color"])).toEqual({
      color: "rgb(75, 85, 99)",
    });

    await screenshotElement(savedNote(page), "feed-note-links-and-quotes");
    await expectNoHorizontalOverflow(page);

    // In text read right to left, the bar is on the side it starts from.
    await quote.evaluate((element: Element): void => {
      element.setAttribute("dir", "rtl");
    });
    expect(
      await computedStyleOf(quote, [
        "border-right-width",
        "border-left-width",
        "padding-right",
      ]),
    ).toEqual({
      "border-right-width": "3px",
      "border-left-width": "0px",
      "padding-right": "12px",
    });
  });

  test("a callout the note asked for is a panel with its sign", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "feed=links-and-quotes");

    const callout: Locator = savedNote(page).getByRole("note", {
      name: "Warning",
    });

    await expect(callout).toBeVisible();
    await expect(callout).toHaveAttribute("data-callout", "warning");
    expect(await plainText(callout)).toBe(
      "Do not restart the primary. Fail over to the replica first.",
    );
    await expect(callout.locator("svg")).toBeVisible();
    expect(
      await computedStyleOf(callout, ["background-color", "border-top-color"]),
    ).toEqual({
      // bg-amber-50 and border-amber-200.
      "background-color": "rgb(255, 251, 235)",
      "border-top-color": "rgb(253, 230, 138)",
    });
  });

  test("in the dark theme the quote and the callout take the theme's colours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "feed=links-and-quotes&theme=dark");

    const quote: Locator = savedNote(page)
      .locator("blockquote")
      .filter({ hasText: QUOTED_WORDS });

    expect(await computedStyleOf(quote, ["border-left-color"])).toEqual({
      // --ou-border-strong in the dark theme.
      "border-left-color": "rgb(100, 116, 139)",
    });
    expect(await computedStyleOf(quote.locator("p"), ["color"])).toEqual({
      // --ou-text-muted in the dark theme.
      color: "rgb(203, 213, 225)",
    });

    const callout: Locator = savedNote(page).getByRole("note", {
      name: "Warning",
    });

    expect(
      await computedStyleOf(callout, ["background-color", "border-top-color"]),
    ).toEqual({
      "background-color": "rgba(120, 53, 15, 0.32)",
      "border-top-color": "rgba(251, 191, 36, 0.42)",
    });
    expect(await computedStyleOf(callout.locator("svg"), ["color"])).toEqual({
      color: "rgb(251, 191, 36)",
    });

    await screenshotElement(savedNote(page), "feed-note-links-and-quotes-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Open in Slack / Open in Microsoft Teams
 * ---------------------------------------------------------------------------
 *
 * A record a workspace notification rule made a channel for has a button in
 * its header that opens that channel (?channels= picks the record's
 * channels). One channel is a link that opens in a new tab; a workspace with
 * several is a menu of them; no channel, no button.
 */

const SLACK_CHANNEL_URL: string =
  "https://slack.com/app_redirect?channel=C0ACME0001&team=T0ACMECOM";

test.describe("Open in Slack / Microsoft Teams", () => {
  test("no channel, no button", async ({ page }: { page: Page }) => {
    await openReady(page, INCIDENT_PAGE);

    await expect(
      heroActions(page).getByRole("link", { name: "Open in Slack" }),
    ).toHaveCount(0);
    await expect(
      heroActions(page).getByRole("button", { name: "Open in Slack" }),
    ).toHaveCount(0);
    // The page asked, for this incident.
    const requests: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      `/workspace-channel-link/incident/${INCIDENT_ID}`,
    );
    expect(requests).not.toHaveLength(0);
    expect(requests[0]!.method).toBe("GET");
  });

  test("an incident's Slack channel is a link in its header, opening in a new tab", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack");

    const slack: Locator = heroActions(page).getByRole("link", {
      name: "Open in Slack",
    });

    await expect(slack).toHaveAttribute("href", SLACK_CHANNEL_URL);
    await expect(slack).toHaveAttribute("target", "_blank");
    await expect(slack).toHaveAttribute("rel", "noopener noreferrer");

    // Pointing at the button names the channel (the card names it too).
    await slack.hover();
    await expect(
      page
        .locator("[data-tippy-root]")
        .getByText("#incident-1042-checkout-latency"),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await screenshotElement(hero(page), "incident-hero-open-in-chat");
  });

  test("a Microsoft Teams channel is a link to Teams, with its team", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=teams");

    const teams: Locator = heroActions(page).getByRole("link", {
      name: "Open in Microsoft Teams",
    });
    const teamsUrl: URL = new URL((await teams.getAttribute("href")) || "");

    expect(teamsUrl.host).toBe("teams.microsoft.com");
    expect(teamsUrl.searchParams.get("groupId")).toBe(
      "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    );
    await expect(teams).toHaveAttribute("rel", "noopener noreferrer");
  });

  /*
   * Two buttons as wide as "Open in Slack" and "Open in Microsoft Teams"
   * beside Acknowledge and Resolve left the title "Checko..." at 1280px.
   * Channels in both products share one Open channel menu instead.
   */
  test("channels in Slack and Teams: one Open channel that lists them all, and the title keeps its room", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openReady(page, INCIDENT_PAGE, "channels=slack,teams&state=created");

    await expect(heroActions(page).getByRole("link")).toHaveCount(0);

    const button: Locator = heroActions(page).getByRole("button", {
      name: "Open channel",
    });
    await expect(button).toHaveAttribute("aria-haspopup", "menu");

    const title: Box = await documentBox(
      hero(page).getByRole("heading", { level: 2 }),
    );
    expect(title.width).toBeGreaterThanOrEqual(250);

    await page.mouse.move(0, 0);
    await screenshotElement(hero(page), "incident-hero-open-channel");

    await button.click();
    const menu: Locator = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Slack · #incident-1042-checkout-latency",
      "Microsoft Teams · incident-1042-checkout-latency",
    ]);
    await screenshotElement(hero(page), "incident-hero-open-channel-menu");

    const opened: Promise<Page> = page.context().waitForEvent("page");
    await menu
      .getByRole("menuitem", {
        name: "Microsoft Teams · incident-1042-checkout-latency",
      })
      .click();
    const tab: Page = await opened;
    expect(new URL(tab.url()).host).toBe("teams.microsoft.com");
    await tab.close();
  });

  test("two Slack channels: one Open in Slack that lists both", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack,slack2");

    const button: Locator = heroActions(page).getByRole("button", {
      name: "Open in Slack",
    });
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await button.click();

    const menu: Locator = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "#incident-1042-checkout-latency",
      "#sre-war-room",
    ]);

    const opened: Promise<Page> = page.context().waitForEvent("page");
    await menu.getByRole("menuitem", { name: "#sre-war-room" }).click();
    const tab: Page = await opened;
    expect(tab.url()).toContain("C0ACME0002");
    await tab.close();
  });

  for (const channelPage of [
    { eventPage: ALERT_PAGE, recordType: "alert" },
    {
      eventPage: SCHEDULED_MAINTENANCE_PAGE,
      recordType: "scheduled-maintenance",
    },
    { eventPage: INCIDENT_EPISODE_PAGE, recordType: "incident-episode" },
    { eventPage: ALERT_EPISODE_PAGE, recordType: "alert-episode" },
  ]) {
    test(`the ${channelPage.recordType} page has it too`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, channelPage.eventPage, "channels=slack");

      await expect(
        heroActions(page).getByRole("link", { name: "Open in Slack" }),
      ).toHaveAttribute("href", SLACK_CHANNEL_URL);
      expect(
        await apiRequestsTo(
          page,
          `/workspace-channel-link/${channelPage.recordType}/${
            new URL(page.url()).pathname.split("/").pop() || ""
          }`,
        ),
      ).not.toHaveLength(0);
    });
  }

  test("a failure to read the channels hides the buttons and breaks nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack&fail=channel-links");

    await expect(
      heroActions(page).getByRole("link", { name: "Open in Slack" }),
    ).toHaveCount(0);
    await expectNoErrorStates(page);
  });

  test("a phone shows the buttons without sideways scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE, "channels=slack,slack2,teams");

    await expect(
      heroActions(page).getByRole("button", { name: "Open channel" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.mouse.move(0, 0);
    await screenshotElement(hero(page), "incident-hero-open-in-chat-mobile");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Escalate (the action first called "Pass it on")
 * ---------------------------------------------------------------------------
 *
 * The person an on-call policy is paging about a record, who cannot take
 * it, escalates the page from its header: the policy pages its next level
 * at once instead of waiting. Only they see the button (?paged= picks the
 * records the viewer is paged about; ?passOn= what escalating does). It asks
 * first, in the maintainer's words - "Escalate Incident?", "This will
 * immediately page Platform leads (Level 2 of 3), without waiting.", "You
 * will not be paged again for this incident.", Cancel and Escalate - and
 * then says what it did, or why there was nothing to escalate.
 */

function escalateButton(page: Page): Locator {
  return heroActions(page).getByRole("button", { name: "Escalate" });
}

function escalateDialog(page: Page): Locator {
  return page.getByRole("dialog");
}

async function dialogLines(page: Page, testId: string): Promise<Array<string>> {
  return (
    await escalateDialog(page).getByTestId(testId).locator("p").allInnerTexts()
  ).map((line: string): string => {
    return line.trim();
  });
}

const NEXT_LEVEL: string =
  "This will immediately page Platform leads (Level 2 of 3), without waiting.";

const NOT_PAGED_AGAIN: string =
  "You will not be paged again for this incident.";

test.describe("Escalate", () => {
  test("somebody the policy is not paging sees no button, and the page asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=created");

    await expect(escalateButton(page)).toHaveCount(0);

    const requests: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      `/on-call-page/pass-on/incident/${INCIDENT_ID}`,
    );
    expect(requests).not.toHaveLength(0);
    expect(requests[0]!.method).toBe("GET");
  });

  test("the person being paged escalates: the maintainer's dialog first, then what it did", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "paged=incident&state=created");

    // After the state buttons it is the alternative to.
    const button: Locator = escalateButton(page);
    await expect(button).toBeVisible();
    const order: Array<string> = (
      await heroActions(page).getByRole("button").allInnerTexts()
    ).map((text: string): string => {
      return text.trim();
    });
    expect(order).toContain("Acknowledge");
    expect(order.indexOf("Escalate")).toBeGreaterThan(
      order.indexOf("Acknowledge"),
    );
    expect(order).not.toContain("Pass it on");

    await page.mouse.move(0, 0);
    await screenshotElement(hero(page), "incident-hero-escalate");

    await button.click();
    await expect(escalateDialog(page).getByTestId("modal-title")).toHaveText(
      "Escalate Incident?",
    );
    expect(await dialogLines(page, "pass-on-preview")).toEqual([
      NEXT_LEVEL,
      NOT_PAGED_AGAIN,
    ]);
    await expect(
      escalateDialog(page).getByTestId("modal-footer-close-button"),
    ).toHaveText("Cancel");
    await expect(
      escalateDialog(page).getByTestId("modal-footer-submit-button"),
    ).toHaveText("Escalate");
    await screenshotElement(escalateDialog(page), "escalate-dialog-ask");

    // Nothing is escalated until they say so.
    expect(
      (
        await apiRequestsTo(
          page,
          `/on-call-page/pass-on/incident/${INCIDENT_ID}`,
        )
      ).filter((request: RecordedApiRequest): boolean => {
        return request.method === "POST";
      }),
    ).toHaveLength(0);

    await escalateDialog(page)
      .getByTestId("modal-footer-submit-button")
      .click();

    await expect(escalateDialog(page).getByTestId("modal-title")).toHaveText(
      "Incident escalated",
    );
    expect(await dialogLines(page, "pass-on-answer")).toEqual([
      "The policy is now paging Platform leads (Level 2 of 3): Sam Lee and Priya Patel.",
      NOT_PAGED_AGAIN,
    ]);
    await screenshotElement(escalateDialog(page), "escalate-dialog-done");

    await escalateDialog(page)
      .getByTestId("modal-footer-submit-button")
      .click();
    await expect(escalateDialog(page)).toHaveCount(0);

    // No longer paged about it: the button is gone.
    await expect(escalateButton(page)).toHaveCount(0);
    expect(
      (
        await apiRequestsTo(
          page,
          `/on-call-page/pass-on/incident/${INCIDENT_ID}`,
        )
      ).filter((request: RecordedApiRequest): boolean => {
        return request.method === "POST";
      }),
    ).toHaveLength(1);
  });

  test("Cancel escalates nothing", async ({ page }: { page: Page }) => {
    await openReady(page, INCIDENT_PAGE, "paged=incident&state=created");

    await escalateButton(page).click();
    await escalateDialog(page).getByTestId("modal-footer-close-button").click();

    await expect(escalateDialog(page)).toHaveCount(0);
    await expect(escalateButton(page)).toBeVisible();
    expect(
      (
        await apiRequestsTo(
          page,
          `/on-call-page/pass-on/incident/${INCIDENT_ID}`,
        )
      ).filter((request: RecordedApiRequest): boolean => {
        return request.method === "POST";
      }),
    ).toHaveLength(0);
  });

  test("a level nobody named is called by its place, never 'Level 2 (Level 2 of 3)'", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&passOn=unnamed",
    );

    await escalateButton(page).click();

    expect(await dialogLines(page, "pass-on-preview")).toEqual([
      "This will immediately page Level 2 of 3, without waiting.",
      NOT_PAGED_AGAIN,
    ]);
    await screenshotElement(escalateDialog(page), "escalate-dialog-unnamed");

    await escalateDialog(page)
      .getByTestId("modal-footer-submit-button")
      .click();

    expect(await dialogLines(page, "pass-on-answer")).toEqual([
      "The policy is now paging Level 2 of 3: Sam Lee and Priya Patel.",
      NOT_PAGED_AGAIN,
    ]);
  });

  test("the last level, with Repeat Policy on: the first level is paged again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&passOn=restart",
    );

    await escalateButton(page).click();

    expect(await dialogLines(page, "pass-on-preview")).toEqual([
      "There is no level after yours, so this will immediately page First responders (Level 1 of 3) again, without waiting.",
      NOT_PAGED_AGAIN,
    ]);
    await expect(
      escalateDialog(page).getByTestId("pass-on-warning"),
    ).toHaveCount(0);
    await screenshotElement(escalateDialog(page), "escalate-dialog-restart");
  });

  test("others on the level are still paged: who, and when the policy pages the next level", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&passOn=others",
    );

    await escalateButton(page).click();

    const lines: Array<string> = await dialogLines(page, "pass-on-preview");
    expect(lines[0]).toContain(
      "Bob Smith is still being paged. If nobody acknowledges by ",
    );
    expect(lines[0]).toContain(
      ", the policy pages Platform leads (Level 2 of 3) next.",
    );
    // Twenty minutes away, today: the time alone, with no date in front of it.
    expect(lines[0]).toContain("by 6:40 PM ");
    expect(lines[0]).not.toContain("2026");
    expect(lines[1]).toBe(NOT_PAGED_AGAIN);
    await expect(
      escalateDialog(page).getByTestId("pass-on-warning"),
    ).toHaveCount(0);
    await screenshotElement(escalateDialog(page), "escalate-dialog-others");
  });

  test("nobody left to page: the dialog warns about it first, before and after", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&passOn=stopped",
    );

    await escalateButton(page).click();

    await expect(escalateDialog(page).getByTestId("modal-title")).toHaveText(
      "Escalate Incident?",
    );
    const asked: Locator = escalateDialog(page).getByTestId("pass-on-warning");
    await expect(asked).toHaveText(
      "Nobody else is left to page: paging stops, and somebody needs to take it.",
    );
    await expect(asked).toHaveAttribute("role", "alert");
    // The warning, then the one line about the reader.
    expect(await dialogLines(page, "pass-on-preview")).toEqual([
      NOT_PAGED_AGAIN,
    ]);
    const warningBox: { y: number } | null = await asked.boundingBox();
    const lineBox: { y: number } | null = await escalateDialog(page)
      .getByTestId("pass-on-preview")
      .locator("p")
      .first()
      .boundingBox();
    expect(warningBox!.y).toBeLessThan(lineBox!.y);
    await screenshotElement(
      escalateDialog(page),
      "escalate-dialog-stopped-ask",
    );

    await escalateDialog(page)
      .getByTestId("modal-footer-submit-button")
      .click();

    await expect(escalateDialog(page).getByTestId("modal-title")).toHaveText(
      "Incident escalated",
    );
    await expect(
      escalateDialog(page).getByTestId("pass-on-warning"),
    ).toHaveText(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
    expect(await dialogLines(page, "pass-on-answer")).toEqual([
      NOT_PAGED_AGAIN,
    ]);
    await screenshotElement(
      escalateDialog(page),
      "escalate-dialog-stopped-done",
    );
  });

  test("two policies paging about the same record: each line names its policy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&passOn=two",
    );

    await escalateButton(page).click();

    expect(await dialogLines(page, "pass-on-preview")).toEqual([
      `Checkout on-call: ${NEXT_LEVEL}`,
      `Payments escalation: ${NEXT_LEVEL}`,
      NOT_PAGED_AGAIN,
    ]);
  });

  test("somebody acknowledged it meanwhile: it says so, nothing is escalated, and the header reads the incident again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&passOn=acknowledged",
    );

    await expect(heroActions(page).getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
      "Escalate",
    ]);

    await escalateButton(page).click();
    await escalateDialog(page)
      .getByTestId("modal-footer-submit-button")
      .click();

    // Why, in a few words: not the button's "Escalate", an instruction.
    await expect(escalateDialog(page).getByTestId("modal-title")).toHaveText(
      "Already acknowledged",
    );
    expect(await dialogLines(page, "pass-on-answer")).toEqual([
      "Sam Rivera acknowledged it already, so there is nothing to escalate.",
    ]);
    await screenshotElement(
      escalateDialog(page),
      "escalate-dialog-acknowledged",
    );

    /*
     * Behind the dialog the page read the incident again (#4914): the
     * header no longer offers Acknowledge for an incident Sam took, nor
     * Escalate for a page that is over.
     */
    await escalateDialog(page)
      .getByTestId("modal-footer-submit-button")
      .click();
    await expect(escalateDialog(page)).toHaveCount(0);
    await expect(heroActions(page).getByRole("button")).toHaveText(["Resolve"]);
    await expectRenderedText(heroChips(page), "Acknowledged SEV-2");
  });

  test("a failed request keeps the question open, with an error", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&fail=pass-on",
    );

    await escalateButton(page).click();
    await escalateDialog(page)
      .getByTestId("modal-footer-submit-button")
      .click();

    await expect(
      escalateDialog(page).getByText("Could not escalate. Please try again."),
    ).toBeVisible();
    await expect(escalateDialog(page).getByTestId("modal-title")).toHaveText(
      "Escalate Incident?",
    );
  });

  test("when the server cannot say, there is no button and nothing breaks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&fail=pass-on-read",
    );

    await expect(escalateButton(page)).toHaveCount(0);
    await expectNoErrorStates(page);
  });

  for (const escalatePage of [
    {
      eventPage: ALERT_PAGE,
      recordType: "alert",
      question: "Escalate Alert?",
      notPagedAgain: "You will not be paged again for this alert.",
    },
    {
      eventPage: INCIDENT_EPISODE_PAGE,
      recordType: "incident-episode",
      question: "Escalate Episode?",
      notPagedAgain: "You will not be paged again for this episode.",
    },
    {
      eventPage: ALERT_EPISODE_PAGE,
      recordType: "alert-episode",
      question: "Escalate Episode?",
      notPagedAgain: "You will not be paged again for this episode.",
    },
  ]) {
    test(`the ${escalatePage.recordType} page has it too, asking about itself`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(
        page,
        escalatePage.eventPage,
        `paged=${escalatePage.recordType}&state=created`,
      );

      await expect(escalateButton(page)).toBeVisible();
      expect(
        await apiRequestsTo(
          page,
          `/on-call-page/pass-on/${escalatePage.recordType}/${
            new URL(page.url()).pathname.split("/").pop() || ""
          }`,
        ),
      ).not.toHaveLength(0);

      await escalateButton(page).click();
      await expect(escalateDialog(page).getByTestId("modal-title")).toHaveText(
        escalatePage.question,
      );
      expect(await dialogLines(page, "pass-on-preview")).toEqual([
        NEXT_LEVEL,
        escalatePage.notPagedAgain,
      ]);
    });
  }

  test("scheduled maintenance pages nobody, so it never asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, SCHEDULED_MAINTENANCE_PAGE, "paged=incident");

    await expect(escalateButton(page)).toHaveCount(0);
    expect(
      (await fixture(page)).apiRequests.filter(
        (request: RecordedApiRequest): boolean => {
          return request.url.includes("/on-call-page/pass-on/");
        },
      ),
    ).toHaveLength(0);
  });

  /*
   * The incident and the alert page, and the dialog over each, at a laptop's
   * width and a phone's, in the light and the dark theme.
   */
  for (const look of [
    {
      eventPage: INCIDENT_PAGE,
      recordType: "incident",
      question: "Escalate Incident?",
    },
    {
      eventPage: ALERT_PAGE,
      recordType: "alert",
      question: "Escalate Alert?",
    },
  ]) {
    for (const width of [1280, 390]) {
      for (const theme of ["light", "dark"]) {
        test(`the ${look.recordType} page and its dialog at ${width}px, ${theme}`, async ({
          page,
        }: {
          page: Page;
        }) => {
          await page.setViewportSize({
            width: width,
            height: width < 600 ? 844 : 900,
          });
          await openReady(
            page,
            look.eventPage,
            `paged=${look.recordType}&state=created${
              theme === "dark" ? "&theme=dark" : ""
            }`,
          );

          const button: Locator = escalateButton(page);
          await expect(button).toBeVisible();
          // The button's words fit: nothing is cut short.
          const fits: boolean = await button.evaluate(
            (element: Element): boolean => {
              return element.scrollWidth <= element.clientWidth + 1;
            },
          );
          expect(fits).toBe(true);
          await expectNoHorizontalOverflow(page);
          await page.mouse.move(0, 0);
          await screenshotElement(
            hero(page),
            `${look.recordType}-hero-escalate-${width}-${theme}`,
          );

          await button.click();
          await expect(
            escalateDialog(page).getByTestId("modal-title"),
          ).toHaveText(look.question);
          await expect(
            escalateDialog(page).getByTestId("modal-footer-submit-button"),
          ).toBeVisible();
          await expectNoHorizontalOverflow(page);

          // The dialog sits inside the screen, its buttons in reach.
          const box: { x: number; width: number } | null = await escalateDialog(
            page,
          )
            .getByTestId("modal-footer-submit-button")
            .boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);

          await screenshotElement(
            escalateDialog(page),
            `${look.recordType}-escalate-dialog-${width}-${theme}`,
          );
        });
      }
    }
  }

  test("nobody left to page, in the dark theme and on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(
      page,
      INCIDENT_PAGE,
      "paged=incident&state=created&passOn=stopped&theme=dark",
    );

    await escalateButton(page).click();
    await expect(
      escalateDialog(page).getByTestId("pass-on-warning"),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshotElement(
      escalateDialog(page),
      "escalate-dialog-stopped-ask-dark-mobile",
    );
  });

  /*
   * A phone broke the maintainer's own example inside the level's place -
   * "Platform leads (Level 2 of" / "3), without waiting." - and the time as
   * "by 6:40" / "PM GMT". Each now stays on one line; the sentence's text
   * is unchanged.
   */
  for (const width of [390, 360, 320]) {
    test(`on a ${width}px phone, a level's place and the time each stay on one line`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 844 });
      await openReady(
        page,
        INCIDENT_PAGE,
        "paged=incident&state=created&passOn=others",
      );

      await escalateButton(page).click();

      const kept: Locator = escalateDialog(page)
        .getByTestId("pass-on-preview")
        .getByTestId("pass-on-kept-together");
      await expect(kept).toHaveText(["6:40 PM GMT", "(Level 2 of 3)"]);

      for (const phrase of await kept.all()) {
        const drawn: { lines: number; whiteSpace: string } =
          await phrase.evaluate(
            (element: Element): { lines: number; whiteSpace: string } => {
              return {
                lines: element.getClientRects().length,
                whiteSpace: getComputedStyle(element).whiteSpace,
              };
            },
          );
        expect(drawn).toEqual({ lines: 1, whiteSpace: "nowrap" });
      }

      // The sentence a reader gets is whole, and fits the screen.
      expect(await dialogLines(page, "pass-on-preview")).toEqual([
        "Bob Smith is still being paged. If nobody acknowledges by 6:40 PM GMT, the policy pages Platform leads (Level 2 of 3) next.",
        NOT_PAGED_AGAIN,
      ]);
      await expectNoHorizontalOverflow(page);

      // After escalating, the answer keeps them together too.
      await escalateDialog(page)
        .getByTestId("modal-footer-submit-button")
        .click();
      await expect(
        escalateDialog(page)
          .getByTestId("pass-on-answer")
          .getByTestId("pass-on-kept-together"),
      ).toHaveText(["6:40 PM GMT", "(Level 2 of 3)"]);
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * The record's channel card: who is in its channel, Join channel, Add people
 * ---------------------------------------------------------------------------
 *
 * The customer: "if all users leave a private channel, can someone re-enter
 * or invite others without requiring assistance from a Slack workspace
 * admin?" A record with a channel of its own shows a card beside its call:
 * the channel, the people in it, and - for somebody who may edit the record -
 * Join channel and Add people, which have the OneUptime app invite them.
 * The fixture answers GET /workspace-channel-members (?members=) and POST
 * .../add; Maya Chen is the viewer.
 */

const MAYA_ID: string = uuid("80000000", 1);
const SAM_ID: string = uuid("80000000", 2);
const ALEX_ID: string = uuid("80000000", 4);

function channelCard(page: Page): Locator {
  return page.getByTestId("record-channel-members-card");
}

async function channelAdds(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((): Array<Record<string, unknown>> => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __eventOverviewFixture: {
              channelAdds: Array<Record<string, unknown>>;
            };
          }
        ).__eventOverviewFixture.channelAdds,
      ),
    ) as Array<Record<string, unknown>>;
  });
}

test.describe("the record's channel card", () => {
  test("no channel of its own: no card, and nothing asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    await expect(channelCard(page)).toHaveCount(0);
    expect(
      await apiRequestsTo(
        page,
        `/workspace-channel-members/incident/${INCIDENT_ID}`,
      ),
    ).toHaveLength(0);
  });

  test("an incident's Slack channel: who is in it, and Join channel for a viewer who is not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openReady(page, INCIDENT_PAGE, "channels=slack");

    const card: Locator = channelCard(page);
    await expect(card.getByTestId("record-channel-person-name")).toHaveText([
      "Jordan Patel",
      "Priya from Support",
      "Sam Rivera",
    ]);
    await expect(card.getByTestId("record-channel-meta")).toHaveText(
      "Private channel · 3 people",
    );
    await expect(card.getByTestId("record-channel-name")).toHaveAttribute(
      "href",
      SLACK_CHANNEL_URL,
    );
    await expect(card.getByTestId("record-channel-not-in")).toHaveText(
      "You're not in this channel.",
    );
    await expect(card.getByTestId("record-channel-join")).toBeVisible();
    await expect(card.getByTestId("record-channel-add-people")).toBeVisible();
    expect(
      await apiRequestsTo(
        page,
        `/workspace-channel-members/incident/${INCIDENT_ID}`,
      ),
    ).toHaveLength(1);

    await screenshotElement(card, "incident-channel-card");
  });

  test("everybody left the private channel: Join channel lets the viewer back in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack&members=empty");

    const card: Locator = channelCard(page);
    await expect(card.getByTestId("record-channel-nobody")).toHaveText(
      "Nobody is in this channel.",
    );
    await screenshotElement(card, "incident-channel-card-empty");

    await card.getByTestId("record-channel-join").click();

    await expect(card.getByTestId("record-channel-join-result")).toContainText(
      "You're in the channel now.",
    );
    await expect(card.getByTestId("record-channel-person-you")).toBeVisible();
    await expect(card.getByTestId("record-channel-join")).toHaveCount(0);
    expect(await channelAdds(page)).toEqual([
      { channelId: "C0ACME0001", userIds: [MAYA_ID], teamIds: [] },
    ]);

    await screenshotElement(card, "incident-channel-card-joined");
  });

  test("Add people adds a person at once, and says who Slack does not know", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await openReady(page, INCIDENT_PAGE, "channels=slack&members=empty");

    const card: Locator = channelCard(page);
    await card.getByTestId("record-channel-add-people").click();

    const dialog: Locator = page.getByRole("dialog", { name: "Add people" });
    await expect(dialog.getByRole("option").first()).toBeVisible();

    await dialog.getByRole("option", { name: /Sam Rivera/ }).click();
    await expect(card.getByTestId("record-channel-person-name")).toHaveText([
      "Sam Rivera",
    ]);
    await expect(
      dialog.getByRole("option", { name: /Sam Rivera/ }),
    ).toHaveCount(0);
    // Said where the pick was made, too.
    await expect(dialog.getByTestId("people-search-notice-done")).toHaveText(
      "Added Sam Rivera.",
    );

    await dialog.getByRole("option", { name: /Alex Kim/ }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "OneUptime can't find Alex Kim in Slack",
    );

    expect(await channelAdds(page)).toEqual([
      { channelId: "C0ACME0001", userIds: [SAM_ID], teamIds: [] },
      { channelId: "C0ACME0001", userIds: [ALEX_ID], teamIds: [] },
    ]);

    await screenshotElement(
      page.locator("body"),
      "incident-channel-card-add-people",
    );
  });

  test("without permission to edit the incident: who to ask, and no buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack&members=readonly");

    const card: Locator = channelCard(page);
    await expect(card.getByTestId("record-channel-ask")).toHaveText(
      "You're not in this channel. Ask someone who can edit this incident to add you.",
    );
    await expect(card.getByTestId("record-channel-join")).toHaveCount(0);
    await expect(card.getByTestId("record-channel-add-people")).toHaveCount(0);
  });

  test("a channel the OneUptime app was removed from says so, and how to let it back in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack&members=unreachable");

    await expect(
      channelCard(page).getByTestId("record-channel-state"),
    ).toContainText("/invite @OneUptime");
    await expectNoErrorStates(page);
  });

  test("a Microsoft Teams channel says who can open it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=teams");

    const card: Locator = channelCard(page);
    await expect(card.getByTestId("record-channel-teams-note")).toHaveText(
      "Everyone in Checkout SRE can open the channel.",
    );
    await expect(card.getByTestId("record-channel-add-people")).toHaveCount(0);
    await expect(page.getByText("Microsoft Teams Channel")).toBeVisible();
  });

  test("a private Microsoft Teams channel says it is private once, then who adds people", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=teams&teamsPrivate=1");

    const card: Locator = channelCard(page);
    await expect(card.getByTestId("record-channel-meta")).toHaveText(
      "Private channel",
    );
    await expect(card.getByTestId("record-channel-teams-note")).toHaveText(
      "Only its members can open it. Its owners add people in Microsoft Teams.",
    );
  });

  for (const channelPage of [
    { eventPage: ALERT_PAGE, recordType: "alert" },
    {
      eventPage: SCHEDULED_MAINTENANCE_PAGE,
      recordType: "scheduled-maintenance",
    },
    { eventPage: INCIDENT_EPISODE_PAGE, recordType: "incident-episode" },
    { eventPage: ALERT_EPISODE_PAGE, recordType: "alert-episode" },
  ]) {
    test(`the ${channelPage.recordType} page has it too`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, channelPage.eventPage, "channels=slack");

      await expect(
        channelCard(page).getByTestId("record-channel-person-name"),
      ).toHaveText(["Jordan Patel", "Priya from Support", "Sam Rivera"]);
      expect(
        await apiRequestsTo(
          page,
          `/workspace-channel-members/${channelPage.recordType}/${
            new URL(page.url()).pathname.split("/").pop() || ""
          }`,
        ),
      ).not.toHaveLength(0);
    });
  }

  test("a phone shows the card without sideways scrolling", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE, "channels=slack,slack2,teams");

    await expect(channelCard(page).getByTestId("record-channel")).toHaveCount(
      3,
    );
    await expectNoHorizontalOverflow(page);
    await screenshotElement(channelCard(page), "incident-channel-card-mobile");
  });

  /*
   * The UI review's polish: the buttons in the narrow column, what each pick
   * in Add people came to, the card's own words when a read fails, the next
   * step when Slack was taken off the project, and the keyboard after a join.
   */
  test("in the narrow column of a 1280px screen, Join channel and Add people each fill a row; on a phone they share one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openReady(page, INCIDENT_PAGE, "channels=slack");

    const actions: Locator = channelCard(page).getByTestId(
      "record-channel-actions",
    );
    const join: Locator = actions.getByTestId("record-channel-join");
    const addPeople: Locator = actions.getByTestId("record-channel-add-people");

    await expect(addPeople).toBeVisible();

    const row: { x: number; width: number } | null =
      await actions.boundingBox();
    const joinBox: { x: number; y: number; width: number } | null =
      await join.boundingBox();
    const addBox: { x: number; y: number; width: number } | null =
      await addPeople.boundingBox();

    // Stacked, each as wide as the column - not two ragged ends.
    expect(addBox!.y).toBeGreaterThan(joinBox!.y);
    expect(Math.abs(joinBox!.x - row!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(addBox!.x - row!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(joinBox!.width - row!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(addBox!.width - row!.width)).toBeLessThanOrEqual(1);
    await screenshotElement(channelCard(page), "incident-channel-card-1280");

    // A phone's full-width card has room for both, side by side.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(async () => {
      const phoneJoin: { y: number } | null = await join.boundingBox();
      const phoneAdd: { y: number } | null = await addPeople.boundingBox();

      expect(Math.abs(phoneJoin!.y - phoneAdd!.y)).toBeLessThanOrEqual(1);
    }).toPass();
    await expectNoHorizontalOverflow(page);
  });

  test("the video call card above it reads in lines in that column, its button under the words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openReady(page, INCIDENT_PAGE, "channels=slack");

    const empty: Locator = page.getByTestId("event-video-calls-empty");
    const title: Locator = empty.getByText("No call yet");
    const start: Locator = empty.getByTestId("event-video-call-start");

    await expect(start).toBeVisible();

    // Before, a row with the button beside it left the words a word a line.
    const titleBox: { height: number; y: number } | null =
      await title.boundingBox();
    const startBox: { y: number } | null = await start.boundingBox();
    const lineHeight: number = await title.evaluate(
      (element: Element): number => {
        return parseFloat(window.getComputedStyle(element).lineHeight);
      },
    );

    expect(titleBox!.height).toBeLessThan(lineHeight * 1.5);
    expect(startBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height);
  });

  test("a team picked in Add people: how many were added, and everyone Slack does not know, in one sentence", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await openReady(
      page,
      INCIDENT_PAGE,
      "channels=slack&members=empty&unknown=alex,jordan",
    );

    await channelCard(page).getByTestId("record-channel-add-people").click();

    const dialog: Locator = page.getByRole("dialog", { name: "Add people" });
    await dialog.getByRole("option", { name: /Checkout SRE/ }).click();

    await expect(dialog.getByTestId("people-search-notice-done")).toHaveText(
      "Added 2 people from Checkout SRE.",
    );
    await expect(dialog.getByRole("alert")).toHaveText(
      "OneUptime can't find Jordan Patel and Alex Kim in Slack: their accounts aren't connected, and no Slack account has their email address. Ask them to connect Slack in User Settings.",
    );
    expect(await channelAdds(page)).toEqual([
      { channelId: "C0ACME0001", userIds: [], teamIds: [uuid("81000000", 1)] },
    ]);
    await screenshotElement(dialog, "incident-channel-card-add-team");
  });

  test("a read that fails is said in the card's own words, with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack&fail=channel-members");

    const box: Locator = channelCard(page).getByTestId(
      "record-channel-read-error",
    );

    await expect(box.getByRole("alert")).toHaveText(
      "Could not read who is in this channel. Slack could not be reached.",
    );
    await expect(channelCard(page).getByText("Refresh?")).toHaveCount(0);

    const reads: number = (
      await apiRequestsTo(
        page,
        `/workspace-channel-members/incident/${INCIDENT_ID}`,
      )
    ).length;

    await box.getByRole("button", { name: "Try again" }).click();

    await expect(async () => {
      expect(
        await apiRequestsTo(
          page,
          `/workspace-channel-members/incident/${INCIDENT_ID}`,
        ),
      ).toHaveLength(reads + 1);
    }).toPass();
  });

  test("Slack taken off the project: Connect Slack goes to the project's Slack settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "channels=slack&members=not-connected",
    );

    const state: Locator = channelCard(page).getByTestId(
      "record-channel-state",
    );

    await expect(state).toContainText("Slack isn't connected to this project.");
    await expect(
      state.getByRole("link", { name: "Connect Slack" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/slack-integration`,
    );
  });

  test("the command that lets the app back in reads as a command", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack&members=unreachable");

    const command: Locator = channelCard(page).locator("code");

    await expect(command).toHaveText("/invite @OneUptime");
    await expect(command).toHaveAttribute("dir", "ltr");
  });

  test("Join channel from the keyboard leaves focus on Open in Slack, the next step", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "channels=slack");

    const card: Locator = channelCard(page);

    await card.getByTestId("record-channel-join").focus();
    await page.keyboard.press("Enter");

    const open: Locator = card.getByTestId("record-channel-open-after-join");

    await expect(open).toBeFocused();
    await expect(open).toHaveAttribute("href", SLACK_CHANNEL_URL);
    await expect(card.getByTestId("record-channel-join")).toHaveCount(0);

    await page.keyboard.press("Tab");
    await expect(card.getByTestId("record-channel-add-people")).toBeFocused();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Screenshots (pinned clock, synthetic data)
 * ---------------------------------------------------------------------------
 */

test.describe("screenshots", () => {
  for (const eventPage of EVENT_PAGES) {
    test(`${eventPage.name} full page`, async ({ page }: { page: Page }) => {
      await openReady(page, eventPage);
      await expect(sideMenu(page)).toBeVisible();
      await expect(card(page, eventPage.feed)).toBeVisible();
      await expectNoErrorStates(page);
      await page.mouse.move(0, 0);
      await screenshot(page, eventPage.name);
    });
  }

  test("incident AI investigation card", async ({ page }: { page: Page }) => {
    await openReady(page, INCIDENT_PAGE);
    await page.mouse.move(0, 0);
    await screenshotElement(investigationCard(page), "incident-ai-report");
  });

  // The feed's Add Public Note: the Notes page composer, in a dialog.
  test("incident feed note dialog", async ({ page }: { page: Page }) => {
    await openReady(page, INCIDENT_PAGE);
    const dialog: Locator = await openFeedNoteDialog(page, FEED_NOTES[0]!);
    await page.keyboard.type("We have rolled back the deploy.");
    await expect(
      dialog.getByTestId("incident-public-note-audience"),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await screenshot(page, "incident-feed-public-note-dialog", {
      fullPage: false,
    });

    await dialog.getByTestId("note-template-menu-button").click();
    await expect(page.getByTestId("note-template-menu")).toBeVisible();
    await screenshot(page, "incident-feed-public-note-dialog-templates", {
      fullPage: false,
    });
  });

  // Every state of the card, for review: one flat card in each.
  test("AI investigation card states", async ({ page }: { page: Page }) => {
    const states: ReadonlyArray<{ file: string; state: CardState }> = [
      { file: "ai-card-running", state: CARD_STATES[3]! },
      { file: "ai-card-running-clusters", state: CARD_STATES[4]! },
      { file: "ai-card-queued", state: CARD_STATES[5]! },
      { file: "ai-card-failed", state: CARD_STATES[6]! },
      { file: "ai-card-pending", state: CARD_STATES[7]! },
      { file: "ai-card-none", state: CARD_STATES[8]! },
      { file: "ai-card-waiting", state: CARD_STATES[11]! },
      {
        file: "ai-card-waiting-viewer",
        state: {
          name: "waiting, for a viewer",
          query: "ai=waiting-viewer",
          badge: "Waiting",
        },
      },
      { file: "ai-card-clusters", state: CARD_STATES[1]! },
      {
        file: "ai-card-dark",
        state: { name: "dark", query: "theme=dark", badge: "Completed" },
      },
    ];

    for (const { file, state } of states) {
      await openCardState(page, state);
      await page.mouse.move(0, 0);
      await screenshotElement(investigationCard(page), file);
    }
  });

  // The same one card with a conversation in it, in each thing a thread holds.
  test("AI investigation card with a conversation", async ({
    page,
  }: {
    page: Page;
  }) => {
    const states: ReadonlyArray<{ file: string; state: CardState }> = [
      {
        file: "ai-card-conversation-answered",
        state: {
          name: "answered",
          query: "thread=answered",
          badge: "Completed",
        },
      },
      {
        file: "ai-card-conversation-none-answered",
        state: {
          name: "answered with nothing investigated",
          query: "ai=none&thread=answered",
          badge: "Not investigated",
        },
      },
      {
        file: "ai-card-conversation-working",
        state: {
          name: "working",
          query: "ai=none&thread=working",
          badge: "Not investigated",
        },
      },
      {
        file: "ai-card-conversation-approval",
        state: {
          name: "approval",
          query: "ai=running&thread=approval",
          badge: "Investigating…",
        },
      },
      {
        file: "ai-card-conversation-error",
        state: {
          name: "error",
          query: "ai=failed&thread=error",
          badge: "Did not finish",
        },
      },
      {
        file: "ai-card-conversation-crowded",
        state: {
          name: "crowded",
          query: "ai=none&thread=crowded",
          badge: "Not investigated",
        },
      },
      {
        file: "ai-card-conversation-dark",
        state: {
          name: "dark",
          query: "theme=dark&thread=answered",
          badge: "Completed",
        },
      },
    ];

    for (const { file, state } of states) {
      await openCardState(page, state);
      await expect(thread(page)).toBeVisible();
      await page.mouse.move(0, 0);
      await screenshotElement(investigationCard(page), file);
    }
  });

  test("AI investigation card with a conversation on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const { file, query, badge } of [
      {
        file: "ai-card-conversation-mobile",
        query: "ai=none&thread=answered",
        badge: "Not investigated",
      },
      {
        file: "ai-card-none-mobile",
        query: "ai=none",
        badge: "Not investigated",
      },
    ]) {
      await openCardState(page, { name: file, query, badge });
      await expect(composerBox(page)).toBeVisible();
      await page.mouse.move(0, 0);
      await screenshotElement(investigationCard(page), file);
    }
  });

  test.describe("AI report close-ups", () => {
    // Close-ups of one column read better at twice the density.
    test.use({ deviceScaleFactor: 2 });

    test("header summary with a rejected verdict", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE, "verdict=rejected");
      await expect(
        hero(page).getByText("Rejected by a responder", { exact: true }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await screenshotElement(hero(page), "incident-header-ai-verdict");
    });

    test("header summary with a long TL;DR", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE, "tldr=long");
      await expect(
        hero(page).getByText(INCIDENT_LONG_TLDR, { exact: true }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await screenshotElement(hero(page), "incident-header-ai-summary");
    });

    test("summary, references, evidence and activity", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE);
      await page.mouse.move(0, 0);

      await screenshotBetween(
        page,
        investigationCard(page).getByRole("heading", {
          level: 2,
          name: "OneUptime AI",
          exact: true,
        }),
        reportSection(page),
        "ai-report-summary",
      );

      // Hover state on a resolved reference; its title names the incident.
      const reference: Locator = referenceLink(summarySection(page), "#1017");
      await reference.hover();
      await expect(reference).toHaveAttribute(
        "title",
        "#1017 · Checkout API p95 latency above 2s · Resolved",
      );
      await screenshotElement(summarySection(page), "ai-report-references");
      await page.mouse.move(0, 0);

      // The collapsed section as the page first shows it.
      await expect(detailsToggle(page)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await screenshotElement(investigationDetails(page), "ai-report-details");

      const details: Locator = await expandEvidence(page, "C1");
      await expectRowsLoaded(details);
      await expect(
        details.getByRole("button", { name: /^#1017 · / }),
      ).toBeVisible();
      await page.mouse.move(0, 0);
      await screenshotElement(investigationDetails(page), "ai-report-evidence");

      await detailsTab(page, "Activity").click();
      await expect(detailsPanel(page, "Activity")).toBeVisible();
      await page.mouse.move(0, 0);
      await screenshotElement(investigationDetails(page), "ai-report-activity");
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * The linked infrastructure an investigation read, and its follow-up check
 * (?linked=, issues #4786 and #4787)
 * ---------------------------------------------------------------------------
 *
 * An investigation's activity says what it read about the infrastructure its
 * incident or alert is linked to. When an alert opens on that
 * infrastructure after the first analysis, OneUptime AI checks the incident
 * again: the live run says so in its heading, its report leads with the
 * server's "Checked again" line above the Summary, and the feed's entry
 * says "OneUptime AI checked again" with the reason, apart from the first
 * analysis below it. The evidence of the infrastructure tools reads in
 * words.
 */

const LINKED_LINE: string =
  "Read 2 open or recent alerts on Host checkout-api-7f9c, Docker host checkout-api-7f9c, Kubernetes cluster prod-eks-eu-west-1 and 2 more";
const FOLLOW_UP_ACTIVITY_LINE: string =
  "Checking again: alert #318 opened on Host checkout-api-7f9c after the first analysis";
const FOLLOW_UP_LEAD_TEXT: string =
  "Checked again after alert #318 opened on Host checkout-api-7f9c, 3 minutes after this incident was declared: High CPU on checkout-api-7f9c.";
const FOLLOW_UP_FEED_LEAD: string =
  "OneUptime AI checked again after alert #318 opened on Host checkout-api-7f9c, 3 minutes after this incident was declared: High CPU on checkout-api-7f9c.";
const FIRST_ANALYSIS_FEED_LEAD: string =
  "OneUptime AI posted a root cause analysis";
const FOLLOW_UP_TLDR_START: string = "Alert #318 does not change the analysis";

function liveInvestigation(page: Page): Locator {
  return page.getByRole("region", { name: "Live investigation" });
}

function followUpLead(page: Page): Locator {
  return investigationCard(page).getByTestId("investigation-report-lead");
}

// The words of each step the live run draws, in order.
async function stepTexts(page: Page): Promise<Array<string>> {
  return liveInvestigation(page)
    .getByTestId("activity-step-text")
    .evaluateAll((elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return (element.textContent || "").trim();
      });
    });
}

/*
 * Where the first line of an element's text sits, in document coordinates:
 * the box of its first character.
 */
async function firstLineBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element: Element): Box => {
    const walker: TreeWalker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
    );
    let node: Node | null = walker.nextNode();

    while (
      node &&
      ((node.parentElement && node.parentElement.closest(".sr-only")) ||
        !(node.textContent || "").trim())
    ) {
      node = walker.nextNode();
    }

    const text: string = node!.textContent || "";
    let offset: number = 0;

    while (offset < text.length && text.charAt(offset).trim() === "") {
      offset++;
    }

    const range: Range = document.createRange();
    range.setStart(node!, offset);
    range.setEnd(node!, offset + 1);
    const rect: DOMRect = range.getBoundingClientRect();

    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

function centreOf(box: Box): number {
  return box.y + box.height / 2;
}

test.describe("the linked infrastructure, and the follow-up check (?linked=)", () => {
  test("a running investigation says what it read about its linked infrastructure, a line that wraps keeping its mark beside its first line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, INCIDENT_PATH, "ai=running&linked=alerts");
    await expect(liveInvestigation(page)).toBeVisible({ timeout: 30000 });

    expect((await stepTexts(page)).slice(0, 2)).toEqual([
      "Starting investigation",
      LINKED_LINE,
    ]);

    const step: Locator = liveInvestigation(page)
      .getByTestId("activity-step-text")
      .filter({ hasText: LINKED_LINE });
    const mark: Locator = step.locator(
      "xpath=preceding-sibling::*[@data-testid='activity-step-mark']",
    );
    const stepBox: Box = await documentBox(step);
    const markBox: Box = await documentBox(mark);
    const line: Box = await firstLineBox(step);

    // It wraps on a phone, and its mark stays level with its first line.
    expect(stepBox.height, "the line wraps").toBeGreaterThan(
      markBox.height * 2,
    );
    expect(
      Math.abs(centreOf(markBox) - centreOf(line)),
      "the mark beside the first line",
    ).toBeLessThanOrEqual(2);

    // The steps every investigation takes read as words, not tool ids.
    expect(await stepTexts(page)).toContain(
      "Searching past incidents · 3 rows · 0.4s",
    );
    await expectNoHorizontalOverflow(page);
  });

  test("the steps' detail follows their words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=running&linked=alerts");
    await expect(liveInvestigation(page)).toBeVisible({ timeout: 30000 });

    const step: Locator = liveInvestigation(page)
      .getByTestId("activity-step-text")
      .filter({ hasText: "Aggregating metrics" });
    const detail: Locator = step.getByText("· 80 rows · 1.2s");

    // On the words' own line, right after them.
    expect(
      Math.abs(
        centreOf(await documentBox(detail)) -
          centreOf(await firstLineBox(step)),
      ),
    ).toBeLessThanOrEqual(2);
  });

  test("more alerts than it lists: the newest were read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=running&linked=more");
    await expect(liveInvestigation(page)).toContainText(
      "Read the 10 newest open or recent alerts on Host checkout-api-7f9c, Docker host checkout-api-7f9c, Kubernetes cluster prod-eks-eu-west-1 and 2 more",
      { timeout: 30000 },
    );
  });

  test("an alert's investigation says when there was nothing on its host", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "ai=running&linked=alerts");
    await expect(liveInvestigation(page)).toContainText(
      "No open or recent alerts on Host payments-web-2",
      { timeout: 30000 },
    );
    // An alert is never checked again.
    await expect(liveInvestigation(page)).toContainText(
      "OneUptime AI is investigating",
    );
  });

  test("a follow-up check, running, is headed 'checking again', its first line naming the alert that made it check", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=running&linked=followup");
    const live: Locator = liveInvestigation(page);
    await expect(live).toBeVisible({ timeout: 30000 });

    await expect(live.getByRole("heading", { level: 3 })).toHaveText(
      "OneUptime AI is checking again",
    );
    expect((await stepTexts(page)).slice(0, 3)).toEqual([
      "Starting investigation",
      FOLLOW_UP_ACTIVITY_LINE,
      "Read 3 open or recent alerts on Host checkout-api-7f9c, Docker host checkout-api-7f9c, Kubernetes cluster prod-eks-eu-west-1 and 2 more",
    ]);
    expect(await stepTexts(page)).toContain(
      "Checking the host's containers · 4 rows · 0.6s",
    );
    expect(await stepTexts(page)).toContain(
      "Reading a resource's telemetry · 4 rows · 0.9s",
    );
    // A first investigation, running, keeps its heading.
    await open(page, INCIDENT_PATH, "ai=running&linked=alerts");
    await expect(
      liveInvestigation(page).getByRole("heading", { level: 3 }),
    ).toHaveText("OneUptime AI is investigating", { timeout: 30000 });
  });

  test("a follow-up check's report leads with why it was written, above the Summary, the alert a link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "linked=followup");
    // Folded to its summary, the report says why it was written once opened.
    await showFullReport(page);
    const lead: Locator = followUpLead(page);
    // The report's markdown is drawn once its renderer has loaded.
    await expect(lead).toContainText(FOLLOW_UP_LEAD_TEXT, { timeout: 30000 });

    expect(await plainText(lead)).toBe(FOLLOW_UP_LEAD_TEXT);
    await expect(lead.locator("strong")).toHaveText("Checked again");
    await expectAbove(lead, summarySection(page), "the lead, then the Summary");
    await expect(summarySection(page)).toContainText(FOLLOW_UP_TLDR_START);
    // Said once, not again inside the report.
    await expect(reportSection(page)).not.toContainText("Checked again");

    // The alert it names opens that alert.
    const alertLink: Locator = referenceLink(lead, "#318");
    await expect(alertLink).toHaveAttribute(
      "href",
      `${DASHBOARD}/alerts/${uuid("30000000", 318)}`,
    );

    // The mark sits level with the line's first words.
    const mark: Box = await documentBox(lead.locator("svg"));
    expect(
      Math.abs(centreOf(mark) - centreOf(await firstLineBox(lead))),
    ).toBeLessThanOrEqual(2);
    expect(await panelsInsideTheCard(page)).toEqual([]);
  });

  test("a first analysis has no lead", async ({ page }: { page: Page }) => {
    await openReady(page, INCIDENT_PAGE, "linked=alerts");
    await expect(followUpLead(page)).toHaveCount(0);
  });

  test("the feed says OneUptime AI checked again, and why, apart from the first analysis", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "linked=followup");
    const feed: Locator = card(page, "Incident Feed");
    const followUp: Locator = feedEntry(feed, FOLLOW_UP_FEED_LEAD);
    await expect(followUp).toHaveCount(1, { timeout: 30000 });

    expect(await plainText(followUp.getByTestId("feed-entry-intro"))).toBe(
      FOLLOW_UP_FEED_LEAD,
    );
    await expect(followUp.getByTestId("feed-entry-body")).toContainText(
      "Alert #318 does not change the earlier analysis",
    );
    await expect(followUp.getByTestId("feed-entry-body")).not.toContainText(
      "Checked again",
    );

    // The first analysis, below it, is posted as it always was.
    const first: Locator = feedEntry(feed, FIRST_ANALYSIS_FEED_LEAD);
    await expect(first).toHaveCount(1);
    await expectAbove(followUp, first, "the newest first");

    // The whole report, its lead included, unfolds under the entry.
    await followUp
      .getByRole("button", { name: "Show the full report" })
      .click();
    await expect(followUp.getByTestId("feed-entry-details")).toContainText(
      "Checked again after alert #318",
    );
  });

  test("the infrastructure tools' evidence reads in words: the containers table and the CPU by state", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "linked=followup");
    await showFullReport(page);
    await expect(followUpLead(page)).toBeVisible({ timeout: 30000 });

    const containers: Locator = await expandEvidence(page, "C2");
    await expect(evidenceToggle(evidenceRow(page, "C2"))).toContainText(
      "Checked a host's containers",
    );
    expect(await definitionPairs(containers)).toEqual(
      expect.arrayContaining([
        { label: "Resource type", value: "Docker Host" },
        { label: "Resource", value: "84000000…" },
        { label: "Ranked by", value: "CPU" },
      ]),
    );
    await expectRowsLoaded(containers);
    await expect(containers.locator("thead th")).toHaveText([
      "Container",
      "Status",
      "CPU avg %",
      "CPU peak %",
      "Memory peak %",
      "Restarts",
      "Last seen",
      "Image",
    ]);
    await expect(containers.locator("tbody tr").first()).toContainText(
      "Stopped reporting",
    );
    // Dated in the reader's time, not by ISO instants.
    await expect(containers).toContainText("Sep 14, 5:49 PM – 6:04 PM");
    await expect(containers).not.toContainText("2026-09-14T17:49");

    const cpu: Locator = await expandEvidence(page, "C3");
    await expect(evidenceToggle(evidenceRow(page, "C3"))).toContainText(
      "Read a resource's telemetry",
    );
    expect(await definitionPairs(cpu)).toEqual(
      expect.arrayContaining([
        { label: "Telemetry", value: "Metrics" },
        { label: "Mode", value: "Trend" },
      ]),
    );
    await expectRowsLoaded(cpu);
    await expect(cpu).toContainText("Avg of system.cpu.utilization by state");
  });

  test("on a phone nothing scrolls sideways, in the light and the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });

    for (const query of [
      "linked=followup",
      "linked=followup&theme=dark",
      "ai=running&linked=followup",
    ]) {
      await open(page, INCIDENT_PATH, query);
      // A finished check's working is under its folded report.
      if (!query.includes("ai=running")) {
        await showFullReport(page);
      }
      await expect(investigationCard(page)).toContainText("checking again", {
        ignoreCase: true,
        timeout: 30000,
      });
      await expectNoHorizontalOverflow(page);
    }
  });

  test("screenshots", async ({ page }: { page: Page }) => {
    const shots: ReadonlyArray<{ file: string; query: string; width: number }> =
      [
        { file: "ai-card-followup", query: "linked=followup", width: 1440 },
        {
          file: "ai-card-followup-running",
          query: "ai=running&linked=followup",
          width: 1440,
        },
        {
          file: "ai-card-followup-dark",
          query: "linked=followup&theme=dark",
          width: 1440,
        },
        {
          file: "ai-card-followup-mobile",
          query: "linked=followup",
          width: 390,
        },
        {
          file: "ai-card-linked-running-mobile",
          query: "ai=running&linked=alerts",
          width: 390,
        },
      ];

    for (const shot of shots) {
      await page.setViewportSize({ width: shot.width, height: 1000 });
      await open(page, INCIDENT_PATH, shot.query);
      if (!shot.query.includes("ai=running")) {
        await showFullReport(page);
      }
      await expect(investigationCard(page)).toContainText(
        shot.query.includes("ai=running")
          ? "Starting investigation"
          : REPORT_CAVEAT,
        { timeout: 30000 },
      );
      await page.mouse.move(0, 0);
      await screenshotElement(investigationCard(page), shot.file);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, INCIDENT_PATH, "linked=followup");
    const feed: Locator = card(page, "Incident Feed");
    await expect(feedEntry(feed, FOLLOW_UP_FEED_LEAD)).toHaveCount(1, {
      timeout: 30000,
    });
    await page.mouse.move(0, 0);
    await screenshotElement(feed, "incident-feed-followup");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A private incident or episode takes no public notes
 * ---------------------------------------------------------------------------
 *
 * ?private=1 makes incident #1042 and incident episode #12 private: on no
 * status page and told to no subscriber, so a public note on them would reach
 * nobody it was written for (Common/Types/StatusPage/PrivateRecordPublicNotes).
 * The incident's state change dialogs fold a private note and ask nothing
 * about subscribers, and both feeds' "Add Public Note" is locked with the
 * reason - the sentence the server refuses one with.
 */
const PRIVATE_INCIDENT_REFUSAL: string =
  "This incident is private, so public notes cannot be added to it. Use a private note.";
const PRIVATE_EPISODE_REFUSAL: string =
  "This episode is private, so public notes cannot be added to it. Use a private note.";

async function openFeedActions(page: Page, feed: string): Promise<Locator> {
  await card(page, feed).getByTestId("feed-actions-button").click();
  const menu: Locator = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

// The tooltip a locked menu item shows on hover, saying why it is locked.
function tooltipSaying(page: Page, text: string): Locator {
  return page.locator("[data-tippy-root]").filter({ hasText: text });
}

test.describe("a private incident or episode (?private=1)", () => {
  test("Acknowledge on a private incident folds a private note, asks nothing about subscribers, and sends the note as a private one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=created&private=1");
    await expect(hero(page)).toContainText("Private");

    await heroActions(page)
      .getByRole("button", { name: "Acknowledge" })
      .click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Acknowledge Incident",
    });
    await expect(dialog).toBeVisible();
    // A confirm: no subscribers to ask about, and the private note folded.
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Add a public note" }),
    ).toHaveCount(0);
    const noteFold: Locator = dialog.getByRole("button", {
      name: "Add a private note",
    });
    await expect(noteFold).toHaveAttribute("aria-expanded", "false");
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(512);
    await page.mouse.move(0, 0);
    await screenshotElement(dialog, "incident-private-acknowledge-dialog");

    await noteFold.click();
    await expect(dialog).toContainText(
      "Post a private note about this state change.",
    );
    await dialog.locator('[contenteditable="true"]').first().click();
    await page.keyboard.type("Paged the database team.");
    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Acknowledge", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    const creates: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "IncidentStateTimeline";
      },
    );
    expect(creates).toHaveLength(1);
    // A private note, never a public one, and nobody notified.
    expect(String(creates[0]?.miscDataProps?.["privateNote"])).toContain(
      "Paged the database team.",
    );
    expect(creates[0]?.miscDataProps?.["publicNote"]).toBeUndefined();
    expect(creates[0]?.data?.["shouldStatusPageSubscribersBeNotified"]).toBe(
      false,
    );
    await expectNoErrorStates(page);
  });

  test("Resolve on an incident that is not private still asks about subscribers and folds a public note", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=ongoing");

    await page.locator("#incident-resolve-btn").click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Resolve Incident",
    });
    await expect(
      dialog.getByRole("checkbox", { name: "Notify Status Page Subscribers" }),
    ).toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Add a public note" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Add a private note" }),
    ).toHaveCount(0);
  });

  test("the private incident's feed locks Add Public Note with why, and Add Private Note opens the private composer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "private=1");

    const menu: Locator = await openFeedActions(page, INCIDENT_PAGE.feed);
    const addPublic: Locator = menu.getByRole("menuitem", {
      name: "Add Public Note",
      exact: true,
    });
    await expect(addPublic).toHaveAttribute("aria-disabled", "true");
    await expect(addPublic).toHaveAccessibleDescription(
      PRIVATE_INCIDENT_REFUSAL,
    );

    // Hovered, it says why; pressed, it opens nothing.
    await addPublic.hover();
    await expect(tooltipSaying(page, PRIVATE_INCIDENT_REFUSAL)).toBeVisible();
    await addPublic.click({ force: true });
    await expect(
      page.getByRole("dialog", { name: "Add Public Note" }),
    ).toHaveCount(0);

    if (!(await menu.isVisible())) {
      await openFeedActions(page, INCIDENT_PAGE.feed);
    }
    const addPrivate: Locator = page.getByRole("menuitem", {
      name: "Add Private Note",
      exact: true,
    });
    await expect(addPrivate).not.toHaveAttribute("aria-disabled", "true");
    await addPrivate.click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Add Private Note",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("note-audience")).toContainText(
      "Only your team can see this",
    );
    expect(
      (await fixture(page)).creates.filter((write: RecordedWrite): boolean => {
        return write.modelName === "IncidentPublicNote";
      }),
    ).toEqual([]);
  });

  test("the private episode's feed locks Add Public Note in the episode's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_EPISODE_PAGE, "private=1");

    const menu: Locator = await openFeedActions(
      page,
      INCIDENT_EPISODE_PAGE.feed,
    );
    const addPublic: Locator = menu.getByRole("menuitem", {
      name: "Add Public Note",
      exact: true,
    });
    await expect(addPublic).toHaveAttribute("aria-disabled", "true");
    await expect(addPublic).toHaveAccessibleDescription(
      PRIVATE_EPISODE_REFUSAL,
    );
    await expect(
      menu.getByRole("menuitem", { name: "Add Private Note", exact: true }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("an incident that is not private offers Add Public Note as always", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const menu: Locator = await openFeedActions(page, INCIDENT_PAGE.feed);
    await expect(
      menu.getByRole("menuitem", { name: "Add Public Note", exact: true }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("screenshots of the private incident's locked Add Public Note", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "private=1");

    const menu: Locator = await openFeedActions(page, INCIDENT_PAGE.feed);
    await menu
      .getByRole("menuitem", { name: "Add Public Note", exact: true })
      .hover();
    const tooltip: Locator = tooltipSaying(page, PRIVATE_INCIDENT_REFUSAL);
    await expect(tooltip).toBeVisible();

    // The Actions button, its menu and the tooltip beside it, in one shot.
    const boxes: Array<Box> = [
      await documentBox(
        card(page, INCIDENT_PAGE.feed).getByTestId("feed-actions-button"),
      ),
      await documentBox(menu),
      await documentBox(tooltip),
    ];
    const left: number = Math.min(
      ...boxes.map((box: Box): number => {
        return box.x;
      }),
    );
    const top: number = Math.min(
      ...boxes.map((box: Box): number => {
        return box.y;
      }),
    );
    const right: number = Math.max(
      ...boxes.map((box: Box): number => {
        return box.x + box.width;
      }),
    );
    const bottom: number = Math.max(
      ...boxes.map((box: Box): number => {
        return box.y + box.height;
      }),
    );
    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(
        SCREENSHOTS,
        "incident-private-feed-add-public-note-locked-synthetic.png",
      ),
      fullPage: true,
      clip: {
        x: Math.max(0, left - 16),
        y: Math.max(0, top - 16),
        width: right - left + 32,
        height: bottom - top + 32,
      },
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * An incident call's transcript (?calls=, ?transcriptFetch=) - issue #4875
 * ---------------------------------------------------------------------------
 *
 * Incident #1042's Zoom meeting keeps its transcript: read from Zoom, or
 * added by a person (a Microsoft Teams meeting's, which Microsoft lets no
 * app read). OneUptime AI reads it and suggests the root cause on the AI
 * card - marked as a suggestion, resting on quoted lines - and nothing
 * reaches the incident until a person uses it.
 */
test.describe("an incident call's transcript (?calls=)", () => {
  const ZOOM_CALL_ID: string = uuid("88000000", 1);

  function callsCard(page: Page): Locator {
    return page.getByTestId("event-video-calls-card");
  }

  function callSummary(page: Page): Locator {
    return page.getByTestId("call-summary");
  }

  // The Incident Feed card (the tests below name the Video Call card "card").
  function incidentFeed(page: Page): Locator {
    return page.getByTestId("card").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: "Incident Feed",
        exact: true,
      }),
    });
  }

  async function transcriptRequests(
    page: Page,
    method: string,
    route: string,
  ): Promise<Array<RecordedApiRequest>> {
    return (
      await apiRequestsTo(page, `/incident-video-call/${ZOOM_CALL_ID}/${route}`)
    ).filter((request: RecordedApiRequest): boolean => {
      return request.method === method;
    });
  }

  test("Get from Zoom reads the transcript, and what OneUptime AI suggests appears on the AI card without a reload", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=zoom");

    const card: Locator = callsCard(page);
    // Nothing read yet: the AI card says nothing about the call.
    await expect(page.getByTestId("call-summaries")).toHaveCount(0);
    await expect(
      card.getByText(
        "Add it after the call: OneUptime AI reads it and suggests the root cause, for you to review.",
      ),
    ).toBeVisible();

    await card.getByRole("button", { name: "Get from Zoom" }).click();

    await expect(card.getByTestId("call-transcript-reading")).toHaveText(
      "OneUptime AI is reading it…",
    );
    await expect(card.getByTestId("call-transcript-facts")).toContainText(
      "11 minutes · 3 speakers · Read from Zoom",
    );
    await expect(page.getByTestId("call-summary-reading")).toBeVisible();

    // The page looks again while it reads.
    await expect(card.getByTestId("call-transcript-read")).toContainText(
      "OneUptime AI suggested a root cause. Review it",
      { timeout: 30000 },
    );
    expect(
      await transcriptRequests(page, "POST", "transcript/from-provider"),
    ).toHaveLength(1);

    // The feed says who added it, as it says who did anything else.
    const added: Locator = feedEntry(incidentFeed(page), "transcript");
    await expect(added).toHaveAttribute(
      "data-event-type",
      "VideoCallTranscriptAdded",
    );
    expect(await plainText(added.getByTestId("feed-entry-lead"))).toBe(
      "Maya Chen added the call's transcript from Zoom: 11 minutes, 3 speakers, 12 remarks.",
    );

    await card.getByTestId("call-transcript-review").click();

    await expect(callSummary(page)).toBeFocused();
    await expect(callSummary(page)).toBeInViewport();
    await expect(
      callSummary(page).getByTestId("call-summary-status"),
    ).toHaveText("Not confirmed");
    await expectNoErrorStates(page);
  });

  test("when Zoom has no transcript to give, the card says why and what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * One short sentence of the card's own for each answer, in the reader's
     * language; what Zoom said - scope names and all - behind Show details.
     */
    const answers: Array<{
      mode: string;
      text: string;
      zoomSaid: string;
      docs: boolean;
    }> = [
      {
        mode: "not-ready",
        text: "Zoom is still preparing this meeting's transcript. Try again in a few minutes.",
        zoomSaid: "It is usually ready within twice the length of the call.",
        docs: false,
      },
      {
        mode: "permission",
        text: "The Zoom connection is not allowed to read transcripts yet.",
        zoomSaid: "cloud_recording:read:list_recording_files:admin",
        docs: true,
      },
      {
        mode: "not-transcribed",
        text: "Zoom kept no transcript of this meeting. Add it yourself, or turn transcripts on for the next call.",
        zoomSaid: "Audio transcript on",
        docs: true,
      },
    ];

    for (const answer of answers) {
      await openReady(
        page,
        INCIDENT_PAGE,
        `calls=zoom&transcriptFetch=${answer.mode}`,
      );

      const card: Locator = callsCard(page);
      await card.getByRole("button", { name: "Get from Zoom" }).click();

      const outcome: Locator = card.getByTestId("call-transcript-outcome");
      await expect(
        outcome.getByTestId("call-transcript-outcome-headline"),
      ).toHaveText(answer.text);
      await expect(outcome).not.toContainText(answer.zoomSaid);

      const toggle: Locator = outcome.getByRole("button", {
        name: "Show details",
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(
        outcome.getByTestId("call-transcript-outcome-details"),
      ).toContainText(answer.zoomSaid);
      await expect(
        outcome.getByRole("button", { name: "Hide details" }),
      ).toHaveAttribute("aria-expanded", "true");

      const docs: Locator = outcome.getByRole("link", {
        name: "How to set it up",
      });

      if (answer.docs) {
        await expect(docs).toHaveAttribute(
          "href",
          /\/docs\/workspace-connections\/video-calls#call-transcripts$/,
        );
        await expect(docs).toHaveAttribute("target", "_blank");
        await expect(docs).toHaveAttribute("rel", "noopener noreferrer");
      } else {
        await expect(docs).toHaveCount(0);
      }

      // Nothing was added: the transcript is still to get.
      await expect(card.getByTestId("call-transcript-facts")).toHaveCount(0);

      await outcome.getByRole("button", { name: "Dismiss" }).click();
      await expect(outcome).toHaveCount(0);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(
      page,
      INCIDENT_PAGE,
      "calls=zoom&transcriptFetch=permission",
    );
    await callsCard(page)
      .getByRole("button", { name: "Get from Zoom" })
      .click();
    await expect(
      callsCard(page).getByTestId("call-transcript-outcome"),
    ).toBeVisible();
    await callsCard(page).getByRole("button", { name: "Show details" }).click();
    await expect(
      callsCard(page).getByTestId("call-transcript-outcome-details"),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("a Microsoft Teams meeting's transcript is added by hand, and read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=teams");

    const card: Locator = callsCard(page);
    await expect(card.getByTestId("call-transcript-get")).toHaveCount(0);

    await card.getByRole("button", { name: "Add transcript" }).click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Add the call's transcript",
    });
    await expect(dialog).toContainText(
      "In Microsoft Teams, open the meeting's Recap, then Transcript, and download it as a .vtt file.",
    );
    await expect(
      dialog.getByRole("button", { name: "Add transcript" }),
    ).toBeDisabled();

    const text: string =
      "[00:00:05] Priya Shah: Checkout is timing out.\n[00:12:03] Sam Lee: The pool maxes at 50.";
    await dialog.getByTestId("add-call-transcript-text").fill(text);
    await dialog.getByRole("button", { name: "Add transcript" }).click();
    await expect(dialog).toHaveCount(0);

    const [added] = await transcriptRequests(page, "POST", "transcript");
    expect(added?.body).toEqual({ text });

    await expect(card.getByTestId("call-transcript-facts")).toContainText(
      "12 minutes · 2 speakers · Added by Maya Chen 1 minute ago",
    );
    expect(
      await plainText(
        feedEntry(incidentFeed(page), "transcript").getByTestId(
          "feed-entry-lead",
        ),
      ),
    ).toBe(
      "Maya Chen added a transcript of the Microsoft Teams meeting: 12 minutes, 2 speakers, 2 remarks.",
    );
    await expect(card.getByTestId("call-transcript-read")).toBeVisible({
      timeout: 30000,
    });
  });

  test("the suggested root cause: marked Not confirmed, resting on the call's lines in the order they were said", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=transcript");

    const section: Locator = callSummary(page);
    await expect(section).toContainText("From the incident's call");
    await expect(section.getByTestId("call-summary-status")).toHaveText(
      "Not confirmed",
    );
    await expect(section).toContainText(
      "Said on the call: someone found or confirmed it.",
    );

    const quotes: Locator = section.getByTestId("call-summary-quote");
    await expect(quotes).toHaveCount(3);
    expect(
      await quotes.evaluateAll(
        (items: Array<Element>): Array<string | null> => {
          return items.map((item: Element): string | null => {
            return item.getAttribute("data-line");
          });
        },
      ),
    ).toEqual(["6", "10", "11"]);
    await expect(quotes.first()).toContainText("00:04:03 · Sam Rivera");

    // Nothing reached the incident by being suggested.
    expect(
      (await fixture(page)).updates.filter((write: RecordedWrite): boolean => {
        return write.modelName === "Incident";
      }),
    ).toEqual([]);

    // The rest of what the call said is folded under it.
    const details: Locator = section.getByTestId("call-summary-details");
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").click();

    // What the call confirmed, then the hypotheses: two lists, no tags.
    const confirmed: Locator = details.getByTestId("call-summary-confirmed");
    const hypotheses: Locator = details.getByTestId("call-summary-hypotheses");
    await expect(confirmed.getByRole("heading", { level: 5 })).toHaveText(
      "Confirmed on the call",
    );
    await expect(confirmed.getByTestId("call-summary-point")).toHaveText([
      "The orders database itself was healthy. 00:00:31",
      "Requests waited about two seconds in pg.pool.connect. 00:01:12",
    ]);
    await expect(hypotheses.getByRole("heading", { level: 5 })).toHaveText(
      "Hypotheses",
    );
    await expect(hypotheses.getByTestId("call-summary-point")).toHaveText([
      "A cold cache may have added to it. 00:05:02",
    ]);
    expect(
      (await confirmed.boundingBox())!.y < (await hypotheses.boundingBox())!.y,
    ).toBe(true);
    await expect(details.getByTestId("call-summary-actions")).toContainText(
      "Add an alert on database pool usage. (Jordan Patel)",
    );
  });

  test("View transcript starts on the quoted lines, highlighted", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=transcript");

    await callSummary(page)
      .getByRole("button", { name: "View transcript" })
      .click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Transcript of the Zoom meeting",
    });
    const lines: Locator = dialog.getByTestId("call-transcript-line");
    await expect(lines).toHaveCount(12);
    await expect(
      dialog.getByTestId("call-transcript-highlight-legend"),
    ).toBeVisible();
    await expect(dialog.locator("[data-highlighted='true']")).toHaveCount(3);
    await expect(lines.nth(5)).toHaveAttribute("data-highlighted", "true");

    await dialog.getByTestId("call-transcript-search").fill("rollback");
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText(
      "Rollback done, p95 is back under 300 milliseconds.",
    );
  });

  test("Use as root cause: the editor shows the suggestion as written, nothing is saved until the person saves it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=transcript");

    const section: Locator = callSummary(page);
    await section.getByRole("button", { name: "Use as root cause" }).click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Use as root cause",
    });
    const editor: Locator = dialog.locator('[contenteditable="true"]').first();

    // It opens in the editor, named for what it holds - not on its Bold button.
    await expect(editor).toBeFocused();
    await expect(
      dialog.getByRole("textbox", { name: "Root Cause" }),
    ).toBeVisible();

    // An identifier stays as written: code, never italic.
    await expect(editor.locator("code").first()).toHaveText("DB_POOL_MAX=10");
    await expect(editor.locator("em")).toHaveCount(0);
    await expect(editor.locator("blockquote")).toHaveCount(3);
    await expect(editor.locator("blockquote").first()).toContainText(
      "00:04:03 · Sam Rivera: The new release has DB_POOL_MAX=10, it was 40 before.",
    );

    // It replaces the incident's root cause, which it shows.
    await expect(dialog).toContainText(
      "It replaces the incident's current root cause. Show it",
    );

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(
      await transcriptRequests(page, "POST", "root-cause-suggestion"),
    ).toEqual([]);

    await section.getByRole("button", { name: "Use as root cause" }).click();
    await page
      .getByRole("dialog", { name: "Use as root cause" })
      .getByRole("button", { name: "Save as root cause" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Use as root cause" }),
    ).toHaveCount(0);

    const [decision] = await transcriptRequests(
      page,
      "POST",
      "root-cause-suggestion",
    );
    expect(decision?.body["decision"]).toBe("Accepted");
    expect(String(decision?.body["rootCause"])).toContain(
      "shipped with `DB_POOL_MAX=10` instead of 40",
    );
    expect(String(decision?.body["rootCause"])).toContain(
      "> 00:04:03 · Sam Rivera: The new release has `DB_POOL_MAX=10`, it was 40 before.",
    );

    await expect(section.getByTestId("call-summary-status")).toHaveText(
      "Used as root cause",
    );
    await expect(
      section.getByRole("link", { name: "View root cause" }),
    ).toBeVisible();
    await expect(
      callsCard(page).getByTestId("call-transcript-read"),
    ).toContainText("Used as the incident's root cause.");
  });

  test("a save the server refuses keeps the dialog open and says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=transcript&fail=suggestion");

    await callSummary(page)
      .getByRole("button", { name: "Use as root cause" })
      .click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Use as root cause",
    });
    await dialog.getByRole("button", { name: "Save as root cause" }).click();

    await expect(dialog).toContainText(
      "You do not have permission to edit this incident's root cause.",
    );
    await expect(
      callSummary(page).getByTestId("call-summary-status"),
    ).toHaveText("Not confirmed");
  });

  test("Dismiss sets the suggestion aside, and Undo brings it back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=transcript");

    const section: Locator = callSummary(page);
    await section.getByRole("button", { name: "Dismiss" }).click();

    await expect(section.getByTestId("call-summary-status")).toHaveText(
      "Dismissed",
    );
    await expect(section).toContainText("Maya Chen dismissed it 1 minute ago");
    // Set aside: its one sentence stays, its quotes and its basis go.
    await expect(section.getByTestId("call-summary-quote")).toHaveCount(0);
    await expect(section.getByTestId("call-summary-basis")).toHaveCount(0);
    await expect(
      section.getByTestId("call-summary-root-cause-text"),
    ).toBeVisible();

    await section.getByRole("button", { name: "Undo" }).click();
    await expect(section.getByTestId("call-summary-status")).toHaveText(
      "Not confirmed",
    );
    await expect(section.getByTestId("call-summary-quote")).toHaveCount(3);

    expect(
      (await transcriptRequests(page, "POST", "root-cause-suggestion")).map(
        (request: RecordedApiRequest): unknown => {
          return request.body["decision"];
        },
      ),
    ).toEqual(["Dismissed", "Suggested"]);
  });

  test("a decision already made: who used it, or dismissed it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=accepted");
    await expect(callSummary(page)).toContainText(
      "Jordan Patel used it as the incident's root cause",
    );
    await expect(
      callSummary(page).getByRole("button", { name: "Use as root cause" }),
    ).toHaveCount(0);

    await openReady(page, INCIDENT_PAGE, "calls=dismissed");
    await expect(callSummary(page)).toContainText("Jordan Patel dismissed it");
    await expect(
      callSummary(page).getByRole("button", { name: "Undo" }),
    ).toBeVisible();
  });

  test("a call that did not settle the cause suggests none, and says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=not-enough");

    const section: Locator = callSummary(page);
    await expect(section.getByTestId("call-summary-not-enough")).toContainText(
      "Not enough was said on the call to suggest a root cause",
    );
    await expect(section.getByTestId("call-summary-root-cause")).toHaveCount(0);
    await expect(section.getByTestId("call-summary-details")).toHaveAttribute(
      "open",
      "",
    );
    await expect(
      callsCard(page).getByTestId("call-transcript-read"),
    ).toContainText("not enough was said to suggest a root cause");
  });

  test("a reading that failed, or stopped part-way, is offered again from either card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=failed");

    await expect(page.getByTestId("call-summary-failed")).toContainText(
      "This project reached its daily AI token limit.",
    );
    await expect(
      callsCard(page).getByTestId("call-transcript-read-failed"),
    ).toContainText("OneUptime AI could not read it.");

    await page.getByTestId("call-summary-read-again").click();
    await expect(page.getByTestId("call-summary-reading")).toBeVisible();
    await expect(
      callSummary(page).getByTestId("call-summary-status"),
    ).toHaveText("Not confirmed", { timeout: 30000 });
    expect(await transcriptRequests(page, "POST", "call-summary")).toHaveLength(
      1,
    );

    await openReady(page, INCIDENT_PAGE, "calls=stuck");
    await expect(page.getByTestId("call-summary-failed")).toContainText(
      "Reading the transcript took too long",
    );
    await expect(
      callsCard(page).getByTestId("call-transcript-read-failed"),
    ).toContainText("OneUptime AI took too long to read it.");
  });

  test("AI off for the project: the card says so, and the AI card says nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=skipped");

    const skipped: Locator = callsCard(page).getByTestId(
      "call-transcript-read-skipped",
    );
    await expect(skipped).toHaveText(
      "AI is off for this project, so OneUptime AI did not read it. Open AI Features",
    );
    await expect(
      skipped.getByRole("link", { name: "Open AI Features" }),
    ).toHaveAttribute(
      "href",
      "/dashboard/10000000-0000-4000-8000-000000000001/settings/ai-features",
    );
    await expect(page.getByTestId("call-summaries")).toHaveCount(0);
  });

  /*
   * Record and transcribe incident calls (Project Settings > Workspace >
   * Video Calls): OneUptime gets the call's transcript by itself once the
   * call is over, and what OneUptime AI read in it is the incident's next
   * feed item.
   */
  test("while OneUptime waits to get Zoom's transcript by itself, the card says so, and Get and Add stay", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=waiting");

    const card: Locator = callsCard(page);

    await expect(card.getByTestId("call-transcript-waiting")).toHaveText(
      "OneUptime gets it from Zoom once the call is over, and OneUptime AI reads it.",
    );
    // Not the line for a call nobody waits on.
    await expect(
      card.getByText(
        "Add it after the call: OneUptime AI reads it and suggests the root cause, for you to review.",
      ),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Get from Zoom" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Add transcript" }),
    ).toBeVisible();
    await expect(page.getByTestId("call-summaries")).toHaveCount(0);
    await expectNoErrorStates(page);
  });

  test("once OneUptime stopped waiting, the card says what Zoom answered, with how to set it up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=fetch-stopped");

    const card: Locator = callsCard(page);
    const stopped: Locator = card.getByTestId("call-transcript-fetch-stopped");

    await expect(stopped).toHaveAttribute("data-reason", "NotTranscribed");
    await expect(stopped).toContainText(
      "Zoom kept no transcript of this meeting. Add it yourself, or turn transcripts on for the next call.",
    );
    await expect(
      stopped.getByRole("link", { name: "How to set it up" }),
    ).toHaveAttribute("target", "_blank");
    await expect(card.getByTestId("call-transcript-waiting")).toHaveCount(0);
    // Get and Add are still there, to try again or add it by hand.
    await expect(
      card.getByRole("button", { name: "Get from Zoom" }),
    ).toBeVisible();
    await expectNoErrorStates(page);
  });

  /*
   * Microsoft Teams: a meeting OneUptime put on its organizer's calendar is
   * waited on and read like a Zoom one; one it could not put there started
   * unrecorded, and its card says why from the start.
   */
  test("a Microsoft Teams call on its organizer's calendar is waited on, and Get from Microsoft Teams reads it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=teams-recorded");

    const card: Locator = callsCard(page);

    await expect(card.getByTestId("call-transcript-waiting")).toHaveText(
      "OneUptime gets it from Microsoft Teams once the call is over, and OneUptime AI reads it.",
    );

    await card
      .getByRole("button", { name: "Get from Microsoft Teams" })
      .click();

    await expect(card.getByTestId("call-transcript-facts")).toContainText(
      "11 minutes · 3 speakers · Read from Microsoft Teams",
    );
    await expect(card.getByTestId("call-transcript-waiting")).toHaveCount(0);
    expect(
      await transcriptRequests(page, "POST", "transcript/from-provider"),
    ).toHaveLength(1);
    expect(
      await plainText(
        feedEntry(incidentFeed(page), "transcript").getByTestId(
          "feed-entry-lead",
        ),
      ),
    ).toBe(
      "Maya Chen added the call's transcript from Microsoft Teams: 11 minutes, 3 speakers, 12 remarks.",
    );
    await expectNoErrorStates(page);
  });

  test("a Microsoft Teams call OneUptime could not put on a calendar says so from the start, with how to set it up, and Add transcript", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=teams-not-recorded");

    const card: Locator = callsCard(page);
    const stopped: Locator = card.getByTestId("call-transcript-fetch-stopped");

    await expect(stopped).toHaveAttribute("data-reason", "PermissionMissing");
    await expect(stopped).toContainText(
      "The Microsoft Teams connection is not allowed to read transcripts yet.",
    );
    await expect(
      stopped.getByRole("link", { name: "How to set it up" }),
    ).toHaveAttribute(
      "href",
      /\/docs\/workspace-connections\/video-calls#call-transcripts$/,
    );
    await expect(card.getByTestId("call-transcript-waiting")).toHaveCount(0);
    // Never on a calendar: there is nothing to get, so it is added by hand.
    await expect(card.getByTestId("call-transcript-get")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Add transcript" }),
    ).toBeVisible();
    await screenshotElement(card, "teams-call-not-recorded");
    await expectNoErrorStates(page);
  });

  test("what OneUptime AI read in the call is OneUptime AI's note in the incident's feed, the cause marked as a suggestion", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=summary");

    const entry: Locator = feedEntry(
      incidentFeed(page),
      "OneUptime AI read the transcript of the Zoom meeting",
    );

    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveAttribute("data-event-type", "VideoCallSummary");
    // Nobody's name on it: it is OneUptime AI's.
    await expect(entry.getByTestId("feed-entry-author")).toHaveCount(0);

    const body: Locator = entry.getByTestId("feed-entry-body");

    await expect(body).toHaveAttribute("data-note", "true");
    await expect(body).toContainText("Suggested root cause (not confirmed):");
    await expect(body).toContainText(
      "Stated on the call. Use it as the incident's root cause, or dismiss it, on the incident's page.",
    );

    for (const part of [
      "Confirmed on the call",
      "Hypotheses",
      "What was tried",
      "Decisions",
      "Follow-ups",
      "Open questions",
    ]) {
      await expect(body.getByText(part, { exact: true })).toBeVisible();
    }

    await expect(body).toContainText(
      "Add an alert on database pool usage. (Jordan Patel)",
    );
    // A name with underscores reads as written, never as emphasis.
    await expect(body).toContainText("Why the release changed DB_POOL_MAX.");
    await expect(
      body.locator("em, strong").filter({ hasText: "POOL" }),
    ).toHaveCount(0);
    await screenshotElement(entry, "feed-call-summary");
    // And the AI card shows the same reading, for Use as root cause.
    await expect(
      callSummary(page).getByTestId("call-summary-status"),
    ).toHaveText("Not confirmed");
    await expectNoErrorStates(page);
  });

  test("removing the transcript asks first and keeps the incident's root cause", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=transcript");

    const card: Locator = callsCard(page);
    await card.getByTestId("call-transcript-menu-button").click();
    await page.getByRole("menuitem", { name: "Remove transcript" }).click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Remove the transcript?",
    });
    await expect(dialog).toContainText("The incident's root cause is kept.");
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(dialog).toHaveCount(0);

    expect(await transcriptRequests(page, "DELETE", "transcript")).toHaveLength(
      1,
    );
    await expect(
      card.getByRole("button", { name: "Get from Zoom" }),
    ).toBeVisible();
    await expect(page.getByTestId("call-summaries")).toHaveCount(0);
  });

  test("two calls: each named for its own, the earlier one's transcript on one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "calls=two");

    await expect(callSummary(page)).toContainText("From the Zoom meeting");

    const rows: Locator = callsCard(page).getByTestId("event-video-call");
    await expect(rows).toHaveCount(2);
    await expect(
      rows.nth(1).getByRole("button", { name: "Add transcript" }),
    ).toBeVisible();
  });

  test("on a phone and in the dark theme, both cards fit and read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openReady(page, INCIDENT_PAGE, "calls=transcript");
    await page.mouse.move(0, 0);
    await screenshotElement(callsCard(page), "incident-call-transcript-card");
    await screenshotElement(
      page.getByTestId("call-summaries"),
      "incident-call-summary",
    );

    await openReady(page, INCIDENT_PAGE, "calls=transcript&theme=dark");
    await page.mouse.move(0, 0);
    await screenshotElement(
      callsCard(page),
      "incident-call-transcript-card-dark",
    );
    await screenshotElement(
      page.getByTestId("call-summaries"),
      "incident-call-summary-dark",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, INCIDENT_PAGE, "calls=transcript");
    await expectNoHorizontalOverflow(page);

    /*
     * The heading shares its line with the menu's mark alone, and View
     * transcript has a row of its own under the reading, as wide as the
     * card on a phone; Copy link and Remove go under Join call together.
     */
    const heading: Box = await documentBox(
      callsCard(page).getByTestId("call-transcript-heading"),
    );
    const menu: Box = await documentBox(
      callsCard(page).getByTestId("call-transcript-menu-button"),
    );
    const read: Box = await documentBox(
      callsCard(page).getByTestId("call-transcript-read"),
    );
    const view: Box = await documentBox(
      callsCard(page).getByTestId("call-transcript-view"),
    );
    expect(
      Math.abs(menu.y + menu.height / 2 - (heading.y + heading.height / 2)),
    ).toBeLessThanOrEqual(2);
    expect(view.y).toBeGreaterThanOrEqual(read.y + read.height);
    expect(view.width).toBeGreaterThan(menu.x - heading.x);

    const join: Box = await documentBox(
      callsCard(page).getByTestId("event-video-call-join"),
    );
    const secondary: Box = await documentBox(
      callsCard(page).getByTestId("event-video-call-secondary-actions"),
    );
    expect(secondary.y).toBeGreaterThanOrEqual(join.y + join.height);

    await screenshotElement(
      page.getByTestId("call-summaries"),
      "incident-call-summary-mobile",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Time to acknowledge after paging
 * ---------------------------------------------------------------------------
 * "Acknowledged in" counts from when the record began. For a record
 * somebody was paged about (First Paged At), the tile keeps that number and
 * adds one short, quieter line: how long after the first page it was
 * acknowledged. Nothing changes for a record nobody was paged about.
 * ?paged=paged pages incident #1042 at 18:02 and alert #311 at 18:07, a
 * minute after each began; ?paged=never adds the measurement and pages
 * nobody (Fixture.js).
 */

interface StatTileLine {
  text: string;
  fontSize: number;
  color: string;
  lines: number;
}

/*
 * "Acknowledged in" is the second tile, after when the record began
 * (Declared on an incident, Created on an alert).
 */
const ACKNOWLEDGED_TILE: number = 1;

// Each line of one tile of a stat bar: label, value, note, date.
async function statTileLines(
  page: Page,
  name: string,
  index: number,
): Promise<Array<StatTileLine>> {
  return page
    .getByRole("group", { name, exact: true })
    .locator(":scope > div")
    .nth(index)
    .evaluate((cell: Element): Array<StatTileLine> => {
      return Array.from(cell.children).map((child: Element): StatTileLine => {
        const style: CSSStyleDeclaration = getComputedStyle(child);
        const lineHeight: number = parseFloat(style.lineHeight);
        return {
          text: (child.textContent || "").trim(),
          fontSize: parseFloat(style.fontSize),
          color: style.color,
          lines: Math.round(child.getBoundingClientRect().height / lineHeight),
        };
      });
    });
}

const AFTER_PAGING_INCIDENT_MEASUREMENTS: Array<MeasurementRow> = [
  INCIDENT_MEASUREMENTS[0]!,
  {
    name: "Time to acknowledge after paging",
    summary: "First paged → Acknowledged",
    value: "2 minutes",
    reason: null,
  },
  ...INCIDENT_MEASUREMENTS.slice(1),
];

test.describe("time to acknowledge after paging", () => {
  test("incident-overview: Acknowledged in keeps its number and adds the time after paging, quieter than it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "paged=paged");

    const lines: Array<StatTileLine> = await statTileLines(
      page,
      INCIDENT_PAGE.statBar,
      ACKNOWLEDGED_TILE,
    );
    expect(
      lines.map((line: StatTileLine): string => {
        return line.text;
      }),
    ).toEqual([
      "Acknowledged in",
      "3 minutes",
      "2 minutes after paging",
      "Sep 14 2026, 06:04 PM GMT",
    ]);
    const [, value, note, date] = lines;
    // Smaller and lighter than the value, larger than the date: value, note, date.
    expect(note!.fontSize).toBeLessThan(value!.fontSize);
    expect(note!.fontSize).toBeGreaterThan(date!.fontSize);
    expect(note!.color).not.toBe(value!.color);
    expect(note!.lines).toBe(1);

    // The other tiles are as they were.
    const cells: Array<StatCell> = await statCells(page, INCIDENT_PAGE.statBar);
    expect([cells[0], cells[2]]).toEqual([
      INCIDENT_PAGE.stats[0],
      INCIDENT_PAGE.stats[2],
    ]);

    // The measurement sits next to Time to acknowledge.
    expect(await measurementRows(page)).toEqual(
      AFTER_PAGING_INCIDENT_MEASUREMENTS,
    );
  });

  test("alert-overview: the same line, from the alert's own first page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE, "paged=paged");

    expect(
      (await statTileLines(page, ALERT_PAGE.statBar, ACKNOWLEDGED_TILE)).map(
        (line: StatTileLine): string => {
          return line.text;
        },
      ),
    ).toEqual([
      "Acknowledged in",
      "2 minutes",
      "1 minute after paging",
      "Sep 14 2026, 06:08 PM GMT",
    ]);
    expect(await measurementRows(page)).toEqual([
      {
        name: "Time to acknowledge",
        summary: "Created → Acknowledged",
        value: "2 minutes",
        reason: null,
      },
      {
        name: "Time to acknowledge after paging",
        summary: "First paged → Acknowledged",
        value: "1 minute",
        reason: null,
      },
      {
        name: "Time to resolve",
        summary: "Created → Resolved",
        value: "9 minutes",
        reason: null,
      },
    ]);
  });

  test("?paged=never: nothing extra on the tile, and the measurement was never reached", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "paged=never");

    expect(await statCells(page, INCIDENT_PAGE.statBar)).toEqual(
      INCIDENT_PAGE.stats,
    );
    expect((await measurementRows(page))[1]).toEqual({
      name: "Time to acknowledge after paging",
      summary: "First paged → Acknowledged",
      value: "Not reached",
      reason: null,
    });
  });

  test("?state=created: paged and not yet acknowledged, the tile says only that, and the clock runs from the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "paged=paged&state=created");

    expect(
      (await statTileLines(page, INCIDENT_PAGE.statBar, ACKNOWLEDGED_TILE)).map(
        (line: StatTileLine): string => {
          return line.text;
        },
      ),
    ).toEqual(["Acknowledged in", "Not yet acknowledged"]);
    expect((await measurementRows(page))[1]).toEqual({
      name: "Time to acknowledge after paging",
      summary: "First paged → Acknowledged",
      // Paged at 18:02; the clock reads 18:20.
      value: "Running for 18 minutes",
      reason: null,
    });
  });

  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 640, 390]) {
      test(`reads well at ${width}px in the ${theme} theme`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openReady(
          page,
          INCIDENT_PAGE,
          theme === "dark" ? "paged=paged&theme=dark" : "paged=paged",
        );

        const [, value, note, date] = await statTileLines(
          page,
          INCIDENT_PAGE.statBar,
          ACKNOWLEDGED_TILE,
        );
        expect(note!.text).toBe("2 minutes after paging");
        // Its own colour in both themes: quieter than the value, not the date's.
        expect(note!.color).not.toBe(value!.color);
        expect(note!.color).not.toBe(date!.color);
        /*
         * One line where the cell has room; in the narrowest three-column
         * bar (640px) two even lines, never a word left on its own.
         */
        expect(note!.lines).toBe(width === 640 ? 2 : 1);
        await expectNoHorizontalOverflow(page);
      });
    }
  }
});

/*
 * ---------------------------------------------------------------------------
 * At a glance: what happened, its impact, and who is on it
 * ---------------------------------------------------------------------------
 * "Easy to see what happened, and impact. Easy to see Incident Commander and
 * Team(s)." The header names who commands the response - the roles card's
 * primary role - and who owns it, teams first; What happened (the record's
 * description and root cause) opens the left column and Affected Resources
 * the right one; and the stat bar opens with when it was declared, how long
 * after the impact began, and by whom. Each is said once. ?owners=,
 * ?commander= and ?what= pick what there is to show (Fixture.js).
 */

const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

/*
 * Where "+3 more" leads: the record's Owners page, which manages the whole
 * list. Add and Assign lead nowhere - they add right there, in the header.
 */
const INCIDENT_OWNERS_PATH: string = `${INCIDENT_PATH}/owners`;

// Who the roles card can give a role to: Jordan Patel (Fixture.js people).
const JORDAN_USER_ID: string = uuid("80000000", 3);
// The project's primary role, Incident Commander (Fixture.js roles).
const COMMANDER_ROLE_ID: string = uuid("76000000", 1);

/*
 * The empty place an open record shows where an avatar would be: a dashed
 * circle as big as an avatar, read as nothing.
 */
async function expectEmptyPlace(action: Locator): Promise<void> {
  const place: Locator = action.getByTestId("event-empty-place");
  await expect(place).toHaveAttribute("aria-hidden", "true");
  const look: { style: string; width: number; height: number } =
    await place.evaluate(
      (element: Element): { style: string; width: number; height: number } => {
        const box: DOMRect = element.getBoundingClientRect();
        return {
          style: getComputedStyle(element).borderTopStyle,
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      },
    );
  expect(look).toEqual({ style: "dashed", width: 24, height: 24 });
}

/*
 * Where a fact's label and its first name sit: the tops of their text, and
 * the fact's own height.
 */
async function factTextTops(
  fact: Locator,
): Promise<{ label: number; value: number; height: number }> {
  return fact.evaluate(
    (
      valueElement: Element,
    ): { label: number; value: number; height: number } => {
      const item: Element = valueElement.closest("dd")!.parentElement!;
      const textTop: (root: Element) => number = (root: Element): number => {
        const walker: TreeWalker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null = walker.nextNode();
        while (node && !(node.textContent || "").trim()) {
          node = walker.nextNode();
        }
        const range: Range = document.createRange();
        range.selectNodeContents(node!);
        return range.getBoundingClientRect().top;
      };
      const name: Element =
        valueElement.querySelector("[data-testid='event-person-name']") ||
        valueElement;
      return {
        label: textTop(item.querySelector("dt")!),
        value: textTop(name),
        height: item.getBoundingClientRect().height,
      };
    },
  );
}

function commanderFact(page: Page): Locator {
  return hero(page).getByTestId("event-commander");
}

function ownersFact(page: Page): Locator {
  return hero(page).getByTestId("event-owners");
}

// The project's teams (Fixture.js ownerTeams), as an owner row names them.
const PAYMENTS_TEAM_ID: string = uuid("81000000", 2);
const PLATFORM_TEAM_ID: string = uuid("81000000", 3);

/*
 * The Add owners list the header's Add opens - the Owners page's own list -
 * drawn over the page, under the control that opened it.
 */
function addOwnersList(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add owners" });
}

// The list the header's Assign opens: the project's people, for the role.
function assignList(page: Page): Locator {
  return page.getByRole("dialog", { name: "Assign Incident Commander" });
}

// The names a people list offers, in order: people first, then teams.
async function listedNames(list: Locator): Promise<Array<string>> {
  return list
    .getByTestId("people-search-option")
    .evaluateAll((options: Array<Element>): Array<string> => {
      return options.map((option: Element): string => {
        return (
          option.querySelector(":scope > .min-w-0 > div")?.textContent || ""
        ).trim();
      });
    });
}

/*
 * A list opened from the header is whole on screen - never cut off by the
 * viewport's edge - and sits right under the control that opened it.
 */
async function expectListWhole(page: Page, list: Locator): Promise<void> {
  const viewport: { width: number; height: number } = page.viewportSize()!;
  await expect
    .poll(async (): Promise<boolean> => {
      const box: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = await list.boundingBox();
      return Boolean(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width + 0.5 &&
          box.y + box.height <= viewport.height + 0.5,
      );
    }, "the list is whole on screen")
    .toBe(true);
}

// The rows a page wrote to one table.
async function rowsWritten(
  page: Page,
  modelName: string,
): Promise<Array<RecordedWrite>> {
  return (await fixture(page)).creates.filter(
    (write: RecordedWrite): boolean => {
      return write.modelName === modelName;
    },
  );
}

/*
 * An owner row as the Owners page writes one: the record, the project and
 * the person or the team - nothing else, so the server tells the new owner
 * they were added (the row starts as an owner nobody has told yet).
 */
function expectOwnerRow(
  write: RecordedWrite | undefined,
  data: {
    recordField: string;
    recordId: string;
    ownerField: string;
    ownerId: string;
  },
): void {
  expect(Object.keys(write?.data || {})).toEqual(
    expect.arrayContaining([data.recordField, "projectId", data.ownerField]),
  );
  const row: string = JSON.stringify(write?.data);
  expect(row).toContain(data.recordId);
  expect(row).toContain(PROJECT_ID);
  expect(row).toContain(data.ownerId);
  expect(row).not.toContain("isOwnerNotified");
}

async function personKinds(fact: Locator): Promise<Array<string | null>> {
  return fact
    .getByTestId("event-owner")
    .evaluateAll((people: Array<Element>): Array<string | null> => {
      return people.map((person: Element): string | null => {
        return person.getAttribute("data-kind");
      });
    });
}

/*
 * The lines a stat tile's value is drawn on, read character by character
 * from where each one lands, with no-break spaces read as plain ones.
 */
async function tileValueLines(
  page: Page,
  statBar: string,
  index: number,
): Promise<Array<string>> {
  return page
    .getByRole("group", { name: statBar, exact: true })
    .locator(":scope > div")
    .nth(index)
    .locator(":scope > div")
    .nth(1)
    .evaluate((element: Element): Array<string> => {
      /*
       * In reading order, a character starts a new line when it lies wholly
       * under the line before: the smaller zone sits lower on the same line
       * as the time, so lines are not told apart by their tops alone.
       */
      const lines: Array<{ bottom: number; text: string }> = [];
      const walker: TreeWalker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null = walker.nextNode();
      while (node) {
        const content: string = node.textContent || "";
        for (let offset: number = 0; offset < content.length; offset++) {
          const range: Range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect: DOMRect = range.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) {
            continue;
          }
          const last: { bottom: number; text: string } | undefined =
            lines[lines.length - 1];
          if (!last || rect.top >= last.bottom - 1) {
            lines.push({ bottom: rect.bottom, text: content[offset] || "" });
          } else {
            last.text += content[offset] || "";
            last.bottom = Math.max(last.bottom, rect.bottom);
          }
        }
        node = walker.nextNode();
      }
      return lines.map((line: { bottom: number; text: string }): string => {
        return line.text.split(String.fromCharCode(0xa0)).join(" ").trim();
      });
    });
}

// The background a team's avatar is drawn on.
async function teamAvatarBackground(fact: Locator): Promise<string> {
  return fact
    .locator("[data-kind='team'] [aria-hidden='true'] .bg-gradient-to-br")
    .first()
    .evaluate((avatar: Element): string => {
      return getComputedStyle(avatar).backgroundImage;
    });
}

test.describe("at a glance: who is on it", () => {
  test("the incident's header names its Incident Commander and its owners, teams first, each with an avatar", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const commander: Locator = commanderFact(page);
    await expect(commander.getByTestId("event-person-name")).toHaveText([
      "Maya Chen",
    ]);
    // The avatar is decoration: a screen reader hears the name once.
    await expect(
      commander
        .getByTestId("event-commander-person")
        .locator(":scope > [aria-hidden='true']"),
    ).toHaveCount(1);
    await expect(commander.getByRole("button")).toHaveCount(0);

    const owners: Locator = ownersFact(page);
    await expect(owners.getByTestId("event-person-name")).toHaveText([
      "Checkout SRE",
      "Sam Rivera",
    ]);
    expect(await personKinds(owners)).toEqual(["team", "user"]);
    // All of them are shown: nothing to follow to the rest.
    await expect(owners.getByRole("link")).toHaveCount(0);

    // The roles card names the same person.
    await expect(
      card(page, "Incident Roles").getByText("Maya Chen").first(),
    ).toBeVisible();

    const reads: Array<RecordedModelRequest> = (await fixture(page))
      .listRequests;
    // The header asks nobody who holds the role: the roles card tells it.
    expect(
      reads.filter((read: RecordedModelRequest): boolean => {
        return read.modelName === "IncidentMember";
      }),
      "role holders, read by the roles card alone",
    ).toHaveLength(1);
    // Both owner lists, this incident's, oldest first.
    for (const modelName of ["IncidentOwnerTeam", "IncidentOwnerUser"]) {
      const ownerReads: Array<RecordedModelRequest> = reads.filter(
        (read: RecordedModelRequest): boolean => {
          return read.modelName === modelName;
        },
      );
      expect(ownerReads, modelName).toHaveLength(1);
      expect(Object.keys(ownerReads[0]?.query || {}).sort()).toEqual([
        "incidentId",
        "projectId",
      ]);
      expect(JSON.stringify(ownerReads[0]?.query)).toContain(INCIDENT_ID);
      expect(ownerReads[0]?.sort).toEqual({ createdAt: "ASC" });
    }
    await expectNoErrorStates(page);
  });

  test("?commander=none&state=ongoing: the empty place and Assign, which opens the project's people right under it and gives the role there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "commander=none&state=ongoing");

    const commander: Locator = commanderFact(page);
    // Said once: the place and its action, not "Not assigned" beside them.
    await expect(commander).toHaveText("Assign");
    await expect(commander.getByTestId("event-person-name")).toHaveCount(0);

    // Visibly "Assign"; heard as which role it gives, and that it opens a list.
    const assign: Locator = commander.getByRole("button", {
      name: "Assign Incident Commander",
    });
    await expect(assign).toHaveText("Assign");
    await expect(assign).toHaveAttribute(
      "data-testid",
      "event-commander-assign",
    );
    await expect(assign).toHaveAttribute("aria-haspopup", "dialog");
    await expect(assign).toHaveAttribute("aria-expanded", "false");
    await expectEmptyPlace(assign);
    await screenshotElement(hero(page), "incident-commander-not-assigned");

    await assign.click();

    /*
     * The project's people, right under Assign, the cursor in its search
     * box - the role is given here, not in the roles card further down.
     */
    const list: Locator = assignList(page);
    await expect(list).toBeVisible();
    await expect(assign).toHaveAttribute("aria-expanded", "true");
    await expect(
      list.getByRole("combobox", { name: "Search people..." }),
    ).toBeFocused();
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual(["Alex Kim", "Jordan Patel", "Maya Chen", "Sam Rivera"]);
    const control: { x: number; y: number; width: number; height: number } =
      (await assign.boundingBox())!;
    const popup: { x: number; y: number; width: number; height: number } =
      (await list.boundingBox())!;
    expect(popup.y, "under Assign").toBeGreaterThanOrEqual(
      control.y + control.height - 0.5,
    );
    expect(popup.y - (control.y + control.height)).toBeLessThanOrEqual(12);
    await expectListWhole(page, list);
    await expect(
      card(page, "Incident Roles").getByRole("combobox", {
        name: "Incident Commander",
      }),
    ).toHaveCount(0);
    await page.mouse.move(0, 0);
    await screenshotBetween(
      page,
      hero(page),
      list,
      "incident-commander-assign-list",
    );

    // One pick gives the role: the header names them at once, the list closes.
    const rolesReadsBefore: number = await feedReads(page, "IncidentMember");
    const feedReadsBefore: number = await feedReads(page, "IncidentFeed");
    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    await expect(commander.getByTestId("event-person-name")).toHaveText([
      "Jordan Patel",
    ]);
    await expect(list).toHaveCount(0);
    // The keyboard stays where it was: on the commander.
    await expect(commander).toBeFocused();

    const given: Array<RecordedWrite> = await rowsWritten(
      page,
      "IncidentMember",
    );
    expect(given).toHaveLength(1);
    const row: string = JSON.stringify(given[0]?.data);
    expect(row).toContain(INCIDENT_ID);
    expect(row).toContain(PROJECT_ID);
    expect(row).toContain(JORDAN_USER_ID);
    expect(row).toContain(COMMANDER_ROLE_ID);

    // The roles card and the feed read again, and name them too.
    await expect
      .poll(async (): Promise<number> => {
        return feedReads(page, "IncidentMember");
      })
      .toBeGreaterThan(rolesReadsBefore);
    await expect
      .poll(async (): Promise<number> => {
        return feedReads(page, "IncidentFeed");
      })
      .toBeGreaterThan(feedReadsBefore);
    await expect(
      card(page, "Incident Roles").getByText("Jordan Patel").first(),
    ).toBeVisible();
    // Nobody left the page.
    expect(new URL(page.url()).pathname).toBe(INCIDENT_PATH);
    await page.mouse.move(0, 0);
    await screenshotElement(hero(page), "incident-commander-assigned");
    await expectNoErrorStates(page);
  });

  test("?commander=none&state=ongoing: Assign works from the keyboard - Escape closes the list, a search and Enter give the role", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "commander=none&state=ongoing");

    const assign: Locator = commanderFact(page).getByRole("button", {
      name: "Assign Incident Commander",
    });
    await assign.focus();
    await page.keyboard.press("Enter");

    const list: Locator = assignList(page);
    const search: Locator = list.getByRole("combobox", {
      name: "Search people...",
    });
    await expect(search).toBeFocused();

    // Escape closes it, and the keyboard is back on Assign.
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(assign).toBeFocused();
    expect(await rowsWritten(page, "IncidentMember")).toEqual([]);

    // Opened again, a search narrows it and Enter gives the role.
    await page.keyboard.press("Enter");
    await expect(search).toBeFocused();
    await page.keyboard.type("Maya");
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual(["Maya Chen"]);
    await page.keyboard.press("Enter");

    await expect(
      commanderFact(page).getByTestId("event-person-name"),
    ).toHaveText(["Maya Chen"]);
    await expect(list).toHaveCount(0);
    await expect(commanderFact(page)).toBeFocused();
    const given: Array<RecordedWrite> = await rowsWritten(
      page,
      "IncidentMember",
    );
    expect(given).toHaveLength(1);
    expect(JSON.stringify(given[0]?.data)).toContain(MAYA_ID);
  });

  test("?commander=none&state=ongoing&fail=role-assign: a refused Assign says why in the list, and nobody is named", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "commander=none&state=ongoing&fail=role-assign",
    );

    const commander: Locator = commanderFact(page);
    await commander
      .getByRole("button", { name: "Assign Incident Commander" })
      .click();
    const list: Locator = assignList(page);
    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    // The server's reason, in the list, which stays open for another pick.
    await expect(list.getByRole("alert")).toHaveText(
      "This user already has this role.",
    );
    await expect(list).toBeVisible();
    await expect(commander.getByTestId("event-person-name")).toHaveCount(0);
    await expect(
      commander.getByRole("button", { name: "Assign Incident Commander" }),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await screenshotBetween(
      page,
      hero(page),
      list,
      "incident-commander-assign-refused",
    );
  });

  test("Assign and Add are offered only to a reader who may give the role or add an owner", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Allowed to add people as an incident's owners and nothing else
     * (?role=owner-people): Add, but no Assign.
     */
    // Its cards that read what this role may not read wait on nothing.
    await openReady(
      page,
      INCIDENT_PAGE,
      "commander=none&owners=none&state=ongoing&role=owner-people",
      [],
    );
    await expect(commanderFact(page)).toHaveText("Not assigned");
    await expect(commanderFact(page).getByRole("button")).toHaveCount(0);
    await expect(
      ownersFact(page).getByRole("button", { name: "Add owners" }),
    ).toBeVisible();

    /*
     * Before the permissions have arrived (?role=loading), neither: nothing
     * is offered that the server may refuse.
     */
    await openReady(
      page,
      INCIDENT_PAGE,
      "commander=none&owners=none&state=ongoing&role=loading",
      [],
    );
    await expect(commanderFact(page)).toHaveText("Not assigned");
    await expect(ownersFact(page)).toHaveText("None");
    await expect(
      hero(page).getByRole("button", { name: "Add owners" }),
    ).toHaveCount(0);
    await expect(
      hero(page).getByRole("button", { name: "Assign Incident Commander" }),
    ).toHaveCount(0);
  });

  test("a name sits where any fact's words do - under its label, level with the words beside it - and an avatar makes no fact taller", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const query of [
      "state=ongoing",
      // Assign and Add, in the empty places.
      "state=ongoing&commander=none&owners=none",
    ]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openReady(page, INCIDENT_PAGE, query);
      await loadProductionFont(page);

      // How long: a fact of words, first in the same row.
      const words: { label: number; value: number; height: number } =
        await factTextTops(hero(page).getByTestId("event-header-duration"));

      for (const fact of [commanderFact(page), ownersFact(page)]) {
        const tops: { label: number; value: number; height: number } =
          await factTextTops(fact);
        expect(
          Math.abs(tops.label - words.label),
          `${query}: the labels share a line`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(tops.value - words.value),
          `${query}: the name is level with the words beside it`,
        ).toBeLessThanOrEqual(0.5);
      }

      /*
       * One person, or an empty place, is one 20px line: the 24px avatar
       * does not grow it. (The value's own box: the fact's dd also holds
       * the space under it, before the next row of facts.)
       */
      const commanderHeight: number = await commanderFact(page).evaluate(
        (value: Element): number => {
          return value.getBoundingClientRect().height;
        },
      );
      expect(
        commanderHeight,
        `${query}: the commander's line`,
      ).toBeLessThanOrEqual(20.5);
    }
  });

  test("?commander=none: a resolved incident says only that nobody held the role", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "commander=none");

    await expect(commanderFact(page)).toHaveText("Not assigned");
    await expect(commanderFact(page).getByRole("button")).toHaveCount(0);
  });

  test("?owners=none&state=ongoing: the empty place and Add, which opens the Add owners list right under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "owners=none&state=ongoing");

    const owners: Locator = ownersFact(page);
    // Said once: the place and its action, not "None" beside them.
    await expect(owners.getByText("None", { exact: true })).toHaveCount(0);

    // Visibly "Add" after "Owners"; heard as what it adds, and that it opens a list.
    const add: Locator = owners.getByRole("button", { name: "Add owners" });
    await expect(add).toHaveAttribute("data-testid", "event-owners-add");
    await expect(add).toHaveAttribute("aria-haspopup", "dialog");
    await expect(
      add.locator(":scope > [aria-hidden='true']").last(),
    ).toHaveText("Add");
    await expectEmptyPlace(add);
    await expect(owners.getByRole("link")).toHaveCount(0);
    await screenshotElement(hero(page), "incident-owners-none");

    await add.click();

    /*
     * The Owners page's own list, right under Add, the cursor in its search
     * box: the project's people, then its teams, each by name.
     */
    const list: Locator = addOwnersList(page);
    await expect(list).toBeVisible();
    await expect(
      list.getByRole("combobox", { name: "Search people or teams..." }),
    ).toBeFocused();
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual([
        "Alex Kim",
        "Jordan Patel",
        "Maya Chen",
        "Sam Rivera",
        "Checkout SRE",
        "Database Reliability",
        "Payments",
        "Platform",
      ]);
    const control: { x: number; y: number; width: number; height: number } =
      (await add.boundingBox())!;
    const popup: { x: number; y: number; width: number; height: number } =
      (await list.boundingBox())!;
    expect(popup.y, "under Add").toBeGreaterThanOrEqual(
      control.y + control.height - 0.5,
    );
    expect(popup.y - (control.y + control.height)).toBeLessThanOrEqual(12);
    expect(new URL(page.url()).pathname).toBe(INCIDENT_PATH);
    await expect(page.getByTestId("stub-page")).toHaveCount(0);
    await page.mouse.move(0, 0);
    await screenshotBetween(page, hero(page), list, "incident-owners-add-list");
  });

  test("?owners=none&state=ongoing: one click adds an owner, the header names them at once, and the list stays open for the next", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "owners=none&state=ongoing");

    const owners: Locator = ownersFact(page);
    const feedReadsBefore: number = await feedReads(page, "IncidentFeed");
    await owners.getByRole("button", { name: "Add owners" }).click();
    const list: Locator = addOwnersList(page);

    // A team: named where Add was, the list still open, saying what it did.
    await list.getByRole("option", { name: /Payments/ }).click();
    await expect(owners.getByTestId("event-person-name")).toHaveText([
      "Payments",
    ]);
    await expect(list.getByTestId("people-search-notice-done")).toHaveText(
      "Added Payments.",
    );
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .not.toContain("Payments");
    // The list followed Add down to the line after the new owner, and is lit with it.
    const more: Locator = owners.getByRole("button", { name: "Add owners" });
    await expect(more).toHaveAttribute("data-testid", "event-owners-add-more");
    await expect(more).toHaveAttribute("aria-expanded", "true");

    // Then a person: teams first, each by name.
    await list.getByRole("option", { name: /Jordan Patel/ }).click();
    await expect(owners.getByTestId("event-person-name")).toHaveText([
      "Payments",
      "Jordan Patel",
    ]);
    await expect(list.getByTestId("people-search-notice-done")).toHaveText(
      "Added Jordan Patel.",
    );
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual([
        "Alex Kim",
        "Maya Chen",
        "Sam Rivera",
        "Checkout SRE",
        "Database Reliability",
        "Platform",
      ]);
    await page.mouse.move(0, 0);
    await screenshotBetween(page, hero(page), list, "incident-owners-added");

    // One row each, as the Owners page writes them; the server tells them.
    const teams: Array<RecordedWrite> = await rowsWritten(
      page,
      "IncidentOwnerTeam",
    );
    const users: Array<RecordedWrite> = await rowsWritten(
      page,
      "IncidentOwnerUser",
    );
    expect(teams).toHaveLength(1);
    expect(users).toHaveLength(1);
    expectOwnerRow(teams[0], {
      recordField: "incidentId",
      recordId: INCIDENT_ID,
      ownerField: "teamId",
      ownerId: PAYMENTS_TEAM_ID,
    });
    expectOwnerRow(users[0], {
      recordField: "incidentId",
      recordId: INCIDENT_ID,
      ownerField: "userId",
      ownerId: JORDAN_USER_ID,
    });
    // The feed reads again: it says who added them.
    await expect
      .poll(async (): Promise<number> => {
        return feedReads(page, "IncidentFeed");
      })
      .toBeGreaterThan(feedReadsBefore);

    // Escape closes the list, and the keyboard is on Add, after the owners.
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    expect(new URL(page.url()).pathname).toBe(INCIDENT_PATH);
    await expectNoErrorStates(page);
  });

  test("?state=ongoing&fail=owner-add: a refused owner is said in the list, and the header reads the owners again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "state=ongoing&fail=owner-add");

    const owners: Locator = ownersFact(page);
    const readsBefore: number = await feedReads(page, "IncidentOwnerUser");
    await owners.getByRole("button", { name: "Add owners" }).click();
    const list: Locator = addOwnersList(page);
    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    await expect(list.getByRole("alert")).toHaveText(
      "This user is already an owner of this incident.",
    );
    await expect(list.getByTestId("people-search-notice-done")).toHaveCount(0);
    // Still on offer, and the header shows the owners as they are.
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toContain("Jordan Patel");
    await expect(owners.getByTestId("event-person-name")).toHaveText([
      "Checkout SRE",
      "Sam Rivera",
    ]);
    await expect
      .poll(async (): Promise<number> => {
        return feedReads(page, "IncidentOwnerUser");
      })
      .toBeGreaterThan(readsBefore);
    await page.mouse.move(0, 0);
    await screenshotBetween(
      page,
      hero(page),
      list,
      "incident-owners-add-refused",
    );
  });

  test("?role=owner-people: the list offers the people a reader may add, and names Teams locked, with why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_PAGE,
      "owners=none&state=ongoing&role=owner-people",
      [],
    );

    await ownersFact(page).getByRole("button", { name: "Add owners" }).click();
    const list: Locator = addOwnersList(page);
    await expect
      .poll(async (): Promise<Array<string>> => {
        return listedNames(list);
      })
      .toEqual(["Alex Kim", "Jordan Patel", "Maya Chen", "Sam Rivera"]);

    // No team on offer: Teams is named under the people, locked, with why.
    await expect(
      list.locator("[data-testid='people-search-option'][data-kind='team']"),
    ).toHaveCount(0);
    const locked: Locator = list.getByTestId("people-search-locked-kind");
    await expect(locked).toHaveCount(1);
    await expect(locked).toHaveAttribute("data-kind", "team");
    await expect(list.getByRole("group", { name: "Teams" })).toHaveAttribute(
      "data-testid",
      "people-search-locked-kind",
    );
    await expect(
      locked.getByTestId("people-search-locked-reason"),
    ).toContainText("You do not have permission to add teams as owners.");
    await page.mouse.move(0, 0);
    await screenshotBetween(
      page,
      hero(page),
      list,
      "incident-owners-add-teams-locked",
    );

    // A person is added all the same.
    await list.getByRole("option", { name: /Alex Kim/ }).click();
    await expect(ownersFact(page).getByTestId("event-person-name")).toHaveText([
      "Alex Kim",
    ]);
    expectOwnerRow((await rowsWritten(page, "IncidentOwnerUser"))[0], {
      recordField: "incidentId",
      recordId: INCIDENT_ID,
      ownerField: "userId",
      ownerId: ALEX_ID,
    });
  });

  /*
   * The list opened from the header is whole wherever the header is: at a
   * desk, on a phone - where it opens low on the screen and the page makes
   * room for it - and in the dark theme.
   */
  for (const [width, theme] of [
    [1280, "light"],
    [1280, "dark"],
    [390, "light"],
    [390, "dark"],
  ] as Array<[number, string]>) {
    test(`the Add owners and Assign lists open whole under their control (${width}px, ${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReady(
        page,
        INCIDENT_PAGE,
        `owners=none&commander=none&state=ongoing${
          theme === "dark" ? "&theme=dark" : ""
        }`,
      );
      await loadProductionFont(page);

      for (const [control, list, name] of [
        [
          ownersFact(page).getByRole("button", { name: "Add owners" }),
          addOwnersList(page),
          "owners-add",
        ],
        [
          commanderFact(page).getByRole("button", {
            name: "Assign Incident Commander",
          }),
          assignList(page),
          "commander-assign",
        ],
      ] as Array<[Locator, Locator, string]>) {
        await control.click();
        await expect(list).toBeVisible();
        await expect
          .poll(async (): Promise<number> => {
            return (await listedNames(list)).length;
          })
          .toBeGreaterThan(0);
        await expectListWhole(page, list);
        const controlBox: {
          x: number;
          y: number;
          width: number;
          height: number;
        } = (await control.boundingBox())!;
        const listBox: { x: number; y: number; width: number; height: number } =
          (await list.boundingBox())!;
        expect(listBox.y, `${name}: under its control`).toBeGreaterThanOrEqual(
          controlBox.y + controlBox.height - 0.5,
        );
        // Lit while its list is open.
        await expect(control).toHaveAttribute("aria-expanded", "true");
        const surface: string = await list.evaluate(
          (element: Element): string => {
            return getComputedStyle(element).backgroundColor;
          },
        );
        if (theme === "dark") {
          expect(surface, `${name}: a dark surface`).not.toBe(
            "rgb(255, 255, 255)",
          );
        } else {
          expect(surface).toBe("rgb(255, 255, 255)");
        }
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: path.join(
            SCREENSHOTS,
            `incident-header-${name}-list-${width}-${theme}-synthetic.png`,
          ),
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(list).toHaveCount(0);
      }
    });
  }

  /*
   * Each list's search box holds its whole placeholder in the languages
   * with the longest words (UI review): the Assign list's first words,
   * "Search people by name or email", ran past the box in eight languages,
   * German, French and Spanish among them, and the Add owners list's French
   * one too. Measured as drawn, in the box's own font, against its room.
   */
  test("each list's search box holds its whole placeholder in German, French and Spanish", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const language of ["de", "fr", "es"]) {
      await open(
        page,
        INCIDENT_PATH,
        `owners=none&commander=none&state=ongoing&lang=${language}`,
      );
      const add: Locator = ownersFact(page).getByTestId("event-owners-add");
      await expect(add).toBeVisible({ timeout: 30000 });
      await loadProductionFont(page);

      for (const control of [
        add,
        commanderFact(page).getByTestId("event-commander-assign"),
      ]) {
        await control.click();
        const search: Locator = page
          .getByTestId("people-search-popup")
          .getByTestId("people-search-input");
        await expect(search).toBeFocused();

        const fit: { text: string; width: number; room: number } =
          await search.evaluate(
            (
              input: HTMLInputElement,
            ): { text: string; width: number; room: number } => {
              const style: CSSStyleDeclaration = getComputedStyle(input);
              const context: CanvasRenderingContext2D = document
                .createElement("canvas")
                .getContext("2d")!;
              context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
              return {
                text: input.placeholder,
                width: context.measureText(input.placeholder).width,
                room:
                  input.clientWidth -
                  parseFloat(style.paddingLeft) -
                  parseFloat(style.paddingRight),
              };
            },
          );

        // Translated, not the English words.
        expect(fit.text).not.toMatch(/^Search people/);
        expect(fit.width, `${language}: "${fit.text}"`).toBeLessThanOrEqual(
          fit.room,
        );
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("people-search-popup")).toHaveCount(0);
      }
    }
  });

  test("?owners=none: a resolved incident says only None", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "owners=none");

    await expect(ownersFact(page)).toHaveText("None");
    await expect(ownersFact(page).getByRole("link")).toHaveCount(0);
  });

  test("?owners=many: three in the header, teams first by name, and +3 more opens the Owners page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "owners=many");

    const owners: Locator = ownersFact(page);
    // Added people first; the header puts teams first, each by name.
    await expect(owners.getByTestId("event-person-name")).toHaveText([
      "Checkout SRE",
      "Database Reliability",
      "Platform",
    ]);
    expect(await personKinds(owners)).toEqual(["team", "team", "team"]);

    const more: Locator = owners.getByRole("link", { name: "+3 more" });
    await expect(more).toHaveAttribute("href", INCIDENT_OWNERS_PATH);
    await screenshotElement(hero(page), "incident-owners-many");

    await more.click();
    await expect(page.getByTestId("stub-page")).toHaveAttribute(
      "data-page",
      "INCIDENT_VIEW_OWNERS",
    );
  });

  test("an alert names its owners and no commander: alerts have no roles", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);

    await expect(ownersFact(page).getByTestId("event-person-name")).toHaveText([
      "Payments",
    ]);
    expect(await personKinds(ownersFact(page))).toEqual(["team"]);
    await expect(commanderFact(page)).toHaveCount(0);

    const reads: Array<RecordedModelRequest> = (await fixture(page))
      .listRequests;
    for (const modelName of ["AlertOwnerTeam", "AlertOwnerUser"]) {
      const ownerReads: Array<RecordedModelRequest> = reads.filter(
        (read: RecordedModelRequest): boolean => {
          return read.modelName === modelName;
        },
      );
      expect(ownerReads, modelName).toHaveLength(1);
      expect(JSON.stringify(ownerReads[0]?.query)).toContain(ALERT_ID);
    }
  });

  for (const [eventPage, ownerModels, recordId] of [
    [
      INCIDENT_EPISODE_PAGE,
      ["IncidentEpisodeOwnerTeam", "IncidentEpisodeOwnerUser"],
      INCIDENT_EPISODE_ID,
    ],
    [
      ALERT_EPISODE_PAGE,
      ["AlertEpisodeOwnerTeam", "AlertEpisodeOwnerUser"],
      ALERT_EPISODE_ID,
    ],
  ] as Array<[EventPage, Array<string>, string]>) {
    test(`${eventPage.name} names its owners, read for the episode itself`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);

      const reads: Array<RecordedModelRequest> = (await fixture(page))
        .listRequests;
      for (const modelName of ownerModels) {
        const ownerReads: Array<RecordedModelRequest> = reads.filter(
          (read: RecordedModelRequest): boolean => {
            return read.modelName === modelName;
          },
        );
        expect(ownerReads, modelName).toHaveLength(1);
        expect(JSON.stringify(ownerReads[0]?.query)).toContain(recordId);
      }

      if (eventPage === INCIDENT_EPISODE_PAGE) {
        // An incident episode has roles too: its commander leads.
        await expect(
          commanderFact(page).getByTestId("event-person-name"),
        ).toHaveText(["Maya Chen"]);
      } else {
        await expect(commanderFact(page)).toHaveCount(0);
      }
    });
  }

  test("an incident episode nobody commands: Assign gives the episode's commander right there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(
      page,
      INCIDENT_EPISODE_PAGE,
      "commander=none&state=ongoing",
    );

    const assign: Locator = commanderFact(page).getByRole("button", {
      name: "Assign Incident Commander",
    });
    await expectEmptyPlace(assign);
    await assign.click();

    const list: Locator = assignList(page);
    await expect(
      list.getByRole("combobox", { name: "Search people..." }),
    ).toBeFocused();
    await list.getByRole("option", { name: /Jordan Patel/ }).click();

    await expect(
      commanderFact(page).getByTestId("event-person-name"),
    ).toHaveText(["Jordan Patel"]);
    await expect(list).toHaveCount(0);

    // The episode's own role row, not the incident's.
    expect(await rowsWritten(page, "IncidentMember")).toEqual([]);
    const given: Array<RecordedWrite> = await rowsWritten(
      page,
      "IncidentEpisodeRoleMember",
    );
    expect(given).toHaveLength(1);
    const row: string = JSON.stringify(given[0]?.data);
    expect(row).toContain(INCIDENT_EPISODE_ID);
    expect(row).toContain(JORDAN_USER_ID);
    expect(row).toContain(COMMANDER_ROLE_ID);
    // The episode's roles card names them too.
    await expect(
      card(page, "Episode Roles").getByText("Jordan Patel").first(),
    ).toBeVisible();
    await expectNoErrorStates(page);
  });

  /*
   * Every overview that names its owners adds one right there: an alert,
   * both episodes and a scheduled maintenance event, each to its own owner
   * table, its feed read again.
   */
  for (const [
    eventPage,
    query,
    ownerModel,
    recordField,
    recordId,
    feedModel,
    named,
  ] of [
    [
      ALERT_PAGE,
      "state=ongoing",
      "AlertOwnerTeam",
      "alertId",
      ALERT_ID,
      "AlertFeed",
      ["Payments", "Platform"],
    ],
    [
      INCIDENT_EPISODE_PAGE,
      "state=ongoing",
      "IncidentEpisodeOwnerTeam",
      "incidentEpisodeId",
      INCIDENT_EPISODE_ID,
      "IncidentEpisodeFeed",
      ["Checkout SRE", "Platform", "Sam Rivera"],
    ],
    [
      ALERT_EPISODE_PAGE,
      "state=ongoing",
      "AlertEpisodeOwnerTeam",
      "alertEpisodeId",
      ALERT_EPISODE_ID,
      "AlertEpisodeFeed",
      ["Payments", "Platform"],
    ],
    [
      SCHEDULED_MAINTENANCE_PAGE,
      "",
      "ScheduledMaintenanceOwnerTeam",
      "scheduledMaintenanceId",
      SCHEDULED_MAINTENANCE_ID,
      "ScheduledMaintenanceFeed",
      ["Database Reliability", "Platform", "Jordan Patel"],
    ],
  ] as Array<
    [EventPage, string, string, string, string, string, Array<string>]
  >) {
    test(`${eventPage.name}: Add adds an owner right there, and the header names them at once`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage, query);

      const owners: Locator = ownersFact(page);
      const feedReadsBefore: number = await feedReads(page, feedModel);
      await owners.getByRole("button", { name: "Add owners" }).click();
      const list: Locator = addOwnersList(page);
      await expect(list).toBeVisible();
      await list.getByRole("option", { name: /Platform/ }).click();

      await expect(list.getByTestId("people-search-notice-done")).toHaveText(
        "Added Platform.",
      );
      await expect(owners.getByTestId("event-person-name")).toHaveText(named);
      const written: Array<RecordedWrite> = await rowsWritten(page, ownerModel);
      expect(written).toHaveLength(1);
      expectOwnerRow(written[0], {
        recordField,
        recordId,
        ownerField: "teamId",
        ownerId: PLATFORM_TEAM_ID,
      });
      await expect
        .poll(async (): Promise<number> => {
          return feedReads(page, feedModel);
        })
        .toBeGreaterThan(feedReadsBefore);
      expect(new URL(page.url()).pathname).toBe(eventPage.path);
      await page.mouse.move(0, 0);
      await screenshotBetween(
        page,
        hero(page),
        list,
        `${eventPage.name}-owners-added`,
      );
      await expectNoErrorStates(page);
    });
  }
});

test.describe("at a glance: what happened", () => {
  test("What happened opens the incident's left column: its description, then its root cause, above the AI investigation", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const whatHappened: Locator = whatHappenedCard(page);
    await expect(
      whatHappened.getByTestId("what-happened-description"),
    ).toHaveText(INCIDENT_PAGE.whatHappened!.description);
    const rootCause: Locator = whatHappened.getByRole("region", {
      name: "Root cause",
    });
    await expect(
      rootCause.getByTestId("what-happened-root-cause-value"),
    ).toHaveText(INCIDENT_PAGE.whatHappened!.rootCause!);
    // Short texts: nothing to open.
    await expect(
      whatHappened.getByRole("button", { name: "Show more" }),
    ).toHaveCount(0);

    // Under the stat bar, leading the column the AI investigation follows.
    await expectAbove(
      page.getByRole("group", { name: INCIDENT_PAGE.statBar }),
      whatHappened,
      "stat bar before What happened",
    );
    await expectAbove(
      whatHappened,
      investigationCard(page),
      "What happened before the AI investigation",
    );
    const left: Box = await documentBox(whatHappened);
    const investigation: Box = await documentBox(investigationCard(page));
    expect(Math.abs(left.x - investigation.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(left.width - investigation.width)).toBeLessThanOrEqual(1);

    // The page's one read of the incident carried both.
    const read: RecordedModelRequest | undefined = (
      await fixture(page)
    ).getItemRequests.find((request: RecordedModelRequest): boolean => {
      return (
        request.modelName === "Incident" &&
        request.id === INCIDENT_ID &&
        Boolean(request.select && "rootCause" in request.select)
      );
    });
    expect(read?.select).toEqual(
      expect.objectContaining({ description: true, rootCause: true }),
    );
    await screenshotElement(whatHappened, "incident-what-happened");
  });

  test("?what=empty: says there is nothing yet, and keeps Edit to write it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "what=empty");

    const whatHappened: Locator = whatHappenedCard(page);
    await expect(
      whatHappened.getByTestId("what-happened-description-empty"),
    ).toHaveText("No description yet.");
    await expect(
      whatHappened.getByTestId("what-happened-root-cause-empty"),
    ).toHaveText("Not identified yet.");
    await expect(
      whatHappened
        .getByTestId("card-header-actions")
        .getByRole("button", { name: "Edit" }),
    ).toBeEnabled();
    await screenshotElement(whatHappened, "incident-what-happened-empty");
  });

  test("?what=long: each text shows its first lines and opens with Show more", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "what=long");

    const whatHappened: Locator = whatHappenedCard(page);
    const description: Locator = whatHappened.getByTestId(
      "what-happened-description",
    );
    const frame: Locator = description.getByTestId(
      "what-happened-description-text",
    );
    const more: Locator = description.getByRole("button", {
      name: "Show more",
    });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    const collapsed: Box = await documentBox(frame);
    // About six lines (max-h-36), the rest faded under the last one...
    expect(collapsed.height).toBeLessThanOrEqual(145);
    // ...and still in the page for a screen reader.
    await expect(frame).toContainText("Support received 41 tickets");
    await screenshotElement(whatHappened, "incident-what-happened-long");

    await more.click();
    const less: Locator = description.getByRole("button", {
      name: "Show less",
    });
    await expect(less).toHaveAttribute("aria-expanded", "true");
    expect((await documentBox(frame)).height).toBeGreaterThan(
      collapsed.height + 40,
    );
    await screenshotElement(whatHappened, "incident-what-happened-long-open");

    await less.click();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    expect((await documentBox(frame)).height).toBeLessThanOrEqual(145);

    // The root cause folds on its own.
    await expect(
      whatHappened
        .getByTestId("what-happened-root-cause-value")
        .getByRole("button", { name: "Show more" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expectNoHorizontalOverflow(page);
  });

  test("Edit writes the description and the root cause in one dialog, and the card shows what was saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "what=empty");

    const whatHappened: Locator = whatHappenedCard(page);
    await whatHappened
      .getByTestId("card-header-actions")
      .getByRole("button", { name: "Edit" })
      .click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Edit what happened",
    });
    await expect(dialog).toBeVisible();
    // Where the description is read: wherever the incident is public.
    await expect(dialog).toContainText(
      "Shown on the status pages this incident appears on.",
    );
    await expect(dialog).toContainText("Why it happened, once you know.");

    const editors: Locator = dialog.locator('[contenteditable="true"]');
    await expect(editors).toHaveCount(2);
    await editors.nth(0).click();
    await page.keyboard.type("Checkout timed out for shoppers in the EU");
    await editors.nth(1).click();
    await page.keyboard.type("The connection pool was cut to ten");

    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Save Changes" })
      .click();
    await expect(dialog).toHaveCount(0);

    const saves: Array<RecordedWrite> = (await fixture(page)).creates.filter(
      (write: RecordedWrite): boolean => {
        return write.modelName === "Incident";
      },
    );
    expect(saves).toHaveLength(1);
    expect(JSON.stringify(saves[0]?.data)).toContain(
      "Checkout timed out for shoppers in the EU",
    );
    expect(JSON.stringify(saves[0]?.data)).toContain(
      "The connection pool was cut to ten",
    );

    // The page read the incident again: the card says what was saved.
    await expect(
      whatHappened.getByTestId("what-happened-description"),
    ).toHaveText("Checkout timed out for shoppers in the EU");
    await expect(
      whatHappened.getByTestId("what-happened-root-cause-value"),
    ).toHaveText("The connection pool was cut to ten");
    await expectNoErrorStates(page);
  });

  for (const eventPage of [
    ALERT_PAGE,
    INCIDENT_EPISODE_PAGE,
    ALERT_EPISODE_PAGE,
  ]) {
    test(`${eventPage.name} leads with What happened too`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, eventPage);

      const whatHappened: Locator = whatHappenedCard(page);
      await expect(
        whatHappened.getByTestId("what-happened-description"),
      ).toHaveText(eventPage.whatHappened!.description);
      await expect(
        whatHappened.getByTestId("what-happened-root-cause-empty"),
      ).toHaveText("Not identified yet.");
      await expectAbove(
        page.getByRole("group", { name: eventPage.statBar }),
        whatHappened,
        "stat bar before What happened",
      );

      /*
       * Its edit dialog says the description is public where it is: an
       * incident episode's shows on the status pages it appears on; an
       * alert's and an alert episode's nowhere outside OneUptime.
       */
      await whatHappened
        .getByTestId("card-header-actions")
        .getByRole("button", { name: "Edit" })
        .click();
      const dialog: Locator = page.getByRole("dialog", {
        name: "Edit what happened",
      });
      await expect(dialog).toContainText("Why it happened, once you know.");
      if (eventPage === INCIDENT_EPISODE_PAGE) {
        await expect(dialog).toContainText(
          "Shown on the status pages this episode appears on.",
        );
      } else {
        await expect(dialog).not.toContainText("status pages");
      }
      await dialog
        .getByTestId("modal-footer")
        .getByRole("button", { name: "Cancel" })
        .click();
      await expect(dialog).toHaveCount(0);
      // Nothing else in the left column comes first.
      const left: Box = await documentBox(whatHappened);
      const feed: Box = await documentBox(card(page, eventPage.feed));
      expect(Math.abs(left.x - feed.x)).toBeLessThanOrEqual(1);
      expect(left.y).toBeLessThan(feed.y);
    });
  }
});

test.describe("at a glance: when, and what it touched", () => {
  test("the stat bar opens with when it was declared, how long after the impact began, and by whom - and nothing else says it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const statBar: Locator = page.getByRole("group", {
      name: INCIDENT_PAGE.statBar,
    });
    expect((await statCells(page, INCIDENT_PAGE.statBar))[0]).toEqual(
      INCIDENT_PAGE.stats[0],
    );
    /*
     * The date and the time each hold together; the zone follows, smaller,
     * after a space a narrow tile may break at.
     */
    expect(
      await statBar
        .getByTestId("event-start-tile-value")
        .evaluate((value: Element): string => {
          return value.textContent || "";
        }),
    ).toBe(`Sep${NO_BREAK_SPACE}14, 06:01${NO_BREAK_SPACE}PM GMT`);
    const zone: Locator = statBar.getByTestId("event-start-tile-zone");
    await expect(zone).toHaveText("GMT");
    const valueSize: number = await statBar
      .getByTestId("event-start-tile-value")
      .evaluate((value: Element): number => {
        return parseFloat(getComputedStyle(value).fontSize);
      });
    const zoneSize: number = await zone.evaluate((element: Element): number => {
      return parseFloat(getComputedStyle(element).fontSize);
    });
    expect(zoneSize).toBeLessThan(valueSize);
    // How long it lasted is the header's alone.
    await expect(statBar.getByText("Duration", { exact: true })).toHaveCount(0);
    await expectHeroDuration(hero(page), "Lasted 11 minutes");
    // And when and by whom it was declared is the tile's alone.
    const detailsLabels: Array<string> = await detailLabels(
      card(page, INCIDENT_PAGE.detailsCard),
    );
    expect(detailsLabels).not.toContain("Declared At");
    expect(detailsLabels).not.toContain("Declared By");
    expect(
      (await heroFacts(hero(page))).map((fact: LabelledValue): string => {
        return fact.label;
      }),
    ).not.toContain("Declared");
  });

  for (const width of [1024, 640, 390]) {
    test(`the Declared tile keeps its date and its time whole at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReady(page, INCIDENT_PAGE);

      const lines: Array<string> = await tileValueLines(
        page,
        INCIDENT_PAGE.statBar,
        0,
      );
      /*
       * However many lines it takes, each is whole parts: the date, the
       * time, the zone - never "GM" over "T".
       */
      expect(lines.join(" ")).toBe("Sep 14, 06:01 PM GMT");
      for (const line of lines) {
        expect([
          "Sep 14, 06:01 PM GMT",
          "Sep 14, 06:01 PM",
          "06:01 PM GMT",
          "Sep 14,",
          "06:01 PM",
          "GMT",
        ]).toContain(line);
      }
      // Where the tile is wide enough, one line.
      if (width === 390) {
        expect(lines).toEqual(["Sep 14, 06:01 PM GMT"]);
      }
      await expectNoHorizontalOverflow(page);
    });
  }

  test("an episode's Declared tile, four to a row at 1280px, breaks after the date rather than leaving the zone on its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReady(page, INCIDENT_EPISODE_PAGE);

    const lines: Array<string> = await tileValueLines(
      page,
      INCIDENT_EPISODE_PAGE.statBar,
      0,
    );
    expect(lines.join(" ")).toBe("Sep 14, 05:56 PM GMT");
    // Balanced lines: the date over the time and its zone, never a lone zone.
    expect(lines).not.toContain("GMT");
    await expectNoHorizontalOverflow(page);
  });

  test("Affected Resources leads the right column, with the monitor status the incident sets", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const resources: Locator = card(page, "Affected Resources");
    expect(await detailLabels(resources)).toContain("Change Monitor Status to");
    await expect(resources).toContainText("Degraded");
    await expectAbove(
      resources,
      card(page, INCIDENT_PAGE.detailsCard),
      "resources before the details",
    );
    await screenshotElement(resources, "incident-affected-resources");
  });
});

test.describe("at a glance: layout", () => {
  const CASES: Array<{ eventPage: EventPage; width: number; theme: string }> = [
    { eventPage: INCIDENT_PAGE, width: 1280, theme: "light" },
    { eventPage: INCIDENT_PAGE, width: 1280, theme: "dark" },
    { eventPage: INCIDENT_PAGE, width: 1024, theme: "light" },
    { eventPage: INCIDENT_PAGE, width: 1024, theme: "dark" },
    { eventPage: INCIDENT_PAGE, width: 390, theme: "light" },
    { eventPage: INCIDENT_PAGE, width: 390, theme: "dark" },
    { eventPage: ALERT_PAGE, width: 1280, theme: "light" },
    { eventPage: ALERT_PAGE, width: 390, theme: "dark" },
    { eventPage: INCIDENT_EPISODE_PAGE, width: 1280, theme: "light" },
    { eventPage: ALERT_EPISODE_PAGE, width: 390, theme: "light" },
  ];

  for (const { eventPage, width, theme } of CASES) {
    test(`${eventPage.name} reads at a glance at ${width}px in the ${theme} theme`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReady(page, eventPage, theme === "dark" ? "theme=dark" : "");

      // Every name in the header is whole.
      const names: Locator = hero(page).getByTestId("event-person-name");
      const count: number = await names.count();
      expect(count, "people in the header").toBeGreaterThan(0);
      for (let index: number = 0; index < count; index++) {
        await expect(names.nth(index)).toBeVisible();
        expect(
          await isOverflowing(names.nth(index)),
          `${await names.nth(index).innerText()} is cut off`,
        ).toBe(false);
      }

      // Header, stat bar, then What happened, with the rest after it.
      const statBar: Locator = page.getByRole("group", {
        name: eventPage.statBar,
      });
      const whatHappened: Locator = whatHappenedCard(page);
      await expectAbove(hero(page), statBar, "header before stat bar");
      await expectAbove(statBar, whatHappened, "stat bar before What happened");
      const top: Box = await documentBox(whatHappened);
      for (const heading of [eventPage.feed, ...eventPage.rightColumn]) {
        const box: Box = await documentBox(card(page, heading));
        expect(box.y, `${heading} is not above What happened`).toBeGreaterThan(
          top.y - 1,
        );
      }

      /*
       * A team's avatar is a dark tile on the light card; on the dark card
       * it is lifted to slate-500, so it does not sink into the card.
       */
      const background: string = await teamAvatarBackground(ownersFact(page));
      if (theme === "dark") {
        expect(background).toContain("rgb(100, 116, 139)");
      } else {
        expect(background).not.toContain("rgb(100, 116, 139)");
      }

      await expectNoHorizontalOverflow(page);
      await screenshotBetween(
        page,
        hero(page),
        whatHappened,
        `${eventPage.name}-at-a-glance-${width}-${theme}`,
      );
    });
  }

  /*
   * ?lang=de: the people row's labels, the start tile and What happened in
   * the reader's language. The fixture loads the Dashboard's own German
   * strings (src/Locales/de.json).
   */
  for (const width of [1280, 390]) {
    test(`reads in German at ${width}px`, async ({ page }: { page: Page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, INCIDENT_PATH, "lang=de");

      const germanHero: Locator = hero(page);
      await expect(
        germanHero
          .getByTestId("event-commander")
          .getByTestId("event-person-name"),
      ).toHaveText(["Maya Chen"], { timeout: 30000 });
      await expect(germanHero.getByTestId("event-owners")).toBeVisible();
      await expectWhatHappenedSettled(page);

      expect((await heroFacts(germanHero)).slice(0, 2)).toEqual([
        { label: "Vorfall-Kommandant", value: "Maya Chen" },
        { label: "Eigentümer", value: "Checkout SRE, Sam Rivera" },
      ]);

      const [declared] = await statCells(page, "Reaktionszeiten bei Vorfällen");
      // German calls the declared time Gemeldet (#5287).
      expect(declared?.label).toBe("Gemeldet");
      expect(declared?.note).toBe("3 Minuten nach Beginn der Auswirkung");
      expect(declared?.description).toBe("Von eu-west-1 probe");

      const whatHappened: Locator = card(page, "Hergang");
      await expect(whatHappened).toBeVisible();
      await expect(
        whatHappened.getByRole("region", { name: "Grundursache" }),
      ).toBeVisible();
      await expect(
        whatHappened
          .getByTestId("card-header-actions")
          .getByRole("button", { name: "Bearbeiten" }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page);
      await screenshotBetween(
        page,
        germanHero,
        whatHappened,
        `incident-overview-at-a-glance-${width}-de`,
      );
    });
  }
});

/*
 * Issue #5293: an incident Ask AI declared on a host's page was linked to
 * nothing, and its Remediation card said only that it was "not linked to a
 * Kubernetes cluster or an infrastructure resource". The AI card's
 * Remediation step (block 43) now says, in plain words, what OneUptime AI
 * fixes and what to do: add what the incident is about under Affected
 * Resources, and OneUptime AI tries again. "Go to Affected Resources" takes the reader to that card - on a
 * phone far below - and marks where it landed. ?fixing=nothing-linked is
 * such a record with no monitor (an incident Ask AI declared);
 * ?fixing=nothing-linked-monitor names its monitor too.
 */
test.describe("the Remediation step of a record linked to nothing (issue #5293)", () => {
  const NOTHING_LINKED_INCIDENT: string =
    "This incident is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.";
  const WHAT_TO_DO: string =
    "Add the host, cluster or database it is about under Affected Resources, and OneUptime AI tries again.";
  const GO_TO_AFFECTED_RESOURCES: string = "Go to Affected Resources";

  function decisionLine(page: Page): Locator {
    return remediationCard(page).getByTestId("remediation-decision-line");
  }

  test("says what OneUptime AI fixes, and what to do, with no monitor to link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "fixing=nothing-linked");

    const line: Locator = decisionLine(page);
    await expect(line).toHaveCount(1, { timeout: 30000 });
    await expect(line).toHaveAttribute("data-tone", "attention");
    await expect(line.getByTestId("remediation-decision-text")).toHaveText(
      NOTHING_LINKED_INCIDENT,
    );
    await expect(
      line.getByTestId("remediation-decision-what-to-do"),
    ).toHaveText(`What to do: ${WHAT_TO_DO}`);
    // The sentence is the why: never the engine's words.
    await expect(remediationCard(page)).not.toContainText(
      "infrastructure resource",
    );
    await expect(remediationCard(page)).toContainText("Needs attention");

    // The one step, and nothing else to follow: no monitor, no link.
    await expect(
      line.getByRole("button", { name: GO_TO_AFFECTED_RESOURCES, exact: true }),
    ).toBeVisible();
    await expect(line.getByRole("link")).toHaveCount(0);
  });

  test("with a monitor, links it too, after the step that fixes this one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "fixing=nothing-linked-monitor");

    const line: Locator = decisionLine(page);
    await expect(
      line.getByTestId("remediation-decision-what-to-do"),
    ).toHaveText(
      `What to do: ${WHAT_TO_DO} Link its monitor to what it watches, and every incident it raises from then on is linked for you.`,
      { timeout: 30000 },
    );

    const go: Locator = line.getByRole("button", {
      name: GO_TO_AFFECTED_RESOURCES,
      exact: true,
    });
    const monitorLink: Locator = line.getByRole("link", {
      name: "Link Checkout API p95 latency",
    });
    await expect(monitorLink).toHaveAttribute(
      "href",
      `${DASHBOARD}/monitors/${uuid("70000000", 1)}`,
    );

    // Side by side in reading order: the button first.
    const goBox: Box = await documentBox(go);
    const linkBox: Box = await documentBox(monitorLink);
    expect(goBox.y <= linkBox.y).toBe(true);
    if (goBox.y === linkBox.y) {
      expect(goBox.x).toBeLessThan(linkBox.x);
    }
  });

  for (const width of [390, 1280]) {
    test(`Go to Affected Resources lands on the card, under the header, at ${width}px`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await open(page, INCIDENT_PATH, "fixing=nothing-linked");
      await expectWhatHappenedSettled(page);

      const affectedResources: Locator = card(page, "Affected Resources");
      await expect(affectedResources).toBeVisible({ timeout: 30000 });
      await expect(affectedResources).toHaveAttribute(
        "id",
        "affected-resources",
      );

      const go: Locator = decisionLine(page).getByRole("button", {
        name: GO_TO_AFFECTED_RESOURCES,
        exact: true,
      });
      await go.scrollIntoViewIfNeeded();
      await go.click();

      // Marked where it landed, and in view under the sticky header.
      await expect(affectedResources).toHaveAttribute(
        "data-page-anchor-landed",
        "true",
      );
      // The button's focus is handed on: Tab goes on from the card.
      await expect(affectedResources).toBeFocused();
      await expect
        .poll(
          async (): Promise<number> => {
            const box: { y: number } | null =
              await affectedResources.boundingBox();
            return box ? Math.round(box.y) : -1;
          },
          { timeout: 10000 },
        )
        .toBeGreaterThanOrEqual(0);
      const box: { y: number; height: number } | null =
        await affectedResources.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeLessThan(844 / 2);
      await expect(
        affectedResources.getByRole("button", { name: "Edit" }),
      ).toBeInViewport();

      await expectNoHorizontalOverflow(page);
      await screenshot(page, `remediation-linked-to-nothing-landed-${width}`, {
        fullPage: false,
      });
    });
  }

  test("an alert linked to nothing says so in its own words, and lands on its own card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, ALERT_PATH, "fixing=nothing-linked");

    const line: Locator = decisionLine(page);
    await expect(line.getByTestId("remediation-decision-text")).toHaveText(
      "This alert is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.",
      { timeout: 30000 },
    );

    await line
      .getByRole("button", { name: GO_TO_AFFECTED_RESOURCES, exact: true })
      .click();

    const affectedResources: Locator = card(page, "Affected Resources");
    await expect(affectedResources).toHaveAttribute(
      "data-page-anchor-landed",
      "true",
    );
    await expect(affectedResources).toBeInViewport();
  });

  test("reads the same in dark mode, at a phone's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, INCIDENT_PATH, "fixing=nothing-linked-monitor&theme=dark");

    const line: Locator = decisionLine(page);
    await expect(line).toHaveCount(1, { timeout: 30000 });
    await expectNoHorizontalOverflow(page);
    await screenshotElement(
      remediationCard(page),
      "remediation-linked-to-nothing-390-dark",
    );
  });
});

/*
 * Issue #5293: asked to link the incident to the host it is about,
 * OneUptime AI waits for approval of add_incident_affected_resources. The
 * server prepared the action (prepareMutation), so the card says what it
 * links by name - Adds host "checkout-api-7f9c". - and leaves the list's
 * IDs out of the arguments line, where they would only repeat it.
 * ?thread=linking is that conversation, on incident #1042 and alert #311.
 */
test.describe("an action linking what a record is about waits for approval (issue #5293)", () => {
  const HOST_ID: string = uuid("84000000", 1);
  const ADDS_HOST: string = 'Adds host "checkout-api-7f9c".';

  function approvalPrompt(page: Page): Locator {
    return answers(page).first().getByRole("group", {
      name: "Actions waiting for approval",
    });
  }

  test("the card names the host it links, and running it links it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConversation(page, "thread=linking");
    const answer: Locator = answers(page).first();
    const prompt: Locator = approvalPrompt(page);

    await expect(prompt).toContainText("The AI wants to perform 1 action");
    // Named by its number: never by the ID the arguments carry.
    await expect(prompt).toContainText(
      "Link incident #1042 to affected resources",
    );
    await expect(prompt.getByTestId("tool-approval-description")).toHaveText(
      ADDS_HOST,
    );
    // The arguments line keeps the incident and leaves the list out.
    await expect(prompt).toContainText(`incidentId: ${INCIDENT_ID}`);
    await expect(prompt).not.toContainText("affectedResources");
    await expect(prompt).not.toContainText(HOST_ID);

    await prompt.getByRole("button", { name: /Run 1 action/ }).click();

    const decisions: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/ai-investigation/conversation/respond-to-approval",
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.body["decisions"]).toEqual([
      { toolCallId: "call_link", approved: true },
    ]);

    await expect(answer).toContainText(
      "Done — incident #1042 is linked to host checkout-api-7f9c.",
    );
    await expect(prompt).toHaveCount(0);
    await expect(
      answer.getByRole("list", { name: "Actions" }).getByRole("listitem"),
    ).toHaveText(["Link incident #1042 to affected resources · Done"]);
  });

  test("an alert's card names the host the same way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConversation(page, "thread=linking", ALERT_PATH);
    const prompt: Locator = approvalPrompt(page);

    await expect(prompt).toContainText("Link alert #311 to affected resources");
    await expect(prompt.getByTestId("tool-approval-description")).toHaveText(
      ADDS_HOST,
    );
    await expect(prompt).toContainText(`alertId: ${ALERT_ID}`);
    await expect(prompt).not.toContainText(HOST_ID);
  });

  for (const theme of ["light", "dark"]) {
    test(`on a phone the line stays inside the card (${theme})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openConversation(
        page,
        `thread=linking${theme === "dark" ? "&theme=dark" : ""}`,
      );
      const prompt: Locator = approvalPrompt(page);
      const description: Locator = prompt.getByTestId(
        "tool-approval-description",
      );

      await expect(description).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // The line wraps inside the card rather than running past it.
      const promptBox: { x: number; width: number } | null =
        await prompt.boundingBox();
      const descriptionBox: { x: number; width: number } | null =
        await description.boundingBox();
      expect(promptBox).not.toBeNull();
      expect(descriptionBox).not.toBeNull();
      expect(descriptionBox!.x).toBeGreaterThanOrEqual(promptBox!.x);
      expect(descriptionBox!.x + descriptionBox!.width).toBeLessThanOrEqual(
        promptBox!.x + promptBox!.width + 0.5,
      );

      /*
       * The title in full - the incident it acts on included - wrapped
       * rather than cut at one line.
       */
      const title: Locator = prompt.getByTestId("tool-approval-title");
      await expect(title).toHaveText(
        "Link incident #1042 to affected resources",
      );
      expect(
        await title.evaluate((element: HTMLElement): boolean => {
          return (
            element.scrollHeight <= element.clientHeight + 1 &&
            element.scrollWidth <= element.clientWidth + 1
          );
        }),
      ).toBe(true);

      /*
       * Allow and Skip under the action, which keeps the card's whole
       * width (#5301's UI review): beside it on a phone, German's wider
       * buttons left the title 85 px and cut it at three lines.
       */
      const action: Locator = prompt.getByTestId("tool-approval-action");
      const choice: Locator = prompt.getByTestId("tool-approval-choice");
      await expect(choice).toBeVisible();
      const actionBox: { x: number; width: number } | null =
        await action.boundingBox();
      const titleBox: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = await title.boundingBox();
      const choiceBox: { x: number; y: number } | null =
        await choice.boundingBox();
      expect(choiceBox!.y).toBeGreaterThanOrEqual(
        titleBox!.y + titleBox!.height,
      );
      // The text's width is the action's, less its padding and border.
      expect(titleBox!.width).toBeGreaterThanOrEqual(actionBox!.width - 28);
      // The pair starts where the text starts.
      expect(Math.abs(choiceBox!.x - titleBox!.x)).toBeLessThanOrEqual(1);

      await screenshotElement(prompt, `tool-approval-linking-390-${theme}`);
    });
  }

  test("on a wide card Allow and Skip sit beside the action, at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openConversation(page, "thread=linking");
    const prompt: Locator = approvalPrompt(page);
    const title: Locator = prompt.getByTestId("tool-approval-title");
    const choice: Locator = prompt.getByTestId("tool-approval-choice");

    await expect(choice).toBeVisible();
    // Named after the action it decides, for a screen reader.
    await expect(
      prompt.getByRole("group", {
        name: "Link incident #1042 to affected resources",
      }),
    ).toBeVisible();

    const titleBox: { x: number; y: number; width: number } | null =
      await title.boundingBox();
    const choiceBox: { x: number; y: number } | null =
      await choice.boundingBox();
    // On the title's line, past its end.
    expect(Math.abs(choiceBox!.y - titleBox!.y)).toBeLessThan(8);
    expect(choiceBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
  });
});

/*
 * An investigation that could not tell the cause for lack of logs says so,
 * under its report, with the way forward (?stall=; the follow-up of #5242
 * that #5273 listed). The fixture records the stall as the engine does, an
 * InvestigationStalled event before RunCompleted, beside an inconclusive
 * report.
 */
test.describe("an investigation the logs could not help (?stall=)", () => {
  const STALL_NOTICE: string = "investigation-log-stall";
  const SET_UP_LOGS: string = "investigation-log-stall-set-up-logs";
  const LOGS_AI: string = "investigation-log-stall-logs-ai";

  async function openStall(
    page: Page,
    pagePath: string,
    query: string,
  ): Promise<Locator> {
    await open(page, pagePath, query);

    const notice: Locator = investigationCard(page).getByTestId(STALL_NOTICE);
    await expect(notice).toBeVisible({ timeout: 30000 });
    return notice;
  }

  async function shoot(page: Page, name: string): Promise<void> {
    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await investigationCard(page).screenshot({
      path: path.join(SCREENSHOTS, `log-stall-${name}.png`),
    });
  }

  test("no log reached OneUptime: No logs to read, under the report, and where to set them up", async ({
    page,
  }: {
    page: Page;
  }) => {
    const notice: Locator = await openStall(
      page,
      INCIDENT_PATH,
      "stall=nologs",
    );

    await expect(notice).toContainText("No logs to read");
    await expect(notice).toContainText(
      "No logs reached OneUptime from the hour before this incident started, so OneUptime AI had none to read. Send your services' logs to OneUptime, and the next investigation can use them.",
    );
    await expect(notice.getByTestId(SET_UP_LOGS)).toHaveText("Set up logs");
    await expect(notice.getByTestId(SET_UP_LOGS)).toHaveAttribute(
      "href",
      `${DASHBOARD}/logs/documentation`,
    );
    await expect(notice.getByTestId(LOGS_AI)).toHaveCount(0);

    /*
     * Something to act on: said under the folded report's summary too
     * (block 43), and under the whole report once it is open.
     */
    await expect(reportToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expectAbove(
      foldedReportSummary(page),
      notice,
      "the summary, then the notice",
    );
    await showFullReport(page);
    await expect(notice).toBeVisible();

    // Under the report it explains, before its working.
    const order: Array<string> = await investigationCard(page).evaluate(
      (card: Element): Array<string> => {
        const notice: Element | null = card.querySelector(
          "[data-testid='investigation-log-stall']",
        );
        const report: Element | null = card.querySelector(
          "[data-testid='investigation-report-open'] h3",
        );
        const details: Element | null = Array.from(
          card.querySelectorAll("h3"),
        ).find((heading: Element): boolean => {
          return heading.textContent === "Evidence and activity";
        }) as Element | null;
        const before: (a: Element | null, b: Element | null) => boolean = (
          a: Element | null,
          b: Element | null,
        ): boolean => {
          return Boolean(
            a &&
              b &&
              a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
          );
        };
        return [
          before(report, notice) ? "report before notice" : "notice first",
          before(notice, details) ? "notice before details" : "details first",
        ];
      },
    );
    expect(order).toEqual(["report before notice", "notice before details"]);

    await shoot(page, "nologs-1280");
  });

  test("logs reached OneUptime and none matched: how often it searched, and both ways forward", async ({
    page,
  }: {
    page: Page;
  }) => {
    const notice: Locator = await openStall(
      page,
      INCIDENT_PATH,
      "stall=nomatch",
    );

    await expect(notice).toContainText("No logs about this incident");
    await expect(notice).toContainText(
      "OneUptime AI searched the logs 3 times and found nothing about this incident.",
    );
    await expect(notice.getByTestId(SET_UP_LOGS)).toHaveAttribute(
      "href",
      `${DASHBOARD}/logs/documentation`,
    );
    await expect(notice.getByTestId(LOGS_AI)).toHaveText(
      "Find unlogged failures",
    );
    await expect(notice.getByTestId(LOGS_AI)).toHaveAttribute(
      "href",
      `${DASHBOARD}/logs/ai/insights`,
    );

    // The report itself says it could not tell, and offers no fix.
    await showFullReport(page);
    await expect(investigationCard(page)).toContainText("Could not determine");
    await expect(
      investigationCard(page).getByRole("button", { name: OPEN_FIX_PR }),
    ).toHaveCount(0);

    await shoot(page, "nomatch-1280");
  });

  test("an alert's card says it of the alert", async ({
    page,
  }: {
    page: Page;
  }) => {
    const notice: Locator = await openStall(page, ALERT_PATH, "stall=nomatch");

    await expect(notice).toContainText("No logs about this alert");
    await expect(notice).toContainText("found nothing about this alert");
  });

  test("an investigation that found the cause says nothing of the kind", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH);
    await expect(investigationCard(page)).toContainText(INCIDENT_TLDR, {
      timeout: 30000,
    });
    await expect(investigationCard(page).getByTestId(STALL_NOTICE)).toHaveCount(
      0,
    );
  });

  test("on a phone the line and its links fit the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const notice: Locator = await openStall(
      page,
      INCIDENT_PATH,
      "stall=nomatch",
    );
    await notice.scrollIntoViewIfNeeded();

    const fit: { pageScrolls: boolean; cardBox: number; links: Array<number> } =
      await page.evaluate(
        (): { pageScrolls: boolean; cardBox: number; links: Array<number> } => {
          const card: Element | null =
            document.querySelector("#ai-investigation");
          const right: number = card ? card.getBoundingClientRect().right : 0;
          return {
            pageScrolls:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
            cardBox: right,
            links: Array.from(
              document.querySelectorAll(
                "[data-testid='investigation-log-stall-actions'] a",
              ),
            ).map((link: Element): number => {
              return link.getBoundingClientRect().right;
            }),
          };
        },
      );

    expect(fit.pageScrolls).toBe(false);
    expect(fit.links).toHaveLength(2);
    for (const linkRight of fit.links) {
      expect(linkRight).toBeLessThanOrEqual(fit.cardBox + 1);
    }

    await shoot(page, "nomatch-390");
  });

  test("in the dark theme the line reads light on the card, its links indigo", async ({
    page,
  }: {
    page: Page;
  }) => {
    const notice: Locator = await openStall(
      page,
      INCIDENT_PATH,
      "stall=nomatch&theme=dark",
    );

    const looks: { title: string; text: string; link: string } =
      await notice.evaluate(
        (element: Element): { title: string; text: string; link: string } => {
          const paragraphs: Array<Element> = Array.from(
            element.querySelectorAll("p"),
          );
          const link: Element | null = element.querySelector("a");
          return {
            title: window.getComputedStyle(paragraphs[0]!).color,
            text: window.getComputedStyle(paragraphs[1]!).color,
            link: link ? window.getComputedStyle(link).color : "",
          };
        },
      );

    // Not the light theme's near-black and gray on a dark card.
    expect(looks.title).not.toBe("rgb(17, 24, 39)");
    expect(looks.text).not.toBe("rgb(75, 85, 99)");
    expect(looks.link).not.toBe("");

    await shoot(page, "nomatch-dark");
  });
});

/*
 * A fix that changes a cloud account is dry-run before anyone approves it
 * (CloudChangeDryRun): under the change, the AI card's Remediation step
 * says what the dry run found - it would run (the call it would make and
 * its undo), the agent would refuse it (why, in amber), it could not
 * finish, or it is being checked - and each says nothing was changed. Dry
 * run again checks once more, and the answer lands on the step's next
 * poll. ?cloudfix= is such a fix on Incident #1042, for the AWS account
 * "prod".
 */
test.describe("a cloud fix's dry run on the Remediation step", () => {
  const SERVICE: string =
    "arn:aws:ecs:us-east-1:123456789012:service/prod/checkout-api";
  const COMMAND: string = `cloud scale-out ${SERVICE} --count 8`;
  const UNDO: string = `To undo it: cloud scale-in ${SERVICE} --count 4`;
  const CLOUD_FIX_SUGGESTION_ID: string = uuid("93000000", 1);
  const WOULD_RUN: RegExp =
    /^Dry run .+: this change would run\. Nothing was changed\.$/;

  function dryRunNote(page: Page): Locator {
    return remediationCard(page).getByTestId("remediation-dry-run");
  }

  function dryRunButton(page: Page): Locator {
    return remediationCard(page).getByTestId("remediation-dry-run-button");
  }

  // The plan's row of the change, which holds its dry run.
  function changeRow(page: Page): Locator {
    return remediationCard(page)
      .locator("li")
      .filter({ hasText: COMMAND })
      .last();
  }

  async function openCloudFix(page: Page, query: string): Promise<void> {
    await open(page, INCIDENT_PATH, query);
    await expect(
      remediationCard(page).getByText(COMMAND, { exact: true }),
    ).toBeVisible({ timeout: 30000 });
  }

  test("would run: nothing was changed, then the call it would make and its undo, beside Approve & Run", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudFix(page, "cloudfix=would-run");

    const note: Locator = dryRunNote(page);
    await expect(note).toHaveAttribute("data-status", "WouldRun");
    await expect(note.getByTestId("remediation-dry-run-headline")).toHaveText(
      WOULD_RUN,
    );
    const summary: Locator = note.getByTestId("remediation-dry-run-summary");
    await expect(summary).toContainText(
      "It would make ecs:UpdateService with desiredCount, and nothing else.",
    );
    await expect(summary).toContainText(UNDO);
    // Under the change it checked.
    await expect(
      changeRow(page).getByTestId("remediation-dry-run"),
    ).toHaveCount(1);

    await expect(
      remediationCard(page).getByTestId("remediation-approve-button"),
    ).toBeVisible();
    await expect(dryRunButton(page)).toHaveText("Dry run again");
    await expect(dryRunButton(page)).toBeEnabled();

    await expectNoHorizontalOverflow(page);
    await screenshotElement(
      remediationCard(page),
      "remediation-cloud-dry-run-would-run",
    );
  });

  test("would be refused: amber, with the agent's reason, and Approve & Run stays: the agent checks the change again when it runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudFix(page, "cloudfix=refused");

    const note: Locator = dryRunNote(page);
    await expect(note).toHaveAttribute("data-status", "WouldBeRefused");
    await expect(note.getByTestId("remediation-dry-run-headline")).toHaveText(
      /^Dry run .+: the agent would refuse this change\. Nothing was changed\.$/,
    );
    await expect(note.getByTestId("remediation-dry-run-summary")).toContainText(
      "(ONEUPTIME_AI_CLOUD_REQUIRED_TAG)",
    );
    // Amber words and mark, on the AI card itself: no box (block 43).
    await expect(note).toHaveClass(/text-amber-800/);
    expect(await frameLook(note)).toEqual(NO_FRAME);
    expect(await panelsInsideTheCard(page)).toEqual([]);
    await expect(
      remediationCard(page).getByTestId("remediation-approve-button"),
    ).toBeVisible();
    await screenshotElement(
      remediationCard(page),
      "remediation-cloud-dry-run-refused",
    );
  });

  test("could not finish: says so, with what the server knows, and nothing was changed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudFix(page, "cloudfix=failed");

    const note: Locator = dryRunNote(page);
    await expect(note).toHaveAttribute("data-status", "Failed");
    await expect(note.getByTestId("remediation-dry-run-headline")).toHaveText(
      /^Dry run .+: it could not finish\. Nothing was changed\.$/,
    );
    await expect(note.getByTestId("remediation-dry-run-summary")).toContainText(
      "did not pick up the command in time",
    );
    await expect(note).not.toHaveClass(/amber/);
  });

  test("being checked: one status line, and Dry run again waits for the answer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudFix(page, "cloudfix=running");

    const note: Locator = dryRunNote(page);
    await expect(note).toHaveAttribute("data-status", "Running");
    await expect(note).toHaveAttribute("role", "status");
    await expect(note).toHaveText("Checking this change with a dry run…");
    await expect(dryRunButton(page)).toBeDisabled();
    await screenshotElement(
      remediationCard(page),
      "remediation-cloud-dry-run-running",
    );
  });

  test("no dry run yet, as from before dry runs: Dry run, and no answer under the change", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudFix(page, "cloudfix=none");

    await expect(dryRunNote(page)).toHaveCount(0);
    await expect(dryRunButton(page)).toHaveText("Dry run");
    await expect(dryRunButton(page)).toBeEnabled();
  });

  test("Dry run again checks once more: the change is being checked at once, and its answer lands on the next poll", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudFix(page, "cloudfix=failed");
    await expect(dryRunNote(page)).toHaveAttribute("data-status", "Failed");

    await dryRunButton(page).click();

    // Read again right after the click: on its way, so the card polls.
    await expect(dryRunNote(page)).toHaveAttribute("data-status", "Running");
    await expect(dryRunButton(page)).toBeDisabled();

    const posts: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/auto-remediation/dry-run",
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]!.method).toBe("POST");
    expect(posts[0]!.body).toEqual({ suggestionId: CLOUD_FIX_SUGGESTION_ID });

    // The card's next poll (every 15 s) reads the answer.
    await expect(dryRunNote(page)).toHaveAttribute("data-status", "WouldRun", {
      timeout: 30000,
    });
    await expect(
      dryRunNote(page).getByTestId("remediation-dry-run-headline"),
    ).toHaveText(WOULD_RUN);
    await expect(dryRunButton(page)).toBeEnabled();
    // One click, one dry run.
    expect(await apiRequestsTo(page, "/auto-remediation/dry-run")).toHaveLength(
      1,
    );
  });

  test("a click the server refuses says the dry run did not start and nothing was changed, with why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudFix(page, "cloudfix=failed&fail=dry-run");

    await dryRunButton(page).click();

    const refusal: Locator = remediationCard(page).getByTestId(
      "remediation-action-error",
    );
    await expect(refusal).toContainText(
      "Could not start the dry run: nothing was changed",
    );
    await expect(refusal).toContainText(
      "The Cloud AI agent of this AWS account is offline, so the change cannot be dry-run.",
    );
    // The answer it had stays.
    await expect(dryRunNote(page)).toHaveAttribute("data-status", "Failed");
    await expect(dryRunButton(page)).toBeEnabled();
  });

  test("reads at a phone's width in dark mode: the long resource id stays inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCloudFix(page, "cloudfix=refused&theme=dark");

    const note: Locator = dryRunNote(page);
    await expect(note).toHaveAttribute("data-status", "WouldBeRefused");
    await expectNoHorizontalOverflow(page);

    const cardBox: Box = await documentBox(remediationCard(page));
    const noteBox: Box = await documentBox(note);
    expect(noteBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width + 1,
    );
    expect(
      await isOverflowing(note.getByTestId("remediation-dry-run-summary")),
    ).toBe(false);

    await screenshotElement(
      remediationCard(page),
      "remediation-cloud-dry-run-refused-390-dark",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The AI card in two steps (block 43): "Can you make it in two steps?
 * Investigation would be one step, and remediation would be the other
 * step ... When remediation is enabled, it should show. Up there, it
 * should show the remediation card. If no remediation is happening because
 * of some error, show why remediation doesn't happen."
 *
 * The OneUptime AI card holds both, up top: 1 Investigation, folded to its
 * summary once it reports, and 2 Remediation, which was a card of its own
 * far down the page - each with a status pill beside its title, and a mark
 * on a rail that joins them.
 * ---------------------------------------------------------------------------
 */

const NOT_TRIED: string = "OneUptime AI has not tried to fix this incident.";
const WAITING_FOR_INVESTIGATION: string =
  "OneUptime AI decides how to fix this incident once the investigation is done, so it can act on the root cause.";
const FIXING_OFF_LINE: string =
  '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.';
const FIXING_ON_NOW_LINE: string =
  '"Fix new incidents automatically" was off when OneUptime AI checked this incident. It is on now.';
const TRY_AGAIN_HINT: string =
  "Checks this incident again with the project's settings as they are now.";
const TOO_SOON: string =
  "OneUptime AI has just checked this incident. Try again in a moment.";

function stepPill(step: Locator, label: string): Locator {
  return step.getByLabel(label, { exact: true });
}

// Opens a record and waits for its AI card to have drawn both steps.
async function openTwoSteps(
  page: Page,
  query: string,
  remediationPill: string,
  pagePath: string = INCIDENT_PATH,
): Promise<{ investigation: Locator; remediation: Locator }> {
  await open(page, pagePath, query);
  const investigation: Locator = investigationStep(page);
  const remediation: Locator = remediationStep(page);
  await expect(remediation).toBeVisible({ timeout: 30000 });
  await expect(
    stepPill(remediation, STEP_TITLES_AND_PILLS[1]!.pill),
  ).toHaveText(remediationPill, { timeout: 30000 });
  await expectWhatHappenedSettled(page);
  return { investigation, remediation };
}

test.describe("the AI card in two steps: Investigation, then Remediation (block 43)", () => {
  test("up top, one card holds both: the investigation folded to its summary, then what fixing did", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { investigation, remediation } = await openTwoSteps(
      page,
      "",
      "Not tried",
    );

    const aiCard: Locator = investigationCard(page);
    await expect(aiCard).toHaveCount(1);
    await expect(aiCard.getByTestId("card-description")).toHaveText(
      "What OneUptime AI found, and what it is doing about it.",
    );
    await expect(aiCard.getByTestId("ai-card-step-investigation")).toHaveCount(
      1,
    );
    await expect(aiCard.getByTestId("ai-card-step-remediation")).toHaveCount(1);

    // Step 1: its title and pill on one line, its mark a check: it reported.
    await expect(stepTitle(page, STEP_TITLES_AND_PILLS[0]!)).toBeVisible();
    await expect(
      stepPill(investigation, STEP_TITLES_AND_PILLS[0]!.pill),
    ).toHaveText("Completed");
    await expect(investigation).toHaveAttribute("data-indicator", "done");
    await expect(investigation).toHaveAttribute("data-step", "1");
    await expect(
      page.getByTestId("ai-card-step-investigation-rail"),
    ).toBeVisible();

    // Folded to its answer, with the rest one press away.
    await expect(foldedReportSummary(page)).toHaveText(INCIDENT_TLDR);
    await expect(reportToggle(page)).toHaveText(SHOW_FULL_REPORT);
    await expect(reportToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(reportSection(page)).toHaveCount(0);
    await expect(page.getByText(VERDICT_QUESTION)).toHaveCount(0);

    // Step 2, under it: nothing was decided for this incident yet.
    await expect(stepTitle(page, STEP_TITLES_AND_PILLS[1]!)).toBeVisible();
    await expect(remediation).toHaveAttribute("data-step", "2");
    await expect(
      remediation.getByTestId("remediation-step-not-tried"),
    ).toHaveText(NOT_TRIED);
    await expectAbove(investigation, remediation, "investigation, then fixing");
    // The last step has no rail under it.
    await expect(page.getByTestId("ai-card-step-remediation-rail")).toHaveCount(
      0,
    );

    // Up there: above the feed, not far down the page, and no card of its own.
    await expectAbove(
      remediation,
      card(page, "Incident Feed"),
      "fixing above the feed",
    );
    await expect(card(page, "Remediation")).toHaveCount(0);
    expect(await panelsInsideTheCard(page)).toEqual([]);
    await expectNoErrorStates(page);
  });

  test("Show full report opens the report, its working and the verdict; Show less folds it back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTwoSteps(page, "", "Not tried");

    await reportToggle(page).click();
    await expect(reportToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(reportToggle(page)).toHaveText("Show less");
    await expect(summarySection(page)).toContainText(INCIDENT_TLDR);
    await expect(reportSection(page)).toContainText(REPORT_CAVEAT);
    await expect(investigationDetails(page)).toBeVisible();
    await expect(page.getByText(VERDICT_QUESTION)).toBeVisible();
    // The verdict ends the report, and the toggle closes it.
    await expectAbove(
      page.getByText(VERDICT_QUESTION),
      reportToggle(page),
      "the verdict, then Show less",
    );
    expect(await panelsInsideTheCard(page)).toEqual([]);

    await reportToggle(page).click();
    await expect(reportToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(reportSection(page)).toHaveCount(0);
    await expect(foldedReportSummary(page)).toHaveText(INCIDENT_TLDR);
  });

  test("the header's View full report opens the folded report it jumps to", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTwoSteps(page, "", "Not tried");
    await expect(reportToggle(page)).toHaveAttribute("aria-expanded", "false");

    await hero(page).getByRole("button", { name: "View full report" }).click();

    await expect(page.locator("#ai-investigation")).toBeFocused();
    await expect(reportToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(reportSection(page)).toContainText(REPORT_CAVEAT);
  });

  test("while the investigation runs, fixing waits for it, and says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { investigation, remediation } = await openTwoSteps(
      page,
      "ai=running&state=created",
      "Waiting",
    );

    await expect(
      stepPill(investigation, STEP_TITLES_AND_PILLS[0]!.pill),
    ).toHaveText("Investigating…");
    await expect(investigation).toHaveAttribute("data-indicator", "live");
    await expect(
      remediation.getByTestId("remediation-decision-line"),
    ).toHaveText(WAITING_FOR_INVESTIGATION);
    await expect(remediation).toHaveAttribute("data-indicator", "waiting");
    // Nothing to try again while it waits.
    await expect(remediation.getByTestId("remediation-try-again")).toHaveCount(
      0,
    );
  });

  test("fixing off: the step says why, and links to the switch (?fixing=off)", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { remediation } = await openTwoSteps(page, "fixing=off", "Off");

    const line: Locator = remediation.getByTestId("remediation-decision-line");
    await expect(line.getByTestId("remediation-decision-text")).toHaveText(
      FIXING_OFF_LINE,
    );
    await expect(
      line.getByRole("link", { name: "Turn on for incidents" }),
    ).toHaveAttribute("href", INCIDENT_AI_SETTINGS_HREF);
    // Still off, and the incident is resolved: nothing to try again.
    await expect(remediation.getByTestId("remediation-try-again")).toHaveCount(
      0,
    );
  });

  test("turned on since: the line says it was off then and is on now, and Try again decides again", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { remediation } = await openTwoSteps(
      page,
      "state=created&fixing=off&switches=on",
      "Needs attention",
    );

    await expect(
      remediation.getByTestId("remediation-decision-text"),
    ).toHaveText(FIXING_ON_NOW_LINE);
    const tryAgain: Locator = remediation.getByTestId("remediation-try-again");
    await expect(tryAgain).toContainText(TRY_AGAIN_HINT);

    await tryAgain.getByRole("button", { name: "Try again" }).click();

    // Decided again, now: OneUptime AI started a fix, read at once.
    await expect(
      stepPill(remediation, STEP_TITLES_AND_PILLS[1]!.pill),
    ).toHaveText("Fixing…");
    await expect(remediation.getByTestId("remediation-decision")).toContainText(
      '"prod-eu-west-1"',
    );
    await expect(
      remediation.getByTestId("remediation-decision-text").first(),
    ).not.toHaveText(FIXING_ON_NOW_LINE);
    await expect(remediation.getByTestId("remediation-try-again")).toHaveCount(
      0,
    );
    const requests: Array<RecordedApiRequest> = await apiRequestsTo(
      page,
      "/auto-remediation/try-again",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({ incidentId: INCIDENT_ID });
  });

  test("?fail=try-again: the refusal says why, in a notice that can be put away", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { remediation } = await openTwoSteps(
      page,
      "state=created&fixing=off&switches=on&fail=try-again",
      "Needs attention",
    );

    await remediation.getByRole("button", { name: "Try again" }).click();

    const notice: Locator = remediation.getByTestId(
      "remediation-try-again-error",
    );
    await expect(notice).toContainText("OneUptime AI could not check again");
    await expect(notice).toContainText(TOO_SOON);
    await expect(notice).toHaveAttribute("role", "alert");
    expect(await frameLook(notice)).toEqual(NO_FRAME);
    // What it said before stays.
    await expect(
      remediation.getByTestId("remediation-decision-text"),
    ).toHaveText(FIXING_ON_NOW_LINE);

    await notice.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toHaveCount(0);
  });

  test("the alert page has the same two steps, in its own words (?fixing=off)", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { remediation } = await openTwoSteps(
      page,
      "fixing=off",
      "Off",
      ALERT_PATH,
    );

    await expect(
      remediation.getByTestId("remediation-decision-text"),
    ).toHaveText(
      '"Fix new alerts automatically" is off for this project, so OneUptime AI did not try to fix this alert.',
    );
    await expect(
      remediation.getByRole("link", { name: "Turn on for alerts" }),
    ).toHaveAttribute("href", ALERT_AI_SETTINGS_HREF);
    await expect(foldedReportSummary(page)).toHaveText(ALERT_TLDR);
    await expect(card(page, "Remediation")).toHaveCount(0);
  });

  test("a fix waiting for approval is what the pill says (?cloudfix=would-run)", async ({
    page,
  }: {
    page: Page;
  }) => {
    const { remediation } = await openTwoSteps(
      page,
      "cloudfix=would-run",
      "Needs your approval",
    );

    await expect(remediation).toHaveAttribute("data-indicator", "attention");
    await expect(
      remediation.getByTestId("remediation-fixes-description"),
    ).toBeVisible();
    await expect(
      remediation.getByTestId("remediation-approve-button"),
    ).toBeVisible();
    // Nothing to try again beside a fix.
    await expect(remediation.getByTestId("remediation-try-again")).toHaveCount(
      0,
    );
    expect(await panelsInsideTheCard(page)).toEqual([]);
  });

  test.describe("the fix in the code the investigation recommends (?codefix=)", () => {
    const CASES: ReadonlyArray<{
      query: string;
      pill: string;
      text: string;
      link: string;
    }> = [
      {
        query: "codefix=writing",
        pill: "Fixing…",
        text: "OneUptime AI is writing a pull request that fixes the code.",
        link: "View progress",
      },
      {
        query: "codefix=opened",
        pill: "Pull request opened",
        text: "OneUptime AI opened a pull request that fixes the code.",
        link: "View pull request",
      },
      {
        query: "codefix=no-repository",
        pill: "Needs attention",
        text: "The investigation found the cause in the code, but no code repository is connected.",
        link: "Connect a repository",
      },
    ];

    for (const codeFix of CASES) {
      test(`${codeFix.query}: ${codeFix.pill}, with what came of it and where`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const { remediation } = await openTwoSteps(
          page,
          codeFix.query,
          codeFix.pill,
        );

        const row: Locator = remediation.getByTestId("remediation-code-fix");
        await expect(row.getByTestId("remediation-code-fix-text")).toHaveText(
          codeFix.text,
        );
        await expect(
          row.getByRole("link", { name: codeFix.link }),
        ).toBeVisible();
        // OneUptime AI is trying (or one step from it): never "not tried".
        await expect(
          remediation.getByTestId("remediation-step-not-tried"),
        ).toHaveCount(0);
        const requests: Array<RecordedApiRequest> = await apiRequestsTo(
          page,
          "/ai-investigation/code-fix-suggestion",
        );
        expect(requests[0]?.body).toEqual({
          subjectType: "incident",
          subjectId: INCIDENT_ID,
        });
        expect(await panelsInsideTheCard(page)).toEqual([]);
      });
    }

    /*
     * Said with the settings of now: once fixing is on, the pull request
     * was not opened because OneUptime AI opens one on its own only when an
     * investigation finishes - never "turn on" a switch that is on.
     */
    test("codefix=act with fixing on now: why it did not open on its own, and no switch to turn on", async ({
      page,
    }: {
      page: Page;
    }) => {
      const { remediation } = await openTwoSteps(
        page,
        "state=created&fixing=off&switches=on&codefix=act",
        "Needs attention",
      );

      const row: Locator = remediation.getByTestId("remediation-code-fix");
      await expect(row.getByTestId("remediation-code-fix-why")).toHaveText(
        "OneUptime AI opens one on its own only when an investigation finishes, so open this one yourself.",
      );
      await expect(
        row.getByRole("button", { name: OPEN_FIX_PR, exact: true }),
      ).toBeEnabled();
      await expect(
        remediation.getByRole("link", { name: /^Turn on/ }),
      ).toHaveCount(0);
    });
  });

  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`both steps at ${width}px, ${theme}: titles, pills and lines fit, nothing scrolls sideways`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        const { investigation, remediation } = await openTwoSteps(
          page,
          `state=created&fixing=off&switches=on${theme === "dark" ? "&theme=dark" : ""}`,
          "Needs attention",
        );

        for (const step of STEP_TITLES_AND_PILLS) {
          const pill: Locator = page
            .getByTestId(step.testId)
            .getByLabel(step.pill, { exact: true });
          expect(await isOverflowing(pill), `${step.pill} is cut off`).toBe(
            false,
          );
          const title: Box = await documentBox(stepTitle(page, step));
          const pillBox: Box = await documentBox(pill);
          // Beside its title while they fit, under it otherwise - never over it.
          expect(
            pillBox.y >= title.y - 8,
            `${step.pill} sits level with or below its title`,
          ).toBe(true);
          expect(title.height, `${step.title} is one line`).toBeLessThanOrEqual(
            28,
          );
        }

        /*
         * From sm up a step's body sits under its title, beside the rail; on
         * a phone it takes the card's width, under the mark, and the rail is
         * left out.
         */
        const mark: Box = await documentBox(
          page.getByTestId("ai-card-step-investigation-mark"),
        );
        const body: Box = await documentBox(
          page.getByTestId("ai-card-step-investigation-body"),
        );
        const title: Box = await documentBox(
          stepTitle(page, STEP_TITLES_AND_PILLS[0]!),
        );
        if (width < 640) {
          expect(body.x).toBeCloseTo(mark.x, 0);
          expect(body.y).toBeGreaterThanOrEqual(mark.y + mark.height);
          await expect(
            page.getByTestId("ai-card-step-investigation-rail"),
          ).toBeHidden();
        } else {
          expect(body.x).toBeCloseTo(title.x, 0);
          await expect(
            page.getByTestId("ai-card-step-investigation-rail"),
          ).toBeVisible();
        }

        await expect(
          remediation.getByRole("button", { name: "Try again" }),
        ).toBeVisible();
        await expect(investigation).toBeVisible();
        expect(await panelsInsideTheCard(page)).toEqual([]);
        await expectNoHorizontalOverflow(page);
        await page.mouse.move(0, 0);
        await screenshotElement(
          investigationCard(page),
          `ai-card-two-steps-${width}-${theme}`,
        );
      });
    }
  }

  test("reads in German (?lang=de)", async ({ page }: { page: Page }) => {
    await open(page, INCIDENT_PATH, "fixing=off&lang=de");
    const remediation: Locator = remediationStep(page);
    await expect(
      remediation.getByRole("heading", { level: 3, name: "Behebung" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      investigationStep(page).getByRole("heading", {
        level: 3,
        name: "Untersuchung",
      }),
    ).toBeVisible();
    await expect(remediation.getByLabel("Behebungsstatus")).toHaveText("Aus");
    await expect(reportToggle(page)).toHaveText(
      "Vollständigen Bericht anzeigen",
    );
    await expect(
      remediation.getByRole("link", { name: "Für Vorfälle einschalten" }),
    ).toHaveAttribute("href", INCIDENT_AI_SETTINGS_HREF);
    await expectWhatHappenedSettled(page);
    await expectNoHorizontalOverflow(page);
    await page.mouse.move(0, 0);
    await screenshotElement(investigationCard(page), "ai-card-two-steps-de");
  });

  for (const width of [1280, 390]) {
    test(`reads in Persian, right to left, at ${width}px (?lang=fa&dir=auto)`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, INCIDENT_PATH, "fixing=off&lang=fa&dir=auto");
      const investigation: Locator = investigationStep(page);
      const remediation: Locator = remediationStep(page);
      await expect(
        remediation.getByRole("heading", { level: 3, name: "رفع مشکل" }),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        investigation.getByRole("heading", { level: 3, name: "بررسی" }),
      ).toBeVisible();
      await expect(remediation.getByLabel("وضعیت رفع مشکل")).toHaveText(
        "خاموش",
      );
      await expectWhatHappenedSettled(page);

      // Right to left: each step's mark is at the start, right of its title.
      for (const [step, testId] of [
        [investigation, "ai-card-step-investigation"],
        [remediation, "ai-card-step-remediation"],
      ] as Array<[Locator, string]>) {
        const mark: Box = await documentBox(page.getByTestId(`${testId}-mark`));
        const title: Box = await documentBox(
          step.getByRole("heading", { level: 3 }).first(),
        );
        expect(
          mark.x,
          "the mark is at the start, on the right",
        ).toBeGreaterThan(title.x + title.width);
      }

      await expectNoHorizontalOverflow(page);
      await page.mouse.move(0, 0);
      await screenshotElement(
        investigationCard(page),
        `ai-card-two-steps-fa-${width}`,
      );
    });
  }
});
