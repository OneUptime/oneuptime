/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import EventLoop, { EVENT_LOOP_BUDGET_MS } from "Common/Server/Utils/EventLoop";
import { ExpressRequest } from "Common/Server/Utils/Express";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SessionReplayBudgetMetricTypeUtil from "Common/Utils/SessionReplay/SessionReplayBudgetMetricType";
import { SCRUB_MAX_NESTED_VALUES_PER_RECORD } from "Common/Utils/Telemetry/ScrubNestedValues";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * TELEMETRY INGEST HANDS THE EVENT LOOP BACK BY THE TIME THE WORK TOOK (#6514).
 *
 * The OTLP log, trace and metric ingest loops handed the event loop back by
 * count: every 500 log records, every 200 spans, every 200 datapoints (and
 * every so many resources, scopes and metrics). A record's work is not
 * bounded by that count. Since #6507 a record's scrub work grows with its
 * nested values - up to 10,000 a record, each read by every scrub rule of
 * the project - so a batch of large records held the process for seconds
 * between two hand-backs (measured on main: 500 such logs against an Email
 * rule, 4.8 s; against a custom pattern, 45 s), and every other request and
 * job on it waited.
 *
 * Each loop now keeps one EventLoopBudget for the batch and asks it before
 * each resource, scope, metric and record: the loop is handed back once
 * the work since the last time took EVENT_LOOP_BUDGET_MS.
 *
 * Nothing here reads a wall clock. EventLoop.now is a fake clock that the
 * work itself moves, counted the way it costs: each record a fixed amount,
 * and each text or key a scrub rule reads an amount in line with its length
 * (the project's compiled rules are wrapped to count what they read). The
 * amounts are about what this work took when measured - a small log against
 * no rule 0.02 ms, a log at the 10,000-value bound against an Email rule
 * 9 ms - so "how often" here is about what it is in a real process. What
 * this suite holds:
 *
 *   - under each kind of scrub rule, a batch of large logs or spans is never
 *     held longer than the budget and one record;
 *   - a batch of small records is handed back no more often than the old
 *     count did;
 *   - the loop is asked before each resource, scope and metric too, so work
 *     there counts as well;
 *   - what is stored does not depend on how often the loop was handed back.
 *
 * Only the persistence edges are replaced: Postgres (resource resolution,
 * the rules, pipelines, drop filters, discovery), ClickHouse (the fan-in
 * writer) and the exception upsert.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout-api";

// What the work costs on the fake clock, in milliseconds.
const MS_PER_RECORD: number = 0.02;
const MS_PER_RULE_READ: number = 0.0005;
const MS_PER_CHARACTER_READ: number = 0.00001;

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverIoTFleet",
  "autoDiscoverDatabaseServer",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceMethods = Record<string, any>;

type Signal = "logs" | "traces" | "metrics";

/*
 * ---------------------------------------------------------------------------
 * The fake clock, and when the loop was handed back on it.
 * ---------------------------------------------------------------------------
 */
let fakeNow: number;
let clockRuns: boolean;
let handBacksAt: Array<number>;
// Where on the fake clock each record started: its first step's call.
let recordStartsAt: Array<number>;

function advance(milliseconds: number): void {
  if (clockRuns) {
    fakeNow += milliseconds;
  }
}

function installClock(): void {
  fakeNow = 0;
  clockRuns = true;
  handBacksAt = [];
  recordStartsAt = [];

  jest.spyOn(EventLoop, "now").mockImplementation((): number => {
    return fakeNow;
  });
  jest
    .spyOn(EventLoop, "yieldToEventLoop")
    .mockImplementation(async (): Promise<void> => {
      handBacksAt.push(fakeNow);
    });
}

// The longest the loop was held: from the start, or a hand-back, to the next.
function longestStretch(): number {
  let longest: number = 0;
  let from: number = 0;

  for (const at of handBacksAt) {
    longest = Math.max(longest, at - from);
    from = at;
  }

  return Math.max(longest, fakeNow - from);
}

// The most one record took: from its start to the next one's, or the end.
function longestRecord(): number {
  let longest: number = 0;

  for (let index: number = 0; index < recordStartsAt.length; index++) {
    const end: number =
      index + 1 < recordStartsAt.length ? recordStartsAt[index + 1]! : fakeNow;

    longest = Math.max(longest, end - recordStartsAt[index]!);
  }

  return longest;
}

/*
 * A per-record step of the service, still run as it is, that starts the
 * record on the fake clock.
 */
function countRecordsAt(
  owner: unknown,
  method: string,
  msPerRecord: number,
): void {
  const methods: ServiceMethods = owner as ServiceMethods;
  const real: (...args: Array<unknown>) => unknown = methods[method].bind(
    owner,
  ) as (...args: Array<unknown>) => unknown;

  jest
    .spyOn(methods, method)
    .mockImplementation((...args: Array<unknown>): unknown => {
      recordStartsAt.push(fakeNow);
      advance(msPerRecord);
      return real(...args);
    });
}

/*
 * ---------------------------------------------------------------------------
 * The project's scrub rules, compiled as ingest compiles them, each wrapped
 * to count what it reads on the fake clock.
 * ---------------------------------------------------------------------------
 */
interface RuleSpec {
  patternType: string;
  customRegex?: string;
}

const RULE_KINDS: Record<string, Array<RuleSpec>> = {
  email: [{ patternType: "email" }],
  creditCard: [{ patternType: "creditCard" }],
  ssn: [{ patternType: "ssn" }],
  phoneNumber: [{ patternType: "phoneNumber" }],
  ipAddress: [{ patternType: "ipAddress" }],
  custom: [{ patternType: "custom", customRegex: "order-[0-9]+" }],
  sensitiveKeys: [{ patternType: "sensitiveKeys" }],
  every: [
    { patternType: "email" },
    { patternType: "creditCard" },
    { patternType: "ssn" },
    { patternType: "phoneNumber" },
    { patternType: "ipAddress" },
    { patternType: "custom", customRegex: "order-[0-9]+" },
    { patternType: "sensitiveKeys" },
  ],
};

interface CompiledRule {
  rule: LogScrubRule | TraceScrubRule;
  regex: ScrubRegExp;
}

function readCost(text: string): number {
  return MS_PER_RULE_READ + MS_PER_CHARACTER_READ * text.length;
}

function countedRegex(regex: ScrubRegExp): ScrubRegExp {
  return {
    source: regex.source,
    flags: regex.flags,
    test: (text: string): boolean => {
      advance(readCost(text));
      return regex.test(text);
    },
    replace: (
      text: string,
      replacer: (matchedText: string) => string,
    ): string => {
      advance(readCost(text));
      return regex.replace(text, replacer);
    },
  };
}

function compileRules(
  signal: "logs" | "traces",
  specs: Array<RuleSpec>,
): Array<CompiledRule> {
  return specs.map((spec: RuleSpec): CompiledRule => {
    const service: unknown =
      signal === "logs" ? LogScrubRuleService : TraceScrubRuleService;
    const rule: LogScrubRule | TraceScrubRule =
      signal === "logs" ? new LogScrubRule() : new TraceScrubRule();

    rule.name = `rule ${spec.patternType}`;
    rule.patternType = spec.patternType;
    rule.scrubAction = "redact";

    if (spec.customRegex) {
      rule.customRegex = spec.customRegex;
    }

    const regex: ScrubRegExp | null = (
      service as {
        getRegexForPattern: (
          patternType: string,
          customRegex?: string,
        ) => ScrubRegExp | null;
      }
    ).getRegexForPattern(spec.patternType, spec.customRegex);

    expect(regex).not.toBeNull();

    return { rule: rule, regex: countedRegex(regex as ScrubRegExp) };
  });
}

/*
 * ---------------------------------------------------------------------------
 * The ingest services, with their persistence edges replaced.
 * ---------------------------------------------------------------------------
 */
let storedRows: Array<JSONObject>;

function setupIngest(
  signal: Signal,
  rules: Array<RuleSpec>,
  msPerRecord: number = MS_PER_RECORD,
): void {
  storedRows = [];

  const service: ServiceMethods = (signal === "logs"
    ? OtelLogsIngestService
    : signal === "traces"
      ? OtelTracesIngestService
      : OtelMetricsIngestService) as unknown as ServiceMethods;

  for (const method of AUTO_DISCOVERY_METHODS) {
    if (typeof service[method] === "function") {
      jest.spyOn(service, method).mockResolvedValue(null);
    }
  }

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: new ObjectID(SERVICE_ID.toString()),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target === LogService || target === SpanService) {
          storedRows.push(...batch);
        } else if (target !== ExceptionInstanceService) {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }

        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  if (signal === "logs") {
    jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest
      .spyOn(LogScrubRuleService, "loadScrubRules")
      .mockResolvedValue(compileRules("logs", rules) as never);
    countRecordsAt(
      OtelLogsIngestService,
      "normalizeSeverityNumber",
      msPerRecord,
    );
  } else if (signal === "traces") {
    jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      .mockResolvedValue(compileRules("traces", rules) as never);
    countRecordsAt(
      OtelTracesIngestService,
      "buildSpanEvaluationRow",
      msPerRecord,
    );
  } else {
    jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
    jest
      .spyOn(service, "submitMetricsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
        storedRows.push(...rows.splice(0, rows.length));
        return Promise.resolve();
      });
    jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
      projectRules: [],
      rulesByServiceId: new Map(),
    } as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);
    countRecordsAt(
      OtelMetricsIngestService,
      "buildMetricEvaluationRow",
      msPerRecord,
    );
  }
}

