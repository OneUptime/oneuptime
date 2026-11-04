import { Locator, Page } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import {
  CLOUD_PATH,
  FixtureRecord,
  GERMAN,
  PERSIAN,
  VIEWPORTS,
  expect,
  fixtureRecord,
  inLocale,
  openCloudPage,
  partPath,
  screenshot,
  test,
} from "./Helpers";

/*
 * The Services page: what `openstack compute service list`, `network agent list`, `volume
 * service list` and `endpoint list` answer between them, grouped by service and region,
 * what needs someone first, and in each service's own words. And a page for each.
 *
 * Most of this reads what real clouds' exporters answered: a stopped nova-compute, a
 * stopped Neutron agent on ML2/OVS and on OVN, a stopped cinder-volume, each by name, and
 * a service disabled with a reason, which raises nothing.
 */

async function openServices(page: Page, query: string = ""): Promise<void> {
  await openCloudPage(page, "services", query);
  await expect(
    page
      .getByTestId("openstack-service-group")
      .or(page.getByTestId("openstack-services-empty"))
      .or(page.getByTestId("openstack-services-read-error"))
      .first(),
  ).toBeVisible();
}

function group(page: Page, service: string, region?: string): Locator {
  const regionSelector: string = region ? `[data-region="${region}"]` : "";
  return page.locator(
    `[data-testid="openstack-service-group"][data-service="${service}"]${regionSelector}`,
  );
}

function worker(scope: Locator, name: string, host: string): Locator {
  return scope.locator(
    `[data-testid="openstack-service-worker"][data-name="${name}"][data-host="${host}"]`,
  );
}

async function workerNames(scope: Locator): Promise<Array<string>> {
  return await scope
    .getByTestId("openstack-service-worker")
    .evaluateAll((elements: Array<Element>): Array<string> => {
      return elements.map((element: Element): string => {
        return element.getAttribute("data-name") || "";
      });
    });
}

