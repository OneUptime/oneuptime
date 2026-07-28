import { PROMETHEUS_PORT } from "./TestEnv";

/*
 * Prologue for the one test file that stands up a Prometheus stub.
 *
 * Config.ts reads process.env at import time, so this has to run before
 * anything pulls in Config — importing this module FIRST achieves that,
 * since it imports TestEnv (the base prologue) before setting its own key.
 *
 * It is separate from TestEnv on purpose: node --test runs test files
 * concurrently in separate processes, and only this file binds
 * PROMETHEUS_PORT. Setting the URL globally would point every other file's
 * poller at a port nothing in its own process is serving.
 */

process.env["COST_PROMETHEUS_URL"] =
  process.env["COST_PROMETHEUS_URL"] || `http://127.0.0.1:${PROMETHEUS_PORT}`;

export { PROMETHEUS_PORT };
