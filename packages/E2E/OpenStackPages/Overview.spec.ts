import { Locator, Page } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import {
  CLOUD_PATH,
  FixtureRecord,
  GERMAN,
  PERSIAN,
  VIEWPORTS,
  attentionRows,
  expect,
  expectSizesNumberFirst,
  fixtureRecord,
  inLocale,
  openCloudPage,
  partPath,
  screenshot,
  test,
} from "./Helpers";

/*
 * A cloud's Overview, read the way an operator reads it: before any chart, whether the
 * cloud is healthy and what needs someone first, by name, most urgent first, one step from
 * the part's page. Busy, calm, new, in several regions, quiet for days, and with its reads
 * failing, at a laptop's, a tablet's and a phone's width, dark, in German and in Persian.
 *
 * Every rule here is OpenStackHealth's, and the fixture answers every read from one
 * estate's rows the way the server does, so what these expect is what those rows mean.
 */

// The busy estate's Needs attention, most urgent first (Fixture/Data.js).
const BUSY_ATTENTION: Array<{ key: string; severity: string }> = [
  { key: "Api/RegionOne/image", severity: "critical" },
  {
    key: "Service/RegionOne/volume/ctl-01@lvmdriver-1/cinder-volume",
    severity: "critical",
  },
  {
    key: "Service/RegionOne/network/compute-03/neutron-openvswitch-agent",
    severity: "critical",
  },
  {
    key: "Service/RegionOne/compute/compute-02/nova-compute",
    severity: "critical",
  },
  {
    key: "StoragePool/RegionOne/ctl-01@lvmdriver-1#lvmdriver-1",
    severity: "critical",
  },
];

