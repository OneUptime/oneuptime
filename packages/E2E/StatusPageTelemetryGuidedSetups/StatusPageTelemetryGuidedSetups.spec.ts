import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE STATUS PAGE AND TELEMETRY GUIDED SETUPS, LOOKED AT (#7143): "Publish
 * a status page" and "Send logs, metrics and traces, then get alerted" in
 * the real Dashboard, over the journeys' fixture (Journeys/Fixture,
 * Journeys/README.md): a project kept in memory, with nothing leaving the
 * machine.
 *
 * jsdom (Common/Tests/App/Dashboard/StatusPageGuidedSetup.test.tsx and
 * TelemetryGuidedSetup.test.tsx) holds what each step does; the journeys
 * status-page-guided and first-telemetry-guided count what each job costs.
 * Neither looks at the page. Here each step of both setups and their
 * summaries are walked and drawn at 1280 and 390 pixels, light and dark, in
 * German and in Persian (right to left), as a new project and as a busy one
 * (?seed=busy: a hundred monitors carrying labels, three monitor groups,
 * two status pages, five services that report). No step reaches past the
 * window, and each is kept as a picture under
 * output/playwright/status-page-telemetry-guided-setups-ui.
 *
 * On the way: the busy project's status pages offered first (#7517), its
 * list searched, narrowed by a label and given a monitor group (#7147); the
 * ways in from Status Pages and Logs (#7142); Logs' setup dialog beside the
 * setup, with its test log (#7760) and its View logs to the service's Logs,
 * which offers Create monitor (#6876); the monitor the website setup hands
 * in; and a Project Viewer, who is offered neither setup.
 */

const PORT: string =
  process.env["STATUS_PAGE_TELEMETRY_GUIDED_SETUPS_FIXTURE_PORT"] || "4866";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const DASHBOARD: string = `/dashboard/${PROJECT}`;
const STATUS_PAGE_SETUP: string = `${DASHBOARD}/status-pages/setup`;
const TELEMETRY_SETUP: string = `${DASHBOARD}/service/setup`;
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
// Where the Dashboard keeps the reader's language (DashboardLanguage.ts).
const LANGUAGE_KEY: string = "oneuptimeLang";
// ?seed=monitor's website monitor (Journeys/Fixture/NewProject.js).
const MONITOR_ID: string = "50000000-0000-4000-8000-000000000001";
// The service a new project's app reports as (Journeys/Fixture/NewProject.js).
const NEW_SERVICE: string = "50000000-0000-4000-8000-000000000002";
// The secret the fixture's server gives every new ingestion key.
const NEW_KEY_SECRET: string = "a0000000-0000-4000-8000-000000006831";
// ?seed=busy's records (Journeys/Fixture/NewProject.js).
const BUSY_OLDER_PAGE: string = "Acme Commerce Status";
const BUSY_NEWER_PAGE: string = "Acme Partner Status";
const BUSY_STOREFRONT_GROUP: string = "62000000-0000-4000-8000-000000000003";
const BUSY_PAYMENTS_SERVICE: string = "65000000-0000-4000-8000-000000000003";
const SHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/status-page-telemetry-guided-setups-ui",
);
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Language = "de" | "fa";
type Theme = "light" | "dark";

interface Look {
  lang: Language;
  theme: Theme;
  width: number;
}

// A write the fixture's server kept (Journeys/Fixture/Store.js).
interface FixtureWrite {
  kind: "create" | "update" | "delete";
  table: string;
  data: Record<string, unknown>;
}

// An id as it was written: a string, or an ObjectID as JSON.
function idOf(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value).toLowerCase();
  }
  return String(value).toLowerCase();
}

const tables: Map<Language, Record<string, string>> = new Map();

// The Dashboard's English words as this language draws them.
function words(lang: Language, english: string): string {
  let table: Record<string, string> | undefined = tables.get(lang);

  if (!table) {
    table = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${lang}.json`), "utf8"),
    ) as Record<string, string>;
    tables.set(lang, table);
  }

  return table[english] || english;
}

const pageErrors: Array<string> = [];
const leftTheMachine: Array<string> = [];

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.length = 0;
  leftTheMachine.length = 0;
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await page.route(
    (url: URL) => {
      return url.origin !== ORIGIN;
    },
    async (route: Route) => {
      leftTheMachine.push(route.request().url());
      await route.abort();
    },
  );
  await page.clock.setFixedTime(NOW);
});

test.afterEach(() => {
  expect(pageErrors, "the product threw").toEqual([]);
  expect(leftTheMachine, "a request left this machine").toEqual([]);
});

function nameOf(look: Look): string {
  return `${look.lang}-${look.theme}-${look.width}`;
}

// A page of the Dashboard, in this look, for the fixture's query (who, seeds).
async function open(
  page: Page,
  look: Look,
  address: string,
  query: Record<string, string> = {},
): Promise<void> {
  await page.setViewportSize({ width: look.width, height: 900 });
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A page that cannot keep it draws English, and the checks say so.
      }
    },
    { key: LANGUAGE_KEY, value: look.lang },
  );
  const search: URLSearchParams = new URLSearchParams({
    ...query,
    theme: look.theme,
  });

  await page.goto(`${ORIGIN}${address}?${search.toString()}`);

  // The look asked for, not one the page fell back to.
  const html: Locator = page.locator("html");

  if (look.theme === "dark") {
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  } else {
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  }

  await expect(html).toHaveAttribute("dir", look.lang === "fa" ? "rtl" : "ltr");
}

async function openSetup(
  page: Page,
  look: Look,
  address: string,
  query: Record<string, string> = {},
): Promise<void> {
  await open(page, look, address, query);
  await expect(page.getByTestId("guided-setup")).toBeVisible();
}

function step(page: Page, key: string): Locator {
  return page.getByTestId(`guided-setup-step-${key}`);
}

/*
 * The page as it is now: nothing reaches past the window, and a picture of
 * the whole page, named for the look, the setup and the moment, taken from
 * the top so the sticky header is drawn where it belongs.
 */
async function look(page: Page, look: Look, moment: string): Promise<void> {
  await expectNoSidewaysScroll(page, {
    message: `${nameOf(look)}, ${moment}`,
  });
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS, `${nameOf(look)}-${moment}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function writesTo(
  page: Page,
  table: string,
  kind: FixtureWrite["kind"] = "create",
): Promise<Array<FixtureWrite>> {
  const writes: Array<FixtureWrite> = await page.evaluate(() => {
    return (
      window as unknown as { __journeyFixture: { writes: Array<FixtureWrite> } }
    ).__journeyFixture.writes;
  });

  return writes.filter((write: FixtureWrite) => {
    return write.table === table && write.kind === kind;
  });
}

// An option of the picker inside `within`, by its name (a record's: as written).
async function pickOption(
  page: Page,
  within: Locator,
  name: string,
): Promise<void> {
  await within.getByRole("combobox").click();
  await page.getByRole("option", { name: name, exact: true }).click();
}

const LOOKS: Array<Look> = [];

for (const lang of ["de", "fa"] as Array<Language>) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    for (const width of [1280, 390]) {
      LOOKS.push({ lang, theme, width });
    }
  }
}

/*
 * PUBLISH A STATUS PAGE, AS A NEW PROJECT: the website monitor is the one
 * thing to show (?seed=monitor). The name, the monitor ticked, the page
 * made; what customers see; the summary.
 */
for (const each of LOOKS) {
  test(`status page setup, ${nameOf(each)}: every step and the summary fit the window`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSetup(page, each, STATUS_PAGE_SETUP, { seed: "monitor" });

    // 1. Name it, and pick what it shows: today's step, none ticked.
    await expect(step(page, "pick")).toHaveAttribute("data-state", "open");
    // The name starts as the project's, in the reader's words.
    await expect(page.getByTestId("guided-setup-status-page-name")).toHaveValue(
      words(each.lang, "{{project}} Status").replace(
        "{{project}}",
        "Acme Commerce",
      ),
    );
    await expect(page.getByTestId("guided-setup-existing-pages")).toHaveCount(
      0,
    );
    await expect(
      page.getByTestId(`guided-setup-monitor-${MONITOR_ID}`),
    ).not.toBeChecked();
    // One monitor: no search, no label to pick.
    await expect(page.getByTestId("guided-setup-search")).toHaveCount(0);
    await look(page, each, "status-page-1-pick");

    await page.getByTestId(`guided-setup-monitor-${MONITOR_ID}`).check();
    await page.getByTestId("guided-setup-create-status-page").click();

    // 2. This is what your customers see.
    await expect(step(page, "review")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("guided-setup-preview")).toContainText(
      "Acme website",
    );
    await look(page, each, "status-page-2-review");
    await page.getByTestId("guided-setup-review-continue").click();

    // The summary.
    await expect(page.getByTestId("guided-setup-summary")).toBeVisible();
    await look(page, each, "status-page-3-summary");

    expect(await writesTo(page, "StatusPage")).toHaveLength(1);
    expect(await writesTo(page, "StatusPageResource")).toHaveLength(1);
  });
}

