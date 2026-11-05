import { expect, Locator, Page } from "@playwright/test";
import {
  CLOUD_PATH,
  FixtureRecord,
  fixtureRecord,
  partPath,
  test,
} from "./Helpers";

/*
 * Bare metal, in a browser, on what a real cloud's exporter answered: Ironic on a DevStack with fake
 * hardware (Common/Tests/Fixtures/OpenStack/services-ironic). The jsdom suite
 * (Common/Tests/App/Dashboard/OpenStackBareMetalPages.test.tsx) holds each page's every state, on
 * rows written by hand where nothing recorded holds them. What these add is what only a browser
 * shows: the menu only appears where Ironic does, the links land, a phone can read it, and a walk
 * reads nothing the fixture doesn't answer as the server would.
 */

const FAILED: string = "recording=services-ironic/deploy-failed";
const HALF_ENROLLED: string = "recording=services-ironic/half-enrolled";
const NO_IRONIC: string = "recording=gazpacho-ovs/healthy";

const CLEAN_FAILED_ID: string = "9654dc06-7244-447a-9e3e-b4c2ec239a6c";
const MAINTENANCE_ID: string = "1062b540-62b5-44a7-805f-212d8778807c";

function rowOf(page: Page, name: string): Locator {
  return page.locator("tr", { hasText: name }).first();
}

test.describe("bare metal", () => {
  test("a cloud without Ironic has no section, no chip and no card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}?${NO_IRONIC}`);
    await expect(page.getByText("Hypervisors").first()).toBeVisible();

    await expect(page.getByRole("link", { name: "Nodes" })).toHaveCount(0);
    await expect(page.getByText("bare metal node")).toHaveCount(0);

    await page.goto(`${CLOUD_PATH}/services?${NO_IRONIC}`);
    await expect(
      page.getByTestId("openstack-service-group").first(),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="openstack-service-group"][data-service="baremetal"]',
      ),
    ).toHaveCount(0);
  });

  test("a cloud without Ironic is offered no bare metal alert", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/recommendations?${NO_IRONIC}`);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Bare Metal Node in Error")).toHaveCount(0);
  });

  test("a cloud with it is, on the same page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/recommendations?${FAILED}`);
    await expect(
      page.getByText("Bare Metal Node in Error").first(),
    ).toBeVisible();
  });

  test("the Overview names both failed nodes, by name, and links to them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}?${FAILED}`);

    await expect(page.getByText("ou-node-clean-failed").first()).toBeVisible();
    await expect(page.getByText("ou-node-deploy-failed").first()).toBeVisible();
    // Someone put this one there, which is planned.
    await expect(page.getByText("ou-node-maintenance")).toHaveCount(0);
    await expect(page.getByText("5 bare metal nodes").first()).toBeVisible();

    await page.getByText("ou-node-clean-failed").first().click();
    await expect(page).toHaveURL(new RegExp(`bare-metal/${CLEAN_FAILED_ID}`));
    await expect(
      page.getByTestId("openstack-bare-metal-node-explanation"),
    ).toBeVisible();
  });

  test("from the menu to the list, and from a row to its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}?${FAILED}`);
    await page.getByRole("link", { name: "Nodes" }).first().click();

    await expect(page).toHaveURL(/\/bare-metal/);
    const row: Locator = rowOf(page, "ou-node-maintenance");

    await expect(row).toBeVisible();
    await expect(row).toContainText("a disk being swapped");
    await expect(
      page.getByTestId("openstack-bare-metal-classes"),
    ).toBeVisible();

    await row.getByRole("button", { name: /view/i }).first().click();

    await expect(page).toHaveURL(new RegExp(`bare-metal/${MAINTENANCE_ID}`));
    await expect(
      page.getByTestId("openstack-bare-metal-node-maintenance"),
    ).toContainText("a disk being swapped");
  });

  test("a half-enrolled node breaks nothing, and says what it is waiting for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/bare-metal?${HALF_ENROLLED}`);
    await expect(rowOf(page, "ou-node-half")).toContainText("enroll");

    await page.goto(
      `${partPath("bare-metal", "b261259e-f7c0-40cf-ac0d-77e575c96445")}?${HALF_ENROLLED}`,
    );
    await expect(
      page.getByTestId("openstack-bare-metal-node-enroll"),
    ).toBeVisible();
    await expect(
      page.getByTestId("openstack-bare-metal-node-attention"),
    ).not.toContainText("enroll");
  });

  test("the Services page says the agent has no conductors to list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/services?${FAILED}`);

    const card: Locator = page.locator(
      '[data-testid="openstack-service-group"][data-service="baremetal"]',
    );

    await expect(card).toContainText("Bare Metal (Ironic)");
    await expect(
      card.getByTestId("openstack-service-group-workers-not-listed"),
    ).toContainText("no series for Ironic's conductors");
  });

  test("fits a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const path of [
      `${CLOUD_PATH}/bare-metal?${FAILED}`,
      `${partPath("bare-metal", CLEAN_FAILED_ID)}?${FAILED}`,
    ]) {
      await page.goto(path);
      await expect(
        page.getByText("ou-node-clean-failed").first(),
      ).toBeVisible();

      const overflow: number = await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      });

      expect(overflow).toBeLessThanOrEqual(1);
    }
  });

  test("reads the rows of one kind, and never asks what the fixture can't answer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/bare-metal?${FAILED}`);
    await expect(rowOf(page, "ou-node-half")).toBeVisible();

    const fixture: FixtureRecord = await fixtureRecord(page);

    expect(fixture.unhandled).toEqual([]);
    expect(
      fixture.apiRequests.filter((request: { url: string }): boolean => {
        return request.url.includes("bare-metal-classes");
      }).length,
    ).toBe(1);
  });
});
