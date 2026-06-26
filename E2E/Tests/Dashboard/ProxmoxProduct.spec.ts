import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
  submitIngestionKeyModal,
} from "./Helpers/ProductOnboarding";

/*
 * Telemetry ingestion keys are 36-char UUIDs (ObjectID.generate()), so a
 * match here proves a real key was interpolated into the install command
 * instead of the <YOUR_API_KEY> placeholder.
 */
const ingestionKeyEnvLineRegex: RegExp =
  /ONEUPTIME_TELEMETRY_INGESTION_KEY=([0-9a-fA-F-]{36})/;

/*
 * WI-22: Proxmox product onboarding path.
 *
 * Skip-gated to match the other Dashboard specs (CreateProject.spec.ts /
 * CreateMonitor.spec.ts) so CI behavior stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/ProxmoxProduct.spec.ts --project=chromium
 *
 * No live Proxmox agent is required: the "Connected" test posts a minimal
 * OTLP/JSON fixture straight to /otlp/v1/metrics itself.
 */
test.describe.skip("Proxmox Product Onboarding", () => {
  test("should surface Proxmox in the nav, render the install guide with an ingestion key, and offer Proxmox monitor templates", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Proxmox Project",
    });

    // Nav entry: Proxmox is listed in the "Products" navbar menu.
    await page.getByRole("button", { name: "Products" }).click();
    const proxmoxNavOption: Locator = page
      .getByRole("option")
      .filter({ hasText: "Proxmox" });
    await expect(proxmoxNavOption).toBeVisible({ timeout: 30000 });
    await proxmoxNavOption.click();
    await page.waitForURL(new RegExp(`/dashboard/${projectId}/proxmox`), {
      timeout: 30000,
    });

    // Empty state renders the DocumentationCard install guide.
    await expect(
      page.getByText("Getting Started with Proxmox Monitoring"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("No ingestion keys yet")).toBeVisible({
      timeout: 30000,
    });

    // Create a telemetry ingestion key from the inline ModelFormModal.
    const keyName: string =
      "E2E Proxmox Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({ page, keyName });

    // The new key is selected in the dropdown...
    await expect(page.getByText(keyName).first()).toBeVisible({
      timeout: 30000,
    });

    // ...and the install command block interpolates URL, key, and cluster name.
    await expect
      .poll(
        async () => {
          return await page.locator("body").innerText();
        },
        { timeout: 30000 },
      )
      .toMatch(ingestionKeyEnvLineRegex);

    const bodyText: string = await page.locator("body").innerText();
    expect(bodyText).toMatch(/ONEUPTIME_URL=http/);
    expect(bodyText).toContain("PROXMOX_CLUSTER_NAME=my-proxmox-cluster");
    expect(bodyText).toContain("docker compose up -d");
    expect(bodyText).not.toContain("<YOUR_API_KEY>");

    // A second key created via "New Key" becomes the selected key.
    const secondKeyName: string =
      "E2E Proxmox Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "New Key" }).click();
    await submitIngestionKeyModal({ page, keyName: secondKeyName });
    await expect(page.getByText(secondKeyName).first()).toBeVisible({
      timeout: 30000,
    });

    // Monitor creation offers the Proxmox type with the template picker.
    const monitorCreateUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/monitors/create`)
      .toString();
    await gotoProjectPage({
      page,
      projectId,
      url: monitorCreateUrl,
      ready: page.locator("#create-monitor-form"),
    });

    await page
      .locator("#create-monitor-form input[placeholder='Monitor Name']")
      .fill("E2E Proxmox Monitor " + Faker.generateName().toString());

    await expect(page.getByTestId("card-select-option-Proxmox")).toBeVisible();
    await page.getByTestId("card-select-option-Proxmox").click();

    /*
     * The submit button keeps the "Create Monitor" test id on every form
     * step (BasicForm uses props.submitButtonText as the test id); on the
     * first step it reads "Next" and advances to the criteria step.
     */
    await page.getByTestId("Create Monitor").click();

    await expect(page.getByText("Proxmox Monitor Configuration")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Quick Setup")).toBeVisible();

    /*
     * Every template ProxmoxTemplatePicker renders — all 11 from
     * Common/Types/Monitor/ProxmoxAlertTemplates.ts, including the V3
     * Backup ("Guest Not Backed Up", WI-24) and Replication
     * ("Replication Failing", WI-25) sections.
     */
    const expectedTemplateNames: Array<string> = [
      "Node Offline",
      "Guest Down",
      "Cluster Quorum at Risk",
      "High Node CPU Usage",
      "High Node Memory Usage",
      "High Guest CPU Usage",
      "Storage Near Full",
      "Container Root Disk Near Full",
      "HA Resource in Error State",
      "Guest Not Backed Up",
      "Replication Failing",
    ];

    for (const templateName of expectedTemplateNames) {
      await expect(page.getByText(templateName, { exact: true })).toBeVisible();
    }

    // Selecting a template auto-configures the monitor step.
    await page.getByText("Node Offline", { exact: true }).click();
    await expect(page.getByText("Template Configuration")).toBeVisible();
  });

  /*
   * Stretch (WI-22): post a minimal OTLP metrics fixture with the
   * ingestion key minted above and assert the clusters page flips from
   * the install guide to a Connected cluster row without a reload
   * (exercises the WI-18 first-data poll).
   */
  test("should flip the empty state to a Connected cluster row when first OTLP metrics arrive", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Proxmox OTLP Project",
    });

    const proxmoxPageUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/proxmox`)
      .toString();
    await gotoProjectPage({
      page,
      projectId,
      url: proxmoxPageUrl,
      ready: page.getByText("Getting Started with Proxmox Monitoring"),
    });

    // Mint a key, then read the interpolated secret back out of the guide.
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({
      page,
      keyName: "E2E Proxmox OTLP Key " + Faker.generateName().toString(),
    });

    await expect
      .poll(
        async () => {
          return await page.locator("body").innerText();
        },
        { timeout: 30000 },
      )
      .toMatch(ingestionKeyEnvLineRegex);

    const bodyText: string = await page.locator("body").innerText();
    const ingestionKey: string = bodyText.match(ingestionKeyEnvLineRegex)![1]!;

    const clusterName: string =
      "e2e-pve-" + Faker.generateName().toString().toLowerCase();

    /*
     * Minimal OTLP/JSON fixture: one pve_up gauge point on a node id,
     * stamped with the proxmox.cluster.name resource attribute — the same
     * shape the Proxmox agent's resource + transform processors emit. The
     * snapshot scan upserts the ProxmoxCluster row from this single batch.
     */
    const otlpMetricsUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute("/otlp/v1/metrics")
      .toString();
    const timeUnixNano: string = `${Date.now()}000000`;

    const otlpResponse: APIResponse = await page.request.post(otlpMetricsUrl, {
      headers: {
        "content-type": "application/json",
        "x-oneuptime-token": ingestionKey,
      },
      data: {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "proxmox.cluster.name",
                  value: { stringValue: clusterName },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "e2e-proxmox-fixture" },
                metrics: [
                  {
                    name: "pve_up",
                    gauge: {
                      dataPoints: [
                        {
                          asDouble: 1,
                          timeUnixNano: timeUnixNano,
                          attributes: [
                            {
                              key: "id",
                              value: { stringValue: "node/pve1" },
                            },
                            {
                              key: "pve.scope",
                              value: { stringValue: "node" },
                            },
                            {
                              key: "pve.type",
                              value: { stringValue: "node" },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(otlpResponse.ok()).toBe(true);

    /*
     * No reload on purpose: the clusters page re-counts every 10 seconds
     * while empty (WI-18) and must flip to the table on its own. Ingestion
     * is queued, so allow generous time for the worker plus the poll tick.
     */
    await expect(page.getByText(clusterName, { exact: true })).toBeVisible({
      timeout: 120000,
    });
    await expect(
      page.getByText("Connected", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
