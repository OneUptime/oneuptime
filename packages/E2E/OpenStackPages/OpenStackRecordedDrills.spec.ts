import { Locator, Page } from "@playwright/test";
import { expect, openCloudPage, partPath, test } from "./Helpers";

/*
 * The pages on what a later run of the rig really recorded (Tests/Ops/openstack-e2e/drills.sh), on
 * ML2/OVS and on OVN: an external network with no addresses left, a compute service forced down, a
 * stopped L3 agent and a router taken off it, and an estate with two aggregates in it. Each scene
 * is a whole scrape from one cloud, so what's listed is only what that cloud said.
 */

const BACKENDS: ReadonlyArray<[string, string]> = [
  ["ML2/OVS", "gazpacho-ovs"],
  ["OVN", "hibiscus-ovn"],
];

const L3_AGENT_DOWN: string = "recording=gazpacho-ovs/l3-agent-down";
const ROUTER_OFF_AGENT: string = "recording=gazpacho-ovs/router-agents-removed";
const OVN_ESTATE: string = "recording=hibiscus-ovn/compute-forced-down";

// Neutron kept this address DOWN, associated while the L3 agent was stopped.
const ADDRESS_STAYING_DOWN: string = "172.24.4.250";

function rowOf(page: Page, name: string): Locator {
  return page.locator("tr", { hasText: name }).first();
}

async function openRow(page: Page, name: string): Promise<void> {
  const row: Locator = rowOf(page, name);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /view/i }).first().click();
}

async function expectNeedsAttention(
  page: Page,
  query: string,
  names: ReadonlyArray<string>,
): Promise<void> {
  await openCloudPage(page, "", query);

  const card: Locator = page.getByTestId("openstack-needs-attention");
  await expect(card).toBeVisible();

  const toggle: Locator = page.getByTestId("openstack-needs-attention-toggle");
  if (await toggle.isVisible()) {
    await toggle.click();
  }

  for (const name of names) {
    await expect(
      card.getByTestId("openstack-needs-attention-name").filter({
        hasText: new RegExp(`^${name}$`),
      }),
    ).not.toHaveCount(0);
  }
}

for (const [backend, release] of BACKENDS) {
  test.describe(`${backend}, really`, () => {
    test("an external network out of addresses reaches Needs attention by name", async ({
      page,
    }: {
      page: Page;
    }) => {
      await expectNeedsAttention(
        page,
        `recording=${release}/external-network-full`,
        ["ou-full-pool"],
      );
    });

    test("that network's page says why", async ({ page }: { page: Page }) => {
      await openCloudPage(
        page,
        "networks",
        `recording=${release}/external-network-full`,
      );
      await openRow(page, "ou-full-pool");

      await expect(
        page.getByTestId("openstack-network-explanation"),
      ).toContainText("no addresses left");
      await expect(
        page.getByTestId("openstack-network-attention-item").first(),
      ).toBeVisible();
    });

    test("a compute service forced down reads down, and the exporter can't say more than that", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(
        `${partPath("services", "RegionOne/compute/compute-01/nova-compute")}?recording=${release}/compute-forced-down`,
      );

      await expect(
        page.getByTestId("openstack-service-hero-status"),
      ).toHaveText("down");
      await expect(page.getByTestId("openstack-service-details")).toContainText(
        "Not collected",
      );
      await expect(
        page.getByTestId("openstack-service-forced-down"),
      ).toHaveCount(0);
    });

    test("a host in two aggregates shows in both, and each lists it", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(
        page,
        "aggregates",
        `recording=${release}/compute-forced-down`,
      );
      await expect(rowOf(page, "ou-gpu")).toBeVisible();
      await openRow(page, "ou-fast");

      await expect(page.getByTestId("openstack-aggregate-hero")).toContainText(
        "ou-fast",
      );
      await page.getByRole("tab", { name: "Hypervisors" }).click();
      await expect(rowOf(page, "compute-01")).toBeVisible();
    });
  });
}

test.describe("ML2/OVS, with its only L3 agent stopped", () => {
  test("the agent, each router it held and the address staying down all reach Needs attention by name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await expectNeedsAttention(page, L3_AGENT_DOWN, [
      "neutron-l3-agent",
      "ou-router",
      "router1",
      ADDRESS_STAYING_DOWN,
    ]);
  });

  test("a router's page says no agent holding it is alive, whatever its own status says", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "routers", L3_AGENT_DOWN);
    await openRow(page, "ou-router");

    await expect(
      page.getByTestId("openstack-router-explanation"),
    ).toContainText("No L3 agent holding this router is alive");
    await expect(
      page.getByTestId("openstack-router-agent").first(),
    ).toBeVisible();
  });

  test("the address's page says Neutron doesn't call it active", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "floating-ips", L3_AGENT_DOWN);
    await openRow(page, ADDRESS_STAYING_DOWN);

    await expect(
      page.getByTestId("openstack-floating-ip-explanation"),
    ).toContainText("does not say it is ACTIVE");
  });
});

test.describe("ML2/OVS, with a router taken off its only agent", () => {
  test("its page says no agent is reported, rather than naming one it no longer has", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "routers", ROUTER_OFF_AGENT);
    await openRow(page, "ou-router");

    await expect(
      page.getByTestId("openstack-router-agents-not-reported"),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-router-agents")).toHaveCount(0);
    await expect(page.getByTestId("openstack-router-ovn")).toHaveCount(0);
  });
});

test.describe("OVN, which has no L3 agents", () => {
  test("a router's page says that isn't a fault, and raises nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "routers", OVN_ESTATE);
    await openRow(page, "ou-router");

    await expect(page.getByTestId("openstack-router-ovn")).toContainText(
      "this is not a fault",
    );
    await expect(page.getByTestId("openstack-router-explanation")).toHaveCount(
      0,
    );
  });
});
