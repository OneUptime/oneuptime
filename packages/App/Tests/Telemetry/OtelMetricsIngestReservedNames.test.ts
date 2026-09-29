import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import ObjectID from "Common/Types/ObjectID";
import SessionReplayBudgetMetricType from "Common/Types/Rum/SessionReplayBudgetMetricType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SessionReplayBudgetMetricTypeUtil from "Common/Utils/Rum/SessionReplayBudgetMetricType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Metric names under `oneuptime.rum.session.replay.` belong to OneUptime's
 * session replay budget sweep. Its rows are keyed to a RUM application
 * (primaryEntityType RealUserMonitor), the RUM alert templates watch them
 * and telemetry billing leaves them out by name - and a browser's OTLP batch
 * lands keyed to its RUM application in exactly the same way. So ingest must
 * refuse the prefix: a point any page sent under one of these names would
 * otherwise fire the customer's budget alerts and be stored unbilled.
 *
 * OTLP request -> the real metric walk, pipeline rules and row construction
 * -> the fan-in writer and the catalog writer, both captured. Discovery and
 * persistence are mocked, as in OtelMetricsIngestCatalog.test.ts.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

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

const DAILY_PERCENT: string =
  SessionReplayBudgetMetricType.ProjectDailyUsedPercent;

let metadataByName: Map<string, TelemetryServiceMetadata>;
let rows: Array<JSONObject>;
let indexCatalog: jest.SpyInstance;
let loadRules: jest.SpyInstance;

type IngestTestMethods = Record<string, any> & {
  resolveTelemetryResource: (data: {
    attributes: JSONArray;
  }) => Promise<TelemetryServiceMetadata>;
};

function gaugeMetric(
  name: string,
  data: { points?: number; unit?: string; description?: string } = {},
): JSONObject {
  return {
    name: name,
    description: data.description ?? `Description of ${name}`,
    unit: data.unit ?? "1",
    gauge: {
      dataPoints: Array.from({ length: data.points ?? 1 }, () => {
        return { asDouble: 85.5, timeUnixNano: `${Date.now()}000000` };
      }),
    },
  };
}

function resource(
  metrics: JSONArray,
  data: { entityId?: ObjectID; type?: ServiceType } = {},
): JSONObject {
  const id: ObjectID = data.entityId ?? SERVICE_ID;
  const type: ServiceType = data.type ?? ServiceType.OpenTelemetry;
  const name: string = `${type}/${id.toString()}`;

  metadataByName.set(name, {
    serviceName: name,
    primaryEntityId: id,
    primaryEntityType: type,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  return {
    resource: {
      attributes: [{ key: "service.name", value: { stringValue: name } }],
    },
    scopeMetrics: [{ metrics }],
  };
}

function request(resources: JSONArray): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: resources },
    headers: {},
  } as unknown as TelemetryRequest;
}

async function ingest(resources: JSONArray): Promise<void> {
  await OtelMetricsIngestService.processMetricsFromQueue(request(resources));
}

function rowNames(): Array<string> {
  return rows.map((row: JSONObject) => {
    return row["name"] as string;
  });
}

function catalogNames(): Array<string> {
  expect(indexCatalog).toHaveBeenCalledTimes(1);

  const catalog: Dictionary<MetricType> =
    indexCatalog.mock.calls[0]![0].metricNameServiceNameMap;

  return Object.keys(catalog).sort();
}

function renameRule(data: { from: string; to: string }): MetricRulesForProject {
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.ruleType = MetricPipelineRuleType.RenameMetric;
  rule.renameToKey = data.to;
  rule.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
      conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
      value: data.from,
    },
  ];

  return { projectRules: [rule], rulesByServiceId: new Map() };
}

beforeEach(() => {
  metadataByName = new Map();
  rows = [];

  const service: IngestTestMethods =
    OtelMetricsIngestService as unknown as IngestTestMethods;
  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  jest
    .spyOn(service, "resolveTelemetryResource")
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

  loadRules = jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });

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

