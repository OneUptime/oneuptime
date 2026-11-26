import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES,
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
  StorageArraySnapshotDerivedExtras,
  bufferStorageArraySnapshotMetric,
  deriveStorageArrayCountsByKind,
  deriveStorageArraySnapshotExtras,
  getStorageArrayResourceRows,
} from "../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import { CapturedSeries, parseOpenMetrics, toOtlpDatapoint } from "./OpenMetricsCapture";

/*
 * WHAT NETAPP HARVEST SERVED, AS WHAT THE AGENT SENDS AND WHAT ONEUPTIME
 * KEEPS OF IT (#11001).
 *
 * Tests/Fixtures/NetAppHarvest/26.11.0 holds the real Harvest 26.11.0's own
 * /metrics, recorded against a stand-in ONTAP and a stand-in Amazon FSx (its
 * README says what was and was not real). Between Harvest and OneUptime the
 * agent's collector (agents/StorageArrayAgent/otel-collector-config.
 * netapp-ontap.yaml) drops what its metric_relabel_configs drop, turns each
 * SnapMirror relationship's schedule into netapp_snapmirror_schedule_seconds
 * with its OTTL statements, and labels every series scrape_endpoint:
 * harvest. This reads both from the shipped config itself, so a change to it
 * is a change to what these tests see, then runs the batch through the scan
 * exactly as OtelMetricsIngestService does. Not a test file itself.
 */

export const NETAPP_HARVEST_VERSION: string = "26.11.0";

export const NETAPP_HARVEST_FIXTURES: string = path.join(
  __dirname,
  "..",
  "..",
  "Fixtures",
  "NetAppHarvest",
  NETAPP_HARVEST_VERSION,
);

const AGENT_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../../agents/StorageArrayAgent",
);

export const NETAPP_COLLECTOR_CONFIG: string = "otel-collector-config.netapp-ontap.yaml";

export type NetAppRecording =
  | "ontap.prom"
  | "ontap-ems-cleared.prom"
  | "ontap-ems-after.prom"
  | "fsx.prom";

// The instant each recording stands for (its README's times), in ms.
export const NETAPP_RECORDING_TIME_MS: Record<NetAppRecording, number> = {
  "ontap.prom": Date.UTC(2026, 10, 26, 4, 20, 48),
  "ontap-ems-cleared.prom": Date.UTC(2026, 10, 26, 4, 23, 48),
  "ontap-ems-after.prom": Date.UTC(2026, 10, 26, 4, 26, 48),
  "fsx.prom": Date.UTC(2026, 10, 26, 4, 30, 0),
};

export const NETAPP_ARRAY_ID: string = "6e7a0000-0000-4000-8000-00000000ab01";

interface RelabelRule {
  source_labels?: Array<string>;
  regex?: string;
  action?: string;
}

interface CollectorConfig {
  receivers: {
    prometheus: {
      config: {
        scrape_configs: Array<{
          static_configs: Array<{ labels?: Record<string, string> }>;
          metric_relabel_configs?: Array<RelabelRule>;
        }>;
      };
    };
  };
  processors: Record<
    string,
    {
      metric_statements?: Array<{ statements: Array<string> }>;
    }
  >;
}

export interface NetAppCollectorProcessing {
  // The series names the scrape drops (Prometheus anchors each regex).
  dropped: Array<RegExp>;
  // The scrape job's static labels.
  jobLabels: Record<string, string>;
  // A SnapMirror schedule's name -> its seconds, as the OTTL sets them.
  scheduleSeconds: Map<string, number>;
}

let processing: NetAppCollectorProcessing | null = null;

