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
 * The way back from Security Events: a host's and a Kubernetes cluster's
 * page carries a Security card - the open security cases naming it, how
 * many security events and findings named it this week and the worst of
 * them, and its risk - each opening Security Events on it. A project that
 * uses no Security Events is told nothing about it: no card at all.
 *
 * On the zoom fixture's host and cluster (Fixture/Fixture.js, ?security=),
 * with the clock pinned and the network fenced; afterEach fails a test on
 * an uncaught page error, an aborted request or anything the fixture does
 * not model.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HOST_ID: string = "62000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const HOST_PATH: string = `${DASHBOARD}/host/${HOST_ID}`;
const CLUSTER_PATH: string = `${DASHBOARD}/kubernetes/${CLUSTER_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/chart-time-zoom-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

test.beforeEach(
  async ({ page, baseURL }: { page: Page; baseURL: string | undefined }) => {
    const errors: Array<string> = [];
    const aborted: Array<string> = [];
    pageErrors.set(page, errors);
    abortedRequests.set(page, aborted);
    page.on("pageerror", (error: Error) => {
      errors.push(error.message);
    });

    // Nothing may leave the fixture server.
    const fixtureOrigin: string = new URL(baseURL || "http://127.0.0.1:4233")
      .origin;
    await page.route("**/*", async (route: PlaywrightRoute) => {
      if (new URL(route.request().url()).origin === fixtureOrigin) {
        await route.continue();
        return;
      }
      aborted.push(route.request().url());
      await route.abort();
    });
  },
);

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const fixture: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __chartTimeZoomFixture?: { unhandled?: Array<unknown> };
        }
      ).__chartTimeZoomFixture;
      return JSON.parse(JSON.stringify(fixture?.unhandled || []));
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(
  page: Page,
  target: string,
  options: {
    width?: number;
    theme?: "dark";
    security?: "news" | "quiet";
  } = {},
): Promise<void> {
  const width: number = options.width || 1280;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.clock.setFixedTime(NOW);
  const url: URL = new URL(target, "http://127.0.0.1:4233");
  if (options.theme) {
    url.searchParams.set("theme", options.theme);
  }
  if (options.security) {
    url.searchParams.set("security", options.security);
  }
  await page.goto(`${url.pathname}${url.search}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

function card(page: Page): Locator {
  return page.getByTestId("resource-security-card");
}

