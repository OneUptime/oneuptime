import {
  AI_AGENT_POD_NAMESPACE_ENV,
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_ALLOW_WRITES_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
} from "./Common/Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * The agent's configuration, read from the environment the kubernetes-agent
 * chart renders (templates/ai-agent.yaml).
 *
 * Parsing never throws. A missing ONEUPTIME_URL, API key or cluster name is
 * reported as a problem instead: the agent logs it, keeps its health server
 * up and does nothing else — it never crash-loops. Readiness must not depend
 * on AI being configured, or `helm upgrade --wait` (and Terraform or Flux,
 * which wait by default) would fail the whole Kubernetes agent release over
 * an optional feature.
 */

export const ONEUPTIME_URL_ENV: string = "ONEUPTIME_URL";
// The chart's api-key secret: the same ingestion key the collector uses.
export const ONEUPTIME_API_KEY_ENV: string = "ONEUPTIME_API_KEY";
export const CLUSTER_NAME_ENV: string = "ONEUPTIME_KUBERNETES_CLUSTER_NAME";
export const CHART_VERSION_ENV: string =
  "ONEUPTIME_KUBERNETES_AGENT_CHART_VERSION";
export const POLL_INTERVAL_ENV: string = "ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS";
export const HEARTBEAT_INTERVAL_ENV: string =
  "ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS";

export const DEFAULT_PORT: number = 3876;
export const DEFAULT_POLL_INTERVAL_MS: number = 3_000;
export const MIN_POLL_INTERVAL_MS: number = 1_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS: number = 30_000;
export const MIN_HEARTBEAT_INTERVAL_MS: number = 5_000;

export interface AgentConfig {
  // Base URL of OneUptime, without a trailing slash.
  oneuptimeUrl: string;
  apiKey: string;
  // The chart's clusterName: the cluster this agent serves.
  clusterName: string;
  chartVersion: string | null;
  /*
   * Whether AI-composed kubectl writes may run. Only "true" allows them;
   * unset, "false" and anything else (a typo, "yes", "readonly") refuse —
   * a security switch must never read a plausible "off" as "on". The chart
   * sets it from aiAgent.remediation.enabled, matching the write RBAC it
   * grants the agent's ServiceAccount.
   */
  allowWrites: boolean;
  // The switch exactly as set (null when unset), for refusal messages.
  allowWritesSetting: string | null;
  /*
   * The namespaces writes may land in, trimmed, lowercased and without
   * duplicates. Empty means cluster-wide (the RBAC still bounds it).
   */
  writeNamespaces: Array<string>;
  // Node operations (cordon, drain, taint, ...): same "true"-only rule.
  allowNodeOperations: boolean;
  allowNodeOperationsSetting: string | null;
  /*
   * The pod's own namespace from the downward API, lowercased; null when
   * the chart did not set it (the ServiceAccount mount's namespace file is
   * the fallback, see Posture).
   */
  podNamespace: string | null;
  port: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  // This build's version (APP_VERSION, set in the image), or null.
  agentVersion: string | null;
}

export interface ParsedConfig {
  config: AgentConfig;
  /*
   * What stops the agent from working at all (a missing required value).
   * Non-empty means: log these, keep the health server up, do nothing else.
   */
  problems: Array<string>;
  // Worth saying once at start-up, but not fatal.
  warnings: Array<string>;
}

// A whole number written in digits only.
const DIGITS_PATTERN: RegExp = /^\d+$/;

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] || "").trim();
}

// Only "true" (any case, whitespace ignored) turns a switch on.
export function parseSwitch(value: string | null | undefined): boolean {
  return (value || "").trim().toLowerCase() === "true";
}

export function parseWriteNamespaces(
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

/*
 * A whole number of milliseconds, raised to the minimum; anything that is
 * not a positive whole number falls back to the default.
 */
export function parseInterval(data: {
  value: string | undefined;
  defaultValue: number;
  min: number;
}): number {
  const raw: string = (data.value || "").trim();

  if (!DIGITS_PATTERN.test(raw)) {
    return data.defaultValue;
  }

  const parsed: number = parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return data.defaultValue;
  }

  return Math.max(parsed, data.min);
}

