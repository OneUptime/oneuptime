import { Locator, Page } from "@playwright/test";
import { VIEWPORTS, expect, openCloudPage, screenshot, test } from "./Helpers";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * Telling people about a cloud, in a real browser: what a status page would make is read before anything
 * is, a notice is off until its preview, and a host's page says what a disable means. Over a recording, so
 * the regions and services are what a real cloud said. What the server decides is held by its own tests:
 * here, what a page asks of it and what it shows.
 */

interface WriteRequest {
  method?: string;
  url?: string;
  body?: Record<string, unknown>;
}

const RECORDING: string = "recording=gazpacho-ovs/healthy";

// What a page asked the server, which is where anything being made or turned on would show.
async function writesOf(page: Page): Promise<Array<WriteRequest>> {
  return await page.evaluate((): Array<WriteRequest> => {
    return (
      window as unknown as {
        __openStackPagesFixture: { apiRequests: Array<WriteRequest> };
      }
    ).__openStackPagesFixture.apiRequests;
  });
}

async function makes(page: Page, route: string): Promise<number> {
  return (await writesOf(page)).filter((request: WriteRequest): boolean => {
    return Boolean(request.url?.includes(route));
  }).length;
}

test.describe("a status page for this cloud, in one step", () => {
  test("shows what it will create, and creates nothing until told to", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "status-pages", RECORDING);

    const card: Locator = page.getByTestId("openstack-status-page-card");
    await expect(card).toBeAttached();
    await page.getByRole("button", { name: "Create Status Page" }).click();

    const plan: Locator = page.getByTestId("openstack-status-page-plan");
    await expect(plan).toBeVisible();
    await expect(plan).toContainText("RegionOne");

    for (const service of [
      "Compute",
      "Networking",
      "Block Storage",
      "Images",
      "Identity",
    ]) {
      await expect(plan).toContainText(service);
    }

    await expect(plan).toContainText("Will be created");
    // The page asks for the plan, and nothing has been made.
    expect(await makes(page, "/make-status-page/")).toBe(0);

    await page.getByTestId("openstack-status-page-name").fill("Our cloud");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByTestId("openstack-status-page-made")).toContainText(
      "Your status page is ready",
    );

    const made: Array<WriteRequest> = (await writesOf(page)).filter(
      (request: WriteRequest): boolean => {
        return Boolean(request.url?.includes("/make-status-page/"));
      },
    );
    expect(made).toHaveLength(1);
    // Private unless someone says otherwise, and held to what was shown.
    expect(made[0]!.body?.["isPublic"]).toBe(false);
    expect(made[0]!.body?.["name"]).toBe("Our cloud");
    expect(String(made[0]!.body?.["planKey"])).toContain("RegionOne");
  });

  test("a cloud without a service shows no trace of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "status-pages", `${RECORDING}&without=volume`);

    await page.getByRole("button", { name: "Create Status Page" }).click();

    const plan: Locator = page.getByTestId("openstack-status-page-plan");
    await expect(plan).toContainText("Compute");
    await expect(plan).not.toContainText("Block Storage");
  });

  test("objectives say what they are before they are made", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "status-pages", RECORDING);

    await page.getByRole("button", { name: "Create Objectives" }).click();
    await expect(page.getByTestId("openstack-status-page-plan")).toBeVisible();
    expect(await makes(page, "/make-objectives/")).toBe(0);

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByTestId("openstack-objectives-made")).toContainText(
      "5 objectives created",
    );
  });
});

test.describe("a project notice", () => {
  async function addNotice(page: Page): Promise<void> {
    await page
      .getByTestId("openstack-project-notices")
      .getByRole("button", { name: /Create/ })
      .first()
      .click();

    const form: Locator = page.getByRole("dialog");
    await form.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "ou-payments" }).first().click();
    await form.getByPlaceholder("ops@example.com").fill("ops@example.com");
    await form
      .getByRole("button", { name: /Create|Save/ })
      .last()
      .click();
  }

  test("starts off, and turning it on goes through who it tells", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "status-pages", RECORDING);

    const notices: Locator = page.getByTestId("openstack-project-notices");
    await expect(notices).toContainText("Nobody is told anything yet");

    await addNotice(page);

    await expect(page.getByTestId("openstack-notice-recipient")).toContainText(
      "ops@example.com",
    );
    await expect(notices).toContainText("Off");
    // Nothing a row could send has been asked for by adding it.
    expect(await makes(page, "/turn-on/")).toBe(0);

    await notices.getByRole("button", { name: /Turn On/ }).click();

    const preview: Locator = page.getByTestId("openstack-notice-preview");
    await expect(preview).toContainText("ops@example.com");
    await expect(preview).toContainText("ou-payments");
    await expect(page.getByRole("dialog")).toContainText(
      "Nothing has been sent",
    );
    await expect(page.getByRole("dialog")).toContainText("has an incident");
    // Looking at it doesn't turn it on.
    expect(await makes(page, "/turn-on/")).toBe(0);

    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Turn On", exact: true })
      .click();

    await expect(notices).toContainText("On");
    const turnedOn: Array<WriteRequest> = (await writesOf(page)).filter(
      (request: WriteRequest): boolean => {
        return Boolean(request.url?.includes("/turn-on/"));
      },
    );
    expect(turnedOn).toHaveLength(1);
    expect(turnedOn[0]!.body?.["previewToken"]).toBe(
      "the-token-its-preview-gave",
    );
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: VIEWPORTS[VIEWPORTS.length - 1]! });

  test("the page and its plan fit", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "status-pages", RECORDING);
    await page.getByRole("button", { name: "Create Status Page" }).click();
    await expect(page.getByTestId("openstack-status-page-plan")).toBeVisible();
    await screenshot(page, "openstack-status-pages-plan-mobile");

    await expectNoSidewaysScroll(page, { tolerance: 1 });
  });
});

test.describe("a hypervisor's page", () => {
  test("says who a maintenance event on it would tell", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "hypervisors", RECORDING);
    await page.locator("tbody tr").first().click();
    await expect(page).toHaveURL(/\/hypervisors\/[^/]+/);

    const card: Locator = page.getByTestId("openstack-hypervisor-planned-work");
    await expect(card).toContainText("Planned Work");
    await expect(card).toContainText("It reaches 3 instances in 2 projects");
    await expect(card).toContainText("Nobody would be told");
    await expect(
      page.getByRole("button", { name: "Schedule Maintenance" }),
    ).toBeVisible();
  });

  test("a disabled host with no event on it says nobody has explained it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "hypervisors",
      "recording=gazpacho-ovs/compute-disabled",
    );
    await page.locator("tbody tr").first().click();
    await expect(page).toHaveURL(/\/hypervisors\/[^/]+/);

    await expect(
      page.getByTestId("openstack-hypervisor-planned-work-disabled"),
    ).toContainText("no maintenance event covering this host");
  });

  test("the same host during an event reads as expected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "hypervisors",
      "recording=gazpacho-ovs/compute-disabled&maintenance=on",
    );
    await page.locator("tbody tr").first().click();
    await expect(page).toHaveURL(/\/hypervisors\/[^/]+/);

    await expect(
      page.getByTestId("openstack-hypervisor-planned-work-disabled"),
    ).toContainText("which is expected");
  });
});
