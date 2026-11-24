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

/*
 * A Hash rule's token is keyed by the install's ENCRYPTION_SECRET through
 * the project's own key (ScrubHashToken, #10394): fixed for the run, as the
 * clock and the ids are, so the goldens hold whatever a machine's config.env
 * sets.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const ObjectIDClass: new (id: string) => unknown = (
    jest.requireActual("Common/Types/ObjectID") as {
      default: new (id: string) => unknown;
    }
  ).default;

  return {
    __esModule: true,
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    EncryptionSecret: new ObjectIDClass("ingest-rows-byte-for-byte-secret"),
  };
});

import fs from "fs";
import path from "path";
import zlib from "zlib";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import OtelPayloadDecoder, {
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import {
  OtlpSignal,
  otlpShapes,
  toOtlpJson,
  toProtobuf,
} from "./Helpers/OtlpShapeFixtures";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import UUID from "Common/Utils/UUID";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE ROWS INGEST STORES, BYTE FOR BYTE.
 *
 * Every log, span, metric point and exception a batch of every OTLP shape
 * becomes, sent as protobuf and as OTLP/JSON, with and without scrub rules,
 * through the real ingest services and the real payload decoder - written
 * out exactly as the ClickHouse client sends them (each row's JSON and a
 * line break, the JSONEachRow body), table by table, in the order they are
 * handed to the fan-in writer. A batch sent as protobuf and the same batch
 * sent as OTLP/JSON are stored as the same rows, so both are held to one
 * file.
 *
 * The expected bodies in Fixtures/IngestRowsByteForByte were written by the
 * code before the telemetry CPU work of #6086 (the OTLP decoder that reads
 * protobuf without protobufjs' toObject, and the insert body built without
 * one string of every row); this suite holds every change since to them.
 * Only what is not the batch's - the clock and each row's random id - is
 * fixed for the run.
 *
 * To write them again, deliberately, after a change that is meant to store
 * different rows: UPDATE_INGEST_ROWS_GOLDEN=1, and say why in the commit.
 * ---------------------------------------------------------------------------
 */

const GOLDEN_DIR: string = path.join(
  __dirname,
  "Fixtures",
  "IngestRowsByteForByte",
);

const UPDATE_GOLDEN: boolean = process.env["UPDATE_INGEST_ROWS_GOLDEN"] === "1";

const PROJECT_ID: ObjectID = new ObjectID(
  "6f0d8bb1-6c55-4a39-a0a9-6b0a4a4e5a10",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0e8f0b4c-2f5e-4c9a-9a52-8b6b2d3f1c22",
);

// The wall clock the run reads: row createdAt, retention, ingestion stamps.
const WALL_CLOCK_MS: number = Date.UTC(2026, 9, 17, 10, 15, 0, 0);

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverOpenStackCloud",
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

type Rules = "none" | "scrub";

interface Case {
  name: string;
  // The file of expected rows: one per signal and rule set, both formats.
  golden: string;
  signal: OtlpSignal;
  format: OtelPayloadFormat;
  rules: Rules;
}

const SIGNAL_PRODUCT: Record<OtlpSignal, ProductType> = {
  logs: ProductType.Logs,
  traces: ProductType.Traces,
  metrics: ProductType.Metrics,
};

const CASES: Array<Case> = [];

for (const signal of ["logs", "traces", "metrics"] as Array<OtlpSignal>) {
  for (const format of [OtelPayloadFormat.Protobuf, OtelPayloadFormat.Json]) {
    for (const rules of ["none", "scrub"] as Array<Rules>) {
      // Metrics have no scrub rules.
      if (signal === "metrics" && rules === "scrub") {
        continue;
      }

      CASES.push({
        name: `${signal}-${format}${rules === "scrub" ? "-scrubbed" : ""}`,
        golden: `${signal}${rules === "scrub" ? "-scrubbed" : ""}.jsonl`,
        signal: signal,
        format: format,
        rules: rules,
      });
    }
  }
}

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

interface RuleSpec {
  patternType: string;
  action: string;
  customRegex?: string;
  fields?: string;
}

