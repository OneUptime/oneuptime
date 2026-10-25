import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Metrics' AI tab - Metrics → AI → Insights, a finding's page with Fix with
 * AI, Logs and Settings - against the offline fixture (Fixture/Fixture.js
 * and Fixture/MetricFindings.js): the pages are production components; only
 * the data boundary is synthetic. OneUptime has found four problems in the
 * project's metrics: checkout's request counter records its users' ids (no
 * fix yet), checkout's request duration histogram puts nearly all its
 * values in its smallest bucket (a pull request OneUptime opened on its
 * own), worker's metric names carry job ids, and payments sends traces but
 * no metrics.
 *
 * Each test asserts what the page drew - on a laptop (1280) and on a phone
 * (390), in light and dark - with no sideways scroll on the phone.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
// The whole clock hour before the look: what every finding was read in.
const WINDOW_START: string = "2026-10-24T11:00:00.000Z";
const WINDOW_END: string = "2026-10-24T12:00:00.000Z";
const METRICS: string = `/dashboard/${PROJECT_ID}/metrics`;
const AI: string = `${METRICS}/ai`;
const CARDINALITY_INSIGHT: string = "52310000-0000-4000-8000-0000000000e1";
const BUCKETS_INSIGHT: string = "52310000-0000-4000-8000-0000000000e2";
const NAMES_INSIGHT: string = "52310000-0000-4000-8000-0000000000e3";
const MISSING_INSIGHT: string = "52310000-0000-4000-8000-0000000000e4";
const CHECKOUT_SERVICE: string = "52310000-0000-4000-8000-0000000000a1";
const WORKER_SERVICE: string = "52310000-0000-4000-8000-0000000000a2";
const PAYMENTS_SERVICE: string = "52310000-0000-4000-8000-0000000000a3";
const PLATFORM_REPOSITORY: string = "52310000-0000-4000-8000-0000000000b2";
const STARTED_TASK: string = "52310000-0000-4000-8000-0000000000f3";
const RUNNING_TASK: string = "52310000-0000-4000-8000-0000000000f4";

const CARDINALITY_TITLE: string =
  "http.server.request.count in checkout records 12,000 different user.id values an hour";
const BUCKETS_TITLE: string =
  "http.server.duration in checkout puts 95% of its values in its smallest bucket";
const NAMES_TITLE: string =
  "worker sends 1,234 metrics named like job.{id}.duration";
const MISSING_TITLE: string = "payments sends traces but no metrics";

const SWITCH_TITLE: string = "Improve metrics and add missing ones";

// ?names=long: the names a large estate gives its services and metrics.
const LONG_CHECKOUT_SERVICE: string =
  "storefront-checkout-service-eu-west-1-production";
const LONG_PAYMENTS_SERVICE: string =
  "storefront-payments-gateway-eu-west-1-production";
const LONG_METRIC: string =
  "com.example.storefront.checkout.http.server.request.count.by.tenant";
const LONG_ATTRIBUTE: string = "app.storefront.customer.account.identifier";
const LONG_OPERATION: string =
  "POST /api/v2/storefront/payments/{paymentId}/authorizations/{authorizationId}/capture";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/metrics-ai-ui",
);

interface FixtureState {
  apiRequests: Array<{
    method: string;
    url: string;
    body: Record<string, unknown>;
  }>;
  fixRequests: Array<Record<string, unknown>>;
  switchSaves: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });
  page.on("console", (message: { type: () => string; text: () => string }) => {
    // React's DOM nesting warnings arrive as console errors.
    if (
      message.type() === "error" &&
      message.text().includes("validateDOMNesting")
    ) {
      errors.push(message.text());
    }
  });
  await page.clock.setFixedTime(NOW);
});

test.afterEach(({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
});

function isPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name === "phone";
}

