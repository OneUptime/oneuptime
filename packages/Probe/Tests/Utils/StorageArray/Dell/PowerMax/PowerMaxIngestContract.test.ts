import { beforeEach, describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
} from "Common/Server/Utils/Telemetry/StorageArray/StorageArrayExtractor";
import {
  StorageArraySnapshotDerivedExtras,
  bufferStorageArraySnapshotMetric,
  deriveStorageArrayCountsByKind,
  deriveStorageArraySnapshotExtras,
  getStorageArrayResourceRows,
  isStorageArraySnapshotMetric,
} from "Common/Server/Utils/Telemetry/StorageArraySnapshotScan";
import { StorageArrayCollectionReport } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import {
  POWERMAX_PORT_KIND,
  POWERMAX_SYMMETRIX_ID_ATTRIBUTE,
  PowerMaxKind,
} from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import {
  PowerMaxPoller,
  clearPowerMaxAlertCache,
} from "../../../../../Utils/StorageArray/Dell/PowerMax/PowerMaxPoller";
import DellPowerMaxPlatform from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxPlatform";
import { StorageArrayAlertTemplateSpec } from "Common/Types/StorageArray/StorageArrayPlatform";
import { OtlpPoint, pointsOf, resourceAttributesOf } from "./Helpers/OtlpPoints";
import {
  ARRAY_V3,
  ARRAY_V4,
  collectionJob,
  harness,
  makeUnisphere,
} from "./Helpers/PowerMaxScenario";

/*
 * WHAT THE PROBE SENDS IS WHAT THE SERVER READS (#11004).
 *
 * A collection of Dell's documented answers (FakeUnisphere), and then each
 * of its resources through the server's own ingest scan exactly as
 * OtelMetricsIngestService runs it: the snapshot metric names first, then
 * bufferStorageArraySnapshotMetric per datapoint, with the batch's
 * storage.system the server stamps - and what its flush would write: the
 * inventory rows, the array's snapshot columns, the counts by kind.
 */

interface Ingested {
  rows: Array<StorageArrayResourceBufferEntry>;
  snapshot: StorageArraySnapshotBufferEntry | undefined;
  extras: StorageArraySnapshotDerivedExtras;
  counts: Record<string, number> | null;
}

function ingest(resource: JSONObject): Ingested {
  const arrayId: string =
    resourceAttributesOf(resource)[POWERMAX_SYMMETRIX_ID_ATTRIBUTE]!;
  const resourceBuffer: Map<
    string,
    Map<string, StorageArrayResourceBufferEntry>
  > = new Map();
  const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();

  for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
    for (const metric of scope["metrics"] as Array<JSONObject>) {
      const name: string = String(metric["name"]);
      if (!isStorageArraySnapshotMetric(name)) {
        continue;
      }
      for (const datapoint of (metric["gauge"] as JSONObject)[
        "dataPoints"
      ] as Array<JSONObject>) {
        bufferStorageArraySnapshotMetric({
          arrayIdStr: arrayId,
          metricName: name,
          datapoint,
          resourceBuffer,
          arrayBuffer,
          declaredStorageSystem: StorageSystem.DellPowerMax,
        });
      }
    }
  }

  const snapshot: StorageArraySnapshotBufferEntry | undefined =
    arrayBuffer.get(arrayId);
  const rows: Array<StorageArrayResourceBufferEntry> =
    getStorageArrayResourceRows(
      Array.from(resourceBuffer.get(arrayId)?.values() || []),
      snapshot,
    );
  return {
    rows,
    snapshot,
    extras: deriveStorageArraySnapshotExtras(rows, snapshot),
    counts: deriveStorageArrayCountsByKind(rows, snapshot),
  };
}

function resourceFor(
  report: StorageArrayCollectionReport,
  symmetrixId: string,
): JSONObject {
  return (report.resourceMetrics as Array<JSONObject>).find(
    (resource: JSONObject): boolean => {
      return (
        resourceAttributesOf(resource)[POWERMAX_SYMMETRIX_ID_ATTRIBUTE] ===
        symmetrixId
      );
    },
  )!;
}

function rowsOf(
  ingested: Ingested,
  kind: string,
): Array<StorageArrayResourceBufferEntry> {
  return ingested.rows.filter(
    (row: StorageArrayResourceBufferEntry): boolean => {
      return row.kind === kind;
    },
  );
}