describe("OTLP metric ingest refuses the session replay budget names", () => {
  test("a reserved name writes no row and no catalog entry, so a sent unit cannot replace the registered one", async () => {
    await ingest([
      resource([
        gaugeMetric(DAILY_PERCENT, {
          unit: "1",
          description: "Forged from a browser",
        }),
        gaugeMetric("requests.total"),
      ]),
    ]);

    expect(rowNames()).toEqual(["requests.total"]);
    expect(catalogNames()).toEqual(["requests.total"]);
  });

  test.each(SessionReplayBudgetMetricTypeUtil.getAll())(
    "refuses %s, a name the sweep itself writes",
    async (name: string) => {
      await ingest([
        resource([gaugeMetric(name, { points: 3 }), gaugeMetric("kept")]),
      ]);

      expect(rowNames()).toEqual(["kept"]);
      expect(catalogNames()).toEqual(["kept"]);
    },
  );

  test("refuses the whole prefix, not only today's four names", async () => {
    await ingest([
      resource([
        gaugeMetric("oneuptime.rum.session.replay.anything.else"),
        gaugeMetric(`${DAILY_PERCENT}.suffix`),
        gaugeMetric("kept"),
      ]),
    ]);

    expect(rowNames()).toEqual(["kept"]);
    expect(catalogNames()).toEqual(["kept"]);
  });

  test.each([
    "OneUptime.RUM.Session.Replay.Budget.Project.Daily.Used.Percent",
    "ONEUPTIME.RUM.SESSION.REPLAY.BUDGET.APPLICATION.MONTHLY.USED.BYTES",
    "oneuptime.Rum.session.REPLAY.whatever",
  ])(
    "refuses a mixed-case reserved name (%s): ingest lowercases names, so it would land on the same series",
    async (name: string) => {
      await ingest([resource([gaugeMetric(name), gaugeMetric("kept")])]);

      expect(rowNames()).toEqual(["kept"]);
      expect(catalogNames()).toEqual(["kept"]);
    },
  );

  test("a browser batch keyed to its RUM application keeps its web vitals and loses only the forged budget point", async () => {
    await ingest([
      resource(
        [
          gaugeMetric("web_vital.lcp", { points: 2 }),
          gaugeMetric(DAILY_PERCENT),
          gaugeMetric("web_vital.cls"),
        ],
        { entityId: RUM_APPLICATION_ID, type: ServiceType.RealUserMonitor },
      ),
    ]);

    expect(rowNames()).toEqual([
      "web_vital.lcp",
      "web_vital.lcp",
      "web_vital.cls",
    ]);
    for (const row of rows) {
      expect(row["primaryEntityId"]).toBe(RUM_APPLICATION_ID.toString());
      expect(row["primaryEntityType"]).toBe(ServiceType.RealUserMonitor);
    }
    expect(catalogNames()).toEqual(["web_vital.cls", "web_vital.lcp"]);
  });

  test("a batch of nothing but reserved names writes nothing at all", async () => {
    await ingest([
      resource([
        gaugeMetric(DAILY_PERCENT, { points: 2 }),
        gaugeMetric(SessionReplayBudgetMetricType.ProjectDailyUsedBytes),
      ]),
    ]);

    expect(rows).toHaveLength(0);
    // Nothing was processed, so the catalog writer is never reached.
    expect(indexCatalog).not.toHaveBeenCalled();
  });

  test("a batch mixing reserved and normal metrics across resources keeps every normal datapoint", async () => {
    const otherServiceId: ObjectID = ObjectID.generate();

    await ingest([
      resource([
        gaugeMetric(DAILY_PERCENT),
        gaugeMetric("http.server.duration", { points: 2 }),
      ]),
      resource(
        [
          gaugeMetric("queue.depth"),
          gaugeMetric(
            "OneUptime.Rum.Session.Replay.Budget.Application.Monthly.Used.Percent",
            { points: 4 },
          ),
          gaugeMetric("queue.lag", { points: 3 }),
        ],
        { entityId: otherServiceId },
      ),
    ]);

    expect(rowNames()).toEqual([
      "http.server.duration",
      "http.server.duration",
      "queue.depth",
      "queue.lag",
      "queue.lag",
      "queue.lag",
    ]);
    expect(catalogNames()).toEqual([
      "http.server.duration",
      "queue.depth",
      "queue.lag",
    ]);
  });
});

describe("metric pipeline rules cannot write into the reserved prefix", () => {
  test("a RenameMetric rule into the prefix drops the row", async () => {
    loadRules.mockResolvedValue(
      renameRule({ from: "custom.metric", to: DAILY_PERCENT }),
    );

    await ingest([
      resource([
        gaugeMetric("custom.metric", { points: 2 }),
        gaugeMetric("kept"),
      ]),
    ]);

    expect(rowNames()).toEqual(["kept"]);
    /*
     * The catalog lists names as they arrived, before any rule - so the
     * source name stays, as for every rename, and the reserved one never
     * appears.
     */
    expect(catalogNames()).toEqual(["custom.metric", "kept"]);
  });

  test("a mixed-case rename target is dropped too: rules set the name verbatim, not lowercased", async () => {
    loadRules.mockResolvedValue(
      renameRule({
        from: "custom.metric",
        to: "OneUptime.RUM.Session.Replay.Budget.Project.Daily.Used.Percent",
      }),
    );

    await ingest([
      resource([gaugeMetric("custom.metric"), gaugeMetric("kept")]),
    ]);

    expect(rowNames()).toEqual(["kept"]);
  });

  test("a rename that stays outside the prefix still lands, renamed", async () => {
    loadRules.mockResolvedValue(
      renameRule({ from: "custom.metric", to: "oneuptime.rum.custom.metric" }),
    );

    await ingest([resource([gaugeMetric("custom.metric", { points: 2 })])]);

    expect(rowNames()).toEqual([
      "oneuptime.rum.custom.metric",
      "oneuptime.rum.custom.metric",
    ]);
  });

  test("a rule cannot launder a reserved name: renaming it out of the prefix still refuses it", async () => {
    loadRules.mockResolvedValue(
      renameRule({ from: DAILY_PERCENT, to: "laundered.metric" }),
    );

    await ingest([resource([gaugeMetric(DAILY_PERCENT), gaugeMetric("kept")])]);

    expect(rowNames()).toEqual(["kept"]);
    expect(catalogNames()).toEqual(["kept"]);
  });
});

describe("nothing wider than the session replay prefix is reserved", () => {
  test.each([
    "oneuptime.rum.application.id",
    "oneuptime.llm.budget.percent.used",
    "oneuptime.host.heartbeat",
    "oneuptime.slo.error.budget.remaining",
    // The prefix ends in a dot: near misses are ordinary names.
    "oneuptime.rum.session.replay",
    "oneuptime.rum.session.replays.count",
    "oneuptime.rum.session.replayed",
    "custom.oneuptime.rum.session.replay.budget",
    "web_vital.lcp",
    "session.replay.budget.used",
  ])("keeps %s", async (name: string) => {
    await ingest([resource([gaugeMetric(name, { points: 2 })])]);

    expect(rowNames()).toEqual([name, name]);
    expect(catalogNames()).toEqual([name]);
  });

  test("keeps an ordinary name exactly as before, lowercased", async () => {
    await ingest([resource([gaugeMetric("OneUptime.RUM.Application.Load")])]);

    expect(rowNames()).toEqual(["oneuptime.rum.application.load"]);
    expect(catalogNames()).toEqual(["oneuptime.rum.application.load"]);
  });
});
