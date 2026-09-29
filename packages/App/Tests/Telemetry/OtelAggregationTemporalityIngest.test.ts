import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import protobuf from "protobufjs";
import zlib from "zlib";
import { TELEMETRY_METRIC_FLUSH_BATCH_SIZE } from "../../FeatureSet/Telemetry/Config";
import {
  buildTelemetryRequest,
  OTLP_PROTO_LOADER_OPTIONS,
} from "../../FeatureSet/Telemetry/GrpcServer";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import { TelemetryIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import OtelPayloadDecoder, {
  OtelPayloadEncoding,
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import {
  OtelAggregationTemporality,
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * GH#3978: an OTel pipeline built for Datadog, re-pointed at OneUptime.
 *
 * OTLP/JSON encodes the metric `aggregationTemporality` enum as an INTEGER
 * (0 = UNSPECIFIED, 1 = DELTA, 2 = CUMULATIVE), while protobuf bodies decoded
 * with protobufjs `.toJSON()` and gRPC requests decoded by proto-loader
 * (`enums: String`) carry the enum NAMES. Ingest used to match only the
 * names, so every OTLP/JSON sum / histogram / exponential-histogram row was
 * stored with temporality null and the MetricType catalog never learned the
 * metric was a counter. OtelMetricsIngestService
 * .normalizeAggregationTemporality now folds both forms at the single place
 * the metric wrapper's temporality is read.
 *
 * Covered here:
 *   - the normalizer's whole input contract (table-driven);
 *   - the real OTLP walk (processMetricsFromQueue) for every metric kind and
 *     every wire form, down to the stored row and the per-batch catalog;
 *   - the pipeline-rule / deferred row-completion path, which never sees the
 *     temporality and must re-attach it after the rules ran;
 *   - the real MetricType catalog writer across batches, where an
 *     unspecified temporality must read as "unknown", never as "clear";
 *   - each wire format end to end: producer enqueue -> staged body -> worker
 *     decode (JSON.parse / protobufjs / proto-loader) -> ingest.
 *
 * Postgres, ClickHouse, Redis and auto-discovery are mocked at their
 * boundaries; the OTLP walk, row construction, pipeline rule engine, payload
 * decoders, queue producer and catalog construction all run for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const METRIC_TYPE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "temporality-ingest-test";

// 2026-09-25T12:00:00.000Z and one hour earlier, as OTLP unix-nano strings.
const TIME_MS: number = Date.UTC(2026, 8, 25, 12, 0, 0, 0);
const START_MS: number = Date.UTC(2026, 8, 25, 11, 0, 0, 0);
const TIME_NANO: string = `${TIME_MS}000000`;
const START_NANO: string = `${START_MS}000000`;
const TIME_DB: string = "2026-09-25 12:00:00";

const HEARTBEAT_METRIC_NAME: string = "oneuptime.host.heartbeat";

const AUTO_DISCOVERY_METHODS: Array<string> = [
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

/*
 * The same proto files the decoder and the gRPC server load, so every wire
 * fixture below is encoded with the exact schema production decodes with.
 */
const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

const METRICS_SERVICE_PROTO: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "metrics_service.proto"),
);

// What an OTLP exporter puts on the wire, for both OTLP/HTTP and OTLP/gRPC.
const ExportMetricsServiceRequest: protobuf.Type =
  METRICS_SERVICE_PROTO.lookupType("ExportMetricsServiceRequest");

const ProtoAggregationTemporality: protobuf.Enum =
  METRICS_SERVICE_PROTO.lookupEnum("AggregationTemporality");

// The gRPC server's own request deserializer, built with its own options.
const GRPC_METRICS_EXPORT: protoLoader.ServiceDefinition[string] = (
  protoLoader.loadSync(
    path.join(PROTO_DIR, "metrics_service.proto"),
    OTLP_PROTO_LOADER_OPTIONS,
  )[
    "opentelemetry.proto.collector.metrics.v1.MetricsService"
  ] as protoLoader.ServiceDefinition
)["Export"]!;

type IngestTestMethods = Record<string, any>;

type TemporalKind = "sum" | "histogram" | "exponentialHistogram";
type MetricKind = TemporalKind | "gauge" | "summary";

const POINT_TYPE_BY_KIND: Record<MetricKind, MetricPointType> = {
  sum: MetricPointType.Sum,
  gauge: MetricPointType.Gauge,
  histogram: MetricPointType.Histogram,
  exponentialHistogram: MetricPointType.ExponentialHistogram,
  summary: MetricPointType.Summary,
};

/*
 * The decoded values each kind's datapoint must produce, so a test that
 * asserts temporality also proves the row came from the wrapper it expects.
 */
const ROW_FINGERPRINT_BY_KIND: Record<MetricKind, JSONObject> = {
  sum: { value: 10, time: TIME_DB },
  gauge: { value: 0.5, time: TIME_DB },
  histogram: {
    count: 3,
    sum: 6.5,
    bucketCounts: [1, 2],
    explicitBounds: [1],
    time: TIME_DB,
  },
  exponentialHistogram: {
    count: 4,
    sum: 10,
    scale: 2,
    zeroCount: 1,
    positiveOffset: 1,
    positiveBucketCounts: [1, 2],
    time: TIME_DB,
  },
  summary: {
    count: 10,
    sum: 1.25,
    summaryQuantiles: [0.5, 0.99],
    summaryValues: [0.1, 0.4],
    time: TIME_DB,
  },
};

type RowSemantics = {
  metricPointType: MetricPointType;
  aggregationTemporality: AggregationTemporality | null;
  isMonotonic: boolean | null;
};

let rows: Array<JSONObject>;
let indexCatalog: jest.SpyInstance;

function serviceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

function useRules(rules: MetricRulesForProject): void {
  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue(rules);
}

function metricNameRule(data: {
  ruleType: MetricPipelineRuleType;
  metricName: string;
}): MetricPipelineRule {
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.ruleType = data.ruleType;
  rule.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
      conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
      value: data.metricName,
    },
  ];
  return rule;
}

function dataPoint(kind: MetricKind): JSONObject {
  switch (kind) {
    case "sum":
      return {
        timeUnixNano: TIME_NANO,
        startTimeUnixNano: START_NANO,
        asInt: "10",
      };
    case "gauge":
      return { timeUnixNano: TIME_NANO, asDouble: 0.5 };
    case "histogram":
      return {
        timeUnixNano: TIME_NANO,
        startTimeUnixNano: START_NANO,
        count: "3",
        sum: 6.5,
        bucketCounts: ["1", "2"],
        explicitBounds: [1],
      };
    case "exponentialHistogram":
      return {
        timeUnixNano: TIME_NANO,
        startTimeUnixNano: START_NANO,
        count: "4",
        sum: 10,
        scale: 2,
        zeroCount: "1",
        positive: { offset: 1, bucketCounts: ["1", "2"] },
      };
    case "summary":
      return {
        timeUnixNano: TIME_NANO,
        count: "10",
        sum: 1.25,
        quantileValues: [
          { quantile: 0.5, value: 0.1 },
          { quantile: 0.99, value: 0.4 },
        ],
      };
  }
}

/*
 * One OTLP metric in its JSON shape. `temporality` / `isMonotonic` land on
 * the kind's wrapper only when given, so "absent" is a real absent key — what
 * the worker sees when the exporter left a proto3 default (a zero enum, a
 * false bool) off the wire, as the Collector's encoders do.
 */
function makeMetric(data: {
  name: string;
  kind: MetricKind;
  temporality?: unknown;
  isMonotonic?: boolean;
  points?: number;
}): JSONObject {
  const wrapper: JSONObject = {
    dataPoints: Array.from({ length: data.points ?? 1 }, () => {
      return dataPoint(data.kind);
    }),
  };
  if (data.temporality !== undefined) {
    wrapper["aggregationTemporality"] = data.temporality as JSONValue;
  }
  if (data.isMonotonic !== undefined) {
    wrapper["isMonotonic"] = data.isMonotonic;
  }
  return {
    name: data.name,
    description: `${data.name} description`,
    unit: "1",
    [data.kind]: wrapper,
  };
}

