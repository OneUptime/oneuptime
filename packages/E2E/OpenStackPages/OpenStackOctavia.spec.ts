import { Locator, Page } from "@playwright/test";
import {
  VIEWPORTS,
  expect,
  openCloudPage,
  partPath,
  screenshot,
  test,
} from "./Helpers";

/*
 * Octavia in a real browser through the real router, on what a real stable/2026.1 DevStack recorded
 * (Common/Tests/Fixtures/OpenStack/services-octavia). What these add to the jsdom suite
 * (OpenStackOctaviaPages.test.tsx) is what only a browser shows: that the menu really has the entry or
 * really doesn't, that each link really lands, and that every page fits a phone.
 */

const WITHOUT_OCTAVIA: string = "recording=gazpacho-ovs/healthy";
const BASELINE: string = "recording=services-octavia/baseline";
const LB_ERROR: string = "recording=services-octavia/lb-error";
const POOLS_DOWN: string = "recording=services-octavia/pool-members-down";
const TWO_MASTERS: string = "recording=services-octavia/two-masters";
const AMPHORA_ERROR: string = "recording=services-octavia/amphora-error";

const FAILED_LOAD_BALANCER: string = "c5b33ea0-43bb-4f9e-823e-10a848867f50";

function sideMenuLink(page: Page, name: string): Locator {
  return page.getByRole("link", { name, exact: false });
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

function needsAttention(page: Page): Locator {
  return page.getByTestId("openstack-needs-attention");
}

test.describe("a cloud that doesn't run Octavia", () => {
  test("its menu says nothing of it", async ({ page }) => {
    await openCloudPage(page, "", WITHOUT_OCTAVIA);
    await expect(sideMenuLink(page, "Hypervisors").first()).toBeVisible();
    await expect(sideMenuLink(page, "Load Balancers")).toHaveCount(0);
  });

  test("nor does its Services page, or what it is offered to alert on", async ({
    page,
  }) => {
    await openCloudPage(page, "services", WITHOUT_OCTAVIA);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("Load Balancers (Octavia)")).toHaveCount(0);

    await openCloudPage(page, "recommendations", WITHOUT_OCTAVIA);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Load Balancer in Error")).toHaveCount(0);
    await expect(page.getByText("Amphora in Error")).toHaveCount(0);
  });

  test("an old link says it doesn't run it, and is no error", async ({
    page,
  }) => {
    await openCloudPage(page, "load-balancers", WITHOUT_OCTAVIA);
    await expect(
      page.getByText("This cloud doesn't run this service").first(),
    ).toBeVisible();
  });
});

test.describe("a cloud that runs Octavia", () => {
  test("gets its load balancers under Network", async ({ page }) => {
    await openCloudPage(page, "", BASELINE);
    await expect(sideMenuLink(page, "Load Balancers").first()).toBeVisible();
  });

  test("a load balancer in ERROR reaches Needs attention by name, and lands on its page", async ({
    page,
  }) => {
    await openCloudPage(page, "", LB_ERROR);
    const card: Locator = needsAttention(page);
    await expect(card.getByText("ou-lb-failed")).toBeVisible();
    await expect(card.getByText("ou-lb-ovn")).toHaveCount(0);

    await card.getByRole("link", { name: /ou-lb-failed/ }).click();
    await expect(
      page.getByTestId("openstack-load-balancer-overview"),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/load-balancers/${FAILED_LOAD_BALANCER}`),
    );
    await expect(
      page.getByTestId("openstack-load-balancer-explanation"),
    ).toContainText("retries none of these by itself");
    await screenshot(page, "load-balancer-in-error");
  });

  test("a pool with every member down is named, though its load balancer provisions ACTIVE", async ({
    page,
  }) => {
    await openCloudPage(page, "", POOLS_DOWN);
    const card: Locator = needsAttention(page);
    await expect(card.getByText("ou-lb-pool")).toBeVisible();
    await expect(card.getByText("ou-lb-ha-pool")).toBeVisible();
    await expect(card.getByText("ou-lb-ovn-pool")).toHaveCount(0);
  });

  test("an active-standby pair with two masters is named", async ({ page }) => {
    await openCloudPage(page, "", TWO_MASTERS);
    await expect(needsAttention(page).getByText("ou-lb-ha")).toBeVisible();
  });

  test("an amphora in ERROR is named by its id, and lands on its page", async ({
    page,
  }) => {
    await openCloudPage(page, "", AMPHORA_ERROR);
    const link: Locator = needsAttention(page)
      .getByRole("link", { name: /46c373fb/ })
      .first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByTestId("openstack-amphora-overview")).toBeVisible();
    await screenshot(page, "amphora-in-error");
  });

  test("the list holds load balancers, pools and amphorae, each in Octavia's word", async ({
    page,
  }) => {
    await openCloudPage(page, "load-balancers", LB_ERROR);
    await expect(
      page.locator("tr", { hasText: "ou-lb-failed" }).first(),
    ).toContainText("ERROR");
    await expect(
      page.locator("tr", { hasText: "ou-lb-pool" }).first(),
    ).toContainText("HTTP");
    await expect(page.getByText("Amphorae").first()).toBeVisible();
    await screenshot(page, "load-balancers");
  });

  test("the Services page says its workers aren't listed", async ({ page }) => {
    await openCloudPage(page, "services", BASELINE);
    await expect(
      page.getByTestId("openstack-service-group-workers-not-listed").first(),
    ).toContainText("Nothing the agent reads lists Octavia's workers");
  });

  test("Topology draws its load balancers under Network", async ({ page }) => {
    await openCloudPage(page, "topology", BASELINE);
    await expect(page.getByText("Network").first()).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`load balancers and a load balancer's page fit at ${viewport.width} pixels`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await openCloudPage(page, "load-balancers", LB_ERROR);
      await expect(page.getByText("ou-lb-failed").first()).toBeVisible();
      await expectNoSidewaysScroll(page);

      await page.goto(
        `${partPath("load-balancers", FAILED_LOAD_BALANCER)}?${LB_ERROR}`,
      );
      await expect(
        page.getByTestId("openstack-load-balancer-overview"),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }
});