async function screenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(
      SCREENSHOTS,
      `ai-${name}-${testInfo.project.name}-synthetic.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __metricsAiFixture: FixtureState })
          .__metricsAiFixture,
      ),
    ) as FixtureState;
  });
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

// Every check of a page, in light and then in dark.
async function inBothThemes(
  page: Page,
  address: string,
  check: (theme: "light" | "dark") => Promise<void>,
): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    const separator: string = address.includes("?") ? "&" : "?";
    await page.goto(
      theme === "dark" ? `${address}${separator}theme=dark` : address,
    );
    await check(theme);
  }
}

function tabsOf(page: Page): Locator {
  return page.locator("nav").filter({ hasText: "Setup Guide" }).first();
}

/*
 * Metrics' tabs with AI lit, and the AI section's side menu: its own pages,
 * the one shown marked (on a phone, named in the menu's summary).
 */
async function expectAiSection(
  page: Page,
  testInfo: TestInfo,
  current: "Insights" | "Logs" | "Settings",
): Promise<void> {
  const tabs: Locator = tabsOf(page);

  await expect(tabs.getByRole("link", { name: "AI", exact: true })).toHaveClass(
    /bg-indigo-50/,
  );
  await expect(
    tabs.getByRole("link", { name: "Insights", exact: true }),
  ).not.toHaveClass(/bg-indigo-50/);

  if (isPhone(testInfo)) {
    await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
      current,
    );
    return;
  }

  const menu: Locator = page.getByRole("navigation", {
    name: "Main navigation",
  });

  for (const item of ["Insights", "Logs", "Settings"]) {
    await expect(menu.getByRole("link", { name: item })).toBeVisible();
  }

  await expect(menu.getByRole("link", { name: current })).toHaveClass(
    /bg-indigo-50/,
  );
}

// The address a click took the page to, and its query.
function openedAddress(page: Page): URL {
  return new URL(page.url());
}

test.describe("Metrics → AI tab", () => {
  test("sits between Insights and Setup Guide, and opens on what OneUptime found", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const tabs: Locator = tabsOf(page);

    await expect(tabs).toBeVisible({ timeout: 60000 });
    await expect(tabs.getByRole("link")).toHaveText([
      "Viewer",
      "Insights",
      "AI",
      "Setup Guide",
      "Settings",
    ]);

    await tabs.getByRole("link", { name: "AI", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/metrics/ai/insights$`));
    await expect(page.getByText(CARDINALITY_TITLE)).toBeVisible();
    await expectAiSection(page, testInfo, "Insights");

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });
});