/*
 * SEND LOGS, METRICS AND TRACES, THEN GET ALERTED, AS A NEW PROJECT: the
 * guide's ingestion key, made in its dialog; the first data arrives (the
 * person's app sends its traces, metrics and logs as the key is made) and
 * the setup goes on to the service that reported; the four monitors
 * recommended for that data (#7146), made in one click.
 */
for (const each of LOOKS) {
  test(`telemetry setup, ${nameOf(each)}: every step and the summary fit the window`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSetup(page, each, TELEMETRY_SETUP);

    // 1. Send your first data: the guide, and the step that waits.
    await expect(step(page, "send")).toHaveAttribute("data-state", "open");
    await expect(
      page.getByTestId("guided-setup-reporting-services"),
    ).toHaveCount(0);
    await look(page, each, "telemetry-1-send");

    await step(page, "send")
      .getByRole("button", {
        name: words(each.lang, "Create Ingestion Key"),
        exact: true,
      })
      .click();
    const dialog: Locator = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await look(page, each, "telemetry-1-send-key-dialog");
    await dialog.getByTestId("modal-footer-submit-button").click();
    await expect(dialog).toHaveCount(0);

    // 2. Get alerted: the step the first data opens, every monitor ticked.
    await expect(step(page, "alert")).toHaveAttribute("data-state", "open", {
      timeout: 30000,
    });
    await expect(
      page.getByTestId("guided-setup-create-monitors"),
    ).toBeEnabled();
    await look(page, each, "telemetry-2-alert");
    await page.getByTestId("guided-setup-create-monitors").click();

    // The summary: the monitors made, and who is told.
    await expect(page.getByTestId("guided-setup-summary")).toBeVisible();
    await expect(
      page.getByTestId("guided-setup-summary-watched-by").getByRole("link"),
    ).toHaveCount(4);
    await look(page, each, "telemetry-3-summary");

    expect(await writesTo(page, "TelemetryIngestionKey")).toHaveLength(1);
    expect(await writesTo(page, "Monitor")).toHaveLength(4);
  });
}

