import { BASE_URL } from "../../../Config";
import { APIResponse, Page, expect, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import { gotoProjectPage } from "./ProductOnboarding";

/*
 * Helpers for the Telemetry (Logs / Traces / Metrics) e2e specs.
 *
 * These mirror the OTLP-ingest pattern already used by the product onboarding
 * specs (CephProduct / DockerSwarmProduct): mint a real telemetry ingestion
 * key, POST a minimal OTLP/JSON fixture straight to the /otlp/v1/* endpoints
 * with the "x-oneuptime-token" header, then assert the ingested data surfaces
 * on the corresponding dashboard page.
 */

/*
 * A telemetry ingestion key secret is a 36-char UUID (ObjectID.generate()).
 * The Settings > Telemetry Ingestion Keys detail page renders it inside a
 * HiddenText field that has to be clicked to reveal.
 */
const secretKeyRegex: RegExp = /^[0-9a-fA-F-]{36}$/;

/*
 * Registers-nothing: assumes the caller already created a project. Navigates
 * to Settings > Telemetry Ingestion Keys, creates a key from the ModelTable
 * create modal, opens the key detail page, reveals the secret, and returns it
 * so the caller can use it as the OTLP ingestion token.
 */
type CreateTelemetryIngestionKeyFunction = (data: {
  page: Page;
  projectId: string;
  keyName: string;
}) => Promise<string>;

export const createTelemetryIngestionKey: CreateTelemetryIngestionKeyFunction =
  async (data: {
    page: Page;
    projectId: string;
    keyName: string;
  }): Promise<string> => {
    const page: Page = data.page;

    const ingestionKeysUrl: string = URL.fromString(BASE_URL.toString())
      .addRoute(
        `/dashboard/${data.projectId}/settings/telemetry-ingestion-keys`,
      )
      .toString();

    await gotoProjectPage({
      page,
      projectId: data.projectId,
      url: ingestionKeysUrl,
      ready: page.getByRole("button", { name: "Create Ingestion Key" }),
    });

    // Open the create modal and fill in the key name.
    await page.getByRole("button", { name: "Create Ingestion Key" }).click();
    await page.getByTestId("modal").waitFor({ state: "visible" });
    await page
      .locator("input[placeholder='Ingestion Key Name']")
      .first()
      .fill(data.keyName);
    await page.getByTestId("modal-footer-submit-button").click();
    await page.getByTestId("modal").waitFor({ state: "hidden" });

    /*
     * The ModelTable stays on the list after create; the row exposes its
     * detail page through a "View Ingestion Key" action button (singularName
     * "Ingestion Key"). Scope to the row for our key, then open it.
     */
    const keyDetailUrlRegex: RegExp = new RegExp(
      `/dashboard/${data.projectId}/settings/telemetry-ingestion-keys/[a-f0-9-]+`,
    );

    if (!keyDetailUrlRegex.test(page.url())) {
      const keyRow: Locator = page
        .getByRole("row")
        .filter({ hasText: data.keyName });
      await keyRow
        .getByRole("button", { name: "View Ingestion Key" })
        .first()
        .click();
    }

    await expect(page).toHaveURL(keyDetailUrlRegex, { timeout: 60000 });

    // Reveal the secret key (HiddenText renders "Click to reveal" first).
    const revealTrigger: Locator = page.locator('[role="hidden-text"]');
    await revealTrigger.first().waitFor({ state: "visible", timeout: 60000 });
    await revealTrigger.first().click();

    const revealed: Locator = page.locator('[role="revealed-text"]');
    await revealed.first().waitFor({ state: "visible", timeout: 30000 });

    const secretKey: string = (await revealed.first().innerText()).trim();
    expect(secretKey).toMatch(secretKeyRegex);

    return secretKey;
  };

/*
 * Nanoseconds since the Unix epoch, as a string, for the current time. OTLP
 * timestamps are string-encoded uint64 nanos; Date.now() is millis so we pad
 * with six zeros. Matches the existing product-onboarding OTLP fixtures.
 */
const nowUnixNano: () => string = (): string => {
  return `${Date.now()}000000`;
};

/*
 * A random lowercase hex string of `bytes` bytes (2 hex chars per byte). Used
 * to build OTLP trace/span ids (16 bytes / 8 bytes respectively).
 */
const randomHex: (bytes: number) => string = (bytes: number): string => {
  let hex: string = "";
  for (let i: number = 0; i < bytes; i++) {
    hex += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return hex;
};

type PostOtlpLogsFunction = (data: {
  page: Page;
  ingestionKey: string;
  serviceName: string;
  body: string;
}) => Promise<void>;

export const postOtlpLogs: PostOtlpLogsFunction = async (data: {
  page: Page;
  ingestionKey: string;
  serviceName: string;
  body: string;
}): Promise<void> => {
  const otlpLogsUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/otlp/v1/logs")
    .toString();

  const response: APIResponse = await data.page.request.post(otlpLogsUrl, {
    headers: {
      "content-type": "application/json",
      "x-oneuptime-token": data.ingestionKey,
    },
    data: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: data.serviceName },
              },
            ],
          },
          scopeLogs: [
            {
              scope: { name: "e2e-logs-fixture" },
              logRecords: [
                {
                  timeUnixNano: nowUnixNano(),
                  severityNumber: 9,
                  severityText: "INFO",
                  body: { stringValue: data.body },
                  attributes: [
                    {
                      key: "e2e.test",
                      value: { stringValue: "true" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });

  expect(response.ok()).toBe(true);
};

type PostOtlpTracesFunction = (data: {
  page: Page;
  ingestionKey: string;
  serviceName: string;
  spanName: string;
}) => Promise<void>;

export const postOtlpTraces: PostOtlpTracesFunction = async (data: {
  page: Page;
  ingestionKey: string;
  serviceName: string;
  spanName: string;
}): Promise<void> => {
  const otlpTracesUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/otlp/v1/traces")
    .toString();

  const startNano: string = nowUnixNano();
  // 5ms after start so the span has a non-zero duration.
  const endNano: string = `${Date.now() + 5}000000`;

  const response: APIResponse = await data.page.request.post(otlpTracesUrl, {
    headers: {
      "content-type": "application/json",
      "x-oneuptime-token": data.ingestionKey,
    },
    data: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: data.serviceName },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "e2e-traces-fixture" },
              spans: [
                {
                  traceId: randomHex(16),
                  spanId: randomHex(8),
                  name: data.spanName,
                  kind: 2,
                  startTimeUnixNano: startNano,
                  endTimeUnixNano: endNano,
                  attributes: [
                    {
                      key: "e2e.test",
                      value: { stringValue: "true" },
                    },
                  ],
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    },
  });

  expect(response.ok()).toBe(true);
};

type PostOtlpMetricsFunction = (data: {
  page: Page;
  ingestionKey: string;
  serviceName: string;
  metricName: string;
}) => Promise<void>;

export const postOtlpMetrics: PostOtlpMetricsFunction = async (data: {
  page: Page;
  ingestionKey: string;
  serviceName: string;
  metricName: string;
}): Promise<void> => {
  const otlpMetricsUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/otlp/v1/metrics")
    .toString();

  const response: APIResponse = await data.page.request.post(otlpMetricsUrl, {
    headers: {
      "content-type": "application/json",
      "x-oneuptime-token": data.ingestionKey,
    },
    data: {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: data.serviceName },
              },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: "e2e-metrics-fixture" },
              metrics: [
                {
                  name: data.metricName,
                  gauge: {
                    dataPoints: [
                      {
                        asDouble: 42,
                        timeUnixNano: nowUnixNano(),
                        attributes: [
                          {
                            key: "e2e.test",
                            value: { stringValue: "true" },
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

  expect(response.ok()).toBe(true);
};

/*
 * Ingestion is queued (OTLP request -> Redis -> worker -> ClickHouse), and the
 * telemetry dashboards do not always live-refresh, so poll by re-navigating to
 * the page until the expected text shows up. Generous timeout because CI runs
 * the whole stack on one box.
 */
type WaitForTelemetryTextFunction = (data: {
  page: Page;
  projectId: string;
  url: string;
  ready: Locator;
  text: string;
  timeoutMs?: number;
}) => Promise<void>;

export const waitForTelemetryText: WaitForTelemetryTextFunction = async (data: {
  page: Page;
  projectId: string;
  url: string;
  ready: Locator;
  text: string;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs: number = data.timeoutMs ?? 180000;
  const deadline: number = Date.now() + timeoutMs;
  const target: Locator = data.page.getByText(data.text).first();

  let lastError: Error | null = null;
  let attempt: number = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      await gotoProjectPage({
        page: data.page,
        projectId: data.projectId,
        url: data.url,
        ready: data.ready,
      });

      // Give the page a moment to load/poll rows before checking.
      await data.page.waitForTimeout(4000);

      const found: boolean = await target.isVisible();
      // eslint-disable-next-line no-console
      console.log(
        `[waitForTelemetryText] attempt=${attempt} url=${data.page.url()} found=${found} text="${data.text}"`,
      );
      if (found) {
        return;
      }
    } catch (error) {
      lastError = error as Error;
      // eslint-disable-next-line no-console
      console.log(
        `[waitForTelemetryText] attempt=${attempt} error=${(error as Error).message}`,
      );
    }

    await data.page.waitForTimeout(3000);
  }

  // Final assertion so the failure surfaces the expected text nicely.
  try {
    await gotoProjectPage({
      page: data.page,
      projectId: data.projectId,
      url: data.url,
      ready: data.ready,
    });
  } catch (error) {
    lastError = error as Error;
  }

  await expect(
    target,
    lastError ? `Last navigation error: ${lastError.message}` : undefined,
  ).toBeVisible({ timeout: 30000 });
};