// Rules compiled as each service compiles them, with its own patterns.
function compileRules(
  service: unknown,
  makeRule: () => LogScrubRule | TraceScrubRule,
  specs: Array<RuleSpec>,
): never {
  return specs.map((spec: RuleSpec) => {
    const rule: LogScrubRule | TraceScrubRule = makeRule();
    /*
     * As loadScrubRules reads a rule (#10443): with its project, whose key a
     * Hash rule's token is made with. Without one, Hash redacts instead.
     */
    rule.projectId = PROJECT_ID;
    rule.name = `rule ${spec.patternType}`;
    rule.patternType = spec.patternType;
    rule.scrubAction = spec.action;

    if (spec.customRegex !== undefined) {
      rule.customRegex = spec.customRegex;
    }

    if (spec.fields !== undefined) {
      rule.fieldsToScrub = spec.fields;
    }

    const regex: ScrubRegExp | null = (
      service as { getRegexForPattern: GetRegexForPattern }
    ).getRegexForPattern(spec.patternType, spec.customRegex);

    if (!regex) {
      throw new Error(`no pattern for ${spec.patternType}`);
    }

    return { rule: rule, regex: regex };
  }) as never;
}

const SCRUB_SPECS: Array<RuleSpec> = [
  { patternType: "sensitiveKeys", action: "redact" },
  { patternType: "email", action: "mask" },
  { patternType: "creditCard", action: "hash" },
  {
    patternType: "custom",
    action: "redact",
    customRegex: "Bearer [A-Za-z0-9-]+",
  },
];

interface Submission {
  table: string;
  rows: Array<JSONObject>;
}

function stubBackends(data: {
  rules: Rules;
  storedBody: Buffer;
}): Array<Submission> {
  const submissions: Array<Submission> = [];

  jest.useFakeTimers({
    now: WALL_CLOCK_MS,
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });

  // Each row's id: time-ordered as ever, its random bits a counter.
  let idCounter: number = 0;
  jest.spyOn(UUID, "generateTimeOrdered").mockImplementation((): string => {
    idCounter++;
    return `019a1f2e-1b40-7000-8000-${idCounter.toString(16).padStart(12, "0")}`;
  });

  jest.spyOn(TelemetryBodyStore, "readBody").mockResolvedValue(data.storedBody);

  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      (
        target: FanInInsertTarget,
        rows: Array<JSONObject>,
      ): Promise<FanInSubmitResult> => {
        submissions.push({ table: target.model.tableName, rows: rows });
        return Promise.resolve({ flushed: Promise.resolve() });
      },
    );

  for (const ingestService of [
    OtelMetricsIngestService,
    OtelTracesIngestService,
    OtelLogsIngestService,
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: Record<string, any> = ingestService as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };

    for (const method of AUTO_DISCOVERY_METHODS) {
      if (typeof service[method] === "function") {
        jest.spyOn(service, method).mockResolvedValue(null);
      }
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: "checkout",
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });

    if (typeof service["runBatchHostEnrichment"] === "function") {
      jest
        .spyOn(service, "runBatchHostEnrichment")
        .mockResolvedValue(undefined);
    }

    if (typeof service["autoDiscoverCloudMonitoredResources"] === "function") {
      jest
        .spyOn(service, "autoDiscoverCloudMonitoredResources")
        .mockResolvedValue(undefined);
    }
  }

  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest.spyOn(TraceScrubRuleService, "loadScrubRules").mockResolvedValue(
    data.rules === "scrub"
      ? compileRules(
          TraceScrubRuleService,
          () => {
            return new TraceScrubRule();
          },
          SCRUB_SPECS,
        )
      : ([] as never),
  );
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest
    .spyOn(
      ExceptionUtil as unknown as {
        resolveGroupFingerprints: () => Promise<Map<string, string>>;
      },
      "resolveGroupFingerprints",
    )
    .mockResolvedValue(new Map());
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue(
    data.rules === "scrub"
      ? compileRules(
          LogScrubRuleService,
          () => {
            return new LogScrubRule();
          },
          SCRUB_SPECS,
        )
      : ([] as never),
  );
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);

  return submissions;
}

// The batch as the queue stores it: the exporter's bytes, gzipped.
function storedBodyFor(testCase: Case): Buffer {
  const payload: JSONObject = otlpShapes(testCase.signal);
  const sent: Buffer =
    testCase.format === OtelPayloadFormat.Protobuf
      ? toProtobuf(testCase.signal, payload)
      : Buffer.from(toOtlpJson(testCase.signal, payload), "utf-8");

  return zlib.gzipSync(sent);
}

