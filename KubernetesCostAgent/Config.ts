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
 */
export const COST_ENGINE_URL: string = required("COST_ENGINE_URL").replace(
  /\/+$/,
  "",
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

export const LOG_LEVEL: string = optional("LOG_LEVEL", "info");
