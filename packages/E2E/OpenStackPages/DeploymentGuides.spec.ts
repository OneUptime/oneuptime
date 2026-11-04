import { Locator, Page } from "@playwright/test";
import {
  CLOUD_PATH,
  VIEWPORTS,
  expect,
  screenshot,
  test,
} from "./Helpers";

/*
 * THE SETUP GUIDE ASKS ONE QUESTION.
 *
 * "How do you deploy OpenStack?", as the OpenShift preset asks where a cluster runs. Each
 * answer gives that tool's commands and says how far they have been tested, and "not sure"
 * gives the general steps. OpenStackDeploymentGuides.test.ts holds the words to each tool's
 * source: this holds what a person sees of them, on a laptop and on a phone.
 */

const QUESTION: string = "How do you deploy OpenStack?";
const INSTALL_QUESTION: string = "How do you want to install the agent?";

async function openGuide(page: Page): Promise<void> {
  await page.goto(`${CLOUD_PATH}/documentation`);
  await expect(question(page)).toBeVisible();
}

function question(page: Page): Locator {
  return page.getByRole("radiogroup", { name: QUESTION });
}

function answer(page: Page, label: string): Locator {
  return question(page).getByRole("radio", { name: label });
}

async function pick(page: Page, label: string): Promise<void> {
  await answer(page, label).click();
  await expect(answer(page, label)).toBeChecked();
}

test.describe("How do you deploy OpenStack?", () => {
  test("asks it first, and each tool is an answer of its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuide(page);

    for (const label of [
      "Kolla-Ansible",
      "OpenStack-Ansible",
      "OpenStack-Helm",
      "Atmosphere",
      "Canonical Sunbeam",
      "Red Hat OpenStack on OpenShift",
      "Mirantis MOSK",
      "Not sure, or something else",
    ]) {
      await expect(answer(page, label)).toBeVisible();
    }

    await screenshot(page, "deployment-guides-question-1280");
  });

  test("not sure is where it opens, and gives the general steps with no tool's words", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuide(page);

    await expect(answer(page, "Not sure, or something else")).toBeChecked();
    await expect(page.getByText("Choose an ingestion key")).toBeVisible();
    await expect(page.getByText("Create the agent's credential")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Install the agent$/ }),
    ).toBeVisible();
    await expect(page.getByText(INSTALL_QUESTION)).toBeVisible();
    await expect(
      page.getByText("How far this guide has been tested"),
    ).toHaveCount(0);
    await expect(page.getByText("/etc/kolla")).toHaveCount(0);
  });

  test("Kolla-Ansible's says how far it has been tested, and adds its own ways in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuide(page);
    await pick(page, "Kolla-Ansible");

    await expect(
      page.getByText("How far this guide has been tested"),
    ).toBeVisible();
    await expect(page.getByText("Forward what is already firing")).toBeVisible();
    await expect(page.getByText("Watch what the cloud stands on")).toBeVisible();
    await expect(page.getByText(INSTALL_QUESTION)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Kolla's exporter" })).toHaveCount(
      1,
    );

    await screenshot(page, "deployment-guides-kolla-1280");
  });

  test("OpenStack-Ansible's says where its logs are", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuide(page);
    await pick(page, "OpenStack-Ansible");

    await expect(
      page.getByText("How far this guide has been tested"),
    ).toBeVisible();
    await expect(page.getByText("Collect the services' logs")).toBeVisible();
    await expect(page.getByText("journald").first()).toBeVisible();

    await screenshot(page, "deployment-guides-osa-1280");
  });

  test("a tool a probe reads asks nothing about installing an agent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuide(page);

    for (const label of [
      "OpenStack-Helm",
      "Atmosphere",
      "Red Hat OpenStack on OpenShift",
      "Mirantis MOSK",
    ]) {
      await pick(page, label);

      await expect(page.getByText(INSTALL_QUESTION)).toHaveCount(0);
      // Nothing here sends telemetry, so there is no key to choose.
      await expect(page.getByText("Choose an ingestion key")).toHaveCount(0);
      await expect(page.getByText("Read the APIs with a probe")).toBeVisible();
      await expect(
        page.getByText("How far this guide has been tested"),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /Install the agent$/ }),
      ).toHaveCount(0);
    }

    await screenshot(page, "deployment-guides-mosk-1280");
  });

  test("going back to not sure takes every tool's words away again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuide(page);
    await pick(page, "Kolla-Ansible");
    await pick(page, "Not sure, or something else");

    await expect(page.getByText("/etc/kolla")).toHaveCount(0);
    await expect(
      page.getByText("How far this guide has been tested"),
    ).toHaveCount(0);
  });

  for (const viewport of VIEWPORTS) {
    test(`fits a ${viewport.width} pixel wide screen, whichever tool is picked`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);
      await openGuide(page);

      for (const label of [
        "Kolla-Ansible",
        "OpenStack-Ansible",
        "Mirantis MOSK",
      ]) {
        await pick(page, label);

        const overflow: number = await page.evaluate((): number => {
          return (
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
          );
        });

        expect(overflow).toBeLessThanOrEqual(0);
      }

      if (viewport.width === 390) {
        await screenshot(page, "deployment-guides-phone-390");
      }
    });
  }
});
