import {
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

const PORT: string = "4222";
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

// The code-fix action on a completed investigation; the docs name it too.
const OPEN_FIX_PR: string = "Open Fix PR from this analysis";

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
  "You do not have permission to create this Incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident.";

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
}

const INCIDENT_PAGE: EventPage = {
  name: "incident-overview",
  path: INCIDENT_PATH,
  pageTitle: "Incident - Checkout API p95 latency above 2s",
  title: "Checkout API p95 latency above 2s",
  identifier: "#1042",
  feed: "Incident Feed",
  readyTexts: [
    REPORT_CAVEAT,
    "Rolling checkout-api back to 2026.09.14-1",
    "Communications Lead",
    "eu-west-1 probe",
    "4 resources",
  ],
  state: "Resolved",
  severity: "SEV-2",
  duration: "Lasted 11 minutes",
  facts: [
    { label: "Declared", value: "Sep 14 2026, 06:01 PM GMT" },
    { label: "Declared by", value: "eu-west-1 probe" },
    {
      label: "Monitors",
      value: "Checkout API p95 latency, Orders DB connection pool",
    },
  ],
  statBar: "Incident response times",
  stats: [
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
    {
      label: "Duration",
      value: "11 minutes",
      description: "Ended Sep 14 2026, 06:12 PM GMT",
    },
  ],
  rightColumn: ["Incident Details", "Incident Roles", "Affected Resources"],
  detailsCard: "Incident Details",
  detailLabels: [
    "Declared At",
    "Declared By",
    "On-Call Duty Policies",
    "Subscriber Notification Status",
    // The status pages the incident is limited to, read only.
    "Status Page Scope",
    "Labels",
    "Incident Number",
    "Incident ID",
  ],
};

const ALERT_PAGE: EventPage = {
  name: "alert-overview",
  path: ALERT_PATH,
  pageTitle: "Alert - Payment webhook 5xx rate above 5%",
  title: "Payment webhook 5xx rate above 5%",
  identifier: "#311",
  feed: "Alert Feed",
  readyTexts: [
    REPORT_CAVEAT,
    "Alert #311 Created:",
    "Payments on-call",
    // Its monitor and its one service.
    "2 resources",
  ],
  state: "Resolved",
  severity: "High",
  duration: "Lasted 9 minutes",
  facts: [
    { label: "Created", value: "Sep 14 2026, 06:06 PM GMT" },
    { label: "Monitor", value: "Payment webhook error rate" },
    { label: "Episode", value: "Payment webhook failures — Sep 14" },
  ],
  statBar: "Alert response times",
  stats: [
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
    {
      label: "Duration",
      value: "9 minutes",
      description: "Ended Sep 14 2026, 06:15 PM GMT",
    },
  ],
  rightColumn: ["Alert Details", "Affected Resources"],
  detailsCard: "Alert Details",
  detailLabels: [
    "Created At",
    "Created By",
    "Monitor",
    "Episode",
    "On-Call Duty Policies",
    "Labels",
    "Alert Number",
    "Alert ID",
  ],
};

const SCHEDULED_MAINTENANCE_PAGE: EventPage = {
  name: "scheduled-maintenance-overview",
  path: SCHEDULED_MAINTENANCE_PATH,
  pageTitle: "Scheduled Event - Primary database failover drill",
  title: "Primary database failover drill",
  identifier: "#58",
  feed: "Scheduled Maintenance Feed",
  readyTexts: [
    "Subscribers notified",
    "Acme Internal Status",
    "4 resources",
    "Mark as Ongoing",
  ],
  state: "Scheduled",
  duration: "Starts in 2 hours",
  facts: [
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
  rightColumn: ["Maintenance Details", "Affected Resources"],
  detailsCard: "Maintenance Details",
  detailLabels: [
    "Starts At",
    "Ends At",
    "Created At",
    "Shown on Status Pages",
    "Subscriber Reminders",
    "Subscriber Notifications",
    "Labels",
    "Scheduled Maintenance Number",
    "Scheduled Maintenance ID",
  ],
};

const INCIDENT_EPISODE_PAGE: EventPage = {
  name: "incident-episode-overview",
  path: INCIDENT_EPISODE_PATH,
  pageTitle: "Episode - Checkout degradation — Sep 14",
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
    { label: "Grouping", value: "Checkout incidents within 30 minutes" },
    { label: "Created by", value: "System" },
    { label: "Last incident added", value: "19 minutes ago" },
  ],
  statBar: "Episode timing",
  stats: [
    { label: "Acknowledged in", value: "8 minutes" },
    { label: "Resolved in", value: "18 minutes" },
    { label: "Duration", value: "18 minutes" },
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
    "Created By",
    "On-Call Duty Policies",
    "Created At",
    "Labels",
    "Episode ID",
  ],
};

