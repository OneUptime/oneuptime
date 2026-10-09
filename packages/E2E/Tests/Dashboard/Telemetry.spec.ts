import { BASE_URL } from "../../Config";
import { Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import { JSONish, requestJson } from "./Helpers/MonitorAlerting";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  createTelemetryIngestionKey,
  postOtlpLlmCall,
  postOtlpLogs,
  postOtlpMetrics,
  postOtlpTraces,
  waitForTelemetryText,
} from "./Helpers/Telemetry";

// A record ID: a UUID, as Show ID hands it over.
const RECORD_ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Telemetry (Logs / Traces / Metrics) end-to-end coverage.
 *
 * Each test registers a fresh user, creates a project, mints a telemetry
 * ingestion key, POSTs a minimal OTLP/JSON fixture straight to the relevant
 * /otlp/v1/* endpoint, and then asserts the ingested record surfaces on its
 * dashboard page. This exercises the full ingest pipeline (HTTP -> queue ->
 * worker -> ClickHouse -> dashboard query) the same way the product
 * onboarding specs do for infrastructure metrics.
 *
 * To run locally against a full stack:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/Telemetry.spec.ts --project=chromium
 *
 * Registers a user + creates a project, so it needs a working billing backend
 * when BILLING_ENABLED=true. Both e2e environments support this: the
 * self-hosted job runs with billing off, and the SaaS job injects test-mode
 * Stripe keys from repo secrets.
 */
test.describe("Telemetry Ingestion", () => {
  /*
   * Register + project + billing + ingest-key setup plus the ingest->query
   * poll needs more than the default 240s, so give these tests extra headroom.
   */
  test.beforeEach(() => {
    test.setTimeout(420000);
  });

  test("should ingest OTLP logs and show them on the Logs dashboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Logs Project",
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E Logs Key " + Faker.generateName().toString(),
    });

    const serviceName: string =
      "e2e-logs-" + Faker.generateName().toString().toLowerCase();
    const logToken: string =
      "e2elogtoken" + Faker.generateName().toString().toLowerCase();
    const logBody: string = `E2E log entry ${logToken}`;

    await postOtlpLogs({ page, ingestionKey, serviceName, body: logBody });

    const logsUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/logs`)
      .toString();

    await waitForTelemetryText({
      page,
      projectId,
      url: logsUrl,
      ready: page.getByPlaceholder(/Search logs/i),
      text: logToken,
    });
  });

  test("should ingest OTLP traces and show them on the Traces dashboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Traces Project",
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E Traces Key " + Faker.generateName().toString(),
    });

    const serviceName: string =
      "e2e-traces-" + Faker.generateName().toString().toLowerCase();
    const spanName: string =
      "e2espan" + Faker.generateName().toString().toLowerCase();

    await postOtlpTraces({ page, ingestionKey, serviceName, spanName });

    const tracesUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/traces`)
      .toString();

    await waitForTelemetryText({
      page,
      projectId,
      url: tracesUrl,
      ready: page.getByPlaceholder(/Search traces/i),
      text: spanName,
    });
  });

  /*
   * Issue #4615: Show ID on a row of Recent LLM Calls (AI / LLM > Overview)
   * threw minified React error #31 and replaced the page with the error
   * screen. An LLM call is an analytics row, whose ID is an ObjectID rather
   * than a string, and the dialog put the object on the page.
   */
  test("should show an LLM call's ID from Recent LLM Calls instead of crashing", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E LLM Project",
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E LLM Key " + Faker.generateName().toString(),
    });

    const serviceName: string =
      "e2e-llm-" + Faker.generateName().toString().toLowerCase();
    const model: string =
      "e2e-model-" + Faker.generateName().toString().toLowerCase();

    await postOtlpLlmCall({ page, ingestionKey, serviceName, model });

    const llmOverviewUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/llm/overview`)
      .toString();

    await waitForTelemetryText({
      page,
      projectId,
      url: llmOverviewUrl,
      ready: page.getByRole("heading", { name: "Recent LLM Calls" }),
      text: model,
    });

    // The call's own ID, as the span API holds it.
    const listed: JSONish = await requestJson({
      page,
      projectId,
      path: "/api/span/get-list",
      body: {
        query: { projectId, llmRequestModel: model },
        select: { _id: true },
        limit: 1,
        skip: 0,
        sort: {},
      },
    });
    const storedId: JSONish | string | undefined = (
      (listed["data"] || []) as Array<JSONish>
    )[0]?.["_id"];
    const callId: string =
      typeof storedId === "string" ? storedId : String(storedId?.["value"]);

    expect(callId).toMatch(RECORD_ID_PATTERN);

    const row: Locator = page.locator("tr", { hasText: model });
    await row.getByTestId("row-actions-more-button").click();
    await page.getByRole("menuitem", { name: "Show ID" }).click();

    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("modal-title")).toHaveText("LLM Call ID");
    await expect(modal.getByTestId("record-id-value")).toHaveText(callId);
    await expect(
      modal.getByRole("button", { name: "Copy ID to clipboard" }),
    ).toBeVisible();
    // Spans are in the API Reference, so the dialog offers the way there.
    await expect(
      modal.getByRole("button", { name: "Go to API Docs" }),
    ).toBeVisible();

    // Closing it leaves the page as it was: no error screen behind it.
    await modal.getByTestId("modal-footer-close-button").click();
    await expect(modal).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Recent LLM Calls" }),
    ).toBeVisible();
    await expect(page.getByText(model).first()).toBeVisible();
  });

  test("should ingest OTLP metrics and show them on the Metrics dashboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Metrics Project",
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E Metrics Key " + Faker.generateName().toString(),
    });

    const serviceName: string =
      "e2e-metrics-" + Faker.generateName().toString().toLowerCase();
    const metricName: string =
      "e2e_metric_" + Faker.generateName().toString().toLowerCase();

    await postOtlpMetrics({ page, ingestionKey, serviceName, metricName });

    const metricsUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/metrics`)
      .toString();

    await waitForTelemetryText({
      page,
      projectId,
      url: metricsUrl,
      ready: page.getByPlaceholder(/Search metrics/i),
      text: metricName,
    });
  });
});
