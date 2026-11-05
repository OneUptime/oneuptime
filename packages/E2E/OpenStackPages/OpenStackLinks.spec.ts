import { Locator, Page } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import {
  CLOUD_PATH,
  FixtureRecord,
  PROJECT_ID,
  expect,
  fixtureRecord,
  partPath,
  screenshot,
  test,
} from "./Helpers";

/*
 * A cloud joined to the rest of OneUptime, in a real browser through the real router, on the
 * made-up estate `?estate=links` (Fixture/Data.js): an agent on a hypervisor and on a guest, a
 * Kubernetes node with an OpenStack provider ID, services, a Ceph-backed pool, and beside each
 * of those the same names twice over.
 *
 * Fixture/Links.js answers with the real matching rules, over made-up rows. Whether the SQL
 * behind them reads the same is OpenStackAcrossProductsPostgres.test.ts, on what a real DevStack
 * said. Another product's page here is the real card on an otherwise bare page: that page's
 * own fixture holds that it mounts the card (HostPages, KubernetesPages, ResourceOverviews).
 *
 * Nothing here has met a live OneUptime stack.
 */

const LINKS: string = "estate=links";

const HYPERVISOR: string = "RegionOne/compute-01.acme.example";

function instanceId(number: number): string {
  return `2e1cfc3e-${String(number).padStart(4, "0")}-4c2e-a4fc-c5cf0f2db585`;
}

