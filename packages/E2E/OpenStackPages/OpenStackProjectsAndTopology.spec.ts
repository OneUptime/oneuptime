import { Locator, Page } from "@playwright/test";
import {
  CLOUD_PATH,
  expect,
  fixtureRecord,
  FixtureRecord,
  openCloudPage,
  screenshot,
  test,
} from "./Helpers";

/*
 * Whose everything is: Projects with and without quota data, one project's page, Domains,
 * a list opened on a project, and the Topology with a compute service stopped.
 *
 * `?estate=calm` has no quota data, which is most clouds, and `?estate=tenants` has it,
 * with a project at 90% of its instance quota and a nova-compute stopped under two
 * projects. A quota series has never been in a recording, so these are made up, in the
 * shape the snapshot scan writes (OpenStackSnapshotScanQuota.test.ts holds that shape).
 */

// projectIdOf(1) and projectIdOf(2) of Fixture/Data.js, by how the page lists them.
async function projectRow(page: Page, name: string): Promise<Locator> {
  const row: Locator = page.locator("tr", { hasText: name }).first();
  await expect(row).toBeVisible();
  return row;
}

async function openProject(page: Page, name: string): Promise<void> {
  await openCloudPage(page, "projects", "estate=tenants");
  const row: Locator = await projectRow(page, name);
  await row.getByRole("button", { name: /view/i }).first().click();
  await expect(page.getByTestId("openstack-project-hero")).toContainText(name);
}

test.describe("Projects without quota data", () => {
  test("says what turning them on gives, what it costs and how", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "projects", "estate=calm");

    await expect(await projectRow(page, "acme-payments")).toBeVisible();

    const setup: Locator = page.getByTestId("openstack-quota-setup");
    await expect(setup).toBeVisible();
    await expect(setup).toContainText("Quotas are not being read");
    await expect(setup).toContainText("--disable-metric=nova-limits_vcpus_max");
    await expect(setup).toContainText("--disable-metric=neutron-quota_network");
    await expect(setup).toContainText("Full view credential");
    await expect(page.getByTestId("openstack-quota-setup-probe")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("openstack-quota-cost")).toContainText(
      "four API calls per project",
    );
    // Its own cloud's number, not a general one.
    await expect(page.getByTestId("openstack-quota-cost")).toContainText(
      "calls on this cloud",
    );

    await screenshot(page, "projects-no-quota-1280");
  });

  test("on a cloud a probe reads, says which setting instead of which lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "projects", "estate=calm&collection=Probe");

    const probe: Locator = page.getByTestId("openstack-quota-setup-probe");
    await expect(probe).toContainText("Project limits");
    await expect(probe.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      new RegExp(`${CLOUD_PATH}/settings$`),
    );
    await expect(page.getByTestId("openstack-quota-setup-agent")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("openstack-quota-cost")).toContainText(
      "four API calls per project",
    );
  });

  test("a project's page says the same, and nothing is marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "projects", "estate=calm");
    const row: Locator = await projectRow(page, "acme-payments");
    await row.getByRole("button", { name: /view/i }).first().click();

    await expect(page.getByTestId("openstack-project-hero")).toBeVisible();
    await expect(page.getByTestId("openstack-quota-setup")).toBeVisible();
    await expect(page.getByTestId("openstack-quotas")).toHaveCount(0);
  });

  test("a project that runs nothing is an ordinary row, not a problem", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "projects", "estate=tenants");

    const row: Locator = await projectRow(page, "acme-empty");
    await expect(row).not.toContainText("Unhealthy");
    await expect(
      page.locator("[data-testid^='openstack-project-attention-']"),
    ).toHaveCount(1);
  });
});

test.describe("Projects with quota data", () => {
  test("a project at 90% of a quota is what the list says needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "projects", "estate=tenants");

    const row: Locator = await projectRow(page, "acme-payments");
    await expect(
      row.locator("[data-testid^='openstack-project-attention-']"),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-quota-setup")).toHaveCount(0);

    await screenshot(page, "projects-quota-1280");
  });

  test("its page marks the quota, says how much and reads the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openProject(page, "acme-payments");

    const instances: Locator = page.getByTestId("openstack-quota-instances");
    await expect(instances).toContainText("9 of 10");
    await expect(instances).toHaveAttribute("data-at-line", "true");

    const cores: Locator = page.getByTestId("openstack-quota-cores");
    await expect(cores).toContainText("4 of 80");
    await expect(cores).toHaveAttribute("data-at-line", "false");

    // -1 is no limit, and never a share of anything.
    const ports: Locator = page.getByTestId("openstack-quota-ports");
    await expect(ports).toContainText("no limit");
    await expect(ports).toHaveAttribute("data-at-line", "false");

    await expect(page.getByTestId("openstack-project-attention")).toContainText(
      "9 of 10 instances used",
    );

    await screenshot(page, "project-page-1280");
  });

  test("no limit is never under Needs attention, however much it runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openProject(page, "acme-research");

    await expect(page.getByTestId("openstack-quota-instances")).toContainText(
      "no limit",
    );
    await expect(
      page.getByTestId("openstack-project-attention"),
    ).not.toContainText("instances used");
  });
});

