import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { Page, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  createTelemetryIngestionKey,
  postOtlpLogs,
  postOtlpMetrics,
  postOtlpTraces,
  waitForTelemetryText,
} from "./Helpers/Telemetry";

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
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/Telemetry.spec.ts --project=chromium
 *
 * These specs register a user and create a project. When BILLING_ENABLED=true,
 * project creation goes through the billing backend (Stripe). The SaaS e2e
 * environment enables billing but ships no Stripe keys, so project creation
 * returns a server error there — so this suite is skipped when billing is
 * enabled and runs in the non-billing (self-hosted) e2e environment.
 */
const describeTelemetry: (title: string, callback: () => void) => void =
  IS_BILLING_ENABLED ? test.describe.skip : test.describe;

describeTelemetry("Telemetry Ingestion", () => {
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
