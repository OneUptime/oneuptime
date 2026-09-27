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
    "Investigation complete",
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
    "Investigation complete",
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
  test("the summary is its own section above the report", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openReady(page, INCIDENT_PAGE);

    const investigation: Locator = investigationCard(page);
    await expect(
      investigation.getByLabel("Investigation status"),
    ).toContainText("Investigation complete");
    await expect(investigation).toContainText(
      "OneUptime AI's root-cause report for this incident.",
    );

    const summary: Locator = summarySection(page);
    await expect(summary.getByRole("heading", { level: 3 })).toHaveText(
      "Summary",
    );
    await expect(summary.getByText("TL;DR", { exact: true })).toBeVisible();
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
    await expect(report.getByRole("heading", { level: 3 })).toHaveText(
      "Investigation report",
    );
    /*
     * The header's own line says the report is an AI first pass, so there is
     * no separate "AI generated" pill beside Copy report.
     */
    await expect(
      report.getByText("AI-generated first pass — verify before acting.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(report.getByText("AI generated", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      report.getByRole("button", { name: "Copy report" }),
    ).toBeVisible();

    await expect(report.getByRole("heading", { level: 4 })).toHaveText([
      "Most likely root cause",
      "Evidence",
      "Suggested next steps",
    ]);
    // The Summary was lifted out, not repeated.
    await expect(report.getByRole("heading", { name: "Summary" })).toHaveCount(
      0,
    );

    const rootCause: Locator = report.locator(
      "section[data-section-kind='RootCause']",
    );
    await expect(rootCause).toHaveClass(/border-amber-200/);
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

    // #1029 has no investigation: neither the card nor the header summary.
    await expect(card(page, "Incident Feed")).toBeVisible();
    await expect(investigationCard(page)).toHaveCount(0);
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
      name: "Rate this investigation",
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
      .getByRole("group", { name: "Rate this investigation" })
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
      name: "Rate this investigation",
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
      reportSection(page).getByRole("heading", { level: 4 }),
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
      "Preparing investigation report…",
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
    badge: "Queued — waiting for a worker…",
    bodyTexts: [
      "OneUptime AI is investigating",
      "Waiting for a worker to pick this up.",
    ],
    headerText: "AI investigation queued",
    hasDetails: false,
  },
  {
    ai: "failed",
    badge: "Investigation did not finish",
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
    badge: "Preparing investigation report…",
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
      await expect(
        investigation.getByText("Rate this investigation"),
      ).toHaveCount(0);
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

  test("?ai=none renders no investigation card and no header notice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENT_PATH, "ai=none");
    await expect(card(page, "Incident Feed")).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText("Rolling checkout-api back").first(),
    ).toBeVisible();
    await expect(investigationCard(page)).toHaveCount(0);
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
      "Investigation complete",
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
