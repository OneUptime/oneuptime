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

  /*
   * The shared telemetry tab bar (Components/Telemetry/NavTabs): five tabs
   * need about 510px and a phone gives them 326, so they used to wrap,
   * Setup Guide and Settings on a line of their own. They stay on one line
   * now, the line scrolls sideways with its hidden edge faded, and the lit
   * tab opens in view with the next tab peeking past the fade - scrolled no
   * further, so the first tabs stay in sight. Only the bar scrolls, never
   * the page.
   */
  test("the tabs stay on one line: on a phone the line scrolls, the lit tab in view and its neighbours peeking", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await inBothThemes(page, `${AI}/insights`, async () => {
      const tabs: Locator = logsTabs(page);
      const scroller: Locator = page.getByTestId("telemetry-nav-tabs-scroller");

      await expect(tabs).toBeVisible({ timeout: 60000 });

      const tops: Array<number> = await tabs
        .getByRole("link")
        .evaluateAll((links: Array<Element>): Array<number> => {
          return links.map((link: Element): number => {
            return Math.round(link.getBoundingClientRect().top);
          });
        });

      // Every tab on the same line, never one under another.
      expect(new Set(tops).size).toBe(1);
      expect(tops.length).toBe(5);
      await expect(
        tabs.getByRole("link", { name: "AI", exact: true }),
      ).toHaveAttribute("aria-current", "page");

      const measure: () => Promise<{
        overflow: number;
        scrollLeft: number;
        litLeft: number;
        litRight: number;
        barLeft: number;
        barRight: number;
      }> = async () => {
        return scroller.evaluate(
          (
            element: Element,
          ): {
            overflow: number;
            scrollLeft: number;
            litLeft: number;
            litRight: number;
            barLeft: number;
            barRight: number;
          } => {
            const bar: DOMRect = element.getBoundingClientRect();
            const lit: DOMRect = element
              .querySelector("[aria-current='page']")!
              .getBoundingClientRect();

            return {
              overflow: element.scrollWidth - element.clientWidth,
              scrollLeft: element.scrollLeft,
              litLeft: lit.left,
              litRight: lit.right,
              barLeft: bar.left,
              barRight: bar.right,
            };
          },
        );
      };

      if (!isPhone(testInfo)) {
        // A laptop has the room: nothing scrolls and no edge fades.
        expect((await measure()).overflow).toBeLessThanOrEqual(1);
        await expect(scroller).toHaveAttribute("data-hidden-left", "false");
        await expect(scroller).toHaveAttribute("data-hidden-right", "false");
        return;
      }

      const opened: Awaited<ReturnType<typeof measure>> = await measure();

      // The tabs do not fit, so the line scrolls - the page does not.
      expect(opened.overflow).toBeGreaterThan(100);
      await expectNoSidewaysScroll(page);

      /*
       * The lit tab opens whole, with room past it for the next tab to
       * peek. AI fits in English, so nothing scrolls: Viewer, the first
       * tab, stays whole at the start, and Setup Guide peeks past the right
       * fade (1.5rem) by more than its own padding.
       */
      expect(opened.litLeft).toBeGreaterThanOrEqual(opened.barLeft);
      expect(opened.litRight).toBeLessThanOrEqual(opened.barRight - 47);
      expect(opened.scrollLeft).toBe(0);
      await expect(scroller).toHaveAttribute("data-hidden-left", "false");
      await expect(scroller).toHaveAttribute("data-hidden-right", "true");

      const setupGuideLeft: number = await tabs
        .getByRole("link", { name: "Setup Guide", exact: true })
        .evaluate((link: Element): number => {
          return link.getBoundingClientRect().left;
        });

      expect(setupGuideLeft).toBeLessThan(opened.barRight - 24 - 12);

      // Scrolled to its end, the last tab is whole and that edge is sharp.
      await scroller.evaluate((element: Element): void => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect(scroller).toHaveAttribute("data-hidden-right", "false");

      const settings: { left: number; right: number } = await tabs
        .getByRole("link", { name: "Settings", exact: true })
        .evaluate((link: Element): { left: number; right: number } => {
          const box: DOMRect = link.getBoundingClientRect();

          return { left: box.left, right: box.right };
        });
      const atEnd: Awaited<ReturnType<typeof measure>> = await measure();

      expect(settings.right).toBeLessThanOrEqual(atEnd.barRight + 1);
      expect(settings.left).toBeGreaterThanOrEqual(atEnd.barLeft);

      // Back at the start, the first tab is whole and that edge is sharp.
      await scroller.evaluate((element: Element): void => {
        element.scrollLeft = 0;
      });
      await expect(scroller).toHaveAttribute("data-hidden-left", "false");
      await expect(scroller).toHaveAttribute("data-hidden-right", "true");
      await expectNoSidewaysScroll(page);
    });

    await screenshot(page, testInfo, "tabs-one-line");
  });

  /*
   * In German AI does not fit with room past it on a phone: the bar
   * scrolls just that far, so Betrachter (Viewer) still shows past the left
   * fade and Einrichtungsanleitung (Setup Guide) peeks past the right one.
   * Bringing the lit tab to the middle hid a first tab wholly behind the
   * fade (German Exceptions showed no Exceptions tab at all).
   */
  test("on a phone in German the lit tab scrolls just into view, the first tab still in sight", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(!isPhone(testInfo), "Only a phone's bar scrolls.");

    await page.goto(`${AI}/insights?lang=de`);

    const tabs: Locator = page.getByTestId("telemetry-nav-tabs");
    const scroller: Locator = page.getByTestId("telemetry-nav-tabs-scroller");

    await expect(
      tabs.getByRole("link", { name: "KI", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    const boxes: {
      scrollLeft: number;
      barLeft: number;
      barRight: number;
      firstRight: number;
      litLeft: number;
      litRight: number;
    } = await scroller.evaluate(
      (
        element: Element,
      ): {
        scrollLeft: number;
        barLeft: number;
        barRight: number;
        firstRight: number;
        litLeft: number;
        litRight: number;
      } => {
        const bar: DOMRect = element.getBoundingClientRect();
        const first: DOMRect = element.children[0]!.getBoundingClientRect();
        const lit: DOMRect = element
          .querySelector("[aria-current='page']")!
          .getBoundingClientRect();

        return {
          scrollLeft: element.scrollLeft,
          barLeft: bar.left,
          barRight: bar.right,
          firstRight: first.right,
          litLeft: lit.left,
          litRight: lit.right,
        };
      },
    );

    // Scrolled, but only a little: the lit tab whole, room past it.
    expect(boxes.scrollLeft).toBeGreaterThan(0);
    expect(boxes.scrollLeft).toBeLessThan(48);
    expect(boxes.litLeft).toBeGreaterThanOrEqual(boxes.barLeft);
    expect(boxes.litRight).toBeLessThanOrEqual(boxes.barRight - 47);
    // The first tab's name still shows past the left fade and its padding.
    expect(boxes.firstRight).toBeGreaterThan(boxes.barLeft + 24 + 12 + 40);
    await expect(scroller).toHaveAttribute("data-hidden-left", "true");
    await expect(scroller).toHaveAttribute("data-hidden-right", "true");
    await expectNoSidewaysScroll(page);

    await screenshot(page, testInfo, "tabs-one-line-german");
  });

  /*
   * Between a phone and a laptop the page header puts the bar on a line of
   * its own beside the title's: from 640px to about 700px German's tabs are
   * wider than that line, and the bar kept their width and pushed the page
   * sideways. It scrolls inside the page there too.
   */
  test("at 640px in German the bar scrolls inside the page, never pushing it sideways", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    test.skip(isPhone(testInfo), "The laptop project resizes to 640px.");

    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(`${AI}/insights?lang=de`);

    const scroller: Locator = page.getByTestId("telemetry-nav-tabs-scroller");

    await expect(scroller).toBeVisible({ timeout: 60000 });
    await expect(scroller).toHaveAttribute("data-hidden-right", "true");

    const widths: { overflow: number; barRight: number; pageWidth: number } =
      await scroller.evaluate(
        (
          element: Element,
        ): { overflow: number; barRight: number; pageWidth: number } => {
          return {
            overflow: element.scrollWidth - element.clientWidth,
            barRight: element.getBoundingClientRect().right,
            pageWidth: document.documentElement.clientWidth,
          };
        },
      );

    expect(widths.overflow).toBeGreaterThan(0);
    expect(widths.barRight).toBeLessThanOrEqual(widths.pageWidth);
    await expectNoSidewaysScroll(page);
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

  /*
   * With rules, OneUptime AI fixes only what a rule that fixes matches: once
   * every enabled rule says Don't fix, the switch that says it fixes says
   * that it opens no pull request on its own, with the way to the rules.
   */
  test("every enabled rule says Don't fix: the switch says OneUptime AI opens no pull request on its own, and leads to the rules", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/settings?aiRules=dontfix`);

    const switches: Locator = page.getByTestId("telemetry-ai-switches");
    const warning: Locator = switches.getByTestId("ai-rules-fix-nothing");

    await expect(warning).toHaveText(
      "Every enabled AI rule is set to “Don't fix”, so OneUptime AI opens no pull request on its own. Review the AI rules",
      { timeout: 60000 },
    );
    // The switch is still on: the rules decide what it fixes.
    await expect(
      page.getByRole("switch", {
        name: "Find and fix error, missing and noisy logs",
      }),
    ).toHaveAttribute("aria-checked", "true");

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "settings-dont-fix");

    // The link opens More settings at the rules table.
    await warning.getByRole("link", { name: "Review the AI rules" }).click();

    await expect(page).toHaveURL(/#telemetry-ai-rules-table-Log$/);
    await expect(
      page.getByText("Checkout services: look, don't touch"),
    ).toBeVisible();
  });

  test("a rule that fixes, or no rule at all, leaves the switch's own words alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const query of ["?aiRules=two", ""]) {
      await page.goto(`${AI}/settings${query}`);

      const switches: Locator = page.getByTestId("telemetry-ai-switches");

      await expect(switches).toContainText(
        "OneUptime AI fixes what it can with pull requests.",
        { timeout: 60000 },
      );
      await expect(switches.getByTestId("ai-rules-fix-nothing")).toHaveCount(0);
    }
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

        // In the switch's own words: what OneUptime checks the logs for.
        await expect(
          page.getByText(
            "Every hour OneUptime checks your services' logs for repeated errors, unlogged failures and noisy lines",
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

  /*
   * The finding page's Details rail, shared by every lane and AI Insights:
   * in a narrow rail a value too long for its label's line goes under it,
   * whole, instead of being cut beside it - German's "Zuletzt gesehen"
   * left "4 minutes a..." of its value - and right to left the values sit
   * at the end, each in its own direction ("5 hours ago" read "hours ago 5"
   * in Persian). The cards' descriptions say what they hold in plain words.
   */
  test("Details: every value whole, under its label when it does not fit beside it, at the end in Persian too", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    const valuesOf: () => Promise<
      Array<{
        label: string;
        text: string;
        isCut: boolean;
        isUnderLabel: boolean;
        valueLeft: number;
        valueRight: number;
        rowLeft: number;
        rowRight: number;
      }>
    > = async () => {
      return page.getByTestId("insight-fact").evaluateAll(
        (
          rows: Array<Element>,
        ): Array<{
          label: string;
          text: string;
          isCut: boolean;
          isUnderLabel: boolean;
          valueLeft: number;
          valueRight: number;
          rowLeft: number;
          rowRight: number;
        }> => {
          return rows.map((row: Element) => {
            const label: Element = row.querySelector("dt")!;
            const value: HTMLElement = row.querySelector("dd")!;
            const labelBox: DOMRect = label.getBoundingClientRect();
            const valueBox: DOMRect = value.getBoundingClientRect();
            const rowBox: DOMRect = row.getBoundingClientRect();

            return {
              label: (label.textContent || "").trim(),
              text: (value.textContent || "").trim(),
              isCut: value.scrollWidth > value.clientWidth + 1,
              isUnderLabel: valueBox.top >= labelBox.bottom - 1,
              valueLeft: valueBox.left,
              valueRight: valueBox.right,
              rowLeft: rowBox.left,
              rowRight: rowBox.right,
            };
          });
        },
      );
    };

    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?lang=de`);
    await expect(
      page.getByText("Zuletzt gesehen", { exact: true }),
    ).toBeVisible({ timeout: 60000 });

    const german: Awaited<ReturnType<typeof valuesOf>> = await valuesOf();

    expect(
      german.map((fact: { label: string }): string => {
        return fact.label;
      }),
    ).toEqual(["Dienst", "Erkennungen", "Zuerst gesehen", "Zuletzt gesehen"]);

    for (const fact of german) {
      // Nothing is cut: "4 minutes ago" is whole, wherever it sits.
      expect(fact.isCut, `${fact.label}: ${fact.text}`).toBe(false);
      // At the end of its row, under its label or beside it.
      expect(Math.abs(fact.rowRight - fact.valueRight)).toBeLessThanOrEqual(1);
    }

    const lastSeen: { isUnderLabel: boolean } = german.find(
      (fact: { label: string }): boolean => {
        return fact.label === "Zuletzt gesehen";
      },
    )!;

    /*
     * In a laptop's 280px rail the value goes under its long label; a
     * phone's rail is the page's width, and it sits beside it.
     */
    expect(lastSeen.isUnderLabel).toBe(!isPhone(testInfo));

    // The cards say what they hold, in plain words.
    await expect(
      page.getByText(
        "What OneUptime measured in your telemetry when it found this. Not written by AI.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(page.getByText(/Belege/).first()).toBeVisible();

    await page.goto(`${AI}/insights/${ERROR_INSIGHT}?lang=fa`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("insight-fact").first()).toBeVisible({
      timeout: 60000,
    });

    for (const fact of await valuesOf()) {
      expect(fact.isCut, `${fact.label}: ${fact.text}`).toBe(false);
      // Right to left, the end of a row is its left.
      expect(Math.abs(fact.valueLeft - fact.rowLeft)).toBeLessThanOrEqual(1);
    }

    // English text keeps its own order on a Persian page.
    await expect(
      page
        .getByTestId("insight-fact-value")
        .locator("bdi")
        .filter({ hasText: "minutes ago" }),
    ).toHaveText("4 minutes ago");

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "insight-details-fa");
  });

  test("the cards say what they hold in plain words: what was measured, what OneUptime AI found, and what an answer does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${AI}/insights/${ERROR_INSIGHT}`);

    await expect(
      page.getByText(
        "What OneUptime measured in your telemetry when it found this. Not written by AI.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByText(
        "Confirm it if it was worth raising, or dismiss it if not: your answer tells OneUptime which of its findings help. Resolve it once it has been handled.",
        { exact: true },
      ),
    ).toBeVisible();

    // Nothing a reader has to decode.
    const words: string = (
      await page.locator("main, #root").first().innerText()
    )
      .toLowerCase()
      .replace(/\s+/g, " ");

    for (const jargon of [
      "deterministic",
      "baselines and multipliers",
      "at detect time",
      "detector's precision",
      "worth surfacing",
    ]) {
      expect(words).not.toContain(jargon);
    }
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
    await expect(
      page.getByText("Logged in 312 traces", { exact: true }),
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

  test("logs with no trace context: Fix with AI adds the trace id to them, and Open in Logs opens the service's logs", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.goto(`${AI}/insights/${UNTRACED_INSIGHT}`);

    // The logs are written; what they lack is the trace id, and it says so.
    await expect(page.getByTestId("telemetry-ai-fix-lead")).toHaveText(
      "OneUptime AI opens a pull request that adds the trace id to this service's logs, for you to review.",
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

        /*
         * A done investigation says what OneUptime AI found, marked with the
         * AI tab's sparkles, on one line beside its mark - in its kind's
         * words: a failure that writes no log line found logging to add (it
         * said "a fault in the code").
         */
        const verdict: Locator = entries
          .nth(1)
          .getByTestId("telemetry-ai-log-verdict");

        await expect(verdict).toHaveText("Found logging the code should add");
        await expect(verdict.locator("svg")).toHaveCount(1);

        const markBox: { y: number; height: number } | null = await verdict
          .locator("svg")
          .boundingBox();
        const wordsBox: { y: number; height: number } | null = await verdict
          .locator("p")
          .boundingBox();

        expect(markBox).not.toBeNull();
        expect(wordsBox).not.toBeNull();
        // The mark sits on the first line of the words, not above them.
        expect(markBox!.y).toBeGreaterThanOrEqual(wordsBox!.y);
        expect(markBox!.y + markBox!.height).toBeLessThanOrEqual(
          wordsBox!.y + 24,
        );
        await expect(
          automatic.getByTestId("telemetry-ai-log-verdict"),
        ).toHaveCount(0);

        await expect(entries.nth(2)).toContainText("Asked by Ada Lovelace");
        await expect(entries.nth(2)).toContainText("Nothing to change");

        await expectAiSection(page, testInfo, "Activity");

        if (isPhone(testInfo)) {
          await expectNoSidewaysScroll(page);
        }

        await screenshot(page, testInfo, `activity-${theme}`);
      },
    );

    /*
     * The older entries are a page away: the error log's investigation,
     * which found its cause outside the code - why OneUptime AI opened no
     * pull request on its own - and one that failed, which found nothing.
     */
    await page.getByTestId("telemetry-ai-logs-load-more").click();
    await expect(page.getByTestId("telemetry-ai-log-entry")).toHaveCount(5);

    const outside: Locator = page.getByTestId("telemetry-ai-log-entry").nth(3);

    await expect(outside).toContainText("Investigation");
    await expect(outside.getByTestId("telemetry-ai-log-verdict")).toHaveText(
      "Found a cause outside the code",
    );

    const failed: Locator = page.getByTestId("telemetry-ai-log-entry").nth(4);

    await expect(failed).toContainText("Failed");
    await expect(failed.getByTestId("telemetry-ai-log-verdict")).toHaveCount(0);

    if (isPhone(testInfo)) {
      await expectNoSidewaysScroll(page);
    }

    await screenshot(page, testInfo, "activity-all");

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

    // In the page's own name: Activity, not the AI logs.
    await page.goto(`${AI}/activity?aiLogs=fail`);
    await expect(
      page.getByText(
        "Could not load the AI activity: The AI activity could not be read.",
        { exact: false },
      ),
    ).toBeVisible({ timeout: 60000 });
  });
});