async function ingest(signal: Signal, body: JSONObject): Promise<void> {
  const req: ExpressRequest = {
    projectId: new ObjectID(PROJECT_ID.toString()),
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  if (signal === "logs") {
    await OtelLogsIngestService.processLogsFromQueue(req);
  } else if (signal === "traces") {
    await OtelTracesIngestService.processTracesFromQueue(req);
  } else {
    await OtelMetricsIngestService.processMetricsFromQueue(req);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Requests, as OTLP/JSON writes them.
 * ---------------------------------------------------------------------------
 */
function text(value: string): JSONObject {
  return { stringValue: value };
}

function smallAttributes(index: number): JSONArray {
  return [
    { key: "http.method", value: text("GET") },
    { key: "http.route", value: text("/api/orders/:id") },
    { key: "http.status_code", value: { intValue: "200" } },
    { key: "user.id", value: text(`user-${index}`) },
    { key: "user.email", value: text(`user${index}@example.com`) },
    { key: "net.peer.ip", value: text(`10.0.${index % 250}.1`) },
    { key: "order.id", value: text(`order-${index}`) },
    { key: "auth.token", value: text(`tok-${index}`) },
    { key: "thread.name", value: text("worker-1") },
    { key: "retries", value: { intValue: "0" } },
  ];
}

/*
 * A list of `size` contacts, each a key-value list of an email and a note
 * with an order and an address: three values each inside the list (the
 * contact and its two entries), two texts for a pattern rule to read and
 * two keys for a Sensitive Attribute Keys rule.
 */
const VALUES_PER_CONTACT: number = 3;

function contacts(size: number, seed: number): JSONObject {
  const values: Array<JSONObject> = [];

  for (let index: number = 0; index < size; index++) {
    values.push({
      kvlistValue: {
        values: [
          { key: "email", value: text(`u${seed}-${index}@example.com`) },
          {
            key: "note",
            value: text(
              `order-${index} from 10.0.${index % 250}.${seed % 250}`,
            ),
          },
        ],
      },
    });
  }

  return { arrayValue: { values: values } };
}

function attributesFor(index: number, listSize: number): JSONArray {
  return listSize > 0
    ? [
        ...smallAttributes(index),
        { key: "contacts", value: contacts(listSize, index) },
      ]
    : smallAttributes(index);
}

function logRecords(count: number, listSize: number): JSONArray {
  const records: JSONArray = [];

  for (let index: number = 0; index < count; index++) {
    records.push({
      timeUnixNano: `${1794218400000 + index}000000`,
      severityNumber: 9,
      body: text(`order-${index} placed by user${index}@example.com`),
      attributes: attributesFor(index, listSize),
    });
  }

  return records;
}

function spans(count: number, listSize: number): JSONArray {
  const list: JSONArray = [];

  for (let index: number = 0; index < count; index++) {
    list.push({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: (index + 1).toString(16).padStart(16, "0"),
      name: `GET /api/orders/${index}`,
      kind: 2,
      startTimeUnixNano: `${1794218400000 + index}000000`,
      endTimeUnixNano: `${1794218400001 + index}000000`,
      status: { code: 1, message: "" },
      attributes: attributesFor(index, listSize),
    });
  }

  return list;
}

function dataPoints(count: number, listSize: number): JSONArray {
  const points: JSONArray = [];

  for (let index: number = 0; index < count; index++) {
    points.push({
      timeUnixNano: `${1794218400000 + index}000000`,
      asDouble: index * 1.5,
      attributes: attributesFor(index, listSize),
    });
  }

  return points;
}

const RESOURCE: JSONObject = {
  attributes: [{ key: "service.name", value: text(SERVICE_NAME) }],
};

function batchOf(signal: Signal, count: number, listSize: number): JSONObject {
  if (signal === "logs") {
    return {
      resourceLogs: [
        {
          resource: RESOURCE,
          scopeLogs: [
            {
              scope: { name: "checkout.logger" },
              logRecords: logRecords(count, listSize),
            },
          ],
        },
      ],
    };
  }

  if (signal === "traces") {
    return {
      resourceSpans: [
        {
          resource: RESOURCE,
          scopeSpans: [
            {
              scope: { name: "checkout.tracer" },
              spans: spans(count, listSize),
            },
          ],
        },
      ],
    };
  }

  return {
    resourceMetrics: [
      {
        resource: RESOURCE,
        scopeMetrics: [
          {
            scope: { name: "checkout.meter" },
            metrics: [
              {
                name: "checkout.requests",
                unit: "1",
                gauge: { dataPoints: dataPoints(count, listSize) },
              },
            ],
          },
        ],
      },
    ],
  };
}

// The old count: how many records the loop handed the event loop back after.
const OLD_RECORDS_PER_HAND_BACK: Record<Signal, number> = {
  logs: 500,
  traces: 200,
  metrics: 200,
};

// A stored row without what ingest stamps from the real clock and ids.
function comparable(row: JSONObject): JSONObject {
  const copy: JSONObject = { ...row };

  delete copy["_id"];
  delete copy["createdAt"];
  delete copy["retentionDate"];

  return copy;
}

beforeEach(() => {
  installClock();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a batch of large records, under each kind of scrub rule, is never held longer than the budget and one record", () => {
  const cases: Array<[string, "logs" | "traces"]> = [];

  for (const kind of Object.keys(RULE_KINDS)) {
    cases.push([kind, "logs"], [kind, "traces"]);
  }

  test.each(cases)("%s rules, %s", async (kind: string, signal: Signal) => {
    setupIngest(signal, RULE_KINDS[kind]!);

    // 40 records of 2,000 contacts: each takes a few ms, together far more than the budget.
    await ingest(signal, batchOf(signal, 40, 2_000));

    expect(storedRows).toHaveLength(40);
    expect(recordStartsAt).toHaveLength(40);

    const total: number = fakeNow;
    const oneRecord: number = longestRecord();

    /*
     * The count handed the loop back only before the first of the 40: the
     * whole batch in one stretch.
     */
    expect(total).toBeGreaterThan(3 * (EVENT_LOOP_BUDGET_MS + oneRecord));
    expect(longestStretch()).toBeLessThan(EVENT_LOOP_BUDGET_MS + oneRecord);
    expect(handBacksAt.length).toBeGreaterThanOrEqual(
      Math.floor(total / (EVENT_LOOP_BUDGET_MS + oneRecord)),
    );
  });

  test.each([["logs"], ["traces"]] as Array<[Signal]>)(
    "%s at the 10,000-value bound, against every kind of rule at once: handed back before each record",
    async (signal: Signal) => {
      setupIngest(signal, RULE_KINDS["every"]!);

      // Each record at the bound: as many contacts as its allowance reads.
      await ingest(
        signal,
        batchOf(
          signal,
          6,
          Math.floor(SCRUB_MAX_NESTED_VALUES_PER_RECORD / VALUES_PER_CONTACT),
        ),
      );

      expect(storedRows).toHaveLength(6);

      // Each record alone takes more than the budget.
      for (let index: number = 1; index < recordStartsAt.length; index++) {
        expect(
          recordStartsAt[index]! - recordStartsAt[index - 1]!,
        ).toBeGreaterThan(EVENT_LOOP_BUDGET_MS);
      }

      expect(handBacksAt).toHaveLength(5);
      expect(longestStretch()).toBe(longestRecord());
    },
  );
});

describe("a batch of small records is handed back no more often than the count did", () => {
  const cases: Array<[Signal, string]> = [
    ["logs", "no"],
    ["logs", "email"],
    ["logs", "sensitiveKeys"],
    ["traces", "no"],
    ["traces", "email"],
    ["traces", "sensitiveKeys"],
    ["metrics", "no"],
  ];

  test.each(cases)("%s, %s rules", async (signal: Signal, kind: string) => {
    setupIngest(signal, kind === "no" ? [] : RULE_KINDS[kind]!);

    await ingest(signal, batchOf(signal, 3_000, 0));

    expect(storedRows).toHaveLength(3_000);

    // Small records: each well under a tenth of a millisecond.
    expect(longestRecord()).toBeLessThan(0.1);
    expect(handBacksAt.length).toBeLessThanOrEqual(
      Math.ceil(3_000 / OLD_RECORDS_PER_HAND_BACK[signal]),
    );
    // And still never held longer than the budget and one record.
    expect(longestStretch()).toBeLessThan(
      EVENT_LOOP_BUDGET_MS + longestRecord(),
    );
  });

  test.each([["logs"], ["traces"], ["metrics"]] as Array<[Signal]>)(
    "%s: a batch that takes less than the budget is not handed back at all",
    async (signal: Signal) => {
      setupIngest(signal, []);

      await ingest(signal, batchOf(signal, 300, 0));

      expect(storedRows).toHaveLength(300);
      expect(fakeNow).toBeLessThan(EVENT_LOOP_BUDGET_MS);
      expect(handBacksAt).toEqual([]);
    },
  );
});

describe("the budget is asked before each resource, scope and metric too", () => {
  // Work on the fake clock wherever a resource is resolved.
  function resourcesCost(milliseconds: number, signal: Signal): void {
    const service: ServiceMethods = (signal === "logs"
      ? OtelLogsIngestService
      : signal === "traces"
        ? OtelTracesIngestService
        : OtelMetricsIngestService) as unknown as ServiceMethods;

    jest
      .spyOn(service, "resolveTelemetryResource")
      .mockImplementation(async (): Promise<unknown> => {
        advance(milliseconds);
        return {
          serviceName: SERVICE_NAME,
          primaryEntityId: new ObjectID(SERVICE_ID.toString()),
          primaryEntityType: ServiceType.OpenTelemetry,
          dataRententionInDays: 15,
          serviceRetentionConfig: null,
          serviceRetentionInDays: null,
          projectRetentionConfig: null,
          projectRetentionInDays: 15,
        };
      });
  }

  function scopesCost(milliseconds: number): void {
    const real: typeof TelemetryUtil.getPrefixedScopeAttributes =
      TelemetryUtil.getPrefixedScopeAttributes.bind(TelemetryUtil);

    jest
      .spyOn(TelemetryUtil, "getPrefixedScopeAttributes")
      .mockImplementation((scope: JSONObject | undefined) => {
        advance(milliseconds);
        return real(scope);
      });
  }

  // Six resources with no scopes: only the resource loop can hand back.
  function resourcesOnly(signal: Signal): JSONObject {
    const key: string =
      signal === "logs"
        ? "resourceLogs"
        : signal === "traces"
          ? "resourceSpans"
          : "resourceMetrics";
    const scopesKey: string =
      signal === "logs"
        ? "scopeLogs"
        : signal === "traces"
          ? "scopeSpans"
          : "scopeMetrics";

    return {
      [key]: new Array<number>(6).fill(0).map((): JSONObject => {
        return { resource: RESOURCE, [scopesKey]: [] };
      }),
    };
  }

  // One resource with six scopes and nothing in them.
  function scopesOnly(signal: Signal): JSONObject {
    if (signal === "logs") {
      return {
        resourceLogs: [
          {
            resource: RESOURCE,
            scopeLogs: new Array<number>(6).fill(0).map((): JSONObject => {
              return { scope: { name: "s" }, logRecords: [] };
            }),
          },
        ],
      };
    }

    if (signal === "traces") {
      return {
        resourceSpans: [
          {
            resource: RESOURCE,
            scopeSpans: new Array<number>(6).fill(0).map((): JSONObject => {
              return { scope: { name: "s" }, spans: [] };
            }),
          },
        ],
      };
    }

    return {
      resourceMetrics: [
        {
          resource: RESOURCE,
          scopeMetrics: new Array<number>(6).fill(0).map((): JSONObject => {
            return { scope: { name: "s" }, metrics: [] };
          }),
        },
      ],
    };
  }

  test.each([["logs"], ["traces"], ["metrics"]] as Array<[Signal]>)(
    "%s: resources that each take more than the budget are handed back before each one but the first",
    async (signal: Signal) => {
      setupIngest(signal, []);
      resourcesCost(EVENT_LOOP_BUDGET_MS + 5, signal);

      await ingest(signal, resourcesOnly(signal));

      expect(handBacksAt).toEqual([25, 50, 75, 100, 125]);
    },
  );

  test.each([["logs"], ["traces"], ["metrics"]] as Array<[Signal]>)(
    "%s: scopes that each take more than the budget are handed back before each one but the first",
    async (signal: Signal) => {
      setupIngest(signal, []);
      scopesCost(EVENT_LOOP_BUDGET_MS + 5);

      await ingest(signal, scopesOnly(signal));

      expect(handBacksAt).toEqual([25, 50, 75, 100, 125]);
    },
  );

  test("metrics: metrics that each take more than the budget are handed back before each one but the first", async () => {
    setupIngest("metrics", []);

    const real: typeof SessionReplayBudgetMetricTypeUtil.isReservedMetricName =
      SessionReplayBudgetMetricTypeUtil.isReservedMetricName.bind(
        SessionReplayBudgetMetricTypeUtil,
      );

    jest
      .spyOn(SessionReplayBudgetMetricTypeUtil, "isReservedMetricName")
      .mockImplementation((name: string | null | undefined): boolean => {
        advance(EVENT_LOOP_BUDGET_MS + 5);
        return real(name);
      });

    // Six metrics without a datapoint: only the metric loop can hand back.
    await ingest("metrics", {
      resourceMetrics: [
        {
          resource: RESOURCE,
          scopeMetrics: [
            {
              scope: { name: "checkout.meter" },
              metrics: new Array<number>(6)
                .fill(0)
                .map((_value: number, index: number): JSONObject => {
                  return {
                    name: `checkout.metric.${index}`,
                    gauge: { dataPoints: [] },
                  };
                }),
            },
          ],
        },
      ],
    });

    expect(handBacksAt).toEqual([25, 50, 75, 100, 125]);
  });

  test("metrics: the scan for a host's newest datapoint, before the main loop, is handed back too", async () => {
    setupIngest("metrics", []);

    // Datapoints whose time takes 15 ms to read, as the scan reads it first.
    const points: JSONArray = dataPoints(4, 0).map(
      (point: JSONObject): JSONObject => {
        const time: unknown = point["timeUnixNano"];
        const slow: JSONObject = { ...point };

        Object.defineProperty(slow, "timeUnixNano", {
          enumerable: true,
          get: (): unknown => {
            advance(15);
            return time;
          },
        });

        return slow;
      },
    );

    await ingest("metrics", {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: text(SERVICE_NAME) },
              { key: "host.name", value: text("checkout-host-1") },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: "checkout.meter" },
              metrics: [
                {
                  name: "checkout.requests",
                  gauge: { dataPoints: points },
                },
              ],
            },
          ],
        },
      ],
    });

    // The first datapoint row is built after the scan was handed back.
    expect(recordStartsAt.length).toBeGreaterThan(0);
    expect(handBacksAt.length).toBeGreaterThan(0);
    expect(handBacksAt[0]!).toBeLessThan(recordStartsAt[0]!);
    expect(handBacksAt[0]!).toBe(30);
  });
});

