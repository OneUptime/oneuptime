import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Lists that keep themselves current, in real Chromium, against the offline
 * fixture (ModelTables/Fixture): the real Incidents and Alerts lists, and a
 * fake live connection the suite speaks for (window.__fixture.announce is
 * the server announcing a created, changed or deleted record).
 *
 * Someone who keeps the Incidents or Alerts list open - on a second screen,
 * during an outage - used to see the rows of the moment the page loaded,
 * until they pressed Refresh, while the bell above counted the changes live.
 * Now a list reads its page again when one of its records changes: at once
 * for the first change, once more after five seconds however many follow,
 * quietly (the rows stay, undimmed), and not while the reader has rows
 * ticked or a dialog or a menu open.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const INCIDENTS: string = `/dashboard/${PROJECT}/incidents`;
const ALERTS: string = `/dashboard/${PROJECT}/alerts`;
const MONITORS: string = `/dashboard/${PROJECT}/monitors`;

const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/model-tables-ui",
);

interface LiveSubscription {
  tableName: string;
  eventType: string;
  tenantId: string;
  isStopped: boolean;
}

interface FixtureRecord {
  listRequests: Array<{ tableName: string }>;
  unmodelled: Array<string>;
  liveSubscriptions: Array<LiveSubscription>;
}

interface FixtureWindow {
  __fixture: FixtureRecord & {
    announce: (tableName: string, eventType: string, id?: string) => void;
    declareIncident: (title: string) => string;
    raiseAlert: (title: string) => string;
  };
}

const KNOWN_LIBRARY_WARNINGS: Array<string> = [
  "Support for defaultProps will be removed from memo components",
];

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (
      message.type() === "error" &&
      !KNOWN_LIBRARY_WARNINGS.some((warning: string): boolean => {
        return message.text().includes(warning);
      })
    ) {
      errors.push(message.text());
    }
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureRecord> {
  return await page.evaluate((): FixtureRecord => {
    const record: FixtureRecord = (window as unknown as FixtureWindow)
      .__fixture;
    return {
      listRequests: record.listRequests,
      unmodelled: record.unmodelled,
      liveSubscriptions: record.liveSubscriptions,
    };
  });
}

async function open(
  page: Page,
  address: string,
  width: number = 1280,
): Promise<void> {
  await page.setViewportSize({ width: width, height: 900 });
  await page.goto(address);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
}

// How many times the list of a table has been read.
async function reads(page: Page, tableName: string): Promise<number> {
  return (await fixture(page)).listRequests.filter(
    (request: { tableName: string }): boolean => {
      return request.tableName === tableName;
    },
  ).length;
}

async function announce(
  page: Page,
  tableName: string,
  eventType: string,
): Promise<void> {
  await page.evaluate(
    ({ table, event }: { table: string; event: string }): void => {
      (window as unknown as FixtureWindow).__fixture.announce(table, event);
    },
    { table: tableName, event: eventType },
  );
}

async function declareIncident(page: Page, title: string): Promise<void> {
  await page.evaluate((name: string): void => {
    (window as unknown as FixtureWindow).__fixture.declareIncident(name);
  }, title);
}

async function raiseAlert(page: Page, title: string): Promise<void> {
  await page.evaluate((name: string): void => {
    (window as unknown as FixtureWindow).__fixture.raiseAlert(name);
  }, title);
}

function incidentRows(page: Page): Locator {
  return page.locator("#incidents-table-body > tr");
}

