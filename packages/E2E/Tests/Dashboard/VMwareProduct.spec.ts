import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
  submitIngestionKeyModal,
} from "./Helpers/ProductOnboarding";
import { selectMonitorTypeCard } from "./Helpers/Monitors";

/*
 * Telemetry ingestion keys are 36-char UUIDs (ObjectID.generate()), so a
 * match here proves a real key was interpolated into the install command
 * instead of the <YOUR_API_KEY> placeholder. The VMware agent's .env reads
 * the key from ONEUPTIME_TELEMETRY_INGESTION_KEY (VMwareAgent/docker-compose.yml).
 */
const ingestionKeyEnvLineRegex: RegExp =
  /ONEUPTIME_TELEMETRY_INGESTION_KEY=([0-9a-fA-F-]{36})/;

/*
 * VMware product onboarding path (mirrors ProxmoxProduct.spec.ts).
 *
 * Skip-gated to match the other Dashboard specs (CreateProject.spec.ts /
 * CreateMonitor.spec.ts) so CI behavior stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/VMwareProduct.spec.ts --project=chromium
 *
 * No live vCenter or VMware agent is required: the "Connected" test posts a
 * minimal OTLP/JSON fixture straight to /otlp/v1/metrics itself.
 */
test.describe.skip("VMware Product Onboarding", () => {
  test("should surface VMware in the nav, render the install guide with an ingestion key, and offer VMware monitor templates", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E VMware Project",
    });

    // Nav entry: VMware is listed in the "Products" navbar menu.
    await page.getByRole("button", { name: "Products" }).click();
    const vmwareNavOption: Locator = page
      .getByRole("option")
      .filter({ hasText: "VMware" });
    await expect(vmwareNavOption).toBeVisible({ timeout: 30000 });
    await vmwareNavOption.click();
    await page.waitForURL(new RegExp(`/dashboard/${projectId}/vmware`), {
      timeout: 30000,
    });

    // Empty state renders the DocumentationCard install guide.
    await expect(
      page.getByText("Getting Started with VMware Monitoring"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("No ingestion keys yet")).toBeVisible({
      timeout: 30000,
    });

    // Create a telemetry ingestion key from the inline ModelFormModal.
    const keyName: string = "E2E VMware Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({ page, keyName });

    // The new key is selected in the dropdown...
    await expect(page.getByText(keyName).first()).toBeVisible({
      timeout: 30000,
    });

    // ...and the install command block interpolates URL, key, and vCenter name.
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
    expect(bodyText).toContain("VMWARE_VCENTER_NAME=my-vcenter");
    expect(bodyText).toContain("docker compose up -d");
    expect(bodyText).not.toContain("<YOUR_API_KEY>");

    // A second key created via "New Key" becomes the selected key.
    const secondKeyName: string =
      "E2E VMware Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "New Key" }).click();
    await submitIngestionKeyModal({ page, keyName: secondKeyName });
    await expect(page.getByText(secondKeyName).first()).toBeVisible({
      timeout: 30000,
    });

    // Monitor creation offers the VMware type with the template picker.
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
      .fill("E2E VMware Monitor " + Faker.generateName().toString());

    await selectMonitorTypeCard({ page, cardValue: "VMware" });

    /*
     * The submit button keeps the "Create Monitor" test id on every form
     * step (BasicForm uses props.submitButtonText as the test id); on the
     * first step it reads "Next" and advances to the criteria step.
     */
    await page.getByTestId("Create Monitor").click();

    await expect(page.getByText("VMware Monitor Configuration")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Quick Setup")).toBeVisible();

    /*
     * Every template VMwareTemplatePicker renders — all 23 from
     * Common/Types/Monitor/VMwareAlertTemplates.ts (getAllVMwareAlertTemplates),
     * in catalog order: Host, Virtual Machine, Datastore, Cluster,
     * Datacenter, vSAN and the resource-pool template.
     */
    const expectedTemplateNames: Array<string> = [
      "Host CPU Saturation",
      "Host Memory Saturation",
      "Host Disk Latency High",
      "Host Network Packet Errors",
      "Host Network Packet Drops",
      "VM CPU Saturation",
      "VM CPU Ready Contention",
      "VM Memory Saturation",
      "VM Memory Ballooning",
      "VM Memory Swapping",
      "VM Disk Latency High",
      "VM Disk Usage High",
      "Datastore Capacity Warning",
      "Datastore Capacity Critical",
      "Cluster Host Not Effective",
      "Datacenter Hosts Unhealthy",
      "Datacenter Hosts Degraded",
      "Datacenter Hosts Powered Off",
      "Datacenter VMs Unhealthy",
      "Datacenter Clusters Unhealthy",
      "vSAN Latency High",
      "vSAN Congestion",
      "Resource Pool Memory Swapped",
    ];

    for (const templateName of expectedTemplateNames) {
      await expect(page.getByText(templateName, { exact: true })).toBeVisible();
    }

    // Selecting a template auto-configures the monitor step.
    await page.getByText("Host CPU Saturation", { exact: true }).click();
    await expect(page.getByText("Template Configuration")).toBeVisible();
  });

  /*
   * Post a minimal OTLP metrics fixture with the ingestion key minted above
   * and assert the vCenters page flips from the install guide to a Connected
   * vCenter row without a reload (exercises the first-data poll).
   */
  test("should flip the empty state to a Connected vCenter row when first OTLP metrics arrive", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E VMware OTLP Project",
    });

    const vmwarePageUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/vmware`)
      .toString();
    await gotoProjectPage({
      page,
      projectId,
      url: vmwarePageUrl,
      ready: page.getByText("Getting Started with VMware Monitoring"),
    });

    // Mint a key, then read the interpolated secret back out of the guide.
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({
      page,
      keyName: "E2E VMware OTLP Key " + Faker.generateName().toString(),
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

    const vcenterName: string =
      "e2e-vcenter-" + Faker.generateName().toString().toLowerCase();

    /*
     * Minimal OTLP/JSON fixture: one vcenter.host.cpu.utilization gauge
     * point on an ESXi host resource, stamped with the vmware.vcenter.name
     * resource attribute — the same shape the VMware agent's `vcenter`
     * receiver + resource processor emit (identity lives in RESOURCE
     * attributes: vcenter.datacenter.name / vcenter.cluster.name /
     * vcenter.host.name). The snapshot scan upserts the VMwareVCenter row
     * and one Host inventory row from this single batch.
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
                  key: "vmware.vcenter.name",
                  value: { stringValue: vcenterName },
                },
                {
                  key: "vcenter.datacenter.name",
                  value: { stringValue: "e2e-datacenter" },
                },
                {
                  key: "vcenter.cluster.name",
                  value: { stringValue: "e2e-cluster" },
                },
                {
                  key: "vcenter.host.name",
                  value: { stringValue: "esxi01.e2e.example.com" },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "e2e-vmware-fixture" },
                metrics: [
                  {
                    name: "vcenter.host.cpu.utilization",
                    unit: "%",
                    gauge: {
                      dataPoints: [
                        {
                          asDouble: 42.5,
                          timeUnixNano: timeUnixNano,
                          attributes: [],
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
     * No reload on purpose: the vCenters page re-counts every 10 seconds
     * while empty and must flip to the table on its own. Ingestion is
     * queued, so allow generous time for the worker plus the poll tick.
     */
    await expect(page.getByText(vcenterName, { exact: true })).toBeVisible({
      timeout: 120000,
    });
    await expect(
      page.getByText("Connected", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
