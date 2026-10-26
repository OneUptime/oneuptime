import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Traces' AI tab - Traces → AI → Insights, a finding's page with Fix with
 * AI, Logs and Settings - against the offline fixture (Fixture/Fixture.js
 * and Fixture/TraceFindings.js): the pages are production components; only
 * the data boundary is synthetic. OneUptime has found three problems in the
 * project's traces: GET /orders in checkout runs the same database query 40
 * times (no fix yet), POST /checkout fails 12% of the time (a pull request
 * OneUptime opened on its own) and edge's requests have no spans inside
 * them.
 *
 * Each test asserts what the page drew - on a laptop (1280) and on a phone
 * (390), in light and dark - with no sideways scroll on the phone.
 *
 * The UI review added: the evidence is the detector's own words (the
 * fixture draws it with buildTraceInsightDetail); Create Monitor opens a
 * Traces monitor on a failing operation, is disabled with its reason on a
 * slow one, and is not drawn on missing tracing; the repository picker and
 * Fix with AI stack in the finding page's narrow rail, the button on one
 * line; and the summaries promise a pull request for each problem
 * OneUptime AI can fix, not for each problem.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const TRACES: string = `/dashboard/${PROJECT_ID}/traces`;
const AI: string = `${TRACES}/ai`;
const SLOW_INSIGHT: string = "50930000-0000-4000-8000-0000000000e1";
const FAILING_INSIGHT: string = "50930000-0000-4000-8000-0000000000e2";
const UNTRACED_INSIGHT: string = "50930000-0000-4000-8000-0000000000e3";
const CHECKOUT_SERVICE: string = "50930000-0000-4000-8000-0000000000a1";
const EDGE_SERVICE: string = "50930000-0000-4000-8000-0000000000a2";
const PLATFORM_REPOSITORY: string = "50930000-0000-4000-8000-0000000000b2";
const STARTED_TASK: string = "50930000-0000-4000-8000-0000000000f3";
const RUNNING_TASK: string = "50930000-0000-4000-8000-0000000000f4";

/*
 * A small button's height with its words on one line, on a laptop or a
 * phone (Fix with AI squeezed beside the picker in the rail wrapped into
 * three lines, over 60px).
 */
const ONE_LINE_BUTTON_HEIGHT: number = 40;

const SLOW_TITLE: string =
  "GET /orders in checkout runs the same database query 40 times";
const FAILING_TITLE: string =
  "POST /checkout in checkout fails 12% of the time";
const UNTRACED_TITLE: string = "edge's requests have no spans inside them";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/traces-ai-ui",
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
        (window as unknown as { __tracesAiFixture: FixtureState })
          .__tracesAiFixture,
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

/*
 * Traces' tabs with AI lit, and the AI section's side menu: its own pages,
 * the one shown marked (on a phone, named in the menu's summary).
 */
