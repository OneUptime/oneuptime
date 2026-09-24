import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import ValueFormatter from "Common/Utils/ValueFormatter";
import DatabaseServerDiscoverySource, {
  DATABASE_SERVER_DISCOVERY_SOURCES,
  getDatabaseServerDiscoverySourceLabel,
} from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import { DatabaseServerMetricKind } from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
  normalizeDatabaseSystem,
} from "Common/Types/DatabaseServer/DatabaseSystem";

/*
 * How the Databases pages describe a DatabaseServer row: its engine-metrics
 * status, whether it has been seen recently, what it runs on, the runtime
 * metrics that fit that platform, the dropdown options of the list's
 * filters and create form, and how a catalog metric's value is formatted.
 * Pure (no React, no API) so the wording and the arithmetic are unit-tested
 * without a renderer, and the list, Overview and Archived pages cannot drift.
 */

export interface DatabaseOption {
  label: string;
  value: string;
}

// ---- engine -----------------------------------------------------------

/**
 * Every engine the registry knows, for the create form and the Engine
 * filter, alphabetical by display name. The label carries the semconv
 * `db.system.name` value because that string is what users find in their
 * spans.
 */
export function getDatabaseEngineOptions(): Array<DatabaseOption> {
  return DATABASE_SYSTEMS.map(
    (descriptor: DatabaseSystemDescriptor): DatabaseOption => {
      return {
        label: `${descriptor.displayName} (${descriptor.system})`,
        value: descriptor.system,
      };
    },
  ).sort((a: DatabaseOption, b: DatabaseOption): number => {
    return a.label.localeCompare(b.label);
  });
}

/** Every discovery source, in the order the filter offers them. */
export function getDatabaseDiscoverySourceOptions(): Array<DatabaseOption> {
  return DATABASE_SERVER_DISCOVERY_SOURCES.map(
    (source: DatabaseServerDiscoverySource): DatabaseOption => {
      return {
        label: getDatabaseServerDiscoverySourceLabel(source),
        value: source,
      };
    },
  );
}

/** "PostgreSQL" — or the raw value for an engine this build does not know. */
export function getDatabaseEngineLabel(
  dbSystem: string | null | undefined,
): string {
  return getDatabaseSystemDisplayName(dbSystem);
}

// ---- engine metrics status -------------------------------------------

export enum DatabaseEngineMetricsStatus {
  Connected = "connected",
  Disconnected = "disconnected",
  // No collector / Database Agent has ever reported for this database.
  NotConnected = "not-connected",
}

export interface DatabaseEngineMetricsStatusSource {
  otelCollectorStatus?: string | null | undefined;
  collectorLastSeenAt?: Date | string | null | undefined;
}