test.describe("on ML2/OVS and on OVN, as real clouds answer", () => {
  test("ML2/OVS: its four kinds of agent, Neutron's words for what an operator set, and Nova's and Cinder's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "recording=gazpacho-ovs/healthy");

    const network: Locator = group(page, "network");
    await expect(network.getByTestId("openstack-service-group-title")).toHaveText(
      "Networking (Neutron)",
    );
    await expect(
      network.getByTestId("openstack-service-group-backend"),
    ).toHaveText("ML2/OVS");
    expect((await workerNames(network)).sort()).toEqual([
      "neutron-dhcp-agent",
      "neutron-l3-agent",
      "neutron-metadata-agent",
      "neutron-openvswitch-agent",
    ]);
    await expect(
      worker(network, "neutron-l3-agent", "compute-01").getByTestId(
        "openstack-service-worker-admin",
      ),
    ).toHaveText("Admin up");

    // Nova's short host name, and its zone: internal for its control services.
    const compute: Locator = group(page, "compute");
    await expect(
      worker(compute, "nova-compute", "compute-01").getByTestId(
        "openstack-service-worker-admin",
      ),
    ).toHaveText("enabled");
    await expect(
      worker(compute, "nova-compute", "compute-01").getByTestId(
        "openstack-service-worker-where",
      ),
    ).toHaveText("compute-01 · nova");
    await expect(
      worker(compute, "nova-scheduler", "compute-01").getByTestId(
        "openstack-service-worker-where",
      ),
    ).toHaveText("compute-01 · internal");

    // Cinder writes its host with its backend.
    await expect(
      worker(group(page, "volume"), "cinder-volume", "compute-01@lvmdriver-1"),
    ).toBeVisible();

    // Every API in Keystone's catalog, with no worker beneath those that have none.
    for (const service of [
      "identity",
      "compute",
      "placement",
      "network",
      "volume",
      "image",
    ]) {
      await expect(
        group(page, service).getByTestId("openstack-service-api"),
      ).toHaveAttribute("data-status", "up");
    }
    await expect(
      group(page, "identity").getByTestId("openstack-service-worker"),
    ).toHaveCount(0);

    await screenshot(page, "services-ml2-ovs-1280");
  });

  test("OVN: its own agents, and no DHCP or L3 agent to miss", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "recording=hibiscus-ovn/healthy");

    const network: Locator = group(page, "network");
    await expect(
      network.getByTestId("openstack-service-group-backend"),
    ).toHaveText("OVN");
    expect((await workerNames(network)).sort()).toEqual([
      "neutron-ovn-agent",
      "ovn-controller",
    ]);
    await expect(network).toHaveAttribute("data-health", "Healthy");
    await expect(network).not.toContainText("neutron-dhcp-agent");

    await screenshot(page, "services-ovn-1280");
  });

  test("OVN on an older release says its agents' older names, and it is still OVN", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "recording=epoxy-ovn/healthy");

    const network: Locator = group(page, "network");
    await expect(
      network.getByTestId("openstack-service-group-backend"),
    ).toHaveText("OVN");
    expect((await workerNames(network)).sort()).toEqual([
      "neutron-ovn-metadata-agent",
      "ovn-controller",
    ]);
  });

  for (const release of ["gazpacho-ovs", "hibiscus-ovn"]) {
    test(`${release}: each stopped worker appears by name, first, in the right words`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openServices(page, `recording=${release}/compute-down`);
      const compute: Locator = group(page, "compute");
      await expect(compute).toHaveAttribute("data-health", "Unhealthy");
      await expect(
        compute.getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute("data-name", "nova-compute");
      await expect(
        compute.getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute("data-status", "down");
      await expect(
        compute
          .getByTestId("openstack-service-worker")
          .first()
          .getByTestId("openstack-service-worker-state"),
      ).toHaveText("down");
      // The group that needs someone is on top.
      await expect(
        page.getByTestId("openstack-service-group").first(),
      ).toHaveAttribute("data-service", "compute");

      await openServices(page, `recording=${release}/network-agent-down`);
      const network: Locator = group(page, "network");
      await expect(network).toHaveAttribute("data-health", "Unhealthy");
      await expect(
        network.getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute("data-status", "down");
      await expect(
        network.getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute(
        "data-name",
        release === "gazpacho-ovs"
          ? "neutron-openvswitch-agent"
          : "neutron-ovn-agent",
      );
      await expect(
        network
          .getByTestId("openstack-service-worker")
          .first()
          .getByTestId("openstack-service-worker-admin"),
      ).toContainText("Admin up");

      await openServices(page, `recording=${release}/volume-service-down`);
      const volume: Locator = group(page, "volume");
      await expect(volume).toHaveAttribute("data-health", "Unhealthy");
      await expect(
        volume.getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute("data-name", "cinder-volume");
      await expect(
        volume.getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute("data-status", "down");

      await openServices(page, `recording=${release}/scheduler-down`);
      await expect(
        group(page, "compute").getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute("data-name", "nova-scheduler");
      await expect(
        group(page, "compute").getByTestId("openstack-service-worker").first(),
      ).toHaveAttribute("data-status", "down");

      await openServices(page, `recording=${release}/recovered`);
      await expect(
        page.locator(
          '[data-testid="openstack-service-worker"][data-status="down"]',
        ),
      ).toHaveCount(0);
    });

    test(`${release}: an API that stopped answering says what it can no longer say about its workers`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openServices(page, `recording=${release}/compute-api-down`);

      const compute: Locator = group(page, "compute");
      await expect(compute.getByTestId("openstack-service-api")).toHaveAttribute(
        "data-status",
        "down",
      );
      await expect(
        compute.getByTestId("openstack-service-group-last-known"),
      ).toContainText("They read as they last did");
      await expect(
        page.getByTestId("openstack-service-group").first(),
      ).toHaveAttribute("data-service", "compute");
    });

    test(`${release}: disabling a compute service reads Disabled with its reason, and raises nothing`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openServices(page, `recording=${release}/compute-disabled`);

      const compute: Locator = group(page, "compute");
      const row: Locator = worker(compute, "nova-compute", "compute-01");
      await expect(row).toHaveAttribute("data-admin-state", "disabled");
      await expect(row.getByTestId("openstack-service-worker-admin")).toContainText(
        "disabled",
      );
      const state: Locator = row.getByTestId("openstack-service-worker-state");
      await expect(state).toContainText("Disabled");
      await expect(state).toContainText("OneUptime drill: planned maintenance");
      await expect(compute).toHaveAttribute("data-health", "Healthy");

      // And the Overview agrees: nothing beyond what the healthy cloud already had.
      await openCloudPage(page, "", `recording=${release}/compute-disabled`);
      await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();
      await expect(page.getByTestId("openstack-needs-attention")).not.toContainText(
        "nova-compute",
      );
    });
  }
});

test.describe("the list", () => {
  test("puts what needs someone first, in each group and among the groups", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page);

    // An API not answering, then the rest that are broken, then what is calm.
    const groups: Locator = page.getByTestId("openstack-service-group");
    await expect(groups.first()).toHaveAttribute("data-service", "image");
    await expect(groups.last()).toHaveAttribute("data-health", "Healthy");

    const compute: Locator = group(page, "compute");
    await expect(
      compute.getByTestId("openstack-service-group-toggle"),
    ).toHaveText("Show 1 more");
    await compute.getByTestId("openstack-service-group-toggle").click();
    // Down, then disabled so long someone forgot, then planned, then up.
    const rows: Locator = compute.getByTestId("openstack-service-worker");
    await expect(rows).toHaveCount(9);
    const order: Array<string | null> = await rows.evaluateAll(
      (elements: Array<Element>): Array<string | null> => {
        return elements.map((element: Element): string | null => {
          return `${element.getAttribute("data-host")}:${element.getAttribute("data-status")}:${element.getAttribute("data-admin-state")}`;
        });
      },
    );
    expect(order.slice(0, 4)).toEqual([
      "compute-02:down:enabled",
      "ctl-02:down:enabled",
      "compute-05:up:disabled",
      "compute-04:up:disabled",
    ]);

    await screenshot(page, "services-busy-1280");
  });

  test("each API says how long collecting it took, and a reason reads as it was written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page);

    await expect(
      group(page, "volume").getByTestId("openstack-service-api-collection"),
    ).toHaveText("Collected in 0.55 s");
    await expect(
      worker(group(page, "compute"), "nova-compute", "compute-04").getByTestId(
        "openstack-service-worker-state",
      ),
    ).toContainText("Replacing a DIMM, back Thursday");
    await expect(
      worker(group(page, "compute"), "nova-compute", "compute-04").getByTestId(
        "openstack-service-worker-admin",
      ),
    ).toHaveText("disabled · for 2d");
    // Neutron's word, and no reason, because Neutron has no such field.
    await expect(
      worker(group(page, "network"), "neutron-l3-agent", "ctl-02").getByTestId(
        "openstack-service-worker-admin",
      ),
    ).toHaveText("Admin down · for 3h");
    await expect(
      worker(group(page, "network"), "neutron-l3-agent", "ctl-02").getByTestId(
        "openstack-service-worker-state",
      ),
    ).toHaveText("Disabled");
  });

  test("a search narrows to a host or a service, and says when nothing matches", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page);

    const search: Locator = page.getByTestId("openstack-services-search");

    await search.fill("compute-03");
    await expect(
      group(page, "compute").getByTestId("openstack-service-worker"),
    ).toHaveCount(1);
    await expect(
      group(page, "network").getByTestId("openstack-service-worker"),
    ).toHaveCount(1);
    await expect(group(page, "identity")).toHaveCount(0);

    await search.fill("neutron");
    await expect(group(page, "network")).toBeVisible();
    await expect(
      group(page, "network").getByTestId("openstack-service-worker"),
    ).toHaveCount(7);
    await expect(group(page, "compute")).toHaveCount(0);

    await search.fill("no-such-host");
    await expect(page.getByTestId("openstack-services-no-match")).toBeVisible();
    await search.fill("");
    await expect(page.getByTestId("openstack-service-group")).not.toHaveCount(0);
  });

  test("a cloud of several regions: a card for each service in each, and its region named", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "estate=multi-region");

    await expect(group(page, "compute", "RegionTwo")).toHaveAttribute(
      "data-health",
      "Unhealthy",
    );
    await expect(group(page, "compute", "RegionOne")).toHaveAttribute(
      "data-health",
      "Healthy",
    );
    await expect(
      group(page, "compute", "RegionTwo").getByTestId(
        "openstack-service-group-region",
      ),
    ).toHaveText("RegionTwo");
    await expect(page.getByTestId("openstack-service-group").first()).toHaveAttribute(
      "data-region",
      "RegionTwo",
    );
    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();

    await screenshot(page, "services-multi-region-1280");

    await openServices(page, "estate=multi-region&region=RegionOne");
    await expect(group(page, "compute", "RegionTwo")).toHaveCount(0);
    await expect(group(page, "compute", "RegionOne")).toBeVisible();
    // Only one region being read, so no card needs to say which.
    await expect(
      page.getByTestId("openstack-service-group-region"),
    ).toHaveCount(0);
  });

  test("a credential that can't list services says so, by service, with the fix", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "access=project&estate=calm");

    await expect(
      page
        .getByTestId("openstack-access-notice")
        .getByTestId("openstack-access-gap"),
    ).toHaveText([
      "This credential can't list compute services",
      "This credential can't list network agents",
      "This credential can't list volume services",
    ]);
    // Its APIs are still there, up, and no worker reads as missing.
    await expect(
      group(page, "compute").getByTestId("openstack-service-api"),
    ).toHaveAttribute("data-status", "up");

    await screenshot(page, "services-limited-credential-1280");
  });

  test("a read that fails says so with Try again, and a quiet cloud says none of it is current", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "fail=inventory");
    const error: Locator = page.getByTestId("openstack-services-read-error");
    await expect(error).toContainText("Couldn't read this cloud's services");
    await expect(error.getByRole("button", { name: "Try again" })).toBeVisible();

    const before: number = (await fixtureRecord(page)).listRequests.length;
    await error.getByRole("button", { name: "Try again" }).click();
    await expect
      .poll(async (): Promise<number> => {
        return (await fixtureRecord(page)).listRequests.length;
      })
      .toBeGreaterThan(before);

    await openServices(page, "collector=disconnected");
    await expect(page.getByTestId("openstack-services-quiet")).toContainText(
      "Nothing here is current",
    );
    // Nothing it could not know: an access gap is for a cloud that answers.
    await expect(page.getByTestId("openstack-access-notice")).toHaveCount(0);
  });

  test("a cloud that has reported nothing says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "estate=new");
    await expect(page.getByTestId("openstack-services-empty")).toContainText(
      "No services reported yet",
    );
  });
});

