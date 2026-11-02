import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE WAY BACK FROM SECURITY EVENTS, ON A MONITOR'S PAGE.
 *
 * A monitor that checks a host - an API, a website, a certificate - carries
 * a Security card in its overview's side column, under its open work: what
 * Security Events found about the hosts it checks this week (the open cases
 * naming them, how many events and findings named them and the worst of
 * them, and their risk), each opening Security Events on it. A monitor that
 * checks no host (a heartbeat) has nothing to be named by and is never
 * asked about; a project that uses no Security Events, or a role that may
 * not read security events, is told nothing. The card is read again on the
 * page's Refresh.
 *
 * The production overview (Pages/Monitor/View) against the offline fixture
 * (Fixture/Fixture.js, ?security=), with its network fence and its record of
 * requests it does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const DASHBOARD: string = `/dashboard/${PROJECT_ID}`;
const RESOURCE_SECURITY: string = "/security-case/resource-security";

type MonitorTypeKey = "api" | "website" | "ssl" | "incoming-request";

const MONITOR_NUMBER: Record<MonitorTypeKey, number> = {
  api: 1,
  website: 2,
  ssl: 3,
  "incoming-request": 4,
};

const MONITOR_NAME: Record<MonitorTypeKey, string> = {
  api: "Checkout API",
  website: "Storefront",
  ssl: "Storefront TLS certificate",
  "incoming-request": "Nightly billing export",
};

const MONITOR_DESCRIPTION: string =
  "What Security Events found about what it checks in the last 7 days.";
const MONITOR_QUIET: string =
  "No security event named what it checks in the last 7 days.";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface RecordedApiRequest {
  method: string;
  url: string;
  body: { kind?: string; id?: string };
}

