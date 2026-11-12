import { Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { CARD_FIT_WIDTHS, expectCardsFit } from "../SuiteHelpers/CardBodyFit";
import { CLOUD_PATH, openCloudPage, partPath, test } from "./Helpers";

/*
 * WHAT AN OPENSTACK CARD HOLDS LINES UP WITH ITS TITLE (#6956).
 *
 * A card pads what it holds itself. Fourteen OpenStack cards padded their
 * bodies a second time (p-4, px-4 pb-2, px-5 pb-5 md:px-6, py-2): what they
 * held started 16 to 24px right of the card's title, stopped as far short
 * of its right edge and left that much more under it. Each page that drew
 * one is read here from the outside (SuiteHelpers/CardBodyFit), on a
 * laptop and on a phone: every card on it starts under its title, reaches
 * the card's padding on the far side and ends at its bottom padding. The
 * guard over the sources (Common's Tests/App/Dashboard/CardBodyPaddingGuard)
 * reads the same rule from the code.
 */

// The real cloud whose service logs the part pages read (Common/Tests/Fixtures/OpenStack/service-logs).
const LOGS_RELEASE: string = "epoxy-ovn";

const SERVICE_LOGS: string = path.resolve(
  __dirname,
  "../../Common/Tests/Fixtures/OpenStack/service-logs",
);

function instanceOf(key: string): string {
  return (
    JSON.parse(
      fs.readFileSync(
        path.join(SERVICE_LOGS, LOGS_RELEASE, "ids.json"),
        "utf8",
      ),
    ) as { ids: { devstack: Record<string, string> } }
  ).ids.devstack[key] as string;
}

function instancePath(key: string): string {
  return `${partPath("instances", instanceOf(key))}?estate=calm&logs=${LOGS_RELEASE}`;
}

// Back to a laptop's width before the next page is opened, as each test starts.
async function atLaptopWidth(page: Page): Promise<void> {
  await page.setViewportSize(CARD_FIT_WIDTHS[0]!);
}

test.describe("OpenStack cards line up with their titles", () => {
  test("Checks: API Checks and the Instance Lifecycle Check", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "checks", "");

    await expectCardsFit(page, [
      page.getByTestId("openstack-api-checks"),
      page.getByTestId("openstack-lifecycle-check"),
    ]);
  });

  test("the Overview's Top consumers", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "", "");

    await expectCardsFit(page, [page.getByTestId("openstack-top-consumers")]);
  });

  test("the AI agent's Runbooks for the common failures", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUD_PATH}/ai/agent`);

    await expectCardsFit(page, [
      page.getByTestId("openstack-runbook-templates"),
    ]);
  });

  test("an instance's Feed, its Requests and a request's trail", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(instancePath("instance_ok"));
    await page.getByRole("tab", { name: "Feed" }).click();

    await expectCardsFit(page, [page.getByTestId("openstack-part-feed")]);

    await atLaptopWidth(page);
    await page.goto(instancePath("instance_no_valid_host"));
    await page.getByRole("tab", { name: "Logs" }).click();

    await expectCardsFit(page, [
      page.getByTestId("openstack-instance-requests"),
    ]);

    await atLaptopWidth(page);
    await page
      .getByTestId("openstack-instance-requests")
      .locator("li")
      .first()
      .getByRole("link")
      .click();

    await expectCardsFit(page, [page.getByTestId("openstack-request-trail")]);
  });

  test("Traces: the control plane, how traces arrive and how to trace a request", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "traces", "traces=flamingo-ovn/signed-boot");

    await expectCardsFit(page, [
      page.getByTestId("openstack-control-plane-map"),
      page.getByTestId("openstack-traces-status"),
    ]);

    await atLaptopWidth(page);
    await openCloudPage(page, "traces", "");

    await expectCardsFit(page, [page.getByTestId("openstack-trace-a-request")]);
  });

  test("a project's What it runs", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "projects", "estate=tenants");
    await page
      .locator("tr", { hasText: "acme-payments" })
      .first()
      .getByRole("button", { name: /view/i })
      .first()
      .click();

    await expectCardsFit(page, [page.getByTestId("openstack-project-runs")]);
  });

  test("a stack's What this stack owns", async ({ page }: { page: Page }) => {
    await page.goto(
      `${partPath("stacks", "733396c7-a790-4b41-9bfe-59a3342a517d")}?estate=magnum`,
    );

    await expectCardsFit(page, [page.getByTestId("openstack-stack-owns")]);
  });

  test("Capacity: what is short, by flavor, and allocation beside real use", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "capacity", "recording=gazpacho-ovs/healthy");

    await expectCardsFit(page, [
      page.getByTestId("openstack-capacity-nothing-short"),
      page.getByTestId("openstack-capacity-no-real-usage"),
    ]);

    await atLaptopWidth(page);
    await openCloudPage(page, "capacity", "capacity=short");

    await expectCardsFit(page, [page.getByTestId("openstack-capacity-short")]);
  });
});
