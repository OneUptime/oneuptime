import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import NumberUtil from "Common/Utils/Number";
import {
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_ALLOW_WRITES_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
  RUNNER_POD_NAMESPACE_ENV,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
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
 *     repository and opens pull requests for review (default OFF — it needs
 *     a connected code repository).
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

/*
 * KUBERNETES-AGENT MODE: the Runner the kubernetes-agent Helm chart installs
 * next to the OpenTelemetry collector (aiAccess.enabled=true). It has no
 * dashboard-issued id and key; it presents the project's telemetry ingestion
 * key (the same one the agent ships telemetry with) plus the cluster's name,
 * and the server issues it a Runner identity bound to that cluster. That is
 * what makes "give OneUptime AI kubectl access" a single helm flag.
 */
export const KUBERNETES_AGENT_CLUSTER_NAME: string | null =
  process.env["ONEUPTIME_KUBERNETES_CLUSTER_NAME"] || null;

export const KUBERNETES_AGENT_INGESTION_KEY: string | null =
  process.env["ONEUPTIME_INGESTION_KEY"] || null;

export const KUBERNETES_AGENT_CHART_VERSION: string | null =
  process.env["ONEUPTIME_KUBERNETES_AGENT_CHART_VERSION"] || null;

export const IS_KUBERNETES_AGENT_MODE: boolean =
  !IS_CLUSTER_SCOPED &&
  !process.env["ONEUPTIME_RUNNER_ID"] &&
  Boolean(KUBERNETES_AGENT_CLUSTER_NAME) &&
  Boolean(KUBERNETES_AGENT_INGESTION_KEY);

if (
  !IS_CLUSTER_SCOPED &&
  !IS_KUBERNETES_AGENT_MODE &&
  !process.env["ONEUPTIME_RUNNER_ID"]
) {
  logger.error(
    "ONEUPTIME_RUNNER_ID is not set. Create a Runner in your OneUptime dashboard (Project Settings > Runners) and copy its id and key into this container. (The Kubernetes agent's in-cluster Runner instead sets ONEUPTIME_INGESTION_KEY and ONEUPTIME_KUBERNETES_CLUSTER_NAME.)",
  );
  process.exit(1);
}

if (!IS_KUBERNETES_AGENT_MODE && !process.env["ONEUPTIME_RUNNER_KEY"]) {
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

/*
 * Empty in kubernetes-agent mode until registration issues one — read the
 * live key through RunnerIdentity.getRunnerKey(), never this constant, on
 * any path that mode can reach.
 */
export const RUNNER_KEY: string = process.env["ONEUPTIME_RUNNER_KEY"] || "";

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
 * Local narrow-only override for AI-composed remediation commands. Like the
 * others, only "false" has an effect: the capability itself is granted (or
 * not) by the project's dashboard toggle, and env can only refuse it.
 */
export const ENABLE_AI_COMMANDS_OVERRIDE: boolean | null =
  parseCapabilityOverride(process.env["ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS"]);

/*
 * Whether AI-composed kubectl WRITES may run from this host.
 *
 * A value that is SET fails closed: only "true" (any case, surrounding
 * whitespace ignored) lets a write through; "false" and anything else —
 * "readonly", "disabled", "no", a typo — refuse every non-Read kubectl
 * before it spawns. A security switch whose name reads as a boolean must
 * never turn a plausible "off" spelling into "on".
 *
 * UNSET depends on what this Runner is. The kubernetes-agent chart always
 * sets it (from aiAccess.remediation.enabled, matching the RBAC it granted
 * the pod's ServiceAccount), so an agent-mode Runner without it refuses
 * writes. Any other Runner reaches a cluster only through a Kubernetes
 * credential an operator assigned it, whose RBAC bounds what kubectl can do,
 * and the server cannot see this host's environment — refusing there by
 * default would leave a cluster reported ready for remediation whose every
 * fix fails on the Runner. Such a Runner keeps writes on unless its
 * operator sets the variable to "false".
 */
export const KUBECTL_ALLOW_WRITES_RAW: string | null =
  process.env[KUBECTL_ALLOW_WRITES_ENV] ?? null;

/*
 * The rule every kubectl switch on this Runner follows (the write switch
 * above, the node switch below): set, only "true" allows; unset, allowed
 * on an ordinary Runner and refused on the kubernetes-agent Runner, whose
 * chart always sets it.
 */
export function parseKubectlSwitch(
  value: string | null,
  isKubernetesAgentMode: boolean,
): boolean {
  const normalized: string = (value || "").trim().toLowerCase();

  if (!normalized) {
    return !isKubernetesAgentMode;
  }

  return normalized === "true";
}

/*
 * A value that is set but is neither "true" nor "false" is almost certainly
 * an operator meaning "off" in other words. It already refuses; say so once
 * at start-up so nobody has to guess what it did.
 */
function warnAboutUnrecognisedKubectlSwitch(data: {
  name: string;
  value: string | null;
  refuses: string;
  allows: string;
}): void {
  if (
    data.value !== null &&
    data.value.trim() !== "" &&
    !["true", "false"].includes(data.value.trim().toLowerCase())
  ) {
    logger.warn(
      `${data.name}="${data.value}" is not a recognised value; refusing ${data.refuses} on this host. Set it to "true" to allow ${data.allows} or "false" to refuse them explicitly.`,
    );
  }
}

export const KUBECTL_ALLOW_WRITES: boolean = parseKubectlSwitch(
  KUBECTL_ALLOW_WRITES_RAW,
  IS_KUBERNETES_AGENT_MODE,
);

warnAboutUnrecognisedKubectlSwitch({
  name: KUBECTL_ALLOW_WRITES_ENV,
  value: KUBECTL_ALLOW_WRITES_RAW,
  refuses: "every AI-composed kubectl write",
  allows: "writes",
});

/*
 * Whether AI-composed kubectl NODE OPERATIONS may run from this host:
 * cordon, uncordon, drain and taint, and any write to a Node object (label,
 * annotate, patch). Nodes are cluster-scoped, so the namespace scope below
 * cannot bound them; this switch does, and it is parsed exactly like the
 * write switch (parseKubectlSwitch). The kubernetes-agent chart sets it
 * from aiAccess.remediation.nodeOperations, matching the node role it
 * renders; an agent-mode Runner without it refuses node operations. Only
 * meaningful when writes are allowed at all.
 */
export const KUBECTL_ALLOW_NODE_OPERATIONS_RAW: string | null =
  process.env[KUBECTL_ALLOW_NODE_OPERATIONS_ENV] ?? null;

export const KUBECTL_ALLOW_NODE_OPERATIONS: boolean = parseKubectlSwitch(
  KUBECTL_ALLOW_NODE_OPERATIONS_RAW,
  IS_KUBERNETES_AGENT_MODE,
);

warnAboutUnrecognisedKubectlSwitch({
  name: KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  value: KUBECTL_ALLOW_NODE_OPERATIONS_RAW,
  refuses: "every AI-composed kubectl node operation",
  allows: "node operations",
});

/*
 * Where AI-composed kubectl writes may land. The kubernetes-agent chart
 * passes the namespaces it bound write RBAC in (comma-separated); empty or
 * unset means cluster-wide. Reads are never namespace-restricted.
 */
export function parseKubectlWriteNamespaces(
  value: string | null | undefined,
): Array<string> {
  const namespaces: Array<string> = [];

  for (const part of (value || "").split(",")) {
    const namespace: string = part.trim().toLowerCase();

    if (namespace && !namespaces.includes(namespace)) {
      namespaces.push(namespace);
    }
  }

  return namespaces;
}

export const KUBECTL_WRITE_NAMESPACES: Array<string> =
  parseKubectlWriteNamespaces(process.env[KUBECTL_WRITE_NAMESPACES_ENV]);

/*
 * The namespace this Runner's own pod runs in (the chart sets it from the
 * downward API). A write there could scale the agent — or this Runner —
 * away, so the Runner never makes one.
 */
export const RUNNER_POD_NAMESPACE: string | null =
  (process.env[RUNNER_POD_NAMESPACE_ENV] || "").trim().toLowerCase() || null;

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
