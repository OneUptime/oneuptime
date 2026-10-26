import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * The Profiler's AI section - Profiler → AI → Insights, Logs and Settings -
 * against the offline fixture (Fixture/Fixture.js and Fixture/AiSection.js):
 * the pages are production components; only the data boundary is
 * synthetic. OneUptime has found two slow functions in checkout: parseOrder
 * takes 34% of its CPU time, with no fix yet, and normalizeLineItems grew
 * to 9%, with a pull request OneUptime opened on its own.
 *
 * Each test asserts what the page drew - on a laptop (1280) and on a phone
 * (390), in light and dark - with no sideways scroll on the phone.
 *
 * The UI review added what a person meets first: whether pull requests can
 * be opened sits under the switch, inside its card, and only while the
 * switch is on; an inbox that is empty because the switch is off says so;
 * a finding's page keeps Insights lit and offers a monitor on the
 * function; a rule's wait starts on an hour; and an empty Logs page leads
 * to AI Settings.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-20T12:00:00.000Z");
const AI: string = `/dashboard/${PROJECT_ID}/profiles/ai`;
const HOT_INSIGHT: string = "50920000-0000-4000-8000-0000000000e1";
const GREW_INSIGHT: string = "50920000-0000-4000-8000-0000000000e2";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/profiles-ui",
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
        (window as unknown as { __profilesFixture: FixtureState })
          .__profilesFixture,
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
 * The page's own title ("Profiler — AI settings"), and the side menu's AI
 * section, open on its own pages.
 */
async function expectAiSection(
  page: Page,
  testInfo: TestInfo,
  title: string,
): Promise<void> {
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

  if (isPhone(testInfo)) {
    // On a phone the menu folds into a summary above the page.
    return;
  }

  const menu: Locator = page.locator("nav").filter({ hasText: "Insights" });

  for (const title of ["Insights", "Logs", "Settings"]) {
    await expect(menu.getByRole("link", { name: title }).first()).toBeVisible();
  }
}