// The page has read what Security Events says about the record.
async function securityRead(page: Page): Promise<void> {
  await expect
    .poll(
      async (): Promise<number> => {
        return page.evaluate((): number => {
          const fixture: {
            requests?: Array<{ kind: string; url?: string }>;
          } =
            (
              window as unknown as {
                __chartTimeZoomFixture?: {
                  requests?: Array<{ kind: string; url?: string }>;
                };
              }
            ).__chartTimeZoomFixture || {};
          return (fixture.requests || []).filter(
            (request: { kind: string; url?: string }) => {
              return (
                request.kind === "api" &&
                String(request.url || "").endsWith(
                  "/security-case/resource-security",
                )
              );
            },
          ).length;
        });
      },
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
}

/*
 * The card's figures as the browser lays them out: the bar's own width,
 * and the tops of its cells - one top for a row of four, two for two rows.
 */
async function figureRows(
  page: Page,
): Promise<{ width: number; rows: number }> {
  return card(page)
    .getByRole("group", { name: "Security" })
    .evaluate((bar: Element): { width: number; rows: number } => {
      return {
        width: bar.getBoundingClientRect().width,
        rows: new Set(
          Array.from(bar.children).map((cell: Element): number => {
            return Math.round(cell.getBoundingClientRect().top);
          }),
        ).size,
      };
    });
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

// The parts of the card that run past its edges: none may.
async function partsOutsideTheCard(page: Page): Promise<Array<string>> {
  return card(page).evaluate((root: Element): Array<string> => {
    const box: DOMRect = root.getBoundingClientRect();
    const outside: Array<string> = [];

    root.querySelectorAll("*").forEach((element: Element): void => {
      const part: DOMRect = element.getBoundingClientRect();

      if (part.width === 0 || part.height === 0) {
        return;
      }

      if (part.left < box.left - 1 || part.right > box.right + 1) {
        outside.push(
          `${element.tagName.toLowerCase()} "${(element.textContent || "").trim().slice(0, 40)}"`,
        );
      }
    });

    return outside;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await card(page).scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await card(page).screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

test.describe("a host's Security card", () => {
  test("a project that uses no Security Events is told nothing: no card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HOST_PATH);
    await securityRead(page);
    await expect(
      page.getByRole("heading", { name: "api-gateway-01", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(card(page)).toHaveCount(0);
  });

  test("its open cases, its week of events and findings, and its risk, each opening Security Events on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HOST_PATH, { security: "news" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(card(page)).toHaveAttribute("data-state", "news");
    await expect(card(page)).toContainText(
      "What Security Events found about it in the last 7 days.",
    );

    // The events, opening the explorer on what names the host this week.
    const events: Locator = card(page).getByTestId("resource-security-open");
    await expect(events).toHaveText("128");
    const search: URL = new URL(
      (await events.getAttribute("href"))!,
      "http://127.0.0.1:4233",
    );
    expect(search.pathname).toBe(`${DASHBOARD}/security-events`);
    expect(decodeURIComponent(search.searchParams.get("search") || "")).toBe(
      "observable:(api-gateway-01 OR 203.0.113.40)",
    );

    await expect(card(page)).toContainText("Findings");
    await expect(card(page)).toContainText("High");
    await expect(card(page)).toContainText("64");

    // The open cases, each opening its page; the rest counted.
    const cases: Locator = card(page).getByTestId("resource-security-cases");
    await expect(cases.getByTestId("resource-security-case")).toHaveCount(3);
    await expect(cases).toContainText(
      "SEC-142Brute force against api-gateway-01 from 198.51.100.77",
    );
    await expect(cases).toContainText("1 more open case");
    expect(
      await cases
        .getByRole("link", { name: /Brute force against api-gateway-01/ })
        .getAttribute("href"),
    ).toBe(
      `${DASHBOARD}/security-events/cases/20000000-0000-4000-8000-000000000142`,
    );
    /*
     * Open in Security Events: a real link, styled as the product's other
     * card header links, to the host's page in Security Events.
     */
    const openLink: Locator = card(page).getByRole("link", {
      name: "Open in Security Events",
    });
    await expect(openLink).toBeVisible();
    await expect(
      card(page).getByRole("button", { name: "Open in Security Events" }),
    ).toHaveCount(0);
    const entity: URL = new URL(
      (await openLink.getAttribute("href"))!,
      "http://127.0.0.1:4233",
    );
    expect(entity.pathname).toBe(
      `${DASHBOARD}/security-events/entity-risk/entity`,
    );
    expect(entity.searchParams.get("value")).toBe("api-gateway-01");
    // A tile says only what is its own: the card's description says the week.
    await expect(
      card(page).getByRole("group", { name: "Security" }),
    ).not.toContainText("In the last 7 days");
  });

  test("a host nothing named this week says so in one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, HOST_PATH, { security: "quiet" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(card(page)).toHaveAttribute("data-state", "quiet");
    await expect(card(page)).toContainText(
      "No security event named it in the last 7 days.",
    );
    await expect(card(page).getByTestId("resource-security-cases")).toHaveCount(
      0,
    );
  });

  for (const [width, theme] of [
    [1280, undefined],
    [1280, "dark"],
    [390, undefined],
    [390, "dark"],
  ] as Array<[number, "dark" | undefined]>) {
    test(`at ${width}${theme ? `, ${theme}` : ""}, the card reads whole and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, HOST_PATH, {
        width,
        security: "news",
        ...(theme ? { theme } : {}),
      });
      await expect(
        card(page).getByTestId("resource-security-case").first(),
      ).toBeVisible({ timeout: 30000 });

      expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
      expect(await partsOutsideTheCard(page)).toEqual([]);
      /*
       * Four short figures, by the card's own width: one row from 36rem,
       * two by two from 16rem - on a laptop's page one row, on a phone two.
       */
      const figures: { width: number; rows: number } = await figureRows(page);
      const rowsByWidth: number =
        figures.width >= 36 * 16 ? 1 : figures.width >= 16 * 16 ? 2 : 4;
      expect(figures.rows, `${Math.round(figures.width)}px`).toBe(rowsByWidth);
      expect(figures.rows).toBe(width === 390 ? 2 : 1);
      await screenshot(
        page,
        `host-security-card-${width}${theme ? `-${theme}` : ""}`,
      );
    });
  }
});

test.describe("a cluster's Security card", () => {
  test("names its open case and its week of events", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CLUSTER_PATH, { security: "news" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(card(page).getByTestId("resource-security-open")).toHaveText(
      "37",
    );
    await expect(
      card(page).getByTestId("resource-security-cases"),
    ).toContainText("Privileged pod created in kube-system");
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await screenshot(page, "cluster-security-card-1280");
  });

  test("a project that uses no Security Events is told nothing: no card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CLUSTER_PATH);
    await securityRead(page);
    await expect(card(page)).toHaveCount(0);
  });
});
