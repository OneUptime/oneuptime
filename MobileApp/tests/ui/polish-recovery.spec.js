const { test, expect } = require("@playwright/test");
const { installFixtures } = require("./fixtures");

async function capture(page, name, testInfo) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const destination = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: destination, animations: "disabled" });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
}

for (const category of ["incidents", "alerts"]) {
  const resource = category.slice(0, -1);
  test(`${category}: failed states recover and combined filters reset without losing context`, async ({ page }, testInfo) => {
    await installFixtures(page);
    let unavailable = true;
    await page.route(`**/api/${resource}-state/get-list*`, async (route) => {
      if (unavailable) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "State service unavailable" }) });
      }
      return route.fallback();
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();
    await page.getByTestId(`inbox-category-${category}`).click();
    await expect(page.getByText(`Could not load ${resource} states. Retry to see which ${category} are active or resolved.`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Active", exact: true })).toHaveCount(0);
    await expect(page.getByText("3 results", { exact: true })).toHaveCount(0);
    await capture(page, `${category}-state-retry`, testInfo);
    unavailable = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("3 results", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resolved only", exact: true }).click();
    await expect(page.getByText("1 result", { exact: true })).toBeVisible();
    const search = page.getByPlaceholder("Search title or ID");
    await search.fill("no matching record");
    await expect(page.getByText("0 results", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(page.getByText("1 result", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: "All states", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("3 results", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Active only", exact: true }).click();
    await expect(page.getByText("2 results", { exact: true })).toBeVisible();
    await capture(page, `${category}-filtered`, testInfo);
    for (const name of ["All states", "Active only", "Resolved only", "Reset filters"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    }
  });
}

test("list totals include matching records beyond the first rendered batch", async ({ page }) => {
  await installFixtures(page);
  const incidents = Array.from({ length: 25 }, (_, index) => ({
    _id: `incident-${index}`, title: `Database incident ${index}`, incidentNumber: index,
    currentIncidentState: { _id: "created", name: "Investigating", color: { r: 180, g: 35, b: 24 } },
    createdAt: "2026-09-10T09:42:00Z", monitors: [],
  }));
  await page.route("**/api/incident/get-list*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: incidents, count: 25 }),
  }));
  await page.goto("/");
  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("25 results", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active", exact: true }).locator("..")).toContainText("25");
  await page.getByPlaceholder("Search title or ID").fill("Database incident 24");
  await expect(page.getByText("1 result", { exact: true })).toBeVisible();
  await expect(page.getByText("Database incident 24", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.getByText("25 results", { exact: true })).toBeVisible();
});

test("monitor filters keep their selected state, total and reset together", async ({ page }, testInfo) => {
  await installFixtures(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Monitors", exact: true }).click();
  await expect(page.getByText("4 results", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Healthy", exact: true }).click();
  await expect(page.getByText("2 results", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search name or ID").fill("Payments");
  await expect(page.getByText("1 result", { exact: true })).toBeVisible();
  await capture(page, "monitor-search", testInfo);
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.getByText("4 results", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search name or ID")).toHaveValue("");
  await expect(page.getByRole("button", { name: "All monitors", exact: true })).toHaveAttribute("aria-pressed", "true");
});