test.describe("Profiler → AI → Settings", () => {
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
        await expect(switches).toContainText("Find and fix slow code");
        await expect(
          page.getByTestId("ai-switch-enableAutomaticProfileRemediation"),
        ).toBeVisible();

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
        await expect(ready).toContainText(
          "Pull requests are made on the Runner each repository picks in Code.",
        );

        // Enable AI is on: no notice above the page.
        await expect(page.getByTestId("project-ai-off-notice")).toHaveCount(0);

        const advanced: Locator = page.getByTestId(
          "telemetry-ai-advanced-section",
        );

        await expect(advanced).toContainText("AI rules");
        await expectAiSection(page, testInfo, "Profiler — AI settings");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `settings-${theme}`);

        // Opened, the rules: when each looks into slow code, and how it fixes it.
        await advanced.getByRole("button", { name: /More settings/ }).click();

        await expect(page.getByText("Checkout services")).toBeVisible();
        await expect(
          page.getByText("If still found after 60 minutes"),
        ).toBeVisible();
        await expect(
          page.getByText("Asks before fixing").first(),
        ).toBeVisible();
        await expect(page.getByText("Doesn't fix").first()).toBeVisible();

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `settings-rules-${theme}`);
      },
    );
  });

  test("a new rule asks Match, Investigate and Fix - in pull requests, with no Runner to pick", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings`);

    const advanced: Locator = page.getByTestId("telemetry-ai-advanced-section");

    await expect(advanced).toBeVisible({ timeout: 60000 });
    await advanced.getByRole("button", { name: /More settings/ }).click();
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
    await expect(dialog).toContainText("Only services that match conditions");
    await expect(
      dialog.getByText("Match", { exact: true }).filter({ visible: true }),
    ).toHaveCount(1);

    if (isPhone(testInfo)) {
      await expect(dialog).toContainText("Step 1 of 3");
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "settings-new-rule-match");

    // Investigate: right away, or only if the slow code is still found.
    await next.click();
    await expect(dialog).toContainText("Right away");
    await expect(dialog).toContainText("Only if still found after a wait");
    await expect(dialog).toContainText(
      "OneUptime AI starts as soon as the slow code is found.",
    );

    // A wait starts on an hour: one look of the Profiler's, not 10 minutes.
    await dialog.getByText("Only if still found after a wait").click();
    await expect(
      dialog.getByTestId("telemetry-ai-rule-wait-minutes"),
    ).toHaveValue("60");

    // Fix: in pull requests, with no Runner to pick.
    await next.click();
    await expect(dialog).toContainText(
      "The finding offers the pull request, and someone opens it with one click.",
    );
    await expect(dialog).toContainText(
      "OneUptime AI opens the pull request on its own. Nothing is ever merged: your team reviews it.",
    );

    await dialog.getByRole("button", { name: /More fields/ }).click();
    await expect(dialog).toContainText(
      "Pull requests are made on the Runner each repository picks in Code.",
    );
    // One line of help under the repositories, in the hint's own size.
    await expect(
      dialog
        .getByTestId("rule-code-repositories-hint")
        .getByTestId("telemetry-ai-runner-hint"),
    ).toBeVisible();
    await expect(
      dialog.getByTestId("auto-remediation-runner-field"),
    ).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expect(dialog).toContainText("Step 3 of 3");
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "settings-new-rule-fix");
  });

  test("a rule opens for editing on what it says: its wait and its Fix answer", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings?aiRules=two`);

    const advanced: Locator = page.getByTestId("telemetry-ai-advanced-section");

    await expect(advanced).toBeVisible({ timeout: 60000 });
    await advanced.getByRole("button", { name: /More settings/ }).click();
    await expect(page.getByText("Checkout services")).toBeVisible();

    // The rules are sorted by name: Checkout services is the first.
    await page
      .getByRole("button", { name: "Edit", exact: true })
      .first()
      .click();

    const dialog: Locator = page.getByRole("dialog");
    const next: Locator = dialog.getByRole("button", { name: "Next" });

    await expect(dialog).toContainText("Edit AI Rule");
    await expect(dialog).not.toContainText("Cannot edit");
    await next.click();
    await expect(
      dialog.getByTestId("telemetry-ai-rule-wait-minutes"),
    ).toHaveValue("60");
    await next.click();
    await expect(dialog.getByRole("textbox", { name: /^Name/ })).toHaveValue(
      "Checkout services",
    );

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("with Find and fix slow code off, nothing is said about pull requests; turned on, it is, under the switch", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings?lane=off`);

    const switches: Locator = page.getByTestId("telemetry-ai-switches");
    const laneSwitch: Locator = page.getByRole("switch", {
      name: "Find and fix slow code",
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

    await connect
      .getByRole("link", { name: /Connect a repository in Code/ })
      .click();
    await expect(page.getByTestId("code-page")).toBeVisible();

    if (isPhone(testInfo)) {
      await page.goBack();
      await expectNoSidewaysScroll(page);
    }
  });

  test("with Enable AI off, the notice says slow code is still found, and nothing else is said", async ({
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
        await expect(notice).toContainText("Slow code is still found");
        await expect(page.getByTestId("telemetry-ai-readiness")).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `settings-ai-off-${theme}`);
      },
    );
  });
});

test.describe("Profiler → AI → Insights", () => {
  test("the slow code found, in the Profiler's words, each finding opening under the Profiler", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(
          page.getByText("parseOrder takes 34% of the CPU time in checkout"),
        ).toBeVisible({ timeout: 60000 });
        await expect(
          page.getByText(
            "normalizeLineItems grew to 9% of the CPU time in checkout, from 3%",
          ),
        ).toBeVisible();
        await expect(
          page.getByText(
            "Every hour OneUptime looks through your services' profiles",
            {
              exact: false,
            },
          ),
        ).toBeVisible();
        // One kind of finding: no type filter, and no row says its kind.
        await expect(
          page.getByRole("combobox", { name: "Filter by insight type" }),
        ).toHaveCount(0);
        await expect(page.getByText("Slow Code", { exact: true })).toHaveCount(
          0,
        );

        // A title is drawn whole, in up to two lines: never cut at a laptop's width.
        const title: Locator = page.getByText(
          "normalizeLineItems grew to 9% of the CPU time in checkout, from 3%",
        );
        const isCut: boolean = await title.evaluate(
          (element: Element): boolean => {
            return (
              element.scrollWidth > element.clientWidth ||
              element.scrollHeight > element.clientHeight + 1
            );
          },
        );

        if (!isPhone(testInfo)) {
          expect(isCut).toBe(false);
        }

        await expectAiSection(page, testInfo, "Profiler — AI insights");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-${theme}`);
      },
    );

    await page
      .getByText("parseOrder takes 34% of the CPU time in checkout")
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/profiles/ai/insights/${HOT_INSIGHT}`),
    );
  });

  /*
   * Beside the side menu at a small laptop's width the filter bar's one row
   * squeezed the search to its icon and ran the last select past the bar:
   * the selects now go under the search where they do not fit.
   */
  test("at a small laptop's width the search keeps room to type, and no select runs past the bar", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(isPhone(testInfo), "A laptop's width.");

    for (const width of [1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${AI}/insights`);

      const search: Locator = page.getByPlaceholder(
        "Search insights by title...",
      );

      await expect(search).toBeVisible({ timeout: 60000 });

      const searchBox: { width: number } | null = await search.boundingBox();

      expect(searchBox!.width).toBeGreaterThanOrEqual(200);

      const overflow: number = await search.evaluate(
        (element: Element): number => {
          let bar: Element | null = element;

          // The bar: the rounded box that holds the search and the selects.
          while (bar && !bar.querySelector("select")) {
            bar = bar.parentElement;
          }

          if (!bar) {
            return 0;
          }

          const right: number = bar.getBoundingClientRect().right;

          return Math.max(
            0,
            ...Array.from(bar.querySelectorAll("select")).map(
              (select: Element): number => {
                return select.getBoundingClientRect().right - right;
              },
            ),
          );
        },
      );

      expect([width, overflow]).toEqual([width, 0]);
    }
  });

  test("none found yet: the empty state and the way to AI Settings", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights?aiInsights=empty`);

    await expect(page.getByText("No slow code found")).toBeVisible({
      timeout: 60000,
    });
    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(page.getByTestId("telemetry-ai-switches")).toBeVisible();

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("none found while Find and fix slow code is off: it says nothing is looked for, and the way to turn it on", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights?aiInsights=empty&lane=off`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(
          page.getByText("OneUptime is not looking for slow code"),
        ).toBeVisible({ timeout: 60000 });
        await expect(
          page.getByText(
            "Turn on 'Find and fix slow code' in AI Settings, and OneUptime looks through your services' profiles every hour.",
          ),
        ).toBeVisible();
        await expect(page.getByText("No slow code found")).toHaveCount(0);

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insights-off-${theme}`);
      },
    );

    await page.getByRole("button", { name: "Go to AI Settings" }).click();
    await expect(
      page.getByRole("switch", { name: "Find and fix slow code" }),
    ).toHaveAttribute("aria-checked", "false", { timeout: 60000 });
  });

  test("a finding with no fix yet: its evidence, Open in Profiler, and Fix with AI naming the finding", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(
      page,
      `${AI}/insights/${HOT_INSIGHT}`,
      async (theme: "light" | "dark"): Promise<void> => {
        await expect(page.getByTestId("profiles-fix-with-ai")).toBeVisible({
          timeout: 60000,
        });
        await expect(
          page.getByRole("button", { name: "Open in Profiler" }),
        ).toBeVisible();
        await expect(page.getByText("22,200 of 65,400 samples")).toBeVisible();

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `insight-${theme}`);
      },
    );

    // The offer says what Fix with AI does: the page says what was found.
    await expect(page.getByTestId("profiles-fix-finding")).toHaveText(
      "OneUptime AI opens a pull request that makes this lighter, for you to review.",
    );

    // A finding is one of the Insights: the menu keeps it lit.
    if (isPhone(testInfo)) {
      await expect(page.getByTestId("mobile-sidemenu-toggle")).toContainText(
        "Insights",
      );
    } else {
      await expect(
        page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", { name: "Insights" }),
      ).toHaveClass(/bg-indigo-50/);
    }

    await page.getByTestId("profiles-fix-with-ai").click();
    await expect(page.getByTestId("profiles-fix-task-link")).toBeVisible();

    const { fixRequests } = await fixture(page);

    expect(fixRequests).toHaveLength(1);
    expect(fixRequests[0]).toEqual(
      expect.objectContaining({
        insightId: HOT_INSIGHT,
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
      }),
    );
  });

  test("Create Monitor opens the Profiler's own monitor on the function, set above its share", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${HOT_INSIGHT}`);

    const createMonitor: Locator = page.getByRole("button", {
      name: "Create Monitor",
    });

    await expect(createMonitor).toBeEnabled({ timeout: 60000 });

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await createMonitor.click();

    const target: Locator = page.getByTestId("monitor-create-page");

    await expect(target).toBeVisible();

    const address: URL = new URL(page.url());

    expect(address.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(address.searchParams.get("profileFunction")).toBe("parseOrder");
    expect(address.searchParams.get("profileType")).toBe("cpu");
    // 34% now: 34 + 17, to the next 5.
    expect(address.searchParams.get("profileThreshold")).toBe("55");
    expect(address.searchParams.get("aiInsightId")).toBeNull();
  });

  /*
   * The finding page's rail is narrow beside the evidence: side by side
   * there, the button was squeezed into "Fix / with / AI" (Traces' review).
   */
  test("on a finding's page a repository to pick sits above Fix with AI, the button on one line", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${HOT_INSIGHT}?repo=pick`);

    const picker: Locator = page.getByTestId("profiles-fix-repository");
    const button: Locator = page.getByTestId("profiles-fix-with-ai");

    await expect(picker).toBeVisible({ timeout: 60000 });

    const pickerBox: { y: number; height: number } | null =
      await picker.boundingBox();
    const buttonBox: { y: number; height: number } | null =
      await button.boundingBox();

    expect(pickerBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.y).toBeGreaterThanOrEqual(
      pickerBox!.y + pickerBox!.height - 1,
    );
    expect(buttonBox!.height).toBeLessThanOrEqual(40);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });

  test("a finding OneUptime already opened a pull request for: its fix task, and no second offer", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${GREW_INSIGHT}`);

    await expect(
      page.getByText("View the fix task and pull request"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId("profiles-fix")).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }
  });
});

