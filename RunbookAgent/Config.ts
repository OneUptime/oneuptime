import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import NumberUtil from "Common/Utils/Number";
import logger from "Common/Server/Utils/Logger";

if (!process.env["ONEUPTIME_URL"]) {
  logger.error("ONEUPTIME_URL is not set");
  process.exit(1);
}

if (!process.env["RUNBOOK_AGENT_ID"]) {
  logger.error("RUNBOOK_AGENT_ID is not set");
  process.exit(1);
}

if (!process.env["RUNBOOK_AGENT_KEY"]) {
  logger.error("RUNBOOK_AGENT_KEY is not set");
  process.exit(1);
}

export const ONEUPTIME_BASE_URL: URL = URL.fromString(
  process.env["ONEUPTIME_URL"]!,
);

/*
 * The agent talks to a single mount under the OneUptime app:
 *   POST /runbook-agent-ingest/heartbeat
 *   POST /runbook-agent-ingest/claim-next-job
 *   POST /runbook-agent-ingest/job/:jobId/heartbeat
 *   POST /runbook-agent-ingest/job/:jobId/result
 */
export const RUNBOOK_AGENT_INGEST_URL: URL = URL.fromString(
  ONEUPTIME_BASE_URL.toString(),
).addRoute("/runbook-agent-ingest");

export const RUNBOOK_AGENT_ID: ObjectID = new ObjectID(
  process.env["RUNBOOK_AGENT_ID"]!,
);

export const RUNBOOK_AGENT_KEY: string = process.env["RUNBOOK_AGENT_KEY"]!;

export const RUNBOOK_AGENT_VERSION: string =
  process.env["APP_VERSION"] || "1.0.0";

export const POLL_INTERVAL_MS: number = NumberUtil.parseNumberWithDefault({
  value: process.env["RUNBOOK_AGENT_POLL_INTERVAL_MS"],
  defaultValue: 5_000,
  min: 1_000,
});

export const HEARTBEAT_INTERVAL_MS: number = NumberUtil.parseNumberWithDefault({
  value: process.env["RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS"],
  defaultValue: 60_000,
  min: 5_000,
});

/*
 * While running a script, the agent calls the job heartbeat endpoint at
 * this cadence so the Worker's lease never lapses mid-execution.
 */
export const JOB_HEARTBEAT_INTERVAL_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS"],
    defaultValue: 10_000,
    min: 1_000,
  });

export const MAX_CONCURRENT_JOBS: number = NumberUtil.parseNumberWithDefault({
  value: process.env["RUNBOOK_AGENT_CONCURRENCY"],
  defaultValue: 1,
  min: 1,
});

export const MAX_OUTPUT_BYTES: number = 50_000;
