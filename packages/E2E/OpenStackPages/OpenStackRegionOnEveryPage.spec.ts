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
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A multi-region cloud reads one region, or all of them, on every page, and the choice is
 * kept in the address (#5723). The lists and the Overview have read it from the start
 * (Overview.spec.ts, Services.spec.ts). These are the pages that came after: the map, the
 * signals and what is open.
 *
 * `?estate=multi-region` is made up: no recording holds a second region. Every signal page is
 * read here by what it asks for, because the fixture holds no telemetry: what ClickHouse would
 * answer is ClickHouse's. `?open=regions` puts one incident and alert in each region, and an
 * incident that names none.
 */

const REGION_LABEL: string = "openstack.region.name";

// The attributes each read of a signal asked for: by its table, and by the API's routes.
function attributesAskedOf(
  record: FixtureRecord,
  tablePrefix: string,
  apiPath: string,
): Array<Record<string, unknown>> {
  const asked: Array<unknown> = [
    ...[...record.listRequests, ...record.countRequests]
      .filter((request: { modelName: string }): boolean => {
        return request.modelName.startsWith(tablePrefix);
      })
      .map((request: { query: Record<string, unknown> | null }): unknown => {
        return request.query?.["attributes"];
      }),
    ...record.aggregateRequests
      .filter((request: { modelName: string }): boolean => {
        return request.modelName.startsWith(tablePrefix);
      })
      .map((request: { attributes: unknown }): unknown => {
        return request.attributes;
      }),
    ...record.apiRequests
      .filter((request: { url: string }): boolean => {
        return request.url.includes(apiPath);
      })
      .map((request: { body: Record<string, unknown> | null }): unknown => {
        return request.body?.["attributes"];
      }),
  ];

  return asked.filter((attributes: unknown): boolean => {
    return Boolean(attributes);
  }) as Array<Record<string, unknown>>;
}

async function pickRegion(page: Page, name: string): Promise<void> {
  const picker: Locator = page
    .getByTestId("openstack-region-bar")
    .getByRole("combobox");
  await picker.click();
  await page.getByRole("option", { name: name, exact: true }).click();
}

test.describe("the map", () => {
  test("draws the region being read and nothing of another", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "topology",
      "estate=multi-region&region=RegionTwo",
    );

    await expect(
      page.getByTestId("resource-topology-card-cloud"),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();
    await expect(
      page.getByTestId("resource-topology-card-region:RegionTwo"),
    ).toBeVisible();
    await expect(
      page.getByTestId("resource-topology-card-region:RegionOne"),
    ).toHaveCount(0);

    const record: FixtureRecord = await fixtureRecord(page);
    const bodies: Array<unknown> = record.apiRequests
      .filter((request: { url: string }): boolean => {
        return request.url.includes("/openstack-resource/topology/");
      })
      .map((request: { body: Record<string, unknown> | null }): unknown => {
        return request.body?.["regionName"];
      });
    expect(bodies).toEqual(["RegionTwo"]);

    await screenshot(page, "topology-one-region-1280");
  });

  test("reads the whole cloud again when asked, and keeps that in the address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "topology",
      "estate=multi-region&region=RegionTwo",
    );
    await expect(
      page.getByTestId("resource-topology-card-cloud"),
    ).toBeVisible();

    await pickRegion(page, "All regions");

    await expect(page).toHaveURL((url: URL): boolean => {
      return !url.searchParams.has("region");
    });
    await expect(
      page.getByTestId("resource-topology-card-region:RegionOne"),
    ).toBeVisible();
    await expect(
      page.getByTestId("resource-topology-card-region:RegionTwo"),
    ).toBeVisible();
  });

  test("a cloud of one region is asked for no region, and offers none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "topology", "estate=calm");
    await expect(
      page.getByTestId("resource-topology-card-cloud"),
    ).toBeVisible();

    await expect(page.getByTestId("openstack-region-bar")).toHaveCount(0);

    const record: FixtureRecord = await fixtureRecord(page);
    expect(
      record.apiRequests
        .filter((request: { url: string }): boolean => {
          return request.url.includes("/openstack-resource/topology/");
        })
        .map((request: { body: Record<string, unknown> | null }): unknown => {
          return request.body?.["regionName"];
        }),
    ).toEqual([undefined]);
  });
});

