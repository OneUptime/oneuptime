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
 * ticked, a dialog or a menu open, or the pointer on its way to a row. A
 * row stays itself as the rows move (the keyboard stays on the incident it
 * was on), and a new row is tinted for a moment, the tint fading.
 */

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const INCIDENTS: string = `/dashboard/${PROJECT}/incidents`;
const ALERTS: string = `/dashboard/${PROJECT}/alerts`;
const MONITORS: string = `/dashboard/${PROJECT}/monitors`;

const NOW: Date = new Date("2026-10-16T05:35:00.000Z");

// An incident's number as a row shows it.
const INCIDENT_NUMBER: RegExp = /INC-\d+/;

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

// The server announcing a change, with the record's id when it names one.
async function announce(
  page: Page,
  tableName: string,
  eventType: string,
  id?: string,
): Promise<void> {
  await page.evaluate(
    ({
      table,
      event,
      modelId,
    }: {
      table: string;
      event: string;
      modelId: string;
    }): void => {
      (window as unknown as FixtureWindow).__fixture.announce(
        table,
        event,
        modelId,
      );
    },
    { table: tableName, event: eventType, modelId: id || "" },
  );
}

// Someone else declares an incident; its id, as the server would announce it.
async function declareIncident(page: Page, title: string): Promise<string> {
  return await page.evaluate((name: string): string => {
    return (window as unknown as FixtureWindow).__fixture.declareIncident(name);
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

// Whether a computed colour paints over what is behind it.
function isOpaque(colour: string): boolean {
  if (colour.startsWith("rgba(")) {
    return colour.endsWith(", 1)");
  }

  // rgb(), and oklab()/color() with no alpha.
  return !colour.includes("/");
}

const TRANSPARENT: string = "rgba(0, 0, 0, 0)";

// The background of a row's first cell and of its Actions cell.
async function cellColours(
  row: Locator,
): Promise<{ first: string; actions: string }> {
  return await row.evaluate(
    (element: Element): { first: string; actions: string } => {
      const cells: Array<Element> = Array.from(element.children);

      return {
        first: getComputedStyle(cells[0]!).backgroundColor,
        actions: getComputedStyle(cells[cells.length - 1]!).backgroundColor,
      };
    },
  );
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

  /*
   * Keyed by their position, the rows kept their elements where they were
   * as a new incident pushed them down: the View the keyboard was on became
   * the next incident's, and Enter opened that one.
   */
  test("the keyboard stays on the incident it was on as a new one is read in above it, and Enter opens that one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const second: Locator = incidentRows(page).nth(1);
    const number: string =
      ((await second.innerText()).match(INCIDENT_NUMBER) || [""])[0] || "";
    expect(number).not.toBe("");

    await second.getByRole("button", { name: "View" }).focus();

    await declareIncident(page, "Payments API returns 500 for every card");
    await announce(page, "Incident", "Create");
    await expect(incidentRows(page).first()).toContainText(
      "Payments API returns 500 for every card",
    );

    // The focused View is still the one of the incident it was on.
    const focusedRow: string = await page.evaluate((): string => {
      const row: Element | null = document.activeElement?.closest("tr") || null;
      return row ? (row as HTMLElement).innerText : "";
    });
    expect(focusedRow).toContain(number);
    expect(focusedRow).not.toContain("Payments API returns 500 for every card");

    await page.keyboard.press("Enter");

    const navigations: Array<string> = await page.evaluate(
      (): Array<string> => {
        return (
          window as unknown as { __fixture: { navigations: Array<string> } }
        ).__fixture.navigations;
      },
    );
    expect(navigations[navigations.length - 1]).toContain(
      "/incidents/40000000-0000-4000-8000-000000000001",
    );
  });

  /*
   * A row read in above the one under the pointer moves it as it is
   * clicked, and the click opens the next incident. While the pointer is at
   * work on the rows the list waits; it reads once the pointer has rested.
   */
  test("the pointer on its way to a row holds the rows; they read once it rests", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const view: Locator = incidentRows(page)
      .nth(1)
      .getByRole("button", { name: "View" });
    await view.hover();

    const readsBefore: number = await reads(page, "Incident");
    await declareIncident(page, "Search results empty for some queries");
    await announce(page, "Incident", "Create");

    // On its way: a few moves over the row, as a hand nears a click.
    for (let step: number = 0; step < 4; step += 1) {
      await page.waitForTimeout(300);
      const box: { x: number; y: number } | null = await view.boundingBox();
      await page.mouse.move(box!.x + 6 + step, box!.y + 6);
    }

    expect(await reads(page, "Incident")).toBe(readsBefore);
    await expect(
      page.getByText("Search results empty for some queries"),
    ).toHaveCount(0);

    // At rest: the list reads.
    await expect(incidentRows(page).first()).toContainText(
      "Search results empty for some queries",
      { timeout: 10000 },
    );
  });

  test("a new incident is tinted for a moment, its Actions cell opaque, and then looks like every other row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, INCIDENTS);

    const created: string = await declareIncident(
      page,
      "Checkout API returns 502 for EU customers",
    );
    await announce(page, "Incident", "Create", created);

    const arrived: Locator = page.locator(
      '#incidents-table-body > tr[data-row-arrived="true"]',
    );
    await expect(arrived).toHaveCount(1);
    await expect(arrived).toContainText(
      "Checkout API returns 502 for EU customers",
    );

    const tinted: { first: string; actions: string } =
      await cellColours(arrived);
    const plain: { first: string; actions: string } = await cellColours(
      incidentRows(page).nth(1),
    );

    // Its cells are tinted; the rows that were there are not.
    expect(tinted.first).not.toBe(TRANSPARENT);
    expect(plain.first).toBe(TRANSPARENT);
    /*
     * The Actions cell, which sticks over the cells that scroll under it,
     * never lets them show through.
     */
    expect(isOpaque(tinted.actions)).toBe(true);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "live-incidents-arrived-synthetic.png"),
    });

    // The mark goes with the tint.
    await expect(arrived).toHaveCount(0, { timeout: 5000 });
    expect((await cellColours(incidentRows(page).first())).first).toBe(
      TRANSPARENT,
    );
  });

  test("in the dark theme the tint is the dark card's own, and the Actions cell stays opaque", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, `${INCIDENTS}?theme=dark`);

    const created: string = await declareIncident(
      page,
      "Checkout API returns 502 for EU customers",
    );
    await announce(page, "Incident", "Create", created);

    const arrived: Locator = page.locator(
      '#incidents-table-body > tr[data-row-arrived="true"]',
    );
    await expect(arrived).toHaveCount(1);

    const tinted: { first: string; actions: string } =
      await cellColours(arrived);

    expect(tinted.first).not.toBe(TRANSPARENT);
    expect(isOpaque(tinted.actions)).toBe(true);

    await page.screenshot({
      path: path.join(SCREENSHOTS, "live-incidents-arrived-dark-synthetic.png"),
    });
  });

  test("a reader who asks for less motion gets the tint held still, then gone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, INCIDENTS);

    const created: string = await declareIncident(
      page,
      "Checkout API returns 502 for EU customers",
    );
    await announce(page, "Incident", "Create", created);

    const arrived: Locator = page.locator(
      '#incidents-table-body > tr[data-row-arrived="true"]',
    );
    await expect(arrived).toHaveCount(1);

    const animations: number = await arrived.evaluate(
      (element: Element): number => {
        return element.querySelector("td")!.getAnimations().length;
      },
    );
    expect(animations).toBe(0);
    expect((await cellColours(arrived)).first).not.toBe(TRANSPARENT);

    await expect(arrived).toHaveCount(0, { timeout: 5000 });
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
