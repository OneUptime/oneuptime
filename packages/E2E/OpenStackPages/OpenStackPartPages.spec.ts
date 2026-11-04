import { Locator, Page } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import {
  CLOUD_PATH,
  FixtureRecord,
  expect,
  fixtureRecord,
  openCloudPage,
  partPath,
  screenshot,
  test,
} from "./Helpers";

/*
 * A cloud's parts, in a real browser through the real router: the compute, network and
 * storage lists, the step from a row to its part's page, and the steps between parts (an
 * instance to its hypervisor, a volume to its instance, a floating IP to its router).
 *
 * Whatever a real cloud can say is read off a recording: a stopped nova-compute, a stopped
 * L3 agent, OVN with no L3 agents at all, the snapshot count the exporter keeps. What no
 * recording holds is `?estate=busy` (a full pool, a full external network, a stuck volume)
 * and `?estate=parts` (hosts in zones and aggregates, a stuck image, the probe's rows).
 *
 * The jsdom suites (Common/Tests/App/Dashboard/OpenStack*Pages.test.tsx) hold each page's
 * every state. What these add is what only a browser shows: that the links really land,
 * that a page really fits a phone, and that a whole walk reads nothing the fixture doesn't
 * answer as the server would (Helpers.ts fails the test otherwise).
 */

const BUSY: string = "estate=busy";
const PARTS: string = "estate=parts";
const COMPUTE_DOWN: string = "recording=gazpacho-ovs/compute-down";
const HEALTHY_OVS: string = "recording=gazpacho-ovs/healthy";
const HEALTHY_OVN: string = "recording=hibiscus-ovn/healthy";
const AGENT_DOWN: string = "recording=gazpacho-ovs/network-agent-down";

// A lost host with 42 instances on it, in Fixture/Data.js.
const LOST_HOST: string = "RegionOne/compute-02.acme.example";
const FULL_POOL: string = "RegionOne/ctl-01@lvmdriver-1#lvmdriver-1";
// "ou-failed" in Fixture/Data.js, which sorts past a list's first page.
const FAILED_INSTANCE: string = "2e1cfc3e-0400-4c2e-a4fc-c5cf0f2db585";

async function openPart(
  page: Page,
  listPath: string,
  externalId: string,
  query: string,
): Promise<void> {
  await page.goto(`${partPath(listPath, externalId)}?${query}`);
}

function rowOf(page: Page, name: string): Locator {
  return page.locator("tr", { hasText: name }).first();
}

async function openRow(page: Page, name: string): Promise<void> {
  const row: Locator = rowOf(page, name);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /view/i }).first().click();
}

async function listLimits(page: Page, kind: string): Promise<Array<number>> {
  const record: FixtureRecord = await fixtureRecord(page);
  return record.listRequests
    .filter((request: FixtureRecord["listRequests"][number]): boolean => {
      return (
        request.modelName === "OpenStackResource" &&
        request.query?.["kind"] === kind
      );
    })
    .map((request: FixtureRecord["listRequests"][number]): number => {
      return request.limit || 0;
    });
}

