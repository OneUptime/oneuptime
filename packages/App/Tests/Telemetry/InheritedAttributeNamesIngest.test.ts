/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time; nothing queue-related is under test here.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

// See ServerlessFunctionNameStamp.test.ts: nothing password-related here.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import * as FilterEvaluator from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import ProfileService from "Common/Server/Services/ProfileService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Profile from "Common/Models/AnalyticsModels/Profile";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { readOwnValue } from "Common/Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #8025: an attribute named like what every object inherits, at OTLP
 * ingest, through to the rows the ClickHouse writer is handed and back.
 *
 * Every name an object inherits is a key a sender may write: an OTLP
 * attribute has no reserved names. A key named __proto__ was not stored:
 * TelemetryUtil.getAttributes assigned it (a string under it ignored, an
 * array under it made the map's prototype), the ingest services merged the
 * maps with Object.assign, which assigned it again, and each pipeline
 * processor copied the attributes with a spread, which compiles to
 * Object.assign. attributeKeys, listed from the merged map, did not name it
 * either. A metric named __proto__ did worse: the metric catalog read its
 * entry with a plain read, found the prototype every object shares, and
 * the ingest wrote the metric's counter semantics onto it.
 *
 * This suite runs the real signal walks and row builders, with the
 * persistence edges replaced: discovery, service resolution, pipeline and
 * rule loads, and the fan-in writer, which captures the rows. It then reads
 * each row as the ClickHouse insert sends it (JSON, JSONEachRow), as
 * ClickHouse answers (JSON.parse), as the row's model holds it, and as the
 * API's JSON writes it (the model's toJSON).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

// The keys Object.prototype holds now, to tell that nothing was written there.
const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();
const OBJECT_FUNCTION_KEYS: Array<string> =
  Object.getOwnPropertyNames(Object).sort();

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function nowNano(): string {
  return `${Date.now()}000000`;
}

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

// An attribute list with every inherited name, each holding its own text.
function everyInheritedName(prefix: string = "own"): JSONArray {
  return INHERITED_PROPERTY_NAMES.map((name: string): JSONObject => {
    return stringAttribute(name, `${prefix} ${name}`);
  });
}

function serviceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: "checkout",
    primaryEntityId: new ObjectID(SERVICE_ID.toString()),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

// The request as the queue worker hands it over: a decoded JSON body.
function telemetryRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: JSON.parse(JSON.stringify(body)) as JSONObject,
    headers: {},
  } as unknown as TelemetryRequest;
}

const RESOURCE: JSONArray = [stringAttribute("service.name", "checkout")];

