import { Locator, Page } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { VIEWPORTS, expect, openCloudPage, screenshot, test } from "./Helpers";

/*
 * What a cloud stands on: one line each for RabbitMQ, MariaDB, Memcached, HAProxy, OVN and
 * libvirt, a page per dependency, and trouble there reaching Needs attention.
 *
 * Made up (`?estate=control-plane`), in the shape the scan writes: what real clusters said when
 * broken is what OpenStackControlPlaneHealth.test.ts and OpenStackControlPlanePages.test.tsx read.
 * The line that matters here is the one that says nobody is reading something.
 */

function item(page: Page, dependency: string): Locator {
  return page.locator(
    `[data-testid="openstack-control-plane-card-item"][data-dependency="${dependency}"]`,
  );
}

async function openControlPlane(page: Page, query: string): Promise<void> {
  await openCloudPage(page, "control-plane", query);
  await expect(item(page, "rabbitmq")).not.toHaveAttribute(
    "data-state",
    "Loading",
  );
}

test.describe("what the cloud stands on", () => {
  test("a cloud that names nothing says not watched on every line, and never that it is fine", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openControlPlane(page, "estate=calm");

    for (const dependency of [
      "rabbitmq",
      "mariadb",
      "memcached",
      "haproxy",
      "network",
      "libvirt",
    ]) {
      await expect(item(page, dependency)).toHaveAttribute(
        "data-state",
        "NotWatched",
      );
      await expect(
        item(page, dependency).getByTestId("openstack-control-plane-state"),
      ).toHaveText("Not watched");
    }

    await expect(
      item(page, "rabbitmq").getByTestId("openstack-control-plane-card-line"),
    ).toHaveText("Name its targets in OPENSTACK_RABBITMQ_TARGETS to read it.");
  });

  test("each line says how that one is, and what nobody named stays not watched", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openControlPlane(page, "estate=control-plane");

    await expect(item(page, "rabbitmq")).toHaveAttribute(
      "data-state",
      "Broken",
    );
    await expect(
      item(page, "rabbitmq").getByTestId("openstack-control-plane-card-line"),
    ).toHaveText("Every node is down");
    await expect(item(page, "mariadb")).toHaveAttribute(
      "data-state",
      "NeedsALook",
    );
    await expect(item(page, "memcached")).toHaveAttribute("data-state", "Fine");
    await expect(item(page, "network")).toHaveAttribute("data-state", "Broken");
    await expect(item(page, "haproxy")).toHaveAttribute(
      "data-state",
      "NotWatched",
    );
    await expect(item(page, "libvirt")).toHaveAttribute(
      "data-state",
      "NotWatched",
    );

    await screenshot(page, "control-plane-card");
  });

  test("a dependency's page says what it takes down, each machine, and where to go deeper", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "control-plane/rabbitmq", "estate=control-plane");

    await expect(
      page.getByTestId("openstack-control-plane-takes-down"),
    ).toContainText("Every OpenStack service talks through RabbitMQ");
    await expect(
      page.getByTestId("openstack-control-plane-machine"),
    ).toHaveCount(3);
    await expect(
      page.getByTestId("openstack-control-plane-deeper").getByRole("link"),
    ).toHaveText("Queues");

    await openCloudPage(page, "control-plane/libvirt", "estate=control-plane");

    await expect(
      page.getByTestId("openstack-control-plane-not-watched"),
    ).toContainText("OPENSTACK_LIBVIRT_HEALTH_TARGETS");
    await expect(
      page.getByTestId("openstack-control-plane-machine"),
    ).toHaveCount(0);
  });

  test("trouble under the cloud reaches Needs attention on its Overview", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", "estate=control-plane");

    const card: Locator = page.getByTestId("openstack-needs-attention");

    await expect(card).toContainText("RabbitMQ");
    await expect(card).toContainText("ovn-controller isn't answering");
  });

  for (const viewport of VIEWPORTS) {
    test(`at ${viewport.width} pixels nothing runs off the page`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);
      await openControlPlane(page, "estate=control-plane");
      await expectNoSidewaysScroll(page);
    });
  }
});