// What the ClickHouse client writes for `rows`: JSONEachRow, line by line.
function insertBody(rows: Array<JSONObject>): string {
  return rows
    .map((row: JSONObject) => {
      return JSON.stringify(row) + "\n";
    })
    .join("");
}

async function ingest(testCase: Case): Promise<string> {
  const submissions: Array<Submission> = stubBackends({
    rules: testCase.rules,
    storedBody: storedBodyFor(testCase),
  });

  try {
    const body: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: SIGNAL_PRODUCT[testCase.signal],
      format: testCase.format,
      encoding: "gzip",
      bodyKey: "golden-body",
    });

    const request: TelemetryRequest = {
      projectId: PROJECT_ID,
      body: body,
      headers: {},
      receivedAt: new Date(WALL_CLOCK_MS - 1_000),
    } as unknown as TelemetryRequest;

    if (testCase.signal === "logs") {
      await OtelLogsIngestService.processLogsFromQueue(request);
    } else if (testCase.signal === "traces") {
      await OtelTracesIngestService.processTracesFromQueue(request);
    } else {
      await OtelMetricsIngestService.processMetricsFromQueue(request);
    }
  } finally {
    jest.useRealTimers();
    jest.restoreAllMocks();
  }

  return submissions
    .map((submission: Submission) => {
      return `# ${submission.table} (${submission.rows.length} rows)\n${insertBody(submission.rows)}`;
    })
    .join("");
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("ingest stores the same rows, byte for byte", () => {
  for (const testCase of CASES) {
    test(testCase.name, async () => {
      const written: string = await ingest(testCase);
      const file: string = path.join(GOLDEN_DIR, testCase.golden);

      // Written from the protobuf batch; the OTLP/JSON one is held to it.
      if (UPDATE_GOLDEN && testCase.format === OtelPayloadFormat.Protobuf) {
        fs.mkdirSync(GOLDEN_DIR, { recursive: true });
        fs.writeFileSync(file, written);
      }

      const expected: string = fs.readFileSync(file, "utf-8");

      // A short, readable failure first: which table and line differ.
      const writtenLines: Array<string> = written.split("\n");
      const expectedLines: Array<string> = expected.split("\n");

      for (
        let i: number = 0;
        i < Math.max(writtenLines.length, expectedLines.length);
        i++
      ) {
        if (writtenLines[i] !== expectedLines[i]) {
          expect({ line: i + 1, row: writtenLines[i] }).toEqual({
            line: i + 1,
            row: expectedLines[i],
          });
        }
      }

      expect(written).toBe(expected);
    });
  }

  test("a Hash rule leaves its project's own token, never a redaction: ingest reads each rule with its project (#10443)", async () => {
    for (const name of ["logs-protobuf-scrubbed", "traces-protobuf-scrubbed"]) {
      const testCase: Case = CASES.find((item: Case): boolean => {
        return item.name === name;
      })!;
      const tokens: Array<string> =
        (await ingest(testCase)).match(/\[HASHED:[0-9a-f]+\]/g) || [];

      // The card numbers the creditCard rule hashes.
      expect({ name, hashed: tokens.length > 0 }).toEqual({
        name,
        hashed: true,
      });

      // Keyed, 16 hex characters: never the older 8 of an unkeyed hash.
      for (const token of tokens) {
        expect(token).toMatch(/^\[HASHED:[0-9a-f]{16}\]$/);
      }
    }
  });

  test("the batches reach every kind of row: logs, spans, metric points and exceptions from logs and spans", async () => {
    const tables: Map<string, number> = new Map();

    for (const testCase of CASES) {
      const written: string = await ingest(testCase);

      for (const match of written.matchAll(/^# (\S+) \((\d+) rows\)$/gm)) {
        tables.set(
          `${testCase.signal}:${match[1]}`,
          (tables.get(`${testCase.signal}:${match[1]}`) || 0) +
            Number(match[2]),
        );
      }
    }

    expect(Array.from(tables.keys()).sort()).toEqual([
      "logs:ExceptionItemV3",
      "logs:LogItemV3",
      "metrics:MetricItemV3",
      "traces:ExceptionItemV3",
      "traces:SpanItemV3",
    ]);

    for (const count of tables.values()) {
      expect(count).toBeGreaterThan(0);
    }
  });
});