function resourceWithScopes(
  scopes: Array<JSONArray>,
  hostName?: string,
): JSONObject {
  const attributes: JSONArray = [
    { key: "service.name", value: { stringValue: SERVICE_NAME } },
  ];
  if (hostName) {
    attributes.push({ key: "host.name", value: { stringValue: hostName } });
  }
  return {
    resource: { attributes: attributes },
    scopeMetrics: scopes.map((metrics: JSONArray) => {
      return {
        scope: { name: "temporality-test", version: "1.0.0" },
        metrics: metrics,
      };
    }),
  };
}

function resource(metrics: JSONArray, hostName?: string): JSONObject {
  return resourceWithScopes([metrics], hostName);
}

function request(resources: JSONArray): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: resources },
    headers: {},
  } as unknown as TelemetryRequest;
}

async function ingestResources(resources: JSONArray): Promise<void> {
  await OtelMetricsIngestService.processMetricsFromQueue(request(resources));
}

async function ingestMetrics(metrics: JSONArray): Promise<void> {
  await ingestResources([resource(metrics)]);
}

function rowsNamed(name: string): Array<JSONObject> {
  return rows.filter((row: JSONObject) => {
    return row["name"] === name;
  });
}

function semantics(row: JSONObject): RowSemantics {
  return {
    metricPointType: row["metricPointType"] as MetricPointType,
    aggregationTemporality: row[
      "aggregationTemporality"
    ] as AggregationTemporality | null,
    isMonotonic: row["isMonotonic"] as boolean | null,
  };
}

function catalog(): Dictionary<MetricType> {
  expect(indexCatalog).toHaveBeenCalledTimes(1);
  return indexCatalog.mock.calls[0]![0].metricNameServiceNameMap;
}

function catalogEntry(name: string): MetricType {
  const entry: MetricType | undefined = catalog()[name];
  expect(entry).toBeDefined();
  return entry!;
}

/*
 * Every row of `name` carries `expected`, and — when the metric name occurs
 * once in the batch — the catalog entry agrees. The catalog keeps
 * `undefined` (never null) for "not declared": the MetricType writer treats
 * undefined as "unknown, keep the stored value" but would write a null.
 */
function expectMetricStored(
  name: string,
  expected: RowSemantics,
  datapoints: number,
): void {
  const metricRows: Array<JSONObject> = rowsNamed(name);
  expect(metricRows).toHaveLength(datapoints);
  for (const row of metricRows) {
    expect(semantics(row)).toEqual(expected);
  }
  const entry: MetricType = catalogEntry(name);
  expect(entry.aggregationTemporality).toBe(
    expected.aggregationTemporality ?? undefined,
  );
  expect(entry.isMonotonic).toBe(expected.isMonotonic ?? undefined);
}

