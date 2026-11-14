import { Locator, Page } from "@playwright/test";
import fsPromises from "fs/promises";
import {
  CLOUD_PATH,
  FixtureRecord,
  VIEWPORTS,
  expect,
  expectSizesNumberFirst,
  fixtureRecord,
  openCloudPage,
  screenshot,
  test,
} from "./Helpers";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * "Can we fit this?": the Capacity page, in a real browser. On a recording, what a real cloud's
 * exporter answered is read through the real scan and the snapshot the worker writes, by the same
 * code. ?capacity=short is made up in the snapshot's own shape, for what no recording holds.
 */

function flavorRow(page: Page, name: string): Locator {
  return page.locator(
    `[data-testid="openstack-capacity-flavor"][data-flavor="${name}"]`,
  );
}

test.describe("on a real cloud's answers", () => {
  test("every flavor is counted by hand's numbers, and it says it calculated", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "recording=gazpacho-ovs/healthy");

    await expect(page.getByTestId("openstack-capacity-headline")).toBeVisible();

    // 13 vCPUs, 15086 MB and 141 GB free: see OpenStackCapacity.test.ts.
    await expect(
      flavorRow(page, "m1.small").getByTestId("openstack-capacity-flavor-fits"),
    ).toContainText("7");
    await expect(
      flavorRow(page, "m1.large").getByTestId("openstack-capacity-flavor-fits"),
    ).toContainText("1");
    await expect(
      flavorRow(page, "ou.impossible").getByTestId(
        "openstack-capacity-flavor-fits",
      ),
    ).toContainText("Too large for every host");

    await expect(page.getByTestId("openstack-capacity-source")).toHaveAttribute(
      "data-source",
      "inventories",
    );
    await expect(page.getByTestId("openstack-capacity-source")).toContainText(
      "can't see traits",
    );

    // A DevStack has room for all it was asked to run, and nothing's history to go on.
    await expect(
      page.getByTestId("openstack-capacity-nothing-short"),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="openstack-capacity-forecast"][data-state="not-enough-history"]',
      ),
    ).not.toHaveCount(0);
    await expect(
      page.getByTestId("openstack-capacity-forecasts"),
    ).toContainText("Not enough history");

    await screenshot(page, "capacity-recording");
  });

  test("a stopped nova-compute isn't room, says so, and leaves its flavors short", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "capacity",
      "recording=gazpacho-ovs/compute-down",
    );

    await expect(
      page.getByTestId("openstack-capacity-not-counted"),
    ).toContainText("lost");
    await expect(
      flavorRow(page, "m1.small").getByTestId("openstack-capacity-flavor-fits"),
    ).toContainText("0");
    await expect(
      page.locator(
        '[data-testid="openstack-capacity-shortage"][data-kind="flavor-cannot-be-placed"]',
      ),
    ).not.toHaveCount(0);
  });

  test("one someone disabled is planned work, not a shortage", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "capacity",
      "recording=gazpacho-ovs/compute-disabled",
    );

    await expect(
      flavorRow(page, "m1.small").getByTestId("openstack-capacity-flavor-fits"),
    ).toContainText("Room only on hosts someone disabled");
    await expect(
      page.locator(
        '[data-testid="openstack-capacity-shortage"][data-kind="flavor-cannot-be-placed"]',
      ),
    ).toHaveCount(0);
  });
});

test.describe("on three real hosts, on a real Placement", () => {
  test("a flavor that fits as one pool and on no host of the zone says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "capacity",
      "recording=hibiscus-ovn/capacity/healthy",
    );

    const fragmented: Locator = flavorRow(page, "ou.fragmented");

    // Hand's numbers: OpenStackCapacityRecordings.test.ts.
    await expect(fragmented).toContainText("ou-zone-a 0");
    await expect(flavorRow(page, "m1.small")).toContainText("ou-zone-a 5");
    await expect(flavorRow(page, "m1.medium")).toContainText("ou-zone-a 1");
    await expect(
      page.locator(
        '[data-testid="openstack-capacity-headroom"][data-state="can-lose-a-host"]',
      ),
    ).not.toHaveCount(0);
  });

  test("with its largest host lost, the zone can't lose another", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "capacity",
      "recording=hibiscus-ovn/capacity/host-lost",
    );

    await expect(
      page.getByTestId("openstack-capacity-not-counted"),
    ).toContainText("ou-cap-2");
    await expect(
      page.locator(
        '[data-testid="openstack-capacity-shortage"][data-kind="headroom-gone"]',
      ),
    ).toContainText("ou-zone-a");
    await expect(flavorRow(page, "m1.medium")).toContainText("ou-zone-a 0");
  });
});