function modelId(prefix: string, number: number): string {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const WEB_1: string = instanceId(1);
const K8S_WORKER_1: string = instanceId(2);
const RESTORED_1: string = instanceId(5);

const HOST_OF_MACHINE: string = modelId("74000000", 11);
const HOST_OF_GUEST: string = modelId("74000000", 12);
const HOST_THAT_FITS_TWO: string = modelId("74000000", 13);
const FIRST_OF_TWO_HOSTS: string = modelId("74000000", 14);
const SECOND_OF_TWO_HOSTS: string = modelId("74000000", 15);
const GUEST_CALLED_A_HYPERVISOR: string = modelId("74000000", 16);

const KUBERNETES_CLUSTER: string = modelId("76000000", 1);

const SERVICE_ON_HOST: string = modelId("77000000", 1);
const SERVICE_ON_NODE: string = modelId("77000000", 2);
const SERVICE_EVERYWHERE: string = modelId("77000000", 4);
const SERVICE_ON_NOTHING: string = modelId("77000000", 5);

const CEPH_EAST: string = modelId("75000000", 1);

const LINKED_POOL: string = "RegionOne/ctl-01@rbd#volumes";
const SUGGESTED_POOL: string = "RegionOne/ctl-01@rbd-images#images";
const NAME_IN_TWO_CLUSTERS: string = "RegionOne/ctl-01@rbd-shared#shared";
const NAME_IN_TWO_POOLS: string = "RegionOne/ctl-01@rbd-backups#backups";

function hostPath(id: string): string {
  return `/dashboard/${PROJECT_ID}/host/${id}`;
}

function servicePath(id: string): string {
  return `/dashboard/${PROJECT_ID}/service/${id}`;
}

function nodePath(nodeName: string): string {
  return `/dashboard/${PROJECT_ID}/kubernetes/${KUBERNETES_CLUSTER}/nodes/${nodeName}`;
}

async function openPart(
  page: Page,
  listPath: string,
  externalId: string,
): Promise<void> {
  await page.goto(`${partPath(listPath, externalId)}?${LINKS}`);
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${path}?${LINKS}`);
}

test.describe("each page links to the next", () => {
  test("a hypervisor with OneUptime's agent on it: what is real beside what is promised, and its host and back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", HYPERVISOR);

    // What Nova has promised, and never as how busy it is.
    await expect(page.getByTestId("openstack-hypervisor-tiles")).toContainText(
      "vCPUs allocated",
    );
    // What it is really doing, from the agent on the machine.
    const usage: Locator = page.getByTestId("openstack-hypervisor-host-usage");
    await expect(usage).toContainText("CPU in use");
    await expect(usage).toContainText("Memory in use");
    const throughput: Locator = page.getByTestId(
      "openstack-hypervisor-host-throughput",
    );
    await expect(throughput).toContainText("Disk throughput");
    await expect(throughput).toContainText("Network throughput");
    await expect(throughput).toContainText("in");
    await screenshot(page, "openstack-links-hypervisor");

    await page.getByTestId("openstack-hypervisor-host-link").click();
    await expect(page).toHaveURL(new RegExp(`${hostPath(HOST_OF_MACHINE)}$`));

    // The host says the same from its end, and leads back to the same page.
    const card: Locator = page.getByTestId("host-openstack-placement");
    await expect(card).toContainText(
      "This machine is one of an OpenStack cloud's hypervisors",
    );
    await expect(card.getByTestId("openstack-placement-instance")).toHaveCount(
      0,
    );
    await expect(card.getByTestId("openstack-placement-cloud")).toContainText(
      "acme-prod",
    );
    await card
      .getByTestId("openstack-placement-hypervisor")
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/hypervisors/${encodeURIComponent(HYPERVISOR)}$`),
    );
    await expect(
      page.getByTestId("openstack-hypervisor-overview"),
    ).toBeVisible();
  });

  test("an instance says what else it is: a guest's host, and what runs on that", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "instances", WEB_1);

    const links: Locator = page.getByTestId("openstack-instance-links");
    await expect(links).toContainText("web-1");
    await expect(links).toContainText("api");
    await screenshot(page, "openstack-links-instance");

    await links.getByRole("link", { name: "web-1" }).click();
    await expect(page).toHaveURL(new RegExp(`${hostPath(HOST_OF_GUEST)}$`));

    const card: Locator = page.getByTestId("host-openstack-placement");
    await expect(card).toContainText("This host is an OpenStack instance");
    await expect(
      card.getByTestId("openstack-placement-instance"),
    ).toContainText("web-1");
    await expect(card.getByTestId("openstack-placement-zone")).toContainText(
      "nova",
    );
    await expect(card.getByTestId("openstack-placement-project")).toContainText(
      "acme-payments",
    );

    await card
      .getByTestId("openstack-placement-instance")
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`/instances/${WEB_1}$`));
    await expect(page.getByTestId("openstack-instance-links")).toBeVisible();
  });

  test("an instance that is a Kubernetes node says so, and the node says which hypervisor and zone it is on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "instances", K8S_WORKER_1);

    const links: Locator = page.getByTestId("openstack-instance-links");
    await expect(links).toContainText("acme-prod-k8s");
    await expect(links).toContainText("checkout");
    await links.getByRole("link", { name: "k8s-worker-1" }).click();
    await expect(page).toHaveURL(new RegExp(`${nodePath("k8s-worker-1")}$`));

    const card: Locator = page.getByTestId(
      "kubernetes-node-openstack-placement",
    );
    await expect(card).toContainText("from its spec.providerID");
    await expect(
      card.getByTestId("openstack-placement-hypervisor"),
    ).toContainText("compute-01.acme.example");
    await expect(card.getByTestId("openstack-placement-zone")).toContainText(
      "nova",
    );
    await screenshot(page, "openstack-links-kubernetes-node");

    await card
      .getByTestId("openstack-placement-hypervisor")
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/hypervisors/${encodeURIComponent(HYPERVISOR)}$`),
    );
  });

  test("a service says where it runs, through its host or through its pods' node", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, servicePath(SERVICE_ON_HOST));
    await expect(
      page
        .getByTestId("service-openstack-placement")
        .getByTestId("openstack-placement-instance"),
    ).toContainText("web-1");

    await open(page, servicePath(SERVICE_ON_NODE));
    const card: Locator = page.getByTestId("service-openstack-placement");
    await expect(
      card.getByTestId("openstack-placement-instance"),
    ).toContainText("k8s-worker-1");
    await card
      .getByTestId("openstack-placement-instance")
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`/instances/${K8S_WORKER_1}$`));
  });

  test("a service on several machines gets one card, with each of them on a line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, servicePath(SERVICE_EVERYWHERE));

    await expect(page.getByTestId("service-openstack-placement")).toHaveCount(
      1,
    );
    const rows: Locator = page.getByTestId("openstack-placement-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("web-1");
    await expect(rows.nth(1)).toContainText("compute-01.acme.example");
    await expect(rows.nth(2)).toContainText("k8s-worker-1");
    await screenshot(page, "openstack-links-service-several");
  });

  test("a failed hypervisor's blast radius goes on past the cloud, to hosts, nodes, clusters and services", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", HYPERVISOR);

    const blast: Locator = page.getByTestId("openstack-hypervisor-blast");
    await expect(
      blast.getByTestId("openstack-hypervisor-blast-counts"),
    ).toContainText("5 instances");

    const beyond: Locator = blast.getByTestId(
      "openstack-hypervisor-blast-across-products",
    );
    await expect(beyond).toContainText("Beyond this cloud");
    await expect(beyond).toContainText("This machine");
    await expect(beyond).toContainText("compute-01");
    await expect(beyond).toContainText("web-1");
    await expect(beyond).toContainText("acme-prod-k8s");
    await expect(beyond).toContainText("k8s-worker-1");
    await expect(beyond).toContainText("api");
    await expect(beyond).toContainText("checkout");
    await expect(beyond).toContainText("agentd");
    // On nothing here, and a host of this name is nothing to do with it.
    await expect(beyond).not.toContainText("billing");
    await screenshot(page, "openstack-links-blast-radius");

    await beyond.getByRole("link", { name: "acme-prod-k8s" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/kubernetes/${KUBERNETES_CLUSTER}$`),
    );
  });

  test("a stopped nova-compute reaches the same, by Nova's short name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(
      page,
      "services",
      "RegionOne/compute/compute-01/nova-compute",
    );
    await expect(page.getByTestId("openstack-service-host-link")).toHaveText(
      "compute-01",
    );
  });

  test("a Ceph-backed pool names its cluster and how it reads, and that is in Needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "storage-pools", LINKED_POOL);

    const card: Locator = page.getByTestId("openstack-storage-pool-ceph");
    await expect(card).toHaveAttribute("data-state", "from-fsid");
    await expect(card).toContainText("Cinder's driver names this cluster");
    await expect(
      page.getByTestId("openstack-storage-pool-ceph-health"),
    ).toContainText("HEALTH_ERR");
    // What Cinder's driver says is a fact, and there is no answer to change.
    await expect(
      page.getByTestId("openstack-storage-pool-ceph-change"),
    ).toHaveCount(0);
    await screenshot(page, "openstack-links-pool-ceph");

    await card.getByRole("link", { name: "ceph-east" }).click();
    await expect(page).toHaveURL(new RegExp(`/ceph/${CEPH_EAST}$`));

    // The pool reads half empty, and it is Ceph that has it in trouble.
    await open(page, CLOUD_PATH);
    const attention: Locator = page.getByTestId("openstack-needs-attention");
    await expect(attention).toContainText("ctl-01@rbd#volumes");
    await expect(attention).toContainText(
      "Its Ceph cluster ceph-east reads HEALTH_ERR",
    );
  });

  test("a suggestion asks, someone answers once, and they can change their mind", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "storage-pools", SUGGESTED_POOL);

    const card: Locator = page.getByTestId("openstack-storage-pool-ceph");
    await expect(card).toHaveAttribute("data-state", "suggested");
    await expect(
      page.getByTestId("openstack-storage-pool-ceph-suggestion"),
    ).toContainText("Is that where this pool is?");
    await expect(
      page.getByTestId("openstack-storage-pool-ceph-health"),
    ).toHaveCount(0);
    await screenshot(page, "openstack-links-pool-suggestion");

    await page.getByRole("button", { name: "Yes, this is it" }).click();
    await expect(card).toHaveAttribute("data-state", "confirmed");
    await expect(card).toContainText("Someone confirmed this cluster");
    await expect(
      page.getByTestId("openstack-storage-pool-ceph-health"),
    ).toContainText("HEALTH_ERR");

    await page.getByTestId("openstack-storage-pool-ceph-change").click();
    await expect(card).toHaveAttribute("data-state", "suggested");

    const record: FixtureRecord = await fixtureRecord(page);
    expect(
      (
        record as unknown as {
          writeRequests: Array<{ kind: string; data: Record<string, unknown> }>;
        }
      ).writeRequests
        .filter((write: { kind: string }): boolean => {
          return write.kind === "storage-pool-ceph-confirm";
        })
        .map((write: { data: Record<string, unknown> }) => {
          return write.data;
        }),
    ).toEqual([
      { externalId: SUGGESTED_POOL, cephClusterId: CEPH_EAST },
      { externalId: SUGGESTED_POOL, forget: true },
    ]);
  });

  test("someone can say a pool isn't on Ceph, and take that back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "storage-pools", SUGGESTED_POOL);
    const card: Locator = page.getByTestId("openstack-storage-pool-ceph");
    await page.getByRole("button", { name: "It isn't on Ceph" }).click();
    await expect(card).toHaveAttribute("data-state", "not-ceph");
    await expect(
      page.getByTestId("openstack-storage-pool-ceph-not-ceph"),
    ).toContainText("Someone said this pool isn't on Ceph");

    await page.getByTestId("openstack-storage-pool-ceph-change").click();
    await expect(card).toHaveAttribute("data-state", "suggested");
  });
});

