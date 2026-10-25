import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Exceptions' AI tab - Exceptions → AI → Insights, a finding's page with Fix
 * with AI, Logs and Settings - against the offline fixture
 * (Fixture/Fixture.js and Fixture/ExceptionFindings.js): the pages are
 * production components; only the data boundary is synthetic. OneUptime has
 * found three problems in the project's exceptions: a new TypeError in
 * checkout raised in its own code (no fix yet), a spike of
 * ValidationError in payments (a pull request OneUptime opened on its
 * own, to handle that expected error better) and edge's exceptions, which
 * carry no stack trace.
 *
 * Each test asserts what the page drew - on a laptop (1280) and on a phone
 * (390), in light and dark - with no sideways scroll on the phone.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const EXCEPTIONS: string = `/dashboard/${PROJECT_ID}/exceptions`;
const AI: string = `${EXCEPTIONS}/ai`;
const NEW_INSIGHT: string = "52400000-0000-4000-8000-0000000000e1";
const SPIKE_INSIGHT: string = "52400000-0000-4000-8000-0000000000e2";
const STACK_TRACE_INSIGHT: string = "52400000-0000-4000-8000-0000000000e3";
const COUPON_EXCEPTION: string = "52400000-0000-4000-8000-0000000000d1";
const EDGE_SERVICE: string = "52400000-0000-4000-8000-0000000000a3";
const PLATFORM_REPOSITORY: string = "52400000-0000-4000-8000-0000000000b2";
const STARTED_TASK: string = "52400000-0000-4000-8000-0000000000f3";
const RUNNING_TASK: string = "52400000-0000-4000-8000-0000000000f4";

/*
 * A small button's height with its words on one line, on a laptop or a
 * phone (squeezed beside the picker in the rail, it wraps to over 60px).
 */
const ONE_LINE_BUTTON_HEIGHT: number = 40;

const NEW_TITLE: string =
  "New exception: TypeError: Cannot read properties of undefined (reading 'id') in checkout";
const SPIKE_TITLE: string =
  "Exception spike: ValidationError: card number is not valid at 12.0x normal rate in payments";
const STACK_TRACE_TITLE: string = "Exceptions in edge have no stack trace";

const FIX_LEAD: string =
  "OneUptime AI opens a pull request that fixes this exception, for you to review.";
const HANDLING_LEAD: string =
  "OneUptime AI opens a pull request that improves how your code handles this expected error, for you to review.";
const STACK_TRACE_LEAD: string =
  "OneUptime AI opens a pull request that makes this service record stack traces, for you to review.";

// The inbox's opening words, with the switch on and off.
const INSIGHTS_INTRO: string =
  "Every 15 minutes OneUptime looks for new exceptions, exceptions that suddenly happen far more often, and exceptions with no stack trace, and files what it finds here with the evidence. OneUptime AI looks into each finding and opens a pull request to fix it, as your AI settings say.";
const INSIGHTS_OFF_INTRO: string =
  "'Find and fix new and rising exceptions' is off: new and rising exceptions are left to AI Insights and its settings, and OneUptime does not look for missing stack traces. Turn it on in AI Settings.";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/exceptions-ai-ui",
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
        (window as unknown as { __exceptionsAiFixture: FixtureState })
          .__exceptionsAiFixture,
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

function exceptionsTabs(page: Page): Locator {
  return page.locator("nav").filter({ hasText: "Setup Guide" }).first();
}

/*
 * Exceptions' tabs with AI lit, and the AI section's side menu: its own
 * pages, the one shown marked (on a phone, named in the menu's summary).
 */
