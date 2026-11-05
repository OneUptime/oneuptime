import { Locator, Page } from "@playwright/test";
import { CLOUD_PATH, expect, screenshot, test } from "./Helpers";

/*
 * A CLOUD THAT BRINGS ITS OWN EXPORTER GETS THE SAME PAGES, AS FAR AS THAT EXPORTER GOES.
 *
 * The agent can read an exporter a cloud already runs, and Kolla-Ansible's is 1.7.0, which says
 * less than the one the agent pins. Every page here reads what those two exporters said of one
 * real cloud at one moment, through the real scan. OpenStackExporterStablePages.test.ts holds
 * the rows to the guide's table of what goes missing: this holds what a person sees of that.
 * A page may have less to say. It may never say something false because of it.
 */

const PINNED: string = "recording=gazpacho-ovs/healthy";
const KOLLAS: string = "recording=gazpacho-ovs/healthy@1.7.0";

async function open(page: Page, path: string, query: string): Promise<void> {
  await page.goto(`${CLOUD_PATH}${path}?${query}`);
}

function tile(page: Page, title: string): Locator {
  return page
    .getByTestId("openstack-overview-capacity")
    .locator("div.rounded-xl", {
      has: page.locator('[data-testid="golden-metric-tile-title"]', {
        hasText: title,
      }),
    });
}

async function openOverview(page: Page, query: string): Promise<void> {
  await open(page, "", query);
  await expect(
    page.getByTestId("openstack-overview-data-status"),
  ).toBeVisible();
}

test.describe("the Overview", () => {
  test("on the agent's own exporter, the whole cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, PINNED);

    await expect(tile(page, "Control plane")).toContainText("6/6");
    await expect(tile(page, "Storage used")).toContainText("0%");
    await expect(page.getByTestId("openstack-needs-attention-name")).toHaveText(
      ["ou-vol-bad", "ou-failed"],
    );
  });

  test("on 1.7.0, the same cloud without Cinder, and nothing said to be wrong because of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, KOLLAS);

    // What it still reads is what the other one read.
    await expect(tile(page, "Hypervisors")).toContainText("1/1");
    await expect(tile(page, "vCPUs allocated")).toContainText("19%");
    await expect(tile(page, "Memory allocated")).toContainText("2%");

    // Five APIs, every one of them up: Cinder's is not called down.
    await expect(tile(page, "Control plane")).toContainText("5/5");
    await expect(tile(page, "Storage used")).toContainText("Not reported yet");
    await expect(page.getByText("Block Storage (Cinder)")).toHaveCount(0);

    // The instance the estate failed still shows. The volume it failed cannot.
    await expect(page.getByTestId("openstack-needs-attention-name")).toHaveText(
      ["ou-failed"],
    );

    // No credential is blamed for what the exporter does not say.
    await expect(page.getByTestId("openstack-access-notice")).toHaveCount(0);

    await screenshot(page, "exporter-170-overview");
  });
});

test.describe("each list, on 1.7.0", () => {
  test("Services keeps every worker it can read, and has no Cinder", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/services", KOLLAS);

    await expect(page.getByText("nova-compute").first()).toBeVisible();
    await expect(page.getByText("neutron-l3-agent").first()).toBeVisible();
    await expect(page.getByText("cinder-volume")).toHaveCount(0);
    await expect(page.getByText("cinder-scheduler")).toHaveCount(0);
  });

  test("Hypervisors keeps what Placement says, and drops the one column it has nothing for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/hypervisors", KOLLAS);

    await expect(page.getByText("compute-01.example.internal")).toBeVisible();
    await expect(page.getByText("3 of 16 (19%)")).toBeVisible();

    await open(page, "/hypervisors", PINNED);

    await expect(page.getByText("3 of 16 (19%)")).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /Instanc/ }),
    ).toBeVisible();
  });

  test("Instances are all there", async ({ page }: { page: Page }) => {
    await open(page, "/instances", KOLLAS);

    for (const name of ["ou-running", "ou-stopped", "ou-failed"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("Images are there, with a dash for what it does not say", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/images", KOLLAS);

    await expect(page.getByText(/^cirros/)).toBeVisible();
  });

  test("Volumes say nothing is reported, and never that the cloud has none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "/volumes", KOLLAS);

    await expect(page.getByText("No volumes reported yet")).toBeVisible();
  });

  test("Storage pools say the same", async ({ page }: { page: Page }) => {
    await open(page, "/storage-pools", KOLLAS);

    await expect(page.getByText("No storage pools reported yet")).toBeVisible();
  });
});
