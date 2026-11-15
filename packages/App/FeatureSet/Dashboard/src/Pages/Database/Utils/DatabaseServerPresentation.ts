import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import ValueFormatter from "Common/Utils/ValueFormatter";
import {
  formatDurationInUnit,
  formatMilliseconds,
  MILLISECONDS_TEMPLATE,
} from "../../../Utils/Milliseconds";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import {
  isEnglishDateLanguage,
  writeFigureInLanguage,
} from "Common/Types/DateLanguage";
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
import {
  DatabaseEngineMetricsState,
  getDatabaseEngineMetricsState,
} from "Common/Types/DatabaseServer/DatabaseHealth";

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

/*
 * Options in the reader's language. The filter chips draw an option's
 * label exactly as they are given it, and a discovery source or an
 * engine-metrics status is the product's own word ("Application traces",
 * "Not connected"), so a German list read them in English. An engine's
 * name ("PostgreSQL (postgresql)") has no translation and stays as it is.
 */
export function translateDatabaseOptions(
  options: ReadonlyArray<DatabaseOption>,
  translator: { translateText: (text: string) => string | undefined },
): Array<DatabaseOption> {
  return options.map((option: DatabaseOption): DatabaseOption => {
    return {
      value: option.value,
      label: translator.translateText(option.label) || option.label,
    };
  });
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
  /*
   * The one rule, shared with a database's health (DatabaseHealth), so the
   * Engine Metrics chip and filter never disagree with the Status column.
   */
  const state: DatabaseEngineMetricsState = getDatabaseEngineMetricsState(
    source
      ? {
          otelCollectorStatus: source.otelCollectorStatus,
          collectorLastSeenAt: source.collectorLastSeenAt,
        }
      : null,
  );

  switch (state) {
    case "connected":
      return DatabaseEngineMetricsStatus.Connected;
    case "disconnected":
      return DatabaseEngineMetricsStatus.Disconnected;
    default:
      return DatabaseEngineMetricsStatus.NotConnected;
  }
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

// ---- lookup -----------------------------------------------------------

/*
 * Whether a database lookup found a row. The API answers a deleted or
 * unknown id with `{}`, which ModelAPI.getItem turns into an EMPTY model,
 * not null — so "not found" is a row without an id, and a page that only
 * checked for null rendered a whole overview of nothing, with setup
 * buttons, for a database that does not exist.
 */
export function isDatabaseServerFound(
  item: { _id?: string | null | undefined } | null | undefined,
): boolean {
  return Boolean(item && typeof item._id === "string" && item._id.trim());
}

export const DATABASE_NOT_FOUND_MESSAGE: string = "Database not found.";

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

/*
 * The Overview header's pill. It reads `lastSeenAt` — ANY source saw the
 * database (a client span, a pod, a container, an agent batch) — so it must
 * not borrow the Connected / Disconnected / Not connected words of the
 * engine-metrics status: a Kubernetes-only database seen a minute ago would
 * otherwise read "Connected" right above "Engine metrics: Not connected".
 */
export enum DatabaseLivenessStatus {
  SeenRecently = "seen-recently",
  NotSeenRecently = "not-seen-recently",
  NeverSeen = "never-seen",
}

export function getDatabaseLivenessStatus(
  lastSeenAt: Date | string | null | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): DatabaseLivenessStatus {
  if (!isValidTimestamp(lastSeenAt)) {
    return DatabaseLivenessStatus.NeverSeen;
  }
  return isDatabaseServerLive(lastSeenAt, now)
    ? DatabaseLivenessStatus.SeenRecently
    : DatabaseLivenessStatus.NotSeenRecently;
}

export function getDatabaseLivenessLabel(
  status: DatabaseLivenessStatus,
): string {
  switch (status) {
    case DatabaseLivenessStatus.SeenRecently:
      return "Seen recently";
    case DatabaseLivenessStatus.NotSeenRecently:
      return "Not seen recently";
    default:
      return "Never seen";
  }
}

// The header pill's colour for each liveness status.
export type DatabaseLivenessTone = "positive" | "warning" | "neutral";

export function getDatabaseLivenessTone(
  status: DatabaseLivenessStatus,
): DatabaseLivenessTone {
  switch (status) {
    case DatabaseLivenessStatus.SeenRecently:
      return "positive";
    case DatabaseLivenessStatus.NotSeenRecently:
      return "warning";
    default:
      return "neutral";
  }
}

// The pill's hover text: what "seen" means, and what it does not.
export const DATABASE_LIVENESS_DESCRIPTION: string = `Seen recently: application traces, a Kubernetes cluster, a Docker / Podman host or a Database Agent saw this database in the last ${DATABASE_SERVER_LIVE_WINDOW_MINUTES} minutes. Whether its engine metrics arrive is the separate Engine metrics status.`;

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

/*
 * The line under the Overview header's name: the endpoint the database is
 * known by — its own address, else its primary stored endpoint (an alias
 * added to a Docker / Kubernetes database that has no address of its own) —
 * and only without any endpoint the workload it runs as, labelled
 * "workload" (never "endpoint: Container/pg").
 */
export interface DatabaseHeaderIdentifier {
  label: "endpoint" | "workload";
  value: string;
}

export function getDatabaseHeaderIdentifier(
  source: DatabaseEndpointLabelSource | null | undefined,
  formattedEndpoints: ReadonlyArray<string>,
): DatabaseHeaderIdentifier | null {
  if (text(source?.serverAddress)) {
    return { label: "endpoint", value: getDatabaseEndpointLabel(source) };
  }
  const stored: string | undefined = formattedEndpoints.find(
    (endpoint: string): boolean => {
      return text(endpoint).length > 0;
    },
  );
  if (stored) {
    return { label: "endpoint", value: stored };
  }
  const workload: string = getDatabaseWorkloadLabel(source);
  return workload ? { label: "workload", value: workload } : null;
}

/**
 * The Endpoints tab's "Added by" pill for an endpoint's `source`: "user" is
 * an alias a person added; "workload" a Service name container discovery
 * claimed for the Kubernetes workload the database runs as (released again
 * when the workload stops producing it); "auto", and anything older or
 * unknown, what telemetry found.
 *
 * The pill's words are short — the column already says "Added by", and
 * "Discovered (Kubernetes Service)" alone was 268 px wide — and the
 * sentence is its hover text.
 */
export interface DatabaseEndpointSourceLabel {
  text: string;
  isUser: boolean;
  description: string;
}

export function getDatabaseEndpointSourceLabel(
  source: unknown,
): DatabaseEndpointSourceLabel {
  const value: string = text(source).toLowerCase();
  if (value === "user") {
    return {
      text: "A person",
      isUser: true,
      description:
        "Added as an alias by a person. Discovery never moves or releases it.",
    };
  }
  if (value === "workload") {
    return {
      text: "Kubernetes Service",
      isUser: false,
      description:
        "Discovered: a Service name of the Kubernetes workload this database runs as. Released once the workload no longer produces it.",
    };
  }
  return {
    text: "Discovery",
    isUser: false,
    description: "Discovered: found in telemetry.",
  };
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
  // The series' name: the legend's and the hover line's.
  title: string;
  /*
   * The chart's title when it says more than the series' name - the unit
   * its axis leaves out - as one key of the locales. Joined to the name
   * in the code ("CPU per pod" + " (cores)"), it was a title no locale
   * has, so it read English in every language (#8060).
   */
  chartTitle?: string | undefined;
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
      chartTitle: translationKey("CPU per pod (cores)"),
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

/*
 * Each formatter below writes its figure in English - "2.5k", "1.0 MiB",
 * "4.2%" - exactly as every test and export has read it, and in the
 * reader's digits, decimal sign and percent sign when it is handed the
 * reader's translator: "2,5k", "1,0 MiB", "4,2 %" in German, "۲٫۵k" in
 * Persian, on a tile, in a sentence and on a chart's value axis alike
 * (#8283, Docs/ux/README.md#numbers-dates-and-plurals).
 */
// The figures as English writes them, where no reader is named.
const ENGLISH_FIGURES: Translator = createTranslator(
  undefined,
  DEFAULT_LANGUAGE,
);

function inLanguage(
  english: string,
  translator: Translator | undefined,
): string {
  return translator
    ? writeDatabaseFigureInLanguage(english, translator.language)
    : english;
}

export function formatDatabaseCount(
  value: number | null | undefined,
  translator?: Translator | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return inLanguage(writeDatabaseCount(value), translator);
}

function writeDatabaseCount(value: number): string {
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

export function formatDatabaseBytes(
  value: number | null | undefined,
  translator?: Translator | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return inLanguage(writeDatabaseBytes(value), translator);
}

function writeDatabaseBytes(value: number): string {
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let scaled: number = value;
  let index: number = 0;
  while (Math.abs(scaled) >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index++;
  }
  // Plain bytes are whole: "0 B", "512 B" - never "0.0 B" (issue #7417).
  return `${scaled.toFixed(index > 0 && Math.abs(scaled) < 10 ? 1 : 0)}\u00A0${units[index]}`;
}

/*
 * "5.0 s", "2.5 min", "3 h", "1.5 d". In the reader's language the unit
 * is the language's own short one, as every duration reads there: "5,0
 * Sek.", "۲٫۵ دقیقه" (formatDurationInUnit).
 */
export function formatDatabaseSeconds(
  value: number | null | undefined,
  translator?: Translator | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  // `words.english` is what an English reader reads, its figure held to its unit.
  const write: (
    figure: number,
    unit: "second" | "minute" | "hour" | "day",
    words: { english: string },
  ) => string = (
    figure: number,
    unit: "second" | "minute" | "hour" | "day",
    words: { english: string },
  ): string => {
    if (!translator) {
      return words.english;
    }
    return formatDurationInUnit(translator, figure, unit, {
      decimals: unit === "second" && figure >= 10 ? 0 : 1,
      dropTrailingZeros: unit !== "second",
      english: words.english,
    });
  };
  if (value < 60) {
    return write(value, "second", {
      english: `${value < 10 ? value.toFixed(1) : Math.round(value)}\u00A0s`,
    });
  }
  if (value < 3600) {
    return write(value / 60, "minute", {
      english: `${(value / 60).toFixed(1).replace(/\.0$/, "")}\u00A0min`,
    });
  }
  if (value < 86400) {
    return write(value / 3600, "hour", {
      english: `${(value / 3600).toFixed(1).replace(/\.0$/, "")}\u00A0h`,
    });
  }
  return write(value / 86400, "day", {
    english: `${(value / 86400).toFixed(1).replace(/\.0$/, "")}\u00A0d`,
  });
}

/**
 * A 0..1 share as a percentage: "85%", "4.2%", "0.04%" — a nearly empty
 * tablespace is not rounded to a misleading "0%" until it truly is.
 */
export function formatDatabaseFraction(
  value: number | null | undefined,
  translator?: Translator | undefined,
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
  return inLanguage(`${text || "0"}%`, translator);
}

/*
 * The singular of a catalog unit word ("connections" → "connection",
 * "processes" → "process", "databases" → "database"), for a value that
 * reads exactly 1. Anything that is not a plain plural word ("ops/s", "%",
 * "ms") is returned unchanged.
 */
const PLAIN_WORD_PATTERN: RegExp = /^[a-z]+$/i;
const SIBILANT_PLURAL_PATTERN: RegExp = /(ss|sh|ch|x)es$/i;
const CONSONANT_IES_PLURAL_PATTERN: RegExp = /[^aeiou]ies$/i;
const S_PLURAL_PATTERN: RegExp = /[^s]s$/i;

export function getDatabaseUnitSingular(unit: string): string {
  const word: string = (unit || "").trim();
  if (!PLAIN_WORD_PATTERN.test(word) || word.length < 3) {
    return word;
  }
  if (SIBILANT_PLURAL_PATTERN.test(word)) {
    return word.slice(0, -2);
  }
  if (CONSONANT_IES_PLURAL_PATTERN.test(word)) {
    return `${word.slice(0, -3)}y`;
  }
  if (S_PLURAL_PATTERN.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

// "1 connection", "2 connections": the unit agrees with the number shown.
function withUnitWord(countText: string, unit: string): string {
  if (!unit) {
    return countText;
  }
  return `${countText} ${countText === "1" ? getDatabaseUnitSingular(unit) : unit}`;
}

/**
 * A catalog metric's value for its tile: bytes as KiB/MiB/GiB, seconds as
 * s/min/h/d, a "fraction" (a 0..1 share) as a percentage, other units as a
 * compact count followed by the unit — singular for exactly one ("1
 * database"). Counters are rates, so they read "12.5 commits/s".
 */
export function formatDatabaseMetricValue(
  value: number | null | undefined,
  unit: string,
  kind: DatabaseServerMetricKind,
  translator?: Translator | undefined,
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
      return `${formatDatabaseBytes(value, translator)}/s`;
    }
    return inLanguage(`${withUnitWord(rate, cleanUnit)}/s`, translator);
  }

  if (cleanUnit === "bytes") {
    return formatDatabaseBytes(value, translator);
  }
  if (cleanUnit === "s") {
    return formatDatabaseSeconds(value, translator);
  }
  if (cleanUnit === "fraction") {
    return formatDatabaseFraction(value, translator);
  }
  if (cleanUnit === "%") {
    return inLanguage(`${formatDatabaseCount(value)}%`, translator);
  }
  if (cleanUnit === "ms") {
    return writeMillisecondsFigure(formatDatabaseCount(value), translator);
  }
  return inLanguage(
    withUnitWord(formatDatabaseCount(value), cleanUnit),
    translator,
  );
}

/*
 * The share of a database's queries that failed, on its Overview's tile:
 * "2.5%", in the reader's digits and percent sign when handed their
 * translator ("2,5 %", "۲٫۵٪"); "—" when there is nothing to divide.
 */
export function formatDatabaseErrorRate(
  value: number | null | undefined,
  translator?: Translator | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return inLanguage(`${value.toFixed(1)}%`, translator);
}

/*
 * A query's latency in milliseconds - the Overview's p95 tile, and the
 * value axis and tooltip of the p95 chart under it, which read the same:
 * "5.0 ms", "42 ms", "1.25 s"; "۴۲ میلی‌ثانیه", "1,25 Sek." in the
 * reader's language (#7418, #8283). Without a translator, English.
 */
export function formatDatabaseLatencyMs(
  value: number | null | undefined,
  translator?: Translator | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const reader: Translator = translator || ENGLISH_FIGURES;
  if (value < 1000) {
    const decimals: number = value < 10 ? 1 : 0;

    return formatMilliseconds(reader, value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return formatDurationInUnit(reader, value / 1000, "second", {
    decimals: 2,
  });
}

/*
 * Milliseconds whose figure a formatter above wrote ("250", "2.5k"), in the
 * reader's language: "۲۵۰ میلی‌ثانیه", "250 ملي ث" - the words the p95
 * tile beside a chart uses (formatMilliseconds' key, #8349). English, or
 * no translator, reads "250 ms", "2.5k ms", exactly as it always did.
 */
function writeMillisecondsFigure(
  figure: string,
  translator: Translator | undefined,
): string {
  const reader: Translator = translator || ENGLISH_FIGURES;

  return reader.translateTemplate(MILLISECONDS_TEMPLATE, {
    value: writeDatabaseFigureInLanguage(figure, reader.language),
  });
}

function trimDecimalZeros(textValue: string): string {
  if (textValue.includes("e") || !textValue.includes(".")) {
    return textValue;
  }
  return textValue.replace(/\.?0+$/, "") || "0";
}

/**
 * A number for a chart axis tick: short, and precise enough that
 * neighbouring ticks differ — "0.004", "0.25", "2.5", "25", "250", "2.5k".
 * An idle container's 0.02 % must not read "0.0" five times over.
 */
export function formatDatabaseAxisNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  const abs: number = Math.abs(value);
  if (abs === 0) {
    return "0";
  }
  if (abs >= 1000) {
    return formatDatabaseCount(value);
  }
  if (abs >= 100) {
    return String(Math.round(value));
  }
  if (abs >= 10) {
    return trimDecimalZeros(value.toFixed(1));
  }
  if (abs >= 1) {
    return trimDecimalZeros(value.toFixed(2));
  }
  return trimDecimalZeros(value.toPrecision(2));
}

/*
 * Units short enough to repeat on every tick. Anything else — the words of
 * the catalog ("connections", "rollbacks") — is said once, by the chart's
 * title, and the ticks carry only the number: a 64 px axis clips
 * "20 connections" to "onnections".
 */
const DATABASE_AXIS_SHORT_UNITS: ReadonlyArray<string> = ["ms", "%"];

/**
 * A catalog metric's value on a chart axis (and in its tooltip, which
 * shares the formatter): bytes, seconds and shares in their compact form,
 * "ms" and "%" kept, a unit word dropped (the title names it), counters
 * without "/s" (their title says "per second"). Given the reader's
 * translator, a tick is written as the tiles beside the chart write their
 * figures - their digits, decimal sign and percent sign, a duration in
 * their words: "0,25", "2,5k", "12 %", "۲۵۰ میلی‌ثانیه" (#8283). Without
 * one, English, exactly as it always read.
 */
export function formatDatabaseMetricAxisValue(
  value: number | null | undefined,
  unit: string,
  translator?: Translator | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  const cleanUnit: string = (unit || "").trim();
  if (cleanUnit === "bytes") {
    // A whole tick reads "0 B" or "5 GiB", not "0.0 B" or "5.0 GiB".
    return inLanguage(
      formatDatabaseBytes(value).replace(/\.0(?=[ \u00A0])/, ""),
      translator,
    );
  }
  if (cleanUnit === "s") {
    // Sub-second values in ms: "0.0 s" on every tick told nothing apart.
    if (Math.abs(value) > 0 && Math.abs(value) < 1) {
      const milliseconds: string = formatDatabaseAxisNumber(value * 1000);

      // English writes the figure as formatMilliseconds does, as it always read.
      return !translator || isEnglishDateLanguage(translator.language)
        ? formatMilliseconds(ENGLISH_FIGURES, Number(milliseconds))
        : writeMillisecondsFigure(milliseconds, translator);
    }
    return formatDatabaseSeconds(value, translator);
  }
  if (cleanUnit === "fraction") {
    return formatDatabaseFraction(value, translator);
  }
  const number: string = formatDatabaseAxisNumber(value);
  if (cleanUnit === "ms") {
    return writeMillisecondsFigure(number, translator);
  }
  if (DATABASE_AXIS_SHORT_UNITS.includes(cleanUnit)) {
    return inLanguage(`${number}%`, translator);
  }
  return inLanguage(number, translator);
}

/**
 * The unit word a chart's title should carry because its axis does not
 * (see formatDatabaseMetricAxisValue) — "" when the axis already shows it.
 */
export function getDatabaseMetricAxisUnitLabel(unit: string): string {
  const cleanUnit: string = (unit || "").trim();
  if (
    !cleanUnit ||
    ["bytes", "s", "fraction"].includes(cleanUnit) ||
    DATABASE_AXIS_SHORT_UNITS.includes(cleanUnit)
  ) {
    return "";
  }
  return cleanUnit;
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

/**
 * formatDatabaseMetricUnitValue for a chart axis: a dimensional unit the
 * shared formatter prints compactly ("4 ms", "1.5 MB") is kept, a UCUM
 * annotation word ("{connections}") is dropped for the chart's title to say
 * once (getDatabaseMetricUnitAxisLabel), and a rate keeps its "/s" only
 * when there is no unit at all.
 */
export function formatDatabaseMetricUnitAxisValue(
  value: number | null | undefined,
  unit: string | null | undefined,
  options?: {
    isRate?: boolean | undefined;
    metricName?: string | undefined;
    // The reader's: the tick in their digits, as the tiles write them.
    translator?: Translator | undefined;
  },
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  const cleanUnit: string = (unit || "").trim();
  if (ANNOTATION_UNIT_PATTERN.test(cleanUnit)) {
    return inLanguage(formatDatabaseAxisNumber(value), options?.translator);
  }
  if (!cleanUnit || cleanUnit === "1") {
    const number: string = formatDatabaseAxisNumber(value);
    return inLanguage(
      options?.isRate ? `${number}/s` : number,
      options?.translator,
    );
  }
  return ValueFormatter.formatValue(value, cleanUnit, {
    metricName: options?.metricName || "",
    ...(options?.translator ? { language: options.translator.language } : {}),
  });
}

/** The annotation word a metric's axis leaves to its title, or "". */
export function getDatabaseMetricUnitAxisLabel(
  unit: string | null | undefined,
): string {
  const annotation: RegExpExecArray | null = ANNOTATION_UNIT_PATTERN.exec(
    (unit || "").trim(),
  );
  return annotation ? annotation[1]!.trim() : "";
}

// ---- chart y-axis ----------------------------------------------------

// Plural unit words that measure time, not a number of things.
const DATABASE_NON_COUNT_UNIT_WORDS: ReadonlyArray<string> = [
  "seconds",
  "milliseconds",
  "microseconds",
  "nanoseconds",
  "minutes",
  "hours",
  "days",
];

/**
 * Whether a catalog metric's chart counts whole things — connections,
 * databases, nodes, pages, bytes — so its y ticks must be whole numbers:
 * "0 | 0.5 | 1 | 1.5 | 2" databases and "0 | 0.25 | … | 1" nodes read as
 * nonsense. A counter is charted as a per-second rate, and a share, a
 * ratio, a duration or "ops/s" is fractional by nature.
 */
export function isDatabaseMetricWholeNumberUnit(
  unit: string,
  kind: DatabaseServerMetricKind,
): boolean {
  if (kind === "counter") {
    return false;
  }
  const cleanUnit: string = (unit || "").trim().toLowerCase();
  if (cleanUnit === "bytes") {
    return true;
  }
  return (
    PLAIN_WORD_PATTERN.test(cleanUnit) &&
    cleanUnit.length >= 3 &&
    cleanUnit.endsWith("s") &&
    !DATABASE_NON_COUNT_UNIT_WORDS.includes(cleanUnit)
  );
}

/**
 * The same for a metric outside the catalog, by its own (UCUM) unit: a
 * count annotation such as "{connections}", read as it is (not as a rate,
 * not as a histogram's percentile).
 */
export function isDatabaseMetricUnitWholeNumber(
  unit: string | null | undefined,
  options: { isRate: boolean; isDistribution: boolean },
): boolean {
  if (options.isRate || options.isDistribution) {
    return false;
  }
  return ANNOTATION_UNIT_PATTERN.test((unit || "").trim());
}

export interface DatabaseChartYAxis {
  // A fixed top for the axis, or undefined to fit the data.
  yMax: number | undefined;
  allowDecimals: boolean;
}

/**
 * How a database chart's y-axis is drawn. A count keeps whole-number
 * ticks. A series that is 0 throughout gets the axis 0 to 1: left to
 * itself the axis spread that 0 over "0 | 1 | 2 | 3 | 4" as if there were
 * a scale to read — "0.0 B … 4.0 B" on an idle Memcached's "Memory used".
 */
export function getDatabaseChartYAxis(
  values: ReadonlyArray<number>,
  wholeNumbers: boolean,
): DatabaseChartYAxis {
  const finite: Array<number> = values.filter((value: number): boolean => {
    return Number.isFinite(value);
  });
  if (
    finite.length > 0 &&
    finite.every((value: number): boolean => {
      return value === 0;
    })
  ) {
    return { yMax: 1, allowDecimals: false };
  }
  return { yMax: undefined, allowDecimals: !wholeNumbers };
}

/*
 * A figure the formatters above wrote in English ("0.025", "1.25", "2.5k",
 * "12%", "1.0 MiB"), in the reader's digits, decimal sign and percent sign,
 * with the decimals it was written with: "0,025", "12 %" and "1,0 MiB" in
 * German, "۰٫۰۲۵" and "۱۲٪" in Persian (#8060). Its letters - a size's
 * unit, a count's "k" - stay as written. English, no language, and
 * anything that is not such a figure come back as they came. The rewrite
 * is Common's (writeFigureInLanguage), which every chart's figures share.
 */
export function writeDatabaseFigureInLanguage(
  english: string,
  language: string | undefined,
): string {
  return writeFigureInLanguage(english, language);
}

/**
 * A runtime chart's axis tick (and tooltip): "0.025%", "12 MiB", and for
 * cores the number alone — the chart's title says "(cores)". Written in
 * the reader's language when one is given (writeDatabaseFigureInLanguage);
 * English, or none, reads exactly as it always has.
 */
export function formatDatabaseRuntimeAxisValue(
  value: number | null | undefined,
  unit: DatabaseRuntimeMetric["unit"],
  language?: string | undefined,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  if (unit === "bytes") {
    return writeDatabaseFigureInLanguage(formatDatabaseBytes(value), language);
  }
  if (unit === "percent") {
    return writeDatabaseFigureInLanguage(
      `${formatDatabaseAxisNumber(value)}%`,
      language,
    );
  }
  return writeDatabaseFigureInLanguage(
    formatDatabaseAxisNumber(value),
    language,
  );
}

/*
 * A runtime chart's title, in English: a key the chart's card looks up in
 * the reader's language, the unit its axis leaves out in it where it has
 * one ("CPU per pod (cores)").
 */
export function getDatabaseRuntimeChartTitle(
  metric: DatabaseRuntimeMetric,
): string {
  return metric.chartTitle || metric.title;
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
