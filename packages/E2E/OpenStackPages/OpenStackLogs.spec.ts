import { Locator, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { expect, partPath, screenshot, test } from "./Helpers";

/*
 * A cloud's logs and lifecycle events, in a real browser, on what real clouds' services wrote: the
 * recorded lines go through the ingest's own stamp, and its notifications through the code that
 * writes a change event (Fixture/ServiceLogs.js), with the default drop filters' lines left out.
 * What a failed build's request holds, and which service it reaches, is what the cloud really did.
 *
 * The jsdom suite (Common/Tests/App/Dashboard/OpenStackLogsAndFeed.test.tsx) holds every state.
 * This holds the walk, with nothing made up.
 */

const RECORDINGS: string = path.resolve(
  __dirname,
  "../../Common/Tests/Fixtures/OpenStack/service-logs",
);

const RELEASES: Array<string> = fs.existsSync(RECORDINGS)
  ? fs.readdirSync(RECORDINGS).filter((name: string): boolean => {
      return fs.existsSync(path.join(RECORDINGS, name, "ids.json"));
    })
  : [];

function idsOf(release: string): Record<string, string> {
  return (
    JSON.parse(
      fs.readFileSync(path.join(RECORDINGS, release, "ids.json"), "utf8"),
    ) as { ids: { devstack: Record<string, string> } }
  ).ids.devstack;
}

async function openPart(
  page: Page,
  listPath: string,
  externalId: string,
  release: string,
): Promise<void> {
  await page.goto(
    `${partPath(listPath, externalId)}?estate=calm&logs=${release}`,
  );
}

test.describe("a cloud's service logs and events", () => {
  for (const release of RELEASES) {
    test(`${release}: a failed build, from its instance's page to the scheduler's line in two clicks`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPart(
        page,
        "instances",
        idsOf(release)["instance_no_valid_host"] as string,
        release,
      );

      // One: its Logs.
      await page.getByRole("tab", { name: "Logs" }).click();

      const requests: Locator = page.getByTestId("openstack-instance-requests");
      const failed: Locator = requests.locator("li").first();

      await expect(failed).toContainText("Failed");

      // Two: the request that failed.
      await failed.getByRole("link").click();

      await expect(page).toHaveURL(/\/logs\?request=req-/);

      const joined: Locator = page.getByTestId("openstack-request-joined");

      await expect(joined).toContainText("nova-api");
      await expect(joined).toContainText("nova-conductor");
      await expect(joined).toContainText("nova-scheduler");

      // What the scheduler itself said, at a level the default filters keep.
      await expect(
        page
          .getByText(/Filtering removed all hosts|no allocation candidates/)
          .first(),
      ).toBeVisible();

      await screenshot(page, `openstack-logs-${release}-request`);
    });

    test(`${release}: the request fits a phone`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openPart(
        page,
        "instances",
        idsOf(release)["instance_no_valid_host"] as string,
        release,
      );
      await page.getByRole("tab", { name: "Logs" }).click();
      await page
        .getByTestId("openstack-instance-requests")
        .locator("li")
        .first()
        .getByRole("link")
        .click();
      await expect(page.getByTestId("openstack-request-joined")).toContainText(
        "nova-scheduler",
      );
      await expectNoSidewaysScroll(page);
    });

    test(`${release}: an instance's Feed says what happened to it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPart(
        page,
        "instances",
        idsOf(release)["instance_ok"] as string,
        release,
      );
      await page.getByRole("tab", { name: "Feed" }).click();

      const feed: Locator = page.getByTestId("openstack-part-feed");

      await expect(feed).toContainText("created");
      await expect(feed).toContainText("resize confirmed");
      await expect(feed).toContainText("volume attached");
      await expect(feed).toContainText("migration failed");
      await screenshot(page, `openstack-feed-${release}-instance`);
    });

    test(`${release}: a build that failed says why on its Feed`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPart(
        page,
        "instances",
        idsOf(release)["instance_spawn_failed"] as string,
        release,
      );
      await page.getByRole("tab", { name: "Feed" }).click();

      const feed: Locator = page.getByTestId("openstack-part-feed");

      await expect(feed).toContainText("failed");
      await screenshot(page, `openstack-feed-${release}-failed-build`);
    });

    test(`${release}: a volume's Feed says it was attached`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPart(
        page,
        "volumes",
        idsOf(release)["volume_attached"] as string,
        release,
      );
      await page.getByRole("tab", { name: "Feed" }).click();
      await expect(page.getByTestId("openstack-part-feed")).toContainText(
        "attached",
      );
    });

    test(`${release}: a compute service's Feed says someone disabled it`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPart(
        page,
        "services",
        "RegionOne/compute/devstack-host/nova-compute",
        release,
      );
      await page.getByRole("tab", { name: "Feed" }).click();
      await expect(page.getByTestId("openstack-part-feed")).toContainText(
        "disabled",
      );
    });
  }
});