test.describe("compute", () => {
  test("a stopped nova-compute: the list says Lost, and its page what it takes with it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "hypervisors", COMPUTE_DOWN);

    const lost: Locator = page.locator("tr", { hasText: "Lost" }).first();
    await expect(lost).toBeVisible();
    await screenshot(page, "openstack-hypervisors-list");
    await lost.getByRole("button", { name: /view/i }).first().click();

    await expect(page).toHaveURL(/\/hypervisors\/[^/]+/);
    await expect(page.getByTestId("openstack-hypervisor-lost")).toBeVisible();
    await expect(
      page.getByTestId("openstack-hypervisor-hero-status"),
    ).toHaveText("Lost");

    // Its numbers are the last Nova had, and never read as room.
    await expect(page.getByTestId("openstack-hypervisor-tiles")).toContainText(
      "last known",
    );
    await expect(
      page.getByTestId("openstack-hypervisor-attention-item").first(),
    ).toContainText(/Down, with \d+ instances? on it/);
    await expect(
      page.getByTestId("openstack-hypervisor-blast-counts"),
    ).toContainText(/instance/);

    await screenshot(page, "openstack-hypervisor-lost");
  });

  test("a lost host's page: how many, whose, what is open on it across Nova's two names, and alerts to turn on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", LOST_HOST, BUSY);

    const blast: Locator = page.getByTestId("openstack-hypervisor-blast");
    await expect(
      blast.getByTestId("openstack-hypervisor-blast-counts"),
    ).toContainText("42 instances");
    await expect(blast).toContainText("acme-payments");

    // The incident says compute-02, and this hypervisor compute-02.acme.example.
    await expect(page.getByTestId("openstack-hypervisor-open")).toContainText(
      "Compute Service Down",
    );

    const alerts: Locator = page.getByTestId("openstack-hypervisor-alerts");
    const turnOn: Locator = alerts.getByTestId(
      "openstack-hypervisor-alerts-turn-on",
    );
    await expect(turnOn).toContainText(/Turn on \d+ alerts?/);
    await turnOn.click();
    await expect(page).toHaveURL(/\/recommendations/);
  });

  test("a hypervisor's own agent adds what it is really doing, beside what is promised", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(
      page,
      "hypervisors",
      "RegionOne/compute-03.acme.example",
      BUSY,
    );

    const usage: Locator = page.getByTestId("openstack-hypervisor-host-usage");
    await expect(usage).toBeVisible();
    await expect(usage).toContainText("40");
    await expect(usage).toContainText("62");
    await expect(page.getByTestId("openstack-hypervisor-tiles")).toContainText(
      "vCPUs allocated",
    );
  });

  test("a hypervisor's Metrics tab charts what Placement promises on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(
      page,
      "hypervisors",
      "RegionOne/compute-03.acme.example",
      BUSY,
    );
    await page.getByRole("tab", { name: "Metrics" }).click();
    await expect(
      page.getByText("Hypervisor Metrics: compute-03.acme.example").first(),
    ).toBeVisible();

    await expect
      .poll(async (): Promise<Array<string>> => {
        const record: FixtureRecord = await fixtureRecord(page);
        return record.aggregateRequests.map(
          (request: FixtureRecord["aggregateRequests"][number]): string => {
            return request.name;
          },
        );
      })
      .toContain("openstack_placement_resource_usage");
  });

  test("the failed instance reads as failing before it was placed, and a running one steps to its host and flavor", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", HEALTHY_OVS);

    await openRow(page, "ou-failed");
    await expect(
      page.getByTestId("openstack-instance-explanation"),
    ).toContainText("never placed");
    await expect(page.getByTestId("openstack-instance-hero-status")).toHaveText(
      "ERROR",
    );

    await page.goBack();
    await openRow(page, "ou-running");

    const details: Locator = page.getByTestId("openstack-instance-details");
    await expect(
      details.getByTestId("openstack-instance-details-addresses"),
    ).toContainText("Not collected");
    await expect(
      details.getByTestId("openstack-instance-details-flavor"),
    ).toContainText("ou.tiny");

    await page
      .getByTestId("openstack-instance-hero-location")
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/\/hypervisors\/[^/]+/);
    await expect(page.getByTestId("openstack-hypervisor-hero")).toBeVisible();
  });

  test("an address only the probe has shows in the list once it has said it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", PARTS);
    await expect(rowOf(page, "batch-worker-7")).toContainText("10.77.0.12");
  });

  test("Nova's fault message, which only the probe reads, shows where the reason does", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "instances", FAILED_INSTANCE, PARTS);
    await expect(
      page.getByTestId("openstack-instance-attention"),
    ).toContainText("No valid host was found");
  });

  test("availability zones: each one's hosts and what they can give, with Nova's own left out, and a page for each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "availability-zones", PARTS);

    await expect(rowOf(page, "az-a")).toBeVisible();
    await expect(rowOf(page, "az-b")).toBeVisible();
    await expect(page.locator("tr", { hasText: "internal" })).toHaveCount(0);
    await screenshot(page, "openstack-availability-zones-list");

    await openRow(page, "az-a");
    await expect(page).toHaveURL(/\/availability-zones\/[^/]+/);
    await expect(page.getByTestId("openstack-zone-hero")).toContainText("az-a");
    // Nova's service knows its host by the short name.
    await expect(page.getByTestId("openstack-zone-attention")).toContainText(
      "compute-02",
    );
  });

  test("aggregates: one host in two of them counts in both, and a page lists its own hosts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "aggregates", PARTS);

    await expect(rowOf(page, "gpu")).toBeVisible();
    await expect(rowOf(page, "ssd")).toBeVisible();

    await openRow(page, "gpu");
    await expect(page).toHaveURL(/\/aggregates\/[^/]+/);
    await expect(page.getByTestId("openstack-aggregate-hero")).toContainText(
      "gpu",
    );
    await page.getByRole("tab", { name: "Hypervisors" }).click();
    await expect(rowOf(page, "compute-01.acme.example")).toBeVisible();
    await expect(page.locator("tr", { hasText: "compute-03" })).toHaveCount(0);
  });

  test("a cloud with no aggregates says that is usual", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "aggregates", HEALTHY_OVS);
    await expect(
      page.getByText(/No host aggregates reported/).first(),
    ).toBeVisible();
    await expect(page.getByText(/can't list/)).toHaveCount(0);
  });

  test("an instance steps to its flavor, whose page says how many use it and lists them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", HEALTHY_OVS);
    await openRow(page, "ou-running");

    await page
      .getByTestId("openstack-instance-details-flavor")
      .getByRole("link")
      .click();

    await expect(page).toHaveURL(/\/flavors\/[^/]+/);
    await expect(page.getByTestId("openstack-flavor-tiles")).toContainText(
      "of this flavor",
    );
    await page.getByRole("tab", { name: "Instances" }).click();
    await expect(rowOf(page, "ou-running")).toBeVisible();
  });

  test("a credential that can't list hypervisors says so, with the fix", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "hypervisors", `${BUSY}&access=project`);
    await expect(
      page.getByText("This credential can't list hypervisors").first(),
    ).toBeVisible();
  });
});