function ids(rows: Array<StorageArrayResourceBufferEntry>): Array<string> {
  return rows
    .map((row: StorageArrayResourceBufferEntry): string => {
      return row.externalId;
    })
    .sort();
}

let report: StorageArrayCollectionReport;

beforeEach(async () => {
  clearPowerMaxAlertCache();
  report = await new PowerMaxPoller({
    dependencies: harness(makeUnisphere()).dependencies,
  }).collect(collectionJob());
});

describe("a PowerMax 8500's collection, as the server ingests it", () => {
  test("is a PowerMax array, named and identified by its Symmetrix ID, on PowerMaxOS 10", () => {
    const ingested: Ingested = ingest(resourceFor(report, ARRAY_V4));

    expect(ingested.extras).toMatchObject({
      storageSystem: StorageSystem.DellPowerMax,
      systemId: ARRAY_V4,
      reportedName: ARRAY_V4,
      osName: "PowerMaxOS",
      osVersion: "6079.275.0",
    });
  });

  test("has its capacity and its open alerts, Minor and up", () => {
    const ingested: Ingested = ingest(resourceFor(report, ARRAY_V4));

    expect(ingested.extras.capacityBytes).toBeGreaterThan(0);
    expect(ingested.extras.usedBytes).toBeGreaterThan(0);
    expect(ingested.extras).toMatchObject({
      openAlertCount: 3,
      criticalAlertCount: 1,
      warningAlertCount: 2,
    });
  });

  test("lists every storage group, volume, pool, director, port and SRDF group it read", () => {
    const ingested: Ingested = ingest(resourceFor(report, ARRAY_V4));

    expect(ids(rowsOf(ingested, PowerMaxKind.StorageGroup))).toEqual([
      "Empty_SG",
      "Oracle_PROD_SG",
      "PF_PMUNI-16037_1",
      "VMware_DS_SG",
    ]);
    expect(ids(rowsOf(ingested, StorageArrayResourceKind.Volume))).toEqual([
      "006E7",
      "006E8",
      "00847",
      "00848",
    ]);
    expect(ids(rowsOf(ingested, PowerMaxKind.StorageResourcePool))).toEqual([
      "SRP_1",
    ]);
    expect(ids(rowsOf(ingested, PowerMaxKind.Director))).toEqual([
      "DF-1B",
      "EM-3A",
      "EM-4A",
      "OR-1C",
      "OR-2C",
    ]);
    expect(ids(rowsOf(ingested, POWERMAX_PORT_KIND))).toEqual([
      "OR-2C:6",
      "OR-3C:35",
      "OR-4C:4",
    ]);
    expect(ids(rowsOf(ingested, PowerMaxKind.SrdfGroup))).toEqual(["12", "88"]);
  });

  test("counts every kind it listed in full", () => {
    expect(ingest(resourceFor(report, ARRAY_V4)).counts).toEqual({
      [PowerMaxKind.Director]: 5,
      [POWERMAX_PORT_KIND]: 3,
      [PowerMaxKind.SrdfGroup]: 2,
      [PowerMaxKind.StorageGroup]: 4,
      [PowerMaxKind.StorageResourcePool]: 1,
      [StorageArrayResourceKind.Volume]: 4,
    });
  });

  test("carries what each object is doing: response times, states, the director that is down", () => {
    const ingested: Ingested = ingest(resourceFor(report, ARRAY_V4));

    const oracle: StorageArrayResourceBufferEntry = rowsOf(
      ingested,
      PowerMaxKind.StorageGroup,
    ).find((row: StorageArrayResourceBufferEntry): boolean => {
      return row.externalId === "Oracle_PROD_SG";
    })!;
    expect(oracle.readLatencyUsec).toBe(3100);
    expect(oracle.writeLatencyUsec).toBe(6500);
    expect(oracle.capacityBytes).toBe(2048 * 2 ** 30);

    const vmware: StorageArrayResourceBufferEntry = rowsOf(
      ingested,
      PowerMaxKind.StorageGroup,
    ).find((row: StorageArrayResourceBufferEntry): boolean => {
      return row.externalId === "VMware_DS_SG";
    })!;
    expect(vmware.status).toBe("suspended");

    const offline: StorageArrayResourceBufferEntry = rowsOf(
      ingested,
      PowerMaxKind.Director,
    ).find((row: StorageArrayResourceBufferEntry): boolean => {
      return row.externalId === "OR-2C";
    })!;
    expect(offline.status).toBe("offline");
    expect(ingested.extras.unhealthyHardwareCount).toBeGreaterThanOrEqual(1);
  });
});