beforeEach(() => {
  rows = [];
  const ingest: IngestTestMethods =
    OtelMetricsIngestService as unknown as IngestTestMethods;
  jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(ingest, method).mockResolvedValue(null);
  }
  jest
    .spyOn(ingest, "resolveTelemetryResource")
    .mockImplementation(async () => {
      return serviceMetadata();
    });
  useRules(noRules());
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

describe("normalizeAggregationTemporality: the wire-form contract", () => {
  type NormalizeCase = { label: string; input: unknown };

  const DELTA_INPUTS: Array<NormalizeCase> = [
    {
      label: "protobuf/gRPC enum name AGGREGATION_TEMPORALITY_DELTA",
      input: "AGGREGATION_TEMPORALITY_DELTA",
    },
    { label: "OTLP/JSON integer 1", input: 1 },
    { label: 'quoted integer "1"', input: "1" },
  ];

  const CUMULATIVE_INPUTS: Array<NormalizeCase> = [
    {
      label: "protobuf/gRPC enum name AGGREGATION_TEMPORALITY_CUMULATIVE",
      input: "AGGREGATION_TEMPORALITY_CUMULATIVE",
    },
    { label: "OTLP/JSON integer 2", input: 2 },
    { label: 'quoted integer "2"', input: "2" },
  ];

  /*
   * Everything else is "not declared". Several of these are LOOSELY equal to
   * 1 or 2 (true, [1], "01", " 1", "0x1", "1.0", an object whose toString is
   * the enum name) — they pin that matching stays strict and never falls
   * back to ==, Number() or parseInt coercion.
   */
  const UNRECOGNISED_INPUTS: Array<NormalizeCase> = [
    { label: "integer 0 (UNSPECIFIED)", input: 0 },
    { label: "negative zero", input: -0 },
    { label: 'quoted "0"', input: "0" },
    {
      label: "enum name AGGREGATION_TEMPORALITY_UNSPECIFIED",
      input: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
    },
    { label: "unknown future enum value 3", input: 3 },
    { label: 'quoted "3"', input: "3" },
    { label: "negative integer -1", input: -1 },
    { label: 'quoted "-1"', input: "-1" },
    { label: "fractional 1.5", input: 1.5 },
    { label: "fractional 2.5", input: 2.5 },
    { label: "NaN", input: NaN },
    { label: "Infinity", input: Infinity },
    { label: "-Infinity", input: -Infinity },
    { label: "null (JSON null)", input: null },
    { label: "undefined (key absent)", input: undefined },
    { label: "empty string", input: "" },
    { label: 'leading whitespace " 1"', input: " 1" },
    { label: 'trailing whitespace "2 "', input: "2 " },
    { label: 'zero-padded "01"', input: "01" },
    { label: 'decimal string "1.0"', input: "1.0" },
    { label: 'decimal string "2.0"', input: "2.0" },
    { label: 'hex string "0x1"', input: "0x1" },
    { label: 'lowercase "delta"', input: "delta" },
    { label: 'uppercase "DELTA"', input: "DELTA" },
    { label: 'storage name "Delta"', input: AggregationTemporality.Delta },
    { label: 'lowercase "cumulative"', input: "cumulative" },
    { label: 'uppercase "CUMULATIVE"', input: "CUMULATIVE" },
    {
      label: 'storage name "Cumulative"',
      input: AggregationTemporality.Cumulative,
    },
    {
      label: "lowercased enum name",
      input: "aggregation_temporality_delta",
    },
    {
      label: "enum name with leading whitespace",
      input: " AGGREGATION_TEMPORALITY_DELTA",
    },
    {
      label: "enum name with trailing whitespace",
      input: "AGGREGATION_TEMPORALITY_CUMULATIVE ",
    },
    { label: "enum name without its prefix", input: "TEMPORALITY_DELTA" },
    { label: "boolean true (loosely == 1)", input: true },
    { label: "boolean false (loosely == 0)", input: false },
    { label: "empty object", input: {} },
    { label: "wrapped object { value: 1 }", input: { value: 1 } },
    {
      label: "object whose toString() is the enum name",
      input: {
        toString: (): string => {
          return "AGGREGATION_TEMPORALITY_DELTA";
        },
      },
    },
    { label: "empty array", input: [] },
    { label: "array [1] (loosely == 1)", input: [1] },
    { label: "array [2] (loosely == 2)", input: [2] },
    {
      label: "array holding the enum name",
      input: ["AGGREGATION_TEMPORALITY_DELTA"],
    },
  ];

  test.each(DELTA_INPUTS)("$label -> Delta", (testCase: NormalizeCase) => {
    expect(
      OtelMetricsIngestService.normalizeAggregationTemporality(testCase.input),
    ).toBe(OtelAggregationTemporality.Delta);
  });

  test.each(CUMULATIVE_INPUTS)(
    "$label -> Cumulative",
    (testCase: NormalizeCase) => {
      expect(
        OtelMetricsIngestService.normalizeAggregationTemporality(
          testCase.input,
        ),
      ).toBe(OtelAggregationTemporality.Cumulative);
    },
  );

  test.each(UNRECOGNISED_INPUTS)(
    "$label -> undefined",
    (testCase: NormalizeCase) => {
      expect(
        OtelMetricsIngestService.normalizeAggregationTemporality(
          testCase.input,
        ),
      ).toBeUndefined();
    },
  );

  test("agrees with the shipped proto enum: each name and its number normalize alike", () => {
    /*
     * Derive the mapping from metrics.proto itself instead of re-typing it:
     * the integer an OTLP/JSON exporter sends and the name protobufjs /
     * proto-loader hand over must land on the same value, and the two
     * defined temporalities must land on the enum member of the same name.
     */
    const protoValues: Dictionary<number> = ProtoAggregationTemporality.values;
    expect(protoValues).toEqual({
      AGGREGATION_TEMPORALITY_UNSPECIFIED: 0,
      AGGREGATION_TEMPORALITY_DELTA: 1,
      AGGREGATION_TEMPORALITY_CUMULATIVE: 2,
    });

    for (const [name, value] of Object.entries(protoValues)) {
      const fromName: OtelAggregationTemporality | undefined =
        OtelMetricsIngestService.normalizeAggregationTemporality(name);
      const fromNumber: OtelAggregationTemporality | undefined =
        OtelMetricsIngestService.normalizeAggregationTemporality(value);
      expect(fromNumber).toBe(fromName);
      expect(fromName).toBe(
        name === "AGGREGATION_TEMPORALITY_UNSPECIFIED"
          ? undefined
          : (name as OtelAggregationTemporality),
      );
    }
  });

  test("every OtelAggregationTemporality member is accepted as itself", () => {
    const members: Array<OtelAggregationTemporality> = Object.values(
      OtelAggregationTemporality,
    );
    // A new member would need its own wire mapping — fail loudly here.
    expect(members.sort()).toEqual([
      "AGGREGATION_TEMPORALITY_CUMULATIVE",
      "AGGREGATION_TEMPORALITY_DELTA",
    ]);
    for (const member of members) {
      expect(
        OtelMetricsIngestService.normalizeAggregationTemporality(member),
      ).toBe(member);
    }
  });

  test("always yields an OTel enum member or undefined, and is idempotent", () => {
    const allowed: Array<OtelAggregationTemporality | undefined> = [
      OtelAggregationTemporality.Delta,
      OtelAggregationTemporality.Cumulative,
      undefined,
    ];
    for (const testCase of [
      ...DELTA_INPUTS,
      ...CUMULATIVE_INPUTS,
      ...UNRECOGNISED_INPUTS,
    ]) {
      const once: OtelAggregationTemporality | undefined =
        OtelMetricsIngestService.normalizeAggregationTemporality(
          testCase.input,
        );
      expect(allowed).toContain(once);
      expect(
        OtelMetricsIngestService.normalizeAggregationTemporality(once),
      ).toBe(once);
    }
  });
});

describe("temporal metric kinds: every wire form reaches the row and the catalog", () => {
  type WireForm = {
    label: string;
    wire: number | string;
    expected: AggregationTemporality;
  };

  type TemporalCase = WireForm & { kind: TemporalKind };

  const WIRE_FORMS: Array<WireForm> = [
    {
      label: "OTLP/JSON integer 1",
      wire: 1,
      expected: AggregationTemporality.Delta,
    },
    {
      label: 'quoted "1"',
      wire: "1",
      expected: AggregationTemporality.Delta,
    },
    {
      label: "enum name AGGREGATION_TEMPORALITY_DELTA",
      wire: "AGGREGATION_TEMPORALITY_DELTA",
      expected: AggregationTemporality.Delta,
    },
    {
      label: "OTLP/JSON integer 2",
      wire: 2,
      expected: AggregationTemporality.Cumulative,
    },
    {
      label: 'quoted "2"',
      wire: "2",
      expected: AggregationTemporality.Cumulative,
    },
    {
      label: "enum name AGGREGATION_TEMPORALITY_CUMULATIVE",
      wire: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      expected: AggregationTemporality.Cumulative,
    },
  ];

  const TEMPORAL_KINDS: Array<TemporalKind> = [
    "sum",
    "histogram",
    "exponentialHistogram",
  ];

  const TEMPORAL_CASES: Array<TemporalCase> = TEMPORAL_KINDS.flatMap(
    (kind: TemporalKind) => {
      return WIRE_FORMS.map((form: WireForm) => {
        return { ...form, kind: kind };
      });
    },
  );

  test.each(TEMPORAL_CASES)(
    "$kind with $label is stored as $expected",
    async (testCase: TemporalCase) => {
      await ingestMetrics([
        makeMetric({
          name: "wire.metric",
          kind: testCase.kind,
          temporality: testCase.wire,
          points: 3,
        }),
      ]);

      // No isMonotonic on the wire: the flag stays undeclared.
      expectMetricStored(
        "wire.metric",
        {
          metricPointType: POINT_TYPE_BY_KIND[testCase.kind],
          aggregationTemporality: testCase.expected,
          isMonotonic: null,
        },
        3,
      );
      expect(rowsNamed("wire.metric")[0]).toMatchObject(
        ROW_FINGERPRINT_BY_KIND[testCase.kind],
      );
    },
  );

  test("the integer form and the enum-name form store identical rows", async () => {
    await ingestResources([
      resource([
        makeMetric({
          name: "json.form",
          kind: "sum",
          temporality: 2,
          isMonotonic: true,
        }),
      ]),
      resource([
        makeMetric({
          name: "proto.form",
          kind: "sum",
          temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
          isMonotonic: true,
        }),
      ]),
    ]);

    const strip: (row: JSONObject) => JSONObject = (
      row: JSONObject,
    ): JSONObject => {
      // Everything except the per-row identity and the metric's own name.
      const copy: JSONObject = { ...row };
      delete copy["_id"];
      delete copy["createdAt"];
      delete copy["retentionDate"];
      delete copy["name"];
      return copy;
    };

    expect(rowsNamed("json.form")).toHaveLength(1);
    expect(rowsNamed("proto.form")).toHaveLength(1);
    expect(strip(rowsNamed("json.form")[0]!)).toEqual(
      strip(rowsNamed("proto.form")[0]!),
    );
    expect(rowsNamed("json.form")[0]!["aggregationTemporality"]).toBe(
      AggregationTemporality.Cumulative,
    );
  });
});

describe("kinds that carry no temporality", () => {
  test.each([
    { kind: "gauge" as MetricKind },
    { kind: "summary" as MetricKind },
  ])(
    "$kind rows store null temporality and isMonotonic, and leave the catalog undeclared",
    async (testCase: { kind: MetricKind }) => {
      await ingestMetrics([
        makeMetric({ name: "untyped.metric", kind: testCase.kind, points: 2 }),
      ]);

      expectMetricStored(
        "untyped.metric",
        {
          metricPointType: POINT_TYPE_BY_KIND[testCase.kind],
          aggregationTemporality: null,
          isMonotonic: null,
        },
        2,
      );
      expect(rowsNamed("untyped.metric")[0]).toMatchObject(
        ROW_FINGERPRINT_BY_KIND[testCase.kind],
      );
    },
  );
});

describe("unspecified, unknown and malformed temporality", () => {
  type UnspecifiedCase = { label: string; wire: unknown };

  const UNSPECIFIED_CASES: Array<UnspecifiedCase> = [
    { label: "OTLP/JSON integer 0", wire: 0 },
    { label: 'quoted "0"', wire: "0" },
    {
      label: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
      wire: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
    },
    { label: "unknown future enum value 3", wire: 3 },
    { label: 'lowercase "delta"', wire: "delta" },
    { label: "JSON null", wire: null },
    { label: "boolean true", wire: true },
    { label: "array [1]", wire: [1] },
    { label: "fractional 1.5", wire: 1.5 },
    { label: "an absent key", wire: undefined },
  ];

  test.each(UNSPECIFIED_CASES)(
    "$label: the row stores null, the catalog stays undeclared, the rest of the metric is intact",
    async (testCase: UnspecifiedCase) => {
      await ingestMetrics([
        makeMetric({
          name: "unspecified.sum",
          kind: "sum",
          temporality: testCase.wire,
          isMonotonic: true,
          points: 2,
        }),
      ]);

      expectMetricStored(
        "unspecified.sum",
        {
          metricPointType: MetricPointType.Sum,
          aggregationTemporality: null,
          isMonotonic: true,
        },
        2,
      );
      expect(rowsNamed("unspecified.sum")[0]).toMatchObject(
        ROW_FINGERPRINT_BY_KIND.sum,
      );
    },
  );

  test.each(UNSPECIFIED_CASES)(
    "$label after an explicit Cumulative in the same batch does not overwrite the catalog",
    async (testCase: UnspecifiedCase) => {
      await ingestResources([
        resource([
          makeMetric({
            name: "requests.total",
            kind: "sum",
            temporality: 2,
            isMonotonic: true,
          }),
        ]),
        // No isMonotonic either: both catalog flags must survive.
        resource([
          makeMetric({
            name: "requests.total",
            kind: "sum",
            temporality: testCase.wire,
          }),
        ]),
      ]);

      expect(rowsNamed("requests.total").map(semantics)).toEqual([
        {
          metricPointType: MetricPointType.Sum,
          aggregationTemporality: AggregationTemporality.Cumulative,
          isMonotonic: true,
        },
        {
          metricPointType: MetricPointType.Sum,
          aggregationTemporality: null,
          isMonotonic: null,
        },
      ]);
      expect(catalogEntry("requests.total").aggregationTemporality).toBe(
        AggregationTemporality.Cumulative,
      );
      expect(catalogEntry("requests.total").isMonotonic).toBe(true);
    },
  );

  test("an explicit temporality after an unspecified one still wins", async () => {
    await ingestMetrics([
      makeMetric({ name: "requests.total", kind: "sum", temporality: 0 }),
      makeMetric({
        name: "requests.total",
        kind: "sum",
        temporality: 1,
        isMonotonic: false,
      }),
    ]);

    expect(
      rowsNamed("requests.total").map((row: JSONObject) => {
        return row["aggregationTemporality"];
      }),
    ).toEqual([null, AggregationTemporality.Delta]);
    expect(catalogEntry("requests.total").aggregationTemporality).toBe(
      AggregationTemporality.Delta,
    );
    expect(catalogEntry("requests.total").isMonotonic).toBe(false);
  });

  test("a metric only ever seen with UNSPECIFIED never gets a catalog temporality", async () => {
    await ingestMetrics([
      makeMetric({
        name: "legacy.counter",
        kind: "sum",
        temporality: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
      }),
      makeMetric({ name: "legacy.counter", kind: "sum", temporality: 0 }),
    ]);

    expect(rowsNamed("legacy.counter")).toHaveLength(2);
    expect(
      catalogEntry("legacy.counter").aggregationTemporality,
    ).toBeUndefined();
    expect(catalogEntry("legacy.counter").isMonotonic).toBeUndefined();
  });
});

describe("isMonotonic travels alongside temporality", () => {
  type MonotonicCase = {
    wire: number | string;
    isMonotonic: boolean;
    expected: AggregationTemporality;
  };

  const MONOTONIC_CASES: Array<MonotonicCase> = [
    { wire: 1, isMonotonic: true, expected: AggregationTemporality.Delta },
    { wire: 1, isMonotonic: false, expected: AggregationTemporality.Delta },
    { wire: 2, isMonotonic: true, expected: AggregationTemporality.Cumulative },
    {
      wire: 2,
      isMonotonic: false,
      expected: AggregationTemporality.Cumulative,
    },
    {
      wire: "AGGREGATION_TEMPORALITY_DELTA",
      isMonotonic: false,
      expected: AggregationTemporality.Delta,
    },
    {
      wire: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      isMonotonic: true,
      expected: AggregationTemporality.Cumulative,
    },
  ];

  test.each(MONOTONIC_CASES)(
    "sum temporality $wire with isMonotonic $isMonotonic keeps both",
    async (testCase: MonotonicCase) => {
      await ingestMetrics([
        makeMetric({
          name: "counter",
          kind: "sum",
          temporality: testCase.wire,
          isMonotonic: testCase.isMonotonic,
          points: 2,
        }),
      ]);

      expectMetricStored(
        "counter",
        {
          metricPointType: MetricPointType.Sum,
          aggregationTemporality: testCase.expected,
          isMonotonic: testCase.isMonotonic,
        },
        2,
      );
    },
  );

  test("an omitted isMonotonic (proto3 drops a false bool) stores null without touching temporality", async () => {
    await ingestMetrics([
      makeMetric({ name: "updown", kind: "sum", temporality: 2 }),
    ]);

    expectMetricStored(
      "updown",
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: null,
      },
      1,
    );
  });
});

