import { Locator, Page } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import {
  FixtureRecord,
  expect,
  fixtureRecord,
  openCloudPage,
  partPath,
  screenshot,
  test,
} from "./Helpers";

/*
 * What is really busy, as apart from what is promised, in a real browser through the real router:
 * a hypervisor past its line naming the instances responsible, the step to the busiest one's page,
 * and what a page says with no source at all.
 *
 * `?estate=usage` is made up to put a hypervisor over a line. What real clouds really said goes
 * through these same pages in OpenStackUsagePagesRecordings.test.tsx, and the jsdom suite
 * OpenStackUsagePages.test.tsx holds each page's every state. What these add is what only a browser
 * shows: that the links land, that it fits a phone, and that a walk reads nothing the fixture doesn't
 * answer as the server would.
 */

const USAGE: string = "estate=usage";
const CALM: string = "estate=calm";
const NOISY_HOST: string = "RegionOne/compute-01.acme.example";

async function openHypervisor(page: Page, query: string): Promise<void> {
  await page.goto(`${partPath("hypervisors", NOISY_HOST)}?${query}`);
}

function busiestOf(page: Page): Locator {
  return page.getByTestId("openstack-hypervisor-busiest-instance");
}

test.describe("a hypervisor past its line", () => {
  test("says so, and names the instance responsible, using nearly all of what it really has", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHypervisor(page, USAGE);

    await expect(
      page.getByTestId("openstack-hypervisor-over-line"),
    ).toContainText("instances responsible are named below");

    const usage: Locator = page.getByTestId("openstack-hypervisor-usage");
    await expect(usage).toContainText("CPU used by instances");
    await expect(usage).toContainText("31.2 CPU threads in use");

    await expect(busiestOf(page).first()).toContainText(
      "29.4 CPU threads, of 32 vCPUs it was given",
    );
    await screenshot(page, "openstack-hypervisor-usage-over-line");
  });

  test("names what is promised beside it, which is never what is busy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHypervisor(page, USAGE);
    await expect(page.getByTestId("openstack-hypervisor-tiles")).toContainText(
      "vCPUs allocated",
    );
    await expect(
      page.getByTestId("openstack-hypervisor-tiles"),
    ).not.toContainText("CPU used by instances");
  });

  test("names an instance made to wait, as well as the one making it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHypervisor(page, USAGE);
    await expect(
      busiestOf(page).filter({ hasText: "waiting 23%" }).first(),
    ).toBeVisible();
  });

  test("its Metrics tab charts what is used beside what is promised", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHypervisor(page, USAGE);
    await page.getByRole("tab", { name: "Metrics" }).click();
    await expect
      .poll(async (): Promise<Array<string | undefined>> => {
        const record: FixtureRecord = await fixtureRecord(page);
        return record.aggregateRequests.map(
          (request: FixtureRecord["aggregateRequests"][number]) => {
            return request.name;
          },
        );
      })
      .toEqual(
        expect.arrayContaining([
          "openstack.hypervisor.instances.cpu.utilization",
          "openstack.hypervisor.instances.memory.utilization",
          "openstack_placement_resource_usage",
        ]),
      );
  });

  test("fits a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHypervisor(page, USAGE);
    await expect(busiestOf(page).first()).toBeVisible();
    await expectNoSidewaysScroll(page, {
      message: "a hypervisor's usage, on a phone",
    });
    await screenshot(page, "openstack-hypervisor-usage-phone");
  });

  test("reads in the dark", async ({ page }: { page: Page }) => {
    await openHypervisor(page, `${USAGE}&theme=dark`);
    await expect(busiestOf(page).first()).toBeVisible();
    await screenshot(page, "openstack-hypervisor-usage-dark");
  });
});

test.describe("the busiest instance", () => {
  async function openBusiest(page: Page): Promise<void> {
    await openHypervisor(page, USAGE);
    await busiestOf(page).first().getByRole("link").click();
    await expect(page).toHaveURL(/\/instances\/[^/]+/);
    await expect(page.getByTestId("openstack-instance-usage")).toBeVisible();
  }

  test("is a step from its hypervisor, and shows all of it beside what its flavor promised", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBusiest(page);
    const usage: Locator = page.getByTestId("openstack-instance-usage");
    await expect(usage).toContainText("92%");
    await expect(usage).toContainText("from its flavor");
    // Its two disks, and its slowest one's latency.
    await expect(usage).toContainText("Disk throughput");
    await expect(usage).toContainText("64.0 ms");
    await expect(usage).toContainText("Network throughput");
    await screenshot(page, "openstack-instance-usage");
  });

  test("its Usage tab charts CPU, memory, disk and network beside its flavor's size", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openBusiest(page);
    await page.getByRole("tab", { name: "Usage" }).click();
    await expect(
      page.getByTestId("openstack-instance-usage-flavor"),
    ).toContainText("promises it");
    await expect
      .poll(async (): Promise<Array<string | undefined>> => {
        const record: FixtureRecord = await fixtureRecord(page);
        return record.aggregateRequests.map(
          (request: FixtureRecord["aggregateRequests"][number]) => {
            return request.name;
          },
        );
      })
      .toEqual(
        expect.arrayContaining([
          "openstack.instance.cpu.utilization",
          "openstack.instance.memory.usage",
          "openstack.instance.disk.write.rate",
          "openstack.instance.network.transmit.rate",
        ]),
      );
    await screenshot(page, "openstack-instance-usage-charts");
  });

  test("fits a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBusiest(page);
    await expectNoSidewaysScroll(page, {
      message: "an instance's usage, on a phone",
    });
  });
});

test.describe("with no source", () => {
  test("a hypervisor's page says what is missing and how to add it, and shows no usage", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHypervisor(page, CALM);
    await expect(
      page.getByTestId("openstack-hypervisor-usage-missing"),
    ).toContainText("prometheus-libvirt-exporter");
    await expect(page.getByTestId("openstack-hypervisor-usage")).toHaveCount(0);
  });

  test("an instance's page says the same, on its Usage tab too, with no empty frames", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", CALM);
    const row: Locator = page.locator("tr", { hasText: "ACTIVE" }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /view/i }).first().click();

    await expect(
      page.getByTestId("openstack-instance-usage-missing"),
    ).toContainText("prometheus-libvirt-exporter");

    await page.getByRole("tab", { name: "Usage" }).click();
    await expect(
      page.getByTestId("openstack-instance-usage-charts-missing"),
    ).toContainText("prometheus-libvirt-exporter");
  });
});

test.describe("what it costs", () => {
  test("a cloud's Settings say so on its own size, and only ask which projects once that is the choice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "settings", CALM);
    const card: Locator = page.getByTestId("openstack-instance-metrics-card");
    await expect(card).toBeVisible();
    await expect(
      page.getByTestId("openstack-instance-metrics-cost"),
    ).toContainText("rows an hour");
    await expect(
      page.getByTestId("openstack-instance-metrics-selection"),
    ).toHaveCount(0);
    await screenshot(page, "openstack-instance-metrics-settings");
  });
});
