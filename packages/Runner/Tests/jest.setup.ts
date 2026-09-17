/*
 * Runner/Config.ts validates the Runner's environment at import time and
 * calls process.exit() when a required variable is missing — importing any
 * module that reaches Config (BackendAPI, the task handlers) would kill the
 * jest worker. Stub the required variables so unit tests stay hermetic and do
 * not depend on config.env, which carries no agent credentials.
 *
 * Runs via setupFiles (before the test module is loaded), NOT
 * setupFilesAfterEnv, so these are set before Config's top-level checks run.
 */
process.env["ONEUPTIME_URL"] =
  process.env["ONEUPTIME_URL"] || "http://localhost";
process.env["ONEUPTIME_RUNNER_KEY"] =
  process.env["ONEUPTIME_RUNNER_KEY"] || "test-runner-key";
process.env["ONEUPTIME_RUNNER_ID"] =
  process.env["ONEUPTIME_RUNNER_ID"] || "00000000-0000-4000-8000-000000000000";
