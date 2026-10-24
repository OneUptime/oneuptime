import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Logs' AI tab - Logs → AI → Insights, a finding's page with Fix with AI,
 * Activity and Settings - against the offline fixture (Fixture/Fixture.js
 * and Fixture/LogFindings.js): the pages are production components; only
 * the data boundary is synthetic. OneUptime has found four problems in the
 * project's logs: checkout logs one payment error 1,240 times in an hour
 * (no fix yet), POST /charge in payments fails without logging (a pull
 * request OneUptime opened on its own), one cache line is 62% of billing's
 * logs, and billing's logs carry no trace context.
 *
 * Each test asserts what the page drew - on a laptop (1280) and on a phone
 * (390), in light and dark - with no sideways scroll on the phone.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const LOGS: string = `/dashboard/${PROJECT_ID}/logs`;
const TRACES: string = `/dashboard/${PROJECT_ID}/traces`;
const AI: string = `${LOGS}/ai`;
const ERROR_INSIGHT: string = "50940000-0000-4000-8000-0000000000e1";
const SILENT_INSIGHT: string = "50940000-0000-4000-8000-0000000000e2";
const NOISY_INSIGHT: string = "50940000-0000-4000-8000-0000000000e3";
const UNTRACED_INSIGHT: string = "50940000-0000-4000-8000-0000000000e4";
const CHECKOUT_SERVICE: string = "50940000-0000-4000-8000-0000000000a1";
const PAYMENTS_SERVICE: string = "50940000-0000-4000-8000-0000000000a2";
const BILLING_SERVICE: string = "50940000-0000-4000-8000-0000000000a3";
const PLATFORM_REPOSITORY: string = "50940000-0000-4000-8000-0000000000b2";
const STARTED_TASK: string = "50940000-0000-4000-8000-0000000000f3";
const RUNNING_TASK: string = "50940000-0000-4000-8000-0000000000f4";

/*
 * A small button's height with its words on one line, on a laptop or a
 * phone (Fix with AI squeezed beside the picker in the rail wraps into
 * three lines, over 60px).
 */
const ONE_LINE_BUTTON_HEIGHT: number = 40;

const ERROR_TITLE: string =
  'checkout logged "Payment provider returned <num>: card declined" 1,240 times in an hour';
const SILENT_TITLE: string = "POST /charge in payments fails without logging";
const NOISY_TITLE: string =
  '"cache hit for key <uuid>" is 62% of billing\'s logs';
const UNTRACED_TITLE: string = "billing's logs carry no trace context";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/logs-ai-ui",
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
        (window as unknown as { __logsAiFixture: FixtureState })
          .__logsAiFixture,
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

// Logs' tab bar: the one that holds Setup Guide.
function logsTabs(page: Page): Locator {
  return page.locator("nav").filter({ hasText: "Setup Guide" }).first();
}

/*
 * Logs' tabs with AI lit, and the AI section's side menu: its own pages,
 * the one shown marked (on a phone, named in the menu's summary).
 */
async function expectAiSection(
  page: Page,
  testInfo: TestInfo,
  current: "Insights" | "Activity" | "Settings",
): Promise<void> {
  const tabs: Locator = logsTabs(page);

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

  for (const item of ["Insights", "Activity", "Settings"]) {
    await expect(menu.getByRole("link", { name: item })).toBeVisible();
  }

  await expect(menu.getByRole("link", { name: current })).toHaveClass(
    /bg-indigo-50/,
  );
}

/*
 * Where Fix with AI's repository picker and its button sit: stacked when
 * the button's top is at or below the picker's bottom.
 */
async function measureFixStrip(
  picker: Locator,
  button: Locator,
): Promise<{ isStacked: boolean; buttonHeight: number }> {
  const pickerBox: { y: number; height: number } | null =
    await picker.boundingBox();
  const buttonBox: { y: number; height: number } | null =
    await button.boundingBox();

  if (!pickerBox || !buttonBox) {
    throw new Error("The picker or the button is not drawn.");
  }

  return {
    isStacked: buttonBox.y >= pickerBox.y + pickerBox.height - 1,
    buttonHeight: buttonBox.height,
  };
}

