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
 * Capabilities.
 *
 * For a project-scoped Runner the dashboard is the control plane — the
 * capabilities come back from registration — and these env vars are a local
 * override that can only ever turn a capability OFF. Left unset they say
 * nothing, which is why they are tri-state rather than boolean.
 *
 * A cluster-scoped Runner has no dashboard row, so for it these are the whole
 * answer: runbooks off (it can never be targeted by a step), code fixes
 * opt-in because they clone repositories and open pull requests.
 */
const FALSE_SPELLINGS: Array<string> = ["false", "0", "no", "off"];

function parseCapabilityOverride(value: string | undefined): boolean | null {
  if (value === undefined || value === "") {
    return null;
  }

  return !FALSE_SPELLINGS.includes(value.trim().toLowerCase());
}

export const ENABLE_RUNBOOKS_OVERRIDE: boolean | null = parseCapabilityOverride(
  process.env["ONEUPTIME_RUNNER_ENABLE_RUNBOOKS"],
);

export const ENABLE_CODE_FIXES_OVERRIDE: boolean | null =
  parseCapabilityOverride(process.env["ONEUPTIME_RUNNER_ENABLE_CODE_FIXES"]);

/*
 * What a cluster-scoped Runner runs, where no dashboard row exists to consult.
 * Code fixes are the only work it can do — runbook steps target a Runner a
 * human picked in a project — so they are ON unless explicitly turned off.
 * Defaulting them off would leave the in-cluster Runner with no capability at
 * all, which is a boot failure, not a safe default.
 */
export const CLUSTER_ENABLE_CODE_FIXES: boolean =
  ENABLE_CODE_FIXES_OVERRIDE !== false;

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