describe("mixed batches keep each metric's own temporality", () => {
  const MIXED_EXPECTED: Dictionary<RowSemantics> = {
    "mix.requests": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: AggregationTemporality.Delta,
      isMonotonic: true,
    },
    "mix.bytes": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: AggregationTemporality.Cumulative,
      isMonotonic: true,
    },
    "mix.inflight": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: AggregationTemporality.Cumulative,
      isMonotonic: false,
    },
    "mix.latency": {
      metricPointType: MetricPointType.Histogram,
      aggregationTemporality: AggregationTemporality.Delta,
      isMonotonic: null,
    },
    "mix.size": {
      metricPointType: MetricPointType.ExponentialHistogram,
      aggregationTemporality: AggregationTemporality.Cumulative,
      isMonotonic: null,
    },
    "mix.temperature": {
      metricPointType: MetricPointType.Gauge,
      aggregationTemporality: null,
      isMonotonic: null,
    },
    "mix.gc": {
      metricPointType: MetricPointType.Summary,
      aggregationTemporality: null,
      isMonotonic: null,
    },
    "mix.legacy": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: null,
      isMonotonic: null,
    },
  };

  // Integer and enum-name wire forms deliberately interleaved.
  function mixedMetrics(points: number): Array<JSONObject> {
    return [
      makeMetric({
        name: "mix.requests",
        kind: "sum",
        temporality: 1,
        isMonotonic: true,
        points,
      }),
      makeMetric({
        name: "mix.bytes",
        kind: "sum",
        temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
        isMonotonic: true,
        points,
      }),
      makeMetric({
        name: "mix.inflight",
        kind: "sum",
        temporality: 2,
        isMonotonic: false,
        points,
      }),
      makeMetric({
        name: "mix.latency",
        kind: "histogram",
        temporality: "AGGREGATION_TEMPORALITY_DELTA",
        points,
      }),
      makeMetric({
        name: "mix.size",
        kind: "exponentialHistogram",
        temporality: 2,
        points,
      }),
      makeMetric({ name: "mix.temperature", kind: "gauge", points }),
      makeMetric({ name: "mix.gc", kind: "summary", points }),
      makeMetric({ name: "mix.legacy", kind: "sum", temporality: 0, points }),
    ];
  }

  function expectMixedStored(points: number): void {
    expect(rows).toHaveLength(Object.keys(MIXED_EXPECTED).length * points);
    for (const [name, expected] of Object.entries(MIXED_EXPECTED)) {
      expectMetricStored(name, expected, points);
    }
  }

  test("one scope, many kinds and wire forms, several datapoints each", async () => {
    await ingestMetrics(mixedMetrics(3));

    expectMixedStored(3);
  });

  test("the same metrics spread across resources and scopes", async () => {
    const metrics: Array<JSONObject> = mixedMetrics(2);
    await ingestResources([
      resourceWithScopes([[metrics[0]!, metrics[5]!], [metrics[3]!]]),
      resourceWithScopes([[metrics[1]!], [metrics[6]!, metrics[2]!]]),
      resourceWithScopes([[metrics[7]!, metrics[4]!]]),
    ]);

    expectMixedStored(2);
  });

  test.each([
    {
      first: 1,
      second: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      firstStored: AggregationTemporality.Delta,
      last: AggregationTemporality.Cumulative,
    },
    {
      first: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      second: 1,
      firstStored: AggregationTemporality.Cumulative,
      last: AggregationTemporality.Delta,
    },
  ])(
    "one name seen as $first then $second: rows keep their own, the catalog takes the last",
    async (testCase: {
      first: number | string;
      second: number | string;
      firstStored: AggregationTemporality;
      last: AggregationTemporality;
    }) => {
      await ingestResources([
        resource([
          makeMetric({
            name: "requests.total",
            kind: "sum",
            temporality: testCase.first,
          }),
        ]),
        resource([
          makeMetric({
            name: "requests.total",
            kind: "sum",
            temporality: testCase.second,
          }),
        ]),
      ]);

      expect(
        rowsNamed("requests.total").map((row: JSONObject) => {
          return row["aggregationTemporality"];
        }),
      ).toEqual([testCase.firstStored, testCase.last]);
      expect(catalogEntry("requests.total").aggregationTemporality).toBe(
        testCase.last,
      );
    },
  );

  test("a metric larger than one fan-in flush keeps its temporality on every row", async () => {
    const points: number = TELEMETRY_METRIC_FLUSH_BATCH_SIZE + 7;
    await ingestMetrics([
      makeMetric({
        name: "big.delta",
        kind: "sum",
        temporality: 1,
        isMonotonic: true,
        points,
      }),
      makeMetric({
        name: "small.cumulative",
        kind: "histogram",
        temporality: 2,
      }),
    ]);

    // The buffer flushed mid-metric at least once.
    expect(
      (TelemetryFanInWriter.submit as unknown as jest.Mock).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expectMetricStored(
      "big.delta",
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: true,
      },
      points,
    );
    expectMetricStored(
      "small.cumulative",
      {
        metricPointType: MetricPointType.Histogram,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: null,
      },
      1,
    );
  });
});

