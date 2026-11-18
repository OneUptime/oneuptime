import { translationKey } from "../Translator";

/*
 * WHAT A CLOUD RESOURCE'S KEY METRIC IS ABOUT.
 *
 * Every key metric a cloud connection reads (CloudKeyMetrics) is filed
 * under one of these, so a resource's Metrics card reads as a few short
 * sections - Availability, Traffic, Errors, Latency, then the resources it
 * uses - rather than one alphabetical list of twenty names. The sections
 * come in this order on every resource of every cloud: whether it is up
 * first, then what it serves and how well (the requests, errors and
 * latency an alert is usually about), then what it runs on.
 *
 * Each name is a word the Dashboard already says in every language, so a
 * section's heading reads in the reader's language; the metrics under it
 * keep their cloud's own names, drawn as written.
 */
export enum CloudKeyMetricGroup {
  // Up or down: health checks, availability, healthy hosts, tunnels.
  Availability = "availability",
  // What it serves: requests, invocations, messages, bytes processed.
  Traffic = "traffic",
  // What failed: 5xx and 4xx, failed runs, throttles, rejections.
  Errors = "errors",
  // How long it takes: response time, query and request latency.
  Latency = "latency",
  // What it computes with: CPU, DTUs, request units, server load, credits.
  Compute = "compute",
  Memory = "memory",
  // What it keeps, and how fast it reads and writes it: disks, IOPS, capacity.
  Storage = "storage",
  // Bytes and packets in and out.
  Network = "network",
  // Connections, sessions and clients.
  Connections = "connections",
  // Hits, misses, evictions and keys.
  Cache = "cache",
  // Work waiting: queue depth, the oldest message, a request queue.
  Backlog = "backlog",
  // How far a replica is behind.
  Replication = "replication",
}

// The order a resource's sections come in (see the top of this file).
export const CLOUD_KEY_METRIC_GROUP_ORDER: ReadonlyArray<CloudKeyMetricGroup> =
  [
    CloudKeyMetricGroup.Availability,
    CloudKeyMetricGroup.Traffic,
    CloudKeyMetricGroup.Errors,
    CloudKeyMetricGroup.Latency,
    CloudKeyMetricGroup.Compute,
    CloudKeyMetricGroup.Memory,
    CloudKeyMetricGroup.Storage,
    CloudKeyMetricGroup.Network,
    CloudKeyMetricGroup.Connections,
    CloudKeyMetricGroup.Cache,
    CloudKeyMetricGroup.Backlog,
    CloudKeyMetricGroup.Replication,
  ];

/*
 * Each section's heading, in English: keys of the Dashboard's locale files,
 * drawn in the reader's language.
 */
export const CLOUD_KEY_METRIC_GROUP_LABELS: Readonly<
  Record<CloudKeyMetricGroup, string>
> = {
  [CloudKeyMetricGroup.Availability]: translationKey("Availability"),
  [CloudKeyMetricGroup.Traffic]: translationKey("Traffic"),
  [CloudKeyMetricGroup.Errors]: translationKey("Errors"),
  [CloudKeyMetricGroup.Latency]: translationKey("Latency"),
  [CloudKeyMetricGroup.Compute]: translationKey("Compute"),
  [CloudKeyMetricGroup.Memory]: translationKey("Memory"),
  [CloudKeyMetricGroup.Storage]: translationKey("Storage"),
  [CloudKeyMetricGroup.Network]: translationKey("Network"),
  [CloudKeyMetricGroup.Connections]: translationKey("Connections"),
  [CloudKeyMetricGroup.Cache]: translationKey("Cache"),
  [CloudKeyMetricGroup.Backlog]: translationKey("Backlog"),
  [CloudKeyMetricGroup.Replication]: translationKey("Replication"),
};

// A section's place in CLOUD_KEY_METRIC_GROUP_ORDER.
export function getCloudKeyMetricGroupOrder(
  group: CloudKeyMetricGroup,
): number {
  const index: number = CLOUD_KEY_METRIC_GROUP_ORDER.indexOf(group);
  return index < 0 ? CLOUD_KEY_METRIC_GROUP_ORDER.length : index;
}
