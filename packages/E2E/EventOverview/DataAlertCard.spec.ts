import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * An alert's Data card (Components/DataObservability/DataAlertLineage):
 * what a data monitor's alert is about, the alert upstream it is a
 * consequence of, the services that write its table and their changes
 * around it - and, on a cause's page, the alerts downstream it caused. Drawn
 * only for an alert a data monitor raised. Each of its reads stands alone:
 * one that fails or is refused leaves out only what it would have shown,
 * never the rest of the card, and never the page.
 *
 * On the Event Overview fixture's alerts #311 and #310 (Fixture/Fixture.js,
 * ?data= and ?fail=data-alert / data-writers / data-changes), with the clock
 * pinned and the network fenced; afterEach fails a test on an uncaught page
 * error, or on anything the fixture does not model.
 */

const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

const ALERT_ID: string = uuid("30000000", 311);
const ALERT_PATH: string = `${DASHBOARD}/alerts/${ALERT_ID}`;
const CAUSE_PATH: string = `${DASHBOARD}/alerts/${uuid("30000000", 310)}`;
const CAUSE_TABLE_PATH: string = `${DASHBOARD}/data-observability/tables/${uuid("8b000000", 1)}`;
const TABLE_PATH: string = `${DASHBOARD}/data-observability/tables/${uuid("8b000000", 2)}`;

const TABLE_NAME: string = "payments.ledger_entries · Payments warehouse";
const CAUSE_TABLE_NAME: string =
  "payments.provider_callbacks · Payments warehouse";
const CAUSE_NAME: string =
  "#310 Payment provider callback retries above 50/min";
const ALERT_NAME: string = "#311 Payment webhook 5xx rate above 5%";
const STARTED_ACKNOWLEDGED: string =
  "That alert was open first, on what this one's table or pipeline is built from, so this alert started acknowledged: nobody was paged twice.";
const NO_CHANGES: string =
  "No deploy or other change of these services in the day before the alert.";

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing the page asks for may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    await route.abort();
  });

  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __eventOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__eventOverviewFixture;
      return JSON.parse(JSON.stringify(state?.unhandled || []));
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(
  page: Page,
  pagePath: string,
  query: string = "",
): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${pagePath}${query ? `?${query}` : ""}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 30000,
  });
}

function cardTitled(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { level: 2, name: title, exact: true }),
  });
}

function dataCard(page: Page): Locator {
  return cardTitled(page, "Data");
}

function impactCard(page: Page): Locator {
  return cardTitled(page, "Downstream Impact");
}

// One part of the Data card, by its label: About, Written By...
function part(card: Locator, label: string): Locator {
  return card.locator("dl > div").filter({
    has: card.page().getByText(label, { exact: true }),
  });
}

// The changes of the services that write a table: an analytics table.
const CHANGE_EVENTS: string = "ChangeEventV1";

type RecordedRead = {
  modelName: string;
  analytics?: boolean;
  query: unknown;
};

// The list reads the fixture answered, of one model.
async function reads(
  page: Page,
  modelName: string,
): Promise<Array<RecordedRead>> {
  return page.evaluate((name: string): Array<RecordedRead> => {
    const state: { listRequests?: Array<RecordedRead> } =
      (
        window as unknown as {
          __eventOverviewFixture?: { listRequests?: Array<RecordedRead> };
        }
      ).__eventOverviewFixture || {};
    return JSON.parse(
      JSON.stringify(
        (state.listRequests || []).filter((request: RecordedRead) => {
          return request.modelName === name;
        }),
      ),
    );
  }, modelName);
}

async function dataAlertQueries(page: Page): Promise<Array<unknown>> {
  return (await reads(page, "DataAlert")).map((request: RecordedRead) => {
    return request.query;
  });
}

