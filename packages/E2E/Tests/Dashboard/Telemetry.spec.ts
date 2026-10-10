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
   * Issue #4615: Show ID on a row of the LLM calls table threw minified React
   * error #31 and replaced the page with the error screen. An LLM call is an
   * analytics row, whose ID is an ObjectID rather than a string, and the
   * dialog put the object on the page. The table was the Overview's Recent
   * LLM Calls; the Overview folded into Conversations and the table lives on
   * AI / LLM > Calls.
   */
  test("should show an LLM call's ID from the AI / LLM calls instead of crashing", async ({
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

    const llmCallsUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/llm/calls`)
      .toString();

    await waitForTelemetryText({
      page,
      projectId,
      url: llmCallsUrl,
      ready: page.getByRole("heading", { name: "AI / LLM Calls" }),
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
      page.getByRole("heading", { name: "AI / LLM Calls" }),
    ).toBeVisible();
    await expect(page.getByText(model).first()).toBeVisible();
  });

  /*
   * An AI call that carries its conversation id and what was said shows as
   * a conversation: listed under the person's question, opened to read the
   * question and the answer, and replayed message by message.
   */
  test("should list an AI conversation and open it to read and replay", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E LLM Conversation Project",
    });

    const ingestionKey: string = await createTelemetryIngestionKey({
      page,
      projectId,
      keyName: "E2E LLM Conversation Key " + Faker.generateName().toString(),
    });

    const suffix: string = Faker.generateName().toString().toLowerCase();
    const question: string = `Where should I travel in May, ${suffix}?`;
    const answer: string = `Lisbon is lovely in May, ${suffix}.`;

    await postOtlpLlmCall({
      page,
      ingestionKey,
      serviceName: "e2e-llm-chat-" + suffix,
      model: "e2e-model-" + suffix,
      conversation: {
        conversationId: "e2e-chat-" + suffix,
        question: question,
        answer: answer,
        userEmail: "ada@example.com",
      },
    });

    const conversationsUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(`/dashboard/${projectId}/llm/conversations`)
      .toString();

    await waitForTelemetryText({
      page,
      projectId,
      url: conversationsUrl,
      ready: page.getByTestId("llm-conversations-search"),
      text: question,
    });

    // The row says who asked; opening it shows what was said.
    const row: Locator = page
      .getByTestId("llm-conversation-row")
      .filter({ hasText: question });
    await expect(row).toContainText("ada@example.com");
    await row.click();

    await expect(page).toHaveURL(/\/llm\/conversations\/c%3Ae2e-chat-/);
    await expect(page.getByTestId("llm-conversation-title")).toHaveText(
      question,
    );

    const transcript: Locator = page.getByTestId("llm-transcript");
    await expect(transcript).toContainText(question);
    await expect(transcript).toContainText(answer);

    // A step back in the replay hides the answer and says it is to come.
    await page.keyboard.press("j");
    await expect(transcript).not.toContainText(answer);
    await expect(page.getByTestId("llm-replay-hidden-note")).toContainText(
      "1 more message to come in the replay",
    );
    await expect(page).toHaveURL(/[?&]step=0/);

    await page.getByTestId("llm-replay-show-all").click();
    await expect(transcript).toContainText(answer);
    await expect(page.getByTestId("llm-replay-play")).toHaveText(/Replay/);
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