// The address a link opened, its filters read back.
function openedAddress(page: Page): {
  path: string;
  filters: Array<[string, unknown]>;
  params: URLSearchParams;
} {
  const address: URL = new URL(page.url());

  return {
    path: address.pathname,
    filters: JSON.parse(address.searchParams.get("filters") || "[]"),
    params: address.searchParams,
  };
}

test.describe("Logs → AI tab", () => {
  test("sits between Insights and Setup Guide, and opens on what OneUptime found", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const tabs: Locator = logsTabs(page);

    await expect(tabs).toBeVisible({ timeout: 60000 });
    await expect(tabs.getByRole("link")).toHaveText([
      "Viewer",
      "Insights",
      "AI",
      "Setup Guide",
      "Settings",
    ]);

    await tabs.getByRole("link", { name: "AI", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/logs/ai/insights$`));
    await expect(page.getByText(ERROR_TITLE)).toBeVisible();
    await expectAiSection(page, testInfo, "Insights");

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });
});

test.describe("Logs → AI → Settings", () => {
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
        await expect(switches).toContainText(
          "Find and fix error, missing and noisy logs",
        );
        await expect(switches).toContainText(
          "Every hour OneUptime checks your logs for repeated errors, unlogged failures and noisy lines.",
        );
        // What it fixes, not a pull request promised for every problem.
        await expect(switches).toContainText(
          "OneUptime AI fixes what it can with pull requests.",
        );
        await expect(
          page.getByRole("switch", {
            name: "Find and fix error, missing and noisy logs",
          }),
        ).toHaveAttribute("aria-checked", "true");

        // What the switch leads to sits under it, inside its card.
        const ready: Locator = switches.getByTestId(
          "telemetry-ai-readiness-ready",
        );

        await expect(ready).toContainText(
          "OneUptime AI can open pull requests in 2 connected repositories.",
        );
        await expect(ready).toContainText(
          "It opens at most 5 on its own each day (UTC): 2 so far today.",
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

  test("a new rule asks Match, Investigate and Fix in the words of log problems, and an error log's pull request waits for the code at fault", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const advanced: Locator = page.getByTestId("telemetry-ai-advanced-section");

    await expect(advanced).toBeVisible({ timeout: 60000 });
    // A pull request for each problem it can fix, not for each problem.
    await expect(advanced).toContainText(
      "OneUptime AI looks into every problem it finds in your logs right away, and opens a pull request for each one it can fix.",
    );
    await advanced.getByRole("button", { name: /More settings/ }).click();

    // A card's description is a laptop's: a phone keeps the card to its title.
    if (!isPhone(testInfo)) {
      await expect(
        page.getByText(
          "With no rule, OneUptime AI looks into every problem in your logs right away, and opens a pull request for each one it can fix.",
          { exact: false },
        ),
      ).toBeVisible();
    }

    // The empty table: no rules, and what that means for log problems.
    await expect(
      page.getByText(
        "Every problem found in your logs is looked into, and a pull request opened for each one OneUptime AI can fix.",
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

    // Fix: in pull requests - an error log's once the code is at fault.
    await next.click();
    await expect(dialog).toContainText(
      "OneUptime AI looks into the problem and writes what it found on the finding. It opens no pull request.",
    );
    await expect(dialog).toContainText(
      "OneUptime AI opens the pull request on its own, for an error log once it finds the code at fault. Nothing is ever merged.",
    );
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
      name: "Find and fix error, missing and noisy logs",
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

    // The Logs lane's own switch, and no other.
    expect(switchSaves).toEqual([{ enableAutomaticLogRemediation: true }]);

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

  test("with Enable AI off, the notice says error, missing and noisy logs are still found", async ({
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
          "Error, missing and noisy logs are still found, but none are looked into and no pull requests are opened.",
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

test.describe("Logs → AI → Insights", () => {
  test("the problems found, each with its kind, each opening under Logs' AI tab", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights`,
      async (theme: "light" | "dark"): Promise<void> => {
        for (const title of [
          ERROR_TITLE,
          SILENT_TITLE,
          NOISY_TITLE,
          UNTRACED_TITLE,
        ]) {
          await expect(page.getByText(title)).toBeVisible({ timeout: 60000 });
        }

        await expect(
          page.getByText(
            "Every hour OneUptime looks through your services' logs for errors they log again and again",
            { exact: false },
          ),
        ).toBeVisible();

        // Three kinds: each row says its own, and the type filter offers them.
        const kinds: Array<{ title: string; kind: string }> = [
          { title: ERROR_TITLE, kind: "Error Log" },
          { title: SILENT_TITLE, kind: "Missing Logging" },
          { title: NOISY_TITLE, kind: "Noisy Log" },
          { title: UNTRACED_TITLE, kind: "Missing Logging" },
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
          "Error Log",
          "Missing Logging",
          "Noisy Log",
        ]);

        await expectAiSection(page, testInfo, "Insights");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-${theme}`);
      },
    );

    await page.getByText(ERROR_TITLE).click();
    await expect(page).toHaveURL(
      new RegExp(`/logs/ai/insights/${ERROR_INSIGHT}`),
    );
  });

  test("none found yet: the empty state and the way to AI Settings", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights?aiInsights=empty`);

    await expect(
      page.getByText("No error, missing or noisy logs found"),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText(
        "Every hour OneUptime looks through your services' logs and files a finding when an error repeats, a failure goes unlogged, or one line floods them.",
      ),
    ).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(page.getByTestId("telemetry-ai-switches")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/logs/ai/settings`));
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
          page.getByText(
            "OneUptime is not looking for error, missing or noisy logs",
          ),
        ).toBeVisible({ timeout: 60000 });
        await expect(
          page.getByText(
            "Turn on 'Find and fix error, missing and noisy logs' in AI Settings, and OneUptime looks through your services' logs every hour.",
          ),
        ).toBeVisible();
        await expect(
          page.getByText("No error, missing or noisy logs found"),
        ).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-off-${theme}`);
      },
    );

    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(
      page.getByRole("switch", {
        name: "Find and fix error, missing and noisy logs",
      }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 60000 });
  });
});