const ALERT_EPISODE_PAGE: EventPage = {
  name: "alert-episode-overview",
  path: ALERT_EPISODE_PATH,
  pageTitle: "Episode - Payment webhook failures — Sep 14",
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
    { label: "Grouping", value: "Payments webhook alerts" },
    { label: "Created by", value: "System" },
    { label: "Last alert added", value: "14 minutes ago" },
  ],
  statBar: "Episode timing",
  stats: [
    { label: "Acknowledged in", value: "15 minutes" },
    { label: "Resolved in", value: "36 minutes" },
    { label: "Duration", value: "36 minutes" },
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
    "Created By",
    "On-Call Duty Policies",
    "Created At",
    "Labels",
    "Episode ID",
  ],
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
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 30000 });
  }
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

function investigationCard(page: Page): Locator {
  return card(page, "AI Investigation");
}

function hero(page: Page): Locator {
  return page
    .getByRole("group", { name: "Event actions" })
    .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
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
 * its name: every tab name ends with its count, and phones shorten
 * "Evidence checked" to "Evidence".
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

async function statCells(page: Page, name: string): Promise<Array<StatCell>> {
  return page
    .getByRole("group", { name, exact: true })
    .locator(":scope > div")
    .evaluateAll((cells: Array<Element>): Array<StatCell> => {
      return cells.map((cell: Element): StatCell => {
        const parts: Array<string> = Array.from(cell.children).map(
          (child: Element): string => {
            return (child.textContent || "").trim();
          },
        );
        const result: StatCell = {
          label: parts[0] || "",
          value: parts[1] || "",
        };
        if (parts[2]) {
          result.description = parts[2];
        }
        return result;
      });
    });
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
      "OneUptime AI's root-cause report for this incident.",
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
      "Incident - Checkout requests timing out on orders-db",
    );
    await expect(hero(page).getByRole("heading", { level: 2 })).toHaveText(
      "Checkout requests timing out on orders-db",
    );
    await expect(hero(page)).toContainText("#1029");
    await expectRenderedText(hero(page), "Lasted 51 minutes");
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
    await expect(summarySection(page)).toContainText(INCIDENT_TLDR);
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

  test("Open Fix PR creates a fix task for this run", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const investigation: Locator = investigationCard(page);
    await expect(
      investigation.getByRole("heading", { name: "Act on this investigation" }),
    ).toBeVisible();
    await investigation
      .getByRole("button", { name: OPEN_FIX_PR, exact: true })
      .click();

    await expect(investigation.getByText("Fix task created")).toBeVisible();
    await expect(
      investigation.getByRole("link", { name: "View task progress" }),
    ).toHaveAttribute("href", new RegExp(`${FIX_TASK_ID}$`));
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

  test("?fail=create-fix-task explains why no task was created", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE, "fail=create-fix-task");

    const investigation: Locator = investigationCard(page);
    await investigation
      .getByRole("button", { name: OPEN_FIX_PR, exact: true })
      .click();
    await expect(
      investigation.getByText("Could not create the fix task"),
    ).toBeVisible();
    await expect(investigation).toContainText(
      "No AI agent is online for this project.",
    );
    await expect(investigation.getByText("Fix task created")).toHaveCount(0);
  });

  test("the feed shows a compact AI item and the full report behind More Information", async ({
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

    await item.getByRole("button", { name: "More Information" }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "More Information",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Most likely root cause");
    await expect(dialog).toContainText("Suggested next steps");
    await expect(dialog).toContainText("Evidence checked");
    await expect(dialog).toContainText(
      "Incident #1042 timeline (1 entry) — 1 row(s)",
    );
    await expect(dialog).toContainText(
      "Investigated automatically by OneUptime AI",
    );
    // Safe mode: nothing in the modal is a link or an image from the report.
    await expect(dialog.locator("img")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("the alert page shows its report, references and header summary", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, ALERT_PAGE);

    const investigation: Locator = investigationCard(page);
    await expect(investigation).toContainText(
      "OneUptime AI's root-cause report for this alert.",
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
      "Alert - Payment webhook 5xx rate above 5%",
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
      investigation.getByRole("heading", { name: "Act on this investigation" }),
      "details before the actions",
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
      await expect(chart).toContainText("2,600ms");
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
    await expectRenderedText(hero(page), "Lasted 38 minutes");
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
 * framed wherever it is drawn) and an action waiting for approval. The card
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
            "button, a, [role='tab'], [role='group'], code, pre, kbd, [hidden], textarea",
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
];

async function openCardState(page: Page, state: CardState): Promise<Locator> {
  await open(page, INCIDENT_PATH, state.query);
  const investigation: Locator = investigationCard(page);
  await expect(investigation.getByLabel("Investigation status")).toHaveText(
    state.badge,
    { timeout: 30000 },
  );
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
      "Summary",
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
      "Evidence and activity",
      "Act on this investigation",
      VERDICT_QUESTION,
      // The shared conversation under the report.
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

  test("the report is the first thing in the card and the rating the last", async ({
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
      "the working before the actions",
    );
    await expect(
      page
        .getByTestId("investigation-actions")
        .getByRole("heading", { level: 3 }),
    ).toHaveText(["Act on this investigation", VERDICT_QUESTION]);
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
    for (const query of ["", "ai=none"]) {
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

    // The title starts at the card's left edge: no icon tile in front of it.
    const headingBox: Box = await documentBox(heading);
    const sectionBox: Box = await documentBox(section);
    const verdictBox: Box = await documentBox(verdictHeading);
    expect(headingBox.x).toBeCloseTo(sectionBox.x, 0);
    expect(headingBox.x).toBeCloseTo(verdictBox.x, 0);
    await expect(heading.locator("xpath=..").locator("svg")).toHaveCount(0);
  });

  test("the status pill ends at the edge the card's content ends at", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);
    const investigation: Locator = investigationCard(page);
    const pill: Box = await documentBox(
      investigation.getByLabel("Investigation status"),
    );
    const title: Box = await documentBox(
      investigation.getByRole("heading", { level: 2 }),
    );
    const section: Box = await documentBox(conversation(page));

    await expect(investigation.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "inline",
    );
    // Beside the title, on its line.
    expect(pill.y).toBeLessThan(title.y + title.height);
    expect(pill.x).toBeGreaterThan(title.x + title.width);
    // It used to stop 12px short of the hairlines' right end.
    expect(pill.x + pill.width).toBeCloseTo(section.x + section.width, 0);
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
        query: "",
        description:
          "Ask a follow-up question, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
      },
      {
        name: "with nothing investigated it leads with the root-cause question",
        query: "ai=none",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: [ROOT_CAUSE_SUGGESTION, ...USUAL_SUGGESTIONS],
      },
      {
        name: "after a run that stopped it leads with the root-cause question",
        query: "ai=failed",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: [ROOT_CAUSE_SUGGESTION, ...USUAL_SUGGESTIONS],
      },
      {
        name: "while a run is investigating it does not",
        query: "ai=running",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
      },
      {
        name: "while a run is queued it does not",
        query: "ai=queued",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
      },
      {
        name: "while the report is being written it does not",
        query: "ai=pending",
        description:
          "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
        labels: USUAL_SUGGESTIONS,
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
      const section: Locator = await openConversation(page, "ai=none");
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
      await openConversation(page, "");

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
        "AI is turned off for this project. Turn it on in Project Settings → AI Features, then ask again.",
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
      await expect(steps).toContainText("Running recent_changes");
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
      const frameBox: Box = await documentBox(frame);

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

      // Everything it needs is inside that frame.
      for (const part of [
        composerBox(page),
        modePicker(page),
        modeCaption(page),
        sendButton(page),
      ]) {
        const box: Box = await documentBox(part);
        expect(box.x).toBeGreaterThanOrEqual(frameBox.x);
        expect(box.x + box.width).toBeLessThanOrEqual(
          frameBox.x + frameBox.width,
        );
        expect(box.y).toBeGreaterThanOrEqual(frameBox.y);
        expect(box.y + box.height).toBeLessThanOrEqual(
          frameBox.y + frameBox.height,
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
      const picker: Box = await documentBox(modePicker(page));
      const caption: Box = await documentBox(modeCaption(page));
      const send: Box = await documentBox(sendButton(page));
      expect(caption.x).toBeGreaterThan(picker.x + picker.width);
      expect(send.x).toBeGreaterThan(caption.x + caption.width - 1);
      expect(
        Math.abs(picker.y + picker.height / 2 - (send.y + send.height / 2)),
      ).toBeLessThanOrEqual(3);
      // The caption fits on one line of the row.
      expect(caption.height).toBeLessThanOrEqual(22);
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

      for (const mode of ["Ask for approval", "Read-only", "Auto-run"]) {
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

    test("the fix task and verdict messages are lines of their rows", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE, "fail=verdict,create-fix-task");
      const investigation: Locator = investigationCard(page);

      await investigation.getByRole("button", { name: OPEN_FIX_PR }).click();
      await investigation.getByRole("button", { name: "Confirmed" }).click();

      const fixError: Locator = investigation.getByTestId(
        "investigation-fix-task-error",
      );
      const verdictError: Locator = investigation.getByTestId(
        "investigation-verdict-error",
      );
      await expect(fixError).toContainText("Could not create the fix task");
      await expect(verdictError).toContainText("Could not save your verdict");

      // They were red alert boxes, the loudest things in the card.
      for (const notice of [fixError, verdictError]) {
        await expect(notice).toHaveAttribute("role", "alert");
        expect(await frameLook(notice)).toEqual(NO_FRAME);
      }
      expect(await panelsInsideTheCard(page)).toEqual([]);
    });

    test("a created fix task is a line with a green mark and a link to the task", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openReady(page, INCIDENT_PAGE);
      const investigation: Locator = investigationCard(page);

      await investigation.getByRole("button", { name: OPEN_FIX_PR }).click();

      const created: Locator = investigation.getByTestId(
        "investigation-fix-task-created",
      );
      await expect(created).toContainText("Fix task created");
      expect(await frameLook(created)).toEqual(NO_FRAME);
      // emerald-600.
      expect(
        await created
          .locator("svg")
          .first()
          .evaluate((icon: Element): string => {
            return window.getComputedStyle(icon).color;
          }),
      ).toBe("rgb(5, 150, 105)");
      await expect(
        created.getByRole("link", { name: "View task progress" }),
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

    test("the status pill sits beside the title when it fits and under it when it does not", async ({
      page,
    }: {
      page: Page;
    }) => {
      // "Completed" fits beside "AI Investigation".
      let investigation: Locator = await openCardState(page, CARD_STATES[0]!);
      let title: Box = await documentBox(
        investigation.getByRole("heading", { level: 2 }),
      );
      let pill: Box = await documentBox(
        investigation.getByLabel("Investigation status"),
      );
      let section: Box = await documentBox(conversation(page));

      expect(title.height).toBeLessThanOrEqual(26);
      expect(pill.x).toBeGreaterThan(title.x + title.width);
      expect(pill.y).toBeLessThan(title.y + title.height);
      // At the card's content edge, not centred under the title.
      expect(pill.x + pill.width).toBeCloseTo(section.x + section.width, 0);

      // "Preparing report…" does not: it goes under the title, at its left.
      investigation = await openCardState(page, CARD_STATES[7]!);
      title = await documentBox(
        investigation.getByRole("heading", { level: 2 }),
      );
      pill = await documentBox(
        investigation.getByLabel("Investigation status"),
      );
      section = await documentBox(conversation(page));

      // The title is never the one that gives way.
      expect(title.height).toBeLessThanOrEqual(26);
      expect(pill.x + pill.width).toBeLessThanOrEqual(
        section.x + section.width + 1,
      );
      if (pill.y >= title.y + title.height) {
        expect(pill.x).toBeCloseTo(title.x, 0);
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
  await expectRenderedText(header, eventPage.state);
  if (eventPage.severity) {
    await expectRenderedText(header, eventPage.severity);
  }
  await expectRenderedText(header, eventPage.duration);
  expect(await definitionPairs(header)).toEqual(eventPage.facts);
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

    // Narrow column: the title gets the full width, actions go underneath.
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
  await expectAbove(
    details.getByRole("heading", { level: 2 }),
    details.getByRole("button", { name: "Edit" }),
    "Edit sits under the title",
  );
  expect(await detailLabels(details)).toEqual(eventPage.detailLabels);
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
      // The step rail under the pills.
      await expectRenderedText(hero(page), "Created Acknowledged Resolved");
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
  }

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
    await expectRenderedText(
      hero(page),
      "Acknowledged SEV-2 Ongoing for 19 minutes",
    );
    expect(await statCells(page, INCIDENT_PAGE.statBar)).toEqual([
      INCIDENT_PAGE.stats[0],
      { label: "Resolved in", value: "Not yet resolved" },
      { label: "Duration", value: "19 minutes" },
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
    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    await expect(actions.getByRole("button")).toHaveCount(0);
    await expectRenderedText(hero(page), "Resolved SEV-2 Lasted 19 minutes");
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
      { label: "Acknowledged in", value: "Not yet acknowledged" },
      { label: "Resolved in", value: "Not yet resolved" },
      { label: "Duration", value: "14 minutes" },
    ]);

    await watchForSkeleton(page);
    await actions.getByRole("button", { name: "Acknowledge" }).click();
    const dialog: Locator = page.getByRole("dialog", {
      name: "Acknowledge Alert",
    });
    await expect(dialog).toBeVisible();
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
    await expectRenderedText(
      hero(page),
      "Acknowledged High Ongoing for 14 minutes",
    );
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

  test("?role=loading: Declare Incident is hidden until the permission snapshot arrives", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Without permissions the details card has nothing it may show.
    await openReady(page, ALERT_PAGE, `${CREATED_ALERT.query}&role=loading`, [
      REPORT_CAVEAT,
    ]);
    await expect(heroActions(page).getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
    ]);
    await expect(page.locator(`#${DECLARE_INCIDENT_BUTTON_ID}`)).toHaveCount(0);
    await expect(declareIncidentWrapper(page)).toHaveCount(0);
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
 * The hero's title row across widths
 * ---------------------------------------------------------------------------
 */

// Tailwind's xl breakpoint: from here the actions sit beside the title.
const XL: number = 1280;
// gap-3 between the title and the actions, stacked or side by side.
const TITLE_ACTIONS_GAP: number = 12;

// The hero's first row: the number and title, then the action group.
function heroTitleRow(page: Page): Locator {
  return heroActions(page).locator("xpath=..");
}

// The number and the title, the first child of the title row.
function heroTitleBlock(page: Page): Locator {
  return heroActions(page).locator("xpath=preceding-sibling::div[1]");
}

function heroTitle(page: Page): Locator {
  return hero(page).getByRole("heading", { level: 2 });
}

interface HeroTitleRowBoxes {
  // The title row spans the header's content box.
  row: Box;
  titleBlock: Box;
  title: Box;
  actions: Box;
}

async function heroTitleRowBoxes(page: Page): Promise<HeroTitleRowBoxes> {
  return {
    row: await documentBox(heroTitleRow(page)),
    titleBlock: await documentBox(heroTitleBlock(page)),
    title: await documentBox(heroTitle(page)),
    actions: await documentBox(heroActions(page)),
  };
}

/*
 * Below xl: the title has the whole row to itself and the actions take the
 * full width of their own rows under it.
 */
function expectActionsUnderTitle(boxes: HeroTitleRowBoxes): void {
  expect(
    Math.abs(boxes.titleBlock.x - boxes.row.x),
    "the title starts at the header's left edge",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.titleBlock.width - boxes.row.width),
    "the title block spans the header",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.title.width - boxes.row.width),
    "the title spans the header",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      boxes.actions.y -
        (boxes.titleBlock.y + boxes.titleBlock.height) -
        TITLE_ACTIONS_GAP,
    ),
    "the actions start one gap under the title",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.actions.x - boxes.row.x),
    "the actions start at the header's left edge",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.actions.width - boxes.row.width),
    "the actions span the header",
  ).toBeLessThanOrEqual(1);
}

/*
 * From xl: the title on the left and the actions on the right of one row,
 * their tops aligned, with at least a gap between them.
 */
function expectActionsBesideTitle(boxes: HeroTitleRowBoxes): void {
  expect(
    Math.abs(boxes.titleBlock.x - boxes.row.x),
    "the title starts at the header's left edge",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boxes.actions.y - boxes.titleBlock.y),
    "the actions are level with the top of the title block",
  ).toBeLessThanOrEqual(1);
  expect(
    boxes.actions.x - (boxes.titleBlock.x + boxes.titleBlock.width),
    "the gap between the title and the actions",
  ).toBeGreaterThanOrEqual(TITLE_ACTIONS_GAP - 1);
  expect(
    Math.abs(
      boxes.actions.x + boxes.actions.width - (boxes.row.x + boxes.row.width),
    ),
    "the actions end at the header's right edge",
  ).toBeLessThanOrEqual(1);
}

/*
 * The actions never squeeze the title: a title that does not show whole has
 * every pixel the row leaves it - the whole row under the actions below xl,
 * everything left of the actions (less the gap) from xl. Whether a given
 * title fits depends on the machine's fonts (CI's are wider than a Mac's),
 * so this pins the room the title gets, not that it fits.
 */
async function expectTitleNotSqueezed(
  page: Page,
  boxes: HeroTitleRowBoxes,
): Promise<void> {
  if (!(await isOverflowing(heroTitle(page)))) {
    return;
  }

  const isBeside: boolean = Math.abs(boxes.actions.y - boxes.titleBlock.y) <= 1;
  const room: number = isBeside
    ? boxes.actions.x - boxes.row.x - TITLE_ACTIONS_GAP
    : boxes.row.width;

  expect(
    boxes.titleBlock.width,
    "a truncated title has all the room the actions leave it",
  ).toBeGreaterThanOrEqual(room - 1);
}

interface HeroLayoutCase {
  // Test title.
  title: string;
  // Screenshot name, before the width.
  screenshot: string;
  eventPage: EventPage;
  query: string;
  // The hero's buttons, in order.
  labels: ReadonlyArray<string>;
  // The rows they wrap onto at each of HERO_WIDTHS, top to bottom.
  rows: Readonly<Record<number, ReadonlyArray<ReadonlyArray<string>>>>;
}

const ALL_CREATED_ALERT_ACTIONS: ReadonlyArray<string> = [
  ...CREATED_ALERT.stateActions,
  DECLARE_INCIDENT,
];

// ?title=long: Alert #311 with a title wider than the room beside its actions.
const ALERT_LONG_TITLE: string =
  "Payment webhook 5xx rate above 5% on the eu-west-1 checkout cluster";
const LONG_TITLE_ALERT_PAGE: EventPage = {
  ...ALERT_PAGE,
  pageTitle: `Alert - ${ALERT_LONG_TITLE}`,
  title: ALERT_LONG_TITLE,
};

/*
 * Measured with the fixture's side menu (224px from 768px, 256px from
 * 1024px). The header's content is 292px wide at 390px, 374px at 768px,
 * 578px at 1024px and 834px at 1280px; the buttons need 145px
 * (Acknowledge), 112px (Resolve) and 164px (Declare Incident) at sm and up.
 *
 * - 390px (phone): the buttons grow to fill their rows. Acknowledge and
 *   Resolve share the first row and Declare Incident takes the whole second.
 * - 768px: the three need 437px with their gaps, so Declare Incident wraps
 *   onto a second row, right-aligned.
 * - 1024px: one row under the title.
 * - 1280px (xl): one row beside the title, which fits beside them (the
 *   long-title tests below cover one that does not).
 */
const HERO_LAYOUT_CASES: ReadonlyArray<HeroLayoutCase> = [
  {
    title: "created alert",
    screenshot: "alert-hero-created",
    eventPage: ALERT_PAGE,
    query: CREATED_ALERT.query,
    labels: ALL_CREATED_ALERT_ACTIONS,
    rows: {
      390: [["Acknowledge", "Resolve"], [DECLARE_INCIDENT]],
      768: [["Acknowledge", "Resolve"], [DECLARE_INCIDENT]],
      1024: [ALL_CREATED_ALERT_ACTIONS],
      1280: [ALL_CREATED_ALERT_ACTIONS],
    },
  },
  {
    title: "resolved alert",
    screenshot: "alert-hero-resolved",
    eventPage: ALERT_PAGE,
    query: RESOLVED_ALERT.query,
    labels: [DECLARE_INCIDENT],
    rows: {
      390: [[DECLARE_INCIDENT]],
      768: [[DECLARE_INCIDENT]],
      1024: [[DECLARE_INCIDENT]],
      1280: [[DECLARE_INCIDENT]],
    },
  },
  {
    title: "created incident",
    screenshot: "incident-hero-created",
    eventPage: INCIDENT_PAGE,
    query: "state=created",
    labels: ["Acknowledge", "Resolve"],
    rows: {
      390: [["Acknowledge", "Resolve"]],
      768: [["Acknowledge", "Resolve"]],
      1024: [["Acknowledge", "Resolve"]],
      1280: [["Acknowledge", "Resolve"]],
    },
  },
];

test.describe("the hero's title row across widths", () => {
  /*
   * At each width the actions stay whole and inside the card, keep their
   * order when they wrap and line up on the right. Below xl the title keeps
   * the whole row (next to a side menu, sharing it squeezed the title down to
   * a few characters and stacked the actions one per row); from xl the
   * actions sit beside it.
   */
  for (const layoutCase of HERO_LAYOUT_CASES) {
    for (const width of HERO_WIDTHS) {
      const isBeside: boolean = width >= XL;
      test(`${layoutCase.title} hero at ${width}px: the actions sit ${
        isBeside ? "beside" : "under"
      } the title, inside the header`, async ({ page }: { page: Page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openReady(page, layoutCase.eventPage, layoutCase.query);

        const header: Locator = hero(page);
        const actions: Locator = heroActions(page);
        const labels: Array<string> = [...layoutCase.labels];
        await expect(actions.getByRole("button")).toHaveText(labels);
        await expect(heroTitle(page)).toHaveText(layoutCase.eventPage.title);

        const headerBox: Box = await documentBox(header);
        for (const label of labels) {
          const button: Locator = heroActionButton(page, label);
          await expect(button).toBeVisible();
          const box: Box = await documentBox(button);
          expect(
            box.x,
            `${label} starts inside the header`,
          ).toBeGreaterThanOrEqual(headerBox.x);
          expect(
            box.x + box.width,
            `${label} ends inside the header`,
          ).toBeLessThanOrEqual(headerBox.x + headerBox.width);
          expect(
            box.y + box.height,
            `${label} ends inside the header`,
          ).toBeLessThanOrEqual(headerBox.y + headerBox.height);
          await expect(button).toHaveCSS("height", "36px");
          expect(
            await isOverflowing(button.locator("span.truncate")),
            `${label} is cut off`,
          ).toBe(false);
        }

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

        const boxes: HeroTitleRowBoxes = await heroTitleRowBoxes(page);
        // Every row ends at the right edge of the action group.
        for (const row of rows) {
          const last: Box = await documentBox(
            heroActionButton(page, row[row.length - 1]!),
          );
          expect(
            Math.abs(
              last.x + last.width - (boxes.actions.x + boxes.actions.width),
            ),
            `row "${row.join(", ")}" is right-aligned`,
          ).toBeLessThanOrEqual(1);
        }

        if (isBeside) {
          expectActionsBesideTitle(boxes);
        } else {
          expectActionsUnderTitle(boxes);
        }

        await expectTitleNotSqueezed(page, boxes);

        if (width === 390 && rows[rows.length - 1]!.length === 1) {
          // On a phone a button alone on its row fills it.
          const lastBox: Box = await documentBox(
            heroActionButton(page, rows[rows.length - 1]![0]!),
          );
          expect(Math.abs(lastBox.x - boxes.actions.x)).toBeLessThanOrEqual(1);
          expect(
            Math.abs(lastBox.width - boxes.actions.width),
          ).toBeLessThanOrEqual(1);
        }

        await expectNoHorizontalOverflow(page);

        await page.mouse.move(0, 0);
        await screenshotElement(header, `${layoutCase.screenshot}-${width}`);
      });
    }
  }

  test("the actions move beside the title at xl (1280px), not a pixel earlier", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: XL - 1, height: 900 });
    await openReady(page, ALERT_PAGE, CREATED_ALERT.query);

    // 1279px: the widest header that still stacks.
    const stackedBoxes: HeroTitleRowBoxes = await heroTitleRowBoxes(page);
    expectActionsUnderTitle(stackedBoxes);
    expect(await heroActionRows(page)).toEqual([ALL_CREATED_ALERT_ACTIONS]);
    await expectTitleNotSqueezed(page, stackedBoxes);
    const stackedHeight: number = (await documentBox(hero(page))).height;

    // One more pixel and the same page lays the row out side by side.
    await page.setViewportSize({ width: XL, height: 900 });
    await expect
      .poll(async (): Promise<number> => {
        const boxes: HeroTitleRowBoxes = await heroTitleRowBoxes(page);
        return Math.round(boxes.actions.y - boxes.titleBlock.y);
      })
      .toBe(0);
    const besideBoxes: HeroTitleRowBoxes = await heroTitleRowBoxes(page);
    expectActionsBesideTitle(besideBoxes);
    expect(await heroActionRows(page)).toEqual([ALL_CREATED_ALERT_ACTIONS]);
    await expectTitleNotSqueezed(page, besideBoxes);
    // The actions' own row is gone: the header is 48px shorter.
    expect(
      stackedHeight - (await documentBox(hero(page))).height,
      "height saved beside the title",
    ).toBeCloseTo(36 + TITLE_ACTIONS_GAP, 0);
  });

  test("a long alert title below xl keeps its own row, truncated there, and the actions keep theirs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openReady(
      page,
      LONG_TITLE_ALERT_PAGE,
      `${CREATED_ALERT.query}&title=long`,
    );
    await expect(heroTitle(page)).toHaveText(ALERT_LONG_TITLE);
    await expect(heroActions(page).getByRole("button")).toHaveText([
      ...ALL_CREATED_ALERT_ACTIONS,
    ]);

    const boxes: HeroTitleRowBoxes = await heroTitleRowBoxes(page);
    expectActionsUnderTitle(boxes);
    expect(await heroActionRows(page)).toEqual([ALL_CREATED_ALERT_ACTIONS]);
    // Wider than the header: cut at its full width, whole in its tooltip.
    expect(await isOverflowing(heroTitle(page)), "title truncated").toBe(true);
    await expectTitleNotSqueezed(page, boxes);
    await heroTitle(page).hover();
    await expect(page.getByRole("tooltip")).toHaveText(ALERT_LONG_TITLE);
    await expectNoHorizontalOverflow(page);
  });

  test("a long alert title at xl is truncated rather than pushing an action onto a second row", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Beside the title (xl and up) the action group keeps its width
     * (xl:shrink-0): a title wider than the room left beside the actions
     * truncates instead of squeezing the group until an action wraps.
     */
    await page.setViewportSize({ width: XL, height: 900 });
    await openReady(
      page,
      LONG_TITLE_ALERT_PAGE,
      `${CREATED_ALERT.query}&title=long`,
    );
    await expect(heroActions(page).getByRole("button")).toHaveText([
      ...ALL_CREATED_ALERT_ACTIONS,
    ]);
    expect(
      await heroActionRows(page),
      "the actions' rows beside a long title",
    ).toEqual([ALL_CREATED_ALERT_ACTIONS]);
    const boxes: HeroTitleRowBoxes = await heroTitleRowBoxes(page);
    expectActionsBesideTitle(boxes);
    // Cut, but with every pixel left of the actions.
    expect(await isOverflowing(heroTitle(page)), "title truncated").toBe(true);
    await expectTitleNotSqueezed(page, boxes);
  });

  test("on a phone an acknowledged alert keeps Declare Incident's whole label", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * Phone buttons grow from their own width (flex-auto) rather than
     * splitting the 292px row evenly, which cut "Declare Incident" to 142px
     * of the 164px it needs.
     */
    await page.setViewportSize({ width: 390, height: 900 });
    await openReady(page, ALERT_PAGE, ACKNOWLEDGED_ALERT.query);
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
      await expectRenderedText(header, `${phase.state} ${phase.duration}`);
      expect(await definitionPairs(header)).toEqual(
        SCHEDULED_MAINTENANCE_PAGE.facts,
      );

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
    await dialog
      .getByTestId("modal-footer")
      .getByRole("button", { name: "Mark as Ongoing", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);

    await expectRenderedText(hero(page), "Ongoing In progress for");
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
  // How the members card reads its rows.
  memberModel: string;
  episodeIdField: string;
  sortField: string;
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
    memberModel: "Incident",
    episodeIdField: "incidentEpisodeId",
    sortField: "declaredAt",
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
        number: "#1038",
        title: "Cart service 5xx rate above 2%",
        href: incidentPath(1038),
        severity: "SEV-3",
      },
    ],
  },
  {
    page: ALERT_EPISODE_PAGE,
    memberModel: "Alert",
    episodeIdField: "alertEpisodeId",
    sortField: "createdAt",
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

      // Newest first, up to eight, filtered to this episode.
      const list: RecordedModelRequest | undefined = (
        await fixture(page)
      ).listRequests.find((request: RecordedModelRequest): boolean => {
        return (
          request.modelName === episode.memberModel &&
          Object.keys(request.query || {}).includes(episode.episodeIdField) &&
          request.limit === 8
        );
      });
      expect(list, "members preview request").toBeDefined();
      expect(list?.skip).toBe(0);
      expect(list?.sort).toEqual({ [episode.sortField]: "DESC" });
      expect(JSON.stringify(list?.query)).toContain(
        eventPage === INCIDENT_EPISODE_PAGE
          ? INCIDENT_EPISODE_ID
          : ALERT_EPISODE_ID,
      );

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
      await expect(
        details.getByRole("button", { name: /^[0-9a-f-]{36}$/ }),
      ).toHaveText(
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
        hero(page),
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
        hero(page),
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
      "Incident - Orders DB connection pool saturated",
    );
    await expect(hero(page)).toContainText("#1040");
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
      "Incident - Checkout API p95 latency above 2s",
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
     * Phones shorten "Evidence checked" to "Evidence" so both tabs share one
     * row; the count still follows the name.
     */
    const evidenceTab: Locator = detailsTab(page, "Evidence");
    const activityTab: Locator = detailsTab(page, "Activity");
    await expect(evidenceTab).toHaveAccessibleName("Evidence 10");
    const evidenceBox: Box = await documentBox(evidenceTab);
    const activityBox: Box = await documentBox(activityTab);
    expect(
      Math.abs(evidenceBox.y - activityBox.y),
      "tabs share a row",
    ).toBeLessThanOrEqual(1);
    expect(activityBox.x).toBeGreaterThan(evidenceBox.x + evidenceBox.width);
  });

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

  // Every state of the card, for review: one flat card in each.
  test("AI investigation card states", async ({ page }: { page: Page }) => {
    const states: ReadonlyArray<{ file: string; state: CardState }> = [
      { file: "ai-card-running", state: CARD_STATES[3]! },
      { file: "ai-card-running-clusters", state: CARD_STATES[4]! },
      { file: "ai-card-queued", state: CARD_STATES[5]! },
      { file: "ai-card-failed", state: CARD_STATES[6]! },
      { file: "ai-card-pending", state: CARD_STATES[7]! },
      { file: "ai-card-none", state: CARD_STATES[8]! },
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
          name: "AI Investigation",
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