describe("a PowerMax 2000's collection, as the server ingests it", () => {
  test("is on PowerMaxOS 5978, its capacity its pools' sum, with no alert open", () => {
    const ingested: Ingested = ingest(resourceFor(report, ARRAY_V3));

    expect(ingested.extras).toMatchObject({
      storageSystem: StorageSystem.DellPowerMax,
      systemId: ARRAY_V3,
      osName: "PowerMaxOS",
      osVersion: "5978.669.669",
      openAlertCount: 0,
    });
    expect(ingested.counts).toMatchObject({
      [PowerMaxKind.SrdfGroup]: 0,
      [PowerMaxKind.StorageGroup]: 2,
      [StorageArrayResourceKind.Volume]: 2,
    });
  });
});

describe("a collection that could not upload its volumes", () => {
  test("keeps the volumes the server has: their list is not claimed complete", async () => {
    clearPowerMaxAlertCache();
    const full: StorageArrayCollectionReport = await new PowerMaxPoller({
      dependencies: harness(makeUnisphere()).dependencies,
    }).collect(collectionJob());
    clearPowerMaxAlertCache();
    const trimmed: StorageArrayCollectionReport = await new PowerMaxPoller({
      dependencies: harness(makeUnisphere()).dependencies,
      maxPayloadBytes:
        Buffer.byteLength(JSON.stringify(full.resourceMetrics)) - 1,
    }).collect(collectionJob());

    const ingested: Ingested = ingest(resourceFor(trimmed, ARRAY_V4));
    expect(rowsOf(ingested, StorageArrayResourceKind.Volume)).toEqual([]);
    // Without the mark, no volume count is written: the old one stands.
    expect(ingested.counts).not.toHaveProperty(StorageArrayResourceKind.Volume);
    expect(ingested.counts).toHaveProperty(PowerMaxKind.StorageGroup, 4);
  });
});

/*
 * Every PowerMax alert template - and the heartbeat - watches a series a
 * collection of Dell's documented answers writes, with the labels it
 * filters and groups by: a template that watches a name no probe writes
 * would never fire.
 */
describe("what the PowerMax alert templates watch, the probe writes", () => {
  function pointsNamed(name: string): Array<OtlpPoint> {
    const points: Array<OtlpPoint> = [];
    for (const resource of report.resourceMetrics as Array<JSONObject>) {
      points.push(...pointsOf(resource, name));
    }
    return points;
  }

  test("every series the PowerMax catalog charts is one a collection writes", () => {
    const missing: Array<string> = DellPowerMaxPlatform.metrics
      .map((metric: { metricName: string }): string => {
        return metric.metricName;
      })
      .filter((name: string): boolean => {
        return pointsNamed(name).length === 0;
      });
    expect(missing).toEqual([]);
  });

  test("the heartbeat is a series every collected array sends", () => {
    expect(
      pointsNamed(DellPowerMaxPlatform.heartbeat.metricName),
    ).toHaveLength(2);
  });

  test.each(
    DellPowerMaxPlatform.alertTemplates.map(
      (
        template: StorageArrayAlertTemplateSpec,
      ): [string, StorageArrayAlertTemplateSpec] => {
        return [template.id, template];
      },
    ),
  )("%s", (_id: string, template: StorageArrayAlertTemplateSpec) => {
    const matching: Array<OtlpPoint> = pointsNamed(template.metricName).filter(
      (point: OtlpPoint): boolean => {
        return Object.entries(template.attributes || {}).every(
          ([key, value]: [string, string]): boolean => {
            return point.labels[key] === value;
          },
        );
      },
    );

    expect({ template: template.id, written: matching.length > 0 }).toEqual({
      template: template.id,
      written: true,
    });
    if (template.groupByAttributeKey) {
      for (const point of matching) {
        expect(point.labels[template.groupByAttributeKey]).toBeTruthy();
      }
    }
  });
});
