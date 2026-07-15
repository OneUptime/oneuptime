/*
 * AIAgent/Config.ts validates the agent's environment at import time and
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
process.env["AI_AGENT_KEY"] = process.env["AI_AGENT_KEY"] || "test-agent-key";
