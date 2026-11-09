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
 * RESPONSE CONTENT, ON A MONITOR'S SETTINGS PAGE (issue #5774).
 *
 * A Website or API monitor's Monitoring Logs keep each check, and its
 * incidents and alerts the check that opened them - the part of the
 * response that matched, and the response body - with secrets and personal
 * data masked. One switch, on by default, keeps none of it for a monitor
 * whose responses are sensitive (Components/Monitor/ResponseContentCard,
 * Monitor.keepResponseContent; #5774, #6341). An Incoming Request monitor
 * has the same switch for the requests it receives; a monitor whose checks
 * carry no body has none.
 *
 * The production Settings page (Pages/Monitor/View/Settings) under the
 * Monitor Overview fixture's ?settings=1, with the same guards as
 * MonitorOverview.spec.ts: a network fence, no uncaught page errors, and no
 * request the fixture does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

// The fixture's monitors, by number: 1 API, 3 SSL Certificate, 4 Incoming Request.
const MONITORS: Record<"api" | "ssl" | "incoming-request", string> = {
  api: "70000000-0000-4000-8000-000000000001",
  ssl: "70000000-0000-4000-8000-000000000003",
  "incoming-request": "70000000-0000-4000-8000-000000000004",
};

const SWITCH_NAME: string = "Keep response content";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

interface RecordedUpdate {
  modelName: string;
  id: string;
  data: Record<string, unknown>;
}

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

async function openSettings(
  page: Page,
  options: {
    type: "api" | "ssl" | "incoming-request";
    query?: string;
    width?: number;
  },
): Promise<void> {
  const width: number = options.width || 1440;
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
  await page.clock.setFixedTime(NOW);
  await page.goto(
    `/dashboard/${PROJECT_ID}/monitors/${MONITORS[options.type]}/settings?settings=1&type=${options.type}${
      options.query ? `&${options.query}` : ""
    }`,
  );
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  // The page has read its monitor: the Monitoring card's switch is drawn.
  await expect(page.getByRole("switch").first()).toBeVisible({
    timeout: 30000,
  });
}

// The cards of the page, by their titles, top to bottom.
async function cardTitles(page: Page): Promise<Array<string>> {
  return page
    .getByTestId("card-header-title-block")
    .locator("h2, h3")
    .allTextContents();
}

function responseCard(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByText(title, { exact: true }),
  });
}

async function updates(page: Page): Promise<Array<RecordedUpdate>> {
  return page.evaluate((): Array<RecordedUpdate> => {
    const state: { updates?: Array<RecordedUpdate> } | undefined = (
      window as unknown as {
        __monitorOverviewFixture?: { updates?: Array<RecordedUpdate> };
      }
    ).__monitorOverviewFixture;
    return JSON.parse(
      JSON.stringify(state?.updates || []),
    ) as Array<RecordedUpdate>;
  });
}

async function screenshotCard(card: Locator, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({
    path: path.join(SCREENSHOTS, `response-content-${name}-synthetic.png`),
    animations: "disabled",
  });
}

test.describe("a Website or API monitor's Settings page", () => {
  test("has a Response content card right after Monitoring: one switch, on, saying what is kept and that secrets are masked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, { type: "api" });

    const titles: Array<string> = await cardTitles(page);
    expect(titles.slice(0, 2)).toEqual(["Monitoring", "Response content"]);

    const card: Locator = responseCard(page, "Response content");
    await expect(card).toContainText(
      "Turn this off for a monitor whose responses are sensitive.",
    );

    const control: Locator = card.getByRole("switch", {
      name: SWITCH_NAME,
      exact: true,
    });
    await expect(control).toHaveAttribute("aria-checked", "true");
    await expect(card).toContainText(
      "Monitoring logs, incidents and alerts show the part of the response that matched, and the response body, with secrets and personal data masked.",
    );

    await screenshotCard(card, "on-1440");
  });

  test("turning it off saves at once, and says what off keeps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, { type: "api" });

    const card: Locator = responseCard(page, "Response content");
    const control: Locator = card.getByRole("switch", {
      name: SWITCH_NAME,
      exact: true,
    });
    await control.click();

    await expect(control).toHaveAttribute("aria-checked", "false");
    await expect(card.getByRole("status")).toContainText("Saved");
    await expect(card).toContainText(
      "Monitoring logs, incidents and alerts keep no part of the response: only which filters matched, the status code and the response time.",
    );

    // One write, of the one column, on this monitor.
    expect(await updates(page)).toEqual([
      {
        modelName: "Monitor",
        id: MONITORS.api,
        data: { keepResponseContent: false },
      },
    ]);

    await screenshotCard(card, "off-1440");
  });

  test("a monitor that already keeps none reads as off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, { type: "api", query: "content=off" });

    await expect(
      responseCard(page, "Response content").getByRole("switch", {
        name: SWITCH_NAME,
        exact: true,
      }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("somebody who may only view the monitor sees the switch locked, as Monitoring's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, { type: "api", query: "role=viewer" });

    const control: Locator = responseCard(page, "Response content").getByRole(
      "switch",
      { name: SWITCH_NAME, exact: true },
    );
    await expect(control).toHaveAttribute("aria-disabled", "true");
    await control.click({ force: true });
    await expect(control).toHaveAttribute("aria-checked", "true");
    expect(await updates(page)).toEqual([]);
  });

  test("in German, on a phone, the card fits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, { type: "api", query: "lang=de", width: 390 });

    const card: Locator = responseCard(page, "Antwortinhalt");
    await expect(
      card.getByRole("switch", {
        name: "Antwortinhalt behalten",
        exact: true,
      }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page, { message: "de 390px" });

    await screenshotCard(card, "de-390");
  });

  test("dark", async ({ page }: { page: Page }) => {
    await openSettings(page, { type: "api", query: "theme=dark" });

    await screenshotCard(responseCard(page, "Response content"), "dark-1440");
  });
});

test.describe("other monitors", () => {
  test("an Incoming Request monitor's speaks of the request it receives", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, { type: "incoming-request" });

    const card: Locator = responseCard(page, "Request content");
    await expect(card).toContainText(
      "Turn this off for a monitor whose requests are sensitive.",
    );
    await expect(
      card.getByRole("switch", {
        name: "Keep request content",
        exact: true,
      }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByText("Response content", { exact: true }),
    ).toHaveCount(0);

    await screenshotCard(card, "request-1440");
  });

  test("a monitor whose checks carry no body has no such card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSettings(page, { type: "ssl" });

    const titles: Array<string> = await cardTitles(page);
    expect(titles[0]).toBe("Monitoring");
    expect(titles).not.toContain("Response content");
    expect(titles).not.toContain("Request content");
  });
});