async function expectAiSection(
  page: Page,
  testInfo: TestInfo,
  current: "Insights" | "Logs" | "Settings",
): Promise<void> {
  const tabs: Locator = page
    .locator("nav")
    .filter({ hasText: "Setup Guide" })
    .first();

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

test.describe("Traces → AI tab", () => {
  test("sits between Insights and Setup Guide, and opens on what OneUptime found", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const tabs: Locator = page
      .locator("nav")
      .filter({ hasText: "Setup Guide" })
      .first();

    await expect(tabs).toBeVisible({ timeout: 60000 });
    await expect(tabs.getByRole("link")).toHaveText([
      "Viewer",
      "Insights",
      "AI",
      "Setup Guide",
      "Settings",
    ]);

    await tabs.getByRole("link", { name: "AI", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/traces/ai/insights$`));
    await expect(page.getByText(SLOW_TITLE)).toBeVisible();
    await expectAiSection(page, testInfo, "Insights");

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });
});

test.describe("Traces → AI → Settings", () => {
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
          "Find and fix slow and failing operations",
        );
        await expect(switches).toContainText(
          "Every hour OneUptime looks through your traces for slow and failing operations and missing tracing.",
        );
        // What it fixes, not a pull request promised for every problem.
        await expect(switches).toContainText(
          "OneUptime AI fixes what it can with pull requests.",
        );
        await expect(
          page.getByRole("switch", {
            name: "Find and fix slow and failing operations",
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

  test("a new rule asks Match, Investigate and Fix in the words of trace problems, and a failing operation's pull request waits for the code at fault", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const advanced: Locator = page.getByTestId("telemetry-ai-advanced-section");

    await expect(advanced).toBeVisible({ timeout: 60000 });
    // A pull request for each problem it can fix, not for each problem.
    await expect(advanced).toContainText(
      "OneUptime AI looks into every problem it finds in your traces right away, and opens a pull request for each one it can fix.",
    );
    await advanced.getByRole("button", { name: /More settings/ }).click();

    // A card's description is a laptop's: a phone keeps the card to its title.
    if (!isPhone(testInfo)) {
      await expect(
        page.getByText(
          "With no rule, OneUptime AI looks into every problem in your traces right away, and opens a pull request for each one it can fix.",
          { exact: false },
        ),
      ).toBeVisible();
    }

    // The empty table: no rules, and what that means for trace problems.
    await expect(
      page.getByText(
        "Every problem found in your traces is looked into, and a pull request opened for each one OneUptime AI can fix.",
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

    // Fix: in pull requests - a failing operation's once the code is at fault.
    await next.click();
    await expect(dialog).toContainText(
      "OneUptime AI looks into the problem and writes what it found on the finding. It opens no pull request.",
    );
    await expect(dialog).toContainText(
      "OneUptime AI opens the pull request on its own, for a failing operation once it finds the code at fault. Nothing is ever merged.",
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
      name: "Find and fix slow and failing operations",
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
      expect.objectContaining({ enableAutomaticTraceRemediation: true }),
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

  test("with Enable AI off, the notice says slow and failing operations are still found", async ({
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
          "Slow and failing operations are still found, but none are looked into and no pull requests are opened.",
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

test.describe("Traces → AI → Insights", () => {
  test("the problems found, each with its kind, each opening under Traces' AI tab", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights`,
      async (theme: "light" | "dark"): Promise<void> => {
        for (const title of [SLOW_TITLE, FAILING_TITLE, UNTRACED_TITLE]) {
          await expect(page.getByText(title)).toBeVisible({ timeout: 60000 });
        }

        await expect(
          page.getByText(
            "Every hour OneUptime looks through your services' traces for operations that are slow",
            { exact: false },
          ),
        ).toBeVisible();

        // Three kinds: each row says its own, and the type filter offers them.
        const kinds: Array<{ title: string; kind: string }> = [
          { title: SLOW_TITLE, kind: "Slow Operation" },
          { title: FAILING_TITLE, kind: "Failing Operation" },
          { title: UNTRACED_TITLE, kind: "Missing Tracing" },
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
          "Slow Operation",
          "Failing Operation",
          "Missing Tracing",
        ]);

        await expectAiSection(page, testInfo, "Insights");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-${theme}`);
      },
    );

    await page.getByText(SLOW_TITLE).click();
    await expect(page).toHaveURL(
      new RegExp(`/traces/ai/insights/${SLOW_INSIGHT}`),
    );
  });

  test("none found yet: the empty state and the way to AI Settings", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights?aiInsights=empty`);

    await expect(
      page.getByText("No slow or failing operations found"),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText(
        "Every hour OneUptime looks through your services' traces and files a finding when an operation is slow, fails, or lacks the tracing to say why.",
      ),
    ).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(page.getByTestId("telemetry-ai-switches")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/traces/ai/settings`));
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
            "OneUptime is not looking for slow and failing operations",
          ),
        ).toBeVisible({ timeout: 60000 });
        await expect(
          page.getByText(
            "Turn on 'Find and fix slow and failing operations' in AI Settings, and OneUptime looks through your services' traces every hour.",
          ),
        ).toBeVisible();
        await expect(
          page.getByText("No slow or failing operations found"),
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
        name: "Find and fix slow and failing operations",
      }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 60000 });
  });
});

test.describe("Traces → AI → a finding", () => {
  test("a slow operation with no fix yet: its evidence, Open in Traces, and Fix with AI saying what the pull request does", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights/${SLOW_INSIGHT}`,
      async (theme: "light" | "dark"): Promise<void> => {
        const strip: Locator = page.getByTestId("telemetry-ai-fix");

        await expect(strip).toBeVisible({ timeout: 60000 });
        await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
          "OneUptime AI opens a pull request that makes this operation faster, for you to review.",
        );
        await expect(
          page.getByRole("button", { name: "Open in Traces" }),
        ).toBeVisible();
        await expect(
          page.getByText("OrderRepository.load").first(),
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
    expect(fixRequests).toEqual([{ insightId: SLOW_INSIGHT }]);
  });

  test("Open in Traces opens the operation's spans from the hour it was found in", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}`);

    const open: Locator = page.getByRole("button", { name: "Open in Traces" });

    await expect(open).toBeVisible({ timeout: 60000 });
    await open.click();
    await expect(page.getByTestId("traces-viewer-page")).toBeVisible();

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(TRACES);
    expect(JSON.parse(address.searchParams.get("filters") || "[]")).toEqual([
      ["primaryEntityId", CHECKOUT_SERVICE],
      ["name", "GET /orders"],
    ]);
    expect(address.searchParams.get("range")).toBe("Custom");
    expect(address.searchParams.get("end")).toBe(NOW.toISOString());
    expect(address.searchParams.get("start")).toBe(
      new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    );

    // The Viewer tab is lit there.
    await expect(
      page
        .locator("nav")
        .filter({ hasText: "Setup Guide" })
        .first()
        .getByRole("link", { name: "Viewer", exact: true }),
    ).toHaveClass(/bg-indigo-50/);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("a service with no spans inside its requests: Fix with AI adds the tracing, and Open in Traces opens the service", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${UNTRACED_INSIGHT}`);

    await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
      "OneUptime AI opens a pull request that adds the tracing this lacks, for you to review.",
      { timeout: 60000 },
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await page.getByRole("button", { name: "Open in Traces" }).click();

    const address: URL = new URL(page.url());

    expect(JSON.parse(address.searchParams.get("filters") || "[]")).toEqual([
      ["primaryEntityId", EDGE_SERVICE],
    ]);
  });

  test("no repository found to hold the code: pick one first, and the fix is asked in it", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}?offer=pick`);

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
      { insightId: SLOW_INSIGHT, repositoryId: PLATFORM_REPOSITORY },
    ]);
  });

  test("every reason Fix with AI is not offered is said in its place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    // No repository connected: the one step, in Code.
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}?offer=connect`);

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
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}?offer=credits`);
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveAttribute(
      "data-offer",
      "SetUp",
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A fix already on its way: its task, and no second offer.
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}?offer=running`);
    await expect(
      page.getByTestId("telemetry-ai-fix-task-link"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${RUNNING_TASK}`,
      { timeout: 60000 },
    );
    await expect(page.getByTestId("telemetry-ai-fix-with-ai")).toHaveCount(0);

    // A refusal: said in the strip, with the server's reason.
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}?fail=fix`);
    await page.getByTestId("telemetry-ai-fix-with-ai").click({
      timeout: 60000,
    });
    await expect(page.getByTestId("telemetry-ai-fix-error")).toHaveText(
      "Could not start the fix: Pick the repository that holds this code.",
    );

    // AI off for the project: nothing at all.
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}?ai=off`);
    await expect(page.getByText("OrderRepository.load").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);
  });

  test("a failing operation OneUptime already opened a pull request for: its fix task, and no second offer", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${FAILING_INSIGHT}`);

    await expect(
      page.getByText("View the fix task and pull request"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("telemetry-ai-fix")).toHaveCount(0);

    // Open in Traces: only the operation's failed spans.
    await page.getByRole("button", { name: "Open in Traces" }).click();

    const address: URL = new URL(page.url());

    expect(JSON.parse(address.searchParams.get("filters") || "[]")).toEqual([
      ["primaryEntityId", CHECKOUT_SERVICE],
      ["name", "POST /checkout"],
      ["statusCode", "2"],
    ]);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("the evidence is the detector's own: the facts first, then what the slowest request repeats", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}`);

    await expect(
      page.getByText("In the last hour: 1,840 spans, p50 640 ms, p99 2.4 s", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText("What the slowest request repeats", { exact: true }),
    ).toBeVisible();
    // OneUptime's own words open the line with a capital (the line holds its query too).
    await expect(
      page.getByText(
        "The same database query ran 40 times under OrderRepository.load: 1.4 s together, 64% of the request",
        { exact: false },
      ),
    ).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    // A failing operation: the error, and how many of the newest failures it is.
    await page.goto(`${AI}/insights/${FAILING_INSIGHT}`);
    await expect(
      page.getByText("In each of the 5 most recent failures", { exact: true }),
    ).toBeVisible({ timeout: 60000 });

    // A service's own look reads its p99 only: no "p50 0 ms".
    await page.goto(`${AI}/insights/${UNTRACED_INSIGHT}`);
    await expect(
      page.getByText("In the last hour: 9,200 spans, p99 1.3 s", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("p50 0 ms", { exact: false })).toHaveCount(0);
  });

  test("Create Monitor: a failing operation's opens Monitor Create on the finding, a slow one's says why it cannot, and missing tracing draws none", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${FAILING_INSIGHT}`);

    const createMonitor: Locator = page.getByRole("button", {
      name: "Create Monitor",
    });

    // Not greyed out: a Traces monitor counts the operation's failed spans.
    await expect(createMonitor).toBeEnabled({ timeout: 60000 });

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await createMonitor.click();
    await expect(page.getByTestId("monitor-create-page")).toBeVisible();

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(address.searchParams.get("aiInsightId")).toBe(FAILING_INSIGHT);

    // A slow operation: no monitor alerts on how long it takes yet - said.
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}`);

    const slowCreateMonitor: Locator = page.getByRole("button", {
      name: "Create Monitor",
    });

    await expect(slowCreateMonitor).toBeDisabled({ timeout: 60000 });

    if (!isPhone(testInfo)) {
      await slowCreateMonitor.locator("xpath=..").hover();
      await expect(
        page.getByText(
          "Monitors cannot alert on how long an operation takes yet.",
          { exact: false },
        ),
      ).toBeVisible();
    }

    // Missing tracing: nothing a monitor could count, so no button at all.
    await page.goto(`${AI}/insights/${UNTRACED_INSIGHT}`);
    await expect(
      page.getByRole("button", { name: "Open in Traces" }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByRole("button", { name: "Create Monitor" }),
    ).toHaveCount(0);
  });

  test("a repository to pick and Fix with AI: stacked in the narrow rail, side by side where the strip is wide, the button on one line", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${SLOW_INSIGHT}?offer=pick`);

    const picker: Locator = page.getByTestId("telemetry-ai-fix-repository");
    const button: Locator = page.getByTestId("telemetry-ai-fix-with-ai");

    await expect(picker).toBeVisible({ timeout: 60000 });

    // A laptop draws the strip in the rail beside the evidence, a phone full width.
    const narrow: { isStacked: boolean; buttonHeight: number } =
      await measureFixStrip(picker, button);

    expect(narrow.isStacked).toBe(true);
    expect(narrow.buttonHeight).toBeLessThanOrEqual(ONE_LINE_BUTTON_HEIGHT);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
      return;
    }

    await screenshot(page, testInfo, "insight-pick-repository-rail");

    // At 1024 the page is one column: the strip is wide enough for both.
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect
      .poll(async (): Promise<boolean> => {
        return (await measureFixStrip(picker, button)).isStacked;
      })
      .toBe(false);
    expect(
      (await measureFixStrip(picker, button)).buttonHeight,
    ).toBeLessThanOrEqual(ONE_LINE_BUTTON_HEIGHT);
  });
});