function monitorId(type: MonitorTypeKey): string {
  return `70000000-0000-4000-8000-${String(MONITOR_NUMBER[type]).padStart(12, "0")}`;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.use({ deviceScaleFactor: 2 });

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(
  page: Page,
  type: MonitorTypeKey,
  options: {
    security?: "news" | "quiet";
    role?: "viewer";
    theme?: "dark";
    width?: number;
  } = {},
): Promise<void> {
  const width: number = options.width || 1440;
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.clock.setFixedTime(NOW);
  const query: URLSearchParams = new URLSearchParams({ type });
  if (options.security) {
    query.set("security", options.security);
  }
  if (options.role) {
    query.set("role", options.role);
  }
  if (options.theme) {
    query.set("theme", options.theme);
  }
  await page.goto(`${DASHBOARD}/monitors/${monitorId(type)}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Monitor - ${MONITOR_NAME[type]}`,
    { timeout: 30000 },
  );
  await expect(page.getByTestId("monitor-overview-hero")).toBeVisible({
    timeout: 30000,
  });
}

function card(page: Page): Locator {
  return page.getByTestId("resource-security-card");
}

// What the page asked Security Events about, in order.
async function securityReads(page: Page): Promise<Array<RecordedApiRequest>> {
  const requests: Array<RecordedApiRequest> = await page.evaluate(
    (): Array<RecordedApiRequest> => {
      return JSON.parse(
        JSON.stringify(
          (
            window as unknown as {
              __monitorOverviewFixture: {
                apiRequests: Array<RecordedApiRequest>;
              };
            }
          ).__monitorOverviewFixture.apiRequests,
        ),
      ) as Array<RecordedApiRequest>;
    },
  );

  return requests.filter((request: RecordedApiRequest): boolean => {
    return new URL(request.url).pathname.endsWith(RESOURCE_SECURITY);
  });
}

/*
 * The overview has settled: its open work is read, and so is what it was
 * linked to - the side column's last reads.
 */
async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId("monitor-uptime-skeleton")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(
    page.locator("[role='status'][aria-label^='Loading']"),
  ).toHaveCount(0, { timeout: 30000 });
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

// The card's figures as laid out: the bar's own width, and how many rows.
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

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await card(page).scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await card(page).screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

test.describe("a monitor's Security card", () => {
  test("a project that uses no Security Events is told nothing: the monitor is asked about, and no card is drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "api");
    await expect
      .poll(
        async (): Promise<number> => {
          return (await securityReads(page)).length;
        },
        { timeout: 30000 },
      )
      .toBe(1);

    // Asked as a monitor, by its own id.
    const [read] = await securityReads(page);
    expect(read!.method).toBe("POST");
    expect(read!.body).toEqual({ kind: "Monitor", id: monitorId("api") });
    await settled(page);
    await expect(card(page)).toHaveCount(0);
  });

  test("it is about the host the monitor checks: its open cases, its week of events and findings, and its risk, each opening Security Events", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "api", { security: "news" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(card(page)).toHaveAttribute("data-state", "news");
    await expect(card(page)).toContainText(MONITOR_DESCRIPTION);

    // The events, opening the explorer on what named the host it checks.
    const events: Locator = card(page).getByTestId("resource-security-open");
    await expect(events).toHaveText("23");
    const search: URL = new URL(
      (await events.getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(search.pathname).toBe(`${DASHBOARD}/security-events`);
    expect(decodeURIComponent(search.searchParams.get("search") || "")).toBe(
      "observable:api.acme-commerce.example",
    );

    await expect(card(page)).toContainText("Findings");
    await expect(card(page)).toContainText("High");
    await expect(card(page)).toContainText("41");

    // The open case, opening its page; the other one counted.
    const cases: Locator = card(page).getByTestId("resource-security-cases");
    await expect(cases.getByTestId("resource-security-case")).toHaveCount(1);
    await expect(cases).toContainText(
      "Credential stuffing against api.acme-commerce.example",
    );
    await expect(cases).toContainText("1 more open case");
    expect(
      await cases
        .getByRole("link", { name: /Credential stuffing against/ })
        .getAttribute("href"),
    ).toBe(
      `${DASHBOARD}/security-events/cases/25000000-0000-4000-8000-000000000151`,
    );

    // Open in Security Events: the host's page there, as a host.
    const openLink: Locator = card(page).getByRole("link", {
      name: "Open in Security Events",
    });
    await expect(openLink).toBeVisible();
    const entity: URL = new URL(
      (await openLink.getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(entity.pathname).toBe(
      `${DASHBOARD}/security-events/entity-risk/entity`,
    );
    expect(entity.searchParams.get("value")).toBe("api.acme-commerce.example");
    expect(entity.searchParams.get("type")).toBe("Host");
  });

  test("a website's card is about its site's host", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "website", { security: "news" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    const search: URL = new URL(
      (await card(page)
        .getByTestId("resource-security-open")
        .getAttribute("href"))!,
      "http://127.0.0.1",
    );
    expect(decodeURIComponent(search.searchParams.get("search") || "")).toBe(
      "observable:shop.acme-commerce.example",
    );
    await expect(
      card(page).getByTestId("resource-security-cases"),
    ).toContainText("Credential stuffing against shop.acme-commerce.example");
  });

  test("a monitor nothing named this week says so in one line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "ssl", { security: "quiet" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    await expect(card(page)).toHaveAttribute("data-state", "quiet");
    await expect(card(page)).toContainText(MONITOR_QUIET);
    await expect(card(page).getByTestId("resource-security-cases")).toHaveCount(
      0,
    );
    await expect(
      card(page).getByRole("group", { name: "Security" }),
    ).toHaveCount(0);
  });

  test("a heartbeat checks no host: it has no card, and Security Events is never asked about it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "incoming-request", { security: "news" });
    await settled(page);
    await expect(card(page)).toHaveCount(0);
    expect(await securityReads(page)).toEqual([]);
  });

  test("a role that may not read security events is never told about them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "api", { security: "news", role: "viewer" });
    await settled(page);
    await expect(card(page)).toHaveCount(0);
    expect(await securityReads(page)).toEqual([]);
  });

  test("Refresh reads it again", async ({ page }: { page: Page }) => {
    await open(page, "api", { security: "news" });
    await expect(card(page)).toBeVisible({ timeout: 30000 });
    expect(await securityReads(page)).toHaveLength(1);

    await page
      .getByTestId("monitor-overview-hero")
      .getByRole("group", { name: "Monitor actions" })
      .getByRole("button", { name: "Refresh" })
      .click();
    await expect
      .poll(
        async (): Promise<number> => {
          return (await securityReads(page)).length;
        },
        { timeout: 30000 },
      )
      .toBe(2);
    await expect(card(page)).toHaveAttribute("data-state", "news");
  });

  for (const [width, theme] of [
    [1440, undefined],
    [1440, "dark"],
    [390, undefined],
    [390, "dark"],
  ] as Array<[number, "dark" | undefined]>) {
    test(`at ${width}${theme ? `, ${theme}` : ""}, the card reads whole in its column and nothing scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "api", {
        width,
        security: "news",
        ...(theme ? { theme } : {}),
      });
      await expect(
        card(page).getByTestId("resource-security-case").first(),
      ).toBeVisible({ timeout: 30000 });
      await settled(page);

      await expectNoSidewaysScroll(page, { tolerance: 1 });
      expect(await partsOutsideTheCard(page)).toEqual([]);

      /*
       * The header is stacked, as every card of the side column is: the
       * title keeps to one line beside Open in Security Events, and the
       * description runs under both, across the card - never squeezed
       * into a column a word wide beside the button.
       */
      const heading: Locator = card(page).getByTestId("card-details-heading");
      const lineHeight: number = await heading.evaluate(
        (element: Element): number => {
          return parseFloat(window.getComputedStyle(element).lineHeight);
        },
      );
      const headingBox: { height: number } | null = await heading.boundingBox();
      expect(headingBox!.height).toBeLessThanOrEqual(lineHeight + 1);
      const description: Locator = card(page).getByTestId("card-description");
      if (width >= 768) {
        const cardBox: { width: number } | null =
          await card(page).boundingBox();
        const descriptionBox: { width: number } | null =
          await description.boundingBox();
        expect(descriptionBox!.width).toBeGreaterThan(cardBox!.width * 0.6);
      } else {
        // A phone hides a card's description, as on every other card.
        await expect(description).toBeHidden();
      }

      /*
       * Four short figures, by the card's own width: one row from 36rem,
       * two by two from 16rem - the side column of a laptop's page and a
       * phone are both two by two.
       */
      const figures: { width: number; rows: number } = await figureRows(page);
      const rowsByWidth: number =
        figures.width >= 36 * 16 ? 1 : figures.width >= 16 * 16 ? 2 : 4;
      expect(figures.rows, `${Math.round(figures.width)}px`).toBe(rowsByWidth);
      expect(figures.rows).toBe(2);
      await screenshot(
        page,
        `monitor-security-card-${width}${theme ? `-${theme}` : ""}`,
      );
    });
  }
});