async function expectAiSection(
  page: Page,
  testInfo: TestInfo,
  current: "Insights" | "Logs" | "Settings",
): Promise<void> {
  const tabs: Locator = exceptionsTabs(page);

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

test.describe("Exceptions → AI tab", () => {
  test("sits between Insights and Setup Guide, and opens on what OneUptime found", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const tabs: Locator = exceptionsTabs(page);

    await expect(tabs).toBeVisible({ timeout: 60000 });
    await expect(tabs.getByRole("link")).toHaveText([
      /^Exceptions/,
      "Insights",
      "AI",
      "Setup Guide",
    ]);

    await tabs.getByRole("link", { name: "AI", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/exceptions/ai/insights$`));
    await expect(page.getByText(NEW_TITLE)).toBeVisible();
    await expectAiSection(page, testInfo, "Insights");

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });
});

test.describe("Exceptions → AI → Settings", () => {
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
          "Find and fix new and rising exceptions",
        );
        await expect(switches).toContainText(
          "Every 15 minutes OneUptime looks for new and rising exceptions and ones with no stack trace.",
        );
        // What it fixes, not a pull request promised for every exception.
        await expect(switches).toContainText(
          "OneUptime AI fixes what it can with pull requests.",
        );
        await expect(
          page.getByRole("switch", {
            name: "Find and fix new and rising exceptions",
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

        // Opened, the rules: when each looks into an exception, and how it fixes it.
        await advanced.getByRole("button", { name: /More settings/ }).click();

        await expect(page.getByText("Checkout services")).toBeVisible();
        await expect(
          page.getByText("If still found after 30 minutes"),
        ).toBeVisible();

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `settings-rules-${theme}`);
      },
    );
  });

  test("a new rule asks Match, Investigate and Fix in the words of exceptions, and its pull request waits for the code at fault or an expected error", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const advanced: Locator = page.getByTestId("telemetry-ai-advanced-section");

    await expect(advanced).toBeVisible({ timeout: 60000 });
    // A pull request for each exception it can fix, not for each exception.
    await expect(advanced).toContainText(
      "OneUptime AI looks into every exception it finds right away, and opens a pull request for each one it can fix.",
    );
    await advanced.getByRole("button", { name: /More settings/ }).click();

    // The empty table: no rules, and what that means for exceptions.
    await expect(page.getByRole("heading", { name: "No rules" })).toBeVisible();
    await expect(
      page.getByText(
        "Every exception found is looked into, and a pull request opened for each one OneUptime AI can fix.",
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

    // Investigate: right away, or only if the exception is still found.
    await next.click();
    await expect(dialog).toContainText(
      "OneUptime AI starts as soon as the exception is found.",
    );
    await dialog.getByText("Only if still found after a wait").click();
    await expect(dialog).toContainText(
      "An exception that goes away during the wait is not looked into.",
    );

    // Fix: in pull requests - on its own once the verdict lets one open.
    await next.click();
    await expect(dialog).toContainText(
      "OneUptime AI looks into the exception and writes what it found on the finding. It opens no pull request.",
    );
    await expect(dialog).toContainText(
      "OneUptime AI opens the pull request on its own once it finds the code at fault, or an expected error to handle better. Nothing is ever merged.",
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
      name: "Find and fix new and rising exceptions",
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
      expect.objectContaining({ enableAutomaticExceptionRemediation: true }),
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

  test("with Enable AI off, the notice says new and rising exceptions are still found", async ({
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
          "New and rising exceptions are still found, but none are looked into and no pull requests are opened.",
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

test.describe("Exceptions → AI → Insights", () => {
  test("the problems found, each with its kind, each opening under Exceptions' AI tab", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights`,
      async (theme: "light" | "dark"): Promise<void> => {
        for (const title of [NEW_TITLE, SPIKE_TITLE, STACK_TRACE_TITLE]) {
          await expect(page.getByText(title)).toBeVisible({ timeout: 60000 });
        }

        await expect(
          page.getByText(
            "Every 15 minutes OneUptime looks for new exceptions, exceptions that suddenly happen far more often, and exceptions with no stack trace",
            { exact: false },
          ),
        ).toBeVisible();

        // Three kinds: each row says its own, and the type filter offers them.
        const kinds: Array<{ title: string; kind: string }> = [
          { title: NEW_TITLE, kind: "New Exception" },
          { title: SPIKE_TITLE, kind: "Exception Spike" },
          { title: STACK_TRACE_TITLE, kind: "Missing Stack Trace" },
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
          "New Exception",
          "Exception Spike",
          "Missing Stack Trace",
        ]);

        await expectAiSection(page, testInfo, "Insights");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-${theme}`);
      },
    );

    await page.getByText(NEW_TITLE).click();
    await expect(page).toHaveURL(
      new RegExp(`/exceptions/ai/insights/${NEW_INSIGHT}`),
    );
  });

  test("none found yet: the empty state and the way to AI Settings", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights?aiInsights=empty`);

    await expect(
      page.getByText("No new or rising exceptions found"),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText(
        "Every 15 minutes OneUptime looks through your exceptions and files a finding when one is new, rises sharply, or has no stack trace.",
      ),
    ).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(page.getByTestId("telemetry-ai-switches")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/exceptions/ai/settings`));
  });

  /*
   * Every project made before the switch has it off, and AI Insights still
   * files its new and rising exceptions there: they are listed, under words
   * that say the section is off and why they are there.
   */
  test("while the switch is off, AI Insights' new and rising exceptions are listed under words that say it is off", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights?lane=off`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(page.getByText(INSIGHTS_OFF_INTRO)).toBeVisible({
          timeout: 60000,
        });
        await expect(page.getByText(INSIGHTS_INTRO)).toHaveCount(0);
        await expect(page.getByText(NEW_TITLE)).toBeVisible();
        await expect(page.getByText(SPIKE_TITLE)).toBeVisible();
        // Nothing looks for missing stack traces while it is off.
        await expect(page.getByText(STACK_TRACE_TITLE)).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-lane-off-${theme}`);
      },
    );

    // On, the section's own opening words.
    await page.goto(`${AI}/insights`);
    await expect(page.getByText(INSIGHTS_INTRO)).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText(INSIGHTS_OFF_INTRO)).toHaveCount(0);
  });

  test("none found while the switch is off: it says finding and fixing is off, and the way to turn it on", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights?aiInsights=empty&lane=off`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(
          page.getByText("Finding and fixing exceptions is off"),
        ).toBeVisible({ timeout: 60000 });
        await expect(
          page.getByText(
            "Turn on 'Find and fix new and rising exceptions' in AI Settings, and OneUptime looks through your exceptions every 15 minutes.",
          ),
        ).toBeVisible();
        await expect(
          page.getByText("No new or rising exceptions found"),
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
        name: "Find and fix new and rising exceptions",
      }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 60000 });
  });
});