test.describe("Profiler → AI → Logs", () => {
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

        const automatic: Locator = entries.nth(0);

        await expect(automatic).toContainText("Pull request");
        await expect(automatic).toContainText("Started by OneUptime");
        await expect(automatic).toContainText("acme/checkout");
        await expect(
          automatic.getByRole("link", { name: "Pull request #812" }),
        ).toHaveAttribute("href", "https://github.com/acme/checkout/pull/812");

        await expect(entries.nth(2)).toContainText("Asked by Ada Lovelace");
        await expect(entries.nth(2)).toContainText("Nothing to change");

        /*
         * A done investigation says what OneUptime AI found, in slow code's
         * own words - work the code could avoid, which is why the pull
         * request above followed; a pull request says no verdict.
         */
        await expect(
          entries.nth(1).getByTestId("telemetry-ai-log-verdict"),
        ).toHaveText("Found avoidable work in the code");
        await expect(
          automatic.getByTestId("telemetry-ai-log-verdict"),
        ).toHaveCount(0);

        await expectAiSection(page, testInfo, "Profiler — AI logs");

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

    // A finding opens under the Profiler.
    await page
      .getByTestId("telemetry-ai-log-entry")
      .nth(0)
      .getByRole("link", {
        name: "normalizeLineItems grew to 9% of the CPU time in checkout, from 3%",
      })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/profiles/ai/insights/${GREW_INSIGHT}`),
    );
  });

  test("nothing yet, and a read that failed, each say so in place", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/logs?aiLogs=empty`);
    await expect(page.getByTestId("telemetry-ai-logs-empty")).toBeVisible({
      timeout: 60000,
    });

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