export function readNetAppCollectorProcessing(): NetAppCollectorProcessing {
  if (processing) {
    return processing;
  }
  const config: CollectorConfig = yaml.load(
    fs.readFileSync(path.join(AGENT_DIRECTORY, NETAPP_COLLECTOR_CONFIG), "utf8"),
  ) as CollectorConfig;
  const job: CollectorConfig["receivers"]["prometheus"]["config"]["scrape_configs"][number] =
    config.receivers.prometheus.config.scrape_configs[0]!;

  const dropped: Array<RegExp> = [];
  for (const rule of job.metric_relabel_configs || []) {
    if (
      rule.action === "drop" &&
      rule.regex &&
      (rule.source_labels || []).join(",") === "__name__"
    ) {
      dropped.push(new RegExp(`^(?:${rule.regex})$`));
    }
  }

  const scheduleSeconds: Map<string, number> = new Map();
  const statements: Array<string> = Object.values(config.processors).flatMap(
    (processor: { metric_statements?: Array<{ statements: Array<string> }> }) => {
      return (processor.metric_statements || []).flatMap(
        (group: { statements: Array<string> }): Array<string> => {
          return group.statements;
        },
      );
    },
  );
  for (const statement of statements) {
    const match: RegExpMatchArray | null = statement.match(
      /^set\(value_double, ([0-9.]+)\) where metric\.name == "netapp_snapmirror_schedule_seconds" and attributes\["schedule"\] == "([^"]+)"$/,
    );
    if (match) {
      scheduleSeconds.set(match[2]!, Number(match[1]));
    }
  }

  processing = {
    dropped,
    jobLabels: { ...(job.static_configs[0]?.labels || {}) },
    scheduleSeconds,
  };
  return processing;
}

export function readNetAppRecording(file: NetAppRecording): string {
  return fs.readFileSync(path.join(NETAPP_HARVEST_FIXTURES, file), "utf8");
}

/*
 * What the collector sends of one Harvest scrape: what its relabel rules
 * keep, and a netapp_snapmirror_schedule_seconds series beside each
 * relationship whose schedule the OTTL statements know (one with no
 * schedule, or one they do not know, has none).
 */
export function whatTheAgentSends(text: string): Array<CapturedSeries> {
  const rules: NetAppCollectorProcessing = readNetAppCollectorProcessing();
  const sent: Array<CapturedSeries> = [];
  for (const series of parseOpenMetrics(text)) {
    if (
      rules.dropped.some((regex: RegExp): boolean => {
        return regex.test(series.name);
      })
    ) {
      continue;
    }
    sent.push(series);
    if (series.name === "netapp_snapmirror_labels") {
      const seconds: number | undefined = rules.scheduleSeconds.get(
        series.labels["schedule"] || "",
      );
      if (seconds !== undefined) {
        sent.push({
          name: "netapp_snapmirror_schedule_seconds",
          labels: { ...series.labels },
          value: seconds,
        });
      }
    }
  }
  return sent;
}

export interface NetAppIngestOutcome {
  // The datapoints the ingest handed to the scan, by metric name.
  readSeries: Array<string>;
  rows: Array<StorageArrayResourceBufferEntry>;
  snapshot: StorageArraySnapshotBufferEntry | undefined;
  extras: StorageArraySnapshotDerivedExtras;
  // Null for a batch that completed no kind: the counts stay as they were.
  countsByKind: Record<string, number> | null;
}

/*
 * One batch of what the agent sends, through the scan exactly as
 * OtelMetricsIngestService runs it: the snapshot metric names first, then
 * bufferStorageArraySnapshotMetric per datapoint with the batch's declared
 * storage.system, then what its flush hands to Postgres.
 */