test.describe("Exceptions → AI → a finding", () => {
  test("a new exception with no fix yet: the frames of your code, View Exception Group, and Fix with AI saying it fixes the exception", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights/${NEW_INSIGHT}`,
      async (theme: "light" | "dark"): Promise<void> => {
        const strip: Locator = page.getByTestId("telemetry-ai-fix");

        await expect(strip).toBeVisible({ timeout: 60000 });
        await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
          FIX_LEAD,
        );
        await expect(
          page.getByRole("button", { name: "View Exception Group" }),
        ).toBeVisible();
        // The evidence: where in your own code it was raised.
        await expect(
          page.getByText("Your code in its stack trace", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("applyCoupon").first()).toBeVisible();
        await expect(
          page.getByText("src/checkout/coupon.ts:42").first(),
        ).toBeVisible();
        // When it was first seen, as a person reads a date (in UTC, said so).
        await expect(
          page.getByText(
            "First seen: Oct 24, 2026, 09:00 UTC (within the last 24h)",
          ),
        ).toBeVisible();
        // The label says the whole message: it is not said a second time.
        await expect(
          page.locator("li").filter({ hasText: "Message:" }),
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
    expect(fixRequests).toEqual([{ insightId: NEW_INSIGHT }]);
  });

  test("an expected error: Fix with AI says it improves how your code handles it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights/${NEW_INSIGHT}?verdict=expected`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
          HANDLING_LEAD,
          { timeout: 60000 },
        );

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insight-expected-error-${theme}`);
      },
    );
  });

  test("View Exception Group opens the exception itself", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${NEW_INSIGHT}`);

    const open: Locator = page.getByRole("button", {
      name: "View Exception Group",
    });

    await expect(open).toBeVisible({ timeout: 60000 });
    await open.click();
    await expect(page.getByTestId("exception-page")).toBeVisible();

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(`${EXCEPTIONS}/${COUPON_EXCEPTION}`);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("a service's exceptions with no stack trace: Fix with AI makes it record them, Open in Exceptions opens its exceptions of the day, and no Create Monitor", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights/${STACK_TRACE_INSIGHT}`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
          STACK_TRACE_LEAD,
          { timeout: 60000 },
        );
        await expect(
          page.getByText("Missing stack traces in edge", { exact: true }),
        ).toBeVisible();
        // Each fact on a line of its own, in plain words.
        for (const line of [
          "Seen in the last day: 2 exceptions with no stack trace",
          "Together they have happened 2,052 times since they were first seen",
          "None of its exceptions seen that day carried a stack trace",
          "Without a stack trace, nothing shows where in its code they were raised",
        ]) {
          await expect(page.getByText(line, { exact: true })).toBeVisible();
        }
        // Nothing a monitor could count: no button at all.
        await expect(
          page.getByRole("button", { name: "Create Monitor" }),
        ).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insight-stack-trace-${theme}`);
      },
    );

    await page.getByRole("button", { name: "Open in Exceptions" }).click();
    await expect(page.getByTestId("exceptions-list-page")).toBeVisible();

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(`${EXCEPTIONS}/unresolved`);
    expect(JSON.parse(address.searchParams.get("filters") || "[]")).toEqual([
      ["primaryEntityId", EDGE_SERVICE],
    ]);
    // The day up to when the finding was last seen (4 minutes ago).
    const lastSeen: Date = new Date(NOW.getTime() - 4 * 60 * 1000);

    expect(address.searchParams.get("range")).toBe("Custom");
    expect(address.searchParams.get("end")).toBe(lastSeen.toISOString());
    expect(address.searchParams.get("start")).toBe(
      new Date(lastSeen.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    );

    // The Exceptions tab is lit there.
    await expect(
      exceptionsTabs(page).getByRole("link", { name: /^Exceptions/ }),
    ).toHaveClass(/bg-indigo-50/);
  });

  test("a new exception keeps Create Monitor, opening Monitor Create on the finding", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${NEW_INSIGHT}`);

    const createMonitor: Locator = page.getByRole("button", {
      name: "Create Monitor",
    });

    await expect(createMonitor).toBeEnabled({ timeout: 60000 });

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await createMonitor.click();
    await expect(page.getByTestId("monitor-create-page")).toBeVisible();

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(address.searchParams.get("aiInsightId")).toBe(NEW_INSIGHT);
  });

  test("no repository found to hold the code: pick one first, and the fix is asked in it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${NEW_INSIGHT}?offer=pick`);

    const picker: Locator = page.getByTestId("telemetry-ai-fix-repository");
    const button: Locator = page.getByTestId("telemetry-ai-fix-with-ai");

    await expect(picker).toContainText("Which repository holds this code?", {
      timeout: 60000,
    });
    await expect(button).toBeDisabled();

    // Stacked in the finding page's narrow rail, the button on one line.
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
      { insightId: NEW_INSIGHT, repositoryId: PLATFORM_REPOSITORY },
    ]);
  });

  test("every reason Fix with AI is not offered is said in its place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // No repository connected: the one step, in Code.
    await page.goto(`${AI}/insights/${NEW_INSIGHT}?offer=connect`);

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
    await page.goto(`${AI}/insights/${NEW_INSIGHT}?offer=credits`);
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveAttribute(
      "data-offer",
      "SetUp",
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A fix already on its way - one started on the exception's own page too.
    await page.goto(`${AI}/insights/${NEW_INSIGHT}?offer=running`);
    await expect(
      page.getByTestId("telemetry-ai-fix-task-link"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${RUNNING_TASK}`,
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A refusal: said in the strip, with the server's reason.
    await page.goto(`${AI}/insights/${NEW_INSIGHT}?fail=fix`);
    await page.getByTestId("telemetry-ai-fix-with-ai").click({
      timeout: 60000,
    });
    await expect(page.getByTestId("telemetry-ai-fix-error")).toHaveText(
      "Could not start the fix: The exception is resolved or archived. Reopen it to ask for a fix.",
    );

    // AI off for the project: nothing at all.
    await page.goto(`${AI}/insights/${NEW_INSIGHT}?ai=off`);
    await expect(page.getByText("applyCoupon").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);
  });

  test("a spike OneUptime already opened a pull request for: its fix task, and no second offer", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${SPIKE_INSIGHT}`);

    await expect(
      page.getByText("View the fix task and pull request"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);
    await expect(page.getByText("chargeCard").first()).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });
});

