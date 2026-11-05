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
 * Trove in a real browser through the real router, on what a real stable/2026.1 DevStack recorded
 * (Common/Tests/Fixtures/OpenStack/services-trove). What these add to the jsdom suite
 * (OpenStackTrovePages.test.tsx) is what only a browser shows: that the menu really has the entry or really
 * doesn't, that each link really lands, and that every page fits a phone.
 */

const WITHOUT_TROVE: string = "recording=gazpacho-ovs/healthy";
const FAILED: string = "recording=services-trove/instance-error";
const API_DOWN: string = "recording=services-trove/api-down";
const REFUSED: string = "recording=services-trove/access/reader";

const DATABASE_IN_ERROR: string = "05c54197-08e7-4989-a5b2-dda7b57eb018";

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

function sideMenuLink(page: Page, name: string): Locator {
  return page.getByRole("link", { name, exact: false });
}

function needsAttention(page: Page): Locator {
  return page.getByTestId("openstack-needs-attention");
}

test.describe("a cloud that doesn't run Trove", () => {
  test("its menu, its Services page and what it can alert on say nothing of it", async ({
    page,
  }) => {
    await openCloudPage(page, "", WITHOUT_TROVE);
    await expect(sideMenuLink(page, "Hypervisors").first()).toBeVisible();
    await expect(sideMenuLink(page, "Databases")).toHaveCount(0);

    await openCloudPage(page, "services", WITHOUT_TROVE);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("Databases (Trove)")).toHaveCount(0);

    await openCloudPage(page, "recommendations", WITHOUT_TROVE);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Database Instance in Error")).toHaveCount(0);
  });

  test("an old link says it doesn't run it, and is no error", async ({
    page,
  }) => {
    await openCloudPage(page, "databases", WITHOUT_TROVE);
    await expect(
      page.getByText("This cloud doesn't run this service"),
    ).toBeVisible();
  });
});

test.describe("a cloud that runs Trove", () => {
  test("a database in error reaches Needs attention by name, and lands on its page", async ({
    page,
  }) => {
    await openCloudPage(page, "", FAILED);
    await expect(sideMenuLink(page, "Databases").first()).toBeVisible();

    const card: Locator = needsAttention(page);
    await expect(card.getByText("ou-db-no-host")).toBeVisible();

    await card.getByRole("link", { name: /ou-db-no-host/ }).click();
    await expect(
      page.getByTestId("openstack-database-instance-overview"),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/databases/${DATABASE_IN_ERROR}`));
    await screenshot(page, "database-in-error");
  });

  test("the list says what each runs, in Trove's word", async ({ page }) => {
    await openCloudPage(page, "databases", FAILED);
    const row: Locator = page
      .locator("tr", { hasText: "ou-db-no-host" })
      .first();
    await expect(row).toContainText("ERROR");
    await expect(row).toContainText("mysql 8.4");
    await screenshot(page, "databases");
  });

  test("Topology draws its databases in a section of their own", async ({
    page,
  }) => {
    await openCloudPage(page, "topology", FAILED);
    await expect(page.getByText("Databases").first()).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`databases and a database's page fit at ${viewport.width} pixels`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await openCloudPage(page, "databases", FAILED);
      await expect(page.getByText("ou-db-no-host").first()).toBeVisible();
      await expectNoSidewaysScroll(page);

      await page.goto(`${partPath("databases", DATABASE_IN_ERROR)}?${FAILED}`);
      await expect(
        page.getByTestId("openstack-database-instance-overview"),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }
});

test.describe("a credential Trove refuses, which reads just as its API stopped does", () => {
  test("isn't read as down, nor offered alerts that could only say so", async ({
    page,
  }) => {
    await openCloudPage(page, "", REFUSED);
    await expect(
      needsAttention(page).getByText("Databases (Trove)"),
    ).toHaveCount(0);

    await openCloudPage(page, "services", REFUSED);
    await expect(page.getByTestId("openstack-access-notice")).toContainText(
      "This credential has never read Trove",
    );

    await openCloudPage(page, "recommendations", REFUSED);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Databases API Down")).toHaveCount(0);
  });

  test("its list says so too", async ({ page }) => {
    await openCloudPage(page, "databases", REFUSED);
    await expect(
      page.getByText("This credential has never read this service"),
    ).toBeVisible();
  });
});

test.describe("its API stopped, once it has been read", () => {
  test("what a real stopped API says on its own is the same as a refusal, so it reads closed until a row has answered", async ({
    page,
  }) => {
    await openCloudPage(page, "services", API_DOWN);
    await expect(page.getByText("Databases (Trove)").first()).toBeVisible();
  });
});