test.describe("network", () => {
  test("external pools come first, a full one says so, and its page says what stops working", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "networks", BUSY);

    const tables: Locator = page.locator("table");
    await expect(tables.first()).toContainText("public");
    await expect(tables.first()).not.toContainText("research-net");
    await expect(rowOf(page, "public-dmz")).toContainText("95");
    await screenshot(page, "openstack-networks-list");

    await openRow(page, "public");
    await expect(
      page.getByTestId("openstack-network-explanation"),
    ).toContainText("no addresses left");
    await expect(
      page.getByTestId("openstack-network-attention-item").first(),
    ).toBeVisible();

    await screenshot(page, "openstack-network-full");
  });

  test("a tenant's own full network asks nothing of anyone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "networks", BUSY);
    await openRow(page, "research-net");

    await expect(page.getByTestId("openstack-network-overview")).toBeVisible();
    await expect(
      page.getByTestId("openstack-network-attention-item"),
    ).toHaveCount(0);
  });

  test("an external pool filling up says when it runs out, from its own last day", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "networks", PARTS);
    await expect(rowOf(page, "public-dmz")).toContainText(/~\d+ days?/);
  });

  test("a subnet steps to its network", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "subnets", HEALTHY_OVS);

    const first: Locator = page.locator("tbody tr").first();
    await expect(first).toBeVisible();
    await first.getByRole("button", { name: /view/i }).first().click();

    await expect(page.getByTestId("openstack-subnet-tiles")).toBeVisible();
    await page
      .getByTestId("openstack-subnet-details-network")
      .getByRole("link")
      .click();
    await expect(page.getByTestId("openstack-network-overview")).toBeVisible();
  });

  test("on ML2/OVS a router names its agents, and an address in use steps to its router", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "floating-ips", HEALTHY_OVS);

    const inUse: Locator = page
      .locator("tbody tr", { hasText: "Associated" })
      .first();
    await expect(inUse).toBeVisible();
    await inUse.getByRole("link").first().click();

    await expect(page).toHaveURL(/\/routers\/[^/]+/);
    await expect(page.getByTestId("openstack-router-agents")).toBeVisible();
    await expect(
      page.getByTestId("openstack-router-agent").first(),
    ).toContainText("Alive");
    await expect(page.getByTestId("openstack-router-ovn")).toHaveCount(0);
  });

  test("on OVN a router has no agent to be missing, and nothing is wrong", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "routers", HEALTHY_OVN);

    const first: Locator = page.locator("tbody tr").first();
    await expect(first).toContainText("Not applicable");
    await first.getByRole("button", { name: /view/i }).first().click();

    await expect(page.getByTestId("openstack-router-ovn")).toBeVisible();
    await expect(page.getByTestId("openstack-router-agents")).toHaveCount(0);
    await expect(
      page.getByTestId("openstack-router-attention-item"),
    ).toHaveCount(0);
  });

  test("a stopped L3 agent's page says how far it reaches, and its router's says which agent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "network-agents", AGENT_DOWN);

    const down: Locator = page
      .locator("tbody tr", { hasText: "neutron-l3-agent" })
      .first();
    await expect(down).toBeVisible();
    await down.getByRole("button", { name: /view/i }).first().click();

    await expect(page).toHaveURL(/\/network-agents\/[^/]+/);
    await expect(
      page.getByTestId("openstack-network-agent-hero-location"),
    ).toContainText("On host");
    await page.getByRole("tab", { name: "Routers" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();
  });

  test("a spare address waits, and that is nothing wrong", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "floating-ips", BUSY);
    await openRow(page, "172.24.4.107");

    await expect(page.getByTestId("openstack-floating-ip-spare")).toContainText(
      "nothing is wrong",
    );
    await expect(
      page.getByTestId("openstack-floating-ip-attention-item"),
    ).toHaveCount(0);
  });

  test("an address in use and not active says traffic may not be arriving", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "floating-ips", BUSY);
    await openRow(page, "172.24.4.71");

    await expect(
      page.getByTestId("openstack-floating-ip-explanation"),
    ).toContainText("may not be arriving");
  });

  test("security groups read as a count, and ports say they're off by default", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "networks", HEALTHY_OVS);

    const counts: Locator = page.getByTestId("openstack-network-counts");
    await expect(counts).toContainText("Security Groups");
    await expect(counts).toContainText("6");
    await expect(page.getByTestId("openstack-ports-off")).toBeVisible();
  });
});