/*
 * A BUSY PROJECT'S STATUS PAGE (#7517, #7147): its status pages are offered
 * first, the newest picked; the older one is picked instead, and what it
 * shows is marked on the list. The list is searched, given a monitor group,
 * narrowed by a label and selected whole; the monitors go on the page
 * picked, and no page is made.
 */
for (const each of [
  { lang: "de", theme: "light", width: 1280 },
  { lang: "fa", theme: "dark", width: 390 },
] as Array<Look>) {
  test(`status page setup, a busy project, ${nameOf(each)}: the project's pages first, then a search, a group and a label`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSetup(page, each, STATUS_PAGE_SETUP, { seed: "busy" });

    // The project's two pages, counted; the newest picked; no name asked.
    await expect(page.getByTestId("guided-setup-existing-pages")).toBeVisible();
    await expect(page.getByTestId("guided-setup-existing-page")).toContainText(
      BUSY_NEWER_PAGE,
    );
    await expect(page.getByTestId("guided-setup-status-page-name")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("guided-setup-make-new-page")).toBeVisible();
    await expect(page.getByTestId("guided-setup-picked-count")).toContainText(
      each.lang === "fa" ? "۱۰۳" : "103",
    );
    await look(page, each, "busy-status-page-1-offer");

    // The older page: what it shows is On the page, locked.
    await pickOption(
      page,
      page.getByTestId("guided-setup-existing-page"),
      BUSY_OLDER_PAGE,
    );
    await expect(
      page.getByRole("checkbox", { name: "Checkout us-east" }),
    ).toBeDisabled();
    await expect(page.getByTestId("guided-setup-picked-count")).toContainText(
      each.lang === "fa" ? "۱۰۱" : "101",
    );

    // A search by name.
    await page.getByTestId("guided-setup-search").fill("checkout");
    await expect(
      page.getByTestId("guided-setup-monitors").getByRole("checkbox"),
    ).toHaveCount(5);
    await look(page, each, "busy-status-page-1-search");
    await page.getByTestId("guided-setup-search").fill("");

    // A monitor group, added as one row.
    await page
      .getByTestId(`guided-setup-monitor-group-${BUSY_STOREFRONT_GROUP}`)
      .check();

    // A label, and Select all: what carries it, less what the page shows.
    await pickOption(
      page,
      page.getByTestId("guided-setup-label-filter"),
      "team-payments",
    );
    await expect(
      page.getByTestId("guided-setup-monitors").getByRole("checkbox"),
    ).toHaveCount(12);
    await page.getByTestId("guided-setup-select-all").click();
    await expect(page.getByTestId("guided-setup-picked-count")).toContainText(
      each.lang === "fa" ? "۱۱" : "11",
    );
    await look(page, each, "busy-status-page-1-label");

    await page.getByTestId("guided-setup-create-status-page").click();

    // 2. What customers see: the page picked, with what it shows now.
    await expect(step(page, "review")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("guided-setup-preview-name")).toHaveText(
      BUSY_OLDER_PAGE,
    );
    await expect(page.getByTestId("guided-setup-preview")).toContainText(
      "Storefront",
    );
    await look(page, each, "busy-status-page-2-review");
    await page.getByTestId("guided-setup-review-continue").click();
    await expect(page.getByTestId("guided-setup-summary")).toBeVisible();
    await look(page, each, "busy-status-page-3-summary");

    // No page made: ten monitors and the group went on the page picked.
    expect(await writesTo(page, "StatusPage")).toHaveLength(0);
    const resources: Array<FixtureWrite> = await writesTo(
      page,
      "StatusPageResource",
    );
    expect(resources).toHaveLength(11);
    expect(
      resources.filter((resource: FixtureWrite) => {
        return Boolean(resource.data["monitorGroupId"]);
      }),
    ).toHaveLength(1);
  });
}

