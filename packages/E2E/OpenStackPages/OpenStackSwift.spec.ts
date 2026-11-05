import { Locator, Page } from "@playwright/test";
import {
  VIEWPORTS,
  expect,
  openCloudPage,
  partPath,
  screenshot,
  test,
} from "./Helpers";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Swift in a real browser through the real router, on what a real stable/2026.1 DevStack recorded
 * (Common/Tests/Fixtures/OpenStack/services-designate-barbican-swift). What these add to the jsdom suite
 * (OpenStackSwiftPages.test.tsx) is what only a browser shows: that the menu really has the entry or really doesn't,
 * that each link really lands, and that every page fits a phone.
 */

const WITHOUT_SWIFT: string = "recording=gazpacho-ovs/healthy";
const RUNNING: string =
  "recording=services-designate-barbican-swift/swift-object-down";
const REFUSED: string =
  "recording=services-designate-barbican-swift/access/reader";

const CONTAINER: string = "RegionOne/ou-container-admin";

function sideMenuLink(page: Page, name: string): Locator {
  return page.getByRole("link", { name, exact: false });
}

test.describe("a cloud that doesn't run Swift", () => {
  test("its menu, its Services page and what it can alert on say nothing of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", WITHOUT_SWIFT);
    await expect(sideMenuLink(page, "Hypervisors").first()).toBeVisible();
    await expect(sideMenuLink(page, "Object Storage")).toHaveCount(0);

    await openCloudPage(page, "services", WITHOUT_SWIFT);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("Object Storage (Swift)")).toHaveCount(0);

    await openCloudPage(page, "recommendations", WITHOUT_SWIFT);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(
      page.getByText("Object Container Growth Forecast"),
    ).toHaveCount(0);
  });

  test("an old link says it doesn't run it, and is no error", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "object-containers", WITHOUT_SWIFT);
    await expect(
      page.getByText("This cloud doesn't run this service"),
    ).toBeVisible();
  });
});

test.describe("a cloud that runs Swift", () => {
  test("the list lands on a container's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", RUNNING);
    await sideMenuLink(page, "Object Storage").first().click();

    await page.locator("tr", { hasText: "ou-container-admin" }).first().click();
    await expect(
      page.getByTestId("openstack-object-container-overview"),
    ).toBeVisible();
    await screenshot(page, "object-container");
  });

  test("Topology draws its containers", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "topology", RUNNING);
    await expect(
      page.getByRole("button", { name: /ou-container-admin/ }),
    ).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`Object Storage and a container's page fit at ${viewport.width} pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await openCloudPage(page, "object-containers", RUNNING);
      await expect(page.getByText("ou-container-admin").first()).toBeVisible();
      await expectNoSidewaysScroll(page, { tolerance: 1 });

      await page.goto(`${partPath("object-containers", CONTAINER)}?${RUNNING}`);
      await expect(
        page.getByTestId("openstack-object-container-overview"),
      ).toBeVisible();
      await expectNoSidewaysScroll(page, { tolerance: 1 });
    });
  }
});

test.describe("a credential Swift refuses", () => {
  test("isn't read as down, nor offered alerts that could only say so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "services", REFUSED);
    await expect(page.getByTestId("openstack-access-notice")).toContainText(
      "This credential has never read Swift",
    );

    await openCloudPage(page, "recommendations", REFUSED);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Object Storage API Down")).toHaveCount(0);
  });
});