describe("normalization happens once, at the read site", () => {
  function readSiteBatch(): Array<JSONObject> {
    return [
      makeMetric({ name: "a.sum", kind: "sum", temporality: 1, points: 4 }),
      makeMetric({
        name: "b.histogram",
        kind: "histogram",
        temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
        points: 3,
      }),
      makeMetric({ name: "c.gauge", kind: "gauge", points: 2 }),
      makeMetric({
        name: "d.expo",
        kind: "exponentialHistogram",
        temporality: 0,
        points: 2,
      }),
    ];
  }

  test("the normalizer runs once per metric with the raw wire value, not per datapoint", async () => {
    const normalize: jest.SpyInstance = jest.spyOn(
      OtelMetricsIngestService,
      "normalizeAggregationTemporality",
    );

    await ingestMetrics(readSiteBatch());

    expect(rows).toHaveLength(11);
    expect(normalize.mock.calls).toEqual([
      [1],
      ["AGGREGATION_TEMPORALITY_CUMULATIVE"],
      [undefined],
      [0],
    ]);
  });

  test("the deferred row completion only ever receives the normalized enum", async () => {
    const ingest: IngestTestMethods =
      OtelMetricsIngestService as unknown as IngestTestMethods;
    const completeMetricRow: jest.SpyInstance = jest.spyOn(
      ingest,
      "completeMetricRow",
    );

    await ingestMetrics(readSiteBatch());

    expect(
      completeMetricRow.mock.calls.map((call: Array<any>) => {
        return [call[0].evaluationRow.name, call[0].aggregationTemporality];
      }),
    ).toEqual([
      ["a.sum", OtelAggregationTemporality.Delta],
      ["a.sum", OtelAggregationTemporality.Delta],
      ["a.sum", OtelAggregationTemporality.Delta],
      ["a.sum", OtelAggregationTemporality.Delta],
      ["b.histogram", OtelAggregationTemporality.Cumulative],
      ["b.histogram", OtelAggregationTemporality.Cumulative],
      ["b.histogram", OtelAggregationTemporality.Cumulative],
      ["c.gauge", undefined],
      ["c.gauge", undefined],
      ["d.expo", undefined],
      ["d.expo", undefined],
    ]);
  });
});

