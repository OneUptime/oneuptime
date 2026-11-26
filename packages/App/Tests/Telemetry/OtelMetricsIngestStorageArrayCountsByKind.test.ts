import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import StorageArrayResourceService from "Common/Server/Services/StorageArrayResourceService";
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import StorageArrayExtractors from "Common/Server/Utils/Telemetry/StorageArray/StorageArrayExtractors";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ACME_AGGREGATE_KIND,
  ACME_EXTRACTOR,
  ACME_PLATFORM,
  ACME_STORAGE_SYSTEM,
  AcmeSeries,
  acmeAggregatesScrape,
  acmeVolumesScrape,
} from "Common/Tests/Helpers/StorageArray/AcmePlatform";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What a batch's counts write to StorageArray.countsByKind (#11000),
 * through the real ingest: OtelMetricsIngestService.processMetricsFromQueue
 * folds a storage array batch, and its flush hands each kind the batch
 * listed in full to StorageArrayService.mergeCountsByKind, after the
 * inventory and the array's columns. A FlashArray's volumes, a FlashBlade's
 * file systems and buckets, and Acme's aggregates - a kind no shipped code
 * knows - all go the same way. A batch that listed no kind in full writes
 * none, and a failing write costs nothing else.
 *
 * OtelMetricsIngestStorageArraySnapshot.test.ts pins the rest of the flush.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ARRAY_ID: ObjectID = ObjectID.generate();

// 2023-11-14T22:13:20.000Z - one scrape instant for the whole batch.
const BASE_MS: number = 1700000000000;

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

function attributes(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, value]: [string, string]) => {
    return { key, value: { stringValue: value } };
  });
}

function gauge(
  name: string,
  points: Array<{ value: number; labels: Record<string, string> }>,
): JSONObject {
  return {
    name,
    description: name,
    unit: "",
    gauge: {
      dataPoints: points.map(
        (point: { value: number; labels: Record<string, string> }) => {
          return {
            asDouble: point.value,
            timeUnixNano: `${BASE_MS}000000`,
            attributes: attributes(point.labels),
          };
        },
      ),
    },
  };
}

function resourceMetrics(data: {
  arrayName: string;
  storageSystem?: string | undefined;
  metrics: Array<JSONObject>;
}): JSONObject {
  const resource: Record<string, string> = {
    "storage.array.name": data.arrayName,
  };
  if (data.storageSystem) {
    resource["storage.system"] = data.storageSystem;
  }
  return {
    resource: { attributes: attributes(resource) },
    scopeMetrics: [
      {
        scope: {
          name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/prometheusreceiver",
          version: "0.161.0",
        },
        metrics: data.metrics,
      },
    ],
  };
}

// A batch of series, each its own gauge, as the collector forwards them.
function scrape(data: {
  arrayName: string;
  storageSystem?: string | undefined;
  series: Array<AcmeSeries>;
}): JSONObject {
  return resourceMetrics({
    arrayName: data.arrayName,
    storageSystem: data.storageSystem,
    metrics: data.series.map((series: AcmeSeries): JSONObject => {
      return gauge(series.metricName, [
        { value: series.value, labels: series.labels },
      ]);
    }),
  });
}

function faVolumesScrape(volumes: Array<string>): JSONObject {
  return scrape({
    arrayName: "pure-fa-01",
    storageSystem: "purestorage.flasharray",
    series: [
      {
        metricName: "purefa_info",
        value: 1,
        labels: { array_name: "pure-fa-01", scrape_endpoint: "volumes" },
      },
      ...volumes.map((name: string): AcmeSeries => {
        return {
          metricName: "purefa_volume_space_bytes",
          value: 1024,
          labels: {
            name,
            space: "total_provisioned",
            scrape_endpoint: "volumes",
          },
        };
      }),
    ],
  });
}

function fbScrape(endpoint: string, series: Array<AcmeSeries>): JSONObject {
  return scrape({
    arrayName: "pure-fb-01",
    storageSystem: "purestorage.flashblade",
    series: [
      {
        metricName: "purefb_info",
        value: 1,
        labels: { array_name: "pure-fb-01", scrape_endpoint: endpoint },
      },
      ...series,
    ],
  });
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

interface Spies {
  mergeCountsByKind: jest.SpyInstance;
  bulkUpsert: jest.SpyInstance;
  updateLastSeen: jest.SpyInstance;
  order: Array<string>;
}

interface MergeCall {
  storageArrayId: ObjectID;
  countsByKind: Record<string, number>;
}

function setupIngestMocks(): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  const order: Array<string> = [];

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest.spyOn(service, "submitMetricsBuffer").mockResolvedValue(undefined);
  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  jest.spyOn(service, "autoDiscoverStorageArray").mockResolvedValue(ARRAY_ID);
  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "storage-array/pure-fa-01",
    primaryEntityId: ARRAY_ID,
    primaryEntityType: ServiceType.StorageArray,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue(noRules());
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  const bulkUpsert: jest.SpyInstance = jest
    .spyOn(StorageArrayResourceService, "bulkUpsert")
    .mockImplementation(async () => {
      order.push("inventory");
    });
  jest
    .spyOn(StorageArrayResourceService, "setVolumeConnectionCounts")
    .mockResolvedValue(0);
  jest
    .spyOn(StorageArrayResourceService, "resetVolumeConnectionCounts")
    .mockResolvedValue(0);
  const updateLastSeen: jest.SpyInstance = jest
    .spyOn(StorageArrayService, "updateLastSeen")
    .mockImplementation(async () => {
      order.push("array");
      return HEARTBEAT_ROW_PRESENT;
    });
  const mergeCountsByKind: jest.SpyInstance = jest
    .spyOn(StorageArrayService, "mergeCountsByKind")
    .mockImplementation(async () => {
      order.push("counts");
      return true;
    });

  return { mergeCountsByKind, bulkUpsert, updateLastSeen, order };
}