test.describe("an OVN agent with a stale record beside it", () => {
  test("reads as stale rather than as an outage, and the page says how to clear it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "estate=ovn-stale");

    const network: Locator = group(page, "network");
    const row: Locator = worker(network, "ovn-controller", "compute-01");
    await expect(row).toHaveAttribute("data-status", "up");
    await expect(row.getByTestId("openstack-service-worker-stale")).toContainText(
      "1 stale record beside it",
    );
    await expect(network).toHaveAttribute("data-health", "Healthy");

    // And nothing on the Overview calls it anything else.
    await openCloudPage(page, "", "estate=ovn-stale");
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Healthy",
    );

    await openCloudPage(
      page,
      `services/${encodeURIComponent("RegionOne/network/compute-01/ovn-controller")}`,
      "estate=ovn-stale",
    );
    await expect(
      page.getByTestId("openstack-service-stale-records"),
    ).toContainText(
      "openstack network agent delete a1a1a1a1-0000-4000-8000-000000000001",
    );
  });
});

test.describe("a service's page", () => {
  test("an API: what is wrong with it and what it answers for, its workers, its alerts and details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(partPath("services", "RegionOne/compute"));

    await expect(page.getByTestId("openstack-service-hero-name")).toHaveText(
      "Compute (Nova)",
    );
    await expect(page.getByTestId("openstack-service-hero-status")).toHaveText(
      "up",
    );
    await expect(page.getByTestId("openstack-service-hero-location")).toContainText(
      "RegionOne",
    );

    const attention: Locator = page.getByTestId("openstack-service-attention");
    await expect(
      attention.getByTestId("openstack-service-attention-name"),
    ).toHaveText(["nova-compute", "nova-compute", "nova-scheduler"]);
    await expect(
      page.getByTestId("openstack-service-attention-summary").locator("span"),
    ).toHaveText(["1 critical", "2 to look at"]);

    await expect(
      page
        .getByTestId("openstack-service-workers")
        .getByTestId("openstack-service-worker"),
    ).toHaveCount(9);

    // Nothing has failed, so nothing is said about what a failure would take.
    await expect(page.getByTestId("openstack-service-blast-radius")).toHaveCount(0);

    const alerts: Locator = page.getByTestId("openstack-service-alerts");
    await expect(alerts.getByTestId("openstack-service-alerts-item")).toHaveCount(
      4,
    );
    await expect(alerts).toContainText("Compute API Down");
    await expect(alerts).toContainText("Compute Service Down");

    const details: Locator = page.getByTestId("openstack-service-details");
    await expect(details).toContainText("Compute (Nova)");
    await expect(details).toContainText("compute");
    await expect(details).toContainText("0.29 s");

    await screenshot(page, "service-api-1280");

    // One step from a worker's row to its page.
    await page
      .getByTestId("openstack-service-workers")
      .locator(
        '[data-testid="openstack-service-worker"][data-host="compute-02"]',
      )
      .getByTestId("openstack-service-worker-name")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname ===
        partPath("services", "RegionOne/compute/compute-02/nova-compute")
      );
    });
  });

  test("an API that is down: what nobody can manage, and whose it is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${partPath("services", "RegionTwo/compute")}?estate=multi-region`,
    );

    await expect(page.getByTestId("openstack-service-hero-status")).toHaveText(
      "down",
    );
    await expect(
      page.getByTestId("openstack-service-blast-radius"),
    ).toContainText("21 instances");
    await expect(
      page.getByTestId("openstack-service-blast-radius"),
    ).toContainText("acme-payments");

    // Only this region: the other's API answers fine, and its rows are not in its reads.
    const record: FixtureRecord = await fixtureRecord(page);
    const regions: Array<unknown> = record.apiRequests
      .filter((request: { url: string }): boolean => {
        return request.url.includes("/needs-attention/");
      })
      .map((request: { body: Record<string, unknown> | null }): unknown => {
        return request.body?.["regionName"];
      });
    expect(new Set(regions)).toEqual(new Set(["RegionTwo"]));
  });

  test("a stopped nova-compute: this service first, what it takes with it, what is open, its host", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      partPath("services", "RegionOne/compute/compute-02/nova-compute"),
    );

    await expect(page.getByTestId("openstack-service-hero-name")).toHaveText(
      "nova-compute",
    );
    await expect(page.getByTestId("openstack-service-hero-status")).toHaveText(
      "down",
    );
    await expect(page.getByTestId("openstack-service-hero-chips")).toContainText(
      "compute-02",
    );

    await expect(
      page.getByTestId("openstack-service-attention-name"),
    ).toHaveText("This service");
    await expect(
      page.getByTestId("openstack-service-attention-reason"),
    ).toContainText("Down, with 42 instances on it");

    const radius: Locator = page.getByTestId("openstack-service-blast-radius");
    await expect(radius).toContainText("42 instances");
    await expect(radius).toContainText("in 7 projects");

    await expect(page.getByTestId("openstack-service-open-item")).toHaveCount(1);
    await expect(page.getByTestId("openstack-service-open")).toContainText(
      "[OpenStack] Compute Service Down",
    );

    // Nova's short name finds the hypervisor's full one.
    await expect(
      page.getByTestId("openstack-service-hypervisor-link"),
    ).toHaveText("compute-02.acme.example");
    // No host reports under this one's name, so no link on a guess.
    await expect(page.getByTestId("openstack-service-host-link")).toHaveCount(0);

    await screenshot(page, "service-worker-down-1280");
  });

  test("Turn on N alerts opens Recommendations with exactly those selected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      partPath("services", "RegionOne/compute/compute-02/nova-compute"),
    );

    const turnOn: Locator = page.getByTestId("openstack-service-alerts-turn-on");
    await expect(turnOn).toHaveText("Turn on 1 alert");
    await turnOn.click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLOUD_PATH}/recommendations` &&
        url.searchParams.get("select") ===
          "OpenStack:openstack-compute-service-down"
      );
    });
  });

  test("with its alert on, a worker says so and offers nothing to turn on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${partPath("services", "RegionOne/compute/compute-02/nova-compute")}?alerts=some`,
    );

    await expect(
      page.locator(
        '[data-testid="openstack-service-alerts-item"][data-status="Created"]',
      ),
    ).toHaveCount(1);
    await expect(page.getByTestId("openstack-service-alerts-turn-on")).toHaveCount(
      0,
    );
  });

  test("a role that can't read monitors loses the card, and nothing else", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${partPath("services", "RegionOne/compute")}?alerts=denied`,
    );

    await expect(page.getByTestId("openstack-service-details")).toBeVisible();
    await expect(page.getByTestId("openstack-service-alerts")).toHaveCount(0);
  });

  test("a worker reporting under a host's name links to it in the Hosts product", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      partPath("services", "RegionOne/compute/compute-03/nova-compute"),
    );

    await page.getByTestId("openstack-service-host-link").click();
    await expect(page).toHaveURL(/\/hosts\//);
  });

  test("Cinder's worker finds its host without its backend's name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      partPath("services", "RegionOne/volume/ctl-01@lvmdriver-1/cinder-volume"),
    );

    await expect(page.getByTestId("openstack-service-hero-chips")).toContainText(
      "ctl-01@lvmdriver-1",
    );
    await expect
      .poll(async (): Promise<Array<unknown>> => {
        return (await fixtureRecord(page)).listRequests
          .filter((request: { modelName: string }): boolean => {
            return request.modelName === "Host";
          })
          .map((request: { query: Record<string, unknown> | null }): unknown => {
            return JSON.stringify(request.query);
          });
      })
      .toEqual([expect.stringContaining('"ctl-01"')]);
  });

  test("one disabled on purpose: Disabled with its reason, nothing to attend to, and nothing to take", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      partPath("services", "RegionOne/compute/compute-04/nova-compute"),
    );

    await expect(page.getByTestId("openstack-service-hero-status")).toHaveText(
      "Disabled",
    );
    await expect(page.getByTestId("openstack-service-hero-status")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    await expect(page.getByTestId("openstack-service-attention")).toHaveCount(0);
    await expect(page.getByTestId("openstack-service-blast-radius")).toHaveCount(0);

    const details: Locator = page.getByTestId("openstack-service-details");
    await expect(details).toContainText("Replacing a DIMM, back Thursday");
    await expect(details).toContainText("disabled");

    await screenshot(page, "service-worker-disabled-1280");
  });

  test("one forgotten for 12 days gets a look, in the words of the Overview", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      partPath("services", "RegionOne/compute/compute-05/nova-compute"),
    );

    await expect(
      page.getByTestId("openstack-service-attention-reason"),
    ).toHaveText("Disabled for 12 days");
  });

  test("a worker whose API stopped says what it reads is old", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${partPath("services", "RegionOne/compute/compute-01/nova-compute")}?recording=gazpacho-ovs/compute-api-down`,
    );

    await expect(
      page.getByTestId("openstack-service-last-known"),
    ).toContainText("It reads as it last did");
  });

  test("its Metrics tab draws how it has been, and says so when it can't", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      partPath("services", "RegionOne/compute/compute-02/nova-compute"),
    );
    await page.getByTestId("tab-Metrics").click();
    await expect(page.getByTestId("openstack-service-charts")).toBeVisible();

    const askedWorker: () => Promise<Array<string>> = async (): Promise<
      Array<string>
    > => {
      return (await fixtureRecord(page)).aggregateRequests.map(
        (request: { name: string }): string => {
          return request.name;
        },
      );
    };
    await expect.poll(askedWorker).toContain("openstack_nova_agent_state");

    await page.goto(partPath("services", "RegionOne/compute"));
    await page.getByTestId("tab-Metrics").click();
    await expect.poll(askedWorker).toContain("openstack_nova_up");
    await expect.poll(askedWorker).toContain("scrape_duration_seconds");

    await screenshot(page, "service-api-metrics-1280");

    // Each chart reads this cloud's series of this region, not every cloud's.
    const record: FixtureRecord = await fixtureRecord(page);
    const attributes: Record<string, unknown> | null | undefined =
      record.aggregateRequests.find((request: { name: string }): boolean => {
        return request.name === "openstack_nova_up";
      })?.attributes;
    expect(attributes).toEqual({
      "resource.openstack.cloud.name": "acme-prod",
      "openstack.region.name": "RegionOne",
    });

    await page.goto(`${partPath("services", "RegionOne/compute")}?fail=metrics`);
    await page.getByTestId("tab-Metrics").click();
    await expect(page.getByTestId("openstack-service-charts")).toContainText(
      "Something went wrong on the server",
    );
    await screenshot(page, "service-metrics-failed-1280");
  });

  test("not in the inventory says that, and a failed read says that, and they are not the same", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(partPath("services", "RegionOne/dns"));
    await expect(page.getByTestId("openstack-service-not-reported")).toBeVisible();

    await page.goto(
      `${partPath("services", "RegionOne/compute/compute-02/nova-compute")}?fail=inventory`,
    );
    await expect(page.getByTestId("openstack-part-read-error")).toContainText(
      "Couldn't load this agent",
    );
  });
});