test.describe("Metrics → AI → Settings", () => {
  test("the switch that is on by default, what pull requests need, and the rules folded under More settings", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/settings?aiRules=two`,
      async (theme: "light" | "dark"): Promise<void> => {
        const switches: Locator = page.getByTestId("telemetry-ai-switches");

        await expect(switches).toBeVisible({ timeout: 60000 });
        await expect(switches).toContainText(SWITCH_TITLE);
        await expect(switches).toContainText(
          "Every hour OneUptime looks for metrics to improve and for metrics that are missing.",
        );
        // What it fixes, not a pull request promised for every problem.
        await expect(switches).toContainText(
          "OneUptime AI fixes what it can with pull requests.",
        );
        await expect(switches).toContainText(
          "Needs a repository connected in Code.",
        );
        await expect(
          page.getByRole("switch", { name: SWITCH_TITLE }),
        ).toHaveAttribute("aria-checked", "true");

        // What the switch leads to sits under it, inside its card.
        const ready: Locator = switches.getByTestId(
          "telemetry-ai-readiness-ready",
        );

        await expect(ready).toContainText(
          "OneUptime AI can open pull requests in 2 connected repositories.",
        );
        await expect(ready).toContainText(
          "It opens at most 5 on its own each day (UTC): 1 so far today.",
        );

        // Enable AI is on: no notice above the page.
        await expect(page.getByTestId("project-ai-off-notice")).toHaveCount(0);

        const advanced: Locator = page.getByTestId(
          "telemetry-ai-advanced-section",
        );

        await expect(advanced).toContainText("AI rules");
        await expectAiSection(page, testInfo, "Settings");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `settings-${theme}`);

        // Opened, the rules: when each looks into a problem, and how it fixes it.
        await advanced.getByRole("button", { name: /More settings/ }).click();

        await expect(page.getByText("Checkout services")).toBeVisible();
        await expect(
          page.getByText("If still found after 60 minutes"),
        ).toBeVisible();

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `settings-rules-${theme}`);
      },
    );
  });

  test("a new rule asks Match, Investigate and Fix in the words of metric problems", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const advanced: Locator = page.getByTestId("telemetry-ai-advanced-section");

    await expect(advanced).toBeVisible({ timeout: 60000 });
    // A pull request for each problem it can fix, not for each problem.
    await expect(advanced).toContainText(
      "OneUptime AI looks into every problem it finds in your metrics right away, and opens a pull request for each one it can fix.",
    );
    await advanced.getByRole("button", { name: /More settings/ }).click();

    // A card's description is a laptop's: a phone keeps the card to its title.
    if (!isPhone(testInfo)) {
      await expect(
        page.getByText(
          "With no rule, OneUptime AI looks into every problem in your metrics right away, and opens a pull request for each one it can fix.",
          { exact: false },
        ),
      ).toBeVisible();
    }

    // The empty table: no rules, and what that means for metric problems.
    await expect(
      page.getByText(
        "Every problem found in your metrics is looked into, and a pull request opened for each one OneUptime AI can fix.",
      ),
    ).toBeVisible();
    // The card's own button (with no rule, the empty table offers it too).
    await page
      .getByTestId("card-button")
      .filter({ hasText: "Create AI Rule" })
      .click();

    const dialog: Locator = page.getByRole("dialog");
    const next: Locator = dialog.getByRole("button", { name: "Next" });

    // Match: which services, on "All services".
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("All services");

    if (isPhone(testInfo)) {
      await expect(dialog).toContainText("Step 1 of 3");
      await expectNoSidewaysScroll(page);
    }

    // Investigate: right away, or only if the problem is still found.
    await next.click();
    await expect(dialog).toContainText(
      "OneUptime AI starts as soon as the problem is found.",
    );
    await dialog.getByText("Only if still found after a wait").click();
    await expect(dialog).toContainText(
      "A problem that goes away during the wait is not looked into.",
    );
    await expect(
      dialog.getByTestId("telemetry-ai-rule-wait-minutes"),
    ).toHaveValue("60");

    // Fix: in pull requests, none waiting for a verdict, nothing merged.
    await next.click();
    await expect(dialog).toContainText(
      "OneUptime AI looks into the problem and writes what it found on the finding. It opens no pull request.",
    );
    await expect(dialog).toContainText(
      "OneUptime AI opens the pull request on its own. Nothing is ever merged: your team reviews it.",
    );
    await expect(dialog).not.toContainText("at fault");
    await expect(
      dialog.getByTestId("auto-remediation-runner-field"),
    ).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expect(dialog).toContainText("Step 3 of 3");
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "settings-new-rule-fix");
  });

  test("with the switch off, nothing is said about pull requests; turned on, it is saved and said under the switch", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings?lane=off`);

    const switches: Locator = page.getByTestId("telemetry-ai-switches");
    const laneSwitch: Locator = page.getByRole("switch", {
      name: SWITCH_TITLE,
    });

    await expect(laneSwitch).toBeVisible({ timeout: 60000 });
    await expect(laneSwitch).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("telemetry-ai-readiness")).toHaveCount(0);

    await laneSwitch.click();

    await expect(laneSwitch).toHaveAttribute("aria-checked", "true");
    await expect(
      switches.getByTestId("telemetry-ai-readiness-ready"),
    ).toContainText(
      "OneUptime AI can open pull requests in 2 connected repositories.",
    );

    const { switchSaves } = await fixture(page);

    expect(switchSaves).toEqual([
      expect.objectContaining({ enableAutomaticMetricRemediation: true }),
    ]);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("with no repository connected, the one step to take: connect one in Code", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings?readiness=connect`);

    const connect: Locator = page
      .getByTestId("telemetry-ai-switches")
      .getByTestId("telemetry-ai-readiness-connect");

    await expect(connect).toBeVisible({ timeout: 60000 });
    await expect(connect).toContainText(
      "Connect a repository so OneUptime AI can open pull requests",
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await connect
      .getByRole("link", { name: /Connect a repository in Code/ })
      .click();
    await expect(page.getByTestId("code-page")).toBeVisible();
  });

  test("with Enable AI off, the notice says problems in the metrics are still found", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/settings?ai=off`,
      async (theme: "light" | "dark"): Promise<void> => {
        const notice: Locator = page.getByTestId("project-ai-off-notice");

        await expect(notice).toBeVisible({ timeout: 60000 });
        await expect(notice).toContainText(
          "Problems in your metrics are still found, but none are looked into and no pull requests are opened.",
        );
        await expect(page.getByTestId("telemetry-ai-readiness")).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `settings-ai-off-${theme}`);
      },
    );
  });
});