async function openOverview(page: Page, query: string = ""): Promise<void> {
  await openCloudPage(page, "", query);
  await expect(
    page.getByTestId("openstack-overview-data-status"),
  ).toBeVisible();
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

function attentionKey(page: Page, key: string): Locator {
  return page
    .getByTestId("openstack-needs-attention")
    .locator(`[data-key="${key}"]`);
}

test.describe("a busy cloud", () => {
  test("says it is unhealthy, and what needs someone first, the most urgent first, each with why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expect(page.getByTestId("openstack-overview-connection")).toHaveText(
      "Connected",
    );
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Unhealthy",
    );

    const card: Locator = page.getByTestId("openstack-needs-attention");
    await expect(card).toBeVisible();
    await expect(
      page.getByTestId("openstack-needs-attention-summary").locator("span"),
    ).toHaveText(["7 critical", "12 to look at"]);

    // The first page of rows, the rest one click away.
    const shown: Array<{ key: string; severity: string }> =
      await attentionRows(card);
    expect(shown.slice(0, BUSY_ATTENTION.length)).toEqual(BUSY_ATTENTION);
    expect(shown).toHaveLength(6);
    await page.getByTestId("openstack-needs-attention-toggle").click();
    const all: Array<{ key: string; severity: string }> =
      await attentionRows(card);
    expect(all).toHaveLength(19);

    // Everything critical before anything to look at.
    const severities: Array<string> = all.map(
      (row: { key: string; severity: string }): string => {
        return row.severity;
      },
    );
    expect(severities.lastIndexOf("critical")).toBeLessThan(
      severities.indexOf("warning"),
    );

    // An API by the name a person knows it by, not its catalog type.
    await expect(
      attentionKey(page, "Api/RegionOne/image").getByTestId(
        "openstack-needs-attention-name",
      ),
    ).toHaveText("Images (Glance)");

    // Each says why, in its own words.
    await expect(
      attentionKey(page, "Api/RegionOne/image").getByTestId(
        "openstack-needs-attention-reason",
      ),
    ).toHaveText("Not answering");
    await expect(
      attentionKey(
        page,
        "StoragePool/RegionOne/ctl-01@lvmdriver-1#lvmdriver-1",
      ).getByTestId("openstack-needs-attention-reason"),
    ).toHaveText("97% full");
    await expect(
      attentionKey(
        page,
        `Network/${await networkIdOf(page, "public")}`,
      ).getByTestId("openstack-needs-attention-reason"),
    ).toHaveText("No addresses left");
    await expect(
      attentionKey(
        page,
        "Service/RegionOne/compute/compute-05/nova-compute",
      ).getByTestId("openstack-needs-attention-reason"),
    ).toHaveText("Disabled for 12 days");

    await screenshot(page, "overview-busy-1280");
  });

  test("a lost nova-compute says how many instances it held and in how many projects", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const row: Locator = attentionKey(
      page,
      "Service/RegionOne/compute/compute-02/nova-compute",
    );
    await expect(
      row.getByTestId("openstack-needs-attention-reason"),
    ).toHaveText(["Down, with 42 instances on it", "In 7 projects"]);

    // Asked of the part that failed, and of nothing that is fine.
    const record: FixtureRecord = await fixtureRecord(page);
    const asked: Array<unknown> = record.apiRequests
      .filter((request: { url: string }): boolean => {
        return request.url.includes("/blast-radius/");
      })
      .map((request: { body: Record<string, unknown> | null }): unknown => {
        return request.body?.["externalId"];
      });
    expect(asked).toEqual(["RegionOne/compute/compute-02/nova-compute"]);
  });

  test("one someone disabled a day ago raises nothing, and one forgotten for 12 days gets a look", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    await page.getByTestId("openstack-needs-attention-toggle").click();

    await expect(
      attentionKey(page, "Service/RegionOne/compute/compute-04/nova-compute"),
    ).toHaveCount(0);
    await expect(
      attentionKey(page, "Service/RegionOne/compute/compute-05/nova-compute"),
    ).toHaveAttribute("data-severity", "warning");
    // Neutron's own word for planned work: admin down.
    await expect(
      attentionKey(page, "Service/RegionOne/network/ctl-02/neutron-l3-agent"),
    ).toHaveCount(0);
  });

  test("one of two schedulers down is a look, and a tenant's own full network is nobody else's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    await page.getByTestId("openstack-needs-attention-toggle").click();

    await expect(
      attentionKey(page, "Service/RegionOne/compute/ctl-02/nova-scheduler"),
    ).toHaveAttribute("data-severity", "warning");
    await expect(
      page
        .getByTestId("openstack-needs-attention-name")
        .filter({ hasText: "research-net" }),
    ).toHaveCount(0);
    // A spare floating IP is meant to be down.
    await expect(
      page
        .getByTestId("openstack-needs-attention-name")
        .filter({ hasText: "172.24.4.107" }),
    ).toHaveCount(0);
  });

  test("each row is one step from its part's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const row: Locator = attentionKey(
      page,
      "Service/RegionOne/compute/compute-02/nova-compute",
    );
    await expect(row.getByRole("link")).toHaveCount(1);
    await row.getByTestId("openstack-needs-attention-name").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname ===
        partPath("services", "RegionOne/compute/compute-02/nova-compute")
      );
    });
    await expect(page.getByTestId("openstack-service-hero-name")).toHaveText(
      "nova-compute",
    );

    // An API's opens that API's page, and it reads the same way there.
    await openOverview(page);
    await attentionKey(page, "Api/RegionOne/image")
      .getByTestId("openstack-needs-attention-name")
      .click();
    await expect(page.getByTestId("openstack-service-hero-name")).toHaveText(
      "Images (Glance)",
    );
    await expect(page.getByTestId("openstack-service-hero-status")).toHaveText(
      "down",
    );
  });

  test("the count chips open their lists, and say what is down in red", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const chips: Locator = page.getByTestId("openstack-overview-counts");
    await expect(chips.getByText("74 instances")).toBeVisible();
    await expect(chips.getByText("5 hypervisors")).toBeVisible();
    await expect(chips.getByText("1 region")).toBeVisible();
    await expect(chips.getByText("4 services down")).toBeVisible();

    await chips.getByText("5 hypervisors").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${CLOUD_PATH}/hypervisors`;
    });

    await openOverview(page);
    await page
      .getByTestId("openstack-overview-counts")
      .getByText("4 services down")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${CLOUD_PATH}/services`;
    });
  });

  test("the tiles say allocated and never CPU, and a lost host is no room to spare", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expect(tile(page, "Control plane")).toContainText("5/6");
    await expect(tile(page, "Control plane")).toContainText(
      "APIs up · 4 workers down",
    );
    await expect(tile(page, "Hypervisors")).toContainText("2/5");
    await expect(tile(page, "Hypervisors")).toContainText(
      "up · 1 lost · 2 disabled",
    );

    /*
     * The capacity of what can take instances: compute-01 and compute-03. Lost and
     * disabled hosts are in neither number, or 96 of their vCPUs would read as room.
     */
    await expect(tile(page, "vCPUs allocated")).toContainText("58%");
    await expect(tile(page, "vCPUs allocated")).toContainText("148 of 256");
    await expect(tile(page, "Memory allocated")).toContainText("47%");

    // The fullest pool is what matters, and the total hides it.
    await expect(tile(page, "Storage used")).toContainText("53%");
    await expect(tile(page, "Storage used")).toContainText("fullest pool 97%");

    await expect(
      page.getByTestId("openstack-overview-capacity"),
    ).not.toContainText(/\bCPU\b/);

    // Their bars are the rules' verdict: a host past 90%, a pool past 95%.
    await expect(
      tile(page, "vCPUs allocated").locator(".bg-amber-500"),
    ).toHaveCount(1);
    await expect(
      tile(page, "Memory allocated").locator(".bg-emerald-500"),
    ).toHaveCount(1);
    await expect(tile(page, "Storage used").locator(".bg-red-500")).toHaveCount(
      1,
    );
  });

  test("each pill and tile says what it means in its (i)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    // By what it says: the last one is still there for a moment, fading out.
    const tooltipSaying: (text: string) => Locator = (
      text: string,
    ): Locator => {
      return page.getByRole("tooltip").filter({ hasText: text });
    };

    await page.getByRole("button", { name: "About Health" }).hover();
    await expect(
      tooltipSaying("A service disabled on purpose never counts"),
    ).toBeVisible();

    await page.getByRole("button", { name: "About Data status" }).hover();
    await expect(
      tooltipSaying("Whether this cloud's data is reaching OneUptime"),
    ).toBeVisible();

    await page.getByRole("button", { name: "About vCPUs allocated" }).hover();
    await expect(tooltipSaying("not how busy the hosts are")).toBeVisible();
  });

  test("the Services card has what is down first, and each row opens its service", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const rows: Locator = page.getByTestId("openstack-services-card-item");
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toHaveAttribute("data-service", "image");
    await expect(rows.first()).toHaveAttribute("data-health", "Unhealthy");
    await expect(
      rows.first().getByTestId("openstack-services-card-api"),
    ).toContainText("down");

    const compute: Locator = page.locator(
      '[data-testid="openstack-services-card-item"][data-service="compute"]',
    );
    await expect(compute).toContainText("Compute (Nova)");
    await expect(compute).toContainText("5 of 9 workers up · 2 disabled");
    await expect(
      compute.getByTestId("openstack-services-card-down"),
    ).toHaveText("2 workers down");

    // What is calm reads calm, last.
    await expect(rows.last()).toHaveAttribute("data-health", "Healthy");

    await compute.getByTestId("openstack-services-card-name").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === partPath("services", "RegionOne/compute");
    });
    await expect(page.getByTestId("openstack-service-hero-name")).toHaveText(
      "Compute (Nova)",
    );

    await openOverview(page);
    await page.getByTestId("openstack-services-card-all").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${CLOUD_PATH}/services`;
    });
  });

  test("top consumers say who holds the most, and leave out a host whose numbers are old", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const lists: Locator = page.getByTestId("openstack-top-consumers-list");
    await expect(lists).toHaveCount(4);

    const instances: Locator = lists.locator(
      'xpath=self::*[@data-key="projects-instances"]',
    );
    await expect(
      instances.getByTestId("openstack-top-consumers-row").first(),
    ).toContainText("acme-payments");
    await expect(
      instances.getByTestId("openstack-top-consumers-row").first(),
    ).toContainText("20");

    const vcpus: Locator = lists.locator(
      'xpath=self::*[@data-key="hypervisors-vcpus"]',
    );
    await expect(vcpus).toContainText("compute-01.acme.example");
    await expect(vcpus).toContainText("92%");
    // Lost or disabled, however full their last numbers read.
    await expect(vcpus).not.toContainText("compute-02.acme.example");
    await expect(vcpus).not.toContainText("compute-05.acme.example");
  });

  test("reads what it needs and no whole kind of the cloud's rows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    const instanceReads: Array<unknown> = record.listRequests.filter(
      (request: { query: Record<string, unknown> | null }): boolean => {
        return request.query?.["kind"] === "Instance";
      },
    );
    expect(instanceReads).toEqual([]);
    // A cloud of one region has one question about what needs attention.
    expect(
      record.apiRequests.filter((request: { url: string }): boolean => {
        return request.url.includes("/needs-attention/");
      }),
    ).toHaveLength(1);
    // Nothing on this page reads the metric store.
    expect(record.aggregateRequests).toEqual([]);
  });

  test("a tab left open reads again, and a read that starts failing takes the verdict with it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.clock.install();
    await openOverview(page);
    await expect(page.getByTestId("openstack-overview-health")).toHaveAttribute(
      "data-health",
      "Unhealthy",
    );

    const reads: () => Promise<number> = async (): Promise<number> => {
      return (await fixtureRecord(page)).apiRequests.filter(
        (request: { url: string }): boolean => {
          return request.url.includes("/needs-attention/");
        },
      ).length;
    };
    const before: number = await reads();

    await page.clock.fastForward(61 * 1000);
    await expect.poll(reads).toBeGreaterThan(before);

    await page.evaluate((): void => {
      (
        window as unknown as { __openStackPagesFail: (read: string) => void }
      ).__openStackPagesFail("attention");
    });
    await page.clock.fastForward(61 * 1000);

    await expect(
      page.getByTestId("openstack-needs-attention-error"),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-needs-attention")).toHaveCount(0);
    await expect(page.getByTestId("openstack-overview-health")).toHaveAttribute(
      "data-health",
      "Unknown",
    );
  });

  test("past what one read holds, it says how many and where the rest are", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=overflow");

    await expect(
      page.getByTestId("openstack-needs-attention-summary"),
    ).toContainText("100 to look at");

    const capped: Locator = page.locator(
      '[data-testid="openstack-needs-attention-capped"] [data-key="Instance"]',
    );
    await expect(capped).toContainText(
      "100 of 340 instances that may need someone are listed here.",
    );
    await capped.getByRole("link").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${CLOUD_PATH}/instances`;
    });

    // Reading a region doesn't make what it holds any fewer.
    await openOverview(page, "estate=overflow&region=RegionOne");
    await expect(
      page.locator(
        '[data-testid="openstack-needs-attention-capped"] [data-key="Instance"]',
      ),
    ).toContainText(
      "100 of 340 instances that may need someone are listed here.",
    );
  });
});

