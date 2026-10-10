import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { HEARTBEAT_MAX_BACKDATE_MS } from "Common/Utils/Telemetry/HeartbeatAvailability";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import fs from "fs";
import path from "path";

/*
 * Issue #2825: the synthetic host heartbeat (oneuptime.host.heartbeat) that
 * the availability charts are drawn from is placed on the timeline the data
 * ARRIVED on, not on the clock of whichever worker processed it.
 *
 * After a restart, or while the ingest queue was behind, workers drained
 * minutes of queued batches at once. Clamped to the worker's clock, every
 * one of those heartbeats piled into the last two minutes before it was
 * processed, and the minutes before them stayed empty: every host showed a
 * permanent "down" stretch that OneUptime's own backlog had made. Clamped to
 * the batch's arrival, each heartbeat lands where its data belongs.
 *
 * OTLP request -> real metric walk and heartbeat construction -> rows; the
 * database discovery and the writer are stood in for, as in
 * OtelMetricsIngestCatalog.test.ts.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = `host/${SERVICE_ID.toString()}`;

const MINUTE_MS: number = 60_000;
const NANOS_PER_MS: number = 1_000_000;

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type IngestTestMethods = Record<string, any>;

let rows: Array<JSONObject>;

function hostBatch(scrapedAtMs: number): JSONArray {
  return [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: SERVICE_NAME } },
          { key: "host.name", value: { stringValue: "web-01" } },
        ],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: "system.cpu.utilization",
              unit: "1",
              gauge: {
                dataPoints: [
                  {
                    asDouble: 0.4,
                    timeUnixNano: `${scrapedAtMs}000000`,
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ];
}

async function heartbeatStampMs(data: {
  scrapedAtMs: number;
  receivedAt?: Date | string | undefined;
}): Promise<number> {
  const req: TelemetryRequest = {
    projectId: PROJECT_ID,
    body: { resourceMetrics: hostBatch(data.scrapedAtMs) },
    headers: {},
    ...(data.receivedAt !== undefined ? { receivedAt: data.receivedAt } : {}),
  } as unknown as TelemetryRequest;

  await OtelMetricsIngestService.processMetricsFromQueue(req);

  const heartbeat: JSONObject | undefined = rows.find((row: JSONObject) => {
    return row["name"] === "oneuptime.host.heartbeat";
  });

  expect(heartbeat).toBeDefined();

  return Number(
    BigInt(String(heartbeat!["timeUnixNano"])) / BigInt(1_000_000),
  );
}

beforeEach(() => {
  rows = [];
  const ingest: IngestTestMethods =
    OtelMetricsIngestService as unknown as IngestTestMethods;
  jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(ingest, method).mockResolvedValue(null);
  }
  jest.spyOn(ingest, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as TelemetryServiceMetadata);
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
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("The synthetic host heartbeat is stamped by when its batch arrived", () => {
  test("a batch that waited ten minutes in the queue keeps its scrape time", async () => {
    const arrivedMs: number = Date.now() - 10 * MINUTE_MS;
    const scrapedMs: number = arrivedMs - 5_000;

    expect(
      await heartbeatStampMs({
        scrapedAtMs: scrapedMs,
        receivedAt: new Date(arrivedMs),
      }),
    ).toBe(scrapedMs);
  });

  test("the arrival can come through the queue as a string", async () => {
    const arrivedMs: number = Date.now() - 7 * MINUTE_MS;
    const scrapedMs: number = arrivedMs - 20_000;

    expect(
      await heartbeatStampMs({
        scrapedAtMs: scrapedMs,
        receivedAt: new Date(arrivedMs).toISOString(),
      }),
    ).toBe(scrapedMs);
  });

  test("backdating is still floored, now relative to the arrival", async () => {
    // A collector resending what it queued during an outage.
    const arrivedMs: number = Date.now() - 3 * MINUTE_MS;

    expect(
      await heartbeatStampMs({
        scrapedAtMs: arrivedMs - 30 * MINUTE_MS,
        receivedAt: new Date(arrivedMs),
      }),
    ).toBe(arrivedMs - HEARTBEAT_MAX_BACKDATE_MS);
  });

  test("a scrape stamped after its arrival (a host clock running ahead) is pulled back to the arrival", async () => {
    const arrivedMs: number = Date.now() - 4 * MINUTE_MS;

    expect(
      await heartbeatStampMs({
        scrapedAtMs: arrivedMs + 2 * MINUTE_MS,
        receivedAt: new Date(arrivedMs),
      }),
    ).toBe(arrivedMs);
  });

  test("without an arrival stamp it behaves exactly as before: clamped to now", async () => {
    const before: number = Date.now();
    const stamp: number = await heartbeatStampMs({
      scrapedAtMs: before - 30 * MINUTE_MS,
    });
    const after: number = Date.now();

    expect(stamp).toBeGreaterThanOrEqual(before - HEARTBEAT_MAX_BACKDATE_MS);
    expect(stamp).toBeLessThanOrEqual(after - HEARTBEAT_MAX_BACKDATE_MS);
  });
});

describe("OtelMetricsIngestService.getBatchArrivalUnixNano", () => {
  const NOW_NANO: number =
    Date.parse("2026-10-09T12:00:00.000Z") * NANOS_PER_MS;

  test("reads a Date or an ISO string", () => {
    const arrived: Date = new Date("2026-10-09T11:50:00.000Z");
    expect(
      OtelMetricsIngestService.getBatchArrivalUnixNano(arrived, NOW_NANO),
    ).toBe(arrived.getTime() * NANOS_PER_MS);
    expect(
      OtelMetricsIngestService.getBatchArrivalUnixNano(
        arrived.toISOString(),
        NOW_NANO,
      ),
    ).toBe(arrived.getTime() * NANOS_PER_MS);
  });

  test("falls back to now when there is no usable stamp", () => {
    expect(
      OtelMetricsIngestService.getBatchArrivalUnixNano(undefined, NOW_NANO),
    ).toBe(NOW_NANO);
    expect(
      OtelMetricsIngestService.getBatchArrivalUnixNano("yesterday", NOW_NANO),
    ).toBe(NOW_NANO);
    expect(
      OtelMetricsIngestService.getBatchArrivalUnixNano(new Date(0), NOW_NANO),
    ).toBe(NOW_NANO);
  });

  test("is never later than now", () => {
    expect(
      OtelMetricsIngestService.getBatchArrivalUnixNano(
        new Date("2026-10-09T12:00:30.000Z"),
        NOW_NANO,
      ),
    ).toBe(NOW_NANO);
  });
});

describe("The metrics queue worker hands the arrival to ingest", () => {
  test("the queued job's ingestionTimestamp becomes the request's receivedAt", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts",
      ),
      "utf8",
    );
    const metricsCase: string = source.slice(
      source.indexOf("case TelemetryType.Metrics:"),
      source.indexOf("processMetricsFromQueue"),
    );

    expect(metricsCase).toContain("receivedAt: jobData.ingestionTimestamp");
  });
});
