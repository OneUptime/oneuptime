import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  OtelAggregationTemporality,
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { AggregationTemporality } from "Common/Models/AnalyticsModels/Metric";
import Service from "Common/Models/DatabaseModels/Service";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * OTLP request -> real metric walk, heartbeat and row construction ->
 * catalog writer. Mock database discovery and the persistence boundaries;
 * catalog construction and per-buffer flushing run unchanged.
 */
const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const OTHER_SERVICE_ID: ObjectID = ObjectID.generate();

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

let metadataByName: Map<string, TelemetryServiceMetadata>;
let rows: Array<JSONObject>;
let indexCatalog: jest.SpyInstance;

type IngestTestMethods = Record<string, any> & {
  resolveTelemetryResource: (data: {
    attributes: JSONArray;
  }) => Promise<TelemetryServiceMetadata>;
};

function makeMetric(
  data: {
    name?: string;
    description?: string;
    unit?: string;
    points?: number;
  } = {},
): JSONObject {
  return {
    name: data.name ?? "Requests.Total",
    description: data.description ?? "First description",
    unit: data.unit ?? "1",
    gauge: {
      dataPoints: Array.from({ length: data.points ?? 1 }, () => {
        return { asInt: 1, timeUnixNano: `${Date.now()}000000` };
      }),
    },
  };
}

function resource(
  data: {
    serviceId?: ObjectID;
    type?: ServiceType;
    hostName?: string;
    metrics?: JSONArray;
    scopes?: number;
  } = {},
): JSONObject {
  const id: ObjectID = data.serviceId ?? SERVICE_ID;
  const name: string = `${data.type ?? ServiceType.OpenTelemetry}/${id.toString()}`;
  metadataByName.set(name, {
    serviceName: name,
    primaryEntityId: id,
    primaryEntityType: data.type ?? ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  const attributes: JSONArray = [
    { key: "service.name", value: { stringValue: name } },
  ];
  if (data.hostName) {
    attributes.push({
      key: "host.name",
      value: { stringValue: data.hostName },
    });
  }
  return {
    resource: { attributes },
    scopeMetrics: Array.from({ length: data.scopes ?? 1 }, () => {
      return { metrics: data.metrics ?? [makeMetric()] };
    }),
  };
}

function request(resources: JSONArray): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: resources },
    headers: {},
  } as unknown as TelemetryRequest;
}

function catalog(index: number = 0): Dictionary<MetricType> {
  return indexCatalog.mock.calls[index]![0].metricNameServiceNameMap;
}

function catalogServiceIds(
  metrics: Dictionary<MetricType>,
  name: string,
): Array<string> {
  return metrics[name]!.services!.map((service: Service) => {
    return service.id!.toString();
  });
}

