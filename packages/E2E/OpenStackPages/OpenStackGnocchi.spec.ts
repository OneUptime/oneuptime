import { Locator, Page } from "@playwright/test";
import { VIEWPORTS, expect, openCloudPage, partPath, test } from "./Helpers";

/*
 * Gnocchi in a real browser through the real router, on what a real stable/2026.1 DevStack recorded
 * (Common/Tests/Fixtures/OpenStack/services-gnocchi). What these add to the jsdom suite is what only a browser
 * shows: that Services really has it or really doesn't, that its link lands, and that its page fits a phone.
 */

const WITHOUT_GNOCCHI: string = "recording=gazpacho-ovs/healthy";
const STOPPED: string = "recording=services-gnocchi/metricd-stopped";
const REFUSED: string = "recording=services-gnocchi/access/reader";

const API: string = "RegionOne/gnocchi";

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

test.describe("a cloud that doesn't run Gnocchi", () => {
  test("its Services page and what it can alert on say nothing of it", async ({
    page,
  }) => {
    await openCloudPage(page, "services", WITHOUT_GNOCCHI);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("Metrics (Gnocchi)")).toHaveCount(0);

    await openCloudPage(page, "recommendations", WITHOUT_GNOCCHI);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Gnocchi No Processors")).toHaveCount(0);
  });
});

test.describe("a cloud whose gnocchi-metricd stopped", () => {
  test("reaches Needs attention, and lands on its API's page, which says why", async ({
    page,
  }) => {
    await openCloudPage(page, "", STOPPED);

    const card: Locator = needsAttention(page);
    await expect(card.getByText("Metrics (Gnocchi)")).toBeVisible();
    await card.getByRole("link", { name: /Metrics \(Gnocchi\)/ }).click();

    await expect(page.getByTestId("openstack-service-tiles")).toContainText(
      "Processors",
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`its API's page fits at ${viewport.width} pixels`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.goto(`${partPath("services", API)}?${STOPPED}`);
      await expect(page.getByTestId("openstack-service-tiles")).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }
});

test.describe("a credential Gnocchi refuses", () => {
  test("isn't read as down, nor offered alerts that could only say so", async ({
    page,
  }) => {
    await openCloudPage(page, "", REFUSED);
    await expect(
      needsAttention(page).getByText("Metrics (Gnocchi)"),
    ).toHaveCount(0);

    await openCloudPage(page, "services", REFUSED);
    await expect(page.getByTestId("openstack-access-notice")).toContainText(
      "This credential has never read Gnocchi",
    );
  });
});