test.describe("Logs → AI → a finding", () => {
  test("an error log with no fix yet: its evidence, Open in Logs, and Fix with AI saying what the pull request does", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights/${ERROR_INSIGHT}`,
      async (theme: "light" | "dark"): Promise<void> => {
        const strip: Locator = page.getByTestId("telemetry-ai-fix");

        await expect(strip).toBeVisible({ timeout: 60000 });
        await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
          "OneUptime AI opens a pull request that fixes why this error is logged, for you to review.",
        );
        await expect(
          page.getByRole("button", { name: "Open in Logs" }),
        ).toBeVisible();
        await expect(
          page.getByText("src/payments/charge.ts:88").first(),
        ).toBeVisible();

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
    expect(fixRequests).toEqual([{ insightId: ERROR_INSIGHT }]);
  });

  test("the evidence is the detector's own: the message as its pattern, how often, and where it was logged", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}`);

    await expect(
      page.getByText("In the last hour: 1,240 times, at Error", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("The service's Error and Fatal logs in that hour: 2,100", {
        exact: true,
      }),
    ).toBeVisible();
    // The message as its pattern: the amount masked, never a line as logged.
    await expect(
      page.getByText("Payment provider returned <num>: card declined", {
        exact: false,
      }),
    ).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    // A failure that writes no log line: the operation and its silence.
    await page.goto(`${AI}/insights/${SILENT_INSIGHT}`);
    await expect(
      page.getByText(
        "None of the 20 most recent failed requests wrote a log line",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60000 });

    // A noisy log: its share of the lines read.
    await page.goto(`${AI}/insights/${NOISY_INSIGHT}`);
    await expect(
      page.getByText("Share: 62% of the 48,000 lines read from the last hour", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });

    // Logs with no trace id: how many of them carry one.
    await page.goto(`${AI}/insights/${UNTRACED_INSIGHT}`);
    await expect(
      page.getByText("Logs with a trace id: 0 (0%)", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
  });

  test("Open in Logs opens the error's lines from the hour it was found in, at Error and Fatal, by the message's words", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}`);

    const open: Locator = page.getByRole("button", { name: "Open in Logs" });

    await expect(open).toBeVisible({ timeout: 60000 });
    await open.click();
    await expect(page.getByTestId("logs-viewer-page")).toBeVisible();

    const opened: {
      path: string;
      filters: Array<[string, unknown]>;
      params: URLSearchParams;
    } = openedAddress(page);

    expect(opened.path).toBe(LOGS);
    expect(opened.filters).toEqual([
      ["severityText", ["Error", "Fatal"]],
      ["primaryEntityId", [CHECKOUT_SERVICE]],
      ["body", ["Payment provider returned"]],
    ]);
    expect(opened.params.get("range")).toBe("Custom");
    expect(opened.params.get("end")).toBe(NOW.toISOString());
    expect(opened.params.get("start")).toBe(
      new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    );

    // The Viewer tab is lit there.
    await expect(
      logsTabs(page).getByRole("link", { name: "Viewer", exact: true }),
    ).toHaveClass(/bg-indigo-50/);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("a noisy log: Fix with AI logs the line less, and Open in Logs opens its lines at the severity they were logged at", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${NOISY_INSIGHT}`);

    await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
      "OneUptime AI opens a pull request that logs this line less, for you to review.",
      { timeout: 60000 },
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "insight-noisy");

    await page.getByRole("button", { name: "Open in Logs" }).click();

    expect(openedAddress(page).filters).toEqual([
      ["severityText", ["Debug"]],
      ["primaryEntityId", [BILLING_SERVICE]],
      ["body", ["cache hit for key"]],
    ]);
  });

  test("logs with no trace context: Fix with AI adds the logging this lacks, and Open in Logs opens the service's logs", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${UNTRACED_INSIGHT}`);

    await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
      "OneUptime AI opens a pull request that adds the logging this lacks, for you to review.",
      { timeout: 60000 },
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Open in Logs" }).click();

    expect(openedAddress(page).filters).toEqual([
      ["primaryEntityId", [BILLING_SERVICE]],
    ]);
  });

  test("a failure that writes no log line, which OneUptime already opened a pull request for: its fix task, no second offer, and its failed spans in Traces", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${SILENT_INSIGHT}`);

    await expect(
      page.getByText("View the fix task and pull request"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);
    // It has no lines to open: its way in is Traces.
    await expect(
      page.getByRole("button", { name: "Open in Logs" }),
    ).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Open in Traces" }).click();
    await expect(page.getByTestId("traces-viewer-page")).toBeVisible();

    const opened: {
      path: string;
      filters: Array<[string, unknown]>;
      params: URLSearchParams;
    } = openedAddress(page);

    expect(opened.path).toBe(TRACES);
    expect(opened.filters).toEqual([
      ["primaryEntityId", PAYMENTS_SERVICE],
      ["name", "POST /charge"],
      ["statusCode", "2"],
    ]);
    expect(opened.params.get("start")).toBe(
      new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    );
  });

  test("no repository found to hold the code: pick one first, and the fix is asked in it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?offer=pick`);

    const picker: Locator = page.getByTestId("telemetry-ai-fix-repository");
    const button: Locator = page.getByTestId("telemetry-ai-fix-with-ai");

    await expect(picker).toContainText("Which repository holds this code?", {
      timeout: 60000,
    });
    await expect(button).toBeDisabled();

    // Stacked in the narrow rail, the button's words on one line.
    const narrow: { isStacked: boolean; buttonHeight: number } =
      await measureFixStrip(picker, button);

    expect(narrow.isStacked).toBe(true);
    expect(narrow.buttonHeight).toBeLessThanOrEqual(ONE_LINE_BUTTON_HEIGHT);

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
      { insightId: ERROR_INSIGHT, repositoryId: PLATFORM_REPOSITORY },
    ]);
  });

  test("every reason Fix with AI is not offered is said in its place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // No repository connected: the one step, in Code.
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?offer=connect`);

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
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?offer=credits`);
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveAttribute(
      "data-offer",
      "SetUp",
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A fix already on its way: its task, and no second offer.
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?offer=running`);
    await expect(
      page.getByTestId("telemetry-ai-fix-task-link"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${RUNNING_TASK}`,
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A refusal: said in the strip, with the server's reason.
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?fail=fix`);
    await page.getByTestId("telemetry-ai-fix-with-ai").click({
      timeout: 60000,
    });
    await expect(page.getByTestId("telemetry-ai-fix-error")).toHaveText(
      "Could not start the fix: Pick the repository that holds this code.",
    );

    // AI off for the project: nothing at all.
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?ai=off`);
    await expect(
      page.getByText("src/payments/charge.ts:88").first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);
  });

  test("Create Monitor: an error log's opens Monitor Create on the finding; missing logging and a noisy log draw none", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}`);

    const createMonitor: Locator = page.getByRole("button", {
      name: "Create Monitor",
    });

    // Not greyed out: a Logs monitor counts the message's lines.
    await expect(createMonitor).toBeEnabled({ timeout: 60000 });

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await createMonitor.click();
    await expect(page.getByTestId("monitor-create-page")).toBeVisible();

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(address.searchParams.get("aiInsightId")).toBe(ERROR_INSIGHT);

    // Nothing a monitor's incident would fix: no button at all.
    for (const insight of [SILENT_INSIGHT, NOISY_INSIGHT, UNTRACED_INSIGHT]) {
      await page.goto(`${AI}/insights/${insight}`);
      await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible({
        timeout: 60000,
      });
      await expect(
        page.getByRole("button", { name: "Create Monitor" }),
      ).toHaveCount(0);
    }
  });
});

test.describe("Logs → AI → Activity", () => {
  test("every investigation and pull request, newest first, with how each stands", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/activity`,
      async (theme: "light" | "dark"): Promise<void> => {
        const entries: Locator = page.getByTestId("telemetry-ai-log-entry");

        await expect(entries).toHaveCount(3, { timeout: 60000 });
        await expect(
          page.getByText(
            "Everything OneUptime AI did with the problems it found in your logs, newest first",
            { exact: false },
          ),
        ).toBeVisible();

        const automatic: Locator = entries.nth(0);

        await expect(automatic).toContainText("Pull request");
        await expect(automatic).toContainText("Started by OneUptime");
        await expect(automatic).toContainText("acme/payments");
        await expect(
          automatic.getByRole("link", { name: "Pull request #1307" }),
        ).toHaveAttribute("href", "https://github.com/acme/payments/pull/1307");

        await expect(entries.nth(2)).toContainText("Asked by Ada Lovelace");
        await expect(entries.nth(2)).toContainText("Nothing to change");

        await expectAiSection(page, testInfo, "Activity");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `activity-${theme}`);
      },
    );

    // The fourth entry is a page away.
    await page.getByTestId("telemetry-ai-logs-load-more").click();
    await expect(page.getByTestId("telemetry-ai-log-entry")).toHaveCount(4);
    await expect(
      page.getByTestId("telemetry-ai-log-entry").nth(3),
    ).toContainText("Failed");

    // A finding opens under Logs' AI tab.
    await page
      .getByTestId("telemetry-ai-log-entry")
      .nth(0)
      .getByRole("link", { name: SILENT_TITLE })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/logs/ai/insights/${SILENT_INSIGHT}`),
    );
  });

  test("nothing yet, and a read that failed, each say so in place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/activity?aiLogs=empty`);
    await expect(page.getByTestId("telemetry-ai-logs-empty")).toContainText(
      "When OneUptime AI looks into a problem in your logs or opens a pull request for it, it shows up here.",
      { timeout: 60000 },
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    // The way on: what OneUptime AI does is chosen in AI Settings.
    await page.getByTestId("telemetry-ai-logs-settings").click();
    await expect(page.getByTestId("telemetry-ai-switches")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/logs/ai/settings`));

    await page.goto(`${AI}/activity?aiLogs=fail`);
    await expect(
      page.getByText("The AI activity could not be read.", { exact: false }),
    ).toBeVisible({ timeout: 60000 });
  });
});