test.describe("the signals", () => {
  test("Metrics reads each series of the region, and says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "metrics",
      "estate=multi-region&region=RegionTwo",
    );

    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();

    await expect
      .poll(async (): Promise<boolean> => {
        const record: FixtureRecord = await fixtureRecord(page);
        const asked: Array<Record<string, unknown>> = attributesAskedOf(
          record,
          "Metric",
          "/telemetry/metrics/",
        );
        return (
          asked.length > 0 &&
          asked.every((attributes: Record<string, unknown>): boolean => {
            return attributes[REGION_LABEL] === "RegionTwo";
          })
        );
      })
      .toBe(true);
  });

  test("Logs reads each record of the region, and says what an empty one means", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "logs", "estate=multi-region&region=RegionTwo");

    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();

    await expect
      .poll(async (): Promise<boolean> => {
        const record: FixtureRecord = await fixtureRecord(page);
        const asked: Array<Record<string, unknown>> = attributesAskedOf(
          record,
          "Log",
          "/telemetry/logs/",
        );
        return (
          asked.length > 0 &&
          asked.every((attributes: Record<string, unknown>): boolean => {
            return attributes[`resource.${REGION_LABEL}`] === "RegionTwo";
          })
        );
      })
      .toBe(true);

    await expect(page.getByText(/OPENSTACK_REGION_NAME/)).toBeVisible();
    await screenshot(page, "logs-one-region-1280");
  });

  test("the whole cloud's logs ask for no region, and tell how they start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "logs", "estate=multi-region");

    await expect(page.getByText(/A cloud's logs appear once/)).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    const asked: Array<Record<string, unknown>> = attributesAskedOf(
      record,
      "Log",
      "/telemetry/logs/",
    );
    expect(asked.length).toBeGreaterThan(0);
    for (const attributes of asked) {
      expect(attributes[`resource.${REGION_LABEL}`]).toBeUndefined();
    }
  });
});

test.describe("traces", () => {
  test("Traces asks for the region's", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "traces", "estate=multi-region&region=RegionTwo");

    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();
    await expect(page.getByTestId("openstack-traces-off")).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    const asked: Array<Record<string, unknown>> = attributesAskedOf(
      record,
      "Span",
      "/telemetry/traces/",
    );
    expect(asked.length).toBeGreaterThan(0);
    for (const attributes of asked) {
      expect(attributes[`resource.${REGION_LABEL}`]).toBe("RegionTwo");
    }
  });
});

test.describe("on a phone", () => {
  test("the picker still fits, and the map still reads the one region", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCloudPage(
      page,
      "topology",
      "estate=multi-region&region=RegionTwo",
    );

    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();

    await expectNoSidewaysScroll(page);
    await screenshot(page, "topology-one-region-390");
  });
});

test.describe("what is open", () => {
  test("Incidents lists the region's, and those that name no region", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "incidents",
      "estate=multi-region&open=regions&region=RegionTwo",
    );

    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();
    await expect(
      page.getByText("[OpenStack] Compute API Down in RegionTwo"),
    ).toBeVisible();
    await expect(
      page.getByText("Declared by hand about the whole cloud"),
    ).toBeVisible();
    await expect(
      page.getByText("[OpenStack] Network Agent Down in RegionOne"),
    ).toHaveCount(0);

    await screenshot(page, "incidents-one-region-1280");
  });

  test("Alerts lists the region's", async ({ page }: { page: Page }) => {
    await openCloudPage(
      page,
      "alerts",
      "estate=multi-region&open=regions&region=RegionOne",
    );

    await expect(
      page.getByText("[OpenStack] Volumes in Error in RegionOne"),
    ).toBeVisible();
    await expect(
      page.getByText("[OpenStack] Instances in Error in RegionTwo"),
    ).toHaveCount(0);
  });

  test("every region is the whole list again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "alerts", "estate=multi-region&open=regions");

    await expect(
      page.getByText("[OpenStack] Volumes in Error in RegionOne"),
    ).toBeVisible();
    await expect(
      page.getByText("[OpenStack] Instances in Error in RegionTwo"),
    ).toBeVisible();
  });

  test("the side menu's badges count what their pages list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "incidents",
      "estate=multi-region&open=regions&region=RegionTwo",
    );
    await expect(
      page.getByText("[OpenStack] Compute API Down in RegionTwo"),
    ).toBeVisible();

    await expect
      .poll(async (): Promise<boolean> => {
        const record: FixtureRecord = await fixtureRecord(page);
        return record.countRequests
          .filter((request: { modelName: string }): boolean => {
            return request.modelName === "Incident";
          })
          .some(
            (request: { query: Record<string, unknown> | null }): boolean => {
              return Boolean(request.query?.["seriesLabels"]);
            },
          );
      })
      .toBe(true);
  });

  test("Scheduled Maintenance says it cannot be narrowed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "scheduled-maintenance",
      "estate=multi-region&region=RegionTwo",
    );

    await expect(
      page.getByTestId("openstack-maintenance-whole-cloud"),
    ).toContainText("the same in every region");
  });

  test("and says nothing of it to a reader of the whole cloud", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "scheduled-maintenance", "estate=multi-region");

    await expect(page.getByTestId("openstack-region-bar")).toBeVisible();
    await expect(
      page.getByTestId("openstack-maintenance-whole-cloud"),
    ).toHaveCount(0);
  });
});

test.describe("from page to page", () => {
  test("a link inside the product keeps the region, from the map to the signals", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "topology",
      "estate=multi-region&region=RegionTwo",
    );
    await expect(
      page.getByTestId("resource-topology-card-cloud"),
    ).toBeVisible();

    await page.getByRole("link", { name: /^Metrics$/ }).click();

    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLOUD_PATH}/metrics` &&
        url.searchParams.get("region") === "RegionTwo"
      );
    });

    await page.getByRole("link", { name: /^Alerts/ }).click();

    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLOUD_PATH}/alerts` &&
        url.searchParams.get("region") === "RegionTwo"
      );
    });
  });
});