describe("pipeline rules and the deferred row completion", () => {
  test("rules evaluate a row with no temporality; completion re-attaches it", async () => {
    const addAttribute: MetricPipelineRule = new MetricPipelineRule();
    addAttribute.ruleType = MetricPipelineRuleType.AddAttribute;
    addAttribute.addAttributeKey = "rule.touched";
    addAttribute.addAttributeValue = "yes";
    addAttribute.filters = [];
    useRules({ projectRules: [addAttribute], rulesByServiceId: new Map() });

    const applyRules: typeof MetricPipelineRuleService.applyRules =
      MetricPipelineRuleService.applyRules.bind(MetricPipelineRuleService);
    const evaluatedKeys: Array<Array<string>> = [];
    jest
      .spyOn(MetricPipelineRuleService, "applyRules")
      .mockImplementation(
        (...args: Parameters<typeof MetricPipelineRuleService.applyRules>) => {
          evaluatedKeys.push(Object.keys(args[0]).sort());
          return applyRules(...args);
        },
      );

    await ingestMetrics([
      makeMetric({
        name: "rules.delta",
        kind: "sum",
        temporality: 1,
        isMonotonic: true,
        points: 2,
      }),
      makeMetric({
        name: "rules.cumulative",
        kind: "exponentialHistogram",
        temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      }),
    ]);

    // The rule engine only ever sees the name / attribute slice of the row.
    expect(evaluatedKeys).toEqual([
      ["attributeKeys", "attributes", "name"],
      ["attributeKeys", "attributes", "name"],
      ["attributeKeys", "attributes", "name"],
    ]);
    expectMetricStored(
      "rules.delta",
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: true,
      },
      2,
    );
    expectMetricStored(
      "rules.cumulative",
      {
        metricPointType: MetricPointType.ExponentialHistogram,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: null,
      },
      1,
    );
    for (const row of rows) {
      expect((row["attributes"] as JSONObject)["rule.touched"]).toBe("yes");
    }
  });

  test("a renamed metric keeps its temporality and isMonotonic under the new name", async () => {
    const rename: MetricPipelineRule = metricNameRule({
      ruleType: MetricPipelineRuleType.RenameMetric,
      metricName: "http.requests",
    });
    rename.renameToKey = "http.requests.renamed";
    useRules({ projectRules: [rename], rulesByServiceId: new Map() });

    await ingestMetrics([
      makeMetric({
        name: "http.requests",
        kind: "sum",
        temporality: 1,
        isMonotonic: true,
        points: 2,
      }),
      makeMetric({
        name: "http.latency",
        kind: "histogram",
        temporality: 2,
      }),
    ]);

    expect(rowsNamed("http.requests")).toHaveLength(0);
    const renamed: Array<JSONObject> = rowsNamed("http.requests.renamed");
    expect(renamed).toHaveLength(2);
    for (const row of renamed) {
      expect(semantics(row)).toEqual({
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: true,
      });
      expect(row).toMatchObject(ROW_FINGERPRINT_BY_KIND.sum);
    }
    expect(rowsNamed("http.latency").map(semantics)).toEqual([
      {
        metricPointType: MetricPointType.Histogram,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: null,
      },
    ]);
  });

  test("a service-scoped rule keeps the temporality of the rows it transforms", async () => {
    const addAttribute: MetricPipelineRule = new MetricPipelineRule();
    addAttribute.ruleType = MetricPipelineRuleType.AddAttribute;
    addAttribute.addAttributeKey = "team";
    addAttribute.addAttributeValue = "payments";
    addAttribute.filters = [];
    useRules({
      projectRules: [],
      rulesByServiceId: new Map([[SERVICE_ID.toString(), [addAttribute]]]),
    });

    await ingestMetrics([
      makeMetric({
        name: "payments.total",
        kind: "sum",
        temporality: 2,
        isMonotonic: true,
        points: 2,
      }),
    ]);

    expectMetricStored(
      "payments.total",
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: true,
      },
      2,
    );
    for (const row of rowsNamed("payments.total")) {
      expect((row["attributes"] as JSONObject)["team"]).toBe("payments");
    }
  });

  test("dropping one metric neither shifts nor leaks its temporality onto survivors", async () => {
    useRules({
      projectRules: [
        metricNameRule({
          ruleType: MetricPipelineRuleType.Drop,
          metricName: "drop.me",
        }),
      ],
      rulesByServiceId: new Map(),
    });
    const ingest: IngestTestMethods =
      OtelMetricsIngestService as unknown as IngestTestMethods;
    const completeMetricRow: jest.SpyInstance = jest.spyOn(
      ingest,
      "completeMetricRow",
    );

    await ingestMetrics([
      makeMetric({
        name: "drop.me",
        kind: "sum",
        temporality: 1,
        isMonotonic: true,
        points: 2,
      }),
      makeMetric({
        name: "keep.cumulative",
        kind: "sum",
        temporality: 2,
        isMonotonic: false,
        points: 2,
      }),
      makeMetric({
        name: "keep.delta.histogram",
        kind: "histogram",
        temporality: "AGGREGATION_TEMPORALITY_DELTA",
      }),
      makeMetric({ name: "keep.gauge", kind: "gauge" }),
    ]);

    expect(rowsNamed("drop.me")).toHaveLength(0);
    expect(rows).toHaveLength(4);
    expect(rowsNamed("keep.cumulative").map(semantics)).toEqual([
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: false,
      },
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: false,
      },
    ]);
    expect(rowsNamed("keep.delta.histogram").map(semantics)).toEqual([
      {
        metricPointType: MetricPointType.Histogram,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: null,
      },
    ]);
    expect(rowsNamed("keep.gauge").map(semantics)).toEqual([
      {
        metricPointType: MetricPointType.Gauge,
        aggregationTemporality: null,
        isMonotonic: null,
      },
    ]);
    // The dropped datapoints never reached the deferred completion.
    expect(
      completeMetricRow.mock.calls.map((call: Array<any>) => {
        return call[0].evaluationRow.name;
      }),
    ).toEqual([
      "keep.cumulative",
      "keep.cumulative",
      "keep.delta.histogram",
      "keep.gauge",
    ]);
  });

  test("an allow-list Filter keeps only the matching metric, with its temporality", async () => {
    useRules({
      projectRules: [
        metricNameRule({
          ruleType: MetricPipelineRuleType.Filter,
          metricName: "keep.me",
        }),
      ],
      rulesByServiceId: new Map(),
    });

    await ingestMetrics([
      makeMetric({ name: "other.cumulative", kind: "sum", temporality: 2 }),
      makeMetric({
        name: "keep.me",
        kind: "exponentialHistogram",
        temporality: 1,
        points: 2,
      }),
      makeMetric({ name: "other.gauge", kind: "gauge" }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rowsNamed("keep.me").map(semantics)).toEqual([
      {
        metricPointType: MetricPointType.ExponentialHistogram,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: null,
      },
      {
        metricPointType: MetricPointType.ExponentialHistogram,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: null,
      },
    ]);
  });

  test("a 100% Sample rule keeps every row with its temporality", async () => {
    const sample: MetricPipelineRule = new MetricPipelineRule();
    sample.ruleType = MetricPipelineRuleType.Sample;
    sample.samplePercentage = 100;
    sample.filters = [];
    useRules({ projectRules: [sample], rulesByServiceId: new Map() });

    await ingestMetrics([
      makeMetric({
        name: "sampled.delta",
        kind: "sum",
        temporality: "AGGREGATION_TEMPORALITY_DELTA",
        isMonotonic: true,
        points: 3,
      }),
    ]);

    expectMetricStored(
      "sampled.delta",
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: true,
      },
      3,
    );
  });

  test("when rules fail to load, the unruled path still stores the temporality", async () => {
    jest
      .spyOn(MetricPipelineRuleService, "loadRules")
      .mockRejectedValue(new Error("Postgres unavailable"));
    const applyRules: jest.SpyInstance = jest.spyOn(
      MetricPipelineRuleService,
      "applyRules",
    );

    await ingestMetrics([
      makeMetric({
        name: "norules.delta",
        kind: "sum",
        temporality: 1,
        isMonotonic: true,
      }),
      makeMetric({
        name: "norules.cumulative",
        kind: "histogram",
        temporality: 2,
      }),
    ]);

    expect(applyRules).not.toHaveBeenCalled();
    expectMetricStored(
      "norules.delta",
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: true,
      },
      1,
    );
    expectMetricStored(
      "norules.cumulative",
      {
        metricPointType: MetricPointType.Histogram,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: null,
      },
      1,
    );
  });
});

describe("synthetic host heartbeat (the one-shot row builder)", () => {
  test("the heartbeat stays an undeclared gauge while the host's counter is Delta", async () => {
    await ingestResources([
      resource(
        [
          makeMetric({
            name: "system.network.io",
            kind: "sum",
            temporality: 1,
            isMonotonic: true,
          }),
        ],
        "temporality-host",
      ),
    ]);

    expect(rows).toHaveLength(2);
    expect(rowsNamed(HEARTBEAT_METRIC_NAME).map(semantics)).toEqual([
      {
        metricPointType: MetricPointType.Gauge,
        aggregationTemporality: null,
        isMonotonic: null,
      },
    ]);
    expect(catalogEntry(HEARTBEAT_METRIC_NAME).aggregationTemporality).toBe(
      undefined,
    );
    expect(catalogEntry(HEARTBEAT_METRIC_NAME).isMonotonic).toBe(undefined);
    expectMetricStored(
      "system.network.io",
      {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: true,
      },
      1,
    );
  });
});

describe("stored row shape", () => {
  test("aggregationTemporality is always 'Delta' | 'Cumulative' | null, in its historical column position", async () => {
    await ingestResources([
      resource(
        [
          makeMetric({ name: "shape.delta", kind: "sum", temporality: 1 }),
          makeMetric({
            name: "shape.cumulative",
            kind: "histogram",
            temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
          }),
          makeMetric({
            name: "shape.unspecified",
            kind: "sum",
            temporality: 0,
          }),
          makeMetric({ name: "shape.gauge", kind: "gauge" }),
        ],
        "shape-host",
      ),
    ]);

    expect(rows).toHaveLength(5);
    const seen: Set<unknown> = new Set();
    for (const row of rows) {
      const keys: Array<string> = Object.keys(row);
      expect(keys.indexOf("aggregationTemporality")).toBe(
        keys.indexOf("metricPointType") + 1,
      );
      expect(keys.indexOf("isMonotonic")).toBe(
        keys.indexOf("aggregationTemporality") + 1,
      );
      expect([
        AggregationTemporality.Delta,
        AggregationTemporality.Cumulative,
        null,
      ]).toContain(row["aggregationTemporality"]);
      seen.add(row["aggregationTemporality"]);
    }
    expect(seen).toEqual(
      new Set([
        AggregationTemporality.Delta,
        AggregationTemporality.Cumulative,
        null,
      ]),
    );
  });
});