/*
 * A BUSY PROJECT'S TELEMETRY: five services report already, so the setup
 * offers each by name; one is picked, and its monitors are made.
 */
for (const each of [
  { lang: "de", theme: "dark", width: 1280 },
  { lang: "fa", theme: "light", width: 390 },
] as Array<Look>) {
  test(`telemetry setup, a busy project, ${nameOf(each)}: a service that reports already, then its monitors`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSetup(page, each, TELEMETRY_SETUP, { seed: "busy" });

    const reporting: Locator = page.getByTestId(
      "guided-setup-reporting-services",
    );

    await expect(reporting).toBeVisible();
    await expect(reporting.getByRole("button")).toHaveCount(5);
    await look(page, each, "busy-telemetry-1-send");

    await page
      .getByTestId(`guided-setup-use-service-${BUSY_PAYMENTS_SERVICE}`)
      .click();
    await expect(step(page, "alert")).toHaveAttribute("data-state", "open");
    await expect(
      page.getByTestId("guided-setup-create-monitors"),
    ).toBeEnabled();
    await look(page, each, "busy-telemetry-2-alert");
    await page.getByTestId("guided-setup-create-monitors").click();

    await expect(page.getByTestId("guided-setup-summary")).toContainText(
      "payments-api",
    );
    await look(page, each, "busy-telemetry-3-summary");

    expect(await writesTo(page, "Monitor")).toHaveLength(3);
    expect(await writesTo(page, "TelemetryIngestionKey")).toHaveLength(0);
  });
}