test.describe("a calm cloud", () => {
  test("says Healthy and nothing else: no card, no red, no zero, and its planned work is quiet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=calm");

    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Healthy",
    );
    await expect(page.getByTestId("openstack-needs-attention")).toHaveCount(0);
    await expect(
      page.getByTestId("openstack-needs-attention-error"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("services down"),
    ).toHaveCount(0);

    await expect(tile(page, "Control plane")).toContainText("6/6");
    await expect(tile(page, "Control plane")).toContainText("APIs up");
    await expect(tile(page, "Hypervisors")).toContainText("2/3");
    // compute-03 was disabled on purpose: planned work, with no lost host in sight.
    await expect(tile(page, "Hypervisors")).toContainText("up · 1 disabled");
    await expect(tile(page, "Hypervisors").locator(".bg-red-500")).toHaveCount(
      0,
    );

    await expect(
      page.getByTestId("openstack-services-card-item").first(),
    ).toHaveAttribute("data-health", "Healthy");

    await screenshot(page, "overview-calm-1280");
  });
});

test.describe("a new cloud", () => {
  test("shows the setup guide instead of a wall of zeros, and reads no attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", "estate=new");

    await expect(page.getByText("Connect this cloud")).toBeVisible();
    await expect(page.getByTestId("openstack-overview-health")).toHaveCount(0);
    await expect(page.getByTestId("openstack-overview-capacity")).toHaveCount(
      0,
    );

    const record: FixtureRecord = await fixtureRecord(page);
    expect(
      record.apiRequests.filter((request: { url: string }): boolean => {
        return request.url.includes("/needs-attention/");
      }),
    ).toEqual([]);

    await screenshot(page, "overview-new-1280");
  });
});