function isValidTimestamp(value: Date | string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const date: Date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

/**
 * The status of the database's ENGINE metrics — the collector / Database
 * Agent side:
 *
 *   - Connected: the collector path says so (it writes "connected" with
 *     every batch).
 *   - Disconnected: a collector DID report (`collectorLastSeenAt`, which only
 *     the collector path writes) and has stopped.
 *   - Not connected: nothing ever reported. A row found from traces,
 *     Kubernetes, Docker, Podman or by hand stores no `otelCollectorStatus`
 *     (NULL) until a collector reports; one created before the column's
 *     "disconnected" default was dropped reads "disconnected" with no
 *     collectorLastSeenAt. Either way it never had an agent, so it must not
 *     be told one "stopped reporting".
 */
export function getDatabaseEngineMetricsStatus(
  source: DatabaseEngineMetricsStatusSource | null | undefined,
): DatabaseEngineMetricsStatus {
  const status: string = (source?.otelCollectorStatus || "")
    .toString()
    .trim()
    .toLowerCase();

  if (status === "connected") {
    return DatabaseEngineMetricsStatus.Connected;
  }

  if (isValidTimestamp(source?.collectorLastSeenAt)) {
    return DatabaseEngineMetricsStatus.Disconnected;
  }

  return DatabaseEngineMetricsStatus.NotConnected;
}

/*
 * The Engine-metrics filter on the Databases list, in the order it offers
 * them. The values are the enum's, so a saved "connected" / "disconnected"
 * selection keeps working.
 */
export function getDatabaseEngineMetricsStatusOptions(): Array<DatabaseOption> {
  return [
    DatabaseEngineMetricsStatus.Connected,
    DatabaseEngineMetricsStatus.Disconnected,
    DatabaseEngineMetricsStatus.NotConnected,
  ].map((status: DatabaseEngineMetricsStatus): DatabaseOption => {
    return {
      value: status,
      label: getDatabaseEngineMetricsStatusLabel(status),
    };
  });
}

/*
 * Which rows one engine-metrics status selects — exactly the rows
 * getDatabaseEngineMetricsStatus maps to it. A status takes TWO columns to
 * express (a never-connected row stores no status, or — written before the
 * column's default was dropped — "disconnected"), so the list's filter
 * resolves these to row ids instead of writing one column:
 *
 *   - "connected": otelCollectorStatus = "connected";
 *   - "reported-and-stopped": not connected, collectorLastSeenAt set;
 *   - "never-reported": collectorLastSeenAt empty (a connected row always
 *     has one).
 *
 * Null for a value that is not a status.
 */
export type DatabaseEngineMetricsStatusQueryKind =
  | "connected"
  | "reported-and-stopped"
  | "never-reported";

export function getDatabaseEngineMetricsStatusQueryKind(
  value: string | null | undefined,
): DatabaseEngineMetricsStatusQueryKind | null {
  switch ((value || "").trim().toLowerCase()) {
    case DatabaseEngineMetricsStatus.Connected:
      return "connected";
    case DatabaseEngineMetricsStatus.Disconnected:
      return "reported-and-stopped";
    case DatabaseEngineMetricsStatus.NotConnected:
      return "never-reported";
    default:
      return null;
  }
}

export function getDatabaseEngineMetricsStatusLabel(
  status: DatabaseEngineMetricsStatus,
): string {
  switch (status) {
    case DatabaseEngineMetricsStatus.Connected:
      return "Connected";
    case DatabaseEngineMetricsStatus.Disconnected:
      return "Disconnected";
    default:
      return "Not connected";
  }
}

// ---- liveness ---------------------------------------------------------

/*
 * A database counts as "seen recently" when any source saw it inside this
 * window. The slowest discovery path is the 10-minute client-span cron, so
 * the window covers three of its runs.
 */
export const DATABASE_SERVER_LIVE_WINDOW_MINUTES: number = 30;

export function isDatabaseServerLive(
  lastSeenAt: Date | string | null | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): boolean {
  if (!lastSeenAt) {
    return false;
  }
  const seenAt: Date =
    lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  if (Number.isNaN(seenAt.getTime())) {
    return false;
  }
  const ageInMinutes: number = (now.getTime() - seenAt.getTime()) / 60000;
  return ageInMinutes <= DATABASE_SERVER_LIVE_WINDOW_MINUTES;
}

// ---- runtime platform ------------------------------------------------

export enum DatabaseRuntimePlatform {
  Kubernetes = "kubernetes",
  Docker = "docker",
  Podman = "podman",
}

export interface DatabaseRunsOnSource {
  discoverySource?: string | null | undefined;
  kubernetesClusterId?: unknown;
  kubernetesCluster?: { name?: string | null | undefined } | null | undefined;
  kubernetesNamespace?: string | null | undefined;
  workloadKind?: string | null | undefined;
  workloadName?: string | null | undefined;
  dockerHostId?: unknown;
  dockerHost?: { name?: string | null | undefined } | null | undefined;
  podmanHostId?: unknown;
  podmanHost?: { name?: string | null | undefined } | null | undefined;
  serverAddress?: string | null | undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The container platform a database runs on, from its parent columns first
 * (a workload can be adopted by a row another source created) and its
 * discovery source second; null for a database seen only from outside.
 */
export function getDatabaseRuntimePlatform(
  source: DatabaseRunsOnSource | null | undefined,
): DatabaseRuntimePlatform | null {
  if (!source) {
    return null;
  }
  if (source.kubernetesClusterId || source.kubernetesCluster) {
    return DatabaseRuntimePlatform.Kubernetes;
  }
  if (source.dockerHostId || source.dockerHost) {
    return DatabaseRuntimePlatform.Docker;
  }
  if (source.podmanHostId || source.podmanHost) {
    return DatabaseRuntimePlatform.Podman;
  }
  switch (text(source.discoverySource).toLowerCase()) {
    case DatabaseServerDiscoverySource.Kubernetes:
      return DatabaseRuntimePlatform.Kubernetes;
    case DatabaseServerDiscoverySource.Docker:
      return DatabaseRuntimePlatform.Docker;
    case DatabaseServerDiscoverySource.Podman:
      return DatabaseRuntimePlatform.Podman;
    default:
      return null;
  }
}

/** "payments/StatefulSet/postgres" — the workload, as much as is known. */
export function getDatabaseWorkloadLabel(
  source: DatabaseRunsOnSource | null | undefined,
): string {
  const parts: Array<string> = [
    text(source?.kubernetesNamespace),
    text(source?.workloadKind),
    text(source?.workloadName),
  ].filter((part: string): boolean => {
    return part.length > 0;
  });
  return parts.join("/");
}

export interface DatabaseEndpointLabelSource extends DatabaseRunsOnSource {
  serverPort?: number | null | undefined;
}

/**
 * The second line of a database's name: the endpoint it is known by
 * ("db.prod:5432", "[2001:db8::1]:5432"), or — for a workload detected
 * without an address — the workload itself ("payments/StatefulSet/postgres").
 */
export function getDatabaseEndpointLabel(
  source: DatabaseEndpointLabelSource | null | undefined,
): string {
  const address: string = text(source?.serverAddress);
  if (address) {
    const host: string = address.includes(":") ? `[${address}]` : address;
    const port: number | null | undefined = source?.serverPort;
    return typeof port === "number" && Number.isFinite(port) && port > 0
      ? `${host}:${port}`
      : host;
  }
  return getDatabaseWorkloadLabel(source);
}

/**
 * The Endpoints tab's "Added by" pill for an endpoint's `source`: "user" is
 * an alias a person added; "workload" a Service name container discovery
 * claimed for the Kubernetes workload the database runs as (released again
 * when the workload stops producing it); "auto", and anything older or
 * unknown, what telemetry found.
 */
export function getDatabaseEndpointSourceLabel(source: unknown): {
  text: string;
  isUser: boolean;
} {
  const value: string = text(source).toLowerCase();
  if (value === "user") {
    return { text: "Added by a person", isUser: true };
  }
  if (value === "workload") {
    return { text: "Discovered (Kubernetes Service)", isUser: false };
  }
  return { text: "Discovered", isUser: false };
}

/**
 * The list's "Runs on" cell: "Kubernetes · prod-cluster", "Docker ·
 * build-host-1", "Podman", or "—" for a database only seen from outside
 * (its endpoint is already in the Name column).
 */
export function getDatabaseRunsOnLabel(
  source: DatabaseRunsOnSource | null | undefined,
): string {
  const platform: DatabaseRuntimePlatform | null =
    getDatabaseRuntimePlatform(source);

  if (!platform) {
    return "—";
  }

  const platformLabel: string =
    platform === DatabaseRuntimePlatform.Kubernetes
      ? "Kubernetes"
      : platform === DatabaseRuntimePlatform.Docker
        ? "Docker"
        : "Podman";

  const parentName: string =
    platform === DatabaseRuntimePlatform.Kubernetes
      ? text(source?.kubernetesCluster?.name)
      : platform === DatabaseRuntimePlatform.Docker
        ? text(source?.dockerHost?.name)
        : text(source?.podmanHost?.name);

  return parentName ? `${platformLabel} · ${parentName}` : platformLabel;
}

export interface DatabaseRuntimeMetric {
  title: string;
  metricName: string;
  aggregation: AggregationType;
  unit: "cores" | "percent" | "bytes";
}

export interface DatabaseRuntimeMetrics {
  cpu: DatabaseRuntimeMetric;
  memory: DatabaseRuntimeMetric;
}

/*
 * The CPU / memory metrics each platform's agent reports per member — the
 * same names the Kubernetes, Docker and Podman pages chart. Averaged per
 * bucket, so the chart reads "per instance" whatever the replica count.
 */
export const DATABASE_RUNTIME_METRICS: Record<
  DatabaseRuntimePlatform,
  DatabaseRuntimeMetrics
> = {
  [DatabaseRuntimePlatform.Kubernetes]: {
    cpu: {
      title: "CPU per pod",
      metricName: "k8s.pod.cpu.utilization",
      aggregation: AggregationType.Avg,
      unit: "cores",
    },
    memory: {
      title: "Memory per pod",
      metricName: "k8s.pod.memory.usage",
      aggregation: AggregationType.Avg,
      unit: "bytes",
    },
  },
  [DatabaseRuntimePlatform.Docker]: {
    cpu: {
      title: "CPU per container",
      metricName: "container.cpu.utilization",
      aggregation: AggregationType.Avg,
      unit: "percent",
    },
    memory: {
      title: "Memory per container",
      metricName: "container.memory.usage.total",
      aggregation: AggregationType.Avg,
      unit: "bytes",
    },
  },
  [DatabaseRuntimePlatform.Podman]: {
    cpu: {
      title: "CPU per container",
      metricName: "container.cpu.utilization",
      aggregation: AggregationType.Avg,
      unit: "percent",
    },
    memory: {
      title: "Memory per container",
      metricName: "container.memory.usage.total",
      aggregation: AggregationType.Avg,
      unit: "bytes",
    },
  },
};

// ---- formatting ------------------------------------------------------

export function formatDatabaseCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs: number = Math.abs(value);
  if (abs < 10 && !Number.isInteger(value)) {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }
  if (abs < 1000) {
    return String(Math.round(value));
  }
  if (abs < 1_000_000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (abs < 1_000_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

export function formatDatabaseBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let scaled: number = value;
  let index: number = 0;
  while (Math.abs(scaled) >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index++;
  }
  return `${scaled.toFixed(Math.abs(scaled) < 10 ? 1 : 0)} ${units[index]}`;
}

export function formatDatabaseSeconds(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 60) {
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} s`;
  }
  if (value < 3600) {
    return `${(value / 60).toFixed(1).replace(/\.0$/, "")} min`;
  }
  if (value < 86400) {
    return `${(value / 3600).toFixed(1).replace(/\.0$/, "")} h`;
  }
  return `${(value / 86400).toFixed(1).replace(/\.0$/, "")} d`;
}

/**
 * A 0..1 share as a percentage: "85%", "4.2%", "0.04%" — a nearly empty
 * tablespace is not rounded to a misleading "0%" until it truly is.
 */
export function formatDatabaseFraction(
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const percent: number = value * 100;
  const abs: number = Math.abs(percent);
  const text: string =
    abs < 1
      ? percent.toFixed(2).replace(/\.?0+$/, "")
      : abs < 10
        ? percent.toFixed(1).replace(/\.0$/, "")
        : String(Math.round(percent));
  return `${text || "0"}%`;
}

/**
 * A catalog metric's value for its tile: bytes as KiB/MiB/GiB, seconds as
 * s/min/h/d, a "fraction" (a 0..1 share) as a percentage, other units as a
 * compact count followed by the unit. Counters are rates, so they read
 * "12.5 commits/s".
 */
export function formatDatabaseMetricValue(
  value: number | null | undefined,
  unit: string,
  kind: DatabaseServerMetricKind,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const cleanUnit: string = (unit || "").trim();

  if (kind === "counter") {
    // Rates are rarely whole numbers; keep two decimals below 10, one below 1000.
    const rate: string =
      Math.abs(value) < 10
        ? value.toFixed(2).replace(/\.?0+$/, "") || "0"
        : Math.abs(value) < 1000
          ? value.toFixed(1).replace(/\.0$/, "")
          : formatDatabaseCount(value);
    if (cleanUnit === "bytes") {
      return `${formatDatabaseBytes(value)}/s`;
    }
    return cleanUnit ? `${rate} ${cleanUnit}/s` : `${rate}/s`;
  }

  if (cleanUnit === "bytes") {
    return formatDatabaseBytes(value);
  }
  if (cleanUnit === "s") {
    return formatDatabaseSeconds(value);
  }
  if (cleanUnit === "fraction") {
    return formatDatabaseFraction(value);
  }
  const count: string = formatDatabaseCount(value);
  return cleanUnit ? `${count} ${cleanUnit}` : count;
}

// A UCUM annotation-only unit such as "{connections}".
const ANNOTATION_UNIT_PATTERN: RegExp = /^\{([^{}]+)\}$/;

/**
 * A value of a metric that is NOT in the curated catalog, in the metric's
 * own unit (UCUM, as its instrumentation reported it): "4 ms" for a
 * duration in seconds, "1.5 MB" for bytes, "12 connections" for an
 * annotation unit. A rate reads "…/s". Dimensional units go through the
 * shared ValueFormatter, the one the metric explorer uses.
 */
export function formatDatabaseMetricUnitValue(
  value: number | null | undefined,
  unit: string | null | undefined,
  options?: {
    isRate?: boolean | undefined;
    metricName?: string | undefined;
  },
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const cleanUnit: string = (unit || "").trim();
  const annotation: RegExpExecArray | null =
    ANNOTATION_UNIT_PATTERN.exec(cleanUnit);

  let formatted: string;
  if (annotation) {
    // "{connections}" is a label, not a dimension: keep it readable.
    formatted = `${formatDatabaseCount(value)} ${annotation[1]!.trim()}`;
  } else if (!cleanUnit || cleanUnit === "1") {
    formatted = formatDatabaseCount(value);
  } else {
    formatted = ValueFormatter.formatValue(value, cleanUnit, {
      metricName: options?.metricName || "",
    });
  }

  return options?.isRate ? `${formatted}/s` : formatted;
}

export function formatDatabaseRuntimeValue(
  value: number | null | undefined,
  unit: DatabaseRuntimeMetric["unit"],
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (unit === "bytes") {
    return formatDatabaseBytes(value);
  }
  if (unit === "percent") {
    return `${value.toFixed(1)}%`;
  }
  return `${value < 1 ? value.toFixed(3) : value.toFixed(2)} cores`;
}

// ---- engine support --------------------------------------------------

/**
 * True when the engine has an OpenTelemetry Collector receiver, i.e. engine
 * metrics are possible at all (with our Database Agent or the user's own
 * collector).
 */
export function hasCollectorReceiver(
  dbSystem: string | null | undefined,
): boolean {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(dbSystem);
  return Boolean(descriptor?.hasCollectorReceiver);
}

/** The collector receiver type(s) for the engine, e.g. ["postgresql"]. */
export function getCollectorReceiverTypes(
  dbSystem: string | null | undefined,
): Array<string> {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(dbSystem);
  return descriptor ? [...descriptor.receiverTypes] : [];
}

/** The normalized engine or "" (unknown values are kept, canonicalized). */
export function normalizeEngine(dbSystem: string | null | undefined): string {
  return normalizeDatabaseSystem(dbSystem) || "";
}