test.describe("with something short", () => {
  test("what is short comes first, soonest first, each in its own words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");

    const kinds: Array<string | null> = await page
      .getByTestId("openstack-capacity-shortage")
      .evaluateAll((rows: Array<Element>) => {
        return rows.map((row: Element) => {
          return row.getAttribute("data-kind");
        });
      });

    expect(kinds).toEqual([
      "flavor-cannot-be-placed",
      // Neither zone could lose a host: zone-b is already down one, and holds what ran on it.
      "headroom-gone",
      "headroom-gone",
      "fills-up",
      "fills-up",
      "allocations-disagree",
    ]);

    await expect(page.getByTestId("openstack-capacity-headline")).toContainText(
      "Room for 340 m1.small, and 0 m1.xlarge.",
    );

    await expect(page.getByTestId("openstack-capacity-tiles")).toContainText(
      "until full, at this week's growth",
    );

    // Nothing says when an orphaned allocation fills anything: it isn't growing.
    await expect(
      page.locator(
        '[data-testid="openstack-capacity-shortage"][data-kind="allocations-disagree"]',
      ),
    ).not.toContainText("days");

    await screenshot(page, "capacity-short");
  });

  test("a fragmented flavor says what it would be as one pool", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");

    await expect(
      flavorRow(page, "m1.xlarge").getByTestId(
        "openstack-capacity-flavor-fragmented",
      ),
    ).toContainText("if it were one pool");
  });

  test("each count says whether Placement answered it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");

    await expect(
      flavorRow(page, "m1.small").getByTestId(
        "openstack-capacity-flavor-source",
      ),
    ).toHaveAttribute("data-source", "placement");

    const gold: Locator = flavorRow(page, "gold.large").getByTestId(
      "openstack-capacity-flavor-source",
    );

    await expect(gold).toHaveAttribute("data-source", "inventories");
    await expect(gold).toContainText("Can't see its traits");
  });

  test("an orphaned allocation names its host, and the command that finds it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");

    const orphans: Locator = page.getByTestId("openstack-capacity-orphans");

    await expect(orphans).toContainText("cmp-a2.acme.example");
    await expect(orphans).toContainText(
      "nova-manage placement audit --verbose",
    );
    await expect(orphans.getByRole("link")).toHaveAttribute(
      "href",
      "https://docs.openstack.org/nova/latest/admin/troubleshooting/orphaned-allocations.html",
    );
  });

  test("the ratio sits beside what hosts really use, only where something says", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");

    await expect(
      page.getByTestId("openstack-capacity-overcommit"),
    ).toContainText("9:1");

    await openCloudPage(page, "capacity", "recording=gazpacho-ovs/healthy");

    await expect(
      page.getByTestId("openstack-capacity-no-real-usage"),
    ).toContainText("prometheus-libvirt-exporter");
  });

  test("aggregates are folded until someone asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");

    await expect(page.getByTestId("openstack-capacity-aggregates")).toHaveCount(
      0,
    );

    await page.getByTestId("openstack-capacity-aggregates-toggle").click();

    await expect(
      page.getByTestId("openstack-capacity-aggregates"),
    ).toContainText("rack-1");
  });

  test("the CSV holds the tables, as a spreadsheet can read them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV" }).click(),
    ]);

    expect(download.suggestedFilename()).toBe("openstack-capacity.csv");

    const csv: string = await fsPromises.readFile(
      await download.path(),
      "utf8",
    );

    expect(csv).toContain("\nFlavors\n");
    expect(csv).toContain("RegionOne,m1.small,");
    expect(csv).toContain("\nWhen things fill up\n");
  });
});