test.describe("a cloud of several regions", () => {
  test("the Regions card says how each is doing, and which one needs someone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=multi-region");

    const regions: Locator = page.getByTestId("openstack-regions-card-item");
    await expect(regions).toHaveCount(2);

    const one: Locator = regions.filter({ hasText: "RegionOne" });
    const two: Locator = regions.filter({ hasText: "RegionTwo" });
    await expect(one).toHaveAttribute("data-health", "Healthy");
    await expect(two).toHaveAttribute("data-health", "Unhealthy");
    await expect(two).toContainText("5 of 6 APIs up");
    await expect(two).toContainText("1 worker down");
    await expect(one).toContainText("6 of 6 APIs up");
    await expect(one).not.toContainText("worker down");

    // Each region has its own answer, so one's trouble can't crowd out another's.
    const record: FixtureRecord = await fixtureRecord(page);
    const bodies: Array<unknown> = record.apiRequests
      .filter((request: { url: string }): boolean => {
        return request.url.includes("/needs-attention/");
      })
      .map((request: { body: Record<string, unknown> | null }): unknown => {
        return request.body?.["regionName"];
      });
    expect(bodies.sort()).toEqual(["RegionOne", "RegionTwo"]);

    await screenshot(page, "overview-multi-region-1280");
  });

  test("reading one region is kept in the address, across pages and a reload", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=multi-region");

    await page
      .getByTestId("openstack-regions-card-item")
      .filter({ hasText: "RegionTwo" })
      .getByTestId("openstack-regions-card-name")
      .click();
    await expect(page).toHaveURL(/[?&]region=RegionTwo/);

    // Its counts, its health and what needs attention in it, and nothing of the other's.
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("2 hypervisors"),
    ).toBeVisible();
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("1 region"),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Unhealthy",
    );
    await expect(page.getByTestId("openstack-needs-attention")).toContainText(
      "RegionTwo",
    );
    await expect(
      page.getByTestId("openstack-needs-attention"),
    ).not.toContainText("RegionOne");
    await expect(
      page.locator('[data-testid="openstack-regions-card-item"][aria-current]'),
    ).toHaveAttribute("data-region", "RegionTwo");
    // Projects are Keystone's, so a region has all of them.
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("7 projects"),
    ).toBeVisible();

    // A link inside the product knows nothing of regions, and the address keeps it.
    await page.getByTestId("openstack-services-card-all").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLOUD_PATH}/services` &&
        url.searchParams.get("region") === "RegionTwo"
      );
    });
    await expect(page.getByTestId("openstack-service-group")).not.toHaveCount(
      0,
    );
    await expect(
      page.locator(
        '[data-testid="openstack-service-group"][data-region="RegionOne"]',
      ),
    ).toHaveCount(0);

    // The side menu's counts read the region too.
    await expect(page.getByRole("link", { name: /Hypervisors/ })).toContainText(
      "2",
    );

    await page.reload();
    await expect(page).toHaveURL(/[?&]region=RegionTwo/);
    await expect(page.getByTestId("openstack-service-group")).not.toHaveCount(
      0,
    );
    await expect(
      page.locator(
        '[data-testid="openstack-service-group"][data-region="RegionOne"]',
      ),
    ).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === CLOUD_PATH;
    });

    // Back to before it was chosen: that address read every region, and reads them again.
    await page.goBack();
    await expect(page).toHaveURL((url: URL): boolean => {
      return !url.searchParams.has("region");
    });
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("2 regions"),
    ).toBeVisible();
  });

  test("the picker reads one region, or all of them again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=multi-region&region=RegionOne");

    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Healthy",
    );
    await expect(page.getByTestId("openstack-needs-attention")).toHaveCount(0);

    await page
      .getByTestId("openstack-region-bar")
      .locator("input")
      .first()
      .click();
    await page.getByRole("option", { name: "All regions" }).click();

    await expect(page).toHaveURL((url: URL): boolean => {
      return !url.searchParams.has("region");
    });
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Unhealthy",
    );
    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();
  });

  test("the picker is on every page a region narrows, and not on those it can't", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const subPath of [
      "availability-zones",
      "aggregates",
      "subnets",
      "network-agents",
      "snapshots",
    ]) {
      await openCloudPage(page, subPath, "estate=multi-region");
      await expect(
        page.getByTestId("openstack-region-bar"),
        subPath,
      ).toBeVisible();
    }

    // A project and a domain belong to Keystone, and to no region of it.
    for (const subPath of ["projects", "domains"]) {
      await openCloudPage(page, subPath, "estate=multi-region");
      await expect(
        page.getByRole("link", { name: /Hypervisors/ }),
      ).toBeVisible();
      await expect(
        page.getByTestId("openstack-region-bar"),
        subPath,
      ).toHaveCount(0);
    }
  });

  test("a link to a region the cloud no longer has falls back to all of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=multi-region&region=RegionGone");

    await expect(page).toHaveURL((url: URL): boolean => {
      return !url.searchParams.has("region");
    });
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Unhealthy",
    );
  });

  test("a cloud of one region is offered nothing to choose", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();
    await expect(page.getByTestId("openstack-region-bar")).toHaveCount(0);
    await expect(page.getByTestId("openstack-regions-card")).toHaveCount(0);
  });
});

test.describe("a cloud quiet for days", () => {
  test("counts nothing as current, and asks for no judgement it could not give", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "collector=disconnected");

    await expect(page.getByTestId("openstack-overview-connection")).toHaveText(
      "Disconnected",
    );
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Health Unknown",
    );
    await expect(page.getByTestId("openstack-overview-quiet")).toContainText(
      "Nothing here is current",
    );

    // Needs attention stays quiet, and is never asked.
    await expect(page.getByTestId("openstack-needs-attention")).toHaveCount(0);
    const record: FixtureRecord = await fixtureRecord(page);
    expect(
      record.apiRequests.filter((request: { url: string }): boolean => {
        return (
          request.url.includes("/needs-attention/") ||
          request.url.includes("/blast-radius/") ||
          request.url.includes("/top-consumers/")
        );
      }),
    ).toEqual([]);

    // No number days old beside a percentage, and nothing down that anyone knows of.
    for (const title of [
      "Control plane",
      "Hypervisors",
      "vCPUs allocated",
      "Memory allocated",
      "Storage used",
    ]) {
      await expect(tile(page, title)).toContainText("—");
      await expect(tile(page, title)).toContainText("Nothing current");
      await expect(tile(page, title)).not.toContainText("%");
    }
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("services down"),
    ).toHaveCount(0);
    await expect(page.getByTestId("openstack-overview-counts")).toHaveAttribute(
      "data-current",
      "false",
    );

    await expect(page.getByTestId("openstack-services-card")).toHaveCount(0);
    await expect(page.getByTestId("openstack-top-consumers")).toHaveCount(0);
    await expect(page.getByTestId("openstack-regions-card")).toHaveCount(0);

    await screenshot(page, "overview-quiet-1280");
  });
});

test.describe("reads that fail", () => {
  test("the inventory: each frame says so with Try again, and nothing reads as an empty cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "fail=inventory");

    await expect(
      page.getByTestId("openstack-overview-summary-error"),
    ).toContainText("Couldn't read this cloud's inventory");
    await expect(
      page.getByTestId("openstack-needs-attention-error"),
    ).toContainText("Couldn't read what needs attention");
    await expect(
      page
        .getByTestId("openstack-needs-attention-error")
        .getByRole("button", { name: "Try again" }),
    ).toBeVisible();

    // Not Healthy, not the setup guide, and not "not reported" about an agent that may be fine.
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Health Unknown",
    );
    await expect(page.getByText("Connect this cloud")).toHaveCount(0);
    await expect(tile(page, "vCPUs allocated")).toContainText(
      "Couldn't read this",
    );
    await expect(tile(page, "vCPUs allocated")).not.toContainText(
      "Not reported yet",
    );

    await screenshot(page, "overview-inventory-failed-1280");
  });

  test("Try again asks again, and what needs attention alone failing leaves the rest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "fail=attention");

    await expect(
      page.getByTestId("openstack-needs-attention-error"),
    ).toBeVisible();
    // Its counts still read, because they are not what failed.
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("74 instances"),
    ).toBeVisible();
    await expect(tile(page, "vCPUs allocated")).toContainText("58%");
    await expect(tile(page, "Control plane")).toContainText(
      "Couldn't read this",
    );

    const asked: () => Promise<number> = async (): Promise<number> => {
      return (await fixtureRecord(page)).apiRequests.filter(
        (request: { url: string }): boolean => {
          return request.url.includes("/needs-attention/");
        },
      ).length;
    };
    const before: number = await asked();
    await page
      .getByTestId("openstack-needs-attention-error")
      .getByRole("button", { name: "Try again" })
      .click();
    await expect.poll(asked).toBeGreaterThan(before);
  });

  test("a metric read failing takes nothing from the Overview, which reads the inventory", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "fail=metrics");

    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();
    await expect(page.getByTestId("openstack-services-card")).toBeVisible();
    await expect(tile(page, "vCPUs allocated")).toContainText("58%");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    expect((await fixtureRecord(page)).aggregateRequests).toEqual([]);

    await screenshot(page, "overview-metrics-failed-1280");
  });

  test("the regions failing says so where the card would be, and only there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=multi-region&fail=regions");

    await expect(
      page.getByTestId("openstack-regions-card-error"),
    ).toContainText("Couldn't read this cloud's regions");
    // What needs attention still reads, whole, in one read.
    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();

    // A cloud of one region has no card for it to be in.
    await openOverview(page, "fail=regions");
    await expect(page.getByTestId("openstack-regions-card-error")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();
  });

  test("who holds the most failing says so, and the blast radius failing still says Down", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "fail=consumers,blast");

    await expect(
      page.getByTestId("openstack-top-consumers-error"),
    ).toContainText("Couldn't read who holds the most");
    await expect(
      attentionKey(
        page,
        "Service/RegionOne/compute/compute-02/nova-compute",
      ).getByTestId("openstack-needs-attention-reason"),
    ).toHaveText("Down, with 42 instances on it");
  });

  test("incidents and alerts failing leaves the health of the cloud alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "fail=events");

    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Unhealthy",
    );
    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();
  });
});

test.describe("a credential that can't list what a working cloud always has", () => {
  test("says so, with the fix, and never reads as 0 hypervisors or Healthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "access=project&estate=calm");

    const notice: Locator = page.getByTestId("openstack-access-notice");
    await expect(notice).toBeVisible();
    await expect(notice.getByTestId("openstack-access-gap")).toHaveText([
      "This credential can't list hypervisors",
      "This credential can't list compute services",
      "This credential can't list network agents",
      "This credential can't list volume services",
      "This credential can't list storage pools",
    ]);
    await expect(notice.getByTestId("openstack-access-fix")).toContainText(
      "Full view or Infrastructure only",
    );

    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Health Unknown",
    );
    await expect(
      page.getByTestId("openstack-overview-counts").getByText("hypervisor"),
    ).toHaveCount(0);
    await expect(tile(page, "Hypervisors")).toContainText("—");
    await expect(tile(page, "Hypervisors")).toContainText(
      "This credential can't read these",
    );
    await expect(tile(page, "vCPUs allocated")).toContainText(
      "This credential can't read these",
    );
    await expect(tile(page, "vCPUs allocated")).not.toContainText("0%");
    await expect(tile(page, "Storage used")).toContainText(
      "This credential can't read these",
    );

    await screenshot(page, "overview-limited-credential-1280");

    // One step to the guide's own step, not to step 1 of an install already done.
    await notice.getByTestId("openstack-access-guide").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLOUD_PATH}/documentation` &&
        url.hash === "#agent-credential"
      );
    });
    await expect(
      page.getByText("Create the agent's credential"),
    ).toBeInViewport();
  });

  test("what it does see wrong still reads as wrong", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "access=project");

    await expect(page.getByTestId("openstack-access-notice")).toBeVisible();
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Unhealthy",
    );
  });

  test("a cloud with no gap has no notice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=calm");
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Healthy",
    );
    await expect(page.getByTestId("openstack-access-notice")).toHaveCount(0);
  });
});

