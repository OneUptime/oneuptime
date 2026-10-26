import { BrowserContext, Locator, Page, expect, test } from "@playwright/test";

/*
 * Two status pages, and two public dashboards, open side by side in one
 * browser, at their OneUptime addresses on one host (issue #5277): each tab
 * shows, refreshes, links to, signs in to and subscribes to the page its own
 * address names, whatever another tab opened since.
 *
 * Every tab of one browser shares that host's localStorage. The page id the
 * apps kept there was the id of whichever page a tab opened last, so a
 * minute after a second page was opened the first one drew the second one's
 * content under its own address, and its Subscribe form subscribed the
 * visitor to the second page.
 *
 * The fixture (Fixture/server.js) serves both real apps with their APIs
 * answered in the page, and records every request a tab makes - with the
 * page its address names and the header the real client would send - on
 * window.__sideBySideFixture.
 */

const statusPageId = (value: number): string => {
  return `5ba90000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

const dashboardId = (value: number): string => {
  return `da5b0000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

const PASSWORD: string = "open sesame";

interface FixturePage {
  id: string;
  title: string;
  name: string;
  resource: string;
}

// Pages.js: a public page that is up, one in an outage, and a private one.
const ACME: FixturePage = {
  id: statusPageId(1),
  title: "Acme Cloud Status",
  name: "Acme Cloud",
  resource: "Acme API",
};

const GLOBEX: FixturePage = {
  id: statusPageId(2),
  title: "Globex Payments Status",
  name: "Globex Payments",
  resource: "Globex Checkout",
};

const INITECH: FixturePage = {
  id: statusPageId(3),
  title: "Initech Intranet Status",
  name: "Initech Intranet",
  resource: "Initech VPN",
};

interface FixtureDashboard {
  id: string;
  title: string;
}

// Pages.js: one shared with anyone who has the link, two with a password.
const NORTH: FixtureDashboard = {
  id: dashboardId(1),
  title: "North Region Board",
};

const SOUTH: FixtureDashboard = {
  id: dashboardId(2),
  title: "South Region Board",
};

const WEST: FixtureDashboard = {
  id: dashboardId(3),
  title: "West Region Board",
};

interface FixtureRequest {
  method: string;
  path: string;
  route: string;
  pageId: string;
  statusPageIdHeader?: string;
  dashboardIdHeader?: string;
  data: unknown;
}

interface FixtureRecord {
  requests: Array<FixtureRequest>;
  unexpected: Array<string>;
}

const recordOf = async (page: Page): Promise<FixtureRecord> => {
  return await page.evaluate((): FixtureRecord => {
    return (window as unknown as { __sideBySideFixture: FixtureRecord })
      .__sideBySideFixture;
  });
};

const requestsTo = async (
  page: Page,
  route: string,
): Promise<Array<FixtureRequest>> => {
  return (await recordOf(page)).requests.filter(
    (request: FixtureRequest): boolean => {
      return request.route === route;
    },
  );
};

// Every request a tab made named one page: in its address and its header.
const expectOnlyRequestsFor = async (
  page: Page,
  data: { id: string; header: "statusPageIdHeader" | "dashboardIdHeader" },
): Promise<void> => {
  const record: FixtureRecord = await recordOf(page);

  expect(record.unexpected).toEqual([]);
  expect(record.requests.length).toBeGreaterThan(0);

  for (const request of record.requests) {
    expect(request.pageId, request.path).toBe(data.id);

    // The header goes with every request once the tab knows its page.
    if (request[data.header]) {
      expect(request[data.header], request.path).toBe(data.id);
    }
  }
};

// The ids a request body holds, wherever in it they are.
const idsIn = (value: unknown): Array<string> => {
  const text: string = JSON.stringify(value || {});
  const ids: Array<string> = [];

  for (const id of [ACME.id, GLOBEX.id, INITECH.id]) {
    if (text.indexOf(id) >= 0) {
      ids.push(id);
    }
  }

  return ids;
};

const openStatusPage = async (
  context: BrowserContext,
  statusPage: FixturePage,
  subPath: string = "",
): Promise<Page> => {
  const page: Page = await context.newPage();
  await page.goto(`/status-page/${statusPage.id}${subPath}`);
  return page;
};

const resourceOf = (page: Page, statusPage: FixturePage): Locator => {
  return page.getByText(statusPage.resource, { exact: true }).first();
};

const logoOf = (page: Page, statusPage: FixturePage): Locator => {
  return page.locator("#status-page-logo").getByAltText(statusPage.title);
};

// The status page a tab is drawing, by its logo and its resource.
const expectToShowStatusPage = async (
  page: Page,
  statusPage: FixturePage,
  others: Array<FixturePage>,
): Promise<void> => {
  await expect(resourceOf(page, statusPage)).toBeVisible();
  await expect(logoOf(page, statusPage)).toBeVisible();

  for (const other of others) {
    await expect(page.getByText(other.resource, { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByAltText(other.title)).toHaveCount(0);
  }
};

test.describe("Status pages open side by side", () => {
  test("each tab refreshes its own page, whatever page another tab opened", async ({
    context,
  }: {
    context: BrowserContext;
  }) => {
    // The minute between refreshes, played on the clock.
    await context.clock.install();

    const first: Page = await openStatusPage(context, ACME);
    await expectToShowStatusPage(first, ACME, [GLOBEX]);

    const second: Page = await openStatusPage(context, GLOBEX);
    await expectToShowStatusPage(second, GLOBEX, [ACME]);

    // The first tab, a minute on: its own page again, refreshed.
    await first.bringToFront();
    await context.clock.runFor(65 * 1000);

    await expect
      .poll(async () => {
        return (await requestsTo(first, "overview")).length;
      })
      .toBeGreaterThanOrEqual(2);

    await expectToShowStatusPage(first, ACME, [GLOBEX]);
    await expect(first).toHaveURL(new RegExp(`/status-page/${ACME.id}$`));
    await expectOnlyRequestsFor(first, {
      id: ACME.id,
      header: "statusPageIdHeader",
    });

    // And the second tab, a minute on, its own.
    await second.bringToFront();
    await context.clock.runFor(65 * 1000);

    await expect
      .poll(async () => {
        return (await requestsTo(second, "overview")).length;
      })
      .toBeGreaterThanOrEqual(2);

    await expectToShowStatusPage(second, GLOBEX, [ACME]);
    await expectOnlyRequestsFor(second, {
      id: GLOBEX.id,
      header: "statusPageIdHeader",
    });
  });

  test("each tab's links, and its Subscribe form, are for its own page", async ({
    context,
  }: {
    context: BrowserContext;
  }) => {
    const first: Page = await openStatusPage(context, ACME);
    await expectToShowStatusPage(first, ACME, [GLOBEX]);

    const second: Page = await openStatusPage(context, GLOBEX);
    await expectToShowStatusPage(second, GLOBEX, [ACME]);

    // Back in the first tab: every link of its navigation is its own page's.
    await first.bringToFront();
    await first.locator("#subscribe-nav-bar-item").click();

    await expect(first).toHaveURL(
      new RegExp(`/status-page/${ACME.id}/subscribe/email$`),
    );
    await expect(logoOf(first, ACME)).toBeVisible();

    // The desktop navigation's items (the phone's copies are "mobile-...").
    const navLinks: Array<string> = await first
      .locator("a[id$='-nav-bar-item']:not([id^='mobile-'])")
      .evaluateAll((links: Array<Element>): Array<string> => {
        return links.map((link: Element): string => {
          return link.getAttribute("href") || "";
        });
      });

    expect(navLinks.length).toBeGreaterThan(0);

    for (const href of navLinks) {
      expect(href.startsWith(`/status-page/${ACME.id}`), href).toBe(true);
    }

    // Subscribing there subscribes to that page, and to no other.
    await first.getByLabel("Your Email").fill("visitor@example.com");
    await first.getByRole("button", { name: "Subscribe", exact: true }).click();

    await expect(first.getByText("An email with the link")).toBeVisible();

    const subscriptions: Array<FixtureRequest> = await requestsTo(
      first,
      "subscribe",
    );

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.method).toBe("POST");
    expect(subscriptions[0]!.pageId).toBe(ACME.id);
    expect(subscriptions[0]!.statusPageIdHeader).toBe(ACME.id);
    expect(idsIn(subscriptions[0]!.data)).toEqual([ACME.id]);

    await expectOnlyRequestsFor(first, {
      id: ACME.id,
      header: "statusPageIdHeader",
    });

    // The logo leads back to this page's overview.
    await logoOf(first, ACME).click();
    await expect(first).toHaveURL(new RegExp(`/status-page/${ACME.id}$`));
    await expectToShowStatusPage(first, ACME, [GLOBEX]);

    // The second tab subscribes to its own page.
    await second.bringToFront();
    await second.locator("#subscribe-nav-bar-item").click();
    await expect(second).toHaveURL(
      new RegExp(`/status-page/${GLOBEX.id}/subscribe/email$`),
    );
    await second.getByLabel("Your Email").fill("visitor@example.com");
    await second
      .getByRole("button", { name: "Subscribe", exact: true })
      .click();
    await expect(second.getByText("An email with the link")).toBeVisible();

    const secondSubscriptions: Array<FixtureRequest> = await requestsTo(
      second,
      "subscribe",
    );

    expect(secondSubscriptions).toHaveLength(1);
    expect(secondSubscriptions[0]!.pageId).toBe(GLOBEX.id);
    expect(idsIn(secondSubscriptions[0]!.data)).toEqual([GLOBEX.id]);
  });

  test("a private page's password opens that page, whatever page another tab opened", async ({
    context,
  }: {
    context: BrowserContext;
  }) => {
    const first: Page = await openStatusPage(context, INITECH);

    await expect(first).toHaveURL(
      new RegExp(`/status-page/${INITECH.id}/master-password`),
    );
    await expect(first.getByTestId("master-password-title")).toHaveText(
      INITECH.title,
    );

    const second: Page = await openStatusPage(context, ACME);
    await expectToShowStatusPage(second, ACME, [INITECH]);

    await first.bringToFront();
    await first.getByLabel("Password").fill(PASSWORD);
    await first.getByRole("button", { name: "Unlock Status Page" }).click();

    // The private page itself, not its password prompt again.
    await expect(resourceOf(first, INITECH)).toBeVisible();
    await expect(first).toHaveURL(new RegExp(`/status-page/${INITECH.id}/?$`));
    await expect(first.getByTestId("master-password-title")).toHaveCount(0);
    await expectOnlyRequestsFor(first, {
      id: INITECH.id,
      header: "statusPageIdHeader",
    });

    // The public page in the other tab is as it was.
    await second.bringToFront();
    await second.reload();
    await expectToShowStatusPage(second, ACME, [INITECH]);
  });

  test("another status page's address, reached inside the app, opens that page in full", async ({
    context,
  }: {
    context: BrowserContext;
  }) => {
    const page: Page = await openStatusPage(context, ACME);
    await expectToShowStatusPage(page, ACME, [GLOBEX]);

    // A move inside the app (history, not a page load) to another page.
    await page.evaluate((address: string): void => {
      window.history.pushState({}, "", address);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/status-page/${GLOBEX.id}`);

    // That page, with its own logo and content: not one page's over another's.
    await expectToShowStatusPage(page, GLOBEX, [ACME]);
    await expect(page).toHaveURL(new RegExp(`/status-page/${GLOBEX.id}$`));
    await expect
      .poll(async () => {
        return (await requestsTo(page, "master-page")).map(
          (request: FixtureRequest): string => {
            return request.pageId;
          },
        );
      })
      .toEqual([GLOBEX.id]);
    await expectOnlyRequestsFor(page, {
      id: GLOBEX.id,
      header: "statusPageIdHeader",
    });
  });
});

const openDashboard = async (
  context: BrowserContext,
  board: FixtureDashboard,
): Promise<Page> => {
  const page: Page = await context.newPage();
  await page.goto(`/public-dashboard/${board.id}`);
  return page;
};

// The dashboard a tab is drawing: its header, and its board's text widget.
const expectToShowDashboard = async (
  page: Page,
  board: FixtureDashboard,
  others: Array<FixtureDashboard>,
): Promise<void> => {
  await expect(
    page
      .getByTestId("public-dashboard-header")
      .getByRole("heading", { name: board.title, exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("public-dashboard-board")
      .getByRole("heading", { name: board.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("master-password-title")).toHaveCount(0);

  for (const other of others) {
    await expect(page.getByText(other.title, { exact: true })).toHaveCount(0);
  }
};

const expectPasswordPrompt = async (
  page: Page,
  board: FixtureDashboard,
): Promise<void> => {
  await expect(page).toHaveURL(
    new RegExp(`/public-dashboard/${board.id}/master-password`),
  );
  await expect(page.getByTestId("master-password-title")).toHaveText(
    board.title,
  );
};

const unlock = async (page: Page): Promise<void> => {
  await page.bringToFront();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock Dashboard" }).click();
};

test.describe("Public dashboards open side by side", () => {
  test("a dashboard's password opens that dashboard, whatever dashboard another tab opened", async ({
    context,
  }: {
    context: BrowserContext;
  }) => {
    const first: Page = await openDashboard(context, SOUTH);
    await expectPasswordPrompt(first, SOUTH);

    const second: Page = await openDashboard(context, NORTH);
    await expectToShowDashboard(second, NORTH, [SOUTH]);

    await unlock(first);

    // The dashboard itself, not its password prompt again.
    await expectToShowDashboard(first, SOUTH, [NORTH]);
    await expect(first).toHaveURL(new RegExp(`/public-dashboard/${SOUTH.id}$`));
    await expectOnlyRequestsFor(first, {
      id: SOUTH.id,
      header: "dashboardIdHeader",
    });

    await second.bringToFront();
    await second.reload();
    await expectToShowDashboard(second, NORTH, [SOUTH]);
    await expectOnlyRequestsFor(second, {
      id: NORTH.id,
      header: "dashboardIdHeader",
    });
  });

  test("two dashboards behind passwords each ask for, and open with, their own", async ({
    context,
  }: {
    context: BrowserContext;
  }) => {
    const first: Page = await openDashboard(context, SOUTH);
    await expectPasswordPrompt(first, SOUTH);

    const second: Page = await openDashboard(context, WEST);
    await expectPasswordPrompt(second, WEST);

    await unlock(first);
    await expectToShowDashboard(first, SOUTH, [WEST]);

    // Unlocking one opened nothing else: the other still asks for its own.
    await second.bringToFront();
    await second.reload();
    await expectPasswordPrompt(second, WEST);

    await unlock(second);
    await expectToShowDashboard(second, WEST, [SOUTH]);

    for (const [page, board] of [
      [first, SOUTH],
      [second, WEST],
    ] as Array<[Page, FixtureDashboard]>) {
      const unlocks: Array<FixtureRequest> = (await recordOf(page)).requests;

      await expectOnlyRequestsFor(page, {
        id: board.id,
        header: "dashboardIdHeader",
      });
      expect(unlocks.length).toBeGreaterThan(0);
    }
  });
});