function countsWritten(spies: Spies): Array<Record<string, number>> {
  return spies.mergeCountsByKind.mock.calls.map(
    (call: Array<unknown>): Record<string, number> => {
      const merge: MergeCall = call[0] as MergeCall;
      expect(merge.storageArrayId.toString()).toBe(ARRAY_ID.toString());
      return merge.countsByKind;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  StorageArrayExtractors.unregister(ACME_STORAGE_SYSTEM);
  StorageArrayPlatformRegistry.unregister(ACME_STORAGE_SYSTEM);
});

describe("the counts a storage array batch writes", () => {
  test("a FlashArray volumes scrape counts its volumes, after the inventory and the array", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faVolumesScrape(["vol-a", "vol-b", "vol-c"])]),
    );

    expect(countsWritten(spies)).toEqual([{ Volume: 3 }]);
    expect(spies.order).toEqual(["inventory", "array", "counts"]);
  });

  test("a volumes scrape of an array whose last volume was deleted writes 0", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faVolumesScrape([])]),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(countsWritten(spies)).toEqual([{ Volume: 0 }]);
  });

  test("a FlashBlade's file systems and buckets, each from its own scrape", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        fbScrape("filesystems", [
          {
            metricName: "purefb_file_systems_space_bytes",
            value: 10,
            labels: {
              name: "fs-home",
              space: "provisioned",
              scrape_endpoint: "filesystems",
            },
          },
        ]),
        fbScrape("objectstore", [
          {
            metricName: "purefb_buckets_space_bytes",
            value: 5,
            labels: {
              name: "bkt-logs",
              space: "total_physical",
              scrape_endpoint: "objectstore",
            },
          },
          {
            metricName: "purefb_buckets_space_bytes",
            value: 6,
            labels: {
              name: "bkt-backups",
              space: "total_physical",
              scrape_endpoint: "objectstore",
            },
          },
        ]),
      ]),
    );

    expect(countsWritten(spies)).toEqual([{ Bucket: 2, FileSystem: 1 }]);
  });

  test("a batch that listed no kind in full writes no counts", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        scrape({
          arrayName: "pure-fa-01",
          storageSystem: "purestorage.flasharray",
          series: [
            {
              metricName: "purefa_info",
              value: 1,
              labels: { array_name: "pure-fa-01", scrape_endpoint: "array" },
            },
          ],
        }),
      ]),
    );

    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(spies.mergeCountsByKind).not.toHaveBeenCalled();
  });

  test("a batch of no storage array writes nothing of a storage array's", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        {
          resource: { attributes: attributes({ "service.name": "api" }) },
          scopeMetrics: [
            {
              metrics: [
                gauge("http_requests_total", [{ value: 1, labels: {} }]),
              ],
            },
          ],
        },
      ]),
    );

    expect(spies.mergeCountsByKind).not.toHaveBeenCalled();
    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("a failing counts write is swallowed, and everything before it landed", async () => {
    const spies: Spies = setupIngestMocks();
    spies.mergeCountsByKind.mockRejectedValue(new Error("postgres down"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([faVolumesScrape(["vol-a"])]),
      ),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(spies.mergeCountsByKind).toHaveBeenCalledTimes(1);
  });

  test("a failing array write does not stop the counts", async () => {
    const spies: Spies = setupIngestMocks();
    spies.updateLastSeen.mockRejectedValue(new Error("postgres down"));

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faVolumesScrape(["vol-a", "vol-b"])]),
    );

    expect(countsWritten(spies)).toEqual([{ Volume: 2 }]);
  });
});

describe("a platform registered at runtime, through the same ingest", () => {
  function acmeScrape(series: Array<AcmeSeries>): JSONObject {
    return scrape({
      arrayName: "acme-prod-01",
      storageSystem: ACME_STORAGE_SYSTEM,
      series,
    });
  }

  test("Acme's aggregates - a kind of its own - are discovered, listed and counted", async () => {
    StorageArrayPlatformRegistry.register(ACME_PLATFORM);
    StorageArrayExtractors.register(ACME_EXTRACTOR);
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        acmeScrape(
          acmeAggregatesScrape([
            { name: "aggr1", usedBytes: 700, sizeBytes: 1000 },
            { name: "aggr2", usedBytes: 50, sizeBytes: 2000 },
          ]),
        ),
        acmeScrape(acmeVolumesScrape([{ name: "vol-a", usedBytes: 9 }])),
      ]),
    );

    expect(countsWritten(spies)).toEqual([
      { [ACME_AGGREGATE_KIND]: 2, Volume: 1 },
    ]);
    const rows: Array<{ kind: string; externalId: string }> = (
      spies.bulkUpsert.mock.calls[0]![0] as {
        resources: Array<{ kind: string; externalId: string }>;
      }
    ).resources;
    expect(
      rows
        .map((row: { kind: string; externalId: string }): string => {
          return `${row.kind}:${row.externalId}`;
        })
        .sort(),
    ).toEqual(["Aggregate:aggr1", "Aggregate:aggr2", "Volume:vol-a"]);
    expect(spies.updateLastSeen.mock.calls[0]![1]).toMatchObject({
      storageSystem: ACME_STORAGE_SYSTEM,
      reportedName: "acme-prod-01",
      volumeCount: 1,
    });
  });

  test("unregistered, its series are telemetry and nothing more", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        acmeScrape(
          acmeAggregatesScrape([
            { name: "aggr1", usedBytes: 700, sizeBytes: 1000 },
          ]),
        ),
      ]),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.mergeCountsByKind).not.toHaveBeenCalled();
  });
});