test.describe("Metrics → AI → Insights", () => {
  test("the problems found, each with its kind, each opening under Metrics' AI tab", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights`,
      async (theme: "light" | "dark"): Promise<void> => {
        for (const title of [
          CARDINALITY_TITLE,
          BUCKETS_TITLE,
          NAMES_TITLE,
          MISSING_TITLE,
        ]) {
          await expect(page.getByText(title)).toBeVisible({ timeout: 60000 });
        }

        // The three kinds side by side, then where they go and who acts.
        await expect(
          page.getByText(
            "Every hour OneUptime looks for metrics that record too many values, histograms whose buckets do not fit, and busy services that send no metrics. It files what it finds here with the evidence.",
            { exact: false },
          ),
        ).toBeVisible();

        // Three kinds: each row says its own, and the type filter offers them.
        const kinds: Array<{ title: string; kind: string }> = [
          { title: CARDINALITY_TITLE, kind: "High Cardinality" },
          { title: BUCKETS_TITLE, kind: "Wrong Histogram Buckets" },
          { title: NAMES_TITLE, kind: "High Cardinality" },
          { title: MISSING_TITLE, kind: "Missing Metrics" },
        ];

        for (const row of kinds) {
          await expect(
            page.getByRole("link").filter({ hasText: row.title }),
          ).toContainText(row.kind);
        }

        await expect(
          page
            .getByRole("combobox", { name: "Filter by insight type" })
            .locator("option"),
        ).toHaveText([
          "All types",
          "High Cardinality",
          "Wrong Histogram Buckets",
          "Missing Metrics",
        ]);

        await expectAiSection(page, testInfo, "Insights");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-${theme}`);
      },
    );

    await page.getByText(CARDINALITY_TITLE).click();
    await expect(page).toHaveURL(
      new RegExp(`/metrics/ai/insights/${CARDINALITY_INSIGHT}`),
    );
  });

  test("none found yet: the empty state and the way to AI Settings", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights?aiInsights=empty`);

    await expect(page.getByText("No metric problems found")).toBeVisible({
      timeout: 60000,
    });
    await expect(
      page.getByText(
        "Every hour OneUptime files a finding when a metric records too many values, a histogram's buckets do not fit, or a busy service sends no metrics.",
      ),
    ).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(page.getByTestId("telemetry-ai-switches")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/metrics/ai/settings`));
  });

  test("none found while the switch is off: it says nothing is looked for, and the way to turn it on", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights?aiInsights=empty&lane=off`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(
          page.getByText("OneUptime is not looking for metric problems"),
        ).toBeVisible({ timeout: 60000 });
        await expect(
          page.getByText(
            `Turn on '${SWITCH_TITLE}' in AI Settings, and OneUptime looks through your metrics every hour.`,
          ),
        ).toBeVisible();
        await expect(page.getByText("No metric problems found")).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-off-${theme}`);
      },
    );

    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(
      page.getByRole("switch", { name: SWITCH_TITLE }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 60000 });
  });
});