test.describe("what the control plane stands on leads to the products that go deeper", () => {
  for (const [dependency, product, landing] of [
    ["rabbitmq", "Queues", /\/queues$/],
    ["mariadb", "Databases", /\/databases$/],
  ] as Array<[string, string, RegExp]>) {
    test(`${dependency}'s page leads to ${product}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, `${CLOUD_PATH}/control-plane/${dependency}`);
      const deeper: Locator = page.getByTestId(
        "openstack-control-plane-deeper",
      );
      await expect(deeper).toContainText(product);
      await deeper.getByRole("link", { name: product }).click();
      await expect(page).toHaveURL(landing);
    });
  }
});

test.describe("no link on a guess, from either end", () => {
  async function expectNoLinkedHost(page: Page): Promise<void> {
    await expect(
      page.getByTestId("openstack-hypervisor-overview"),
    ).toBeVisible();
    // Long enough for the read to have come back: the blast radius reads the same join.
    await expect(page.getByTestId("openstack-hypervisor-blast")).toBeVisible();
    await expect(
      page.getByTestId("openstack-hypervisor-host-link"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("openstack-hypervisor-host-usage"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("openstack-hypervisor-blast-across-products"),
    ).toHaveCount(0);
    // It says what would tell it, rather than reading as a machine nobody can see into.
    await expect(
      page.getByTestId("openstack-hypervisor-usage-missing"),
    ).toContainText("Run OneUptime's agent on this machine");
  }

  async function expectHostOnNoCloud(page: Page, id: string): Promise<void> {
    await open(page, hostPath(id));
    await expect(page.getByTestId("other-product-host")).toBeVisible();
    await expect
      .poll(async (): Promise<boolean> => {
        const record: FixtureRecord = await fixtureRecord(page);
        return record.apiRequests.some((request: { url: string }): boolean => {
          return request.url.includes("/placement-of-host/");
        });
      })
      .toBe(true);
    await expect(page.getByTestId("host-openstack-placement")).toHaveCount(0);
  }

  test("a host's short name that fits two hypervisors is neither's, from any end", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const name of [
      "RegionOne/compute-07.east.acme.example",
      "RegionOne/compute-07.west.acme.example",
    ]) {
      await openPart(page, "hypervisors", name);
      await expectNoLinkedHost(page);
    }
    await expectHostOnNoCloud(page, HOST_THAT_FITS_TWO);
  });

  test("a hypervisor two hosts could be has neither, from any end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", "RegionOne/compute-08.acme.example");
    await expectNoLinkedHost(page);
    await expectHostOnNoCloud(page, FIRST_OF_TWO_HOSTS);
    await expectHostOnNoCloud(page, SECOND_OF_TWO_HOSTS);
  });

  test("a guest called what a hypervisor is called is the guest, and no machine", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "hypervisors", "RegionOne/compute-09.acme.example");
    await expectNoLinkedHost(page);

    await open(page, hostPath(GUEST_CALLED_A_HYPERVISOR));
    const card: Locator = page.getByTestId("host-openstack-placement");
    await expect(card).toContainText("This host is an OpenStack instance");
    await expect(
      card.getByTestId("openstack-placement-instance"),
    ).toContainText("compute-09");
  });

  test("a UUID another cloud holds too is on neither, from any end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, "instances", RESTORED_1);
    await expect(page.getByTestId("openstack-instance-overview")).toBeVisible();
    await expect(page.getByTestId("openstack-instance-links")).toHaveCount(0);

    await open(page, nodePath("k8s-worker-2"));
    await expect(
      page.getByTestId("other-product-kubernetes-node"),
    ).toBeVisible();
    await expect
      .poll(async (): Promise<number> => {
        return (await fixtureRecord(page)).apiRequests.length;
      })
      .toBeGreaterThan(0);
    await expect(
      page.getByTestId("kubernetes-node-openstack-placement"),
    ).toHaveCount(0);
  });

  test("another cloud provider's node, and a service on no cloud, say nothing at all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, nodePath("k8s-worker-3"));
    await expect(
      page.getByTestId("other-product-kubernetes-node"),
    ).toBeVisible();
    await expect
      .poll(async (): Promise<number> => {
        return (await fixtureRecord(page)).apiRequests.length;
      })
      .toBeGreaterThan(0);
    await expect(
      page.getByTestId("kubernetes-node-openstack-placement"),
    ).toHaveCount(0);

    await open(page, servicePath(SERVICE_ON_NOTHING));
    await expect(page.getByTestId("other-product-service")).toBeVisible();
    await expect
      .poll(async (): Promise<number> => {
        return (await fixtureRecord(page)).apiRequests.length;
      })
      .toBeGreaterThan(0);
    await expect(page.getByTestId("service-openstack-placement")).toHaveCount(
      0,
    );
  });

  for (const [what, pool] of [
    ["two clusters", NAME_IN_TWO_CLUSTERS],
    ["two Cinder pools", NAME_IN_TWO_POOLS],
  ] as Array<[string, string]>) {
    test(`a pool's name that ${what} hold suggests neither, and asks instead`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPart(page, "storage-pools", pool);
      const card: Locator = page.getByTestId("openstack-storage-pool-ceph");
      await expect(card).toHaveAttribute("data-state", "unknown");
      await expect(card).toContainText(
        "Nothing that was collected says whether this pool is on Ceph",
      );
      await expect(
        page.getByTestId("openstack-storage-pool-ceph-suggestion"),
      ).toHaveCount(0);
      await expect(
        page.getByTestId("openstack-storage-pool-ceph-health"),
      ).toHaveCount(0);
      await screenshot(page, `openstack-links-pool-asks-${what.split(" ")[1]}`);
    });
  }

  test("a suggestion nobody confirmed raises nothing in Needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, CLOUD_PATH);
    const attention: Locator = page.getByTestId("openstack-needs-attention");
    await expect(attention).toContainText("ctl-01@rbd#volumes");
    await expect(attention).not.toContainText("ctl-01@rbd-images#images");
    await expect(attention).not.toContainText("ctl-01@rbd-shared#shared");
    await expect(attention).not.toContainText("ctl-01@rbd-backups#backups");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [name, path] of [
    ["a hypervisor's page", partPath("hypervisors", HYPERVISOR)],
    ["an instance's page", partPath("instances", K8S_WORKER_1)],
    ["a storage pool's page", partPath("storage-pools", SUGGESTED_POOL)],
    ["a host's card", hostPath(HOST_OF_GUEST)],
    ["a service's card", servicePath(SERVICE_EVERYWHERE)],
  ] as Array<[string, string]>) {
    test(`${name} fits, links and all`, async ({ page }: { page: Page }) => {
      await open(page, path);
      await page.waitForLoadState("networkidle");
      await expectNoSidewaysScroll(page);
    });
  }
});
