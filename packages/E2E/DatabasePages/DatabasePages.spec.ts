import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";

/*
 * The Databases product's pages, in a browser, against the offline fixture
 * (DatabasePages/Fixture).
 *
 * The maintainer: "How can we make the Proxmox product a lot better and
 * world-class? Can you please do those things for other resources as well
 * ... feature-rich, simple to use, and natural to use."
 *
 * So, read the way someone who runs databases reads them: the Databases list
 * says which databases need attention first, the most urgent first, and why
 * - connections nearly exhausted, a replica behind, transaction IDs near
 * wraparound, a transaction left open, a red cluster, blocked sessions,
 * memory near maxmemory, engine metrics that stopped and since when - each
 * row one step from the database's page; then every database's Status in a
 * word, with the reason under it. The lines are each engine's recommended
 * alerts' own. A database's page says how it is, what on it needs a look,
 * and which of the alerts OneUptime recommends watch it, with "Turn on N
 * alerts" opening Recommendations with exactly those selected. A calm fleet
 * draws no card; a read that fails says so. At 1280, 1024, 768 and 390
 * pixels, in dark mode, in German and in Persian. The fixture records every
 * read, so the tests check that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DATABASES_PATH: string = `/dashboard/${PROJECT_ID}/databases`;

function uuid(prefix: string, number: number): string {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

// The fleets' databases (Fixture/Data.js).
const IDS: Record<string, string> = {
  ordersDb: uuid("73000000", 1),
  paymentsPg: uuid("73000000", 2),
  searchEs: uuid("73000000", 3),
  cacheMemcached: uuid("73000000", 4),
  catalogMysql: uuid("73000000", 5),
  ledgerMssql: uuid("73000000", 6),
  sessionsRedis: uuid("73000000", 7),
  analyticsMongo: uuid("73000000", 8),
  inventoryPg: uuid("73000000", 9),
  eventsClickhouse: uuid("73000000", 10),
};

function databasePath(id: string): string {
  return `${DATABASES_PATH}/${id}`;
}

/*
 * The busy fleet's Needs attention rows, most urgent first: the critical
 * ones by how many reasons each has, then by name; then the ones to look
 * at, by name.
 */
const BUSY_ATTENTION: Array<{ key: string; severity: string }> = [
  { key: IDS["ordersDb"]!, severity: "critical" },
  { key: IDS["paymentsPg"]!, severity: "critical" },
  { key: IDS["cacheMemcached"]!, severity: "critical" },
  { key: IDS["searchEs"]!, severity: "critical" },
  { key: IDS["catalogMysql"]!, severity: "warning" },
  { key: IDS["ledgerMssql"]!, severity: "warning" },
  { key: IDS["sessionsRedis"]!, severity: "warning" },
];

// What PostgreSQL's recommended alerts are, in the order they are listed.
const POSTGRESQL_ALERT_IDS: Array<string> = [
  "database-postgresql-engine-metrics-stopped",
  "database-postgresql-restarted",
  "database-postgresql-xid-wraparound-near",
  "database-postgresql-xid-age-high",
  "database-postgresql-connections-exhausted",
  "database-postgresql-connections-high",
  "database-postgresql-replica-replay-lag",
  "database-postgresql-replication-byte-lag",
  "database-postgresql-long-running-transaction",
  "database-postgresql-sessions-waiting-on-locks",
  "database-postgresql-database-size",
].map((templateId: string): string => {
  return `DatabaseServer:${templateId}`;
});

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/database-pages-ui",
);

