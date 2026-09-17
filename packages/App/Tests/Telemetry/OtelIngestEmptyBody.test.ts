import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression guard for the deploy-time "Invalid resourceSpans format" bursts.
 * When the out-of-band OTLP body is lost (TTL expiry → decodeFromQueue
 * returns {}), the worker hands the consumer an empty body. The consumer
 * MUST skip the batch (resolve) rather than throw — throwing in the worker
 * (after the 200 was already sent) only burns retries and masks the real
 * first-attempt error. An empty body never reaches any DB / pipeline work:
 * the guard is the first statement, so this needs no infra.
 */

function emptyBodyRequest(): TelemetryRequest {
  return {
    projectId: ObjectID.generate(),
    body: {},
    headers: {},
  } as unknown as TelemetryRequest;
}

describe("OTel ingest — empty/lost body is skipped, not thrown", () => {
  test("traces: empty body resolves without throwing", async () => {
    await expect(
      OtelTracesIngestService.processTracesFromQueue(emptyBodyRequest()),
    ).resolves.toBeUndefined();
  });

  test("logs: empty body resolves without throwing", async () => {
    await expect(
      OtelLogsIngestService.processLogsFromQueue(emptyBodyRequest()),
    ).resolves.toBeUndefined();
  });

  test("metrics: empty body resolves without throwing", async () => {
    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(emptyBodyRequest()),
    ).resolves.toBeUndefined();
  });

  test("profiles: empty body resolves without throwing", async () => {
    await expect(
      OtelProfilesIngestService.processProfilesFromQueue(emptyBodyRequest()),
    ).resolves.toBeUndefined();
  });
});
