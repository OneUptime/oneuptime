import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import NumberUtil from "Common/Utils/Number";
import { HasClusterKey } from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";

/*
 * OneUptime Runner — the single agent a customer installs.
 *
 * It runs two kinds of work, each gated by a capability toggle:
 *   - RUNBOOKS: claims runbook Bash/JavaScript steps and executes them in
 *     the customer's own infrastructure (default ON — this is why most
 *     people install a Runner).
 *   - CODE FIXES: claims AI code-fix runs, works in the project's code
 *     repository and opens draft pull requests (default OFF — it needs a
 *     connected code repository).
 *
 * Credentials come in two shapes:
 *   - PROJECT-SCOPED (what customers install): ONEUPTIME_RUNNER_ID +
 *     ONEUPTIME_RUNNER_KEY, created in the dashboard. The Runner only ever
 *     sees work belonging to that one project.
 *   - CLUSTER-SCOPED (OneUptime's own deployment): a cluster key
 *     auto-registers the Runner to serve every project. This mode is for
 *     the in-cluster `runner` service only and must never be handed to a
 *     customer install.
 */

if (!process.env["ONEUPTIME_URL"]) {
  logger.error("ONEUPTIME_URL is not set");
  process.exit(1);
}

export const ONEUPTIME_BASE_URL: URL = URL.fromString(
  process.env["ONEUPTIME_URL"]!,
);

// Cluster-key mode auto-registers and derives its own id; project mode does not.
export const IS_CLUSTER_SCOPED: boolean = HasClusterKey;

if (!IS_CLUSTER_SCOPED && !process.env["ONEUPTIME_RUNNER_ID"]) {
  logger.error(
    "ONEUPTIME_RUNNER_ID is not set. Create a Runner in your OneUptime dashboard (Project Settings > Runners) and copy its id and key into this container.",
  );
  process.exit(1);
}

if (!process.env["ONEUPTIME_RUNNER_KEY"]) {
  logger.error(
    "ONEUPTIME_RUNNER_KEY is not set. Create a Runner in your OneUptime dashboard (Project Settings > Runners) and copy its id and key into this container.",
  );
  process.exit(1);
}

/*
 * In cluster mode the id is assigned by the server at registration time,
 * so it starts null and is filled in by RegisterRunner.
 */
export const RUNNER_ID: ObjectID | null = process.env["ONEUPTIME_RUNNER_ID"]
  ? new ObjectID(process.env["ONEUPTIME_RUNNER_ID"]!)
  : null;

export const RUNNER_KEY: string = process.env["ONEUPTIME_RUNNER_KEY"]!;

export const RUNNER_NAME: string | null =
  process.env["ONEUPTIME_RUNNER_NAME"] || null;

export const RUNNER_DESCRIPTION: string | null =
  process.env["ONEUPTIME_RUNNER_DESCRIPTION"] || null;

export const RUNNER_VERSION: string = process.env["APP_VERSION"] || "1.0.0";

/*
 * Capabilities. Runbook execution is on unless explicitly disabled; code-fix
 * execution is opt-in because it needs a connected code repository and
 * writes pull requests.
 */
export const ENABLE_RUNBOOKS: boolean =
  (process.env["ONEUPTIME_RUNNER_ENABLE_RUNBOOKS"] || "true").toLowerCase() !==
  "false";

export const ENABLE_CODE_FIXES: boolean =
  (
    process.env["ONEUPTIME_RUNNER_ENABLE_CODE_FIXES"] || "false"
  ).toLowerCase() === "true";

/*
 * The runbook work mount on the OneUptime app:
 *   POST /runner-ingest/heartbeat
 *   POST /runner-ingest/claim-next-job
 *   POST /runner-ingest/job/:jobId/heartbeat
 *   POST /runner-ingest/job/:jobId/result
 */
export const RUNNER_INGEST_URL: URL = URL.fromString(
  ONEUPTIME_BASE_URL.toString(),
).addRoute("/runner-ingest");

export const POLL_INTERVAL_MS: number = NumberUtil.parseNumberWithDefault({
  value: process.env["ONEUPTIME_RUNNER_POLL_INTERVAL_MS"],
  defaultValue: 5_000,
  min: 1_000,
});

export const HEARTBEAT_INTERVAL_MS: number = NumberUtil.parseNumberWithDefault({
  value: process.env["ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS"],
  defaultValue: 60_000,
  min: 5_000,
});

/*
 * While running a script, the Runner calls the job heartbeat endpoint at
 * this cadence so the Worker's lease never lapses mid-execution.
 */
export const JOB_HEARTBEAT_INTERVAL_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS"],
    defaultValue: 10_000,
    min: 1_000,
  });

export const MAX_CONCURRENT_JOBS: number = NumberUtil.parseNumberWithDefault({
  value: process.env["ONEUPTIME_RUNNER_CONCURRENCY"],
  defaultValue: 1,
  min: 1,
});

export const MAX_OUTPUT_BYTES: number = 50_000;

// Health/metrics port (KEDA reads the code-fix queue depth from here).
export const PORT: Port = new Port(
  process.env["PORT"] ? parseInt(process.env["PORT"]) : 3875,
);