describe("what is stored does not depend on how often the loop was handed back", () => {
  test.each([["logs"], ["traces"], ["metrics"]] as Array<[Signal]>)(
    "%s: the same batch, handed back never and many times, stores the same rows",
    async (signal: Signal) => {
      const rules: Array<RuleSpec> =
        signal === "metrics" ? [] : RULE_KINDS["every"]!;
      // Metrics have no scrub rules: their datapoints take 7 ms each here.
      const msPerRecord: number = signal === "metrics" ? 7 : MS_PER_RECORD;

      // Never: the clock stands still, so the budget is never spent.
      setupIngest(signal, rules, msPerRecord);
      clockRuns = false;
      await ingest(signal, batchOf(signal, 30, 1_000));
      const neverHandedBack: Array<JSONObject> = storedRows.map(comparable);

      expect(handBacksAt).toEqual([]);
      expect(neverHandedBack).toHaveLength(30);

      jest.restoreAllMocks();
      installClock();

      // Many times: every few records.
      setupIngest(signal, rules, msPerRecord);
      await ingest(signal, batchOf(signal, 30, 1_000));
      const oftenHandedBack: Array<JSONObject> = storedRows.map(comparable);

      expect(handBacksAt.length).toBeGreaterThan(3);
      expect(oftenHandedBack).toEqual(neverHandedBack);
    },
  );

  test.each([["logs"], ["traces"]] as Array<[Signal]>)(
    "%s: the rules still scrub every record of a batch handed back between records",
    async (signal: Signal) => {
      setupIngest(signal, RULE_KINDS["every"]!);

      await ingest(signal, batchOf(signal, 30, 1_000));

      expect(handBacksAt.length).toBeGreaterThan(3);
      expect(storedRows).toHaveLength(30);

      for (const row of storedRows) {
        const stored: string = JSON.stringify(row["attributes"]);

        expect(stored).not.toContain("@example.com");
        expect(stored).not.toMatch(/order-[0-9]/);
        expect(stored).not.toContain("tok-");
      }
    },
  );
});