test.describe("on what real clouds said", () => {
  test("a healthy cloud's only attention is the instance and volume its estate failed on purpose", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const release of ["gazpacho-ovs", "hibiscus-ovn"]) {
      await openOverview(page, `recording=${release}/healthy`);

      await expect(page.getByTestId("openstack-overview-health")).toHaveText(
        "Degraded",
      );
      await expect(
        page.getByTestId("openstack-needs-attention-name"),
      ).toHaveText(["ou-vol-bad", "ou-failed"]);
      await expect(tile(page, "Control plane")).toContainText("6/6");
      await expect(tile(page, "Hypervisors")).toContainText("1/1");
    }
  });

  test("a stopped nova-compute is critical by name, and the host stays out of the capacity", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "recording=gazpacho-ovs/compute-down");

    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Unhealthy",
    );
    const row: Locator = attentionKey(
      page,
      "Service/RegionOne/compute/compute-01/nova-compute",
    );
    await expect(row).toHaveAttribute("data-severity", "critical");
    await expect(
      row.getByTestId("openstack-needs-attention-reason").first(),
    ).toContainText("Down");
    await expect(tile(page, "Hypervisors")).toContainText("0/1");
    await expect(tile(page, "Hypervisors")).toContainText("up · 1 lost");
    await expect(tile(page, "vCPUs allocated")).toContainText("—");
    await expect(tile(page, "vCPUs allocated")).not.toContainText("0%");
  });

  test("a compute service disabled with a reason raises nothing new", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "recording=gazpacho-ovs/compute-disabled");

    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      "Degraded",
    );
    await expect(page.getByTestId("openstack-needs-attention-name")).toHaveText(
      ["ou-vol-bad", "ou-failed"],
    );
    await expect(tile(page, "Hypervisors")).toContainText("up · 1 disabled");
  });
});