test.describe("at every width, dark, in German and in Persian", () => {
  for (const viewport of VIEWPORTS) {
    test(`at ${viewport.width} pixels nothing runs off the page`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);

      for (const [name, target] of [
        ["list", `${CLOUD_PATH}/services`],
        ["list-ovn", `${CLOUD_PATH}/services?recording=hibiscus-ovn/compute-down`],
        ["list-regions", `${CLOUD_PATH}/services?estate=multi-region`],
        ["api", partPath("services", "RegionOne/compute")],
        [
          "worker",
          partPath("services", "RegionOne/compute/compute-02/nova-compute"),
        ],
      ] as Array<[string, string]>) {
        await page.goto(target);
        await expect(
          page
            .getByTestId("openstack-service-group")
            .first()
            .or(page.getByTestId("openstack-service-details")),
        ).toBeVisible();
        await expectNoSidewaysScroll(page, {
          message: `${name} at ${viewport.width}px`,
        });
        await screenshot(page, `services-${name}-${viewport.width}`);
      }
    });
  }

  test("in dark mode they draw on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await screenshot(page, "services-busy-dark");

    await page.goto(
      `${partPath("services", "RegionOne/compute/compute-02/nova-compute")}?theme=dark`,
    );
    await expect(page.getByTestId("openstack-service-details")).toBeVisible();
    await screenshot(page, "service-worker-dark");
  });

  test("in German, what it has words for is in German, and OpenStack's words stay as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "lang=de");

    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    // up, down and enabled are what the same person reads in `openstack compute service list`.
    const row: Locator = worker(
      group(page, "compute"),
      "nova-compute",
      "compute-02",
    );
    await expect(row.getByTestId("openstack-service-worker-state")).toHaveText(
      "down",
    );
    await expect(row.getByTestId("openstack-service-worker-admin")).toContainText(
      "enabled",
    );
    await expect(
      worker(group(page, "compute"), "nova-compute", "compute-04").getByTestId(
        "openstack-service-worker-state",
      ),
    ).toContainText(inLocale(GERMAN, "Disabled"));

    await expectNoSidewaysScroll(page, { message: "German" });
    await screenshot(page, "services-busy-german");

    await page.goto(
      `${partPath("services", "RegionOne/compute/compute-02/nova-compute")}?lang=de`,
    );
    await expect(page.getByTestId("tab-Overview")).toContainText(
      inLocale(GERMAN, "Overview"),
    );
  });

  test("in Persian, the page reads right to left, and a host or a reason reads as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openServices(page, "lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const row: Locator = worker(
      group(page, "compute"),
      "nova-compute",
      "compute-04",
    );
    await expect(row.getByTestId("openstack-service-worker-state")).toContainText(
      inLocale(PERSIAN, "Disabled"),
    );
    await expect(row.getByTestId("openstack-service-worker-state")).toContainText(
      "Replacing a DIMM, back Thursday",
    );
    await expect(
      row.getByTestId("openstack-service-worker-where").locator("bdi").first(),
    ).toHaveText("compute-04");

    await expectNoSidewaysScroll(page, { message: "Persian" });
    await screenshot(page, "services-busy-persian");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `${partPath("services", "RegionOne/compute/compute-02/nova-compute")}?lang=fa`,
    );
    await expect(page.getByTestId("openstack-service-details")).toBeVisible();
    await expectNoSidewaysScroll(page, { message: "Persian on a phone" });
    await screenshot(page, "service-worker-persian-390");
  });
});
