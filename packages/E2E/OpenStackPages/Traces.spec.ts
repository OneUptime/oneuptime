import { Locator, Page } from "@playwright/test";
import {
  CLOUD_PATH,
  expect,
  fixtureRecord,
  FixtureRecord,
  openCloudPage,
  screenshot,
  test,
  VIEWPORTS,
} from "./Helpers";

/*
 * A cloud's Traces page, in a real browser, over what OSProfiler's driver really sent for a
 * signed boot (Fixture/TraceRecordings.js reads it through the real reader). What a test with a
 * stand-in cannot show: that the real viewer and the real map draw a real trace, that nothing
 * the page reads goes unanswered, and how it reads on a phone.
 */

const BOOT: string = "traces=flamingo-ovn/signed-boot";

test.describe("with OSProfiler off, which is how every cloud starts", () => {
  test("nothing breaks, it says what this is, and how to turn it on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "traces", "");

    const notice: Locator = page.getByTestId("openstack-traces-off-notice");

    await expect(notice).toContainText("OSProfiler is off");
    await expect(notice).toContainText("sign with your key");
    await expect(notice).toContainText("experimental");
    await expect(page.getByText("Turn on traces")).toBeVisible();
    await expect(page.getByTestId("openstack-trace-a-request")).toBeVisible();
    await expect(page.getByTestId("openstack-traces-status")).toHaveCount(0);
    await screenshot(page, "traces-off");

    const record: FixtureRecord = await fixtureRecord(page);

    expect(record.unhandled).toEqual([]);
  });

  test("the guide says what OSProfiler is and what a trace can show, for the tool you pick", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "traces", "");

    await expect(page.getByText("never an always-on feed")).toBeVisible();
    await expect(page.getByText("plain HTTP").first()).toBeVisible();
    await expect(page.getByText("What a trace shows.")).toBeVisible();
  });

  test.describe("on each width", () => {
    for (const viewport of VIEWPORTS) {
      test(`${viewport.width}px wide, nothing runs off the page`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize(viewport);
        await openCloudPage(page, "traces", "");
        await expect(
          page.getByTestId("openstack-traces-off-notice"),
        ).toBeVisible();

        const overflow: number = await page.evaluate(() => {
          return (
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
          );
        });

        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  });
});

test.describe("with a real signed boot", () => {
  test("says which services have sent a span, as an operator knows them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "traces", BOOT);

    const seen: Locator = page.getByTestId("openstack-traces-services-seen");

    for (const service of [
      "nova-api",
      "nova-compute",
      "neutron-server",
      "keystone",
      "glance-api",
    ]) {
      await expect(seen).toContainText(service);
    }
    await expect(seen).not.toContainText("osapi_compute");
    await expect(seen).not.toContainText("nova-nova-compute");
    await screenshot(page, "traces-on");

    const record: FixtureRecord = await fixtureRecord(page);

    expect(record.unhandled).toEqual([]);
  });

  test("gives the commands for this cloud, and opens what the client prints", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "traces", BOOT);

    await expect(page.getByTestId("openstack-trace-key")).toContainText(
      "read -rs OS_PROFILE",
    );
    await expect(page.getByTestId("openstack-trace-boot")).toContainText(
      "openstack server create --wait",
    );

    await page.getByTestId("openstack-trace-id").fill("that is not one");
    await page.getByTestId("openstack-trace-open").click();
    await expect(page.getByTestId("openstack-trace-id-invalid")).toBeVisible();

    await page
      .getByTestId("openstack-trace-id")
      .fill("Trace ID: 302f30b3-74c2-4a1c-8a64-38124ca5e121");
    await page.getByTestId("openstack-trace-open").click();
    await expect(page).toHaveURL(
      /traces\/view\/302f30b374c24a1c8a6438124ca5e121/,
    );
  });

  test("draws the control plane from it, with the services it really crossed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "traces", BOOT);

    const map: Locator = page.getByTestId("openstack-control-plane-map");

    await expect(map).toBeVisible();

    for (const service of ["nova-api", "neutron-server", "nova-compute"]) {
      await expect(map.getByText(service, { exact: true })).toBeVisible();
    }
    await screenshot(page, "traces-control-plane");
  });

  test("lists the cloud's traces by its key, in the real viewer", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "traces", BOOT);

    // The boot's own POST, under the name a reader wants, with its id out of it.
    await expect(
      page.getByText("POST /compute/v2.1/servers").first(),
    ).toBeVisible();

    const record: FixtureRecord = await fixtureRecord(page);
    const spanReads: Array<Record<string, unknown> | null> = record.listRequests
      .filter((request: { modelName: string }): boolean => {
        return request.modelName.startsWith("Span");
      })
      .map((request: { query: Record<string, unknown> | null }) => {
        return request.query;
      });

    expect(spanReads.length).toBeGreaterThan(0);
  });

  test("reads on a phone", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCloudPage(page, "traces", BOOT);

    await expect(page.getByTestId("openstack-traces-status")).toBeVisible();

    const overflow: number = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });

    expect(overflow).toBeLessThanOrEqual(1);
    await screenshot(page, "traces-phone");
    expect(CLOUD_PATH).toContain("openstack");
  });
});