test.describe("at every width, dark, in German and in Persian", () => {
  for (const viewport of VIEWPORTS) {
    test(`at ${viewport.width} pixels nothing runs off the page, busy, calm, in regions and quiet`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);

      for (const [name, query] of [
        ["busy", ""],
        ["calm", "estate=calm"],
        ["multi-region", "estate=multi-region"],
        ["quiet", "collector=disconnected"],
        ["failed", "fail=inventory"],
        ["limited", "access=project&estate=calm"],
      ] as Array<[string, string]>) {
        await openOverview(page, query);
        await expect(
          page.getByTestId("openstack-overview-capacity"),
        ).toBeVisible();
        await expectNoSidewaysScroll(page, {
          message: `${name} at ${viewport.width}px`,
        });
        await screenshot(page, `overview-${name}-${viewport.width}`);
      }
    });
  }

  test("a phone keeps a long name and a long pool inside the row, with its reasons", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOverview(page);

    const pool: Locator = attentionKey(
      page,
      "StoragePool/RegionOne/ctl-01@lvmdriver-1#lvmdriver-1",
    );
    await expect(pool).toBeVisible();
    const box: { x: number; width: number } | null = await pool.boundingBox();
    expect(box).not.toBeNull();
    expect((box as { x: number; width: number }).x).toBeGreaterThanOrEqual(0);
    expect(
      (box as { x: number; width: number }).x +
        (box as { x: number; width: number }).width,
    ).toBeLessThanOrEqual(390);
  });

  test("in dark mode it draws on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("openstack-needs-attention")).toBeVisible();
    await screenshot(page, "overview-busy-dark");

    await openOverview(page, "theme=dark&estate=multi-region");
    await expect(page.getByTestId("openstack-regions-card")).toBeVisible();
    await screenshot(page, "overview-multi-region-dark");

    await openOverview(page, "theme=dark&access=project&estate=calm");
    await expect(page.getByTestId("openstack-access-notice")).toBeVisible();
    await screenshot(page, "overview-limited-credential-dark");
  });

  test("in German, what it has words for is in German, and a word of OpenStack's stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");

    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByTestId("openstack-overview-connection")).toHaveText(
      inLocale(GERMAN, "Connected"),
    );
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      inLocale(GERMAN, "Unhealthy"),
    );
    await expect(page.getByTestId("openstack-needs-attention")).toContainText(
      inLocale(GERMAN, "Needs attention"),
    );
    // A row's name is the product's own.
    await expect(
      attentionKey(
        page,
        "Service/RegionOne/compute/compute-02/nova-compute",
      ).getByTestId("openstack-needs-attention-name"),
    ).toHaveText("nova-compute");
    await expect(page.getByTestId("openstack-overview-counts")).toContainText(
      "74",
    );

    await expectNoSidewaysScroll(page, { message: "German" });
    await screenshot(page, "overview-busy-german");
  });

  test("in Persian, the page reads right to left, and a host's name reads as written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=fa");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("openstack-overview-health")).toHaveText(
      inLocale(PERSIAN, "Unhealthy"),
    );
    await expect(page.getByTestId("openstack-needs-attention")).toContainText(
      inLocale(PERSIAN, "Needs attention"),
    );
    // Written the way the reader writes numbers.
    await expect(page.getByTestId("openstack-overview-counts")).toContainText(
      "۷۴",
    );
    await expect(
      attentionKey(
        page,
        "Service/RegionOne/compute/compute-02/nova-compute",
      ).locator("bdi", { hasText: "nova-compute" }),
    ).toBeVisible();

    await expectNoSidewaysScroll(page, { message: "Persian" });
    await screenshot(page, "overview-busy-persian");

    await page.setViewportSize({ width: 390, height: 844 });
    await openOverview(page, "lang=fa&estate=multi-region");
    await expectNoSidewaysScroll(page, { message: "Persian on a phone" });
    await screenshot(page, "overview-multi-region-persian-390");
  });

  /*
   * A size is a number and a unit in Latin letters: drawn bare on a page read
   * from the right, Top consumers wrote "TiB 6.0", unit first and in Latin
   * digits, beside counts in Persian ones (issue #7191). Each size now reads
   * its own way, in the reader's digits.
   */
  test("in Persian, every size is in Persian digits with its number before its unit, on a laptop and a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 900 });
      await openOverview(page, "lang=fa");

      const volumes: Locator = page
        .getByTestId("openstack-top-consumers-list")
        .locator('xpath=self::*[@data-key="projects-volumes"]');
      const values: Locator = volumes.getByTestId(
        "openstack-top-consumers-value",
      );

      await expect(values).toHaveText([
        "۶٫۰ TiB",
        "۲٫۰ TiB",
        "۵۰۰ GiB",
        "۲۰ GiB",
      ]);
      // Each value is a figure of its own, read left to right.
      await expect(values.first()).toHaveAttribute("dir", "ltr");

      const sizes: Array<{ text: string }> = await expectSizesNumberFirst(
        volumes,
        `Top consumers at ${width}`,
      );
      expect(
        sizes.map((size: { text: string }): string => {
          return size.text;
        }),
      ).toEqual(["۶٫۰ TiB", "۲٫۰ TiB", "۵۰۰ GiB", "۲۰ GiB"]);

      // The tiles' "used of total", each size its own way in a Persian sentence.
      for (const title of ["Memory allocated", "Storage used"]) {
        const sublabel: Locator = tile(
          page,
          inLocale(PERSIAN, title),
        ).getByTestId("golden-metric-tile-sublabel");

        await expect(sublabel).not.toHaveText(/[0-9]/);
        expect(
          await expectSizesNumberFirst(sublabel, `${title} at ${width}`),
        ).toHaveLength(2);
      }

      // Every figure of the card in Persian digits: counts, sizes and shares.
      for (const figure of await page
        .getByTestId("openstack-top-consumers-value")
        .allTextContents()) {
        expect(figure).not.toMatch(/[0-9]/);
      }
      await expectNoSidewaysScroll(page, { message: `Persian at ${width}` });
      await screenshot(page, `overview-sizes-persian-${width}`);
    }
  });
});

// A network's row key holds its UUID, which only the estate knows.
async function networkIdOf(page: Page, name: string): Promise<string> {
  const key: string | null = await page
    .getByTestId("openstack-needs-attention-item")
    .filter({ hasText: name })
    .first()
    .getAttribute("data-key");
  return (key || "").replace("Network/", "");
}
