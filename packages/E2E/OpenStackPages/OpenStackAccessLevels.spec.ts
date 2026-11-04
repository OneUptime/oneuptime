import { Locator, Page } from "@playwright/test";
import {
  CLOUD_PATH,
  GERMAN,
  PERSIAN,
  expect,
  inLocale,
  openCloudPage,
  screenshot,
  test,
} from "./Helpers";

/*
 * What each page says at each level of access, on what the agent's exporter really answered
 * that credential (Common/Tests/Fixtures/OpenStack/<release>/access/exporter, from
 * Tests/Ops/openstack-e2e/access-matrix.sh), read through the real snapshot scan. So "can't list
 * hypervisors" is only here because a real credential really got no hypervisors, and the
 * levels are the ones the docs' table is generated from:
 *
 *   Full view             reads everything
 *   Infrastructure only   all of Nova, Placement and Neutron's agents, its own project's
 *                         Neutron and Cinder lists, and no Cinder services or pools
 *   Project view          its own project's Neutron and Cinder lists, and no infrastructure
 *
 * A page must never call what it can't read empty, and must never send anyone to a credential
 * that wouldn't help: Cinder's services and pools take Full view alone, whatever the policy says.
 */
const RELEASES: ReadonlyArray<string> = [
  "epoxy-ovn",
  "flamingo-ovn",
  "gazpacho-ovn",
  "gazpacho-ovs",
  "hibiscus-ovn",
];

function level(name: string, release: string = "hibiscus-ovn"): string {
  return `recording=${release}/access/${name}`;
}
const PROJECT_VIEW: string = level("reader");
const INFRASTRUCTURE_ONLY: string = level("monitoring-role");
const FULL_VIEW: string = level("monitoring-admin-get");

const CANT_LIST_HYPERVISORS: string = "This credential can't list hypervisors";
const CANT_LIST_INSTANCES: string = "This credential can't list instances";
const CANT_LIST_POOLS: string = "This credential can't list storage pools";
const CANT_LIST_AGENTS: string = "This credential can't list network agents";
const CANT_LIST_DOMAINS: string = "This credential can't list domains";

const OWN_PROJECT: string = "This credential sees its own project's rows here";
const TAKES_INFRASTRUCTURE: string =
  "These take the Full view or Infrastructure only credential.";
const TAKES_FULL_VIEW: string =
  "Cinder's services and storage pools take the Full view credential alone";

function notice(page: Page): Locator {
  return page.getByTestId("openstack-access-notice");
}

function limited(page: Page): Locator {
  return page.getByTestId("openstack-limited-view-notice");
}

function serviceGroup(page: Page, service: string): Locator {
  return page.locator(
    `[data-testid="openstack-service-group"][data-service="${service}"]`,
  );
}

async function gapsOf(page: Page): Promise<Array<string>> {
  await expect(notice(page)).toBeVisible();
  return await page
    .getByTestId("openstack-access-gap")
    .evaluateAll((gaps: Array<Element>): Array<string> => {
      return gaps.map((gap: Element) => {
        return gap.getAttribute("data-key") || "";
      });
    });
}

function row(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name }).first();
}