/*
 * Lets the page draw what its reads answered: a frame, then a task, so a
 * card that was going to be drawn is there to be seen before a test says it
 * is not.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}

const OWN_DATA_ALERT_QUERY: unknown = {
  alertId: { _type: "ObjectID", value: ALERT_ID },
};
const CAUSED_DATA_ALERTS_QUERY: unknown = {
  causeAlertId: { _type: "ObjectID", value: ALERT_ID },
};

test.describe("an alert's Data card", () => {
  test("an alert no data monitor raised asks for its data alert and what it caused, and draws neither card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH);

    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return dataAlertQueries(page);
      })
      .toEqual(
        expect.arrayContaining([
          OWN_DATA_ALERT_QUERY,
          CAUSED_DATA_ALERTS_QUERY,
        ]),
      );
    await settle(page);

    await expect(dataCard(page)).toHaveCount(0);
    await expect(impactCard(page)).toHaveCount(0);
    // Nothing more is read for an alert that is no data alert.
    expect(await reads(page, "DataAssetUsage")).toEqual([]);
    expect(await reads(page, CHANGE_EVENTS)).toEqual([]);
  });

  test("a refused data alert read draws nothing and leaves the rest of the page whole (?fail=data-alert)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "fail=data-alert");

    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return dataAlertQueries(page);
      })
      .toEqual(expect.arrayContaining([OWN_DATA_ALERT_QUERY]));
    await settle(page);

    await expect(dataCard(page)).toHaveCount(0);
    await expect(impactCard(page)).toHaveCount(0);
    // The cards after it are drawn as ever.
    await expect(cardTitled(page, "Alert Feed")).toBeVisible();
  });

  test("a data alert's card says what it is about, the alert upstream that caused it, who writes its table and what changed (?data=table)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table");

    const card: Locator = dataCard(page);
    await expect(card).toBeVisible();

    // About: the table, linked to its page.
    await expect(
      part(card, "About").getByRole("link", { name: TABLE_NAME }),
    ).toHaveAttribute("href", TABLE_PATH);

    // Caused Upstream: alert #310, linked, and why this one started acknowledged.
    const cause: Locator = part(card, "Caused Upstream");
    await expect(cause.getByRole("link", { name: CAUSE_NAME })).toHaveAttribute(
      "href",
      CAUSE_PATH,
    );
    await expect(cause).toContainText(STARTED_ACKNOWLEDGED);

    // Written By: both services that write the table, last seen first.
    await expect(part(card, "Written By").locator("dd > div")).toHaveText([
      /^payments-webhooks\s*4,120 writes, 37 failed, in the hour last seen 15 minutes ago$/,
      /^checkout-api\s*860 writes, 0 failed, in the hour last seen 30 minutes ago$/,
    ]);

    // Changes Around It: payments-webhooks' deploy, eight minutes before.
    const changes: Locator = part(card, "Changes Around It");
    await expect(changes.locator("dd > div")).toHaveText([
      /Deployed payments-webhooks v2\.14\.0\s*payments-webhooks$/,
    ]);
    await expect(changes).not.toContainText(NO_CHANGES);

    // This alert caused nothing downstream.
    await expect(impactCard(page)).toHaveCount(0);
  });

  test("with its writers' changes refused, the card still says what it is about, its cause and who writes the table, and nothing of changes (?data=table&fail=data-changes)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table&fail=data-changes");

    const card: Locator = dataCard(page);
    await expect(
      part(card, "About").getByRole("link", { name: TABLE_NAME }),
    ).toBeVisible();
    await expect(
      part(card, "Caused Upstream").getByRole("link", { name: CAUSE_NAME }),
    ).toBeVisible();
    await expect(part(card, "Written By").locator("dd > div")).toHaveText([
      /^payments-webhooks\s*4,120 writes, 37 failed, in the hour last seen 15 minutes ago$/,
      /^checkout-api\s*860 writes, 0 failed, in the hour last seen 30 minutes ago$/,
    ]);

    // The changes were asked for, and refused.
    expect(await reads(page, CHANGE_EVENTS)).toHaveLength(1);

    // So the card says nothing of them - not that there were none.
    await expect(part(card, "Changes Around It")).toHaveCount(0);
    await expect(card).not.toContainText(NO_CHANGES);
    await expect(card).not.toContainText("Deployed payments-webhooks v2.14.0");
  });

  test("when who writes its table cannot be read, the card still says what it is about and what caused it (?data=table&fail=data-writers)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERT_PATH, "data=table&fail=data-writers");

    const card: Locator = dataCard(page);
    await expect(
      part(card, "About").getByRole("link", { name: TABLE_NAME }),
    ).toHaveAttribute("href", TABLE_PATH);
    await expect(
      part(card, "Caused Upstream").getByRole("link", { name: CAUSE_NAME }),
    ).toHaveAttribute("href", CAUSE_PATH);

    // The writers were asked for, and the read failed.
    expect(await reads(page, "DataAssetUsage")).toHaveLength(1);

    // So neither they nor their changes are told, and no changes are read.
    await expect(part(card, "Written By")).toHaveCount(0);
    await expect(part(card, "Changes Around It")).toHaveCount(0);
    expect(await reads(page, CHANGE_EVENTS)).toEqual([]);
  });

  test("the cause's page lists the alert it caused downstream, on the table built from its own (?data=table)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CAUSE_PATH, "data=table");

    const impact: Locator = impactCard(page);
    await expect(impact).toBeVisible();
    await expect(
      impact.getByRole("link", { name: TABLE_NAME }),
    ).toHaveAttribute("href", TABLE_PATH);
    await expect(
      impact.getByRole("link", { name: ALERT_NAME }),
    ).toHaveAttribute("href", ALERT_PATH);

    // Its own card: about the table upstream, caused by nothing upstream of it.
    const card: Locator = dataCard(page);
    await expect(
      part(card, "About").getByRole("link", { name: CAUSE_TABLE_NAME }),
    ).toHaveAttribute("href", CAUSE_TABLE_PATH);
    await expect(part(card, "Caused Upstream")).toHaveCount(0);
  });
});