test.describe("One project's page", () => {
  test("names the host that is down under it, and how many of its instances", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openProject(page, "acme-payments");

    await expect(page.getByTestId("openstack-project-attention")).toContainText(
      "cmp-down.acme.example",
    );
    await expect(page.getByTestId("openstack-project-attention")).toContainText(
      "2 of this project's instances",
    );
  });

  test("shows the labels its instances carry", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openProject(page, "acme-payments");

    await expect(page.getByTestId("openstack-project-hero")).toContainText(
      "team=payments",
    );
  });

  test("opens a list on what it runs", async ({ page }: { page: Page }) => {
    await openProject(page, "acme-payments");

    await page
      .getByTestId("openstack-project-runs")
      .getByRole("link", { name: /instances/ })
      .click();

    await expect(page).toHaveURL(/\/instances\?project=/);
    await expect(
      page.locator("tr", { hasText: "payments-on-a-lost-host" }),
    ).toBeVisible();
    await expect(
      page.locator("tr", { hasText: "research-on-a-lost-host" }),
    ).toHaveCount(0);
  });

  test("says who is told, by what rule, and offers to add one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openProject(page, "acme-payments");

    await expect(
      page.getByTestId("openstack-scoped-rules-owner"),
    ).toContainText("No rule names this yet");
    await expect(
      page.getByTestId("openstack-scoped-rule-add").first(),
    ).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    expect(
      record.listRequests.some((request: { modelName?: string }) => {
        return request.modelName === "AlertOwnerRule";
      }),
    ).toBe(true);
  });

  test("a project gone from the inventory says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/projects/no-such-project?estate=tenants`);

    await expect(page.getByTestId("openstack-project-missing")).toBeVisible();
  });
});

test.describe("Domains", () => {
  test("say how many projects each holds, and open the list on them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "domains", "estate=tenants");

    const row: Locator = page.locator("tr", { hasText: "Acme" }).first();
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "1", exact: true }).click();

    await expect(page).toHaveURL(/\/projects\?domain=acme/);
    await expect(page.locator("tr", { hasText: "acme-empty" })).toBeVisible();
    await expect(page.locator("tr", { hasText: "acme-payments" })).toHaveCount(
      0,
    );

    await screenshot(page, "domains-1280");
  });

  test("a list offers a domain when there is more than one, and narrows to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", "estate=tenants");
    await expect(page.getByTestId("openstack-domain-filter")).toBeVisible();

    await screenshot(page, "domain-filter-1280");

    // Choosing one narrows the rows: Acme's one project runs nothing.
    await expect(
      page.locator("tr", { hasText: "payments-01" }).first(),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Domain" }).click();
    await page.getByRole("option", { name: "Acme", exact: true }).click();
    await expect(page.locator("tr", { hasText: "payments-01" })).toHaveCount(0);

    // A list it left empty keeps the choice, and says how to go back.
    await expect(page.getByTestId("openstack-domain-filter")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(
      page.locator("tr", { hasText: "payments-01" }).first(),
    ).toBeVisible();
  });

  test("a list offers no domain on a cloud with one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", "estate=calm");
    await expect(page.locator("table").first()).toBeVisible();
    await expect(page.getByTestId("openstack-domain-filter")).toHaveCount(0);
  });

  test("a list that is not a project's offers neither", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "hypervisors", "estate=tenants");
    await expect(page.locator("table").first()).toBeVisible();
    await expect(page.getByTestId("openstack-domain-filter")).toHaveCount(0);
  });
});

test.describe("The Topology", () => {
  test("with a compute service stopped, draws that host red with its instances beneath it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "topology", "estate=tenants");

    await expect(
      page.getByTestId("resource-topology-card-cloud"),
    ).toBeVisible();

    await page.getByTestId("resource-topology-filter-attention").click();

    const host: Locator = page.locator(
      '[data-testid="resource-topology-card-hypervisor:RegionOne/cmp-down.acme.example"]',
    );
    await expect(host).toBeVisible();
    await expect(host).toContainText("Down");
    await expect(host).toHaveAttribute("data-health", "critical");
    // Whatever Nova still says of them, its instances are beneath it.
    await expect(
      page.locator('[data-testid^="resource-topology-chip-instance:"]', {
        hasText: "payments-on-a-lost-host",
      }),
    ).toBeVisible();

    await screenshot(page, "topology-host-down-1280");
  });

  test("names what it cannot draw", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "topology", "estate=calm");

    await expect(
      page.getByTestId("resource-topology-card-cloud"),
    ).toBeVisible();
    await expect(
      page.getByTestId("resource-topology-notice-gap"),
    ).toContainText("what this cloud reports says neither");
  });

  test("a failed read says so, with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "topology", "estate=calm&fail=topology");

    await expect(page.getByTestId("resource-topology-error")).toBeVisible();
    await expect(page.getByTestId("resource-topology-retry")).toBeVisible();
  });

  test("on a phone it is a list, still whose each thing is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCloudPage(page, "topology", "estate=tenants");

    await expect(page.getByTestId("resource-topology")).toBeVisible();
    await screenshot(page, "topology-390");
  });
});