/*
 * THE WAYS IN (#7142): a new project's empty Status Pages list and its Logs
 * offer their guided setup as the one primary button, the manual way
 * beside it; each opens its setup in one click.
 */
test("the ways in: Status Pages and Logs open their guided setups in one click", async ({
  page,
}: {
  page: Page;
}) => {
  const statusPagesLook: Look = { lang: "de", theme: "light", width: 1280 };

  await open(page, statusPagesLook, `${DASHBOARD}/status-pages`);
  const statusPagesShowcase: Locator = page.getByTestId("product-showcase");
  const setup: Locator = statusPagesShowcase.getByTestId(
    "resource-showcase-setup-button",
  );

  await expect(setup).toHaveText(words("de", "Guided setup"));
  await expect(
    statusPagesShowcase.getByTestId("resource-showcase-add-button"),
  ).toHaveText(words("de", "Create Status Page"));
  await look(page, statusPagesLook, "ways-in-status-pages");
  await setup.click();
  await expect(page).toHaveURL(/\/status-pages\/setup\?from=empty_list$/);
  await expect(page.getByTestId("guided-setup")).toBeVisible();

  const logsLook: Look = { lang: "fa", theme: "dark", width: 390 };

  await open(page, logsLook, `${DASHBOARD}/logs`);
  const logsShowcase: Locator = page.getByTestId("product-showcase");

  await expect(
    logsShowcase.getByTestId("resource-showcase-add-button"),
  ).toHaveText(words("fa", "Send your first logs"));
  await look(page, logsLook, "ways-in-logs");
  await logsShowcase.getByTestId("resource-showcase-setup-button").click();
  await expect(page).toHaveURL(/\/service\/setup\?from=empty_list$/);
  await expect(page.getByTestId("guided-setup")).toBeVisible();
});

/*
 * LOGS' SETUP DIALOG, BESIDE THE GUIDED SETUP: the key made in it, its test
 * log under the endpoint and the key (#7760) - folded to one line, and
 * opened, a command that fits the dialog - then the first data, and View
 * logs to the service's own Logs, which offers Create monitor for that
 * service (#6876): the next step, without going back to Logs.
 */
for (const each of [
  { lang: "de", theme: "light", width: 1280 },
  { lang: "fa", theme: "dark", width: 390 },
] as Array<Look>) {
  test(`Logs' setup dialog, ${nameOf(each)}: a test log beside the key, then View logs, where Create monitor watches the service`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, each, `${DASHBOARD}/logs`);
    await page
      .getByTestId("product-showcase")
      .getByTestId("resource-showcase-add-button")
      .click();

    const setup: Locator = page.getByTestId("telemetry-setup-dialog");

    await expect(setup).toBeVisible();
    // No key yet: nothing to send a test log with.
    await expect(setup.getByTestId("telemetry-test-log")).toHaveCount(0);

    await setup
      .getByRole("button", {
        name: words(each.lang, "Create Ingestion Key"),
        exact: true,
      })
      .click();
    const keyForm: Locator = page.getByRole("dialog").last();
    await keyForm.getByTestId("modal-footer-submit-button").click();
    await expect(page.getByRole("dialog")).toHaveCount(1);

    // The key's step: the test log, folded to one line under it.
    const fold: Locator = setup.getByTestId("telemetry-test-log");

    await expect(fold).toBeVisible();
    await expect(fold).toContainText(words(each.lang, "Send a test log"));
    await expect(setup.getByTestId("telemetry-test-log-body")).toHaveCount(0);

    await setup.getByTestId("telemetry-test-log-toggle").click();
    const body: Locator = setup.getByTestId("telemetry-test-log-body");

    await expect(body).toContainText(`/otlp/v1/logs`);
    await expect(body).toContainText(`x-oneuptime-token: ${NEW_KEY_SECRET}`);
    await expect(body).toContainText("oneuptime-test");
    await body.scrollIntoViewIfNeeded();
    await look(page, each, "logs-dialog-test-log");

    // The app's first data: its service reports, and View logs leads to it.
    const connected: Locator = setup.getByTestId(
      "resource-connection-connected",
    );

    await expect(connected).toBeVisible({ timeout: 30000 });
    await connected.getByRole("link").click();
    await expect(page).toHaveURL(
      new RegExp(`/service/${NEW_SERVICE}/logs(\\?|$)`),
    );
    await expect(page.getByTestId("telemetry-setup-dialog")).toHaveCount(0);

    // The service's Logs: Create monitor, for a Logs monitor on this service.
    const createMonitor: Locator = page.getByTestId("logs-create-monitor");

    await expect(createMonitor).toBeVisible();
    // In words beside the side menu, never a bell found by hovering (#9455).
    await expect(createMonitor).toHaveText(words(each.lang, "Create monitor"));
    await look(page, each, "logs-service-create-monitor");
    await createMonitor.click();

    await expect(page).toHaveURL(/\/monitors\/create\?/);
    const created: URL = new URL(page.url());

    expect(created.searchParams.get("monitorType")).toBe("Logs");
    expect(
      JSON.parse(created.searchParams.get("telemetryQuery") || "{}"),
    ).toMatchObject({ serviceIds: [NEW_SERVICE] });
  });
}

