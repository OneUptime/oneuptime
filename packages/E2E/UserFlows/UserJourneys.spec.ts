import { Locator, Page, expect, test } from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

/*
 * One person's journeys in a real browser (issue #5375): the production page,
 * engine and URL state, fed PEOPLE in Fixture/Fixture.js. Every number below
 * is worked out by hand from that table, never read back from the engine.
 */

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/user-flows-ui",
);
const applicationRoute: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/rum/20000000-0000-4000-8000-000000000001";
const flowsRoute: string = `${applicationRoute}/user-flows`;

const JANE: string = "jane@example.com";
const JANE_KEY: string = "a".repeat(64);
const SHARED_BROWSER: string = "c".repeat(32);
const JANE_CHECKOUT: string = "1".repeat(32);
const JANE_LOST: string = "3".repeat(32);

interface FixtureRequest {
  route: string;
  data: Record<string, unknown>;
}

const flowRequests: (page: Page) => Promise<Array<FixtureRequest>> = async (
  page: Page,
): Promise<Array<FixtureRequest>> => {
  return page.evaluate((): Array<FixtureRequest> => {
    return (
      window as unknown as {
        __userFlowFixture: { requests: Array<FixtureRequest> };
      }
    ).__userFlowFixture.requests.filter((request: FixtureRequest): boolean => {
      return request.route === "user-flow";
    });
  });
};