test.describe("Exceptions → AI → Logs", () => {
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
            "Everything OneUptime AI did with the exceptions it found, newest first",
            { exact: false },
          ),
        ).toBeVisible();

        const automatic: Locator = entries.nth(0);

        await expect(automatic).toContainText("Pull request");
        await expect(automatic).toContainText("Started by OneUptime");
        await expect(automatic).toContainText("acme/payments");
        await expect(
          automatic.getByRole("link", { name: "Pull request #2210" }),
        ).toHaveAttribute("href", "https://github.com/acme/payments/pull/2210");

        await expect(entries.nth(2)).toContainText("Asked by Ada Lovelace");
        await expect(entries.nth(2)).toContainText("Nothing to change");

        /*
         * What each investigation found: the spike's was an expected error,
         * so the pull request above it handles that error better. A pull
         * request says no verdict of its own.
         */
        await expect(
          entries.nth(1).getByTestId("telemetry-ai-log-verdict"),
        ).toHaveText("Found an expected error: invalid input");
        await expect(entries.nth(1)).toContainText("Investigation");
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
    // An investigation that failed found nothing to say.
    await expect(
      page
        .getByTestId("telemetry-ai-log-entry")
        .nth(3)
        .getByTestId("telemetry-ai-log-verdict"),
    ).toHaveCount(0);

    // A finding opens under Exceptions' AI tab.
    await page
      .getByTestId("telemetry-ai-log-entry")
      .nth(0)
      .getByRole("link", { name: SPIKE_TITLE })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/exceptions/ai/insights/${SPIKE_INSIGHT}`),
    );
  });

  test("nothing yet, and a read that failed, each say so in place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/logs?aiLogs=empty`);
    await expect(page.getByTestId("telemetry-ai-logs-empty")).toContainText(
      "When OneUptime AI looks into an exception or opens a pull request for it, it shows up here.",
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