test.describe("Project view: a plain reader, refused the infrastructure", () => {
  test("the Overview says what is closed and which credential opens it, and judges nothing it can't see", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", PROJECT_VIEW);

    expect(await gapsOf(page)).toEqual([
      "hypervisors",
      "compute-services",
      "network-agents",
      "volume-services",
      "storage-pools",
      "placement",
    ]);
    const fix: Locator = page.getByTestId("openstack-access-fix");
    await expect(fix).toContainText(TAKES_INFRASTRUCTURE);
    await expect(fix).toContainText(TAKES_FULL_VIEW);
    await expect(fix).toContainText("troubleshoot.sh");
    await expect(page.getByTestId("openstack-access-guide")).toHaveAttribute(
      "href",
      new RegExp(`${CLOUD_PATH}/documentation#`),
    );

    /*
     * Placement says down because every call was refused. It is no critical on a cloud
     * nobody here can see into, and what really is wrong, a volume in error, still stands.
     */
    const health: Locator = page.getByTestId("openstack-overview-health");
    await expect(health).not.toContainText("Unhealthy");
    await expect(health).not.toContainText("Healthy");
    const attention: Locator = page.locator("body");
    await expect(attention).toContainText("ou-vol-bad");
    await expect(attention).not.toContainText("critical");
    await expect(attention).not.toContainText("0 hypervisors");
    await screenshot(page, "openstack-access-project-view-overview");
  });

  test("Services calls Placement closed rather than down, and so does its own page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "services", PROJECT_VIEW);

    expect(await gapsOf(page)).toEqual([
      "compute-services",
      "network-agents",
      "volume-services",
      "placement",
    ]);
    const placement: Locator = serviceGroup(page, "placement");
    const api: Locator = placement.getByTestId("openstack-service-api");
    await expect(api).toHaveAttribute("data-status", "closed");
    await expect(api).toContainText("Closed to this credential");

    await api.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/services\/[^/]+/);
    await expect(page.locator("body")).toContainText(
      "Closed to this credential",
    );
    await expect(page.locator("body")).not.toContainText(
      "every call the exporter made failed",
    );
  });

  for (const [subPath, title, fix] of [
    ["hypervisors", CANT_LIST_HYPERVISORS, "Full view or Infrastructure only"],
    [
      "availability-zones",
      CANT_LIST_HYPERVISORS,
      "Full view or Infrastructure only",
    ],
    ["aggregates", CANT_LIST_HYPERVISORS, "Full view or Infrastructure only"],
    ["instances", CANT_LIST_INSTANCES, "with a probe"],
    ["network-agents", CANT_LIST_AGENTS, "Full view or Infrastructure only"],
    ["storage-pools", CANT_LIST_POOLS, "Only the Full view credential"],
    ["domains", CANT_LIST_DOMAINS, "Full view or Infrastructure only"],
  ] as ReadonlyArray<[string, string, string]>) {
    test(`${subPath} says it can't list them, and what would`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(page, subPath, PROJECT_VIEW);

      await expect(page.getByText(title).first()).toBeVisible();
      await expect(page.locator("body")).toContainText(fix);
      await expect(page.locator("body")).not.toContainText("reported yet");
    });
  }

  for (const [subPath, name] of [
    ["networks", "ou-net"],
    ["subnets", "ou-subnet"],
    ["routers", "ou-router"],
    ["floating-ips", "172.24.4.231"],
    ["volumes", "ou-vol-free"],
  ] as ReadonlyArray<[string, string]>) {
    test(`${subPath} show what its 200 held, and say that isn't the whole cloud`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(page, subPath, PROJECT_VIEW);

      await expect(row(page, name)).toBeVisible();
      await expect(limited(page)).toContainText(OWN_PROJECT);
      await expect(limited(page)).toContainText("Full view credential");
    });
  }

  test("what anyone may read has no notice: flavors and images", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "flavors", PROJECT_VIEW);
    await expect(row(page, "cirros256")).toBeVisible();
    await expect(limited(page)).toHaveCount(0);

    await openCloudPage(page, "images", PROJECT_VIEW);
    await expect(row(page, "cirros")).toBeVisible();
    await expect(limited(page)).toHaveCount(0);
  });

  test("Projects holds the one it may see, and says what that is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "projects", PROJECT_VIEW);
    await expect(row(page, "ou-payments")).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);
  });

  test("the Topology draws Placement closed, not failed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "topology", PROJECT_VIEW);
    const body: Locator = page.locator("body");
    await expect(body).toContainText("6 APIs");
    await expect(body).toContainText("ou-vol-bad");
    await expect(body).not.toContainText(/placement\s*down/i);
  });
});