const openFlows: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${flowsRoute}${query}`);
  await expect(page.getByTestId("user-flow-page")).toBeVisible();
};

const find: (page: Page, value: string) => Promise<void> = async (
  page: Page,
  value: string,
): Promise<void> => {
  await expect(page.getByTestId("user-flow-map")).toBeVisible();
  await page.getByTestId("user-flow-person-input").fill(value);
  await page.getByTestId("user-flow-person-input").press("Enter");
};

const journeys: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("user-flow-journey");
};

const journey: (page: Page, sessionId: string) => Locator = (
  page: Page,
  sessionId: string,
): Locator => {
  return page.locator(
    `[data-testid="user-flow-journey"][data-session-id="${sessionId}"]`,
  );
};

const visitsOf: (row: Locator) => Locator = (row: Locator): Locator => {
  return row.getByTestId("user-flow-visit");
};

test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true });
});

test.describe("User journeys", () => {
  test("finding someone shows their sessions, page by page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await find(page, JANE);

    await expect(page.getByTestId("user-flow-person-name")).toHaveText(JANE);
    await expect(page.getByTestId("user-flow-person-count")).toHaveText(
      "3 sessions in this range",
    );
    await expect(journeys(page)).toHaveCount(3);

    /* The tiles count the journeys: three sessions, eight pages. */
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "3",
    );
    /* /pricing > /cart > /checkout > /cart > /checkout/payment, /login > /account, / */
    await expect(page.getByTestId("user-flow-tile-pages-value")).toHaveText(
      "2.7",
    );

    /* The newest session starts open, with its journey in order. */
    const newest: Locator = journey(page, JANE_CHECKOUT);
    const visits: Locator = visitsOf(newest);

    await expect(visits).toHaveCount(5);
    await expect(
      newest.getByTestId("user-flow-journey-toggle"),
    ).toHaveAttribute("aria-expanded", "true");

    const pages: Array<string | null> = await visits.evaluateAll(
      (rows: Array<Element>): Array<string | null> => {
        return rows.map((row: Element): string | null => {
          return row.getAttribute("data-page");
        });
      },
    );

    expect(pages).toEqual([
      "/pricing",
      "/cart",
      "/checkout",
      "/cart",
      "/checkout/payment",
    ]);

    /* Landing page, repeated navigation and exit page, each said once. */
    await expect(visits.nth(0)).toContainText("Landing page");
    await expect(visits.nth(3)).toContainText("Visit 2 of 2");
    await expect(visits.nth(4)).toContainText("Exit page");
    await expect(newest.getByText("Landing page")).toHaveCount(1);
    await expect(newest.getByText("Exit page")).toHaveCount(1);

    /* Where they hit problems. */
    await expect(visits.nth(4)).toContainText("2 errors on this page");
    await expect(visits.nth(1)).toContainText(
      "1 frustration signal on this page",
    );
    /* A signal is known per page, so both visits to /cart say so. */
    await expect(visits.nth(3)).toContainText(
      "1 frustration signal on this page",
    );

    /* The session's own line sums it up. */
    await expect(newest).toContainText("2 errors");
    await expect(newest).toContainText("1 frustration signal");
    await expect(newest).toContainText("1 repeat visit");
    await expect(newest).toContainText("5 pages");

    /* The replay of that very session. */
    await expect(newest.getByTestId("user-flow-watch")).toHaveAttribute(
      "href",
      `${applicationRoute}/session-replay/${JANE_CHECKOUT}`,
    );

    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(artifacts, "user-flows-journeys.png"),
      fullPage: true,
    });
  });

  /*
   * The reference is typically an email, and a URL reaches history, shared
   * links and proxy logs. Only the digest may go there, and one read is
   * enough: the answer to the lookup already holds the journeys.
   */
  test("what was typed never reaches the address, and the link it becomes works", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await find(page, JANE);
    await expect(page.getByTestId("user-flow-person-name")).toHaveText(JANE);

    await expect(page).toHaveURL(new RegExp(`userKey=${JANE_KEY}`));
    expect(decodeURIComponent(page.url())).not.toContain("jane");

    const requests: Array<FixtureRequest> = await flowRequests(page);

    expect(requests).toHaveLength(2);
    expect(requests[0]!.data["filters"]).toBeUndefined();
    expect(requests[1]!.data["filters"]).toEqual({ identifier: JANE });

    /* The address is a link: a reload asks by digest and gets the name back. */
    await page.reload();
    await expect(page.getByTestId("user-flow-person-name")).toHaveText(JANE);
    await expect(journeys(page)).toHaveCount(3);

    const reloaded: Array<FixtureRequest> = await flowRequests(page);

    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.data["filters"]).toEqual({
      identifiedUserKey: JANE_KEY,
    });
  });

  test("only that person's activity is on the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await find(page, JANE);
    await expect(journeys(page)).toHaveCount(3);

    const text: string = await page.getByTestId("user-flow-page").innerText();

    /* Bob's only page, and the storefront's. */
    expect(text).not.toContain("/billing");
    expect(text).not.toContain("/collections");
    /* The window held 200 sessions; none of the other 197 is counted. */
    expect(text).not.toContain("200");
  });

  test("a session still recording has no exit page yet, and a lost one no replay", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${JANE_KEY}`);
    await expect(journeys(page)).toHaveCount(3);

    const live: Locator = journeys(page).nth(1);

    /* Folded rows still say how they went. */
    await expect(live.getByTestId("user-flow-journey-summary")).toHaveText(
      "/login → /account",
    );
    await expect(live).toContainText("Recording now");
    await expect(visitsOf(live)).toHaveCount(0);

    await live.getByTestId("user-flow-journey-toggle").click();
    await expect(visitsOf(live)).toHaveCount(2);
    await expect(visitsOf(live).nth(1)).toContainText("Last page so far");
    await expect(live.getByText("Exit page")).toHaveCount(0);

    /* Watch is offered only when there is something to watch. */
    const lost: Locator = journey(page, JANE_LOST);

    await expect(lost.getByTestId("user-flow-watch")).toHaveCount(0);
    await expect(lost.getByTestId("user-flow-no-replay")).toHaveText(
      "No replay",
    );
    await expect(lost.getByTestId("user-flow-no-replay")).toHaveAttribute(
      "title",
      /footage never arrived/,
    );

    /* One page: it is both where they landed and where they left. */
    await lost.getByTestId("user-flow-journey-toggle").click();
    await expect(visitsOf(lost)).toHaveCount(1);
    await expect(visitsOf(lost).first()).toContainText("Landing page");
    await expect(visitsOf(lost).first()).toContainText("Exit page");

    /* Folding works both ways. */
    await journey(page, JANE_CHECKOUT)
      .getByTestId("user-flow-journey-toggle")
      .click();
    await expect(visitsOf(journey(page, JANE_CHECKOUT))).toHaveCount(0);
  });

  test("device and session filters narrow the journeys without a new read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${JANE_KEY}`);
    await expect(journeys(page)).toHaveCount(3);

    const before: number = (await flowRequests(page)).length;

    await page.getByTestId("user-flow-device-filter").selectOption("mobile");
    await expect(journeys(page)).toHaveCount(1);
    await expect(page).toHaveURL(/device=mobile/);

    /* Jane's phone session has no errors, so nothing is left. */
    await page.getByTestId("user-flow-session-filter").selectOption("errors");
    await expect(journeys(page)).toHaveCount(0);
    await expect(page.getByTestId("user-flow-journeys-filtered")).toBeVisible();

    await page
      .getByTestId("user-flow-journeys-filtered")
      .getByText("Show all of them")
      .click();
    await expect(journeys(page)).toHaveCount(3);

    await page.getByTestId("user-flow-session-filter").selectOption("errors");
    await expect(journeys(page)).toHaveCount(1);
    await expect(journeys(page).first()).toHaveAttribute(
      "data-session-id",
      JANE_CHECKOUT,
    );

    expect(await flowRequests(page)).toHaveLength(before);
  });

  test("switches between the journeys, their flow map and everyone's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${JANE_KEY}`);
    await expect(journeys(page)).toHaveCount(3);

    /* Their flow map: the same read, drawn. */
    const before: number = (await flowRequests(page)).length;

    await page.getByTestId("user-flow-view-map").click();
    await expect(page.getByTestId("user-flow-map")).toBeVisible();
    await expect(page).toHaveURL(/view=map/);
    await expect(page.getByTestId("user-flow-view-map")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.locator(
        '[data-testid="user-flow-node"][data-page="/pricing"][data-step="0"]',
      ),
    ).toHaveAttribute("data-sessions", "1");
    expect(await flowRequests(page)).toHaveLength(before);

    /* The map stays theirs through a reload. */
    await page.reload();
    await expect(page.getByTestId("user-flow-map")).toBeVisible();
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "3",
    );

    /* A link off their map stays on them. */
    await page
      .locator(
        '[data-testid="user-flow-node"][data-page="/pricing"][data-step="0"]',
      )
      .click();
    await expect(
      page
        .getByTestId("user-flow-detail")
        .locator("a", { hasText: "All sessions that visited this page" }),
    ).toHaveAttribute("href", new RegExp(`userKey=${JANE_KEY}`));

    await page.getByTestId("user-flow-view-journeys").click();
    await expect(journeys(page)).toHaveCount(3);
    await expect(page).not.toHaveURL(/view=/);

    /* And back to everyone, with nothing of the person left behind. */
    await page.getByTestId("user-flow-person-clear").click();
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "200",
    );
    await expect(page.getByTestId("user-flow-person")).toHaveCount(0);
    await expect(page.getByTestId("user-flow-person-input")).toBeVisible();
    await expect(page).not.toHaveURL(/userKey=/);
  });

  test("a browser is one link, and each session says who it was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?visitor=${SHARED_BROWSER}`);

    await expect(page.getByTestId("user-flow-person-name")).toHaveText(
      "Visitor cccccc",
    );
    await expect(journeys(page)).toHaveCount(3);
    await expect(journeys(page).nth(0)).toContainText(JANE);
    await expect(journeys(page).nth(1)).toContainText("bob@example.com");
    await expect(journeys(page).nth(2)).toContainText("Visitor cccccc");

    await expect(page.getByTestId("user-flow-person-sessions")).toHaveAttribute(
      "href",
      new RegExp(`/session-replay\\?.*visitor=${SHARED_BROWSER}`),
    );
  });

  test("one session is a link too, and leads to everything that person did", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?sessionId=${JANE_CHECKOUT}`);

    await expect(page.getByTestId("user-flow-person-name")).toHaveText(
      "Session 11111111",
    );
    await expect(journeys(page)).toHaveCount(1);
    await expect(visitsOf(journeys(page).first())).toHaveCount(5);

    /* The session list filters by person, not to one session. */
    await expect(page.getByTestId("user-flow-person-sessions")).toHaveCount(0);

    await page.getByTestId("user-flow-person-owner").click();
    await expect(page.getByTestId("user-flow-person-name")).toHaveText(JANE);
    await expect(journeys(page)).toHaveCount(3);
    await expect(page).toHaveURL(new RegExp(`userKey=${JANE_KEY}`));
    await expect(page).not.toHaveURL(/sessionId=/);
  });

  test("a session id or a visitor id can be typed too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await find(page, JANE_CHECKOUT);

    await expect(page.getByTestId("user-flow-person-name")).toHaveText(
      "Session 11111111",
    );
    await expect(page).toHaveURL(new RegExp(`sessionId=${JANE_CHECKOUT}`));

    await page.getByTestId("user-flow-person-clear").click();
    await find(page, SHARED_BROWSER);
    await expect(page.getByTestId("user-flow-person-name")).toHaveText(
      "Visitor cccccc",
    );
    await expect(page).toHaveURL(new RegExp(`visitor=${SHARED_BROWSER}`));
  });

  test("nobody matching says so, and never shows everyone instead", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await find(page, "nobody@example.com");

    await expect(page.locator("#user-flow-person-empty")).toContainText(
      "No sessions match in this range",
    );
    await expect(page.locator("#user-flow-person-empty")).toContainText(
      "Browse Replay Users",
    );
    await expect(journeys(page)).toHaveCount(0);
    await expect(page.getByTestId("user-flow-tile-sessions")).toHaveCount(0);
    await expect(page.getByTestId("user-flow-person-name")).toHaveText(
      "nobody@example.com",
    );
    expect(decodeURIComponent(page.url())).not.toContain("nobody");

    await page.getByTestId("user-flow-person-clear").click();
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "200",
    );
  });

  test("a role that may not read identity is told so, and can still follow a link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, "?fixture=no-identity");
    await find(page, JANE);

    await expect(page.locator("#user-flow-person-empty")).toContainText(
      "Your role can't look people up by name",
    );

    await openFlows(page, `?fixture=no-identity&userKey=${JANE_KEY}`);
    await expect(journeys(page)).toHaveCount(3);
    await expect(page.getByTestId("user-flow-person-name")).toHaveText(
      "Hidden user",
    );
    await expect(page.getByTestId("user-flow-page")).not.toContainText(JANE);
  });

  test("a link with a value that could be nobody opens everyone's flows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, "?visitor=not-a-visitor&userKey=short");

    await expect(page.getByTestId("user-flow-map")).toBeVisible();
    await expect(page.getByTestId("user-flow-person")).toHaveCount(0);
    expect((await flowRequests(page))[0]!.data["filters"]).toBeUndefined();
  });

  test("Replay Users opens a person's journey, on the window they were counted in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${applicationRoute}/session-replay-users`);

    const row: Locator = page
      .locator(
        `[data-testid="session-user-row"][data-group-key="u:${JANE_KEY}"]`,
      )
      .first();

    await expect(row).toBeVisible();
    await row.getByTestId("row-actions-more-button").click();
    await page.getByRole("menuitem", { name: "View journey" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/user-flows\\?.*userKey=${JANE_KEY}`),
    );
    await expect(page.getByTestId("user-flow-person-name")).toHaveText(JANE);
    await expect(journeys(page)).toHaveCount(3);

    /* The Users page's window is a day, and it stays a day here. */
    const requests: Array<FixtureRequest> = await flowRequests(page);
    const last: FixtureRequest = requests[requests.length - 1]!;
    const windowMs: number =
      Date.parse(String(last.data["endTime"])) -
      Date.parse(String(last.data["startTime"]));

    expect(Math.round(windowMs / 3600000)).toBe(24);
  });

  test("the row of unlinked sessions offers no journey: it names nobody", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${applicationRoute}/session-replay-users`);

    const row: Locator = page
      .locator('[data-testid="session-user-row"][data-group-key=""]')
      .first();

    await expect(row).toBeVisible();
    await expect(row.getByText("View journey")).toHaveCount(0);
  });

  test("the journeys fit a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFlows(page, `?userKey=${JANE_KEY}`);
    await expect(journeys(page)).toHaveCount(3);

    const overflow: number = await page
      .getByTestId("user-flow-journeys")
      .evaluate((element: Element): number => {
        return element.scrollWidth - element.clientWidth;
      });

    expect(overflow).toBeLessThanOrEqual(1);

    /* The name is the point of the bar: it must not give way to the switch. */
    const nameCut: number = await page
      .getByTestId("user-flow-person-name")
      .evaluate((element: Element): number => {
        return element.scrollWidth - element.clientWidth;
      });

    expect(nameCut).toBeLessThanOrEqual(0);

    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(artifacts, "user-flows-journeys-phone.png"),
      fullPage: true,
    });
  });
});
