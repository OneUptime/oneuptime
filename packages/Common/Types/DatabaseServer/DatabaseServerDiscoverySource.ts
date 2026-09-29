/*
 * How a DatabaseServer row came to exist. Stored on the row
 * (`discoverySource`) by whichever path created it first and never
 * overwritten afterwards, so the column always answers "why is this database
 * in my list?".
 *
 * Isomorphic: the ingest pipeline, the discovery crons, the services and the
 * dashboard (list filter, Overview info row) all read the same values.
 */
enum DatabaseServerDiscoverySource {
  // An OpenTelemetry Collector DB receiver or the OneUptime Database Agent.
  Collector = "collector",
  // CLIENT spans of an instrumented application (`db.system.name`).
  ClientSpans = "client-spans",
  // A database workload on a monitored Kubernetes cluster.
  Kubernetes = "kubernetes",
  // A database container on a monitored Docker host.
  Docker = "docker",
  // A database container on a monitored Podman host.
  Podman = "podman",
  // Created by a user in the dashboard.
  Manual = "manual",
}

export default DatabaseServerDiscoverySource;

/** Every source, in the order the dashboard filter offers them. */
export const DATABASE_SERVER_DISCOVERY_SOURCES: ReadonlyArray<DatabaseServerDiscoverySource> =
  [
    DatabaseServerDiscoverySource.Collector,
    DatabaseServerDiscoverySource.ClientSpans,
    DatabaseServerDiscoverySource.Kubernetes,
    DatabaseServerDiscoverySource.Docker,
    DatabaseServerDiscoverySource.Podman,
    DatabaseServerDiscoverySource.Manual,
  ];

const LABELS: Record<DatabaseServerDiscoverySource, string> = {
  [DatabaseServerDiscoverySource.Collector]: "OpenTelemetry Collector",
  [DatabaseServerDiscoverySource.ClientSpans]: "Application traces",
  [DatabaseServerDiscoverySource.Kubernetes]: "Kubernetes",
  [DatabaseServerDiscoverySource.Docker]: "Docker",
  [DatabaseServerDiscoverySource.Podman]: "Podman",
  [DatabaseServerDiscoverySource.Manual]: "Added manually",
};

/**
 * Human label for a stored `discoverySource`. Takes a loose string because
 * the value comes from a database column: anything this build does not know
 * (a null column, a value written by a newer server) reads "Unknown" rather
 * than leaking the raw wire value.
 */
export function getDatabaseServerDiscoverySourceLabel(
  source: string | null | undefined,
): string {
  if (typeof source !== "string") {
    return "Unknown";
  }

  const key: string = source.trim().toLowerCase();

  // Own-property check: "constructor" must not resolve to Object.prototype's.
  if (!Object.prototype.hasOwnProperty.call(LABELS, key)) {
    return "Unknown";
  }

  return LABELS[key as DatabaseServerDiscoverySource];
}