test.describe("Metrics → AI → a finding", () => {
  test("a metric recording its users' ids, with no fix yet: its evidence, Open in Metrics, and Fix with AI saying what the pull request does", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights/${CARDINALITY_INSIGHT}`,
      async (theme: "light" | "dark"): Promise<void> => {
        const strip: Locator = page.getByTestId("telemetry-ai-fix");

        await expect(strip).toBeVisible({ timeout: 60000 });
        await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
          "OneUptime AI opens a pull request that stops recording these values on the metric, for you to review.",
        );
        await expect(
          page.getByRole("button", { name: "Open in Metrics" }),
        ).toBeVisible();
        // How a metric is recorded is nothing a monitor could watch.
        await expect(
          page.getByRole("button", { name: "Create Monitor" }),
        ).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insight-${theme}`);
      },
    );

    // A finding is one of the Insights: the menu keeps it lit.
    await expectAiSection(page, testInfo, "Insights");

    await page.getByTestId("telemetry-ai-fix-with-ai").click();

    const progress: Locator = page.getByTestId("telemetry-ai-fix-progress");

    await expect(progress).toContainText("OneUptime AI is working on it.");
    await expect(
      page.getByTestId("telemetry-ai-fix-task-link"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${STARTED_TASK}`,
    );

    const { fixRequests } = await fixture(page);

    // The repository the code was found in: nothing to pick.
    expect(fixRequests).toEqual([{ insightId: CARDINALITY_INSIGHT }]);
  });

  test("the evidence is the detector's own, and keeps no attribute's values", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}`);

    for (const line of [
      "High-cardinality metric in checkout",
      "Metric: http.server.request.count",
      "Unit: {request}",
      "In the last hour: 48,000 data points",
      "Attribute: user.id, 12,000 different values",
      "Its values look like: UUIDs",
      "Also with many values: session.id (4,000)",
    ]) {
      await expect(page.getByText(line, { exact: true })).toBeVisible({
        timeout: 60000,
      });
    }

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    // A histogram: where its values fell, their range, and whose buckets they are.
    await page.goto(`${AI}/insights/${BUCKETS_INSIGHT}`);

    for (const line of [
      "Histogram buckets that do not fit in checkout",
      "95% of its values were at or below 5, its smallest bucket's bound",
      "Values recorded: from 0.012 to 4.8",
      "Buckets: 15 bounds, from 5 to 10,000 - the OpenTelemetry SDKs' default ones, made for milliseconds",
    ]) {
      await expect(page.getByText(line, { exact: true })).toBeVisible({
        timeout: 60000,
      });
    }

    // A service with no metrics: its spans, its busiest operations and its SDK.
    await page.goto(`${AI}/insights/${MISSING_INSIGHT}`);

    for (const line of [
      "Missing metrics in payments",
      "In the last hour: 4,200 spans, 12 failed",
      "No metric has ever arrived from this service",
      // The SDK's language as people name it, not as the SDK sent it.
      "Telemetry SDK: Node.js",
    ]) {
      await expect(page.getByText(line, { exact: true })).toBeVisible({
        timeout: 60000,
      });
    }

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("Open in Metrics opens the metric for the service, from the hour it was found in", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}`);

    const open: Locator = page.getByRole("button", { name: "Open in Metrics" });

    await expect(open).toBeVisible({ timeout: 60000 });
    await open.click();
    await expect(page.getByTestId("metric-view-page")).toBeVisible();

    const address: URL = openedAddress(page);

    expect(address.pathname).toBe(`${METRICS}/view`);
    expect(
      (
        JSON.parse(address.searchParams.get("metricQueries") || "[]") as Array<{
          metricName: string;
        }>
      ).map((query: { metricName: string }): string => {
        return query.metricName;
      }),
    ).toEqual(["http.server.request.count"]);
    expect(JSON.parse(address.searchParams.get("services") || "[]")).toEqual([
      CHECKOUT_SERVICE,
    ]);
    expect(address.searchParams.get("startTime")).toBe(WINDOW_START);
    expect(address.searchParams.get("endTime")).toBe(WINDOW_END);

    // The Viewer tab is lit there.
    await expect(
      tabsOf(page).getByRole("link", { name: "Viewer", exact: true }),
    ).toHaveClass(/bg-indigo-50/);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("metric names with IDs: Fix with AI takes the IDs out of the names, and Open in Metrics searches the service's metric list for them", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${NAMES_INSIGHT}`);

    // Not the attribute's line: these names carry the IDs, not an attribute.
    await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
      "OneUptime AI opens a pull request that takes the IDs out of these metric names, for you to review.",
      { timeout: 60000 },
    );
    await expect(
      page.getByText("Metric names with IDs in worker", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Names like: job.{id}.duration", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "An ID in a metric's name makes a new metric for each value",
        {
          exact: true,
        },
      ),
    ).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Open in Metrics" }).click();
    await expect(page.getByTestId("metrics-viewer-page")).toBeVisible();

    const address: URL = openedAddress(page);

    expect(address.pathname).toBe(METRICS);
    expect(address.searchParams.get("search")).toBe(".duration");
    expect(JSON.parse(address.searchParams.get("filters") || "[]")).toEqual([
      ["primaryEntityId", WORKER_SERVICE],
    ]);
    expect(address.searchParams.get("range")).toBe("Custom");
    expect(address.searchParams.get("start")).toBe(WINDOW_START);
    expect(address.searchParams.get("end")).toBe(WINDOW_END);
  });

  test("a busy service with no metrics: Fix with AI adds them, and Open in Traces opens its spans", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${MISSING_INSIGHT}`);

    await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
      "OneUptime AI opens a pull request that adds metrics to this service, for you to review.",
      { timeout: 60000 },
    );
    await expect(
      page.getByRole("button", { name: "Open in Metrics" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create Monitor" }),
    ).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Open in Traces" }).click();
    await expect(page.getByTestId("traces-viewer-page")).toBeVisible();

    const address: URL = openedAddress(page);

    expect(address.pathname).toBe(`/dashboard/${PROJECT_ID}/traces`);
    expect(JSON.parse(address.searchParams.get("filters") || "[]")).toEqual([
      ["primaryEntityId", PAYMENTS_SERVICE],
    ]);
    expect(address.searchParams.get("start")).toBe(WINDOW_START);
    expect(address.searchParams.get("end")).toBe(WINDOW_END);
  });

  test("long names wrap or end in an ellipsis, and never run off the page or lose their start", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const findings: Array<{ id: string; service: string; code: string }> = [
      {
        id: CARDINALITY_INSIGHT,
        service: LONG_CHECKOUT_SERVICE,
        code: LONG_ATTRIBUTE,
      },
      {
        id: MISSING_INSIGHT,
        service: LONG_PAYMENTS_SERVICE,
        code: LONG_OPERATION,
      },
    ];

    for (const finding of findings) {
      await page.goto(`${AI}/insights/${finding.id}?names=long`);

      const title: Locator = page.getByTestId("ai-insight-title");

      await expect(title).toContainText(finding.service, { timeout: 60000 });

      // The title breaks inside its long words rather than run past its card.
      expect(
        await title.evaluate((element: HTMLElement): number => {
          return element.scrollWidth - element.clientWidth;
        }),
      ).toBeLessThanOrEqual(0);

      // Every name in code stays inside its line of evidence.
      const code: Locator = page.locator("li code").filter({
        hasText: finding.code,
      });

      await expect(code).toBeVisible();

      const overflow: Array<number> = await page
        .locator("li code")
        .evaluateAll((elements: Array<Element>): Array<number> => {
          return elements.map((element: Element): number => {
            const item: Element | null = element.closest("li");
            return item
              ? element.getBoundingClientRect().right -
                  item.getBoundingClientRect().right
              : 0;
          });
        });

      expect(
        overflow.filter((pixels: number): boolean => {
          return pixels > 1;
        }),
      ).toEqual([]);

      /*
       * The service's name in Details is cut at its end, never at its start
       * ("eu-west-1-production" read as another service), and is whole
       * under the pointer.
       */
      const service: Locator = page.locator(`dd[title="${finding.service}"]`);

      await expect(service).toBeVisible();

      const edges: { name: number; row: number; cut: boolean } =
        await service.evaluate(
          (
            element: HTMLElement,
            name: string,
          ): { name: number; row: number; cut: boolean } => {
            const holder: HTMLElement | undefined = Array.from(
              element.querySelectorAll<HTMLElement>("*"),
            ).find((candidate: HTMLElement): boolean => {
              return (
                candidate.children.length === 0 &&
                (candidate.textContent || "") === name
              );
            });

            return {
              name: holder ? holder.getBoundingClientRect().left : -1,
              row: element.getBoundingClientRect().left,
              cut: holder ? holder.scrollWidth > holder.clientWidth : false,
            };
          },
          finding.service,
        );

      expect(edges.name).toBeGreaterThanOrEqual(edges.row - 1);
      // Too long for the rail at either width: it ends in an ellipsis.
      expect(edges.cut).toBe(true);

      await expectNoSidewaysScroll(page);
    }

    // The list, and the logs: nothing sideways, and a kind read as one.
    await page.goto(`${AI}/insights?names=long`);
    await expect(
      page.getByText(LONG_METRIC, { exact: false }).first(),
    ).toBeVisible({ timeout: 60000 });
    await expectNoSidewaysScroll(page);

    await page.goto(`${AI}/logs?names=long`);

    const kinds: Locator = page.getByTestId("telemetry-ai-log-kind");

    await expect(kinds.first()).toHaveText("Pull request", { timeout: 60000 });

    for (const lines of await kinds.evaluateAll(
      (elements: Array<Element>): Array<number> => {
        return elements.map((element: Element): number => {
          return element.getClientRects().length;
        });
      },
    )) {
      expect(lines).toBe(1);
    }

    await expectNoSidewaysScroll(page);

    if (isPhone(testInfo)) {
      await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}?names=long`);
      await expect(page.getByTestId("ai-insight-title")).toBeVisible({
        timeout: 60000,
      });
      await screenshot(page, testInfo, "insight-long-names");
    }
  });

  test("a histogram OneUptime already opened a pull request for: its fix task, and no second offer", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${BUCKETS_INSIGHT}`);

    await expect(
      page.getByText("View the fix task and pull request"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create Monitor" }),
    ).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "insight-fix-opened");
  });

  test("no repository found to hold the code: pick one first, and the fix is asked in it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}?offer=pick`);

    const picker: Locator = page.getByTestId("telemetry-ai-fix-repository");
    const button: Locator = page.getByTestId("telemetry-ai-fix-with-ai");

    await expect(picker).toContainText("Which repository holds this code?", {
      timeout: 60000,
    });
    await expect(button).toBeDisabled();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "insight-pick-repository");

    await picker.getByRole("combobox").click();
    await page.getByRole("option", { name: "acme/platform" }).click();
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.getByTestId("telemetry-ai-fix-progress")).toBeVisible();

    const { fixRequests } = await fixture(page);

    expect(fixRequests).toEqual([
      { insightId: CARDINALITY_INSIGHT, repositoryId: PLATFORM_REPOSITORY },
    ]);
  });

  test("every reason Fix with AI is not offered is said in its place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // No repository connected: the one step, in Code.
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}?offer=connect`);

    const connect: Locator = page.getByTestId("telemetry-ai-fix-connect");

    await expect(connect).toHaveText(
      "Connect a repository to fix this with AI",
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await connect.click();
    await expect(page.getByTestId("code-page")).toBeVisible();

    // Code's gate says no: what it says, in the strip.
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}?offer=credits`);
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveAttribute(
      "data-offer",
      "SetUp",
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A fix already on its way: its task, and no second offer.
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}?offer=running`);
    await expect(
      page.getByTestId("telemetry-ai-fix-task-link"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${RUNNING_TASK}`,
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A refusal: said in the strip, with the server's reason.
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}?fail=fix`);
    await page.getByTestId("telemetry-ai-fix-with-ai").click({
      timeout: 60000,
    });
    await expect(page.getByTestId("telemetry-ai-fix-error")).toHaveText(
      "Could not start the fix: Pick the repository that holds this code.",
    );

    // AI off for the project: nothing at all.
    await page.goto(`${AI}/insights/${CARDINALITY_INSIGHT}?ai=off`);
    await expect(
      page.getByText("Attribute: user.id, 12,000 different values", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);
  });
});

test.describe("Metrics → AI → Logs", () => {
  test("every investigation and pull request, newest first, with how each stands", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/logs`,
      async (theme: "light" | "dark"): Promise<void> => {
        const entries: Locator = page.getByTestId("telemetry-ai-log-entry");

        await expect(entries).toHaveCount(3, { timeout: 60000 });
        await expect(
          page.getByText(
            "Everything OneUptime AI did with the problems it found in your metrics, newest first",
            { exact: false },
          ),
        ).toBeVisible();

        const automatic: Locator = entries.nth(0);

        await expect(automatic).toContainText("Pull request");
        await expect(automatic).toContainText(BUCKETS_TITLE);
        await expect(automatic).toContainText("Started by OneUptime");
        await expect(automatic).toContainText("acme/checkout");
        await expect(
          automatic.getByRole("link", { name: "Pull request #1311" }),
        ).toHaveAttribute("href", "https://github.com/acme/checkout/pull/1311");

        await expect(entries.nth(2)).toContainText("Asked by Ada Lovelace");
        await expect(entries.nth(2)).toContainText("Nothing to change");

        // An investigation says what it found; a pull request says no verdict.
        await expect(
          entries.nth(1).getByTestId("telemetry-ai-log-verdict"),
        ).toHaveText("Found a fault in the code");
        await expect(
          automatic.getByTestId("telemetry-ai-log-verdict"),
        ).toHaveCount(0);

        await expectAiSection(page, testInfo, "Logs");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `logs-${theme}`);
      },
    );

    // The fourth entry is a page away.
    await page.getByTestId("telemetry-ai-logs-load-more").click();
    await expect(page.getByTestId("telemetry-ai-log-entry")).toHaveCount(4);
    await expect(
      page.getByTestId("telemetry-ai-log-entry").nth(3),
    ).toContainText("Failed");
    await expect(
      page.getByTestId("telemetry-ai-log-entry").nth(3),
    ).toContainText(MISSING_TITLE);

    // A finding opens under Metrics' AI tab.
    await page
      .getByTestId("telemetry-ai-log-entry")
      .nth(0)
      .getByRole("link", { name: BUCKETS_TITLE })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/metrics/ai/insights/${BUCKETS_INSIGHT}`),
    );
  });

  test("nothing yet, and a read that failed, each say so in place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/logs?aiLogs=empty`);
    await expect(page.getByTestId("telemetry-ai-logs-empty")).toContainText(
      "When OneUptime AI looks into a problem in your metrics or opens a pull request for it, it shows up here.",
      { timeout: 60000 },
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    // The way on: what OneUptime AI does is chosen in AI Settings.
    await page.getByTestId("telemetry-ai-logs-settings").click();
    await expect(page.getByTestId("telemetry-ai-switches")).toBeVisible();

    await page.goto(`${AI}/logs?aiLogs=fail`);
    await expect(
      page.getByText("Could not load the AI logs", { exact: false }),
    ).toBeVisible({ timeout: 60000 });
  });
});