test.describe("however large the cloud", () => {
  test("it reads one row, and asks nothing of the metric store", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short");
    await expect(page.getByTestId("openstack-capacity-headline")).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    const capacityReads: Array<unknown> = record.itemRequests.filter(
      (request: FixtureRecord["itemRequests"][number]): boolean => {
        return JSON.stringify(request.select).includes("capacitySnapshot");
      },
    );

    expect(capacityReads).toHaveLength(1);
    expect(record.aggregateRequests).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          name: expect.stringContaining("openstack_capacity"),
        }),
      ]),
    );
  });

  test("a cloud no worker has been through says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=none");

    await expect(page.getByTestId("openstack-capacity-not-yet")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  for (const viewport of VIEWPORTS) {
    test(`nothing runs off the page at ${viewport.width} pixels`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);
      await openCloudPage(page, "capacity", "capacity=short");
      await expect(
        page.getByTestId("openstack-capacity-headline"),
      ).toBeVisible();

      await expectNoSidewaysScroll(page, { tolerance: 1 });

      // Each zone's "used / total" keeps every size whole, its unit beside its number.
      await expectSizesNumberFirst(
        page.getByTestId("openstack-capacity-zones"),
        `The zones at ${viewport.width}`,
      );

      await screenshot(page, `capacity-${viewport.width}`);
    });
  }
});

/*
 * The zones' table read from the right. A narrow column broke a zone's
 * "674 GiB / 762 GiB (88%)" inside a size, its unit alone on the line under
 * its number, and a Persian page's longer words narrowed it more; a zone's
 * name broke at its hyphen ("zone-" over "a"); and in Persian a zone's lost
 * and disabled hosts, like the days "What is short" counts to, were written
 * in Latin digits beside Persian ones.
 */
test.describe("in Persian and in Arabic", () => {
  test("in Persian, a zone's name is one line, every count is in Persian digits, and on a phone its sizes stay whole", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "capacity=short&lang=fa");

    const zones: Locator = page.getByTestId("openstack-capacity-zones");
    const names: Locator = zones
      .getByTestId("openstack-capacity-zone")
      .locator("a bdi");

    await expect(names).toHaveText(["zone-a", "zone-b"]);
    for (const name of await names.all()) {
      expect(
        await name.evaluate((element: Element): number => {
          return element.getClientRects().length;
        }),
      ).toBe(1);
    }

    // zone-b has a lost host: "\u06F1 ازدست‌رفته، \u06F0 غیرفعال".
    await expect(zones).toContainText("\u06F1");
    await expect(zones).not.toContainText(/[0-9]/);
    await expect(page.getByTestId("openstack-capacity-short")).toContainText(
      "\u06F1\u06F4",
    );
    await screenshot(page, "capacity-fa-1280");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectSizesNumberFirst(zones, "The zones in Persian on a phone");
    await expectNoSidewaysScroll(page, { tolerance: 1 });
    await screenshot(page, "capacity-fa-390");
  });

  /*
   * Arabic writes its figures in Latin digits, and its page reads from the
   * right too: a size drawn bare was "GiB 674" there as well.
   */
  test("in Arabic, each size keeps its number before its unit, on a laptop and a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 900 });
      await openCloudPage(page, "capacity", "capacity=short&lang=ar");

      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

      const sizes: Array<{ text: string }> = await expectSizesNumberFirst(
        page.getByTestId("openstack-capacity-zones"),
        `The zones in Arabic at ${width}`,
      );

      expect(
        sizes.map((size: { text: string }): string => {
          return size.text;
        }),
      ).toEqual([
        "674 GiB",
        "762 GiB",
        "2.6 TiB",
        "5.9 TiB",
        "195 GiB",
        "508 GiB",
        "1.8 TiB",
        "3.9 TiB",
      ]);
      await expectNoSidewaysScroll(page, { tolerance: 1 });
      await screenshot(page, `capacity-ar-${width}`);
    }
  });
});

test("the side menu reaches it", async ({ page }: { page: Page }) => {
  await openCloudPage(page, "");

  await page.getByRole("link", { name: "Capacity", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`${CLOUD_PATH}/capacity`));
  await expect(page.getByTestId("openstack-capacity")).toBeVisible();
});
