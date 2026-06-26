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

const parseList: (value: string) => Array<string> = (
  value: string,
): Array<string> => {
  return value
    .split(",")
    .map((s: string): string => {
      return s.trim();
    })
    .filter((s: string): boolean => {
      return s.length > 0;
    });
};

export const ONEUPTIME_URL: string = required("ONEUPTIME_URL").replace(
  /\/+$/,
  "",
);
export const ONEUPTIME_API_KEY: string = required("ONEUPTIME_API_KEY");
export const CLUSTER_NAME: string = required("CLUSTER_NAME");

/*
 * Comma-separated key=value pairs from .Values.oneuptime.labels. Each pair
 * becomes an `oneuptime.label.<key>=<value>` resource attribute on every
 * outgoing OTLP log batch; the OneUptime ingest pipeline promotes those
 * into project Labels.
 */
const parseLabels: (value: string) => Record<string, string> = (
  value: string,
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const pair of parseList(value)) {
    const eq: number = pair.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key: string = pair.substring(0, eq).trim();
    const val: string = pair.substring(eq + 1).trim();
    if (key && val) {
      result[key] = val;
    }
  }
  return result;
};

export const ONEUPTIME_LABELS: Record<string, string> = parseLabels(
  optional("ONEUPTIME_LABELS", ""),
);

export const NAMESPACE_INCLUDE: Array<string> = parseList(
  optional("NAMESPACE_INCLUDE", ""),
);
export const NAMESPACE_EXCLUDE: Array<string> = parseList(
  optional("NAMESPACE_EXCLUDE", "kube-system"),
);

export const AGENT_NAMESPACE: string = optional("AGENT_NAMESPACE", "");
export const AGENT_LABEL_SELECTOR: string = optional(
  "AGENT_LABEL_SELECTOR",
  "app.kubernetes.io/part-of=oneuptime",
);

export const BATCH_MAX_RECORDS: number = parseInt(
  optional("BATCH_MAX_RECORDS", "500"),
  10,
);
export const BATCH_MAX_MS: number = parseInt(
  optional("BATCH_MAX_MS", "5000"),
  10,
);
export const EXPORT_MAX_RETRIES: number = parseInt(
  optional("EXPORT_MAX_RETRIES", "5"),
  10,
);

export const SINCE_SECONDS_ON_START: number = parseInt(
  optional("SINCE_SECONDS_ON_START", "10"),
  10,
);

/*
 * Multi-line recombination. The Kubernetes API streams one log line per
 * newline, so a stack trace or pretty-printed JSON arrives as many lines and
 * would otherwise become many separate logs in OneUptime. When enabled
 * (default), continuation lines — those that do not start a new entry — are
 * merged into the preceding record so each event is a single log, matching the
 * recombine operator the DaemonSet collector and Docker agent already use.
 *
 * LOG_RECOMBINE_FLUSH_MS  flushes an in-progress record after this many ms of
 *   stream silence, so the last line of a burst (and low-traffic single lines)
 *   is not held indefinitely.
 * LOG_RECOMBINE_MAX_BYTES caps the combined body so a runaway stream of
 *   continuation lines cannot grow one record without bound.
 */
export const LOG_RECOMBINE_ENABLED: boolean =
  optional("LOG_RECOMBINE_ENABLED", "true").toLowerCase() !== "false";
export const LOG_RECOMBINE_FLUSH_MS: number = parseInt(
  optional("LOG_RECOMBINE_FLUSH_MS", "5000"),
  10,
);
export const LOG_RECOMBINE_MAX_BYTES: number = parseInt(
  optional("LOG_RECOMBINE_MAX_BYTES", "1048576"),
  10,
);

export const HEALTH_PORT: number = parseInt(
  optional("HEALTH_PORT", "13133"),
  10,
);

export const LOG_LEVEL: string = optional("LOG_LEVEL", "info");
