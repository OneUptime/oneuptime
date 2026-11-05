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
 * Manila in a real browser through the real router, on what a real stable/2026.1 DevStack recorded
 * (Common/Tests/Fixtures/OpenStack/services-manila). What these add to the jsdom suite
 * (OpenStackManilaPages.test.tsx) is what only a browser shows: that the menu really has the entry or
 * really doesn't, that each link really lands, and that every page fits a phone.
 */

const WITHOUT_MANILA: string = "recording=gazpacho-ovs/healthy";
const BASELINE: string = "recording=services-manila/baseline";
const STUCK: string = "recording=services-manila/share-stuck";
const API_DOWN: string = "recording=services-manila/api-down";

const SHARE_IN_ERROR: string = "dc946347-57a2-4171-b8c7-b7935405cc1d";

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

test.describe("a cloud that doesn't run Manila", () => {
  test("its menu says nothing of it", async ({ page }) => {
    await openCloudPage(page, "", WITHOUT_MANILA);
    await expect(sideMenuLink(page, "Hypervisors").first()).toBeVisible();
    await expect(sideMenuLink(page, "Shares")).toHaveCount(0);
  });

  test("nor does its Services page, or what it is offered to alert on", async ({
    page,
  }) => {
    await openCloudPage(page, "services", WITHOUT_MANILA);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("Shared File Systems (Manila)")).toHaveCount(0);

    await openCloudPage(page, "recommendations", WITHOUT_MANILA);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Share in Error")).toHaveCount(0);
  });

  test("an old link says it doesn't run it, and is no error", async ({
    page,
  }) => {
    await openCloudPage(page, "shares", WITHOUT_MANILA);
    await expect(
      page.getByText("This cloud doesn't run this service"),
    ).toBeVisible();
  });
});

test.describe("a cloud that runs Manila", () => {
  test("gets its shares under Storage", async ({ page }) => {
    await openCloudPage(page, "", BASELINE);
    await expect(sideMenuLink(page, "Shares").first()).toBeVisible();
  });

  test("a share in error reaches Needs attention by name, and lands on its page", async ({
    page,
  }) => {
    await openCloudPage(page, "", STUCK);
    const card: Locator = needsAttention(page);
    await expect(card.getByText("ou-share-error")).toBeVisible();
    await expect(card.getByText("ou-share-payments")).toHaveCount(0);

    await card.getByRole("link", { name: /ou-share-error/ }).click();
    await expect(page.getByTestId("openstack-share-overview")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/shares/${SHARE_IN_ERROR}`));
    await expect(page.getByTestId("openstack-share-explanation")).toContainText(
      "until someone deals with it",
    );
    await screenshot(page, "share-in-error");
  });

  test("the list holds every project's, each in Manila's word", async ({
    page,
  }) => {
    await openCloudPage(page, "shares", STUCK);
    const row: Locator = page
      .locator("tr", { hasText: "ou-share-stuck" })
      .first();
    await expect(row).toContainText("creating");
    await expect(
      page.locator("tr", { hasText: "ou-share-error" }).first(),
    ).toContainText("error");
    await screenshot(page, "shares");
  });

  test("its API stopped is what needs someone", async ({ page }) => {
    await openCloudPage(page, "", API_DOWN);
    await expect(
      needsAttention(page).getByText("Shared File Systems (Manila)"),
    ).toBeVisible();
  });

  test("the Services page says a stopped service shows nowhere here", async ({
    page,
  }) => {
    await openCloudPage(page, "services", BASELINE);
    await expect(
      page.getByTestId("openstack-service-group-workers-not-listed"),
    ).toContainText("a stopped one isn't shown anywhere here");
  });

  test("Topology draws its shares under Storage", async ({ page }) => {
    await openCloudPage(page, "topology", STUCK);
    await expect(page.getByText("Storage").first()).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`shares and a share's page fit at ${viewport.width} pixels`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await openCloudPage(page, "shares", STUCK);
      await expect(page.getByText("ou-share-error").first()).toBeVisible();
      await expectNoSidewaysScroll(page);

      await page.goto(`${partPath("shares", SHARE_IN_ERROR)}?${STUCK}`);
      await expect(page.getByTestId("openstack-share-overview")).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }
});