test.describe("Traces → AI → Logs", () => {
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
            "Everything OneUptime AI did with the problems it found in your traces, newest first",
            { exact: false },
          ),
        ).toBeVisible();

        const automatic: Locator = entries.nth(0);

        await expect(automatic).toContainText("Pull request");
        await expect(automatic).toContainText("Started by OneUptime");
        await expect(automatic).toContainText("acme/checkout");
        await expect(
          automatic.getByRole("link", { name: "Pull request #1204" }),
        ).toHaveAttribute("href", "https://github.com/acme/checkout/pull/1204");

        await expect(entries.nth(2)).toContainText("Asked by Ada Lovelace");
        await expect(entries.nth(2)).toContainText("Nothing to change");

        /*
         * A failing operation's investigation says what it found - in an
         * exception's words, as its verdict decides its pull request the
         * same way; a pull request says no verdict.
         */
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

    /*
     * The older entries are a page away: one that failed, which found
     * nothing, and the slow operation's first look, which found avoidable
     * work - a slow operation's verdict in its own words.
     */
    await page.getByTestId("telemetry-ai-logs-load-more").click();
    await expect(page.getByTestId("telemetry-ai-log-entry")).toHaveCount(5);

    const failed: Locator = page.getByTestId("telemetry-ai-log-entry").nth(3);

    await expect(failed).toContainText("Failed");
    await expect(failed.getByTestId("telemetry-ai-log-verdict")).toHaveCount(0);
    await expect(
      page
        .getByTestId("telemetry-ai-log-entry")
        .nth(4)
        .getByTestId("telemetry-ai-log-verdict"),
    ).toHaveText("Found avoidable work in the code");

    // A finding opens under Traces' AI tab.
    await page
      .getByTestId("telemetry-ai-log-entry")
      .nth(0)
      .getByRole("link", { name: FAILING_TITLE })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/traces/ai/insights/${FAILING_INSIGHT}`),
    );
  });

  test("nothing yet, and a read that failed, each say so in place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/logs?aiLogs=empty`);
    await expect(page.getByTestId("telemetry-ai-logs-empty")).toContainText(
      "When OneUptime AI looks into a problem in your traces or opens a pull request for it, it shows up here.",
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