test.describe("Infrastructure only: the monitoring role on an empty project", () => {
  test("the Overview names only Cinder's, says Full view alone opens them, and reads the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", INFRASTRUCTURE_ONLY);

    expect(await gapsOf(page)).toEqual(["volume-services", "storage-pools"]);
    const fix: Locator = page.getByTestId("openstack-access-fix");
    await expect(fix).toContainText(TAKES_FULL_VIEW);
    // It holds this credential, so sending someone back to it would be no help.
    await expect(fix).not.toContainText(TAKES_INFRASTRUCTURE);
    await expect(page.locator("body")).toContainText("ou-failed");
    await screenshot(page, "openstack-access-infrastructure-only-overview");
  });

  test("Services reads Nova's and Neutron's workers, and says Cinder's are closed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "services", INFRASTRUCTURE_ONLY);

    expect(await gapsOf(page)).toEqual(["volume-services"]);
    await expect(serviceGroup(page, "compute")).toContainText("nova-compute");
    await expect(serviceGroup(page, "network")).toContainText("ovn-controller");
    await expect(
      serviceGroup(page, "placement").getByTestId("openstack-service-api"),
    ).toHaveAttribute("data-status", "up");
  });

  for (const [subPath, name] of [
    ["hypervisors", "compute-01"],
    ["instances", "ou-research-1"],
    ["network-agents", "ovn-controller"],
    ["domains", "Default"],
    ["projects", "ou-research"],
  ] as ReadonlyArray<[string, string]>) {
    test(`${subPath} reads every project's, with no word about access`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(page, subPath, INFRASTRUCTURE_ONLY);

      await expect(row(page, name)).toBeVisible();
      await expect(page.locator("body")).not.toContainText("can't list");
      await expect(limited(page)).toHaveCount(0);
    });
  }

  test("storage pools take Full view alone, and the page doesn't offer the credential it has", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "storage-pools", INFRASTRUCTURE_ONLY);

    await expect(page.getByText(CANT_LIST_POOLS).first()).toBeVisible();
    await expect(page.locator("body")).toContainText(
      "Only the Full view credential",
    );
    await expect(page.locator("body")).not.toContainText(
      "Infrastructure only",
    );
  });

  for (const [subPath, empty] of [
    ["routers", "No routers reported yet"],
    ["floating-ips", "No floating IPs reported yet"],
    ["volumes", "No volumes reported yet"],
  ] as ReadonlyArray<[string, string]>) {
    test(`${subPath}: an empty 200 from its own empty project is not an empty cloud`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(page, subPath, INFRASTRUCTURE_ONLY);

      await expect(page.getByText(empty).first()).toBeVisible();
      await expect(limited(page)).toContainText(OWN_PROJECT);
    });
  }

  for (const [subPath, name] of [
    ["networks", "public"],
    ["subnets", "public-subnet"],
  ] as ReadonlyArray<[string, string]>) {
    test(`${subPath} show the shared and external ones, and say so`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(page, subPath, INFRASTRUCTURE_ONLY);

      await expect(row(page, name)).toBeVisible();
      await expect(limited(page)).toContainText(OWN_PROJECT);
    });
  }
});

test.describe("Full view: an application credential limited by access rules", () => {
  for (const subPath of [
    "",
    "services",
    "hypervisors",
    "instances",
    "network-agents",
    "networks",
    "subnets",
    "routers",
    "floating-ips",
    "volumes",
    "snapshots",
    "storage-pools",
    "domains",
  ]) {
    test(`/${subPath} says nothing about access, even where every row is one project's`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(page, subPath, FULL_VIEW);

      await expect(page.getByTestId("openstack-access-notice")).toHaveCount(0);
      // Whatever the page is waiting for has had its chance to say otherwise.
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("can't list");
      await expect(limited(page)).toHaveCount(0);
    });
  }

  test("the rows only it can read are there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "storage-pools", FULL_VIEW);
    await expect(row(page, "lvmdriver-1")).toBeVisible();

    await openCloudPage(page, "volumes", FULL_VIEW);
    await expect(row(page, "ou-vol-used")).toBeVisible();

    await openCloudPage(page, "services", FULL_VIEW);
    await expect(serviceGroup(page, "volume")).toContainText("cinder-volume");
  });
});

