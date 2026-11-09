import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Usage > Your AI calls, in a browser on the real page (LlmConnect/
 * Fixture.js): the tiles and the breakdown read /telemetry/llm/usage, which
 * counts each service from the signal it sends - an app's AI calls, a
 * coding tool's usage metrics - so Claude Code's usage counts beside the
 * app's calls, and the app's own OpenLLMetry metrics are never added to its
 * calls again. Each figure says where it came from.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/llm-connect-ui",
);

interface FixtureState {
  usages: Array<{ startTime: string; endTime: string; dimension: string }>;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?page=usage&${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixture(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __llmConnectFixture: { state: unknown } })
          .__llmConnectFixture.state,
      ),
    );
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${test.info().project.name}.png`),
    fullPage: true,
  });
}

function rows(page: Locator | Page): Locator {
  return page.getByTestId("llm-usage-row");
}

function row(page: Page, text: string): Locator {
  return rows(page).filter({ hasText: text });
}

async function pick(page: Page, dimension: string): Promise<void> {
  await page
    .getByRole("group", { name: "Usage dimension" })
    .getByRole("button", { name: dimension })
    .click();
}

test.describe("Usage, from the AI calls and the usage metrics", () => {
  test("a coding tool's usage metrics count beside an app's AI calls", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=done");

    // 1,240 calls from the app; Claude Code's metrics count no call.
    await expect(page.getByTestId("llm-usage-totals-calls-value")).toHaveText(
      "1,240",
    );
    await expect(page.getByTestId("llm-usage-totals-calls-hint")).toHaveText(
      "1.2% error rate",
    );
    // 1.97M from the app's calls + 4M from Claude Code's metrics.
    await expect(page.getByTestId("llm-usage-totals-input-value")).toHaveText(
      "6M",
    );
    await expect(page.getByTestId("llm-usage-totals-output-value")).toHaveText(
      "816k",
    );
    // $20.50 of calls + $52.25 of Claude Code's cost metric.
    await expect(page.getByTestId("llm-usage-totals-cost-value")).toHaveText(
      "$72.75",
    );
    await expect(page.getByTestId("llm-usage-totals-input-hint")).toHaveText(
      "From AI calls and usage metrics",
    );
    await expect(page.getByTestId("llm-usage-totals-cost-hint")).toHaveText(
      "From AI calls and usage metrics",
    );

    // By person: Ana's calls and her Claude Code usage are one row.
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(0)).toContainText("ana@sysnetix.com");
    await expect(rows(page).nth(0)).toContainText("$61.35");
    await expect(rows(page).nth(0)).toContainText("4,650,000");
    await expect(
      rows(page).nth(0).getByTestId("llm-usage-row-source"),
    ).toHaveText("From AI calls and usage metrics");
    // Chen only uses Claude Code: no call, a dash rather than a 0.
    await expect(rows(page).nth(1)).toContainText("chen@sysnetix.com");
    await expect(
      rows(page).nth(1).getByTestId("llm-usage-row-source"),
    ).toHaveText("From usage metrics");
    await expect(rows(page).nth(1).locator("td").nth(2)).toHaveText("—");
    // Bob only made calls: no source line.
    await expect(rows(page).nth(2)).toContainText("bob@sysnetix.com");
    await expect(
      rows(page).nth(2).getByTestId("llm-usage-row-source"),
    ).toHaveCount(0);

    await expect(page.getByTestId("llm-usage-metric-services")).toHaveText(
      "Services counted from usage metrics: claude-code",
    );

    const state: FixtureState = await fixture(page);
    expect(
      state.usages.map((usage: { dimension: string }): string => {
        return usage.dimension;
      }),
    ).toEqual(expect.arrayContaining(["none", "employee"]));
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "usage-calls-and-metrics");
  });

  test("an app's own usage metrics are never added to its calls", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=done");
    await pick(page, "Application / Service");

    await expect(rows(page)).toHaveCount(2);
    // Claude Code first: $52.25 of usage metrics, and no call.
    await expect(rows(page).nth(0)).toContainText("claude-code");
    await expect(rows(page).nth(0)).toContainText("$52.25");
    await expect(
      rows(page).nth(0).getByTestId("llm-usage-row-source"),
    ).toHaveText("From usage metrics");
    // The app: its calls' 1,970,000 input tokens, not twice that.
    await expect(row(page, "checkout-api")).toContainText("1,970,000");
    await expect(row(page, "checkout-api")).toContainText("$20.50");
    await expect(
      row(page, "checkout-api").getByTestId("llm-usage-row-source"),
    ).toHaveCount(0);

    // The totals above did not change with the dimension.
    await expect(page.getByTestId("llm-usage-totals-cost-value")).toHaveText(
      "$72.75",
    );

    const state: FixtureState = await fixture(page);
    expect(state.usages[state.usages.length - 1]!.dimension).toBe("service");
    await shoot(page, "usage-by-service");
  });

  test("every dimension counts the metrics, a provider named its way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=done");
    await pick(page, "Provider");

    // Claude Code's metrics name no provider: Unattributed, not dropped.
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText("Unattributed");
    await expect(rows(page).nth(0)).toContainText("$52.25");
    await expect(row(page, "OpenAI")).toContainText("$20.50");

    await pick(page, "Model");
    await expect(row(page, "claude-sonnet-4-5")).toContainText("$52.25");
    await expect(row(page, "gpt-4o-mini")).toContainText("$1.90");
  });

  test("Cursor's export counts beside the apps' calls, never the provider accounts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=done&otel=cursor");

    // $72.75 + Cursor's exported $7.20; the provider accounts are not added.
    await expect(page.getByTestId("llm-usage-totals-cost-value")).toHaveText(
      "$79.95",
    );
    await expect(page.getByTestId("llm-usage-metric-services")).toHaveText(
      "Services counted from usage metrics: claude-code, cursor",
    );
    await expect(row(page, "u-7f3a")).toContainText("$7.20");
  });

  test("a role that may not read metrics is told the metrics are left out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=done&usage=left-out");

    await expect(page.getByTestId("llm-usage-metrics-left-out")).toHaveText(
      "Usage metrics are left out: your role cannot read metrics.",
    );
    await expect(page.getByTestId("llm-usage-totals-cost-value")).toHaveText(
      "$20.50",
    );
    await expect(page.getByTestId("llm-usage-totals-cost-hint")).toHaveText(
      "From AI calls",
    );
    await expect(page.getByTestId("llm-usage-metric-services")).toHaveCount(0);
  });

  test("a failed read shows dashes and says so, never zeros", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=done&usage=fail");

    await expect(page.getByTestId("llm-usage-totals-cost-value")).toHaveText(
      "—",
    );
    await expect(page.getByTestId("llm-usage-totals-input-value")).toHaveText(
      "—",
    );
    // A tile says it could not be loaded, never where a figure came from.
    await expect(page.getByTestId("llm-usage-totals-cost-hint")).toHaveText(
      "Could not be loaded",
    );
    await expect(
      page.getByText("Usage could not be loaded for this time range."),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test("in German and in the dark theme", async ({ page }: { page: Page }) => {
    await open(page, "state=done&lang=de&theme=dark");

    await expect(page.getByTestId("llm-usage-totals-cost-hint")).toHaveText(
      "Aus KI-Aufrufen und Nutzungsmetriken",
    );
    await expect(
      rows(page).nth(1).getByTestId("llm-usage-row-source"),
    ).toHaveText("Aus Nutzungsmetriken");
    await expect(page.getByTestId("llm-usage-metric-services")).toHaveText(
      "Aus Nutzungsmetriken gezählte Dienste: claude-code",
    );
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "usage-calls-and-metrics-de-dark");
  });

  test("in Persian, right to left", async ({ page }: { page: Page }) => {
    await open(page, "state=done&lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("llm-usage-totals-cost-hint")).toHaveText(
      "از فراخوانی‌های هوش مصنوعی و متریک‌های مصرف",
    );
    await expect(
      rows(page).nth(1).getByTestId("llm-usage-row-source"),
    ).toHaveText("از متریک‌های مصرف");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await shoot(page, "usage-calls-and-metrics-fa");
  });

  test("at a laptop's and a tablet's width", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "Widths of their own, set below",
    );

    for (const width of [1024, 768]) {
      await page.setViewportSize({ width: width, height: 900 });
      await open(page, "state=done");

      await expect(rows(page)).toHaveCount(3);
      await expect(page.getByTestId("llm-usage-totals-cost-hint")).toHaveText(
        "From AI calls and usage metrics",
      );
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await page.screenshot({
        path: path.join(SCREENSHOTS, `usage-calls-and-metrics-${width}.png`),
        fullPage: true,
      });
    }
  });
});