test.describe("the Incidents list keeps itself current", () => {
  test("it listens for the project's created, changed and deleted incidents", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const live: Array<string> = (await fixture(page)).liveSubscriptions
      .filter((subscription: LiveSubscription): boolean => {
        return !subscription.isStopped && subscription.tableName === "Incident";
      })
      .map((subscription: LiveSubscription): string => {
        return `${subscription.eventType} ${subscription.tenantId}`;
      });

    expect(live).toEqual([
      `Create ${PROJECT}`,
      `Update ${PROJECT}`,
      `Delete ${PROJECT}`,
    ]);
  });

  test("an incident declared elsewhere shows up first, without Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);
    const rowsBefore: number = await incidentRows(page).count();
    const readsBefore: number = await reads(page, "Incident");

    await declareIncident(page, "Payments API returns 500 for every card");
    await announce(page, "Incident", "Create");

    await expect(incidentRows(page).first()).toContainText(
      "Payments API returns 500 for every card",
    );
    await expect(incidentRows(page)).toHaveCount(rowsBefore + 1);
    expect(await reads(page, "Incident")).toBe(readsBefore + 1);
    // Still on the list: nothing was opened or reloaded.
    expect(new URL(page.url()).pathname).toBe(INCIDENTS);

    await fs.mkdir(SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOTS, "live-incidents-list-synthetic.png"),
      fullPage: true,
      animations: "disabled",
    });
  });

  test("the rows stay in sight, undimmed and answering clicks, while the list reads", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Every read takes a while here, so the read can be watched mid-way.
    await open(page, `${INCIDENTS}?delay=1500`);

    await declareIncident(page, "Search results empty for some queries");
    await announce(page, "Incident", "Create");

    // Mid-read: the rows that were there are there, and nothing loads.
    await page.waitForTimeout(400);
    const content: Locator = page.getByTestId("table-content");
    await expect(content).not.toHaveClass(/opacity-60/);
    await expect(content).not.toHaveClass(/pointer-events-none/);
    await expect(page.getByTestId("table-skeleton-loader")).toHaveCount(0);
    expect(await incidentRows(page).count()).toBeGreaterThan(0);

    await expect(incidentRows(page).first()).toContainText(
      "Search results empty for some queries",
      { timeout: 10000 },
    );
  });

  test("a burst of changes reads once at once and once more after five seconds", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);
    const readsBefore: number = await reads(page, "Incident");

    for (let change: number = 0; change < 25; change += 1) {
      await announce(page, "Incident", "Update");
    }

    await expect
      .poll(() => {
        return reads(page, "Incident");
      })
      .toBe(readsBefore + 1);

    // Not once per change: nothing more for a while...
    await page.waitForTimeout(3000);
    expect(await reads(page, "Incident")).toBe(readsBefore + 1);

    // ...then one more read, which counts every change that came after.
    await expect
      .poll(
        () => {
          return reads(page, "Incident");
        },
        { timeout: 8000 },
      )
      .toBe(readsBefore + 2);
  });

  test("rows ticked for a bulk action stay put until the reader unticks them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const selectAll: Locator = page.getByRole("checkbox", {
      name: "Select all items",
    });
    await selectAll.check();

    const readsBefore: number = await reads(page, "Incident");
    await declareIncident(page, "Order queue backing up");
    await announce(page, "Incident", "Create");

    await page.waitForTimeout(3000);
    expect(await reads(page, "Incident")).toBe(readsBefore);
    await expect(page.getByText("Order queue backing up")).toHaveCount(0);

    await selectAll.uncheck();

    await expect(incidentRows(page).first()).toContainText(
      "Order queue backing up",
      { timeout: 8000 },
    );
  });

  test("an open row menu holds the rows until it closes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    await incidentRows(page)
      .first()
      .getByRole("button", { name: /More actions/ })
      .click();
    await expect(page.getByRole("menu")).toBeVisible();

    const readsBefore: number = await reads(page, "Incident");
    await declareIncident(page, "Webhook deliveries failing");
    await announce(page, "Incident", "Create");

    await page.waitForTimeout(3000);
    expect(await reads(page, "Incident")).toBe(readsBefore);
    // The menu the reader opened is still open, on the row they opened it on.
    await expect(page.getByRole("menu")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await expect(incidentRows(page).first()).toContainText(
      "Webhook deliveries failing",
      { timeout: 8000 },
    );
  });

  test("on a phone the new incident's card shows up first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS, 390);

    await declareIncident(page, "Login page down");
    await announce(page, "Incident", "Create");

    await expect(page.getByText("Login page down").first()).toBeVisible();
    const pageWidth: number = await page.evaluate((): number => {
      return document.documentElement.scrollWidth;
    });
    expect(pageWidth).toBeLessThanOrEqual(390);
  });
});

test.describe("other lists", () => {
  test("the Alerts list shows a new alert without Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, ALERTS);

    await raiseAlert(page, "Disk 92% full on logs-02");
    await announce(page, "Alert", "Create");

    await expect(page.locator("#alerts-table-body > tr").first()).toContainText(
      "Disk 92% full on logs-02",
    );
  });

  test("the Monitors list listens for nothing: monitors do not announce their changes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, MONITORS);

    expect(
      (await fixture(page)).liveSubscriptions.filter(
        (subscription: LiveSubscription): boolean => {
          return (
            !subscription.isStopped && subscription.tableName === "Monitor"
          );
        },
      ),
    ).toEqual([]);
  });
});
