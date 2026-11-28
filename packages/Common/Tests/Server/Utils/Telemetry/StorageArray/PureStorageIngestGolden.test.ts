import {
  STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES,
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
  bufferStorageArraySnapshotMetric,
  deriveStorageArraySnapshotExtras,
  getConnectedVolumeNames,
  getStorageArrayResourceRows,
  getVolumeConnectionCounts,
  isCriticalComponentStatus,
  isUnhealthyComponentStatus,
  resolveStorageArraySystem,
} from "../../../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CapturedSeries,
  parseOpenMetrics,
  toOtlpDatapoint,
} from "../../../../Helpers/StorageArray/OpenMetricsCapture";
import {
  FLASHARRAY_CAPTURES,
  FLASHBLADE_CAPTURES,
  FlashArrayEndpoint,
  FlashBladeEndpoint,
  PURE_CAPTURE_TIME_MS,
} from "../../../../Helpers/StorageArray/PureStorageCaptures";
import { getPureSnapshotMetricNames } from "../../../../Helpers/StorageArray/PureSlice";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A PURE STORAGE ARRAY'S METRICS BECOME, PINNED BEFORE STORAGE ARRAYS
 * WAS SPLIT INTO ONE EXTRACTOR PER PLATFORM (#11000).
 *
 * Every endpoint the Storage Array Agent scrapes on a FlashArray and a
 * FlashBlade (Helpers/StorageArray/PureStorageCaptures: each family and label
 * set Pure's exporters declare) goes through the scan exactly as
 * OtelMetricsIngestService runs it - the snapshot metric names first, then
 * bufferStorageArraySnapshotMetric per datapoint, then what its flush hands
 * to Postgres: the inventory rows, the array's snapshot columns, the
 * volumes' host counts - one batch per endpoint, as the agent sends them,
 * and every endpoint in one batch.
 *
 * PureStorageIngestGolden.golden.json was written by this test from the
 * code before #11000 (UPDATE_PURE_STORAGE_GOLDEN=1), and is only ever
 * compared with since: a Pure array must ingest exactly as it did before the
 * scan learned other platforms. A change that means to alter what a Pure
 * array's metrics become rewrites it on purpose, and says why in its pull
 * request.
 *
 * Only the fields that existed then are read back, by name, so a field the
 * refactor adds (to the snapshot or a row) changes nothing here.
 */

const GOLDEN_PATH: string = path.join(
  __dirname,
  "PureStorageIngestGolden.golden.json",
);

const ARRAY_ID: string = "5a7e0000-0000-4000-8000-0000000011a0";

interface CapturedBatchSeries {
  series: CapturedSeries;
  jobLabels: Record<string, string>;
}

interface IngestCase {
  name: string;
  series: Array<CapturedBatchSeries>;
}

function endpointSeries(
  capture: string,
  scrapeEndpoint: string | null,
): Array<CapturedBatchSeries> {
  return parseOpenMetrics(capture).map(
    (series: CapturedSeries): CapturedBatchSeries => {
      return {
        series,
        jobLabels: scrapeEndpoint ? { scrape_endpoint: scrapeEndpoint } : {},
      };
    },
  );
}

const FA_ENDPOINTS: Array<FlashArrayEndpoint> = [
  "array",
  "volumes",
  "hosts",
  "pods",
  "directories",
];

const FB_ENDPOINTS: Array<FlashBladeEndpoint> = [
  "array",
  "filesystems",
  "objectstore",
];

const FA_INFO_ONLY: string = FLASHARRAY_CAPTURES.volumes
  .split("\n")
  .filter((line: string): boolean => {
    return line.startsWith("purefa_info");
  })[0]!;

const FB_INFO_ONLY: string = FLASHBLADE_CAPTURES.filesystems
  .split("\n")
  .filter((line: string): boolean => {
    return line.startsWith("purefb_info");
  })[0]!;

const CASES: Array<IngestCase> = [
  ...FA_ENDPOINTS.map((endpoint: FlashArrayEndpoint): IngestCase => {
    return {
      name: `FlashArray /metrics/${endpoint}`,
      series: endpointSeries(FLASHARRAY_CAPTURES[endpoint], endpoint),
    };
  }),
  {
    name: "FlashArray, every endpoint in one batch",
    series: FA_ENDPOINTS.flatMap(
      (endpoint: FlashArrayEndpoint): Array<CapturedBatchSeries> => {
        return endpointSeries(FLASHARRAY_CAPTURES[endpoint], endpoint);
      },
    ),
  },
  {
    name: "FlashArray, one job scraping everything (scrape_endpoint all)",
    series: FA_ENDPOINTS.flatMap(
      (endpoint: FlashArrayEndpoint): Array<CapturedBatchSeries> => {
        return endpointSeries(FLASHARRAY_CAPTURES[endpoint], "all");
      },
    ),
  },
  {
    name: "FlashArray, a custom collector config with no scrape_endpoint label",
    series: FA_ENDPOINTS.flatMap(
      (endpoint: FlashArrayEndpoint): Array<CapturedBatchSeries> => {
        return endpointSeries(FLASHARRAY_CAPTURES[endpoint], null);
      },
    ),
  },
  {
    name: "FlashArray /metrics/volumes after its last volume was deleted",
    series: endpointSeries(FA_INFO_ONLY, "volumes"),
  },
  {
    name: "FlashArray /metrics/hosts after its last host was deleted",
    series: endpointSeries(FA_INFO_ONLY, "hosts"),
  },
  {
    name: "FlashArray /metrics/array with no open alert",
    series: endpointSeries(
      FLASHARRAY_CAPTURES.array
        .split("\n")
        .filter((line: string): boolean => {
          return !line.startsWith("purefa_alerts_open");
        })
        .join("\n"),
      "array",
    ),
  },
  ...FB_ENDPOINTS.map((endpoint: FlashBladeEndpoint): IngestCase => {
    return {
      name: `FlashBlade /metrics/${endpoint}`,
      series: endpointSeries(FLASHBLADE_CAPTURES[endpoint], endpoint),
    };
  }),
  {
    name: "FlashBlade, every endpoint in one batch",
    series: FB_ENDPOINTS.flatMap(
      (endpoint: FlashBladeEndpoint): Array<CapturedBatchSeries> => {
        return endpointSeries(FLASHBLADE_CAPTURES[endpoint], endpoint);
      },
    ),
  },
  {
    name: "FlashBlade, one job scraping everything (scrape_endpoint all)",
    series: FB_ENDPOINTS.flatMap(
      (endpoint: FlashBladeEndpoint): Array<CapturedBatchSeries> => {
        return endpointSeries(FLASHBLADE_CAPTURES[endpoint], "all");
      },
    ),
  },
  {
    name: "FlashBlade /metrics/filesystems after its last file system was deleted",
    series: endpointSeries(FB_INFO_ONLY, "filesystems"),
  },
];

interface IngestOutcome {
  // The datapoints the ingest hands to the scan, by metric name.
  readSeries: Array<string>;
  rows: Array<JSONObject>;
  extras: JSONObject;
  snapshot: JSONObject | null;
  connectedVolumeNames: Array<string> | null;
  volumeConnectionCounts: Record<string, number> | null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function sortedSetValues(set: Set<string> | undefined): Array<string> {
  return Array.from(set || []).sort();
}

function sortedMap(
  map: Map<string, Set<string>> | undefined,
): Array<[string, Array<string>]> {
  return Array.from(map?.entries() || [])
    .map(([key, values]: [string, Set<string>]): [string, Array<string>] => {
      return [key, sortedSetValues(values)];
    })
    .sort((a: [string, Array<string>], b: [string, Array<string>]): number => {
      return a[0].localeCompare(b[0]);
    });
}

// The row as the flush hands it to bulkUpsert: the fields of #11000's day.
function serializeRow(row: StorageArrayResourceBufferEntry): JSONObject {
  return {
    kind: row.kind,
    externalId: row.externalId,
    name: row.name,
    status: row.status,
    statusDetail: row.statusDetail,
    componentType: row.componentType,
    model: row.model,
    firmwareVersion: row.firmwareVersion,
    groupName: row.groupName,
    capacityBytes: row.capacityBytes,
    usedBytes: row.usedBytes,
    dataReductionRatio: row.dataReductionRatio,
    readLatencyUsec: row.readLatencyUsec,
    writeLatencyUsec: row.writeLatencyUsec,
    readIops: row.readIops,
    writeIops: row.writeIops,
    readBytesPerSec: row.readBytesPerSec,
    writeBytesPerSec: row.writeBytesPerSec,
    temperatureCelsius: row.temperatureCelsius,
    replicationLagMs: row.replicationLagMs,
    connectionCount: row.connectionCount,
    details: row.details,
    observedAt: iso(row.observedAt),
    fromConnectionsOnly: Boolean(row.fromConnectionsOnly),
  };
}

function serializeSnapshot(
  snap: StorageArraySnapshotBufferEntry | undefined,
): JSONObject | null {
  if (!snap) {
    return null;
  }
  return {
    storageSystem: snap.storageSystem,
    reportedName: snap.reportedName,
    systemId: snap.systemId,
    osName: snap.osName,
    osVersion: snap.osVersion,
    sawAlerts: snap.sawAlerts,
    openAlertKeys: sortedSetValues(snap.openAlertKeys),
    criticalAlertKeys: sortedSetValues(snap.criticalAlertKeys),
    warningAlertKeys: sortedSetValues(snap.warningAlertKeys),
    capacityBytes: snap.capacityBytes,
    emptyBytes: snap.emptyBytes,
    utilizationPercent: snap.utilizationPercent,
    dataReductionRatio: snap.dataReductionRatio,
    sawHardware: snap.sawHardware,
    sawDrives: snap.sawDrives,
    sawControllers: snap.sawControllers,
    sawVolumes: snap.sawVolumes,
    sawHosts: snap.sawHosts,
    sawPods: snap.sawPods,
    sawFileSystems: snap.sawFileSystems,
    sawBuckets: snap.sawBuckets,
    volumesByHost: sortedMap(snap.volumesByHost) as unknown as JSONObject,
    hostsByVolume: sortedMap(snap.hostsByVolume) as unknown as JSONObject,
    connectionsObservedAt: iso(snap.connectionsObservedAt),
  };
}

// Exactly what OtelMetricsIngestService does with one batch of one array.
function ingest(testCase: IngestCase): IngestOutcome {
  const resourceBuffer: Map<
    string,
    Map<string, StorageArrayResourceBufferEntry>
  > = new Map();
  const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();
  const readSeries: Set<string> = new Set();

  for (const item of testCase.series) {
    if (!STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(item.series.name)) {
      continue;
    }
    readSeries.add(item.series.name);
    bufferStorageArraySnapshotMetric({
      arrayIdStr: ARRAY_ID,
      metricName: item.series.name,
      datapoint: toOtlpDatapoint(item.series, {
        timeMs: PURE_CAPTURE_TIME_MS,
        jobLabels: item.jobLabels,
      }),
      resourceBuffer,
      arrayBuffer,
    });
  }

  const snap: StorageArraySnapshotBufferEntry | undefined =
    arrayBuffer.get(ARRAY_ID);
  const buffered: Array<StorageArrayResourceBufferEntry> = Array.from(
    resourceBuffer.get(ARRAY_ID)?.values() || [],
  );
  const rows: Array<StorageArrayResourceBufferEntry> =
    getStorageArrayResourceRows(buffered, snap);

  return {
    readSeries: Array.from(readSeries).sort(),
    rows: rows
      .map(serializeRow)
      .sort((a: JSONObject, b: JSONObject): number => {
        return `${a["kind"]}|${a["externalId"]}`.localeCompare(
          `${b["kind"]}|${b["externalId"]}`,
        );
      }),
    extras: deriveStorageArraySnapshotExtras(
      rows,
      snap,
    ) as unknown as JSONObject,
    snapshot: serializeSnapshot(snap),
    connectedVolumeNames: getConnectedVolumeNames(rows, snap),
    volumeConnectionCounts: getVolumeConnectionCounts(rows, snap),
  };
}

const STATUS_WORDS: Array<string> = [
  "ok",
  "healthy",
  "ready",
  "enabled",
  "online",
  "replicating",
  "critical",
  "failed",
  "missing",
  "unhealthy",
  "degraded",
  "unknown",
  "unrecognized",
  "not ready",
  "not_installed",
  "device_off",
  "identifying",
  "empty",
  "unused",
  "disabled",
  " Critical ",
  "FAILED",
  "",
];

interface GoldenFile {
  note: string;
  snapshotMetricNames: Array<string>;
  componentStatuses: Record<string, { unhealthy: boolean; critical: boolean }>;
  systemResolution: Record<string, string | null>;
  cases: Record<string, IngestOutcome>;
}

function computeGolden(): Omit<GoldenFile, "note"> {
  const componentStatuses: Record<
    string,
    { unhealthy: boolean; critical: boolean }
  > = {};
  for (const word of STATUS_WORDS) {
    componentStatuses[JSON.stringify(word)] = {
      unhealthy: isUnhealthyComponentStatus(word),
      critical: isCriticalComponentStatus(word),
    };
  }

  const resolutions: Array<[string, string | null, string | null]> = [
    [
      "a FlashBlade batch its agent declares a FlashArray",
      "purestorage.flashblade",
      "purestorage.flasharray",
    ],
    ["a FlashArray batch with no declaration", "purestorage.flasharray", null],
    ["no Pure series, declared FlashArray", null, "purestorage.flasharray"],
    ["no Pure series, declared FlashBlade", null, "purestorage.flashblade"],
    ["no Pure series, another platform declared", null, "hitachi.vsp"],
    ["no Pure series, nothing declared", null, null],
  ];
  const systemResolution: Record<string, string | null> = {};
  for (const [name, derived, declared] of resolutions) {
    systemResolution[name] =
      resolveStorageArraySystem({ derived, declared }) ?? null;
  }

  const cases: Record<string, IngestOutcome> = {};
  for (const testCase of CASES) {
    cases[testCase.name] = ingest(testCase);
  }

  return {
    // Pure's own: a platform registered since reads series of its own.
    snapshotMetricNames: getPureSnapshotMetricNames(),
    componentStatuses,
    systemResolution,
    cases,
  };
}

const computed: Omit<GoldenFile, "note"> = computeGolden();

if (process.env["UPDATE_PURE_STORAGE_GOLDEN"] === "1") {
  const golden: GoldenFile = {
    note: "Written by PureStorageIngestGolden.test.ts from the code before #11000. Compared with, never rewritten, unless a Pure array's metrics are meant to become something else.",
    ...computed,
  };
  fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`);
}

function readGolden(): GoldenFile {
  return JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;
}

describe("a Pure Storage array's metrics become what they became before #11000", () => {
  test("the scan reads the same metric names", () => {
    expect(computed.snapshotMetricNames).toEqual(
      readGolden().snapshotMetricNames,
    );
  });

  test("component statuses count as unhealthy and critical as before", () => {
    expect(computed.componentStatuses).toEqual(readGolden().componentStatuses);
  });

  test("the platform written for an array is decided as before", () => {
    expect(computed.systemResolution).toEqual(readGolden().systemResolution);
  });

  test.each(
    CASES.map((testCase: IngestCase): [string] => {
      return [testCase.name];
    }),
  )("%s", (name: string) => {
    const outcome: IngestOutcome = computed.cases[name]!;
    const expected: IngestOutcome = readGolden().cases[name]!;

    expect(expected).toBeDefined();

    // The parts first, so a difference says where it is.
    expect(outcome.readSeries).toEqual(expected.readSeries);
    expect(outcome.snapshot).toEqual(expected.snapshot);
    expect(outcome.rows).toEqual(expected.rows);
    expect(outcome.extras).toEqual(expected.extras);
    expect(outcome.connectedVolumeNames).toEqual(expected.connectedVolumeNames);
    expect(outcome.volumeConnectionCounts).toEqual(
      expected.volumeConnectionCounts,
    );
    expect(outcome).toEqual(expected);
  });

  test("every capture holds families the scan reads and families it leaves to the charts", () => {
    const everyCapture: Array<CapturedSeries> = [
      ...Object.values(FLASHARRAY_CAPTURES),
      ...Object.values(FLASHBLADE_CAPTURES),
    ].flatMap((capture: string): Array<CapturedSeries> => {
      return parseOpenMetrics(capture);
    });
    const read: Array<string> = everyCapture
      .map((series: CapturedSeries): string => {
        return series.name;
      })
      .filter((name: string): boolean => {
        return STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(name);
      });
    const passedOver: Array<string> = everyCapture
      .map((series: CapturedSeries): string => {
        return series.name;
      })
      .filter((name: string): boolean => {
        return !STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(name);
      });

    // Every family the scan reads for Pure is in the captures at least once.
    expect(new Set(read)).toEqual(new Set(getPureSnapshotMetricNames()));
    expect(passedOver.length).toBeGreaterThan(0);
  });
});
