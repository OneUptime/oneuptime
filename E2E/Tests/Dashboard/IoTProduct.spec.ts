import { BASE_URL } from "../../Config";
import { Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  gotoProjectPage,
  registerAndCreateProject,
  submitIngestionKeyModal,
} from "./Helpers/ProductOnboarding";

/*
 * Telemetry ingestion keys are 36-char UUIDs (ObjectID.generate()), so a
 * match here proves a real key was interpolated into the install guide
 * instead of the <YOUR_API_KEY> placeholder. The IoT quick-start passes
 * the key via the OTLP headers env:
 *   export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=<key>
 */
const ingestionKeyHeaderLineRegex: RegExp =
  /x-oneuptime-token=([0-9a-fA-F-]{36})/;

/*
 * IoT product onboarding smoke path (mirrors ProxmoxProduct.spec.ts /
 * DockerSwarmProduct.spec.ts).
 *
 * Skip-gated to match the other Dashboard specs (CreateProject.spec.ts /
 * CreateMonitor.spec.ts) so CI behavior stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/IoTProduct.spec.ts --project=chromium
 *
 * No live IoT device is required: the spec only exercises the nav entry,
 * the fleet-list empty state with the install guide, ingestion key
 * minting, and the IoT Device monitor template picker.
 */
test.describe.skip("IoT Product Onboarding", () => {
  test("should surface IoT in the nav, render the fleet page install guide with an ingestion key, and offer IoT monitor templates", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E IoT Project",
    });

    // Nav entry: IoT is listed in the "Products" navbar menu.
    await page.getByRole("button", { name: "Products" }).click();
    const iotNavOption: Locator = page
      .getByRole("option")
      .filter({ hasText: "IoT" });
    await expect(iotNavOption).toBeVisible({ timeout: 30000 });
    await iotNavOption.click();
    await page.waitForURL(new RegExp(`/dashboard/${projectId}/iot`), {
      timeout: 30000,
    });

    // Empty state renders the IoTDocumentationCard install guide.
    await expect(
      page.getByText("Getting Started with IoT Monitoring"),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("No ingestion keys yet")).toBeVisible({
      timeout: 30000,
    });

    // Create a telemetry ingestion key from the inline ModelFormModal.
    const keyName: string = "E2E IoT Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await submitIngestionKeyModal({ page, keyName });

    // The new key is selected in the dropdown...
    await expect(page.getByText(keyName).first()).toBeVisible({
      timeout: 30000,
    });

    // ...and the quick-start interpolates endpoint, key, and fleet attrs.
    await expect
      .poll(
        async () => {
          return await page.locator("body").innerText();
        },
        { timeout: 30000 },
      )
      .toMatch(ingestionKeyHeaderLineRegex);

    const bodyText: string = await page.locator("body").innerText();
    expect(bodyText).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT=http/);
    expect(bodyText).toContain(
      "iot.fleet.name=building-a-sensors,device.id=sensor-001",
    );
    expect(bodyText).not.toContain("<YOUR_API_KEY>");

    // A second key created via "New Key" becomes the selected key.
    const secondKeyName: string =
      "E2E IoT Key " + Faker.generateName().toString();
    await page.getByRole("button", { name: "New Key" }).click();
    await submitIngestionKeyModal({ page, keyName: secondKeyName });
    await expect(page.getByText(secondKeyName).first()).toBeVisible({
      timeout: 30000,
    });

    // Monitor creation offers the IoT Device type with the template picker.
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
      .fill("E2E IoT Monitor " + Faker.generateName().toString());

    await expect(
      page.getByTestId("card-select-option-IoT Device"),
    ).toBeVisible();
    await page.getByTestId("card-select-option-IoT Device").click();

    /*
     * The submit button keeps the "Create Monitor" test id on every form
     * step (BasicForm uses props.submitButtonText as the test id); on the
     * first step it reads "Next" and advances to the criteria step.
     */
    await page.getByTestId("Create Monitor").click();

    await expect(page.getByText("IoT Monitor Configuration")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Quick Setup")).toBeVisible();

    /*
     * Every template IoTTemplatePicker renders — all 5 from
     * Common/Types/Monitor/IotAlertTemplates.ts across the
     * Availability / Battery / Connectivity / Environment / Health
     * categories.
     */
    const expectedTemplateNames: Array<string> = [
      "Device Offline",
      "Low Battery",
      "Weak Signal",
      "High Temperature",
      "High CPU Usage",
    ];

    for (const templateName of expectedTemplateNames) {
      await expect(page.getByText(templateName, { exact: true })).toBeVisible();
    }

    // Selecting a template auto-configures the monitor step.
    await page.getByText("Device Offline", { exact: true }).click();
    await expect(page.getByText("Template Configuration")).toBeVisible();
  });
});
