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
 * instead of the <YOUR_API_KEY> placeholder. The Docker Swarm agent reads
 * the key from ONEUPTIME_SERVICE_TOKEN (not ONEUPTIME_TELEMETRY_INGESTION_KEY
 * like the host/k8s agents).
 */
const serviceTokenEnvLineRegex: RegExp =
  /ONEUPTIME_SERVICE_TOKEN=([0-9a-fA-F-]{36})/;

/*
 * Docker Swarm product onboarding path (mirrors ProxmoxProduct.spec.ts).
 *
 * Skip-gated to match the other Dashboard specs (CreateProject.spec.ts /
 * CreateMonitor.spec.ts) so CI behavior stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/DockerSwarmProduct.spec.ts --project=chromium
 *
 * No live Docker Swarm agent is required: the "Connected" test posts a
 * minimal OTLP/JSON fixture straight to /otlp/v1/metrics itself.
 */
test.describe.skip("Docker Swarm Product Onboarding", () => {
  test("should surface Docker Swarm in the nav, render the install guide with an ingestion key, and offer Docker Swarm monitor templates", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Docker Swarm Project",
    });

    // Nav entry: Docker Swarm is listed in the "Products" navbar menu.
    await page.getByRole("button", { name: "Products" }).click();
    const dockerSwarmNavOption: Locator = page
      .getByRole("option")
      .filter({ hasText: "Docker Swarm" });
    await expect(dockerSwarmNavOption).toBeVisible({ timeout: 30000 });
    await dockerSwarmNavOption.click();
    await page.waitForURL(new RegExp(`/dashboard/${projectId}/docker-swarm`), {
      timeout: 30000,
    });

    // Empty state renders the DocumentationCard install guide.
    await expect(
      page.getByText("Getting Started with Docker Swarm Monitoring"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("No ingestion keys yet")).toBeVisible({
      timeout: 30000,
    });

    // Create a telemetry ingestion key from the inline ModelFormModal.
    const keyName: string =
      "E2E Docker Swarm Key " + Faker.generateName().toString();
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
      .toMatch(serviceTokenEnvLineRegex);

    const bodyText: string = await page.locator("body").innerText();
    expect(bodyText).toMatch(/ONEUPTIME_URL=http/);
    expect(bodyText).toContain("DOCKER_SWARM_CLUSTER_NAME=my-swarm");
    expect(bodyText).toContain("docker compose up -d");
    expect(bodyText).not.toContain("<YOUR_API_KEY>");

    // A second key created via "New Key" becomes the selected key.
    const secondKeyName: string =
      "E2E Docker Swarm Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "New Key" }).click();
    await submitIngestionKeyModal({ page, keyName: secondKeyName });
    await expect(page.getByText(secondKeyName).first()).toBeVisible({
      timeout: 30000,
    });

    // Monitor creation offers the Docker Swarm type with the template picker.
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
      .fill("E2E Docker Swarm Monitor " + Faker.generateName().toString());

    await expect(
      page.getByTestId("card-select-option-Docker Swarm"),
    ).toBeVisible();
    await page.getByTestId("card-select-option-Docker Swarm").click();

    /*
     * The submit button keeps the "Create Monitor" test id on every form
     * step (BasicForm uses props.submitButtonText as the test id); on the
     * first step it reads "Next" and advances to the criteria step.
     */
    await page.getByTestId("Create Monitor").click();

    await expect(
      page.getByText("Docker Swarm Monitor Configuration"),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Quick Setup")).toBeVisible();

    /*
     * Every template DockerSwarmTemplatePicker renders — all 4 from
     * Common/Types/Monitor/DockerSwarmAlertTemplates.ts across the
     * Availability / Resource / Container categories.
     */
    const expectedTemplateNames: Array<string> = [
      "Task Down (Low Uptime)",
      "High Task CPU Usage",
      "High Task Memory Usage",
      "High Task Process Count",
    ];

    for (const templateName of expectedTemplateNames) {
      await expect(page.getByText(templateName, { exact: true })).toBeVisible();
    }

    // Selecting a template auto-configures the monitor step.
    await page.getByText("Task Down (Low Uptime)", { exact: true }).click();
    await expect(page.getByText("Template Configuration")).toBeVisible();
  });

  /*
   * Stretch: post a minimal OTLP metrics fixture with the ingestion key
   * minted above and assert the clusters page flips from the install guide to
   * a Connected cluster row without a reload (exercises the first-data poll).
   */
  test("should flip the empty state to a Connected cluster row when first OTLP metrics arrive", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Docker Swarm OTLP Project",
    });

    const dockerSwarmPageUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/docker-swarm`)
      .toString();
    await gotoProjectPage({
      page,
      projectId,
      url: dockerSwarmPageUrl,
      ready: page.getByText("Getting Started with Docker Swarm Monitoring"),
    });

    // Mint a key, then read the interpolated secret back out of the guide.
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({
      page,
      keyName: "E2E Docker Swarm OTLP Key " + Faker.generateName().toString(),
    });

    await expect
      .poll(
        async () => {
          return await page.locator("body").innerText();
        },
        { timeout: 30000 },
      )
      .toMatch(serviceTokenEnvLineRegex);

    const bodyText: string = await page.locator("body").innerText();
    const ingestionKey: string = bodyText.match(serviceTokenEnvLineRegex)![1]!;

    const clusterName: string =
      "e2e-swarm-" + Faker.generateName().toString().toLowerCase();

    /*
     * Minimal OTLP/JSON fixture: one container.uptime gauge point on a task
     * container, stamped with the docker.swarm.cluster.name resource
     * attribute — the same shape the Docker Swarm agent's resource processor
     * emits. The snapshot scan upserts the DockerSwarmCluster row from this
     * single batch.
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
                  key: "docker.swarm.cluster.name",
                  value: { stringValue: clusterName },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "e2e-docker-swarm-fixture" },
                metrics: [
                  {
                    name: "container.uptime",
                    gauge: {
                      dataPoints: [
                        {
                          asDouble: 120,
                          timeUnixNano: timeUnixNano,
                          attributes: [
                            {
                              key: "container.name",
                              value: { stringValue: "web.1.abc123" },
                            },
                            {
                              key: "container.image.name",
                              value: { stringValue: "nginx:latest" },
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
     * while empty and must flip to the table on its own. Ingestion is queued,
     * so allow generous time for the worker plus the poll tick.
     */
    await expect(page.getByText(clusterName, { exact: true })).toBeVisible({
      timeout: 120000,
    });
    await expect(
      page.getByText("Connected", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