/*
 * THE MONITOR THE WEBSITE SETUP HANDS IN (#7053): with no status page yet,
 * its summary's "Show it on a status page" opens this setup with the new
 * monitor ticked, and nothing else; Create the status page puts it on.
 */
test("the website setup's summary opens the status page setup with its monitor ticked", async ({
  page,
}: {
  page: Page;
}) => {
  const each: Look = { lang: "de", theme: "light", width: 1280 };

  await openSetup(page, each, `${DASHBOARD}/monitors/setup`);
  await page
    .getByTestId("guided-setup-address")
    .fill("https://acme-commerce.example");
  await page.getByTestId("guided-setup-start-checking").click();
  await page.getByTestId("guided-setup-check-continue").click();
  await page.getByTestId("guided-setup-who-continue").click();
  await step(page, "test").getByTestId("send-test-page").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: words("de", "Send test page") })
    .click();
  await page.getByTestId("guided-setup-test-continue").click();
  await expect(page.getByTestId("guided-setup-summary")).toBeVisible();

  await page.getByTestId("guided-setup-next-status-page").click();
  await expect(page).toHaveURL(/\/status-pages\/setup\?monitorId=/);
  await expect(page.getByTestId("guided-setup-picked-count")).toContainText(
    "1",
  );
  const ticked: Locator = page
    .getByTestId("guided-setup-monitors")
    .getByRole("checkbox", { checked: true });
  await expect(ticked).toHaveCount(1);
  await expect(ticked).toHaveAccessibleName("acme-commerce.example");
  await look(page, each, "handed-in-1-pick");

  await page.getByTestId("guided-setup-create-status-page").click();
  await expect(page.getByTestId("guided-setup-preview")).toContainText(
    "acme-commerce.example",
  );
  const [resource] = await writesTo(page, "StatusPageResource");
  const [monitor] = await writesTo(page, "Monitor");
  expect(idOf(resource?.data["monitorId"])).toBe(idOf(monitor?.data["_id"]));
});

/*
 * A PROJECT VIEWER: reads every product and may create nothing, so neither
 * setup is offered on its product, and the status page setup's address
 * says why instead of a form that could not save.
 */
test("a Project Viewer is offered neither setup, and the status page setup says why", async ({
  page,
}: {
  page: Page;
}) => {
  const each: Look = { lang: "fa", theme: "light", width: 1280 };

  await open(page, each, `${DASHBOARD}/status-pages`, { as: "viewer" });
  await expect(page.getByTestId("product-showcase")).toBeVisible();
  await expect(page.getByTestId("resource-showcase-setup-button")).toHaveCount(
    0,
  );

  await open(page, each, `${DASHBOARD}/logs`, { as: "viewer" });
  await expect(page.getByTestId("product-showcase")).toBeVisible();
  await expect(page.getByTestId("resource-showcase-setup-button")).toHaveCount(
    0,
  );

  await open(page, each, STATUS_PAGE_SETUP, { as: "viewer", seed: "busy" });
  await expect(page.getByTestId("guided-setup-not-allowed")).toBeVisible();
  await look(page, each, "viewer-status-page-not-allowed");
});