test.describe("storage", () => {
  test("a stuck volume reads Stuck and for how long, and its page says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "volumes", BUSY);

    await expect(rowOf(page, "data-attach-1")).toContainText("Stuck");
    await screenshot(page, "openstack-volumes-list");
    await openRow(page, "data-attach-1");

    await expect(
      page.getByTestId("openstack-volume-explanation"),
    ).toContainText("longer than it should take");
    await expect(
      page.getByTestId("openstack-volume-attention-item").first(),
    ).toBeVisible();
  });

  test("a volume steps to the instance holding it, and says what isn't collected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "volumes", HEALTHY_OVS);
    await openRow(page, "ou-vol-used");

    await expect(
      page.getByTestId("openstack-volume-details-pool"),
    ).toContainText("Not collected");

    await page
      .getByTestId("openstack-volume-details-attached-to")
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(/\/instances\/[^/]+/);
    await expect(
      page.getByTestId("openstack-instance-hero-name"),
    ).toContainText("ou-running");
  });

  test("an almost full pool says so, and that it can't list its volumes, never 0", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "storage-pools", FULL_POOL, BUSY);

    await expect(
      page.getByTestId("openstack-storage-pool-explanation"),
    ).toBeVisible();
    await expect(
      page.getByTestId("openstack-storage-pool-attention-item").first(),
    ).toBeVisible();

    await expect(
      page.getByTestId("openstack-storage-pool-tiles"),
    ).toContainText("614 GiB");

    const blast: Locator = page.getByTestId("openstack-storage-pool-blast");
    await expect(blast).toContainText("Nothing collected says which pool");
    await expect(blast).not.toContainText("0 volumes");

    await screenshot(page, "openstack-storage-pool-full");
  });

  test("a pool filling up says when it fills, from its own last day, and a pool on a real cloud has room", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(
      page,
      "storage-pools",
      "RegionOne/ctl-02@ceph#rbd-fast",
      PARTS,
    );
    await expect(
      page.getByTestId("openstack-storage-pool-tiles"),
    ).toContainText(/~\d+ days?/);

    await openCloudPage(page, "storage-pools", HEALTHY_OVS);
    await expect(page.locator("tbody tr").first()).toContainText("Has room");
  });

  test("through the agent: the exporter's count, and no rows, and it says which is which", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "snapshots", HEALTHY_OVS);

    await expect(page.getByTestId("openstack-snapshots-source")).toContainText(
      "counts snapshots per region",
    );
    const tiles: Locator = page.getByTestId("openstack-snapshots-tiles");
    await expect(tiles).toContainText("counted by the agent's exporter");
    await expect(tiles).toContainText("Only a probe reports backups");
    await expect(
      page.getByText("No snapshots listed one by one").first(),
    ).toBeVisible();
  });

  test("through a probe: each one, its volume a step away, and totals per project", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "snapshots", PARTS);

    await expect(rowOf(page, "payments-db-nightly")).toBeVisible();
    await expect(rowOf(page, "payments-db-weekly")).toBeVisible();
    await expect(
      page.getByTestId("openstack-snapshots-by-project"),
    ).toContainText("acme-payments");
    await expect(
      page.getByTestId("openstack-backups-by-project"),
    ).toContainText("acme-payments");
  });

  test("a stuck image is called out, and its page says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "images", PARTS);

    await expect(rowOf(page, "windows-2022-import")).toContainText("Stuck");
    await openRow(page, "windows-2022-import");

    await expect(page.getByTestId("openstack-image-explanation")).toContainText(
      "failed upload",
    );
    await expect(page.getByTestId("openstack-image-details")).toBeVisible();
  });

  test("the volume types over the list come from one count on the server", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "volumes", BUSY);

    await expect(page.getByTestId("openstack-volume-types")).toContainText(
      "lvmdriver-1",
    );
    const record: FixtureRecord = await fixtureRecord(page);
    expect(
      record.apiRequests.filter(
        (request: FixtureRecord["apiRequests"][number]): boolean => {
          return request.url.includes("/openstack-resource/counts/");
        },
      ).length,
    ).toBeGreaterThan(0);
  });
});