function logsBody(attributes: JSONArray): JSONObject {
  return {
    resourceLogs: [
      {
        resource: { attributes: RESOURCE },
        scopeLogs: [
          {
            scope: { name: "inherited-names" },
            logRecords: [
              {
                timeUnixNano: nowNano(),
                severityNumber: 9,
                body: { stringValue: "request failed" },
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

function tracesBody(
  attributes: JSONArray,
  events: Array<JSONObject> = [],
): JSONObject {
  return {
    resourceSpans: [
      {
        resource: { attributes: RESOURCE },
        scopeSpans: [
          {
            scope: { name: "inherited-names" },
            spans: [
              {
                traceId: "5b8efff798038103d269b633813fc60c",
                spanId: "eee19b7ec3c1b174",
                parentSpanId: "",
                name: "GET /",
                kind: 2,
                startTimeUnixNano: nowNano(),
                endTimeUnixNano: nowNano(),
                status: { code: 1 },
                attributes,
                events,
                links: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

function metricsBody(
  attributes: JSONArray,
  name: string = "requests",
): JSONObject {
  return {
    resourceMetrics: [
      {
        resource: { attributes: RESOURCE },
        scopeMetrics: [
          {
            scope: { name: "inherited-names" },
            metrics: [
              {
                name,
                unit: "1",
                description: "Requests served.",
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      attributes,
                      startTimeUnixNano: nowNano(),
                      timeUnixNano: nowNano(),
                      asDouble: 3,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

// An older collector's profile container: its attributes beside it.
function profilesBody(attributes: JSONArray): JSONObject {
  return {
    resourceProfiles: [
      {
        resource: { attributes: RESOURCE },
        scopeProfiles: [
          {
            scope: { name: "inherited-names" },
            profiles: [
              {
                profileId: "AAAAAAAAAAAAAAAAAAAAAA==",
                startTimeUnixNano: nowNano(),
                endTimeUnixNano: nowNano(),
                attributes,
                profile: { stringTable: [""], sample: [] },
              },
            ],
          },
        ],
      },
    ],
  };
}

interface SignalCase {
  signal: string;
  target: FanInInsertTarget;
  model: { new (): AnalyticsBaseModel };
  run: (attributes: JSONArray) => Promise<void>;
}

const SIGNALS: ReadonlyArray<SignalCase> = [
  {
    signal: "a log record",
    target: LogService,
    model: Log as unknown as { new (): AnalyticsBaseModel },
    run: async (attributes: JSONArray): Promise<void> => {
      await OtelLogsIngestService.processLogsFromQueue(
        telemetryRequest(logsBody(attributes)),
      );
    },
  },
  {
    signal: "a span",
    target: SpanService,
    model: Span as unknown as { new (): AnalyticsBaseModel },
    run: async (attributes: JSONArray): Promise<void> => {
      await OtelTracesIngestService.processTracesFromQueue(
        telemetryRequest(tracesBody(attributes)),
      );
    },
  },
  {
    signal: "a metric data point",
    target: MetricService,
    model: Metric as unknown as { new (): AnalyticsBaseModel },
    run: async (attributes: JSONArray): Promise<void> => {
      await OtelMetricsIngestService.processMetricsFromQueue(
        telemetryRequest(metricsBody(attributes)),
      );
    },
  },
  {
    signal: "a profile",
    target: ProfileService,
    model: Profile as unknown as { new (): AnalyticsBaseModel },
    run: async (attributes: JSONArray): Promise<void> => {
      await OtelProfilesIngestService.processProfilesFromQueue(
        telemetryRequest(profilesBody(attributes)),
      );
    },
  },
];

let rowsByTarget: Map<FanInInsertTarget, Array<JSONObject>>;
let indexedCatalogs: Array<Dictionary<MetricType>>;
let loadedLogPipelines: Array<LoadedPipeline>;

function rowsFor(target: FanInInsertTarget): Array<JSONObject> {
  return rowsByTarget.get(target) || [];
}

function onlyRowFor(target: FanInInsertTarget): JSONObject {
  const rows: Array<JSONObject> = rowsFor(target);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

beforeEach(() => {
  rowsByTarget = new Map();
  indexedCatalogs = [];
  loadedLogPipelines = [];

  const discoveryMethods: Array<string> = Object.getOwnPropertyNames(
    OtelIngestBaseService,
  ).filter((property: string): boolean => {
    return (
      property.startsWith("autoDiscover") &&
      typeof baseService[property] === "function"
    );
  });

  for (const ingestService of [
    OtelTracesIngestService,
    OtelLogsIngestService,
    OtelMetricsIngestService,
    OtelProfilesIngestService,
  ]) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const service: Record<string, any> = ingestService as unknown as Record<
      string,
      any
    >;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    for (const method of discoveryMethods) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }
    jest
      .spyOn(service, "resolveTelemetryResource")
      .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
        return serviceMetadata();
      });
    if (ingestService === OtelMetricsIngestService) {
      jest
        .spyOn(service, "runBatchHostEnrichment")
        .mockResolvedValue(undefined);
    }
  }

  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(TraceScrubRuleService, "loadScrubRules").mockResolvedValue([]);
  jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockImplementation(async (): Promise<Array<LoadedPipeline>> => {
      return loadedLogPipelines;
    });
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue([]);
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        metricNameServiceNameMap: Dictionary<MetricType>;
      }): Promise<void> => {
        indexedCatalogs.push(data.metricNameServiceNameMap);
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        rowsByTarget.set(target, [...rowsFor(target), ...batch]);
        return { flushed: Promise.resolve() };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();

  // Whatever a case sent, nothing reached what every object shares.
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
  expect(Object.getOwnPropertyNames(Object).sort()).toEqual(
    OBJECT_FUNCTION_KEYS,
  );
});

/*
 * What a stored row's attributes say, read every way the row is read: as
 * the builder hands it to the writer, as the insert's JSON, as ClickHouse
 * answers it, as the row's model holds it and as the API writes it.
 */
function expectStored(
  signalCase: SignalCase,
  expected: ReadonlyArray<[string, unknown]>,
): void {
  const row: JSONObject = onlyRowFor(signalCase.target);
  const attributes: JSONObject = row["attributes"] as JSONObject;
  const attributeKeys: Array<string> = row["attributeKeys"] as Array<string>;

  expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);

  // JSONEachRow: the client writes each row with JSON.stringify.
  const sent: string = JSON.stringify(row);
  // ClickHouse's JSON answer, read back with JSON.parse.
  const readBack: JSONObject = JSON.parse(sent) as JSONObject;
  // The row's model, and the JSON an API answers with.
  const model: AnalyticsBaseModel = AnalyticsBaseModel.fromJSON(
    {
      attributes: readBack["attributes"],
      attributeKeys: readBack["attributeKeys"],
    } as JSONObject,
    signalCase.model,
  ) as AnalyticsBaseModel;
  const answered: JSONObject = JSON.parse(
    JSON.stringify(model.toJSON()),
  ) as JSONObject;

  for (const [name, value] of expected) {
    expect({
      name,
      built: readOwnValue(attributes, name),
      listed: attributeKeys.includes(name),
      readBack: readOwnValue(readBack["attributes"] as JSONObject, name),
      model: readOwnValue(
        model.getColumnValue("attributes") as JSONObject,
        name,
      ),
      answered: readOwnValue(answered["attributes"] as JSONObject, name),
      answeredKeys: (answered["attributeKeys"] as Array<string>).includes(name),
    }).toEqual({
      name,
      built: value,
      listed: true,
      readBack: value,
      model: value,
      answered: value,
      answeredKeys: true,
    });
  }
}

describe.each(SIGNALS)(
  "an attribute named like what every object inherits, on $signal",
  (signalCase: SignalCase) => {
    test("every such name is stored as the row's own attribute, listed in attributeKeys, and read back from JSON, the model and the API", async () => {
      await signalCase.run(everyInheritedName());

      expectStored(
        signalCase,
        INHERITED_PROPERTY_NAMES.map((name: string): [string, unknown] => {
          return [name, `own ${name}`];
        }),
      );
    });

    test("an array under __proto__ is its value, never the attributes' prototype", async () => {
      await signalCase.run([
        {
          key: "__proto__",
          value: {
            arrayValue: {
              values: [{ stringValue: "a" }, { stringValue: "b" }],
            },
          },
        },
      ]);

      const attributes: JSONObject = onlyRowFor(signalCase.target)[
        "attributes"
      ] as JSONObject;

      expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
      expect(readOwnValue(attributes, "__proto__")).toEqual(["a", "b"]);
      expect((attributes as Record<string, unknown>)["length"]).toBeUndefined();
    });

    test("a kvlist under __proto__ is stored under its prefix, and one with a __proto__ key in it too", async () => {
      await signalCase.run([
        {
          key: "__proto__",
          value: {
            kvlistValue: {
              values: [stringAttribute("inner", "x")],
            },
          },
        },
        {
          key: "outer",
          value: {
            kvlistValue: {
              values: [stringAttribute("__proto__", "y")],
            },
          },
        },
        { key: "__proto__.count", value: { intValue: 2 } },
      ]);

      expectStored(signalCase, [
        ["__proto__.inner", "x"],
        ["outer.__proto__", "y"],
        ["__proto__.count", 2],
      ]);
    });

    test("an int, a double and a boolean under __proto__ are stored as they came", async () => {
      for (const [value, stored] of [
        [{ intValue: 7 }, 7],
        [{ doubleValue: 0.5 }, 0.5],
        [{ boolValue: true }, true],
      ] as Array<[JSONObject, unknown]>) {
        rowsByTarget = new Map();
        await signalCase.run([{ key: "__proto__", value }]);
        expectStored(signalCase, [["__proto__", stored]]);
      }
    });

    test("a resource attribute of each such name is stored under resource.", async () => {
      const body: JSONObject =
        signalCase.target === LogService
          ? logsBody([])
          : signalCase.target === SpanService
            ? tracesBody([])
            : signalCase.target === MetricService
              ? metricsBody([])
              : profilesBody([]);
      const resource: JSONObject = (
        (Object.values(body)[0] as JSONArray)[0] as JSONObject
      )["resource"] as JSONObject;
      resource["attributes"] = [...RESOURCE, ...everyInheritedName("res")];

      if (signalCase.target === LogService) {
        await OtelLogsIngestService.processLogsFromQueue(
          telemetryRequest(body),
        );
      } else if (signalCase.target === SpanService) {
        await OtelTracesIngestService.processTracesFromQueue(
          telemetryRequest(body),
        );
      } else if (signalCase.target === MetricService) {
        await OtelMetricsIngestService.processMetricsFromQueue(
          telemetryRequest(body),
        );
      } else {
        await OtelProfilesIngestService.processProfilesFromQueue(
          telemetryRequest(body),
        );
      }

      expectStored(
        signalCase,
        INHERITED_PROPERTY_NAMES.map((name: string): [string, unknown] => {
          return [`resource.${name}`, `res ${name}`];
        }),
      );
    });
  },
);

describe("a span event's attributes named like what every object inherits", () => {
  test("are kept on the span's event, and on the exception it records", async () => {
    await OtelTracesIngestService.processTracesFromQueue(
      telemetryRequest(
        tracesBody(
          [],
          [
            {
              name: "exception",
              timeUnixNano: nowNano(),
              attributes: [
                stringAttribute("exception.type", "TypeError"),
                stringAttribute("exception.message", "boom"),
                ...everyInheritedName("event"),
              ],
            },
          ],
        ),
      ),
    );

    const span: JSONObject = onlyRowFor(SpanService);
    const events: Array<JSONObject> = JSON.parse(
      JSON.stringify(span["events"]),
    ) as Array<JSONObject>;
    const eventAttributes: JSONObject = events[0]!["attributes"] as JSONObject;

    for (const name of INHERITED_PROPERTY_NAMES) {
      expect({ name, value: readOwnValue(eventAttributes, name) }).toEqual({
        name,
        value: `event ${name}`,
      });
    }

    const exceptions: Array<JSONObject> = rowsFor(ExceptionInstanceService);
    expect(exceptions).toHaveLength(1);

    const exceptionAttributes: JSONObject = JSON.parse(
      JSON.stringify(exceptions[0]!["attributes"]),
    ) as JSONObject;

    for (const name of INHERITED_PROPERTY_NAMES) {
      expect({ name, value: readOwnValue(exceptionAttributes, name) }).toEqual({
        name,
        value: `event ${name}`,
      });
    }
  });
});

describe("a log pipeline over an attribute named __proto__", () => {
  test("one processor writes it, the next copies the attributes, and the stored row keeps it", async () => {
    loadedLogPipelines = [
      {
        pipeline: { name: "inherited names" },
        compiledFilter: FilterEvaluator.compileFilter(""),
        processors: [
          {
            name: "remap",
            processorType: LogPipelineProcessorType.AttributeRemapper,
            configuration: {
              sourceKey: "level",
              targetKey: "__proto__",
              preserveSource: true,
            },
          },
          {
            name: "categorize",
            processorType: LogPipelineProcessorType.CategoryProcessor,
            configuration: {
              targetKey: "category",
              categories: [
                { name: "errors", filterQuery: "body LIKE 'request %'" },
              ],
            },
          },
        ],
      } as unknown as LoadedPipeline,
    ];

    await OtelLogsIngestService.processLogsFromQueue(
      telemetryRequest(logsBody([stringAttribute("level", "error")])),
    );

    expectStored(SIGNALS[0]!, [
      ["level", "error"],
      ["__proto__", "error"],
      ["category", "errors"],
    ]);
  });
});

describe("a metric's own attributes named like what every object inherits", () => {
  test("reach a data point that has no attributes of its own, and one that has", async () => {
    const body: JSONObject = metricsBody([stringAttribute("route", "/")]);
    const scopeMetric: JSONObject = (
      ((body["resourceMetrics"] as JSONArray)[0] as JSONObject)[
        "scopeMetrics"
      ] as JSONArray
    )[0] as JSONObject;
    const theMetric: JSONObject = (
      scopeMetric["metrics"] as JSONArray
    )[0] as JSONObject;
    const sum: JSONObject = theMetric["sum"] as JSONObject;

    theMetric["attributes"] = everyInheritedName("metric");
    (sum["dataPoints"] as JSONArray).push({
      startTimeUnixNano: nowNano(),
      timeUnixNano: nowNano(),
      asDouble: 4,
    });

    await OtelMetricsIngestService.processMetricsFromQueue(
      telemetryRequest(body),
    );

    const rows: Array<JSONObject> = rowsFor(MetricService);
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      const attributes: JSONObject = JSON.parse(
        JSON.stringify(row["attributes"]),
      ) as JSONObject;

      for (const name of INHERITED_PROPERTY_NAMES) {
        expect({
          name,
          value: readOwnValue(attributes, name),
          listed: (row["attributeKeys"] as Array<string>).includes(name),
        }).toEqual({ name, value: `metric ${name}`, listed: true });
      }
    }
  });
});

/*
 * A metric's name is the exporter's too. The catalog read its entry with a
 * plain read: for a metric named __proto__ or constructor it found what
 * every object inherits, made no entry, and the ingest then wrote the
 * metric's counter semantics onto it - Object.prototype, the prototype of
 * every object of the process, or the Object function.
 */
describe("a metric named like what every object inherits", () => {
  test.each(["__proto__", "constructor"])(
    "a cumulative monotonic sum named %s is catalogued as its own, with its counter semantics",
    async (name: string) => {
      await OtelMetricsIngestService.processMetricsFromQueue(
        telemetryRequest(
          metricsBody([stringAttribute("route", "/checkout")], name),
        ),
      );

      // Nothing was written onto Object.prototype or the Object function.
      expect(
        ({} as Record<string, unknown>)["aggregationTemporality"],
      ).toBeUndefined();
      expect(({} as Record<string, unknown>)["isMonotonic"]).toBeUndefined();
      expect(
        (Object as unknown as Record<string, unknown>)["isMonotonic"],
      ).toBeUndefined();

      expect(indexedCatalogs.length).toBeGreaterThan(0);

      const catalogued: MetricType | undefined = readOwnValue(
        indexedCatalogs[0]!,
        name,
      );

      expect(catalogued).toBeInstanceOf(MetricType);
      expect(catalogued!.name).toBe(name);
      expect(catalogued!.isMonotonic).toBe(true);
      expect(catalogued!.aggregationTemporality).toBeTruthy();
      expect(Object.keys(indexedCatalogs[0]!)).toEqual([name]);

      const row: JSONObject = onlyRowFor(MetricService);
      expect(row["name"]).toBe(name);
      expect(readOwnValue(row["attributes"] as JSONObject, "route")).toBe(
        "/checkout",
      );
    },
  );
});
