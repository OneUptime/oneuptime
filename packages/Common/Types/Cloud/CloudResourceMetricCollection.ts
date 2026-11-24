/*
 * HOW A CLOUD RESOURCE'S METRICS WERE COLLECTED (#10291).
 *
 * A cloud connection's read keeps, for each resource whose metrics it could
 * not read in full, what it could not read and why (Azure: AzureMetricReads)
 * - the resource as a whole, when no call for it was answered, and each
 * metric the cloud answered with an error of its own:
 *
 *   - Unsupported: the cloud does not serve it for the resource ("Sampling
 *     type is not found", "Bad request"). It would fail the same way at
 *     every read, so it is not asked for again until a day has passed.
 *   - Throttled: the cloud was too busy to answer ("ServerBusy: Too many
 *     queries are in flight"), after the read asked again a few times. The
 *     next read asks again.
 *   - Failed: anything else. The next read asks again.
 *
 * A resource read in full keeps nothing. Its Metrics tab and its Overview
 * say when its metrics were last read and what was not, with the cloud's
 * own words (CloudResourceMetrics.collectionOf).
 */

export enum CloudMetricNotReadKind {
  Unsupported = "unsupported",
  Throttled = "throttled",
  Failed = "failed",
}

// A metric of a resource a read could not read.
export interface CloudMetricNotRead {
  // The cloud's own name for it: "CpuPercentage".
  name: string;
  kind: CloudMetricNotReadKind;
  // What the cloud answered, in its own words.
  error: string;
  // When a read first found it so, and when one last did (ISO times).
  since: string;
  at: string;
  // Unsupported: it is not asked for again until then.
  until?: string | undefined;
}

// What a connection keeps of a resource whose metrics a read could not read in full.
export interface CloudResourceMetricStatus {
  // No call for it was answered: why, and since when that has been so.
  failed?: { error: string; since: string; at: string } | undefined;
  // Its metrics the cloud answered with an error, by their lowercased names.
  metrics?: Record<string, CloudMetricNotRead> | undefined;
}

export enum CloudMetricCollectionState {
  // Its connection's last read read every metric it asked for.
  Collected = "collected",
  // It read the resource, but not every metric.
  Partial = "partial",
  // It could not read the resource, or the read failed.
  Failed = "failed",
  // No read has reached it yet.
  Waiting = "waiting",
  // Its connection is turned off.
  Off = "off",
}

// What a resource's pages say of how its metrics were collected.
export interface CloudResourceMetricCollection {
  state: CloudMetricCollectionState;
  // When its connection last read it (ISO): null when none did, or it failed.
  lastReadAt: string | null;
  // Failed: since when it has not been read, and why.
  failedSince?: string | undefined;
  error?: string | undefined;
  // Its metrics the last read could not read, unsupported ones first.
  metrics: Array<CloudMetricNotRead>;
}

// The longest error kept of a metric or a resource: the cloud's first words are what say why.
export const CLOUD_METRIC_ERROR_MAX_LENGTH: number = 300;

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readTime(value: unknown): string | null {
  const time: number = typeof value === "string" ? Date.parse(value) : NaN;

  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// An error as it is kept: on one line, CLOUD_METRIC_ERROR_MAX_LENGTH at most.
export function trimCloudMetricError(error: string): string {
  const text: string = error.replace(/\s+/g, " ").trim();

  return text.length > CLOUD_METRIC_ERROR_MAX_LENGTH
    ? `${text.slice(0, CLOUD_METRIC_ERROR_MAX_LENGTH - 1)}…`
    : text;
}

// A metric not read, as kept or answered; null when it is not one.
export function readCloudMetricNotRead(
  value: unknown,
): CloudMetricNotRead | null {
  const raw: Record<string, unknown> | null = readObject(value);

  if (!raw) {
    return null;
  }

  const name: string = readText(raw["name"]);
  const kind: unknown = raw["kind"];
  const since: string | null = readTime(raw["since"]);
  const at: string | null = readTime(raw["at"]);

  if (
    !name ||
    typeof kind !== "string" ||
    !(Object.values(CloudMetricNotReadKind) as Array<string>).includes(kind) ||
    !since ||
    !at
  ) {
    return null;
  }

  const until: string | null = readTime(raw["until"]);

  return {
    name,
    kind: kind as CloudMetricNotReadKind,
    error: readText(raw["error"]),
    since,
    at,
    ...(until ? { until } : {}),
  };
}

// What a connection keeps of a resource, read defensively: unknown entries are dropped.
export function readCloudResourceMetricStatus(
  value: unknown,
): CloudResourceMetricStatus {
  const raw: Record<string, unknown> | null = readObject(value);
  const status: CloudResourceMetricStatus = {};

  if (!raw) {
    return status;
  }

  const failed: Record<string, unknown> | null = readObject(raw["failed"]);
  const failedSince: string | null = failed ? readTime(failed["since"]) : null;
  const failedAt: string | null = failed ? readTime(failed["at"]) : null;

  if (failed && failedSince && failedAt) {
    status.failed = {
      error: readText(failed["error"]),
      since: failedSince,
      at: failedAt,
    };
  }

  const metrics: Record<string, unknown> | null = readObject(raw["metrics"]);

  for (const [key, item] of Object.entries(metrics || {})) {
    const metric: CloudMetricNotRead | null = readCloudMetricNotRead(item);

    if (metric) {
      status.metrics = status.metrics || {};
      status.metrics[key.toLowerCase()] = metric;
    }
  }

  return status;
}

// The order a resource's metrics not read are listed in: what will not pass first.
const KIND_ORDER: Record<CloudMetricNotReadKind, number> = {
  [CloudMetricNotReadKind.Unsupported]: 0,
  [CloudMetricNotReadKind.Failed]: 1,
  [CloudMetricNotReadKind.Throttled]: 2,
};

export function sortCloudMetricsNotRead(
  metrics: Array<CloudMetricNotRead>,
): Array<CloudMetricNotRead> {
  return [...metrics].sort(
    (a: CloudMetricNotRead, b: CloudMetricNotRead): number => {
      const byKind: number = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];

      if (byKind !== 0) {
        return byKind;
      }

      return a.name.toLowerCase() < b.name.toLowerCase()
        ? -1
        : a.name.toLowerCase() > b.name.toLowerCase()
          ? 1
          : 0;
    },
  );
}

// The server's answer, read defensively; null when it says nothing of the resource.
export function readCloudResourceMetricCollection(
  value: unknown,
): CloudResourceMetricCollection | null {
  const raw: Record<string, unknown> | null = readObject(value);
  const collection: Record<string, unknown> | null = raw
    ? readObject(raw["collection"]) || raw
    : null;
  const state: unknown = collection?.["state"];

  if (
    !collection ||
    typeof state !== "string" ||
    !(Object.values(CloudMetricCollectionState) as Array<string>).includes(
      state,
    )
  ) {
    return null;
  }

  const failedSince: string | null = readTime(collection["failedSince"]);
  const error: string = readText(collection["error"]);

  return {
    state: state as CloudMetricCollectionState,
    lastReadAt: readTime(collection["lastReadAt"]),
    ...(failedSince ? { failedSince } : {}),
    ...(error ? { error } : {}),
    metrics: sortCloudMetricsNotRead(
      (Array.isArray(collection["metrics"]) ? collection["metrics"] : [])
        .map(readCloudMetricNotRead)
        .filter(
          (metric: CloudMetricNotRead | null): metric is CloudMetricNotRead => {
            return metric !== null;
          },
        ),
    ),
  };
}