describe("MetricType persistence across batches (the real catalog writer)", () => {
  type ScalarUpdate = { id: ObjectID; data: Record<string, unknown> };

  let existingRow: MetricType | null;
  let creates: Array<MetricType>;
  let scalarUpdates: Array<ScalarUpdate>;
  let relationWrites: Array<unknown>;

  function storedMetricType(
    name: string,
    overrides: Partial<MetricType>,
  ): MetricType {
    const row: MetricType = new MetricType();
    row.id = METRIC_TYPE_ID;
    row._id = METRIC_TYPE_ID.toString();
    row.name = name;
    // Matches what makeMetric sends, so only counter semantics can differ.
    row.description = `${name} description`;
    row.unit = "1";
    const service: Service = new Service();
    service.id = SERVICE_ID;
    row.services = [service];
    return Object.assign(row, overrides);
  }

  beforeEach(() => {
    existingRow = null;
    creates = [];
    scalarUpdates = [];
    relationWrites = [];

    // Run the real writer, with the fence open and Postgres mocked.
    indexCatalog.mockRestore();
    jest.spyOn(GlobalCache, "setStringIfChanged").mockResolvedValue(true);
    jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);
    jest.spyOn(MetricTypeService, "findOneBy").mockImplementation(async () => {
      return existingRow;
    });
    jest
      .spyOn(MetricTypeService, "create")
      .mockImplementation(async (input: { data: MetricType }) => {
        creates.push(input.data);
        return input.data;
      });
    jest
      .spyOn(MetricTypeService, "updateColumnsByIdWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        scalarUpdates.push({
          id: input.id,
          data: { ...(input.data as Record<string, unknown>) },
        });
      });
    jest
      .spyOn(MetricTypeService, "attachServices")
      .mockImplementation(async (input: unknown) => {
        relationWrites.push(input);
      });
    jest
      .spyOn(MetricTypeService, "updateOneById")
      .mockImplementation(async (input: unknown) => {
        relationWrites.push(input);
        return 1;
      });
  });

  test("first sight of an OTLP/JSON cumulative monotonic counter creates it as a counter", async () => {
    await ingestMetrics([
      makeMetric({
        name: "http.server.requests",
        kind: "sum",
        temporality: 2,
        isMonotonic: true,
      }),
    ]);

    expect(creates).toHaveLength(1);
    expect(creates[0]!.name).toBe("http.server.requests");
    expect(creates[0]!.aggregationTemporality).toBe(
      AggregationTemporality.Cumulative,
    );
    expect(creates[0]!.isMonotonic).toBe(true);
    expect(scalarUpdates).toHaveLength(0);
  });

  test("first sight of an OTLP/JSON delta histogram creates it as Delta", async () => {
    await ingestMetrics([
      makeMetric({
        name: "http.server.duration",
        kind: "histogram",
        temporality: 1,
      }),
    ]);

    expect(creates).toHaveLength(1);
    expect(creates[0]!.aggregationTemporality).toBe(
      AggregationTemporality.Delta,
    );
    expect(creates[0]!.isMonotonic).toBeUndefined();
  });

  test.each([
    { label: "integer 0", wire: 0 as unknown },
    {
      label: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
      wire: "AGGREGATION_TEMPORALITY_UNSPECIFIED" as unknown,
    },
    { label: "an absent key", wire: undefined as unknown },
  ])(
    "a stored Cumulative counter is not cleared by a later batch with $label",
    async (testCase: { label: string; wire: unknown }) => {
      existingRow = storedMetricType("http.server.requests", {
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: true,
      });

      await ingestMetrics([
        makeMetric({
          name: "http.server.requests",
          kind: "sum",
          temporality: testCase.wire,
        }),
      ]);

      expect(
        rowsNamed("http.server.requests")[0]!["aggregationTemporality"],
      ).toBe(null);
      expect(scalarUpdates).toHaveLength(0);
      expect(creates).toHaveLength(0);
      expect(relationWrites).toHaveLength(0);
    },
  );

  test("switching an exporter between protobuf and JSON encoding does not churn the stored row", async () => {
    existingRow = storedMetricType("http.server.requests", {
      aggregationTemporality: AggregationTemporality.Cumulative,
      isMonotonic: true,
    });

    await ingestMetrics([
      makeMetric({
        name: "http.server.requests",
        kind: "sum",
        temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
        isMonotonic: true,
      }),
    ]);
    await ingestMetrics([
      makeMetric({
        name: "http.server.requests",
        kind: "sum",
        temporality: 2,
        isMonotonic: true,
      }),
    ]);

    expect(scalarUpdates).toHaveLength(0);
    expect(creates).toHaveLength(0);
    expect(relationWrites).toHaveLength(0);
  });

  test("a real change of temporality arriving as an integer is written", async () => {
    existingRow = storedMetricType("http.server.requests", {
      aggregationTemporality: AggregationTemporality.Cumulative,
      isMonotonic: true,
    });

    await ingestMetrics([
      makeMetric({
        name: "http.server.requests",
        kind: "sum",
        temporality: 1,
        isMonotonic: true,
      }),
    ]);

    expect(scalarUpdates).toEqual([
      {
        id: METRIC_TYPE_ID,
        data: { aggregationTemporality: AggregationTemporality.Delta },
      },
    ]);
    expect(creates).toHaveLength(0);
  });
});