beforeEach(() => {
  metadataByName = new Map();
  rows = [];
  const ingest: IngestTestMethods =
    OtelMetricsIngestService as unknown as IngestTestMethods;
  jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(ingest, method).mockResolvedValue(null);
  }
  jest
    .spyOn(ingest, "resolveTelemetryResource")
    .mockImplementation(async (data: { attributes: JSONArray }) => {
      const name: string = (data.attributes[0]!["value"] as JSONObject)[
        "stringValue"
      ] as string;
      const metadata: TelemetryServiceMetadata = metadataByName.get(name)!;
      return {
        ...metadata,
        primaryEntityId: new ObjectID(metadata.primaryEntityId.toString()),
      };
    });
  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
    projectRules: [],
    rulesByServiceId: new Map(),
  });
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (_target: FanInInsertTarget, batch: Array<JSONObject>) => {
        rows.push(...batch);
        return { flushed: Promise.resolve() };
      },
    );
  indexCatalog = jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("metric ingest catalog integration", () => {
  test("deduplicates across scopes/resources while preserving rows and first metadata", async () => {
    const req: TelemetryRequest = request([
      resource({ scopes: 2, metrics: [makeMetric({ points: 2 })] }),
      resource({
        serviceId: OTHER_SERVICE_ID,
        metrics: [
          makeMetric({
            name: "requests.total",
            description: "Later",
            unit: "bytes",
          }),
        ],
      }),
      resource(),
    ]);

    await OtelMetricsIngestService.processMetricsFromQueue(req);

    expect(indexCatalog).toHaveBeenCalledTimes(1);
    expect(indexCatalog.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect(Object.keys(catalog())).toEqual(["requests.total"]);
    expect(catalogServiceIds(catalog(), "requests.total")).toEqual([
      SERVICE_ID.toString(),
      OTHER_SERVICE_ID.toString(),
    ]);
    expect(catalog()["requests.total"]!.description).toBe("First description");
    expect(catalog()["requests.total"]!.unit).toBe("1");
    expect(rows).toHaveLength(6);
    expect(
      rows.every((row: JSONObject) => {
        return row["name"] === "requests.total";
      }),
    ).toBe(true);
    expect(req.body).toBeNull();
  });

  test("retains all service links across multiple row-buffer flushes", async () => {
    const ids: Array<ObjectID> = Array.from({ length: 300 }, () => {
      return ObjectID.generate();
    });
    const resources: JSONArray = ids.map((id: ObjectID) => {
      return resource({
        serviceId: id,
        metrics: [
          makeMetric({ points: 2 }),
          makeMetric({ name: "Request.Duration", points: 2 }),
        ],
      });
    });

    await OtelMetricsIngestService.processMetricsFromQueue(request(resources));

    expect(rows).toHaveLength(1_200);
    expect(TelemetryFanInWriter.submit).toHaveBeenCalledTimes(2);
    const expectedIds: Array<string> = ids.map((id: ObjectID) => {
      return id.toString();
    });
    expect(catalogServiceIds(catalog(), "requests.total")).toEqual(expectedIds);
    expect(catalogServiceIds(catalog(), "request.duration")).toEqual(
      expectedIds,
    );
  });

  test("shares catalog membership between synthetic and submitted host heartbeats", async () => {
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resource({ hostName: "host-one" }),
        resource({
          hostName: "host-one",
          metrics: [makeMetric({ name: "oneuptime.host.heartbeat" })],
        }),
        resource({ serviceId: OTHER_SERVICE_ID, hostName: "host-two" }),
      ]),
    );

    expect(catalogServiceIds(catalog(), "oneuptime.host.heartbeat")).toEqual([
      SERVICE_ID.toString(),
      OTHER_SERVICE_ID.toString(),
    ]);
    expect(catalog()["oneuptime.host.heartbeat"]!.description).toContain(
      "Synthetic heartbeat",
    );
    expect(
      rows.filter((row: JSONObject) => {
        return row["name"] === "oneuptime.host.heartbeat";
      }),
    ).toHaveLength(3);
  });

  test("keeps user metric metadata when observed before a synthetic heartbeat", async () => {
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resource({
          metrics: [
            makeMetric({
              name: "oneuptime.host.heartbeat",
              description: "User metric",
              unit: "beats",
            }),
          ],
        }),
        resource({ hostName: "host-one" }),
      ]),
    );

    expect(catalog()["oneuptime.host.heartbeat"]!.description).toBe(
      "User metric",
    );
    expect(catalog()["oneuptime.host.heartbeat"]!.unit).toBe("beats");
    expect(catalogServiceIds(catalog(), "oneuptime.host.heartbeat")).toEqual([
      SERVICE_ID.toString(),
    ]);
  });

  test("catalogs infrastructure metrics and heartbeats without invalid Service links", async () => {
    const types: Array<ServiceType> = Object.values(ServiceType).filter(
      (type: ServiceType) => {
        return type !== ServiceType.OpenTelemetry;
      },
    );
    await OtelMetricsIngestService.processMetricsFromQueue(
      request(
        types.map((type: ServiceType) => {
          return resource({ type, hostName: `host-${type}` });
        }),
      ),
    );

    expect(rows).toHaveLength(types.length * 2);
    expect(catalogServiceIds(catalog(), "requests.total")).toEqual([]);
    expect(catalogServiceIds(catalog(), "oneuptime.host.heartbeat")).toEqual(
      [],
    );
  });

  test("keeps concurrent request catalogs independent", async () => {
    await Promise.all([
      OtelMetricsIngestService.processMetricsFromQueue(request([resource()])),
      OtelMetricsIngestService.processMetricsFromQueue(
        request([
          resource({ metrics: [makeMetric({ description: "Other request" })] }),
        ]),
      ),
    ]);

    expect(indexCatalog).toHaveBeenCalledTimes(2);
    expect(catalogServiceIds(catalog(0), "requests.total")).toEqual([
      SERVICE_ID.toString(),
    ]);
    expect(catalogServiceIds(catalog(1), "requests.total")).toEqual([
      SERVICE_ID.toString(),
    ]);
    expect(catalog(0)["requests.total"]).not.toBe(catalog(1)["requests.total"]);
    expect(
      new Set([
        catalog(0)["requests.total"]!.description,
        catalog(1)["requests.total"]!.description,
      ]),
    ).toEqual(new Set(["First description", "Other request"]));
  });

  test("continues updating counter semantics on the cataloged metric", async () => {
    const counter: JSONObject = {
      name: "requests.total",
      description: "Counter description",
      unit: "requests",
      sum: {
        aggregationTemporality: OtelAggregationTemporality.Cumulative,
        isMonotonic: true,
        dataPoints: [{ asInt: 10, timeUnixNano: `${Date.now()}000000` }],
      },
    };
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resource({ metrics: [counter] }),
        resource({
          serviceId: OTHER_SERVICE_ID,
          metrics: [
            {
              ...counter,
              sum: {
                ...(counter["sum"] as JSONObject),
                aggregationTemporality: OtelAggregationTemporality.Delta,
                isMonotonic: false,
              },
            },
          ],
        }),
        /*
         * A later gauge does not supply counter semantics and must not
         * erase the last explicitly observed values on the catalog entry.
         */
        resource(),
      ]),
    );

    expect(rows).toHaveLength(3);
    expect(catalog()["requests.total"]!.aggregationTemporality).toBe(
      AggregationTemporality.Delta,
    );
    expect(catalog()["requests.total"]!.isMonotonic).toBe(false);
    expect(catalog()["requests.total"]!.description).toBe(
      "Counter description",
    );
    expect(catalogServiceIds(catalog(), "requests.total")).toEqual([
      SERVICE_ID.toString(),
      OTHER_SERVICE_ID.toString(),
    ]);
  });

  test("continues to treat a catalog write failure as non-fatal after rows land", async () => {
    indexCatalog.mockRejectedValueOnce(new Error("Catalog unavailable"));
    const req: TelemetryRequest = request([resource()]);

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(req),
    ).resolves.toBeUndefined();

    expect(rows).toHaveLength(1);
    expect(req.body).toBeNull();
  });
});
