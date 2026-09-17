import { expect, Locator, Page, test, TestInfo } from "@playwright/test";

interface FixtureState {
  requests: number;
  refreshOffline: boolean;
  inputFrames?: Array<{ value: string; durationMs: number }>;
}

declare global {
  interface Window {
    __statusPageSearchFixture: FixtureState;
  }
}

test.beforeEach(async ({ page }: { page: Page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status-page-overview")).toBeVisible();
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(40);
  await expect(page.getByTestId("uptime-bar")).toHaveCount(40 * 91);
});

test("keeps every character while rapidly narrowing 40 nested resource histories", async ({
  page,
}: { page: Page }, testInfo: TestInfo) => {
  const search: Locator = page.getByRole("searchbox", {
    name: "Search resources",
  });
  const pageErrors: Array<string> = [];
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await search.evaluate((input: HTMLInputElement): void => {
    window.__statusPageSearchFixture.inputFrames = [];
    input.addEventListener("input", (): void => {
      const startedAt: number = performance.now();
      const value: string = input.value;
      requestAnimationFrame((): void => {
        window.__statusPageSearchFixture.inputFrames?.push({
          value,
          durationMs: performance.now() - startedAt,
        });
      });
    });
  });
  const startedAt: number = Date.now();
  await search.pressSequentially("0660");
  await expect(search).toHaveValue("0660");
  await expect(search).toBeFocused();
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("1 of 40 resources");
  await expect(page.getByText("Database 0660", { exact: true })).toBeVisible();
  await expect(page.getByText("Service 0001", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("status-page-group-header")).toHaveCount(4);
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(1);
  const typingDurationMs: number = Date.now() - startedAt;
  await page.screenshot({
    path: testInfo.outputPath("filtered-resources.png"),
    fullPage: true,
  });

  const clearStartedAt: number = Date.now();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(40);
  const clearDurationMs: number = Date.now() - clearStartedAt;
  await page.screenshot({ path: testInfo.outputPath("cleared-search.png") });

  /*
   * Start a new query immediately after clearing: delayed work from the first
   * query must never overwrite this text or leave the old resource on screen.
   */
  await search.pressSequentially("0039");
  await expect(search).toHaveValue("0039");
  await expect(search).toBeFocused();
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("1 of 40 resources");
  await expect(page.getByText("Service 0039", { exact: true })).toBeVisible();
  await expect(page.getByText("Database 0660", { exact: true })).toHaveCount(0);

  /*
   * Interrupt restoration of all 40 charts with a new query: do not wait for
   * the cleared results before sending the next keystrokes.
   */
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await search.pressSequentially("0660");
  await expect(search).toHaveValue("0660");
  await expect(search).toBeFocused();
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("1 of 40 resources");
  await expect(page.getByText("Database 0660", { exact: true })).toBeVisible();
  await expect(page.getByText("Service 0039", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(1);
  expect(
    await page.evaluate((): number => {
      return window.__statusPageSearchFixture.requests;
    }),
  ).toBe(1);
  expect(pageErrors).toEqual([]);
  // Diagnostic only: correctness does not depend on host/CI rendering speed.
  await testInfo.attach("search-responsiveness", {
    body: JSON.stringify({
      typingDurationMs,
      clearDurationMs,
      // Input event to the next animation frame, without Playwright round trips.
      inputFrames: await page.evaluate(() => {
        return window.__statusPageSearchFixture.inputFrames;
      }),
    }),
    contentType: "application/json",
  });
});

test("handles a replacement query, no results and Escape without losing focus", async ({
  page,
}: {
  page: Page;
}) => {
  const search: Locator = page.getByRole("searchbox", {
    name: "Search resources",
  });
  await search.fill("0660");
  await search.fill("missing-resource");
  await expect(search).toHaveValue("missing-resource");
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("0 of 40 resources");
  await expect(
    page.getByText("No matching resources", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(0);
  await expect(search).toBeFocused();

  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(40);
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("");
  await expect(
    page.getByText("No matching resources", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Clear search", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate((): boolean => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    }),
  ).toBe(true);
});

test("finds descriptions and complete group subtrees while preserving collapsed groups", async ({
  page,
}: {
  page: Page;
}) => {
  const search: Locator = page.getByRole("searchbox", {
    name: "Search resources",
  });
  const production: Locator = page
    .getByTestId("status-page-group-header")
    .filter({ hasText: "Production" });
  await production.click();
  await expect(production).toHaveAttribute("aria-expanded", "false");
  await search.fill("  eUrOpE  ");
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("30 of 40 resources");
  await expect(production).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(30);
  await expect(page.getByText("Service 0011", { exact: true })).toBeVisible();
  await expect(page.getByText("Database 0660", { exact: true })).toBeVisible();
  await expect(page.getByText("Service 0001", { exact: true })).toHaveCount(0);

  await search.fill("billing");
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("1 of 40 resources");
  await expect(page.getByText("Service 0039", { exact: true })).toBeVisible();
  await expect(page.getByTestId("status-page-group-header")).toHaveCount(4);
  await search.press("Escape");
  await expect(production).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(0);
  await production.click();
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(40);
});

test("keeps the query and displays fresh status after an overview refresh", async ({
  page,
}: {
  page: Page;
}) => {
  const search: Locator = page.getByRole("searchbox", {
    name: "Search resources",
  });
  await search.fill("0660");
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(1);
  await page.evaluate((): void => {
    window.__statusPageSearchFixture.refreshOffline = true;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Some Resources are Offline", { exact: true }),
  ).toBeVisible();
  // The matched resource and every ancestor rollup must use the fresh status.
  await expect(page.getByText("Offline", { exact: true })).toHaveCount(5);
  await expect(search).toHaveValue("0660");
  await expect(
    page.getByTestId("status-page-resource-search-count"),
  ).toHaveText("1 of 40 resources");
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(1);
  expect(
    await page.evaluate((): number => {
      return window.__statusPageSearchFixture.requests;
    }),
  ).toBe(2);
});

test("keeps history tooltips and the day dialog accessible after filtering", async ({
  page,
}: {
  page: Page;
}) => {
  await page.getByRole("searchbox", { name: "Search resources" }).fill("0660");
  await expect(page.getByTestId("day-uptime-graph")).toHaveCount(1);
  const day: Locator = page.getByTestId("uptime-bar").nth(88);
  await day.scrollIntoViewIfNeeded();
  await day.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText("Uptime");
  await expect(page.getByRole("tooltip")).toContainText("Offline");
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toBeHidden();
  // Create another day's tooltip using only focus, before it has ever hovered.
  const keyboardDay: Locator = page.getByTestId("uptime-bar").nth(87);
  await keyboardDay.focus();
  await expect(keyboardDay).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText("Uptime");
  await expect(page.getByRole("tooltip")).not.toContainText("Offline");
  await page.getByRole("searchbox", { name: "Search resources" }).focus();
  await expect(page.getByRole("tooltip")).toBeHidden();
  await day.focus();
  await expect(day).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await day.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Uptime");
  await expect(page.getByRole("dialog")).toContainText("Offline");
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(day).toBeFocused();
});
