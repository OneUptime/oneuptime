import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
  submitIngestionKeyModal,
} from "./Helpers/ProductOnboarding";
import { clickNext, selectMonitorTypeCard } from "./Helpers/Monitors";
import { openProductsMenuSection } from "./Helpers/ProductsMenu";

/*
 * Telemetry ingestion keys are 36-char UUIDs (ObjectID.generate()), so a
 * match here proves a real key was interpolated into the install command
 * instead of the <YOUR_API_KEY> placeholder. The Storage Array agent's .env
 * reads the key from ONEUPTIME_TELEMETRY_INGESTION_KEY
 * (agents/StorageArrayAgent/docker-compose.yml).
 */
const ingestionKeyEnvLineRegex: RegExp =
  /ONEUPTIME_TELEMETRY_INGESTION_KEY=([0-9a-fA-F-]{36})/;

/*
 * Storage Arrays product onboarding path (mirrors CephProduct.spec.ts and
 * VMwareProduct.spec.ts).
 *
 * Skip-gated to match the other Dashboard specs (CreateProject.spec.ts /
 * CreateMonitor.spec.ts) so CI behavior stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/StorageArrayProduct.spec.ts --project=chromium
 *
 * No live FlashArray, FlashBlade or Storage Array agent is required: the
 * "Connected" test posts a minimal OTLP/JSON fixture straight to
 * /otlp/v1/metrics itself.
 */