export function ingestNetAppSeries(
  series: Array<CapturedSeries>,
  options: {
    timeMs: number;
    declaredStorageSystem?: string | null | undefined;
    jobLabels?: Record<string, string> | undefined;
  },
): NetAppIngestOutcome {
  const resourceBuffer: Map<
    string,
    Map<string, StorageArrayResourceBufferEntry>
  > = new Map();
  const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();
  const readSeries: Set<string> = new Set();
  const jobLabels: Record<string, string> =
    options.jobLabels ?? readNetAppCollectorProcessing().jobLabels;

  for (const item of series) {
    if (!STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(item.name)) {
      continue;
    }
    readSeries.add(item.name);
    bufferStorageArraySnapshotMetric({
      arrayIdStr: NETAPP_ARRAY_ID,
      metricName: item.name,
      datapoint: toOtlpDatapoint(item, {
        timeMs: options.timeMs,
        jobLabels: jobLabels,
      }),
      resourceBuffer,
      arrayBuffer,
      declaredStorageSystem:
        options.declaredStorageSystem === undefined
          ? "netapp.ontap"
          : options.declaredStorageSystem,
    });
  }

  const snapshot: StorageArraySnapshotBufferEntry | undefined =
    arrayBuffer.get(NETAPP_ARRAY_ID);
  const buffered: Array<StorageArrayResourceBufferEntry> = Array.from(
    resourceBuffer.get(NETAPP_ARRAY_ID)?.values() || [],
  );
  const rows: Array<StorageArrayResourceBufferEntry> =
    getStorageArrayResourceRows(buffered, snapshot);

  return {
    readSeries: Array.from(readSeries).sort(),
    rows: rows,
    snapshot: snapshot,
    extras: deriveStorageArraySnapshotExtras(rows, snapshot),
    countsByKind: deriveStorageArrayCountsByKind(rows, snapshot),
  };
}

export function ingestNetAppRecording(
  file: NetAppRecording,
  options?: { declaredStorageSystem?: string | null | undefined },
): NetAppIngestOutcome {
  return ingestNetAppSeries(whatTheAgentSends(readNetAppRecording(file)), {
    timeMs: NETAPP_RECORDING_TIME_MS[file],
    declaredStorageSystem: options?.declaredStorageSystem,
  });
}

// One row of a kind, by its externalId.
export function rowOf(
  outcome: NetAppIngestOutcome,
  kind: string,
  externalId: string,
): StorageArrayResourceBufferEntry | undefined {
  return outcome.rows.find((row: StorageArrayResourceBufferEntry): boolean => {
    return row.kind === kind && row.externalId === externalId;
  });
}

export function rowsOf(
  outcome: NetAppIngestOutcome,
  kind: string,
): Array<StorageArrayResourceBufferEntry> {
  return outcome.rows
    .filter((row: StorageArrayResourceBufferEntry): boolean => {
      return row.kind === kind;
    })
    .sort(
      (
        a: StorageArrayResourceBufferEntry,
        b: StorageArrayResourceBufferEntry,
      ): number => {
        return a.externalId.localeCompare(b.externalId);
      },
    );
}

const RECORDINGS: ReadonlyArray<NetAppRecording> = [
  "ontap.prom",
  "ontap-ems-cleared.prom",
  "ontap-ems-after.prom",
  "fsx.prom",
];

let recordedLabels: Record<string, Record<string, Array<string>>> | null =
  null;

/*
 * Every label of every series the agent sends, by metric name, with the
 * values Harvest gave it across the recordings: what a monitor's filter on
 * it can match (a label only ever empty is one Harvest sends but ONTAP did
 * not fill, and is listed with no values).
 */
export function getRecordedSeriesLabels(): Record<
  string,
  Record<string, Array<string>>
> {
  if (recordedLabels) {
    return recordedLabels;
  }
  const labels: Record<string, Record<string, Set<string>>> = {};
  for (const file of RECORDINGS) {
    for (const series of whatTheAgentSends(readNetAppRecording(file))) {
      const byLabel: Record<string, Set<string>> =
        labels[series.name] || (labels[series.name] = {});
      for (const [label, value] of Object.entries(series.labels)) {
        const values: Set<string> =
          byLabel[label] || (byLabel[label] = new Set<string>());
        if (value !== "") {
          values.add(value);
        }
      }
    }
  }
  const result: Record<string, Record<string, Array<string>>> = {};
  for (const [name, byLabel] of Object.entries(labels)) {
    const sorted: Record<string, Array<string>> = {};
    for (const [label, values] of Object.entries(byLabel)) {
      sorted[label] = Array.from(values).sort();
    }
    result[name] = sorted;
  }
  recordedLabels = result;
  return result;
}