test.describe("a service that isn't deployed", () => {
  test("its lists keep their own words, and no page calls that a credential's limit", async ({
    page,
  }: {
    page: Page;
  }) => {
    const noCinder: string = "recording=hibiscus-ovn/healthy&without=volume";

    await openCloudPage(page, "storage-pools", noCinder);
    await expect(page.getByText("No storage pools").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("can't list");

    await openCloudPage(page, "volumes", noCinder);
    await expect(page.getByText("No volumes reported yet").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("can't list");

    await openCloudPage(page, "services", noCinder);
    await expect(serviceGroup(page, "compute")).toContainText("nova-compute");
    await expect(serviceGroup(page, "volume")).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  });

  test("with no Cinder to ask, a list only says it may be one project's", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Both of this cloud's floating IPs are one project's, out of the several it knows.
    await openCloudPage(
      page,
      "floating-ips",
      "recording=hibiscus-ovn/healthy&without=volume",
    );
    await expect(row(page, "ou-payments")).toBeVisible();
    await expect(limited(page)).toContainText("may not be the whole cloud");
  });
});

test.describe("a stopped service is not a closed one", () => {
  test("Placement that stopped on a cloud this credential can read still reads down", async ({
    page,
  }: {
    page: Page;
  }) => {
    // What Nova's API stopped says: every API but Placement's own word is what it always was.
    await openCloudPage(
      page,
      "services",
      "recording=hibiscus-ovn/compute-api-down",
    );
    await expect(
      serviceGroup(page, "compute").getByTestId("openstack-service-api"),
    ).toHaveAttribute("data-status", "down");
    await expect(page.locator("body")).not.toContainText(
      "Closed to this credential",
    );
    await expect(notice(page)).toHaveCount(0);
  });
});

test.describe("every release we record", () => {
  for (const release of RELEASES) {
    test(`${release}: each level gets the words its credential earned`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openCloudPage(page, "", level("reader", release));
      expect(await gapsOf(page)).toEqual([
        "hypervisors",
        "compute-services",
        "network-agents",
        "volume-services",
        "storage-pools",
        "placement",
      ]);

      await openCloudPage(page, "", level("monitoring-role", release));
      expect(await gapsOf(page)).toEqual(["volume-services", "storage-pools"]);

      await openCloudPage(page, "", level("monitoring-admin-get", release));
      await expect(
        page.getByTestId("openstack-overview-health"),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(notice(page)).toHaveCount(0);
    });
  }
});

test.describe("the words, wherever they are read", () => {
  test("at a phone's width, nothing runs off the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const subPath of ["", "storage-pools", "volumes"]) {
      await openCloudPage(page, subPath, PROJECT_VIEW);
      await page.waitForLoadState("networkidle");
      const overflow: number = await page.evaluate((): number => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      });
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await screenshot(page, "openstack-access-project-view-390");
  });

  test("in the dark, the notice stays readable", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", `theme=dark&${PROJECT_VIEW}`);
    await expect(notice(page)).toBeVisible();
    await screenshot(page, "openstack-access-project-view-dark");
  });

  test("in German and in Persian, in their words where they have them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "storage-pools", `lang=de&${PROJECT_VIEW}`);
    await expect(
      page.getByText(inLocale(GERMAN, CANT_LIST_POOLS)).first(),
    ).toBeVisible();

    await openCloudPage(page, "storage-pools", `lang=fa&${PROJECT_VIEW}`);
    await expect(
      page.getByText(inLocale(PERSIAN, CANT_LIST_POOLS)).first(),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await screenshot(page, "openstack-access-project-view-fa");
  });
});
