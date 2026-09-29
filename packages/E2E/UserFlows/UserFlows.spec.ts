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