export function parsePort(value: string | undefined): number {
  const raw: string = (value || "").trim();
  const parsed: number = DIGITS_PATTERN.test(raw) ? parseInt(raw, 10) : NaN;

  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT;
}

export function normalizeOneUptimeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed: URL = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/*
 * A set switch that is neither "true" nor "false" already refuses; say so
 * once, so nobody has to guess what "yes" or "enabled" did.
 */
function describeUnrecognisedSwitch(data: {
  name: string;
  value: string | null;
  what: string;
}): string | null {
  if (
    data.value === null ||
    data.value.trim() === "" ||
    ["true", "false"].includes(data.value.trim().toLowerCase())
  ) {
    return null;
  }

  return `${data.name}="${data.value}" is not "true" or "false", so ${data.what} stay off. Set it to "true" to allow them.`;
}

export function parseConfig(env: NodeJS.ProcessEnv): ParsedConfig {
  const problems: Array<string> = [];
  const warnings: Array<string> = [];

  const oneuptimeUrl: string = normalizeOneUptimeUrl(
    readTrimmed(env, ONEUPTIME_URL_ENV),
  );
  const apiKey: string = readTrimmed(env, ONEUPTIME_API_KEY_ENV);
  const clusterName: string = readTrimmed(env, CLUSTER_NAME_ENV);

  if (!oneuptimeUrl) {
    problems.push(
      `${ONEUPTIME_URL_ENV} is not set. Set oneuptime.url on the Kubernetes agent chart.`,
    );
  } else if (!isHttpUrl(oneuptimeUrl)) {
    problems.push(
      `${ONEUPTIME_URL_ENV}="${oneuptimeUrl}" is not an http(s) URL. Set oneuptime.url on the Kubernetes agent chart to your OneUptime address, e.g. https://oneuptime.com.`,
    );
  }

  if (!apiKey) {
    problems.push(
      `${ONEUPTIME_API_KEY_ENV} is not set. Set oneuptime.apiKey on the Kubernetes agent chart (the same telemetry ingestion key the collector uses).`,
    );
  }

  if (!clusterName) {
    problems.push(
      `${CLUSTER_NAME_ENV} is not set. Set clusterName on the Kubernetes agent chart.`,
    );
  }

  const allowWritesSetting: string | null =
    env[KUBECTL_ALLOW_WRITES_ENV] ?? null;
  const allowNodeOperationsSetting: string | null =
    env[KUBECTL_ALLOW_NODE_OPERATIONS_ENV] ?? null;

  for (const warning of [
    describeUnrecognisedSwitch({
      name: KUBECTL_ALLOW_WRITES_ENV,
      value: allowWritesSetting,
      what: "kubectl writes",
    }),
    describeUnrecognisedSwitch({
      name: KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
      value: allowNodeOperationsSetting,
      what: "node operations",
    }),
  ]) {
    if (warning) {
      warnings.push(warning);
    }
  }

  const chartVersion: string = readTrimmed(env, CHART_VERSION_ENV);
  const podNamespace: string = readTrimmed(
    env,
    AI_AGENT_POD_NAMESPACE_ENV,
  ).toLowerCase();
  const agentVersion: string = readTrimmed(env, "APP_VERSION");

  return {
    config: {
      oneuptimeUrl,
      apiKey,
      clusterName,
      chartVersion: chartVersion || null,
      allowWrites: parseSwitch(allowWritesSetting),
      allowWritesSetting,
      writeNamespaces: parseWriteNamespaces(env[KUBECTL_WRITE_NAMESPACES_ENV]),
      allowNodeOperations: parseSwitch(allowNodeOperationsSetting),
      allowNodeOperationsSetting,
      podNamespace: podNamespace || null,
      port: parsePort(env["PORT"]),
      pollIntervalMs: parseInterval({
        value: env[POLL_INTERVAL_ENV],
        defaultValue: DEFAULT_POLL_INTERVAL_MS,
        min: MIN_POLL_INTERVAL_MS,
      }),
      heartbeatIntervalMs: parseInterval({
        value: env[HEARTBEAT_INTERVAL_ENV],
        defaultValue: DEFAULT_HEARTBEAT_INTERVAL_MS,
        min: MIN_HEARTBEAT_INTERVAL_MS,
      }),
      agentVersion: agentVersion || null,
    },
    problems,
    warnings,
  };
}