describe("each wire format end to end: enqueue -> staged body -> worker decode -> ingest", () => {
  let stagedBodies: Map<string, Buffer>;
  let enqueuedJobs: Array<TelemetryIngestJobData>;

  /*
   * One logical OTLP export, written in its canonical OTLP/JSON form (enum
   * values as integers, int64 as strings). The protobuf and gRPC fixtures
   * are encoded FROM this object, so every transport carries the same
   * metrics and must store the same rows.
   */
  const WIRE_PAYLOAD: JSONObject = {
    resourceMetrics: [
      resource([
        makeMetric({
          name: "wire.requests",
          kind: "sum",
          temporality: 1,
          isMonotonic: true,
        }),
        makeMetric({
          name: "wire.connections",
          kind: "sum",
          temporality: 2,
          isMonotonic: false,
        }),
        makeMetric({
          name: "wire.latency",
          kind: "histogram",
          temporality: 2,
        }),
        makeMetric({
          name: "wire.payload.size",
          kind: "exponentialHistogram",
          temporality: 1,
        }),
        makeMetric({ name: "wire.temperature", kind: "gauge" }),
        makeMetric({ name: "wire.gc.pause", kind: "summary" }),
        makeMetric({ name: "wire.legacy", kind: "sum", temporality: 0 }),
        makeMetric({ name: "wire.future", kind: "sum", temporality: 3 }),
      ]),
    ],
  };

  const WIRE_EXPECTED: Dictionary<RowSemantics> = {
    "wire.requests": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: AggregationTemporality.Delta,
      isMonotonic: true,
    },
    "wire.connections": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: AggregationTemporality.Cumulative,
      isMonotonic: false,
    },
    "wire.latency": {
      metricPointType: MetricPointType.Histogram,
      aggregationTemporality: AggregationTemporality.Cumulative,
      isMonotonic: null,
    },
    "wire.payload.size": {
      metricPointType: MetricPointType.ExponentialHistogram,
      aggregationTemporality: AggregationTemporality.Delta,
      isMonotonic: null,
    },
    "wire.temperature": {
      metricPointType: MetricPointType.Gauge,
      aggregationTemporality: null,
      isMonotonic: null,
    },
    "wire.gc.pause": {
      metricPointType: MetricPointType.Summary,
      aggregationTemporality: null,
      isMonotonic: null,
    },
    "wire.legacy": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: null,
      isMonotonic: null,
    },
    "wire.future": {
      metricPointType: MetricPointType.Sum,
      aggregationTemporality: null,
      isMonotonic: null,
    },
  };

  const WIRE_KIND_BY_NAME: Dictionary<MetricKind> = {
    "wire.requests": "sum",
    "wire.connections": "sum",
    "wire.latency": "histogram",
    "wire.payload.size": "exponentialHistogram",
    "wire.temperature": "gauge",
    "wire.gc.pause": "summary",
    "wire.legacy": "sum",
    "wire.future": "sum",
  };

  function protobufBytes(): Buffer {
    return Buffer.from(
      ExportMetricsServiceRequest.encode(
        ExportMetricsServiceRequest.fromObject(WIRE_PAYLOAD),
      ).finish(),
    );
  }

  function httpRequest(
    body: Buffer,
    headers: Record<string, string>,
  ): TelemetryRequest {
    return {
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
      headers: headers,
      body: body,
    } as unknown as TelemetryRequest;
  }

  type Transport = {
    label: string;
    format: OtelPayloadFormat;
    encoding: OtelPayloadEncoding;
    // What the worker's decode hands ingest for wire.requests (DELTA).
    decodedDelta: number | string;
    // What wire.legacy (UNSPECIFIED) and wire.future (3) decode to.
    decodedUnspecified: number | string;
    decodedFuture: number | string;
    enqueue: () => Promise<void>;
  };

  const TRANSPORTS: Array<Transport> = [
    {
      label: "OTLP/HTTP JSON",
      format: OtelPayloadFormat.Json,
      encoding: "none",
      decodedDelta: 1,
      decodedUnspecified: 0,
      decodedFuture: 3,
      enqueue: async () => {
        await MetricsQueueService.addMetricIngestJob(
          httpRequest(Buffer.from(JSON.stringify(WIRE_PAYLOAD)), {
            "content-type": "application/json",
          }),
        );
      },
    },
    {
      label: "OTLP/HTTP JSON, gzip",
      format: OtelPayloadFormat.Json,
      encoding: "gzip",
      decodedDelta: 1,
      decodedUnspecified: 0,
      decodedFuture: 3,
      enqueue: async () => {
        await MetricsQueueService.addMetricIngestJob(
          httpRequest(
            zlib.gzipSync(Buffer.from(JSON.stringify(WIRE_PAYLOAD))),
            {
              "content-type": "application/json",
              "content-encoding": "gzip",
            },
          ),
        );
      },
    },
    {
      label: "OTLP/HTTP protobuf",
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      decodedDelta: "AGGREGATION_TEMPORALITY_DELTA",
      decodedUnspecified: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
      decodedFuture: 3,
      enqueue: async () => {
        await MetricsQueueService.addMetricIngestJob(
          httpRequest(protobufBytes(), {
            "content-type": "application/x-protobuf",
          }),
        );
      },
    },
    {
      label: "OTLP/HTTP protobuf, gzip",
      format: OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      decodedDelta: "AGGREGATION_TEMPORALITY_DELTA",
      decodedUnspecified: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
      decodedFuture: 3,
      enqueue: async () => {
        await MetricsQueueService.addMetricIngestJob(
          httpRequest(zlib.gzipSync(protobufBytes()), {
            "content-type": "application/x-protobuf",
            "content-encoding": "gzip",
          }),
        );
      },
    },
    {
      label: "OTLP/gRPC",
      // The gRPC producer re-serializes the proto-loader object as JSON.
      format: OtelPayloadFormat.Json,
      encoding: "none",
      decodedDelta: "AGGREGATION_TEMPORALITY_DELTA",
      decodedUnspecified: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
      decodedFuture: 3,
      enqueue: async () => {
        const decoded: Record<string, unknown> =
          GRPC_METRICS_EXPORT.requestDeserialize(protobufBytes()) as Record<
            string,
            unknown
          >;
        await MetricsQueueService.addMetricIngestJob(
          buildTelemetryRequest(
            decoded,
            new grpc.Metadata(),
            PROJECT_ID,
            ProductType.Metrics,
          ),
        );
      },
    },
  ];

  // The worker half of ProcessTelemetry's Metrics case.
  async function runWorker(job: TelemetryIngestJobData): Promise<JSONObject> {
    const body: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: job.productType!,
      format: job.bodyFormat!,
      encoding: job.bodyEncoding ?? "none",
      bodyKey: job.bodyKey!,
    });
    const decodedWrappers: JSONObject = {};
    for (const metric of (
      (body["resourceMetrics"] as JSONArray)[0]!["scopeMetrics"] as JSONArray
    )[0]!["metrics"] as JSONArray) {
      const kind: MetricKind = WIRE_KIND_BY_NAME[metric["name"] as string]!;
      decodedWrappers[metric["name"] as string] = {
        ...(metric[kind] as JSONObject),
      };
    }
    await OtelMetricsIngestService.processMetricsFromQueue({
      projectId: new ObjectID(job.projectId!),
      body: body,
      headers: job.requestHeaders ?? {},
    } as unknown as TelemetryRequest);
    return decodedWrappers;
  }

  beforeEach(() => {
    stagedBodies = new Map();
    enqueuedJobs = [];
    jest
      .spyOn(TelemetryBodyStore, "storeBody")
      .mockImplementation(async (buffer: Buffer) => {
        const key: string = `telemetry:body:${ObjectID.generate().toString()}`;
        stagedBodies.set(key, buffer);
        return key;
      });
    jest
      .spyOn(TelemetryBodyStore, "readBody")
      .mockImplementation(async (key: string) => {
        return stagedBodies.get(key) ?? null;
      });
    jest
      .spyOn(Queue, "addJob")
      .mockImplementation(
        async (
          _queueName: QueueName,
          _jobId: string,
          _jobName: string,
          data: JSONObject,
        ) => {
          enqueuedJobs.push(data as unknown as TelemetryIngestJobData);
          return {} as Awaited<ReturnType<typeof Queue.addJob>>;
        },
      );
  });

  test.each(TRANSPORTS)(
    "$label: every metric lands with the same temporality and isMonotonic",
    async (transport: Transport) => {
      await transport.enqueue();

      expect(enqueuedJobs).toHaveLength(1);
      const job: TelemetryIngestJobData = enqueuedJobs[0]!;
      expect(job.productType).toBe(ProductType.Metrics);
      expect(job.bodyFormat).toBe(transport.format);
      expect(job.bodyEncoding).toBe(transport.encoding);

      const decoded: JSONObject = await runWorker(job);

      // The decoder handed ingest the wire form this transport is about.
      expect(
        (decoded["wire.requests"] as JSONObject)["aggregationTemporality"],
      ).toBe(transport.decodedDelta);
      expect(
        (decoded["wire.latency"] as JSONObject)["aggregationTemporality"],
      ).toBe(
        typeof transport.decodedDelta === "number"
          ? 2
          : "AGGREGATION_TEMPORALITY_CUMULATIVE",
      );
      expect(
        (decoded["wire.legacy"] as JSONObject)["aggregationTemporality"],
      ).toBe(transport.decodedUnspecified);
      expect(
        (decoded["wire.future"] as JSONObject)["aggregationTemporality"],
      ).toBe(transport.decodedFuture);

      expect(rows).toHaveLength(Object.keys(WIRE_EXPECTED).length);
      for (const [name, expected] of Object.entries(WIRE_EXPECTED)) {
        expectMetricStored(name, expected, 1);
        expect(rowsNamed(name)[0]).toMatchObject(
          ROW_FINGERPRINT_BY_KIND[WIRE_KIND_BY_NAME[name]!],
        );
      }
    },
  );
});
