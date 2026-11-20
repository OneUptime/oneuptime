const required: (key: string) => string = (key: string): string => {
  const value: string | undefined = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional: (key: string, fallback: string) => string = (
  key: string,
  fallback: string,
): string => {
  return process.env[key] || fallback;
};

export const ONEUPTIME_URL: string = required("ONEUPTIME_URL").replace(
  /\/+$/,
  "",
);
export const ONEUPTIME_API_KEY: string = required("ONEUPTIME_API_KEY");
export const CLUSTER_NAME: string = required("CLUSTER_NAME");

/*
 * Base URL of the in-cluster cost engine, e.g.
 *   http://opencost.opencost.svc.cluster.local:9003          (OpenCost)
 *   http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090  (Kubecost)
 *
 * Or "auto": the agent finds the OpenCost or Kubecost the cluster already
 * runs (EngineDiscovery) and reads that, and keeps looking until there is
 * one. The chart sets it when cost.engine.url is auto and bundles nothing.
 */
export const COST_ENGINE_URL: string = required("COST_ENGINE_URL")
  .trim()
  .replace(/\/+$/, "");

export const COST_ENGINE_AUTO: string = "auto";

export const IS_COST_ENGINE_AUTO: boolean =
  COST_ENGINE_URL.toLowerCase() === COST_ENGINE_AUTO;

/*
 * "true" when COST_ENGINE_URL is the engine the chart bundled with the agent
 * and the cluster may already run one of its own: the agent then looks for
 * that one first and reads it if it answers, so the person's own engine -
 * their rate card, their cloud billing integration - prices the cluster, and
 * falls back to the bundled one otherwise. The chart leaves it off when the
 * bundled engine has a rate card of its own (cost.opencost.customPricing):
 * someone chose those rates.
 */
export const COST_PREFER_EXISTING_ENGINE: boolean =
  optional("COST_PREFER_EXISTING_ENGINE", "false").trim().toLowerCase() ===
  "true";

/*
 * What the chart knows about the bundled engine's prices: "true" when it
 * gave it a rate card (cost.opencost.customPricing.enabled), "false" when it
 * did not, empty for an engine the chart did not bundle. A fallback only:
 * the agent asks the engine itself first (EnginePricing).
 */
export const COST_ENGINE_RATE_CARD: string = optional(
  "COST_ENGINE_RATE_CARD",
  "",
)
  .trim()
  .toLowerCase();

/*
 * How often to look for the cluster's own engine again once one is chosen
 * (or the bundled one is in use), so an engine installed later is found. An
 * engine that keeps failing is looked for again sooner
 * (COST_ENGINE_FAILURES_BEFORE_REDISCOVERY ticks in a row), and in auto mode
 * every tick looks until one is found.
 */
export const COST_ENGINE_REDISCOVERY_SECONDS: number = parseInt(
  optional("COST_ENGINE_REDISCOVERY_SECONDS", "3600"),
  10,
);

export const COST_ENGINE_FAILURES_BEFORE_REDISCOVERY: number = parseInt(
  optional("COST_ENGINE_FAILURES_BEFORE_REDISCOVERY", "3"),
  10,
);

/*
 * The Kubernetes API, for finding the cluster's own engine. Empty: the
 * in-cluster address and the pod's ServiceAccount. Set it to run the agent
 * outside a cluster against `kubectl proxy` (http://127.0.0.1:8001).
 */
export const KUBERNETES_API_URL: string = optional("KUBERNETES_API_URL", "")
  .trim()
  .replace(/\/+$/, "");

export const KUBERNETES_TOKEN_PATH: string = optional(
  "KUBERNETES_TOKEN_PATH",
  "/var/run/secrets/kubernetes.io/serviceaccount/token",
);

export const KUBERNETES_CA_PATH: string = optional(
  "KUBERNETES_CA_PATH",
  "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
);

/*
 * Prometheus that scrapes this cluster's cAdvisor, e.g.
 *   http://oneuptime-k8s-agent-kubernetes-agent-cost-prometheus.oneuptime.svc.cluster.local:9090
 *
 * Optional, and deliberately so. It supplies the per-container memory PEAK
 * that right-sizing needs and the Allocation API cannot give: the engines
 * report averages over the window, and sizing a memory request off an
 * average is how you get OOMKills, because the spike that kills a container
 * disappears into an hourly mean. An empty value means the agent finds the
 * Prometheus the engine it reads uses (EnginePrometheus, #9777), and ships
 * allocations without peaks when there is none - never a fatal error.
 *
 * Set, it is cost.engine.prometheusUrl, which the agent reads whatever the
 * engine - unless COST_PROMETHEUS_BUNDLED says it is the chart's bundled
 * Prometheus.
 */
export const COST_PROMETHEUS_URL: string = optional("COST_PROMETHEUS_URL", "")
  .trim()
  .replace(/\/+$/, "");

/*
 * "true" when COST_PROMETHEUS_URL is the Prometheus the chart bundled beside
 * its OpenCost, not one someone named: the agent then reads it for the
 * bundled engine, and for the cluster's own engine only when that engine's
 * own Prometheus cannot be found. An agent older than this reads it always,
 * as before.
 */
export const COST_PROMETHEUS_BUNDLED: boolean =
  optional("COST_PROMETHEUS_BUNDLED", "false").trim().toLowerCase() === "true";

/*
 * Prometheus job label of the cAdvisor scrape. The bundled config names it
 * kubernetes-nodes-cadvisor, as Kubecost's and the community chart's
 * Prometheus do. Unset, the agent reads the job off the Prometheus it uses
 * (kubernetes-nodes-cadvisor when it has one, else the job its cAdvisor
 * memory series carry: kubelet in kube-prometheus-stack's); set it to name
 * one.
 */
export const COST_PROMETHEUS_CADVISOR_JOB: string = optional(
  "COST_PROMETHEUS_CADVISOR_JOB",
  "kubernetes-nodes-cadvisor",
).trim();

// The job the bundled Prometheus, Kubecost's and the community chart's use.
export const DEFAULT_PROMETHEUS_CADVISOR_JOB: string =
  "kubernetes-nodes-cadvisor";

// Whether COST_PROMETHEUS_CADVISOR_JOB was set rather than left to default.
export const IS_COST_PROMETHEUS_CADVISOR_JOB_SET: boolean = Boolean(
  (process.env["COST_PROMETHEUS_CADVISOR_JOB"] || "").trim(),
);

/*
 * Allocation API path on the engine. Empty (default) auto-detects by
 * probing, in order: /model/allocation (Kubecost frontend/aggregator),
 * /allocation/compute (OpenCost), /allocation (older OpenCost).
 */
export const COST_ALLOCATION_PATH: string = optional(
  "COST_ALLOCATION_PATH",
  "",
).trim();

/** Allocation window length. Hourly is the engines' native ETL resolution. */
export const WINDOW_SECONDS: number = parseInt(
  optional("WINDOW_SECONDS", "3600"),
  10,
);

/** How often to check whether a new closed window is ready to ship. */
export const POLL_INTERVAL_SECONDS: number = parseInt(
  optional("POLL_INTERVAL_SECONDS", "300"),
  10,
);

/*
 * Only ship a window once it has been closed for this long, so the engine
 * has finished pricing/reconciling it.
 */
export const ENGINE_SETTLE_SECONDS: number = parseInt(
  optional("ENGINE_SETTLE_SECONDS", "120"),
  10,
);

/*
 * Closed windows to (re-)ship on startup. The server skips windows that
 * already have rows, so a restart inside the lookback cannot double-count.
 */
export const LOOKBACK_WINDOWS: number = parseInt(
  optional("LOOKBACK_WINDOWS", "2"),
  10,
);

/** Include the engine's __idle__ allocation so idle spend is queryable. */
export const INCLUDE_IDLE: boolean =
  optional("INCLUDE_IDLE", "true").toLowerCase() !== "false";

/** Rows per ingest POST. Must stay <= the server's per-request cap (5000). */
export const SHIP_BATCH_SIZE: number = parseInt(
  optional("SHIP_BATCH_SIZE", "1000"),
  10,
);

export const EXPORT_MAX_RETRIES: number = parseInt(
  optional("EXPORT_MAX_RETRIES", "5"),
  10,
);

/** Currency code forwarded with every payload (informational). */
export const COST_CURRENCY: string = optional("COST_CURRENCY", "USD");

export const HEALTH_PORT: number = parseInt(
  optional("HEALTH_PORT", "13134"),
  10,
);

/*
 * Health thresholds.
 *
 * /healthz has to separate "quiet because there is nothing to do yet" from
 * "quiet because the pipeline is broken". A cost agent is quiet for long
 * stretches by design — it ships once an hour — and on a fresh install the
 * LOOKBACK_WINDOWS windows it re-ships predate the engine, so they
 * legitimately come back empty. Both thresholds below therefore run off
 * "time since the process started" and are generous by default; the fast
 * signal is HEALTH_MAX_POLL_FAILURES, which needs real errors, not silence.
 */

/*
 * Consecutive failing ticks before the agent reports degraded. At the
 * default POLL_INTERVAL_SECONDS that is ~15 minutes of an unreachable or
 * erroring cost engine — well past any engine's own startup. If you shorten
 * POLL_INTERVAL_SECONDS substantially, raise this to keep the same
 * wall-clock patience.
 */
export const HEALTH_MAX_POLL_FAILURES: number = parseInt(
  optional("HEALTH_MAX_POLL_FAILURES", "3"),
  10,
);

/*
 * Windows of silence tolerated before the agent reports degraded. A window
 * completes roughly every WINDOW_SECONDS, so the default leaves two whole
 * windows of slack; anything below 2 will flap.
 */
export const HEALTH_STALE_WINDOWS: number = parseInt(
  optional("HEALTH_STALE_WINDOWS", "3"),
  10,
);

export const LOG_LEVEL: string = optional("LOG_LEVEL", "info");
