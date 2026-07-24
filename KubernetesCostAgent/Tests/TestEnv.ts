/*
 * Test environment prologue. Config.ts reads process.env at import time,
 * so every test file MUST import this module FIRST (the compiled
 * CommonJS executes requires in import order). node --test runs each
 * test file in its own process, so files cannot leak env into each other.
 *
 * Ports are fixed per target so the local stub servers in the tests bind
 * predictably: 34571 plays the cost engine, 34572 plays OneUptime.
 */

process.env["TZ"] = "UTC";

process.env["ONEUPTIME_URL"] =
  process.env["ONEUPTIME_URL"] || "http://127.0.0.1:34572";
process.env["ONEUPTIME_API_KEY"] =
  process.env["ONEUPTIME_API_KEY"] || "test-ingestion-key";
process.env["CLUSTER_NAME"] = process.env["CLUSTER_NAME"] || "test-cluster";
process.env["COST_ENGINE_URL"] =
  process.env["COST_ENGINE_URL"] || "http://127.0.0.1:34571";

// Small, fast values so retry/backoff paths run in milliseconds-to-seconds.
process.env["SHIP_BATCH_SIZE"] = process.env["SHIP_BATCH_SIZE"] || "2";
process.env["EXPORT_MAX_RETRIES"] = process.env["EXPORT_MAX_RETRIES"] || "2";
process.env["WINDOW_SECONDS"] = process.env["WINDOW_SECONDS"] || "60";
process.env["POLL_INTERVAL_SECONDS"] =
  process.env["POLL_INTERVAL_SECONDS"] || "3600";
process.env["ENGINE_SETTLE_SECONDS"] =
  process.env["ENGINE_SETTLE_SECONDS"] || "0";
process.env["LOOKBACK_WINDOWS"] = process.env["LOOKBACK_WINDOWS"] || "2";
process.env["LOG_LEVEL"] = process.env["LOG_LEVEL"] || "error";

export const COST_ENGINE_PORT: number = 34571;
export const ONEUPTIME_PORT: number = 34572;
