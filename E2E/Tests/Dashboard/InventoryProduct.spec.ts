import { Page, expect, test, Locator } from "@playwright/test";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";

/*
 * The Inventory product, end to end.
 *
 * What this covers is the set of things unit tests cannot: that the navbar
 * entry actually reaches the product (it shipped commented out, so the only
 * way in was to know the URL), that the routed subpages resolve rather than
 * rendering a blank layout, and that a hand-registered item survives a round
 * trip through the real API — which is also the only part of the product a
 * test can create without an ingest pipeline behind it.
 *
 * Skip-gated to match the other Dashboard specs (CephProduct.spec.ts,
 * ProxmoxProduct.spec.ts) so CI behaviour stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/InventoryProduct.spec.ts --project=chromium
 */
test.describe.skip("Inventory Product", () => {
  test("is reachable from the navbar and lands on the Overview", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Inventory Project",
    });

    /*
     * The regression this guards: the nav entry existed, fully written, inside
     * a block comment. A user could not reach the product at all.
     */
    await page.getByRole("button", { name: "Products" }).click();

    const inventoryNavOption: Locator = page
      .getByRole("option")
      .filter({ hasText: "Inventory" });

    await expect(inventoryNavOption).toBeVisible({ timeout: 30000 });
    await inventoryNavOption.click();

    // The entry points at the Overview, not at the raw list.
    await page.waitForURL(
      new RegExp(`/dashboard/${projectId}/inventory/overview`),
      { timeout: 30000 },
    );

    /*
     * A project seconds old has discovered nothing, so the Overview shows its
     * empty state rather than the summary strip.
     */
    await expect(page.getByText("Your inventory is empty")).toBeVisible({
      timeout: 60000,
    });
  });

  test("registers an item by hand and opens its subpages", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Inventory Project",
    });

    await page.goto(
      `${page.url().split("/dashboard")[0]}/dashboard/${projectId}/inventory/items`,
    );

    const itemName: string =
      "E2E Vendor API " + Faker.generateName().toString();

    await page.getByRole("button", { name: "Add Item" }).click();

    /*
     * Only the manual types are offered — everything else is discovered, and
     * the server rejects a hand-made row of a discovered type.
     */
    await page.getByText("External Service").first().click();

    await page.getByPlaceholder("Stripe Payments API").fill(itemName);
    await page
      .getByPlaceholder("Vendor-managed. No telemetry. Owned by Payments.")
      .fill("Registered by the Inventory E2E spec.");

    await page.getByRole("button", { name: "Save" }).click();

    // The row appears with its type rendered through the catalog, not raw.
    await expect(page.getByText(itemName).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("External Service").first()).toBeVisible({
      timeout: 30000,
    });

    // Open it. Detail pages live under /inventory/item/:id.
    await page.getByText(itemName).first().click();
    await page.waitForURL(
      new RegExp(`/dashboard/${projectId}/inventory/item/`),
      { timeout: 30000 },
    );

    /*
     * Each tab is its own route, so each has to resolve on its own — this is
     * what a tabbed detail page would not have exercised.
     */
    const subpages: Array<{ link: string; expectText: string }> = [
      { link: "Connections", expectText: "Connections" },
      { link: "Telemetry", expectText: "Telemetry" },
      { link: "Custom Fields", expectText: "Custom Fields" },
      { link: "Incidents", expectText: "No incidents for this item" },
      { link: "Audit Logs", expectText: "Item Audit Logs" },
    ];

    for (const subpage of subpages) {
      await page.getByRole("link", { name: subpage.link }).first().click();
      await expect(page.getByText(subpage.expectText).first()).toBeVisible({
        timeout: 30000,
      });
    }
  });

  test("an item with no typed row explains where its incidents live", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Inventory Project",
    });

    await page.goto(
      `${page.url().split("/dashboard")[0]}/dashboard/${projectId}/inventory/items`,
    );

    const itemName: string = "E2E Appliance " + Faker.generateName().toString();

    await page.getByRole("button", { name: "Add Item" }).click();
    await page.getByText("Appliance").first().click();
    await page.getByPlaceholder("Stripe Payments API").fill(itemName);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(itemName).first()).toBeVisible({
      timeout: 30000,
    });

    await page.getByText(itemName).first().click();
    await page.getByRole("link", { name: "Incidents" }).first().click();

    /*
     * The point of the typed-row design: an appliance has no incidents of its
     * own, and the page says so and says where to look, rather than rendering
     * an empty table that reads as "nothing is wrong".
     */
    await expect(page.getByText("No incidents for this item")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/Connections/).first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("archiving takes an item out of the main list without deleting it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Inventory Project",
    });

    const itemsUrl: string = `${page.url().split("/dashboard")[0]}/dashboard/${projectId}/inventory/items`;

    await page.goto(itemsUrl);

    const itemName: string =
      "E2E Archive Me " + Faker.generateName().toString();

    await page.getByRole("button", { name: "Add Item" }).click();
    await page.getByText("External Database").first().click();
    await page.getByPlaceholder("Stripe Payments API").fill(itemName);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(itemName).first()).toBeVisible({
      timeout: 30000,
    });

    // Select the row and archive it through the bulk action.
    await page.getByRole("checkbox").nth(1).check();
    await page.getByRole("button", { name: "Archive" }).first().click();
    await page.getByRole("button", { name: "Archive" }).last().click();

    // Gone from the live list...
    await page.goto(itemsUrl);
    await expect(page.getByText(itemName)).toHaveCount(0, { timeout: 30000 });

    // ...and present in the archived one, which says it is not decommissioned.
    await page.goto(
      `${page.url().split("/dashboard")[0]}/dashboard/${projectId}/inventory/archived`,
    );
    await expect(page.getByText(itemName).first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("These are hidden, not gone")).toBeVisible({
      timeout: 30000,
    });
  });
});
