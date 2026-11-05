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
 * Designate in a real browser through the real router, on what a real stable/2026.1 DevStack recorded
 * (Common/Tests/Fixtures/OpenStack/services-designate-barbican-swift). What these add to the jsdom suite
 * (OpenStackDesignatePages.test.tsx) is what only a browser shows: that the menu really has the entry or really
 * doesn't, that each link really lands, and that every page fits a phone.
 */

const WITHOUT_DESIGNATE: string = "recording=gazpacho-ovs/healthy";
const FAILED: string =
  "recording=services-designate-barbican-swift/designate-error";
const API_STOPPED: string =
  "recording=services-designate-barbican-swift/designate-api-down";
const REFUSED: string =
  "recording=services-designate-barbican-swift/access/reader";

const ZONE_IN_ERROR: string = "f5201d9a-2f25-4b1c-a253-405f7f357742";

function sideMenuLink(page: Page, name: string): Locator {
  return page.getByRole("link", { name, exact: false });
}

function needsAttention(page: Page): Locator {
  return page.getByTestId("openstack-needs-attention");
}

test.describe("a cloud that doesn't run Designate", () => {
  test("its menu, its Services page and what it can alert on say nothing of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", WITHOUT_DESIGNATE);
    await expect(sideMenuLink(page, "Hypervisors").first()).toBeVisible();
    await expect(sideMenuLink(page, "DNS Zones")).toHaveCount(0);

    await openCloudPage(page, "services", WITHOUT_DESIGNATE);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("DNS (Designate)")).toHaveCount(0);

    await openCloudPage(page, "recommendations", WITHOUT_DESIGNATE);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("DNS Zone in Error")).toHaveCount(0);
  });

  test("an old link says it doesn't run it, and is no error", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "dns-zones", WITHOUT_DESIGNATE);
    await expect(
      page.getByText("This cloud doesn't run this service"),
    ).toBeVisible();
  });
});

test.describe("a cloud that runs Designate", () => {
  test("a zone in error reaches Needs attention by name, and lands on its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", FAILED);
    await expect(sideMenuLink(page, "DNS Zones").first()).toBeVisible();

    const card: Locator = needsAttention(page);
    await expect(card.getByText("ou-error.example.org.")).toBeVisible();

    await card.getByRole("link", { name: /ou-error\.example\.org/ }).click();
    await expect(page.getByTestId("openstack-dns-zone-overview")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/dns-zones/${ZONE_IN_ERROR}`));
    await screenshot(page, "dns-zone-in-error");
  });

  test("a recordset in error reaches Needs attention by name, and lands on its zone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", FAILED);

    const card: Locator = needsAttention(page);
    await card
      .getByRole("link", { name: /error\.ou-active\.example\.org/ })
      .click();
    await expect(page.getByTestId("openstack-dns-zone-overview")).toBeVisible();
    await expect(
      page.getByText("error.ou-active.example.org.").first(),
    ).toBeVisible();
  });

  test("the list says what each is, in Designate's word", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "dns-zones", FAILED);
    const row: Locator = page
      .locator("tr", { hasText: "ou-error.example.org." })
      .first();
    await expect(row).toContainText("ERROR");
    await screenshot(page, "dns-zones");
  });

  test("Topology draws its zones", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "topology", FAILED);
    await expect(
      page.getByRole("button", { name: /ou-error\.example\.org/ }).first(),
    ).toBeVisible();
  });

  for (const viewport of VIEWPORTS) {
    test(`DNS Zones and a zone's page fit at ${viewport.width} pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await openCloudPage(page, "dns-zones", FAILED);
      await expect(
        page.getByText("ou-error.example.org.").first(),
      ).toBeVisible();
      await expectNoSidewaysScroll(page, { tolerance: 1 });

      await page.goto(`${partPath("dns-zones", ZONE_IN_ERROR)}?${FAILED}`);
      await expect(
        page.getByTestId("openstack-dns-zone-overview"),
      ).toBeVisible();
      await expectNoSidewaysScroll(page, { tolerance: 1 });
    });
  }
});

test.describe("a credential Designate refuses", () => {
  test("isn't read as down, nor offered alerts that could only say so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", REFUSED);
    await expect(needsAttention(page).getByText("DNS (Designate)")).toHaveCount(
      0,
    );

    await openCloudPage(page, "services", REFUSED);
    await expect(page.getByTestId("openstack-access-notice")).toContainText(
      "This credential has never read Designate",
    );

    await openCloudPage(page, "recommendations", REFUSED);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("DNS Zone in Error")).toHaveCount(0);
  });
});

test.describe("its API stopped, which a real exporter can't tell from a cloud without it", () => {
  test("a recording of one, and nothing else, shows no trace of it, as a cloud without one does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "services", API_STOPPED);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("DNS (Designate)")).toHaveCount(0);
  });
});
