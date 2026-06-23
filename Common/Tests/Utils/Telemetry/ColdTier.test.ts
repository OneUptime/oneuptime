import {
  getClickhouseColdTierStoragePolicy,
  getTelemetryColdTierTtlExpression,
} from "../../../Utils/Telemetry/ColdTier";

describe("Telemetry cold-tier config", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("keeps delete-only TTL when cold tier is disabled", () => {
    delete process.env["CLICKHOUSE_COLD_TIER_ENABLED"];

    expect(getClickhouseColdTierStoragePolicy()).toBeUndefined();
    expect(
      getTelemetryColdTierTtlExpression({
        signal: "logs",
        moveAfterExpression: "time",
      }),
    ).toBe("retentionDate DELETE");
  });

  test("builds cold-tier TTL when enabled", () => {
    process.env["CLICKHOUSE_COLD_TIER_ENABLED"] = "true";
    delete process.env["CLICKHOUSE_COLD_TIER_METRICS_DAYS"];
    delete process.env["CLICKHOUSE_COLD_TIER_LOGS_DAYS"];
    delete process.env["CLICKHOUSE_COLD_TIER_TRACES_DAYS"];

    expect(getClickhouseColdTierStoragePolicy()).toBe("tiered");
    expect(
      getTelemetryColdTierTtlExpression({
        signal: "metrics",
        moveAfterExpression: "bucketTime",
      }),
    ).toBe(
      "bucketTime + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE",
    );
  });

  test("respects custom env overrides", () => {
    process.env["CLICKHOUSE_COLD_TIER_ENABLED"] = "true";
    process.env["CLICKHOUSE_COLD_TIER_STORAGE_POLICY"] = "tiered_hot_cold";
    process.env["CLICKHOUSE_COLD_TIER_VOLUME"] = "archive";
    process.env["CLICKHOUSE_COLD_TIER_TRACES_DAYS"] = "14";

    expect(getClickhouseColdTierStoragePolicy()).toBe("tiered_hot_cold");
    expect(
      getTelemetryColdTierTtlExpression({
        signal: "traces",
        moveAfterExpression: "startTime",
      }),
    ).toBe(
      "startTime + INTERVAL 14 DAY TO VOLUME 'archive', retentionDate DELETE",
    );
  });
});