test.describe.skip("Storage Arrays Product Onboarding", () => {
  test("should surface Storage Arrays in the nav, render the install guide with an ingestion key per platform, and offer storage array monitor templates", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Storage Array Project",
    });

    /*
     * Nav entry: Storage Arrays is listed in the "Products" navbar menu,
     * under Infrastructure, which the menu opens folded.
     */
    await page.getByRole("button", { name: "Products" }).click();
    await openProductsMenuSection(page, "Infrastructure");
    const storageArraysNavOption: Locator = page
      .getByRole("option")
      .filter({ hasText: "Storage Arrays" });
    await expect(storageArraysNavOption).toBeVisible({ timeout: 30000 });
    await storageArraysNavOption.click();
    await page.waitForURL(
      new RegExp(`/dashboard/${projectId}/storage-arrays`),
      {
        timeout: 30000,
      },
    );

    // Empty state renders the setup guide (SetupGuideCard).
    await expect(
      page.getByText("Getting Started with Storage Array Monitoring"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("No ingestion keys yet")).toBeVisible({
      timeout: 30000,
    });

    // The guide asks which array first, and opens on a FlashArray.
    const platforms: Locator = page.getByRole("radiogroup", {
      name: "Which array are you connecting?",
    });
    await expect(platforms).toBeVisible();
    await expect(platforms.getByRole("radio")).toHaveCount(3);
    await expect(platforms.getByRole("radio").first()).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Create a telemetry ingestion key from the inline ModelFormModal.
    const keyName: string =
      "E2E Storage Array Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({ page, keyName });

    // The new key is selected in the dropdown...
    await expect(page.getByText(keyName).first()).toBeVisible({
      timeout: 30000,
    });

    /*
     * ...and the guide interpolates it. It opens on the install script,
     * whose command carries the URL, the key and the FlashArray's
     * collector config; the .env file with the array's name is on the
     * Docker Compose tab of the install step.
     */
    await expect
      .poll(
        async () => {
          return await page.locator("body").innerText();
        },
        { timeout: 30000 },
      )
      .toMatch(ingestionKeyEnvLineRegex);

    let bodyText: string = await page.locator("body").innerText();
    expect(bodyText).toContain(
      "STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml bash install.sh",
    );
    expect(bodyText).toContain("Check the array serves its own metrics");

    await page.getByRole("tab", { name: "Docker Compose" }).click();

    bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/ONEUPTIME_URL=http/);
    expect(bodyText).toContain("STORAGE_ARRAY_NAME=my-storage-array");
    expect(bodyText).toContain("STORAGE_SYSTEM=purestorage.flasharray");
    expect(bodyText).toContain("docker compose up -d");
    expect(bodyText).not.toContain("<YOUR_API_KEY>");

    /*
     * Picking FlashBlade swaps the whole guide to Pure's FlashBlade
     * exporter: its collector config, its compose profile, and no native
     * endpoint check.
     */
    await platforms.getByRole("radio").nth(2).click();
    await expect(platforms.getByRole("radio").nth(2)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The collector config is named on both install tabs.
    await expect
      .poll(
        async () => {
          return await page.locator("body").innerText();
        },
        { timeout: 30000 },
      )
      .toContain("otel-collector-config.flashblade.yaml");

    await page.getByRole("tab", { name: "Docker Compose" }).click();

    bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("COMPOSE_PROFILES=flashblade");
    expect(bodyText).toContain("STORAGE_SYSTEM=purestorage.flashblade");
    expect(bodyText).not.toContain("Check the array serves its own metrics");

    // A second key created via "New Key" becomes the selected key.
    const secondKeyName: string =
      "E2E Storage Array Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "New Key" }).click();
    await submitIngestionKeyModal({ page, keyName: secondKeyName });
    await expect(page.getByText(secondKeyName).first()).toBeVisible({
      timeout: 30000,
    });

    // Monitor creation offers the Storage Array type with the template picker.
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
      .fill("E2E Storage Array Monitor " + Faker.generateName().toString());

    await selectMonitorTypeCard({ page, cardValue: "Storage Array" });

    /*
     * Monitor Info is not the last step: its one way on is a plain Next
     * (Create Monitor is on the last step only), which opens the criteria.
     */
    await clickNext({ page });

    await expect(
      page.getByText("Storage Array Monitor Configuration"),
    ).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Quick Setup")).toBeVisible();

    /*
     * No array is picked yet, so its platform is unknown and every
     * template from Common/Types/Monitor/StorageArrayAlertTemplates.ts is
     * offered, each named with its platform - FlashArray and FlashBlade
     * both have a "Critical Array Alert" (getStorageArrayAlertTemplatesForSystem).
     */
    const expectedTemplateNames: Array<string> = [
      // FlashArray
      "Critical Array Alert (FlashArray)",
      "Warning Array Alert (FlashArray)",
      "Capacity Above 80% (FlashArray)",
      "Capacity Above 90% (FlashArray)",
      "High Read Latency (FlashArray)",
      "High Write Latency (FlashArray)",
      "Hardware Component Failed (FlashArray)",
      "Hardware Component Degraded (FlashArray)",
      "Drive Failed (FlashArray)",
      "Host Lost Redundant Paths (FlashArray)",
      "Replication Lag Above 1 Minute (FlashArray)",
      // FlashBlade
      "Critical Array Alert (FlashBlade)",
      "Warning Array Alert (FlashBlade)",
      "Capacity Above 80% (FlashBlade)",
      "Capacity Above 90% (FlashBlade)",
      "Hardware Component Unhealthy (FlashBlade)",
      "High Read Latency (FlashBlade)",
      "File System Near Full (FlashBlade)",
    ];

    for (const templateName of expectedTemplateNames) {
      await expect(page.getByText(templateName, { exact: true })).toBeVisible();
    }

    // Selecting a template auto-configures the monitor step.
    await page
      .getByText("Critical Array Alert (FlashArray)", { exact: true })
      .click();
    await expect(page.getByText("Template Configuration")).toBeVisible();
  });

  /*
   * Post a minimal OTLP metrics fixture with the ingestion key minted on
   * the page and assert the Storage Arrays page flips from the install
   * guide to a Connected FlashArray row without a reload (the 10-second
   * first-data poll), then that the array's own pages follow its platform.
   */
  test("should flip the empty state to a Connected FlashArray row when first OTLP metrics arrive", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Storage Array OTLP Project",
    });

    const storageArraysPageUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/storage-arrays`)
      .toString();
    await gotoProjectPage({
      page,
      projectId,
      url: storageArraysPageUrl,
      ready: page.getByText("Getting Started with Storage Array Monitoring"),
    });

    // Mint a key, then read the interpolated secret back out of the guide.
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({
      page,
      keyName: "E2E Storage Array OTLP Key " + Faker.generateName().toString(),
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

    const arrayName: string =
      "e2e-array-" + Faker.generateName().toString().toLowerCase();

    /*
     * Minimal OTLP/JSON fixture: one purefa_array_space_utilization gauge
     * point stamped with the storage.array.name and storage.system
     * resource attributes - the same shape the Storage Array agent's
     * resource processor emits. The ingest registers the array from this
     * single batch, and the purefa_ prefix tells it the platform.
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
                  key: "storage.array.name",
                  value: { stringValue: arrayName },
                },
                {
                  key: "storage.system",
                  value: { stringValue: "purestorage.flasharray" },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "e2e-storage-array-fixture" },
                metrics: [
                  {
                    name: "purefa_array_space_utilization",
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
     * No reload on purpose: the Storage Arrays page re-counts every 10
     * seconds while empty and must flip to the table on its own. Ingestion
     * is queued, so allow generous time for the worker plus the poll tick.
     */
    const arrayLink: Locator = page.getByText(arrayName, { exact: true });
    await expect(arrayLink).toBeVisible({ timeout: 120000 });
    await expect(
      page.getByText("Connected", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText("Pure Storage FlashArray", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });

    /*
     * The array's side menu follows its platform: a FlashArray's volumes,
     * hosts and hardware, and none of a FlashBlade's file systems.
     */
    await arrayLink.click();
    await page.waitForURL(
      new RegExp(`/dashboard/${projectId}/storage-arrays/[0-9a-f-]{36}`),
      { timeout: 30000 },
    );
    const sideMenu: Locator = page.locator(
      "aside[role='navigation'][aria-label='Main navigation']",
    );
    // An inventory item's name may carry its count badge after the title.
    for (const item of ["Volumes", "Hosts", "Hardware"]) {
      await expect(
        sideMenu.getByRole("link", { name: new RegExp(`^${item}\\b`) }),
      ).toBeVisible({ timeout: 30000 });
    }
    await expect(
      sideMenu.getByRole("link", { name: /^File Systems\b/ }),
    ).toHaveCount(0);
    await expect(
      sideMenu.getByRole("link", { name: /^Buckets\b/ }),
    ).toHaveCount(0);
  });
});
