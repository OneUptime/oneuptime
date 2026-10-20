import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * Usage > Provider accounts, in a browser on the real page
 * (LlmConnect/Fixture.js): what the connected provider accounts report,
 * kept apart from the AI calls apps send (the two count the same calls),
 * by model, person, provider, project, key or connection - and, with no
 * provider account connected, the way to connect one.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/llm-connect-ui",
);

interface FixtureState {
  aggregates: Array<{ name: string; keys: Array<string> }>;
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

// A picked preset is the primary button.
const PICKED_PRESET: RegExp = /bg-indigo-600/;

function rows(page: Page): Locator {
  return page.getByTestId("llm-provider-usage-row");
}

test.describe("Usage, from the provider accounts", () => {
  test("is its own source, chosen at the top and kept in the address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected");

    // The product's view switch, as List | Calendar is.
    await expect(page.getByTestId("llm-usage-source-calls")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("llm-usage-source-description")).toHaveText(
      "What your apps and coding tools send",
    );

    await page.getByTestId("llm-usage-source-providers").click();
    await expect(page.getByTestId("llm-provider-usage")).toBeVisible();
    await expect(page.getByTestId("llm-usage-source-description")).toHaveText(
      "What your connected accounts were billed",
    );
    expect(new URL(page.url()).searchParams.get("source")).toBe("providers");
  });

  test("the totals and the groups, biggest bill first, estimates marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&source=providers");

    await expect(
      page.getByTestId("llm-provider-usage-total-cost"),
    ).toContainText("$182.40");
    // The tiles Your AI calls draws: tokens the way the AI pages write them.
    await expect(
      page.getByTestId("llm-provider-usage-total-input"),
    ).toContainText("1.4M");
    await expect(
      page.getByTestId("llm-provider-usage-total-requests"),
    ).toContainText("5,400");
    await expect(
      page.getByTestId("llm-provider-usage-estimate-hint"),
    ).toBeVisible();

    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(0)).toContainText("gpt-4o");
    await expect(rows(page).nth(0)).toContainText("$120.50");
    await expect(rows(page).nth(0)).toContainText("900,000");

    // A month back: the range picker's own "1 month", shown picked.
    // (A phone shows fewer presets; the month's is there, hidden.)
    await expect(
      page.getByRole("button", { name: "1 month", includeHidden: true }),
    ).toHaveClass(PICKED_PRESET);
    // Bedrock reports no requests: a dash, not a zero.
    await expect(rows(page).nth(2)).toContainText("—");
    await shoot(page, "usage-providers");
  });

  test("by person, with what the provider did not name said plainly", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&source=providers");

    await page.getByTestId("llm-provider-usage-dimension-person").click();
    await expect(rows(page).nth(0)).toContainText("ana@sysnetix.com");
    await expect(rows(page).nth(2)).toContainText("Not named by the provider");

    const state: FixtureState = await fixture(page);
    const last: { name: string; keys: Array<string> } =
      state.aggregates[state.aggregates.length - 1]!;
    expect(last.keys).toContain("user.email");
  });

  test("by provider, named as the product names them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=connected&source=providers");

    await page.getByTestId("llm-provider-usage-dimension-provider").click();
    await expect(rows(page).nth(0)).toContainText("OpenAI");
    await expect(rows(page).nth(1)).toContainText("Amazon Bedrock");
  });

  test("with no provider account connected, the way to connect one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "state=empty&source=providers");

    await expect(
      page.getByTestId("llm-provider-usage-not-connected"),
    ).toBeVisible();
    await expect(page.getByTestId("llm-provider-usage-connect")).toBeVisible();
    await shoot(page, "usage-providers-not-connected");
  });

  test("in the dark theme", async ({ page }: { page: Page }) => {
    await open(page, "state=connected&source=providers&theme=dark");

    await expect(rows(page)).toHaveCount(3);
    const overflow: number = await page.evaluate(() => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await shoot(page, "usage-providers-dark");
  });
});
