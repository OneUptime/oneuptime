const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { installFixtures } = require("./fixtures");

/*
 * The lists' filters in the exported app, against the fixtures' server:
 * the Filter button beside the search, its sheet, the chips that say what
 * is on, the request the server is asked, and a record's Owners and Labels.
 */

async function capture(page, name, testInfo) {
  await page.evaluate(() => { return document.fonts.ready; });
  await page.waitForTimeout(350);
  const destination = process.env.UPDATE_SCREENSHOTS
    ? path.join(__dirname, "../../docs/screenshots", `${testInfo.project.name}-${name}.png`)
    : testInfo.outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await page.screenshot({ path: destination, animations: "disabled" });
  await testInfo.attach(name, { path: destination, contentType: "image/png" });
  expect(await page.evaluate(() => { return document.documentElement.scrollWidth <= window.innerWidth; })).toBe(true);
}

// Show results closes the sheet; it slides away for a quarter of a second.
async function applyFilters(page) {
  await page.getByTestId("filter-sheet-apply").click();
  await expect(page.getByTestId("filter-sheet")).toHaveCount(0);
}

async function openIncidents(page) {
  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await page.getByTestId("inbox-category-incidents").click();
  await expect(page.getByText("Checkout API latency above threshold", { exact: true })).toBeVisible();
}

test("incidents filter by owner and severity, asked of the server", async ({ page }, testInfo) => {
  const { requests } = await installFixtures(page);
  const failures = [];
  page.on("pageerror", (error) => { failures.push(error.message); });
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await openIncidents(page);
  await expect(page.getByText("Background jobs processing slowly", { exact: true })).toBeVisible();

  await page.getByTestId("list-filter-button").click();
  await expect(page.getByText("Filter incidents", { exact: true })).toBeVisible();
  await expect(page.getByTestId("filter-option-severity-critical")).toBeVisible();
  await capture(page, "filters-sheet", testInfo);

  await page.getByTestId("filter-option-owner-me").click();
  await page.getByTestId("filter-option-severity-critical").click();
  await capture(page, "filters-sheet-picked", testInfo);
  await applyFilters(page);

  await expect(page.getByText("Checkout API latency above threshold", { exact: true })).toBeVisible();
  await expect(page.getByText("Background jobs processing slowly", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Owner: You", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Severity: Critical", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter incidents, 2 filters on", exact: true })).toBeVisible();
  await capture(page, "filters-applied", testInfo);

  // You: the reader, and the team they are on, as the server's owners filter.
  const asked = requests.filter((request) => {
    return request.path === "/api/incident/get-list" && request.body?.query?.owners;
  });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked[asked.length - 1].body.query.owners).toEqual({ _type: "OwnedBy", match: "AnyOf", userIds: ["responder-1"], teamIds: ["team-platform"] });
  expect(asked[asked.length - 1].body.query.incidentSeverityId).toEqual({ _type: "Includes", value: ["critical"] });

  await page.getByRole("button", { name: "Remove Owner filter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Owner: You", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.getByText("Background jobs processing slowly", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

test("an incident says who owns it and how it is labelled", async ({ page }, testInfo) => {
  await installFixtures(page);
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await openIncidents(page);
  await page.getByText("Checkout API latency above threshold", { exact: true }).click();
  await expect(page.getByText("Impact", { exact: true })).toBeVisible();
  const owners = page.getByTestId("record-owners");
  await owners.scrollIntoViewIfNeeded();
  await expect(owners).toHaveAttribute("aria-label", "Owners: You, Platform");
  await expect(page.getByTestId("record-labels")).toHaveAttribute("aria-label", "Labels: checkout, payments");
  await capture(page, "incident-owners-labels", testInfo);
});

test("monitors filter by type and owner", async ({ page }, testInfo) => {
  await installFixtures(page);
  await page.goto("/");
  await expect(page.getByText("Overview", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Monitors", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Monitor Payments worker\. Status/ })).toBeVisible();

  await page.getByTestId("list-filter-button").click();
  await expect(page.getByText("Filter monitors", { exact: true })).toBeVisible();
  await expect(page.getByText("Status", { exact: true })).toBeVisible();
  await page.getByTestId("filter-option-monitorType-Website").click();
  await applyFilters(page);

  await expect(page.getByRole("button", { name: /^Monitor Checkout API\. Status/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Monitor Payments worker\. Status/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Type: Website", exact: true })).toBeVisible();
  await capture(page, "monitors-filtered", testInfo);

  await page.getByTestId("list-filter-button").click();
  await page.getByTestId("filter-option-owner-me").click();
  await applyFilters(page);
  await expect(page.getByRole("button", { name: /^Monitor Checkout API\. Status/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Monitor Customer dashboard\. Status/ })).toHaveCount(0);
});
