import { Locator, Page, expect, test } from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

/*
 * User Flows in a real browser: the production page, flow-map engine,
 * layout, tables and URL state, fed the deterministic 200-session storefront
 * in Fixture/Fixture.js. Every number asserted below is worked out by hand
 * from the templates documented there, never read back from the engine.
 */

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/user-flows-ui",
);
const applicationRoute: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/rum/20000000-0000-4000-8000-000000000001";
const flowsRoute: string = `${applicationRoute}/user-flows`;

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

const node: (page: Page, pageKey: string, step: number) => Locator = (
  page: Page,
  pageKey: string,
  step: number,
): Locator => {
  return page.locator(
    `[data-testid="user-flow-node"][data-page="${pageKey}"][data-step="${step}"]`,
  );
};

const link: (page: Page, from: string, to: string) => Locator = (
  page: Page,
  from: string,
  to: string,
): Locator => {
  return page.locator(
    `[data-testid="user-flow-link"][data-from="${from}"][data-to="${to}"]`,
  );
};

const openFlows: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${flowsRoute}${query}`);
  await expect(page.getByTestId("user-flow-page")).toBeVisible();
};

const waitForMap: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await expect(page.getByTestId("user-flow-map")).toBeVisible();
};

test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true });
});

test.describe("User Flows", () => {
  test("draws the storefront's journeys from the session start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    /* One request, for the default week, scoped to this application. */
    const requests: Array<FixtureRequest> = await flowRequests(page);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.data["rumApplicationId"]).toBe(
      "20000000-0000-4000-8000-000000000001",
    );
    const windowMs: number =
      Date.parse(String(requests[0]!.data["endTime"])) -
      Date.parse(String(requests[0]!.data["startTime"]));

    expect(Math.round(windowMs / 86400000)).toBe(7);

    /* Summary tiles. */
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "200",
    );
    /* 40 of 200 sessions never left the landing page. */
    await expect(page.getByTestId("user-flow-tile-bounce-value")).toHaveText(
      "20%",
    );
    await expect(page.getByTestId("user-flow-tile-entry-value")).toHaveText(
      "/",
    );

    /*
     * Step 0: A+B+C+D+F+H = 166 start on "/", E's 20 on a product page
     * (grouped as /products/:id), G's 14 on /collections.
     */
    await expect(node(page, "/", 0)).toHaveAttribute("data-sessions", "166");

    /* Five columns fit the card at this width: nothing scrolls sideways. */
    const mapOverflow: number = await page
      .getByTestId("user-flow-map")
      .locator("div.overflow-x-auto")
      .evaluate((element: Element): number => {
        return element.scrollWidth - element.clientWidth;
      });

    expect(mapOverflow).toBeLessThanOrEqual(1);
    await expect(node(page, "/checkout", 4)).toBeInViewport();
    await expect(node(page, "/products/:id", 0)).toHaveAttribute(
      "data-sessions",
      "20",
    );
    await expect(node(page, "/collections", 0)).toHaveAttribute(
      "data-sessions",
      "14",
    );

    /* "/" -> /collections carries B+C; "/cart/" and "/cart" are one page. */
    await expect(link(page, "/", "/collections")).toHaveAttribute(
      "data-sessions",
      "80",
    );
    await expect(node(page, "/cart", 3)).toHaveAttribute("data-sessions", "80");
    await expect(
      page.locator('[data-testid="user-flow-node"][data-page="/cart/"]'),
    ).toHaveCount(0);

    /* The 40 bounces leave from "/" as a drop-off stub. */
    await expect(
      page.locator('[data-testid="user-flow-stub-exit"][data-sessions="40"]'),
    ).toHaveCount(1);

    /* Hovering a band names the transition. */
    await link(page, "/", "/collections").hover({ force: true });
    await expect(page.getByTestId("user-flow-tooltip")).toContainText(
      "sessions",
    );

    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(artifacts, "user-flows-overview.png"),
      fullPage: true,
    });
  });

  test("names the findings worth reading first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    const insight: (kind: string) => Locator = (kind: string): Locator => {
      return page.locator(
        `[data-testid="user-flow-insight"][data-kind="${kind}"]`,
      );
    };

    /* 30 of the 80 sessions that reached payment hit its error: 38%. */
    await expect(insight("error-hotspot")).toContainText("/checkout/payment");
    await expect(insight("error-hotspot")).toContainText("38%");
    /*
     * The same 30 left there - and the confirmation page, /account and /help,
     * which every visitor ends on, are natural ends, not drop-offs.
     */
    await expect(insight("drop-off")).toContainText("/checkout/payment");
    await expect(insight("drop-off")).toHaveAttribute(
      "data-focus-direction",
      "backward",
    );
    /* Four findings at once; the landing-page note repeats a tile. */
    await expect(page.getByTestId("user-flow-insight")).toHaveCount(4);
    await expect(insight("top-entry")).toHaveCount(0);
    /* D's 20 sessions bounce between search and a product: the top loop. */
    await expect(insight("loop")).toContainText("/search");
    await expect(insight("loop")).toContainText("/products/:id");
    /* G's 14 frustrated sessions on /collections, out of 94 visitors. */
    await expect(insight("frustration-hotspot")).toContainText("/collections");
    await expect(insight("frustration-hotspot")).toContainText("15%");

    /* The drop-off opens the map on how people got there. */
    await insight("drop-off").click();
    await expect(page).toHaveURL(/page=%2Fcheckout%2Fpayment/);
    await expect(page).toHaveURL(/dir=backward/);
    await expect(page.getByTestId("user-flow-mode-backward")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(node(page, "/checkout/payment", 0)).toHaveAttribute(
      "data-sessions",
      "80",
    );
    await expect(node(page, "/checkout", 1)).toHaveAttribute(
      "data-sessions",
      "80",
    );
    await expect(node(page, "/cart", 2)).toHaveAttribute("data-sessions", "80");

    /* Backward maps are drawn right to left: the anchor is rightmost. */
    const anchorBox: { x: number } | null = await node(
      page,
      "/checkout/payment",
      0,
    ).boundingBox();
    const earlierBox: { x: number } | null = await node(
      page,
      "/checkout",
      1,
    ).boundingBox();

    expect(anchorBox!.x).toBeGreaterThan(earlierBox!.x);

    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(artifacts, "user-flows-before-payment.png"),
      fullPage: true,
    });
  });

  test("a page's detail panel shows where people go next and links to their sessions", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, "?page=%2Fcheckout%2Fpayment");
    await waitForMap(page);

    await expect(page.getByTestId("user-flow-mode-forward")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("user-flow-anchor-select")).toHaveValue(
      "/checkout/payment",
    );

    /* Forward from payment: 50 confirm the order, 30 leave. */
    await expect(
      link(page, "/checkout/payment", "/order/confirmed"),
    ).toHaveAttribute("data-sessions", "50");
    await expect(
      page.locator('[data-testid="user-flow-stub-exit"][data-sessions="30"]'),
    ).toHaveCount(1);

    await node(page, "/checkout/payment", 0).click();

    const detail: Locator = page.getByTestId("user-flow-detail");

    await expect(detail).toBeVisible();
    await expect(page.getByTestId("user-flow-detail-title")).toHaveText(
      "/checkout/payment",
    );
    await expect(page.getByTestId("user-flow-detail-sessions")).toContainText(
      "80",
    );
    await expect(page.getByTestId("user-flow-detail-dropoff")).toContainText(
      "30",
    );
    await expect(page.getByTestId("user-flow-detail-dropoff")).toContainText(
      "38% drop-off",
    );
    await expect(page.getByTestId("user-flow-previous-pages")).toContainText(
      "/checkout",
    );
    await expect(page.getByTestId("user-flow-next-pages")).toContainText(
      "/order/confirmed",
    );

    /* Every sample is a link into the player for that session. */
    const samples: Locator = page
      .getByTestId("user-flow-sample-sessions")
      .locator("a");

    await expect(samples.first()).toBeVisible();
    await expect(samples.first()).toHaveAttribute(
      "href",
      new RegExp(`${applicationRoute}/session-replay/[0-9a-f]{32}$`),
    );

    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(artifacts, "user-flows-page-detail.png"),
      fullPage: true,
    });

    /* "All sessions that visited this page" opens the list, prefiltered. */
    await detail.getByText("All sessions that visited this page").click();
    await expect(page).toHaveURL(
      new RegExp(
        `${applicationRoute}/session-replay\\?.*urlPrefix=%2Fcheckout%2Fpayment`,
      ),
    );
  });

  test("clicking a band explains the transition", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    /* Keyboard: every band is focusable and Enter selects it. */
    await link(page, "/", "/collections").focus();
    await page.keyboard.press("Enter");

    const detail: Locator = page.getByTestId("user-flow-detail");

    await expect(detail).toHaveAttribute("data-kind", "link");
    await expect(page.getByTestId("user-flow-detail-title")).toHaveText(
      "/ → /collections",
    );
    await expect(page.getByTestId("user-flow-detail-sessions")).toContainText(
      "80",
    );

    /* Closing clears the selection. */
    await page.getByRole("button", { name: "Close details" }).click();
    await expect(detail).toHaveCount(0);
  });

  test("controls re-draw locally, and every one of them survives a reload", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    /* Hide the login interstitial: "/" now leads straight to /account. */
    await node(page, "/login", 1).click();
    await page.getByTestId("user-flow-hide-page").click();
    await expect(page.getByTestId("user-flow-hidden-pages")).toContainText(
      "/login",
    );
    await expect(node(page, "/login", 1)).toHaveCount(0);
    await expect(link(page, "/", "/account")).toHaveAttribute(
      "data-sessions",
      "16",
    );

    /* Without grouping, product ids are their own pages. */
    await page.getByTestId("user-flow-group-ids").uncheck();
    await expect(node(page, "/products/:id", 0)).toHaveCount(0);
    await expect(
      page
        .locator(
          '[data-testid="user-flow-node"][data-step="0"][data-page^="/products/"]',
        )
        .first(),
    ).toBeVisible();
    await page.getByTestId("user-flow-group-ids").check();

    /* Mobile only: every third session (index % 3 === 1) is mobile. */
    await page.getByTestId("user-flow-device-filter").selectOption("mobile");
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "67",
    );

    /* Only sessions with errors: C's 30. */
    await page.getByTestId("user-flow-device-filter").selectOption("");
    await page.getByTestId("user-flow-session-filter").selectOption("errors");
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "30",
    );
    await page.getByTestId("user-flow-session-filter").selectOption("all");

    /* Seven steps reach the confirmation page at the end of B. */
    await page.getByTestId("user-flow-steps-select").selectOption("7");
    await expect(node(page, "/order/confirmed", 6)).toHaveAttribute(
      "data-sessions",
      "50",
    );

    /* None of that asked the server again. */
    expect(await flowRequests(page)).toHaveLength(1);

    await expect(page).toHaveURL(/hide=%2Flogin/);
    await expect(page).toHaveURL(/steps=7/);

    await page.reload();
    await waitForMap(page);
    await expect(page.getByTestId("user-flow-hidden-pages")).toContainText(
      "/login",
    );
    await expect(page.getByTestId("user-flow-steps-select")).toHaveValue("7");
    await expect(link(page, "/", "/account")).toHaveAttribute(
      "data-sessions",
      "16",
    );
  });

  test("the time range comes from the URL and is what the server is asked for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, "?range=Past+1+Hour");
    await waitForMap(page);

    const requests: Array<FixtureRequest> = await flowRequests(page);
    const windowMs: number =
      Date.parse(String(requests[0]!.data["endTime"])) -
      Date.parse(String(requests[0]!.data["startTime"]));

    expect(Math.round(windowMs / 60000)).toBe(60);
  });

  test("the tables list paths, pages and loops", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    /* The most common journey is B's purchase, 50 of 200. */
    const firstPath: Locator = page.getByTestId("user-flow-path-row").first();

    await expect(firstPath).toHaveAttribute(
      "data-path",
      "/ > /collections > /products/:id > /cart > /checkout > /checkout/payment > /order/confirmed",
    );
    await expect(firstPath).toHaveAttribute("data-sessions", "50");
    await expect(firstPath.getByText("Watch")).toBeVisible();

    await page.getByTestId("user-flow-tab-pages").click();
    await expect(
      page.locator(
        '[data-testid="user-flow-page-row"][data-page="/checkout/payment"]',
      ),
    ).toBeVisible();

    await page.getByTestId("user-flow-tab-loops").click();
    const loop: Locator = page.getByTestId("user-flow-loop-row").first();

    await expect(loop).toContainText("/products/:id");
    await expect(loop).toContainText("/search");
    await expect(loop).toContainText("20 sessions");

    /* A page chip re-anchors the map on that page. */
    await loop.getByRole("button", { name: "/search" }).click();
    await expect(page).toHaveURL(/page=%2Fsearch/);
    await expect(node(page, "/search", 0)).toHaveAttribute(
      "data-sessions",
      "20",
    );
  });

  test("an anchor nobody visited says so instead of drawing nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, "?page=%2Fnever-visited");
    await expect(page.getByTestId("user-flow-anchor-missing")).toBeVisible();
    await page
      .getByTestId("user-flow-anchor-missing")
      .getByRole("button", { name: "start from the landing page" })
      .click();
    await waitForMap(page);
    await expect(node(page, "/", 0)).toBeVisible();
  });

  test("no recordings explains where user flows come from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, "?fixture=empty");
    await expect(
      page.getByText("No recorded sessions in this range"),
    ).toBeVisible();
    await expect(page.getByText("How to install Session Replay")).toBeVisible();
    await expect(page.getByTestId("user-flow-map")).toHaveCount(0);
  });

  test("a failed read shows the error and can be retried", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, "?fixture=error");
    await expect(page.getByText("ClickHouse is not reachable")).toBeVisible();
    await expect(page.getByTestId("user-flow-map")).toHaveCount(0);
  });

  test("on a phone the map scrolls inside its card, not the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFlows(page);
    await waitForMap(page);

    const pageOverflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });

    expect(pageOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: path.join(artifacts, "user-flows-mobile.png"),
      fullPage: true,
    });
  });
});

test.describe("One person or one session", () => {
  const janeKey: string = "a".repeat(64);
  const visitorId: string = "0123456789abcdef0123456789abcdef";
  const janeSession: string = "c0000000000000000000000000000001";
  const janeSecondSession: string = "c0000000000000000000000000000002";
  const janeUnrecordedSession: string = "c0000000000000000000000000000003";
  const orphanSession: string = "c0000000000000000000000000000005";
  const longSession: string = "c0000000000000000000000000000006";

  const journey: (page: Page, sessionId: string) => Locator = (
    page: Page,
    sessionId: string,
  ): Locator => {
    return page.locator(
      `[data-testid="user-flow-journey"][data-session-id="${sessionId}"]`,
    );
  };

  const step: (row: Locator, pageKey: string) => Locator = (
    row: Locator,
    pageKey: string,
  ): Locator => {
    return row.locator(
      `[data-testid="user-flow-journey-step"][data-page="${pageKey}"]`,
    );
  };

  const filterRequests: (page: Page) => Promise<Array<unknown>> = async (
    page: Page,
  ): Promise<Array<unknown>> => {
    return (await flowRequests(page)).map(
      (request: FixtureRequest): unknown => {
        return request.data["filters"];
      },
    );
  };

  test("picking a person shows their journeys, and nobody else's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "200",
    );
    await expect(page.getByTestId("user-flow-journeys")).toHaveCount(0);

    await page.getByTestId("user-flow-scope-input").click();

    const options: Locator = page.getByTestId("user-flow-scope-option");

    /* The unlinked bucket is on the Users page, but nothing selects it. */
    await expect(options).toHaveCount(2);
    await expect(options.first()).toContainText("jane@example.com");
    await expect(options.first()).toContainText("3 sessions");
    await expect(options.nth(1)).toContainText("Visitor 012345");
    await expect(options.nth(1)).toContainText("1 session");

    await options.first().click();

    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "jane@example.com",
    );
    await expect(page.getByTestId("user-flow-scope-detail")).toHaveText(
      "Identified user · 3 sessions in this range",
    );

    /* The filter went to the server: these sessions are not in the 200. */
    expect(await filterRequests(page)).toEqual([
      undefined,
      { identifiedUserKey: janeKey },
    ]);

    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);
    await expect(page.getByTestId("user-flow-journeys-count")).toHaveText(
      "3 sessions",
    );

    /* Everything else on the page is about her too. */
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "3",
    );
    await expect(node(page, "/", 0)).toHaveAttribute("data-sessions", "2");
    await expect(node(page, "/login", 0)).toHaveAttribute("data-sessions", "1");

    await page.screenshot({
      path: path.join(artifacts, "user-flows-one-person.png"),
      fullPage: true,
    });
  });

  test("a journey reads page by page, from landing to exit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${janeKey}`);

    const first: Locator = journey(page, janeSession);

    /* Ids are shown for one person: which product is what they looked at. */
    await expect(first).toHaveAttribute(
      "data-path",
      "/ > /collections > /products/1001 > /collections > /products/1002 > /cart > /checkout/payment",
    );

    const steps: Locator = first.getByTestId("user-flow-journey-step");

    await expect(steps).toHaveCount(7);
    await expect(steps.first()).toHaveAttribute("data-landing", "true");
    await expect(steps.first()).toContainText("Landing page");
    await expect(steps.last()).toHaveAttribute("data-exit", "true");
    await expect(steps.last()).toContainText("Exit page");
    await expect(
      first.locator('[data-testid="user-flow-journey-step"][data-exit="true"]'),
    ).toHaveCount(1);

    /* The second /collections is the return, the first is not. */
    await expect(steps.nth(1)).toHaveAttribute("data-visit", "1");
    await expect(steps.nth(3)).toHaveAttribute("data-page", "/collections");
    await expect(steps.nth(3)).toHaveAttribute("data-visit", "2");

    /* Where it went wrong, on the page it went wrong. */
    await expect(
      step(first, "/checkout/payment").getByTestId(
        "user-flow-journey-step-error",
      ),
    ).toBeVisible();
    await expect(first.getByTestId("user-flow-journey-step-error")).toHaveCount(
      1,
    );
    await expect(first.getByTestId("user-flow-journey-errors")).toHaveText(
      "2 errors",
    );
    await expect(first.getByTestId("user-flow-journey-summary")).toHaveText(
      "7 pages · 1 return to an earlier page",
    );
    await expect(first.getByTestId("user-flow-journey-facts")).toContainText(
      "Chrome · desktop · DK",
    );

    const second: Locator = journey(page, janeSecondSession);

    await expect(
      step(second, "/account").getByTestId(
        "user-flow-journey-step-frustration",
      ),
    ).toBeVisible();
    await expect(
      second.getByTestId("user-flow-journey-frustration"),
    ).toHaveText("3 frustration signals");
    await expect(second.getByTestId("user-flow-journey-summary")).toHaveText(
      "2 pages",
    );

    /* One page seen is both the landing and the exit. */
    const third: Locator = journey(page, janeUnrecordedSession);

    await expect(third.getByTestId("user-flow-journey-step")).toHaveAttribute(
      "data-landing",
      "true",
    );
    await expect(third.getByTestId("user-flow-journey-step")).toHaveAttribute(
      "data-exit",
      "true",
    );
    await expect(third.getByTestId("user-flow-journey-summary")).toHaveText(
      "Left without navigating",
    );
  });

  test("a journey links to its recording, when there is one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${janeKey}`);

    await expect(
      journey(page, janeSession).getByTestId("user-flow-journey-watch"),
    ).toHaveAttribute("href", new RegExp(`/session-replay/${janeSession}$`));

    const unrecorded: Locator = journey(page, janeUnrecordedSession);

    await expect(unrecorded.getByTestId("user-flow-journey-watch")).toHaveCount(
      0,
    );
    await expect(
      unrecorded.getByTestId("user-flow-journey-no-recording"),
    ).toHaveText("No recording");
  });

  test("a link names the person by key, and survives a reload", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);
    await page.getByTestId("user-flow-scope-input").click();
    await page.getByTestId("user-flow-scope-option").first().click();
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);

    await expect(page).toHaveURL(new RegExp(`userKey=${janeKey}`));
    expect(page.url()).not.toContain("jane");

    await page.reload();

    /* The link holds the key: the label comes back from the server. */
    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "jane@example.com",
    );
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);
    expect(await filterRequests(page)).toEqual([
      { identifiedUserKey: janeKey },
    ]);
  });

  test("a typed reference goes in the body, and only its key reaches the URL", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    /* Carol is not in the list of people: only her reference finds her. */
    await page.getByTestId("user-flow-scope-input").fill("carol@example.com");
    await page.getByTestId("user-flow-scope-input").press("Enter");

    await expect(page.getByTestId("user-flow-journey")).toHaveCount(1);
    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "carol@example.com",
    );
    expect(await filterRequests(page)).toEqual([
      undefined,
      { identifiedUserRef: "carol@example.com" },
    ]);

    await expect(page).toHaveURL(new RegExp(`userKey=${"e".repeat(64)}`));
    expect(decodeURIComponent(page.url())).not.toContain("carol");
    /* Writing the key into the URL is not a second read. */
    expect(await flowRequests(page)).toHaveLength(2);
  });

  test("a name typed exactly as listed is that person, asked for by their key", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    const input: Locator = page.getByTestId("user-flow-scope-input");

    await input.click();
    await expect(page.getByTestId("user-flow-scope-option")).toHaveCount(2);
    await input.fill("jane@example.com");
    await expect(page.getByTestId("user-flow-scope-option")).toHaveCount(1);
    await input.press("Enter");

    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);
    expect(await filterRequests(page)).toEqual([
      undefined,
      { identifiedUserKey: janeKey },
    ]);
  });

  test("Show all users goes back to the map of everyone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${janeKey}`);
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);
    await expect(page.getByTestId("user-flow-group-ids")).not.toBeChecked();

    await page.getByTestId("user-flow-scope-clear").click();

    await expect(page.getByTestId("user-flow-scope")).toHaveCount(0);
    await expect(page.getByTestId("user-flow-journeys")).toHaveCount(0);
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "200",
    );
    await expect(page.getByTestId("user-flow-group-ids")).toBeChecked();
    expect(new URL(page.url()).search).toBe("");
  });

  test("the time range, device and session filters narrow one person too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${janeKey}&range=Past+1+Hour`);
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);

    const requests: Array<FixtureRequest> = await flowRequests(page);
    const windowMs: number =
      Date.parse(String(requests[0]!.data["endTime"])) -
      Date.parse(String(requests[0]!.data["startTime"]));

    expect(Math.round(windowMs / 60000)).toBe(60);

    await page.getByTestId("user-flow-device-filter").selectOption("mobile");
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(1);
    await expect(journey(page, janeUnrecordedSession)).toBeVisible();

    await page.getByTestId("user-flow-device-filter").selectOption("");
    await page.getByTestId("user-flow-session-filter").selectOption("errors");
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(1);
    await expect(journey(page, janeSession)).toBeVisible();

    /* Filters that leave nothing say so, and keep the rest of the page. */
    await page.getByTestId("user-flow-device-filter").selectOption("mobile");
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(0);
    await expect(page.getByTestId("user-flow-journeys-empty")).toBeVisible();

    /* All of that re-folded what it had. */
    expect(await flowRequests(page)).toHaveLength(1);
  });

  test("a device someone else used stays a choice, so the page says what narrows it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${janeKey}&device=tablet`);
    await expect(page.getByTestId("user-flow-journeys-empty")).toBeVisible();
    await expect(page.getByTestId("user-flow-device-filter")).toHaveValue(
      "tablet",
    );
  });

  test("Group IDs in URLs folds one person's records together again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${janeKey}`);

    await expect(
      step(journey(page, janeSession), "/products/1001"),
    ).toHaveCount(1);

    await page.getByTestId("user-flow-group-ids").check();

    await expect(journey(page, janeSession)).toHaveAttribute(
      "data-path",
      "/ > /collections > /products/:id > /collections > /products/:id > /cart > /checkout/payment",
    );
    await expect(page).toHaveURL(/group=1/);
    expect(await flowRequests(page)).toHaveLength(1);
  });

  test("a pasted session id opens that session, and widens to its owner", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    await page.getByTestId("user-flow-scope-input").fill(janeSession);
    await expect(page.getByTestId("user-flow-scope-option")).toContainText(
      "Find session c0000000",
    );
    await page.getByTestId("user-flow-scope-input").press("Enter");

    await expect(page.getByTestId("user-flow-scope")).toHaveAttribute(
      "data-kind",
      "session",
    );
    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "Session c0000000",
    );
    await expect(page.getByTestId("user-flow-scope-detail")).toHaveText(
      "One session from jane@example.com",
    );
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`sessionId=${janeSession}`));

    await page.getByTestId("user-flow-scope-owner").click();

    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "jane@example.com",
    );
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);
    await expect(page).toHaveURL(new RegExp(`userKey=${janeKey}`));
    await expect(page).not.toHaveURL(/sessionId=/);
  });

  test("a session linked to nobody has no one to widen to", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?sessionId=${orphanSession}`);

    await expect(page.getByTestId("user-flow-scope-detail")).toHaveText(
      "One session",
    );
    await expect(page.getByTestId("user-flow-scope-owner")).toHaveCount(0);
  });

  test("an anonymous visitor reads as one, by the same words as the Users page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?visitor=${visitorId}`);

    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "Visitor 012345",
    );
    await expect(page.getByTestId("user-flow-scope-detail")).toHaveText(
      "Anonymous visitor · 1 session in this range",
    );
    expect(await filterRequests(page)).toEqual([{ visitorId: visitorId }]);
  });

  test("a role that may not read the label sees Hidden, and the journeys", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${"b".repeat(64)}`);

    await expect(page.getByTestId("user-flow-scope-name")).toHaveText("Hidden");
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(1);
  });

  test("nobody in the range says so, and is not taken for a missing install", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    await page.getByTestId("user-flow-scope-input").fill("nobody@example.com");
    await page.getByTestId("user-flow-scope-input").press("Enter");

    await expect(
      page.getByText("No recorded sessions for this user in this range"),
    ).toBeVisible();
    await expect(page.getByText("How to install Session Replay")).toHaveCount(
      0,
    );

    /* The banner still names who was asked for. */
    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "nobody@example.com",
    );

    await page.getByTestId("user-flow-scope-empty-clear").click();
    await waitForMap(page);
    await expect(page.getByTestId("user-flow-tile-sessions-value")).toHaveText(
      "200",
    );
  });

  test("a session nobody recorded here says how to reach a reference of that shape", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?sessionId=${"d".repeat(32)}`);

    await expect(
      page.getByText("No session with this ID in this range"),
    ).toBeVisible();
    await expect(page.getByText("search for user:")).toBeVisible();
  });

  test("a reference a role may not use is explained, and can be left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    await page.getByTestId("user-flow-scope-input").fill("denied@example.com");
    await page.getByTestId("user-flow-scope-input").press("Enter");

    await expect(
      page.getByText("Your role cannot read end-user identity"),
    ).toBeVisible();
    await expect(page.getByTestId("user-flow-map")).toHaveCount(0);

    await page.getByTestId("user-flow-scope-clear").click();
    await waitForMap(page);
  });

  /*
   * What a server older than the page does with a filter it does not know:
   * it answers with everyone. Drawn, that would be two hundred strangers
   * under one person's name.
   */
  test("an answer the server did not narrow is never drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?fixture=unfiltered&userKey=${janeKey}`);

    await expect(
      page.getByText("The server did not narrow this read"),
    ).toBeVisible();
    await expect(page.getByTestId("user-flow-journeys")).toHaveCount(0);
    await expect(page.getByTestId("user-flow-map")).toHaveCount(0);
    await expect(page.getByTestId("user-flow-tile-sessions")).toHaveCount(0);
  });

  test("a journey cut short names no exit", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?sessionId=${longSession}`);

    const row: Locator = journey(page, longSession);

    await expect(row.getByTestId("user-flow-journey-step")).toHaveCount(100);
    await expect(
      row.locator('[data-testid="user-flow-journey-step"][data-exit="true"]'),
    ).toHaveCount(0);
    await expect(row.getByTestId("user-flow-journey-summary")).toContainText(
      "the session went on past these pages",
    );
  });

  test("the filter works from the keyboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    const input: Locator = page.getByTestId("user-flow-scope-input");

    await input.focus();
    await expect(page.getByTestId("user-flow-scope-option")).toHaveCount(2);
    await expect(input).toHaveAttribute("aria-expanded", "true");

    await input.press("ArrowDown");
    await expect(
      page.getByTestId("user-flow-scope-option").nth(1),
    ).toHaveAttribute("aria-selected", "true");

    await input.press("Escape");
    await expect(page.getByTestId("user-flow-scope-menu")).toHaveCount(0);

    await input.focus();
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "Visitor 012345",
    );
  });

  test("text that cannot be asked offers help rather than a dead end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page);
    await waitForMap(page);

    await page.getByTestId("user-flow-scope-input").fill("visitor:abc");
    await expect(page.getByTestId("user-flow-scope-hint")).toBeVisible();
    await page.getByTestId("user-flow-scope-input").press("Enter");

    await expect(page.getByTestId("user-flow-scope")).toHaveCount(0);
    expect(await flowRequests(page)).toHaveLength(1);
  });

  test("moving straight to another person never shows the last one's journeys", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openFlows(page, `?userKey=${janeKey}`);
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);

    await page.getByTestId("user-flow-scope-input").click();
    await page.getByTestId("user-flow-scope-option").nth(1).click();

    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "Visitor 012345",
    );
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(1);
    await expect(journey(page, janeSession)).toHaveCount(0);
    await expect(page).not.toHaveURL(/userKey=/);
  });

  test("View journey on the Users page opens that person over the same window", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${applicationRoute}/session-replay-users?range=Past+1+Hour`,
    );

    const row: Locator = page.locator(
      `[data-testid="session-user-row"][data-group-key="u:${janeKey}"]`,
    );

    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "View journey" }).click();

    await expect(page).toHaveURL(/\/user-flows\?/);
    await expect(page).toHaveURL(new RegExp(`userKey=${janeKey}`));
    await expect(page).toHaveURL(/range=Past\+1\+Hour/);
    await expect(page.getByTestId("user-flow-scope-name")).toHaveText(
      "jane@example.com",
    );
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);
  });

  test("on a phone one person's journeys wrap inside the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFlows(page, `?userKey=${janeKey}`);
    await expect(page.getByTestId("user-flow-journey")).toHaveCount(3);

    const pageOverflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });

    expect(pageOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: path.join(artifacts, "user-flows-one-person-mobile.png"),
      fullPage: true,
    });
  });
});