test.describe("a list", () => {
  test("reads a page at a time, narrowed on the server, from the address a link gives it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", BUSY);
    await expect(rowOf(page, "batch-worker-7")).toBeVisible();
    await screenshot(page, "openstack-instances-list");

    for (const limit of await listLimits(page, "Instance")) {
      expect(limit).toBeLessThanOrEqual(100);
    }
  });

  test("opened on a project, it lights the Project chip, which clears like any other", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${CLOUD_PATH}/instances?${BUSY}&project=0006e37252697aa04e6e914220e5198d`,
    );

    await expect(rowOf(page, "batch-worker-7")).toBeVisible();
    await expect(page.locator("tr", { hasText: "payments-01" })).toHaveCount(0);
    await expect(page.getByText("acme-batch").first()).toBeVisible();
    // One Project filter, not two.
    await expect(page.getByRole("button", { name: /^Filter/ })).toHaveCount(0);
  });

  test("in a cloud of two regions the page's own bar narrows it, and no chip repeats it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "hypervisors", "estate=multi-region");
    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();
    await expect(page.locator("tbody tr").first()).toBeVisible();

    await openCloudPage(
      page,
      "hypervisors",
      "estate=multi-region&region=RegionTwo",
    );
    await expect(page.locator("tbody tr").first()).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    const reads: Array<FixtureRecord["listRequests"][number]> =
      record.listRequests.filter(
        (request: FixtureRecord["listRequests"][number]): boolean => {
          return (
            request.modelName === "OpenStackResource" &&
            request.query?.["kind"] === "Hypervisor" &&
            request.select?.["vcpuCapacity"] !== undefined
          );
        },
      );
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.query?.["regionName"]).toBe("RegionTwo");
    }
  });

  test("draws no column of nothing, because the exporter's addresses are empty", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", HEALTHY_OVS);
    await expect(rowOf(page, "ou-running")).toBeVisible();

    await expect(page.locator("thead").first()).not.toContainText("Address");
  });

  test("a column it leaves out by default can be turned on in Customize Columns", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "networks", BUSY);

    const card: Locator = page
      .getByTestId("card")
      .filter({ hasText: "External Networks" })
      .first();
    await expect(rowOf(page, "public-dmz")).toBeVisible();
    await expect(card.locator("thead")).not.toContainText("Physical Network");

    await card
      .getByTestId("card-header-actions")
      .getByRole("button", { name: "More options" })
      .click();
    await page.getByRole("menuitem", { name: "Columns", exact: true }).click();
    await page
      .getByTestId("column-customization-modal")
      .getByRole("checkbox", { name: "Physical Network" })
      .check();
    await page.getByTestId("modal-footer-submit-button").click();

    await expect(card.locator("thead")).toContainText("Physical Network");
    await expect(rowOf(page, "public-dmz")).toContainText("dmz");
  });
});

test.describe("when a read fails", () => {
  test("a page says it couldn't load, with a way to read again, and never that the part has gone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", LOST_HOST, `${BUSY}&fail=inventory`);

    await expect(page.getByTestId("openstack-part-read-error")).toContainText(
      "Couldn't load this hypervisor",
    );
    await expect(
      page.getByTestId("openstack-hypervisor-not-reported"),
    ).toHaveCount(0);
  });

  test("what it takes says so in its own frame, and the rest of the page stands", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", LOST_HOST, `${BUSY}&fail=blast`);

    await expect(
      page.getByTestId("openstack-hypervisor-blast-error"),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-hypervisor-tiles")).toBeVisible();
  });

  test("a failed count of flavors leaves the column out, and the sizes stand", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "flavors", `${BUSY}&fail=counts`);

    await expect(rowOf(page, "m1.medium")).toBeVisible();
    await expect(page.locator("thead")).not.toContainText("Instances");
  });
});

test.describe("every width, dark and right to left", () => {
  const PARTS_TO_FIT: ReadonlyArray<[string, string, string, string]> = [
    ["hypervisor", "hypervisors", LOST_HOST, BUSY],
    ["storage pool", "storage-pools", FULL_POOL, BUSY],
  ];

  for (const [name, listPath, externalId, query] of PARTS_TO_FIT) {
    test(`a ${name}'s page fits a phone`, async ({ page }: { page: Page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openPart(page, listPath, externalId, query);
      await expect(
        page.locator('[data-testid$="-hero"]').first(),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }

  for (const [name, listPath] of [
    ["hypervisors", "hypervisors"],
    ["instances", "instances"],
    ["networks", "networks"],
    ["floating IPs", "floating-ips"],
    ["volumes", "volumes"],
    ["availability zones", "availability-zones"],
  ] as const) {
    test(`the ${name} list fits a phone`, async ({ page }: { page: Page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openCloudPage(page, listPath, PARTS);
      await expect(page.locator('[data-testid="card"]').first()).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }

  test("a part's page in Persian lays out right to left, and a host's name stays as it was written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", LOST_HOST, `${BUSY}&lang=fa`);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByTestId("openstack-hypervisor-hero-name"),
    ).toContainText("compute-02");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "openstack-hypervisor-fa");
  });

  test("a part's page in dark mode", async ({ page }: { page: Page }) => {
    await openPart(page, "hypervisors", LOST_HOST, `${BUSY}&theme=dark`);

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("openstack-hypervisor-lost")).toBeVisible();
    await screenshot(page, "openstack-hypervisor-dark");
  });
});