// The other sizes the pages are drawn at; 1280 is the suite's own viewport.
const SMALL_LAPTOP: { width: number; height: number } = {
  width: 1024,
  height: 768,
};
const TABLET: { width: number; height: number } = { width: 768, height: 1024 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's German and Persian words, as the fixture draws them.
const GERMAN: Record<string, string> = locale("de");
const PERSIAN: Record<string, string> = locale("fa");

// A sentence of the locale with its values put in.
function fill(
  words: Record<string, string>,
  key: string,
  values: Record<string, string>,
): string {
  let sentence: string = words[key] as string;
  expect(sentence, `the locale has "${key}"`).toBeTruthy();
  for (const name of Object.keys(values)) {
    sentence = sentence.split(`{{${name}}}`).join(values[name] as string);
  }
  return sentence;
}

// A word the locale must translate, as it does.
function worded(words: Record<string, string>, key: string): string {
  const word: string | undefined = words[key];
  expect(word, `the locale has "${key}"`).toBeTruthy();
  expect(word, `"${key}" is translated`).not.toBe(key);
  return word as string;
}

// A value set apart from a right-to-left sentence (FSI ... PDI).
function isolated(value: string): string {
  return `⁨${value}⁩`;
}

// A Latin digit, which a Persian count should not mix with its own.
const LATIN_DIGIT: RegExp = /[0-9]/;

interface Recorded {
  listRequests: Array<{ modelName: string; query: Record<string, unknown> }>;
  apiRequests: Array<{ method: string; url: string }>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const outsideRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  // Nothing may leave the fixture: no CDN, no telemetry, no real API.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }

    outside.push(url.toString());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);

  if (!page.isClosed()) {
    const unhandled: Array<Record<string, unknown>> = await page.evaluate(
      (): Array<Record<string, unknown>> => {
        const fixture: Recorded | undefined = (
          window as unknown as { __databasePagesFixture?: Recorded }
        ).__databasePagesFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled).toEqual([]);
  }
});

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __databasePagesFixture: Recorded })
      .__databasePagesFixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function openList(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${DATABASES_PATH}${query ? `?${query}` : ""}`);
  /*
   * The list has drawn its databases once a Status is there: in a row, or
   * in a card when its box is too narrow for the rows.
   */
  await expect(page.getByTestId("database-status").first()).toBeVisible();
}

async function openDatabase(
  page: Page,
  id: string,
  query: string = "",
): Promise<void> {
  await page.goto(`${databasePath(id)}${query ? `?${query}` : ""}`);
  // The hero is drawn once the database has loaded.
  await expect(page.getByTestId("resource-overview-status")).toBeVisible();
}

// The rows of a Needs attention card, as key and severity, in order.
async function attentionRows(
  card: Locator,
): Promise<Array<{ key: string; severity: string }>> {
  return await card
    .locator('[data-testid$="-attention-item"]')
    .evaluateAll(
      (elements: Array<Element>): Array<{ key: string; severity: string }> => {
        return elements.map((element: Element) => {
          return {
            key: element.getAttribute("data-key") || "",
            severity: element.getAttribute("data-severity") || "",
          };
        });
      },
    );
}

function attentionRow(card: Locator, key: string): Locator {
  return card.locator(`[data-key="${key}"]`);
}

// A row of the Databases table, found by the database's name.
function tableRow(page: Page, name: string): Locator {
  return page
    .locator("tbody tr")
    .filter({ has: page.getByRole("link", { name: name, exact: true }) });
}

// A row's Status: the word in its pill.
function statusOf(page: Page, name: string): Locator {
  return tableRow(page, name).locator("[data-tone]").first();
}

/*
 * A database's Status wherever the list draws it: in its row, or - in a
 * box too narrow for the rows - in its card. Both draw each database's
 * name and Status in the list's order.
 */
async function statusInList(page: Page, name: string): Promise<Locator> {
  const names: Array<string> = await page
    .locator('[data-testid="database-name"] > a')
    .allTextContents();
  const index: number = names.indexOf(name);

  expect({ name: name, isListed: index >= 0 }).toEqual({
    name: name,
    isListed: true,
  });

  return page
    .getByTestId("database-status")
    .nth(index)
    .locator("[data-tone]")
    .first();
}

/*
 * The Databases table is no wider than the card it is drawn in. In a box too
 * narrow for its rows the list is drawn as cards, which wrap to their box.
 */
async function expectTableFitsItsCard(page: Page): Promise<void> {
  if ((await page.locator("table").count()) === 0) {
    await expect(page.getByTestId("database-status").first()).toBeVisible();
    return;
  }

  const widths: { table: number; box: number } = await page
    .locator("table")
    .first()
    .evaluate((table: Element): { table: number; box: number } => {
      return {
        table: Math.round(table.getBoundingClientRect().width),
        box: Math.round(
          (table.parentElement as Element).getBoundingClientRect().width,
        ),
      };
    });

  expect(widths.table).toBeLessThanOrEqual(widths.box);
}

// Whether `later` is drawn below `earlier` on the page.
async function isBelow(earlier: Locator, later: Locator): Promise<boolean> {
  const [first, second] = await boxesInOneFrame([earlier, later]);
  return Boolean(first && second && second.y > first.y);
}

async function selectedRecommendations(
  page: Page,
  databaseId: string,
): Promise<Array<string>> {
  await expect(page).toHaveURL((url: URL): boolean => {
    return url.pathname === `${databasePath(databaseId)}/recommendations`;
  });
  return (new URL(page.url()).searchParams.get("select") || "")
    .split(",")
    .filter((id: string): boolean => {
      return id.length > 0;
    })
    .sort();
}

// The reads of the list's Needs attention card (DatabaseFleetAttention).
function attentionReads(
  fixture: Recorded,
): Array<{ modelName: string; query: Record<string, unknown> }> {
  return fixture.listRequests.filter(
    (request: { modelName: string; query: Record<string, unknown> }) => {
      return (
        request.modelName === "DatabaseServer" &&
        Boolean(request.query) &&
        ("engineHealth" in request.query ||
          (typeof request.query["otelCollectorStatus"] === "object" &&
            request.query["otelCollectorStatus"] !== null))
      );
    },
  );
}

test.describe("the Databases list", () => {
  test("says which databases need attention first, the most urgent first, and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);

    const card: Locator = page.getByTestId("database-fleet-attention");
    await expect(card).toBeVisible();
    await expect(
      page.getByTestId("database-fleet-attention-summary").locator("span"),
    ).toHaveText(["4 critical", "3 to look at"]);
    // Six at first, the seventh one click away.
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION.slice(0, 6));
    await expect(
      page.getByTestId("database-fleet-attention-toggle"),
    ).toHaveText("Show 1 more");
    await page.getByTestId("database-fleet-attention-toggle").click();
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION);

    // Each row says why, in the words of the lines its engine's alerts draw.
    const orders: Locator = attentionRow(card, IDS["ordersDb"]!);
    await expect(
      orders.getByTestId("database-fleet-attention-name"),
    ).toHaveText("orders-db");
    // The engine's own name, as written.
    await expect(
      orders.getByTestId("database-fleet-attention-kind"),
    ).toHaveText("PostgreSQL");
    await expect(
      orders.getByTestId("database-fleet-attention-reason"),
    ).toHaveText([
      "Connections at 96% of max_connections",
      "A replica 1 min behind",
    ]);
    // PostgreSQL's own SQL checks: wraparound coming, a transaction left open.
    await expect(
      attentionRow(card, IDS["paymentsPg"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText([
      "Transaction IDs at 74% of wraparound",
      "A transaction open for 2 h",
    ]);
    await expect(
      attentionRow(card, IDS["searchEs"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText("Cluster health red");
    await expect(
      attentionRow(card, IDS["catalogMysql"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText("Replica 45 s behind its source");
    await expect(
      attentionRow(card, IDS["ledgerMssql"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText("3 blocked sessions");
    await expect(
      attentionRow(card, IDS["sessionsRedis"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText("Memory at 93% of maxmemory");

    // Engine metrics that stopped: since when, not what they said last.
    const cache: Locator = attentionRow(card, IDS["cacheMemcached"]!);
    await expect(
      cache.getByTestId("database-fleet-attention-reason"),
    ).toHaveText("Engine metrics stopped");
    await expect(
      cache.getByTestId("database-fleet-attention-last-report"),
    ).toHaveText("Last reported 3 hours ago");
    await expect(cache).not.toContainText("990");

    // Calm, without engine metrics, or with nothing to judge: not listed.
    for (const key of ["analyticsMongo", "inventoryPg", "eventsClickhouse"]) {
      await expect(attentionRow(card, IDS[key]!)).toHaveCount(0);
    }

    /*
     * Two reads of the databases that may need someone - a fresh verdict
     * past a line, and engine metrics that stopped - not every database.
     */
    const reads: Array<{ modelName: string; query: Record<string, unknown> }> =
      attentionReads(await recorded(page));
    expect(reads.length).toBeGreaterThanOrEqual(2);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "databases-list");

    // One step to the database's page, from anywhere on its row.
    await orders.getByTestId("database-fleet-attention-reason").first().click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === databasePath(IDS["ordersDb"]!);
    });
    await expect(page.getByTestId("resource-overview-health")).toHaveText(
      "Unhealthy",
    );
  });

  test("says each database's Status in a word, why under it, in Title Case columns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page);

    await expect(statusOf(page, "orders-db")).toHaveText("Unhealthy");
    await expect(statusOf(page, "orders-db")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    // The most urgent reason, and how many more there are.
    await expect(
      tableRow(page, "orders-db").getByTestId("resource-status-reason"),
    ).toHaveText("Connections at 96% of max_connections +1 more");
    await expect(statusOf(page, "search-es")).toHaveText("Unhealthy");
    await expect(statusOf(page, "catalog-mysql")).toHaveText("Degraded");
    await expect(statusOf(page, "catalog-mysql")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    await expect(
      tableRow(page, "ledger-mssql").getByTestId("resource-status-reason"),
    ).toHaveText("3 blocked sessions");
    await expect(statusOf(page, "analytics-mongo")).toHaveText("Healthy");
    await expect(statusOf(page, "analytics-mongo")).toHaveAttribute(
      "data-tone",
      "positive",
    );

    // Stopped: when its engine metrics last arrived, not a stale word.
    await expect(statusOf(page, "cache-memcached")).toHaveText(
      "Engine metrics stopped",
    );
    await expect(
      tableRow(page, "cache-memcached").getByTestId("resource-status-reason"),
    ).toHaveText("Last reported 3 hours ago");
    // Never had engine metrics; has them with nothing to judge them by.
    await expect(statusOf(page, "inventory-pg")).toHaveText(
      "No engine metrics",
    );
    await expect(statusOf(page, "events-clickhouse")).toHaveText("Reporting");

    // The columns, in Title Case.
    const headers: Array<string> = (
      await page.locator("thead th").allInnerTexts()
    )
      .map((text: string): string => {
        return text.trim();
      })
      .filter((text: string): boolean => {
        return text.length > 0;
      });
    /*
     * Runs On, Discovered From, Labels and Owners give way first: when the
     * table cannot fit its card they fold under the name (Runs On does at
     * 1280 here), so they are not among the headers asked for.
     */
    expect(headers).toEqual(
      expect.arrayContaining(["Name", "Status", "Engine", "Last Seen"]),
    );
    expect(headers).not.toContain("Runs On");
    /*
     * Folded under the name, Runs On is a line for a database on a cluster,
     * linked to it, and no line - not a dash - for one on nothing OneUptime
     * knows.
     */
    const runsOn: (name: string) => Locator = (name: string): Locator => {
      return tableRow(page, name)
        .getByTestId("table-folded-value")
        .filter({ hasText: "Runs On" });
    };
    await expect(runsOn("catalog-mysql")).toBeVisible();
    await expect(runsOn("catalog-mysql").getByRole("link")).toHaveText(
      "Kubernetes · prod-eu",
    );
    for (const name of ["orders-db", "payments-pg", "analytics-mongo"]) {
      await expect(runsOn(name)).toBeHidden();
    }
    // Its Status stands in for the Engine Metrics column the list had.
    expect(headers).not.toContain("Engine metrics");
    expect(headers).not.toContain("Engine Metrics");

    // The filters, in Title Case, their options in the product's words.
    const filters: Locator = page.getByTestId("facet-filter-bar");
    await expect(filters.getByTestId("filter-chip")).toHaveText([
      "Owner",
      "Labels",
      "Engine",
      "Discovered From",
      "Engine Metrics",
    ]);
    await page
      .getByRole("button", { name: "Engine Metrics", exact: true })
      .click();
    for (const option of ["Connected", "Disconnected", "Not connected"]) {
      await expect(
        page.getByRole("option", { name: option, exact: true }),
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Discovered From", exact: true })
      .click();
    for (const option of [
      "OpenTelemetry Collector",
      "Application traces",
      "Added manually",
    ]) {
      await expect(
        page.getByRole("option", { name: option, exact: true }),
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");

    // The whole table fits its card at a laptop's width.
    await expectTableFitsItsCard(page);
    await expectNoSidewaysScroll(page);
  });

  test("a calm fleet draws no Needs attention card, and a database of each of the nine engines reads Healthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "fleet=calm");

    const statuses: Locator = page.locator("tbody [data-tone]");
    await expect(statuses).toHaveCount(9);
    await expect(statuses).toHaveText(new Array(9).fill("Healthy"));
    await expect(page.getByTestId("database-fleet-attention")).toHaveCount(0);
    await expect(
      page.getByTestId("database-fleet-attention-error"),
    ).toHaveCount(0);
  });

  test("a project with no databases yet reads no fleet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${DATABASES_PATH}?fleet=new`);
    await expect(page.getByText("Create Database").first()).toBeVisible();
    await expect(page.getByTestId("database-fleet-attention")).toHaveCount(0);
    expect(attentionReads(await recorded(page))).toEqual([]);
  });

  test("a read that fails says so in the card, with Refresh, and the table stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "fail=attention");

    const error: Locator = page.getByTestId("database-fleet-attention-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(
      "Something went wrong on the server. Please try again.",
    );

    const before: number = attentionReads(await recorded(page)).length;
    await error.getByTestId("refresh-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return attentionReads(await recorded(page)).length;
      })
      .toBeGreaterThan(before);
    await expect(statusOf(page, "orders-db")).toHaveText("Unhealthy");
  });

  for (const viewport of [
    { name: "phone", size: PHONE },
    { name: "tablet", size: TABLET },
    { name: "small laptop", size: SMALL_LAPTOP },
  ]) {
    test(`on a ${viewport.name} (${viewport.size.width}), the card and the list fit and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport.size);
      await openList(page);

      const card: Locator = page.getByTestId("database-fleet-attention");
      await expect(card).toBeVisible();
      expect(await attentionRows(card)).toEqual(BUSY_ATTENTION.slice(0, 6));
      await expect(await statusInList(page, "orders-db")).toHaveText(
        "Unhealthy",
      );
      await expectNoSidewaysScroll(page);
      if (viewport.size.width >= SMALL_LAPTOP.width) {
        await expectTableFitsItsCard(page);
      }
      await screenshot(page, `databases-list-${viewport.size.width}`);
    });
  }

  test("in dark mode, the list draws on the dark surface", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "theme=dark");

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("database-fleet-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "databases-list-dark");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "databases-list-dark-390");
  });

  test("in German, the card, the Status words, the reasons and the filters are German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "lang=de");

    const card: Locator = page.getByTestId("database-fleet-attention");
    await expect(
      card.getByText(worded(GERMAN, "Needs attention"), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("database-fleet-attention-summary").locator("span"),
    ).toHaveText([
      fill(GERMAN, "{{count}} critical", { count: "4" }),
      fill(GERMAN, "{{count}} to look at", { count: "3" }),
    ]);
    worded(GERMAN, "Connections at {{percent}} of max_connections");
    // German's own percent, as its tiles write theirs (#7106).
    await expect(
      attentionRow(card, IDS["ordersDb"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText([
      fill(GERMAN, "Connections at {{percent}} of max_connections", {
        percent: "96\u00A0%",
      }),
      fill(GERMAN, "A replica {{minutes}} min behind", { minutes: "1" }),
    ]);
    await expect(
      attentionRow(card, IDS["paymentsPg"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText([
      fill(GERMAN, "Transaction IDs at {{percent}} of wraparound", {
        percent: "74\u00A0%",
      }),
      fill(GERMAN, "A transaction open for {{hours}} h", { hours: "2" }),
    ]);
    await expect(
      attentionRow(card, IDS["cacheMemcached"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText(worded(GERMAN, "Engine metrics stopped"));

    await expect(statusOf(page, "orders-db")).toHaveText(
      worded(GERMAN, "Unhealthy"),
    );
    await expect(statusOf(page, "catalog-mysql")).toHaveText(
      worded(GERMAN, "Degraded"),
    );
    await expect(statusOf(page, "inventory-pg")).toHaveText(
      worded(GERMAN, "No engine metrics"),
    );
    await expect(statusOf(page, "events-clickhouse")).toHaveText(
      worded(GERMAN, "Reporting"),
    );

    // The filters and their options, in German.
    const filters: Locator = page.getByTestId("facet-filter-bar");
    await expect(filters.getByTestId("filter-chip")).toContainText([
      worded(GERMAN, "Discovered From"),
      worded(GERMAN, "Engine Metrics"),
    ]);
    await page
      .getByRole("button", {
        name: worded(GERMAN, "Engine Metrics"),
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("option", {
        name: worded(GERMAN, "Not connected"),
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await expectTableFitsItsCard(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "databases-list-german");
  });

  test("in Persian, the list reads right to left, with Persian digits, and an engine's name as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openList(page, "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const card: Locator = page.getByTestId("database-fleet-attention");
    await expect(
      card.getByText(PERSIAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    // "4 بحرانی" would mix two kinds of digit: every count is Persian.
    const summary: string =
      (await page
        .getByTestId("database-fleet-attention-summary")
        .textContent()) || "";
    expect(summary).toContain("۴");
    expect(summary).not.toMatch(LATIN_DIGIT);

    // A count set apart from the Persian sentence around it.
    await expect(
      attentionRow(card, IDS["ledgerMssql"]!).getByTestId(
        "database-fleet-attention-reason",
      ),
    ).toHaveText(
      fill(PERSIAN, "{{count}} blocked sessions", { count: isolated("۳") }),
    );
    // The engine's own name, as written.
    await expect(
      attentionRow(card, IDS["ordersDb"]!).getByTestId(
        "database-fleet-attention-kind",
      ),
    ).toContainText("PostgreSQL");
    await expect(statusOf(page, "orders-db")).toHaveText(
      worded(PERSIAN, "Unhealthy"),
    );

    /*
     * A host and port, and an engine and its version, read left to right:
     * an endpoint too long for its cell is cut at its end, not its start,
     * and the version keeps its gap after the engine's name.
     */
    const ordersRow: Locator = tableRow(page, "orders-db");
    const endpoint: Locator = ordersRow.getByTestId("database-name-endpoint");
    await expect(endpoint).toHaveAttribute("dir", "ltr");
    expect(
      await endpoint.evaluate((element: Element): string => {
        return getComputedStyle(element).direction;
      }),
    ).toBe("ltr");
    const engine: Locator = ordersRow.getByTestId("database-engine");
    await expect(engine).toHaveText("PostgreSQL16.4");
    const [engineName, engineVersion] = await boxesInOneFrame([
      engine.locator("span").first(),
      engine.locator("span").nth(1),
    ]);
    expect(
      engineVersion!.x - (engineName!.x + engineName!.width),
    ).toBeGreaterThanOrEqual(4);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "databases-list-persian");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "databases-list-persian-390");
  });
});

test.describe("a database's Overview", () => {
  test("says how its engine is, what on it needs a look, and which alerts watch it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["ordersDb"]!);

    // Whether OneUptime sees it, then how its engine is.
    const health: Locator = page.getByTestId("resource-overview-health");
    await expect(health).toHaveText("Unhealthy");
    await expect(health).toHaveAttribute("data-health", "unhealthy");

    // Connections first (critical), then the replica (a look).
    const card: Locator = page.getByTestId("database-needs-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "connections", severity: "critical" },
      { key: "replication", severity: "warning" },
    ]);
    await expect(
      attentionRow(card, "connections").getByTestId(
        "database-needs-attention-name",
      ),
    ).toHaveText("Connections");
    await expect(
      attentionRow(card, "connections").getByTestId(
        "database-needs-attention-reason",
      ),
    ).toHaveText("Connections at 96% of max_connections");
    await expect(
      attentionRow(card, "replication").getByTestId(
        "database-needs-attention-reason",
      ),
    ).toHaveText("A replica 1 min behind");

    /*
     * Which of its engine's recommended alerts watch it - the lines its
     * health is judged by - after what it needs.
     */
    const alerts: Locator = page.getByTestId("database-alerts");
    await expect(alerts.getByTestId("database-alerts-item")).toHaveCount(11);
    await expect(
      page.locator(
        '[data-testid="database-alerts-item"][data-status="Available"]',
      ),
    ).toHaveCount(11);
    expect(await isBelow(card, alerts)).toBe(true);

    await expectNoSidewaysScroll(page);
    await screenshot(page, "database-overview");

    // Each row opens where its numbers are: the Metrics tab.
    await attentionRow(card, "connections")
      .getByTestId("database-needs-attention-name")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${databasePath(IDS["ordersDb"]!)}/metrics`;
    });
  });

  test("Database alerts turn on in one step, into Recommendations with exactly those selected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["ordersDb"]!);

    await expect(page.getByTestId("database-alerts-turn-on")).toHaveText(
      "Turn on 11 alerts",
    );
    await page.getByTestId("database-alerts-turn-on").click();
    expect(await selectedRecommendations(page, IDS["ordersDb"]!)).toEqual(
      [...POSTGRESQL_ALERT_IDS].sort(),
    );
    await expect(
      page.getByText("11 monitors selected", { exact: false }),
    ).toBeVisible();
    await screenshot(page, "database-recommendations");
  });

  test("alerts already on say On, and Turn on counts only the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["ordersDb"]!, "alerts=some");

    await expect(page.getByTestId("database-alerts-item")).toHaveCount(11);
    await expect(
      page.locator(
        '[data-testid="database-alerts-item"][data-status="Created"]',
      ),
    ).toHaveCount(2);
    await expect(page.getByTestId("database-alerts-turn-on")).toHaveText(
      "Turn on 9 alerts",
    );
  });

  test("PostgreSQL's own SQL checks: transaction IDs near wraparound, and a transaction open for two hours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["paymentsPg"]!);

    await expect(page.getByTestId("resource-overview-health")).toHaveText(
      "Unhealthy",
    );
    const card: Locator = page.getByTestId("database-needs-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "availability", severity: "critical" },
      { key: "performance", severity: "warning" },
    ]);
    await expect(
      attentionRow(card, "availability").getByTestId(
        "database-needs-attention-reason",
      ),
    ).toHaveText("Transaction IDs at 74% of wraparound");
    await expect(
      attentionRow(card, "performance").getByTestId(
        "database-needs-attention-reason",
      ),
    ).toHaveText("A transaction open for 2 h");
  });

  test("engine metrics that stopped: Health Unknown, one row saying since when, opening the setup guide", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["cacheMemcached"]!);

    await expect(page.getByTestId("resource-overview-health")).toHaveText(
      "Health Unknown",
    );
    const card: Locator = page.getByTestId("database-needs-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "engine-metrics", severity: "critical" },
    ]);
    await expect(
      attentionRow(card, "engine-metrics").getByTestId(
        "database-needs-attention-reason",
      ),
    ).toHaveText("Engine metrics stopped");
    await expect(
      attentionRow(card, "engine-metrics").getByTestId(
        "database-needs-attention-last-report",
      ),
    ).toHaveText("Last reported 3 hours ago");
    // What it said three hours ago is not the truth now.
    await expect(card).not.toContainText("990");

    await attentionRow(card, "engine-metrics")
      .getByTestId("database-needs-attention-name")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${databasePath(IDS["cacheMemcached"]!)}/documentation`
      );
    });
  });

  test("a healthy database has its pill and no Needs attention card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["analyticsMongo"]!);

    await expect(page.getByTestId("resource-overview-health")).toHaveText(
      "Healthy",
    );
    await expect(page.getByTestId("database-needs-attention")).toHaveCount(0);
    // MongoDB's recommended alerts, none on yet.
    await expect(page.getByTestId("database-alerts-item")).toHaveCount(3);
  });

  test("with nothing to judge - no engine metrics, or an engine without alerts - there is no health to guess", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["inventoryPg"]!);
    await expect(page.getByTestId("resource-overview-health")).toHaveCount(0);
    await expect(page.getByTestId("database-needs-attention")).toHaveCount(0);

    await openDatabase(page, IDS["eventsClickhouse"]!);
    await expect(page.getByTestId("resource-overview-health")).toHaveCount(0);
    await expect(page.getByTestId("database-needs-attention")).toHaveCount(0);
    // ClickHouse has no recommended alerts: no card offering none.
    await expect(page.getByTestId("database-alerts")).toHaveCount(0);
  });

  for (const viewport of [
    { name: "phone", size: PHONE },
    { name: "tablet", size: TABLET },
    { name: "small laptop", size: SMALL_LAPTOP },
  ]) {
    test(`on a ${viewport.name} (${viewport.size.width}), its page fits and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport.size);
      await openDatabase(page, IDS["ordersDb"]!);

      await expect(page.getByTestId("resource-overview-health")).toBeVisible();
      await expect(page.getByTestId("database-needs-attention")).toBeVisible();
      await expect(page.getByTestId("database-alerts")).toBeVisible();
      await expectNoSidewaysScroll(page);
      await screenshot(page, `database-overview-${viewport.size.width}`);
    });
  }

  test("in dark mode, in German and in Persian, its page reads in its language and nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatabase(page, IDS["ordersDb"]!, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "database-overview-dark");

    await openDatabase(page, IDS["ordersDb"]!, "lang=de");
    await expect(page.getByTestId("resource-overview-health")).toHaveText(
      worded(GERMAN, "Unhealthy"),
    );
    const card: Locator = page.getByTestId("database-needs-attention");
    await expect(
      attentionRow(card, "connections").getByTestId(
        "database-needs-attention-name",
      ),
    ).toHaveText(worded(GERMAN, "Connections"));
    await expect(
      attentionRow(card, "replication").getByTestId(
        "database-needs-attention-name",
      ),
    ).toHaveText(worded(GERMAN, "Replication"));
    await expect(
      page
        .getByTestId("database-alerts")
        .getByText(worded(GERMAN, "Database alerts"), { exact: true }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "database-overview-german");

    await openDatabase(page, IDS["ledgerMssql"]!, "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("resource-overview-health")).toHaveText(
      worded(PERSIAN, "Degraded"),
    );
    const reason: string =
      (await page
        .getByTestId("database-needs-attention-reason")
        .first()
        .textContent()) || "";
    expect(reason).toBe(
      fill(PERSIAN, "{{count}} blocked sessions", { count: isolated("۳") }),
    );
    expect(reason).not.toMatch(LATIN_DIGIT);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "database-overview-persian");

    await page.setViewportSize(PHONE);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "database-overview-persian-390");
  });
});
