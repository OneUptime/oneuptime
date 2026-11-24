import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil, {
  GROUP_FINGERPRINT_LOOKUP_SQL,
  RECORD_SPLIT_PAIR_SQL,
  clearExistingV1FingerprintCache,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import * as FilterEvaluator from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import {
  foldSeparatedNumbers,
  normalizeExceptionText,
} from "Common/Server/Utils/Telemetry/ExceptionSanitizer";
import { FORMER_FINGERPRINT_OWNER_SQL } from "Common/Server/Utils/Telemetry/TelemetryExceptionRekey";
import {
  getExceptionGroupingKey,
  getExceptionGroupingText,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A NEW SCRUB RULE NO LONGER SPLITS AN EXCEPTION FOUND IN LOGS (#10434).
 *
 * An exception is grouped by a fingerprint of its message, stack trace and
 * type. The logs ingest made it from what the scrub rules left of a log, so
 * once a rule started hiding part of an exception's text the exception
 * became a new one: a new first seen, so New Exception fired again for an
 * old error, and its triage stayed on the old one. Now it is grouped by the
 * exception as it arrived, as a span's always was, and a new exception whose
 * hidden text the fingerprint would hash is grouped under a keyed one, so
 * the fingerprint gives nothing away.
 *
 * OTLP log and trace requests through OtelLogsIngestService and
 * OtelTracesIngestService, with the real scrub engines and pipelines, the
 * real grouping and the real upsert up to its statement. Only storage is a
 * stand-in: ClickHouse is the fan-in writer's rows, and the exceptions table
 * is a map that answers the ingest's reads and takes its upsert as the
 * statement does - a new fingerprint is a new exception, first seen at its
 * earliest occurrence, and a known one counts the batch's occurrences. A New
 * Exception monitor counts the exceptions first seen in its window, as
 * ExceptionMonitorMeasures does.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-00000000e434",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-00000000e434",
);
const SERVICE_NAME: string = "checkout-api";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID: string = "00f067aa0ba902b7";

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const STARTED_AT: number = Date.now();
// When the exception was seen before the rule, and after it was added.
const BEFORE: number = STARTED_AT - 3 * HOUR_MS;
const AFTER: number = STARTED_AT - HOUR_MS;
// The ten minutes a New Exception monitor looks back over.
const MONITOR_WINDOW_MS: number = 10 * MINUTE_MS;

const ERROR: number = 17;

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

type OtlpAttribute = { key: string; value: { stringValue: string } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

// What an exception said: as an exception event or a log's attributes carry it.
interface ExceptionText {
  type: string;
  message: string;
  stackTrace?: string | undefined;
}

// A rule, and a value in an exception's text that it hides.
interface RuleCase {
  name: string;
  rule: () => unknown;
  value: string;
}

// Which rules a log's and a span's copy meet, and which comes first.
interface ShareCase {
  name: string;
  traceRule: boolean;
  spanFirst: boolean;
}

// One exception of the stand-in table.
interface StoredException {
  id: string;
  fingerprint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occuranceCount: number;
  message: string;
  stackTrace: string;
  /*
   * A row that only keeps the former fingerprint of the exception with this
   * id, merged into it (#10619, TelemetryExceptionRekey).
   */
  formerFingerprintOf?: string | undefined;
  // The exception a scrub rule split this one from (#10618), by its id.
  splitFrom?: string | undefined;
}

let table: Map<string, StoredException>;
let lookupFails: boolean;
// The exceptions made so far, for their ids.
let made: number;
// The moves to a private fingerprint written, and whether they fail.
let movesWritten: number;
let movesFail: boolean;
// The statements that recorded a pair of exceptions a rule split.
let splitRecords: Array<Array<unknown>>;
let logRows: Array<JSONObject>;
let spanRows: Array<JSONObject>;
let exceptionRows: Array<JSONObject>;
let logRules: Array<unknown>;
let traceRules: Array<unknown>;
let logPipelines: Array<LoadedPipeline>;

function attribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function regexOf(
  service: unknown,
  patternType: string,
  customRegex?: string,
): ScrubRegExp {
  const regex: ScrubRegExp | null = (
    service as {
      getRegexForPattern: (
        patternType: string,
        customRegex?: string,
      ) => ScrubRegExp | null;
    }
  ).getRegexForPattern(patternType, customRegex);

  if (!regex) {
    throw new Error(`no pattern for ${patternType}`);
  }

  return regex;
}

// A project's log rule, as loadScrubRules hands it to ingest.
function logRule(data: {
  patternType: string;
  action?: string;
  fields?: string;
  customRegex?: string;
}): unknown {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = `Scrub ${data.patternType}`;
  rule.projectId = PROJECT_ID;
  rule.patternType = data.patternType;
  rule.scrubAction = data.action || LogScrubAction.Redact;
  rule.fieldsToScrub = data.fields || LogScrubField.Both;

  if (data.customRegex !== undefined) {
    rule.customRegex = data.customRegex;
  }

  return {
    rule: rule,
    regex: regexOf(LogScrubRuleService, data.patternType, data.customRegex),
  };
}

function traceRule(data: { patternType: string; action?: string }): unknown {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = `Scrub ${data.patternType}`;
  rule.projectId = PROJECT_ID;
  rule.patternType = data.patternType;
  rule.scrubAction = data.action || TraceScrubAction.Redact;
  rule.fieldsToScrub = TraceScrubField.All;

  return {
    rule: rule,
    regex: regexOf(TraceScrubRuleService, data.patternType),
  };
}

const EMAIL_RULE: () => unknown = (): unknown => {
  return logRule({ patternType: LogScrubPatternType.Email });
};

// The stand-in exceptions table: the ingest's reads, and its upsert.
function storeUpsert(params: Array<unknown>): void {
  // 14 values a row, in the statement's column order.
  for (let index: number = 0; index + 13 < params.length; index += 14) {
    const fingerprint: string = params[index + 2] as string;
    const message: string = (params[index + 3] as string) || "";
    const stackTrace: string = (params[index + 4] as string) || "";
    const firstSeenAt: Date = new Date(params[index + 6] as Date);
    const lastSeenAt: Date = new Date(params[index + 7] as Date);
    const count: number = Number(params[index + 8]);
    const stored: StoredException | undefined = table.get(fingerprint);

    if (!stored) {
      table.set(fingerprint, {
        id: `exception-${++made}`,
        fingerprint,
        firstSeenAt,
        lastSeenAt,
        occuranceCount: count,
        message,
        stackTrace,
      });
      continue;
    }

    stored.occuranceCount += count;
    stored.firstSeenAt =
      firstSeenAt < stored.firstSeenAt ? firstSeenAt : stored.firstSeenAt;
    stored.lastSeenAt =
      lastSeenAt > stored.lastSeenAt ? lastSeenAt : stored.lastSeenAt;
    stored.message = message || stored.message;
    stored.stackTrace = stackTrace || stored.stackTrace;
  }
}

// An exception made before this suite's ingest: before the rule, or before #10434.
function seed(fingerprint: string, at: number = BEFORE - HOUR_MS): void {
  table.set(fingerprint, {
    id: `exception-${++made}`,
    fingerprint,
    firstSeenAt: new Date(at),
    lastSeenAt: new Date(at),
    occuranceCount: 1,
    message: "",
    stackTrace: "",
  });
}

/*
 * The exceptions a New Exception monitor that runs just after `at` counts:
 * those first seen in its ten minutes (ExceptionMonitorMeasures, firstSeenAt
 * in the window).
 */
function newExceptionsAround(at: number): number {
  return exceptions().filter((exception: StoredException): boolean => {
    const firstSeen: number = exception.firstSeenAt.getTime();
    return firstSeen > at - MONITOR_WINDOW_MS && firstSeen <= at + MINUTE_MS;
  }).length;
}

/*
 * The exceptions of the table: not the rows that only keep an exception's
 * former fingerprint (#10619), which no list or monitor counts.
 */
function exceptions(): Array<StoredException> {
  return Array.from(table.values()).filter(
    (entry: StoredException): boolean => {
      return !entry.formerFingerprintOf;
    },
  );
}

function setupIngest(): void {
  for (const ingestService of [
    OtelLogsIngestService,
    OtelTracesIngestService,
  ]) {
    const service: IngestTestMethods =
      ingestService as unknown as IngestTestMethods;

    for (const method of AUTO_DISCOVERY_METHODS) {
      jest.spyOn(service, method).mockResolvedValue(null);
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
  }

  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockImplementation((() => {
    return Promise.resolve(logRules);
  }) as never);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockImplementation((() => {
      return Promise.resolve(traceRules);
    }) as never);
  jest.spyOn(LogPipelineService, "loadPipelines").mockImplementation((() => {
    return Promise.resolve(logPipelines);
  }) as never);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);

  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target === LogService) {
          logRows.push(...batch);
        } else if (target === SpanService) {
          spanRows.push(...batch);
        } else if (target === ExceptionInstanceService) {
          exceptionRows.push(...batch);
        } else {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }

        return { flushed: Promise.resolve() };
      },
    );

  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql === GROUP_FINGERPRINT_LOOKUP_SQL) {
          if (lookupFails) {
            throw new Error("connection reset");
          }

          return (params[1] as Array<string>)
            .filter((fingerprint: string): boolean => {
              return table.has(fingerprint);
            })
            .map((fingerprint: string) => {
              return {
                fingerprint,
                movedTo: ownerOf(table.get(fingerprint)!)?.fingerprint || null,
              };
            });
        }

        if (sql.includes('INSERT INTO "TelemetryException"')) {
          storeUpsert(params);
          // No exception was resolved, so none is reopened.
          return [];
        }

        if (sql === RECORD_SPLIT_PAIR_SQL) {
          splitRecords.push(params);
          const split: StoredException | undefined = table.get(
            params[2] as string,
          );
          const from: StoredException | undefined = table.get(
            params[3] as string,
          );

          if (split && from && !split.splitFrom && split !== from) {
            split.splitFrom = from.id;
          }

          return [];
        }

        // Nothing is merged.
        return [];
      },
    },
  } as never);

  // A move to a private fingerprint, as its transaction writes the table.
  jest
    .spyOn(TelemetryExceptionService, "executeTransaction")
    .mockImplementation(((
      run: (manager: unknown) => Promise<unknown>,
    ): Promise<unknown> => {
      if (movesFail) {
        return Promise.reject(new Error("deadlock detected"));
      }

      return run({
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          if (sql.includes("FOR UPDATE")) {
            const row: StoredException | undefined = table.get(
              params[2] as string,
            );

            return row
              ? [
                  {
                    id: row.id,
                    mergedIntoId: row.formerFingerprintOf || null,
                    formerFingerprintOfId: row.formerFingerprintOf || null,
                    primaryEntityType: "OpenTelemetry",
                    exceptionType: "",
                    firstSeenAt: row.firstSeenAt,
                    lastSeenAt: row.lastSeenAt,
                    firstSeenInRelease: "",
                    lastSeenInRelease: "",
                  },
                ]
              : [];
          }

          if (sql === FORMER_FINGERPRINT_OWNER_SQL) {
            const row: StoredException | undefined = table.get(
              params[2] as string,
            );
            const owner: StoredException | undefined = row
              ? ownerOf(row)
              : undefined;

            return owner ? [{ fingerprint: owner.fingerprint }] : [];
          }

          if (sql.startsWith(`SELECT "_id"::text AS "id"`)) {
            return table.has(params[2] as string) ? [{ id: "taken" }] : [];
          }

          if (sql.startsWith(`UPDATE "TelemetryException" SET "fingerprint"`)) {
            const exception: StoredException = Array.from(table.values()).find(
              (entry: StoredException): boolean => {
                return entry.id === params[1];
              },
            )!;

            table.delete(exception.fingerprint);
            exception.fingerprint = params[0] as string;
            table.set(exception.fingerprint, exception);
            movesWritten++;
            return [];
          }

          if (sql.startsWith(`INSERT INTO "TelemetryException"`)) {
            table.set(params[3] as string, {
              id: `exception-${++made}`,
              fingerprint: params[3] as string,
              firstSeenAt: params[5] as Date,
              lastSeenAt: params[6] as Date,
              occuranceCount: 0,
              message: "",
              stackTrace: "",
              formerFingerprintOf: params[10] as string,
            });
            return [];
          }

          throw new Error(`unexpected statement ${sql}`);
        },
      });
    }) as never);
  jest
    .spyOn(TelemetryExceptionService, "forgetGroupFingerprints")
    .mockResolvedValue(undefined as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
}

function request(body: JSONObject): TelemetryRequest {
  return {
    projectId: new ObjectID(PROJECT_ID.toString()),
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

function exceptionAttributes(exception: ExceptionText): Array<OtlpAttribute> {
  return [
    attribute("exception.type", exception.type),
    attribute("exception.message", exception.message),
    ...(exception.stackTrace
      ? [attribute("exception.stacktrace", exception.stackTrace)]
      : []),
  ];
}

function logRecord(data: {
  at: number;
  severityNumber?: number;
  body?: string;
  attributes?: Array<OtlpAttribute>;
  inSpan?: boolean;
}): JSONObject {
  return {
    timeUnixNano: `${data.at}000000`,
    severityNumber: data.severityNumber ?? ERROR,
    body: { stringValue: data.body ?? "request failed" },
    attributes: data.attributes ?? [],
    ...(data.inSpan ? { traceId: TRACE_ID, spanId: SPAN_ID } : {}),
  };
}

async function ingestLogs(records: Array<JSONObject>): Promise<void> {
  await OtelLogsIngestService.processLogsFromQueue(
    request({
      resourceLogs: [
        {
          resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
          scopeLogs: [{ scope: {}, logRecords: records }],
        },
      ],
    }),
  );
}

// An exception a log names with the exception.* attributes.
async function ingestLogException(
  exception: ExceptionText,
  at: number,
  inSpan: boolean = false,
): Promise<void> {
  await ingestLogs([
    logRecord({ at, attributes: exceptionAttributes(exception), inSpan }),
  ]);
}

// An exception a span's exception event records.
async function ingestSpanException(
  exception: ExceptionText,
  at: number,
): Promise<void> {
  await OtelTracesIngestService.processTracesFromQueue(
    request({
      resourceSpans: [
        {
          resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  parentSpanId: "",
                  name: "POST /checkout",
                  kind: 2,
                  startTimeUnixNano: `${at}000000`,
                  endTimeUnixNano: `${at}000000`,
                  status: { code: 2 },
                  attributes: [],
                  events: [
                    {
                      name: "exception",
                      timeUnixNano: `${at}000000`,
                      attributes: exceptionAttributes(exception),
                    },
                  ],
                  links: [],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
}

// An exception's fingerprints, made from what it said, as the ingest makes them.
function fingerprintsOf(exception: ExceptionText): {
  v1: string;
  keyedV1: string;
  v2: string;
  keyed: string;
  v3: string;
  keyedV3: string;
} {
  const content: {
    exceptionType: string;
    message: string;
    stackTrace: string;
  } = {
    exceptionType: exception.type,
    message: exception.message,
    stackTrace: exception.stackTrace || "",
  };

  return {
    v1: ExceptionUtil.getFingerprint({
      projectId: PROJECT_ID,
      primaryEntityId: SERVICE_ID,
      ...content,
    }),
    keyedV1: KeyedExceptionFingerprint.ofFirstGroupingText({
      projectId: PROJECT_ID,
      text: ExceptionUtil.getGroupingTextV1({
        projectId: PROJECT_ID,
        primaryEntityId: SERVICE_ID,
        ...content,
      }),
    }),
    v2: ExceptionUtil.getFingerprintV2({
      projectId: PROJECT_ID,
      primaryEntityId: SERVICE_ID,
      ...content,
    }),
    keyed: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: getExceptionGroupingText({
        projectId: PROJECT_ID.toString(),
        primaryEntityId: SERVICE_ID.toString(),
        key: getExceptionGroupingKey(content),
      }),
    }),
    // Grouping v3's (#10620), what a new exception is made under.
    v3: ExceptionUtil.getFingerprintV3({
      projectId: PROJECT_ID,
      primaryEntityId: SERVICE_ID,
      ...content,
    }),
    keyedV3: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: ExceptionUtil.getGroupingTexts({
        projectId: PROJECT_ID,
        primaryEntityId: SERVICE_ID,
        ...content,
      }).v3,
    }),
  };
}

function rowFingerprints(): Array<string> {
  return exceptionRows.map((row: JSONObject): string => {
    return row["fingerprint"] as string;
  });
}

function onlyException(): StoredException {
  expect(exceptions()).toHaveLength(1);
  return exceptions()[0]!;
}

// An exception with no stack trace, so grouping v2 reads its message.
const CART_EXCEPTION: ExceptionText = {
  type: "CartNotFoundError",
  message: "No cart for ada@example.com",
};

// The exception a row that keeps a former fingerprint is kept for.
function ownerOf(row: StoredException): StoredException | undefined {
  if (!row.formerFingerprintOf) {
    return undefined;
  }

  return Array.from(table.values()).find((entry: StoredException): boolean => {
    return entry.id === row.formerFingerprintOf;
  });
}

beforeEach(() => {
  table = new Map<string, StoredException>();
  lookupFails = false;
  made = 0;
  movesWritten = 0;
  movesFail = false;
  splitRecords = [];
  logRows = [];
  spanRows = [];
  exceptionRows = [];
  logRules = [];
  traceRules = [];
  logPipelines = [];
  clearExistingV1FingerprintCache();
  setupIngest();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an exception found in a log, before and after a scrub rule", () => {
  test("keeps its fingerprint when an email Redact rule is added: one exception, and New Exception fires once", async () => {
    await ingestLogException(CART_EXCEPTION, BEFORE);

    const before: StoredException = onlyException();
    expect(newExceptionsAround(BEFORE)).toBe(1);

    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, AFTER);

    // The same exception, counted again, and not new again.
    expect(onlyException()).toBe(before);
    expect(before.occuranceCount).toBe(2);
    expect(rowFingerprints()).toEqual([before.fingerprint, before.fingerprint]);
    expect(newExceptionsAround(AFTER)).toBe(0);
    expect(newExceptionsAround(BEFORE)).toBe(1);
  });

  test("its stored message is still scrubbed, and the address is stored nowhere", async () => {
    await ingestLogException(CART_EXCEPTION, BEFORE);

    logRules = [EMAIL_RULE()];
    exceptionRows = [];
    logRows = [];
    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["message"]).toBe("No cart for [REDACTED]");
    expect(onlyException().message).toBe("No cart for [REDACTED]");
    expect(JSON.stringify(exceptionRows)).not.toContain("ada@example.com");
    expect(JSON.stringify(logRows)).not.toContain("ada@example.com");
  });

  test("the occurrence row and the exception it counts on agree, and the row keeps no fingerprint of its own beside it", async () => {
    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([onlyException().fingerprint]);
    expect(exceptionRows[0]).not.toHaveProperty("fingerprintV2");
    expect(exceptionRows[0]).not.toHaveProperty("fingerprintCandidates");
  });

  /*
   * Each kind of rule and action, over an exception named in attributes and
   * one found in a log's body at Error severity.
   */
  const RULES: Array<RuleCase> = [
    {
      name: "Email, Redact",
      rule: EMAIL_RULE,
      value: "ada@example.com",
    },
    {
      name: "Email, Mask",
      rule: (): unknown => {
        return logRule({
          patternType: LogScrubPatternType.Email,
          action: LogScrubAction.Mask,
        });
      },
      value: "ada@example.com",
    },
    {
      name: "Email, Hash",
      rule: (): unknown => {
        return logRule({
          patternType: LogScrubPatternType.Email,
          action: LogScrubAction.Hash,
        });
      },
      value: "ada@example.com",
    },
    {
      name: "SSN, Redact",
      rule: (): unknown => {
        return logRule({ patternType: LogScrubPatternType.SSN });
      },
      value: "123-45-6789",
    },
    {
      name: "Credit Card, Mask",
      rule: (): unknown => {
        return logRule({
          patternType: LogScrubPatternType.CreditCard,
          action: LogScrubAction.Mask,
        });
      },
      value: "4111 1111 1111 1111",
    },
    {
      name: "Phone Number, Hash",
      rule: (): unknown => {
        return logRule({
          patternType: LogScrubPatternType.PhoneNumber,
          action: LogScrubAction.Hash,
        });
      },
      value: "555-123-4567",
    },
    {
      name: "Custom Regex, Redact",
      rule: (): unknown => {
        return logRule({
          patternType: LogScrubPatternType.Custom,
          customRegex: "acct-[0-9]{4}",
        });
      },
      value: "acct-4821",
    },
  ];

  describe.each(RULES)("a $name rule", ({ rule, value }: RuleCase) => {
    const exception: ExceptionText = {
      type: "PaymentDeclinedError",
      message: `payment declined for ${value}`,
    };
    const stackTrace: string = [
      `PaymentDeclinedError: payment declined for ${value}`,
      "    at charge (/app/src/payments.ts:42:11)",
      "    at checkout (/app/src/cart.ts:10:15)",
    ].join("\n");

    test("added to an exception named in a log's attributes: one exception", async () => {
      await ingestLogException(exception, BEFORE);
      const before: StoredException = onlyException();
      const fingerprints: { v3: string; keyedV3: string } =
        fingerprintsOf(exception);

      logRules = [rule()];
      await ingestLogException(exception, AFTER);

      expect(onlyException()).toBe(before);
      expect(before.occuranceCount).toBe(2);
      expect(newExceptionsAround(AFTER)).toBe(0);
      expect(exceptionRows[1]!["message"]).not.toContain(value);

      /*
       * Made under grouping v3, whose text folds an email address, a card
       * number, an SSN and a phone number: it keeps its fingerprint. A value
       * nothing folds was in the text its fingerprint hashes: it moved to the
       * private fingerprint, its old one kept by a row of its own (#10619).
       */
      if (foldSeparatedNumbers(normalizeExceptionText(value)) !== value) {
        expect(before.fingerprint).toBe(fingerprints.v3);
        expect(movesWritten).toBe(0);
      } else {
        expect(before.fingerprint).toBe(fingerprints.keyedV3);
        expect(table.get(fingerprints.v3)?.formerFingerprintOf).toBe(before.id);
      }
    });

    test("added to an exception found in a log's body: one exception", async () => {
      const record: (at: number) => JSONObject = (at: number): JSONObject => {
        return logRecord({ at, body: stackTrace });
      };

      await ingestLogs([record(BEFORE)]);
      const before: StoredException = onlyException();

      logRules = [rule()];
      await ingestLogs([record(AFTER)]);

      expect(onlyException()).toBe(before);
      expect(newExceptionsAround(AFTER)).toBe(0);
      expect(exceptionRows[1]!["stackTrace"]).not.toContain(value);
    });

    test("on before the exception is first seen, then changed or taken off: one exception throughout", async () => {
      logRules = [rule()];
      await ingestLogException(exception, BEFORE);
      const first: StoredException = onlyException();

      // Another worker, which has read nothing yet, without the rule.
      clearExistingV1FingerprintCache();
      logRules = [];
      await ingestLogException(exception, AFTER);

      expect(onlyException()).toBe(first);
      expect(first.occuranceCount).toBe(2);
    });
  });

  test("a rule that changes its action keeps the exception", async () => {
    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, BEFORE);
    const first: StoredException = onlyException();

    logRules = [
      logRule({
        patternType: LogScrubPatternType.Email,
        action: LogScrubAction.Mask,
      }),
    ];
    clearExistingV1FingerprintCache();
    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(onlyException()).toBe(first);
  });

  test("an exception made before grouping v2 keeps its first fingerprint when a rule starts hiding part of its stack trace", async () => {
    const exception: ExceptionText = {
      type: "TypeError",
      message: "no cart for ada@example.com",
      stackTrace: [
        "TypeError: no cart for ada@example.com",
        "    at checkout (/app/src/cart.ts:10:15)",
      ].join("\n"),
    };
    const madeBeforeV2: string = fingerprintsOf(exception).v1;
    seed(madeBeforeV2);

    logRules = [EMAIL_RULE()];
    await ingestLogException(exception, AFTER);

    expect(rowFingerprints()).toEqual([madeBeforeV2]);
    expect(table.size).toBe(1);
    expect(newExceptionsAround(AFTER)).toBe(0);
  });

  test("a rule on the body alone, over an exception named in attributes, changes nothing of its group", async () => {
    logRules = [
      logRule({
        patternType: LogScrubPatternType.Email,
        fields: LogScrubField.Body,
      }),
    ];
    await ingestLogException(CART_EXCEPTION, AFTER);

    // Nothing hidden: grouped by v3, as an exception no rule touched.
    expect(rowFingerprints()).toEqual([fingerprintsOf(CART_EXCEPTION).v3]);
    expect(exceptionRows[0]!["message"]).toBe(CART_EXCEPTION.message);
  });
});

describe("a log's copy and a span's copy of one exception", () => {
  const cases: Array<ShareCase> = [
    {
      name: "a log rule only, the log first",
      traceRule: false,
      spanFirst: false,
    },
    {
      name: "a log rule only, the span first",
      traceRule: false,
      spanFirst: true,
    },
    {
      name: "a log and a trace rule, the log first",
      traceRule: true,
      spanFirst: false,
    },
    {
      name: "a log and a trace rule, the span first",
      traceRule: true,
      spanFirst: true,
    },
  ];

  test.each(cases)(
    "share one exception with the rule on: $name",
    async ({ traceRule: withTraceRule, spanFirst }: ShareCase) => {
      logRules = [EMAIL_RULE()];
      traceRules = withTraceRule
        ? [traceRule({ patternType: TraceScrubPatternType.Email })]
        : [];

      if (spanFirst) {
        await ingestSpanException(CART_EXCEPTION, BEFORE);
        await ingestLogException(CART_EXCEPTION, AFTER, true);
      } else {
        await ingestLogException(CART_EXCEPTION, BEFORE, true);
        await ingestSpanException(CART_EXCEPTION, AFTER);
      }

      expect(exceptionRows).toHaveLength(2);
      expect(new Set(rowFingerprints()).size).toBe(1);
      expect(onlyException().occuranceCount).toBe(2);
      expect(newExceptionsAround(AFTER)).toBe(0);
    },
  );

  test("share one exception read by another worker, each in its own process", async () => {
    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, BEFORE, true);

    clearExistingV1FingerprintCache();
    await ingestSpanException(CART_EXCEPTION, AFTER);

    expect(new Set(rowFingerprints()).size).toBe(1);
    expect(table.size).toBe(1);
  });
});

describe("the fingerprint never gives away what a rule hid", () => {
  // An exception whose message holds a value the normalizer keeps.
  const ssnException: (lastFour: string) => ExceptionText = (
    lastFour: string,
  ): ExceptionText => {
    return {
      type: "InvalidSsnError",
      message: `Invalid SSN 123-45-${lastFour} on file`,
    };
  };
  const SSN_RULE: () => unknown = (): unknown => {
    return logRule({ patternType: LogScrubPatternType.SSN });
  };

  // Every last four digits: what anyone who reads the exception would try.
  function guessesMatching(fingerprint: string): Array<string> {
    const found: Array<string> = [];

    for (let value: number = 0; value < 10000; value++) {
      const lastFour: string = value.toString().padStart(4, "0");
      const guess: { v1: string; v2: string } = fingerprintsOf(
        ssnException(lastFour),
      );

      if (guess.v1 === fingerprint || guess.v2 === fingerprint) {
        found.push(lastFour);
      }
    }

    return found;
  }

  test("without a rule, the value is stored as it is, and an unkeyed fingerprint of the text that holds it can be worked back to it", async () => {
    await ingestLogException(ssnException("6789"), AFTER);

    expect(exceptionRows[0]!["message"]).toContain("6789");
    // The attack is real: grouping v2's fingerprint, made before v3, gives it.
    expect(guessesMatching(fingerprintsOf(ssnException("6789")).v2)).toEqual([
      "6789",
    ]);
    // Grouping v3's, which a new exception is made under, folds the number.
    expect(rowFingerprints()).toEqual([
      fingerprintsOf(ssnException("6789")).v3,
    ]);
    expect(guessesMatching(rowFingerprints()[0]!)).toEqual([]);
  });

  test("a new exception first seen with a rule: no guess at the hidden value matches its fingerprint", async () => {
    logRules = [SSN_RULE()];
    await ingestLogException(ssnException("6789"), AFTER);

    const fingerprint: string = onlyException().fingerprint;
    const arrived: { v1: string; v2: string; v3: string } = fingerprintsOf(
      ssnException("6789"),
    );

    expect(rowFingerprints()).toEqual([fingerprint]);
    expect(fingerprint).not.toBe(arrived.v1);
    expect(fingerprint).not.toBe(arrived.v2);
    expect(guessesMatching(fingerprint)).toEqual([]);
    /*
     * Grouping v3's: its text holds <SSN>, the same for every number, so it
     * says nothing of this one (#10620), and needs no key.
     */
    expect(fingerprint).toBe(arrived.v3);
    expect(fingerprintsOf(ssnException("0000")).v3).toBe(fingerprint);
    expect(JSON.stringify(exceptionRows)).not.toContain("6789");
    expect(onlyException().message).toBe("Invalid SSN [REDACTED] on file");
  });

  test("nor when the exceptions cannot be read and the occurrence is filed on its own", async () => {
    logRules = [SSN_RULE()];
    lookupFails = true;
    await ingestLogException(ssnException("6789"), AFTER);

    expect(rowFingerprints()).toHaveLength(1);
    expect(guessesMatching(rowFingerprints()[0]!)).toEqual([]);
    expect(rowFingerprints()[0]).toBe(fingerprintsOf(ssnException("6789")).v3);
  });

  test("the same holds for a span's exception a trace rule hid part of", async () => {
    traceRules = [traceRule({ patternType: TraceScrubPatternType.SSN })];
    await ingestSpanException(ssnException("6789"), AFTER);

    expect(guessesMatching(onlyException().fingerprint)).toEqual([]);
    expect(onlyException().fingerprint).toBe(
      fingerprintsOf(ssnException("6789")).v3,
    );
    expect(JSON.stringify(exceptionRows)).not.toContain("6789");
  });

  test("a rule that hides only what the fingerprint leaves out - a stack trace's message - leaves the exception grouped as it would be without the rule", async () => {
    const exception: ExceptionText = {
      type: "TypeError",
      message: "no cart for ada@example.com",
      stackTrace: [
        "TypeError: no cart for ada@example.com",
        "    at checkout (/app/src/cart.ts:10:15)",
      ].join("\n"),
    };

    logRules = [EMAIL_RULE()];
    await ingestLogException(exception, AFTER);

    // Grouping v2 reads the frames: nothing hidden is in what it hashes.
    expect(rowFingerprints()).toEqual([fingerprintsOf(exception).v2]);
  });
});

describe("span exceptions", () => {
  test("with no trace rule, a span's exception is grouped as any new exception is, by v3, whatever the log rules", async () => {
    logRules = [EMAIL_RULE()];
    await ingestSpanException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([fingerprintsOf(CART_EXCEPTION).v3]);
    expect(exceptionRows[0]!["message"]).toBe(CART_EXCEPTION.message);
  });

  test("one made before grouping v2 keeps its first fingerprint", async () => {
    seed(fingerprintsOf(CART_EXCEPTION).v1);

    await ingestSpanException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([fingerprintsOf(CART_EXCEPTION).v1]);
    expect(table.size).toBe(1);
  });

  test("one seen before a trace rule keeps its occurrences when the rule starts hiding part of it", async () => {
    await ingestSpanException(CART_EXCEPTION, BEFORE);
    const before: StoredException = onlyException();

    traceRules = [traceRule({ patternType: TraceScrubPatternType.Email })];
    await ingestSpanException(CART_EXCEPTION, AFTER);

    expect(onlyException()).toBe(before);
    expect(newExceptionsAround(AFTER)).toBe(0);
    expect(exceptionRows[1]!["message"]).toBe("No cart for [REDACTED]");
  });

  test("a new one whose text a trace rule hid is grouped under v3 when its text folds the value: an email address", async () => {
    traceRules = [traceRule({ patternType: TraceScrubPatternType.Email })];
    await ingestSpanException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([fingerprintsOf(CART_EXCEPTION).v3]);
  });

  test("and under the keyed fingerprint when the value reaches the text it hashes: a name", async () => {
    const named: ExceptionText = {
      type: "AccountError",
      message: "No account for Ada Lovelace",
    };
    logRules = [
      logRule({
        patternType: LogScrubPatternType.Custom,
        customRegex: "Ada Lovelace",
      }),
    ];
    await ingestLogException(named, AFTER);

    expect(rowFingerprints()).toEqual([fingerprintsOf(named).keyedV3]);
  });
});

/*
 * Before #10434 an exception found in a log was grouped by what the rules
 * left: a rule split it into an exception of its own, which every occurrence
 * since has counted on. Those keep their occurrences, so an upgrade moves
 * nothing and makes nothing new; a person merges the two to rejoin them.
 */
describe("exceptions a rule split before #10434", () => {
  const REDACTED: ExceptionText = {
    ...CART_EXCEPTION,
    message: "No cart for [REDACTED]",
  };

  test("keep the occurrences they have had since, beside the exception from before the rule", async () => {
    const fromBeforeTheRule: string = fingerprintsOf(CART_EXCEPTION).v2;
    const splitByTheRule: string = fingerprintsOf(REDACTED).v2;
    seed(fromBeforeTheRule, BEFORE - 2 * HOUR_MS);
    seed(splitByTheRule, BEFORE);

    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([splitByTheRule]);
    expect(table.size).toBe(2);
    expect(table.get(splitByTheRule)!.occuranceCount).toBe(2);
    expect(table.get(fromBeforeTheRule)!.occuranceCount).toBe(1);
    expect(newExceptionsAround(AFTER)).toBe(0);

    // The pair is recorded on the split one, so its page offers Merge (#10618).
    expect(table.get(splitByTheRule)!.splitFrom).toBe(
      table.get(fromBeforeTheRule)!.id,
    );
    expect(table.get(fromBeforeTheRule)!.splitFrom).toBeUndefined();
  });

  test("the pair is recorded once, by an occurrence of either kind the rule changed, and nothing is merged", async () => {
    const fromBeforeTheRule: string = fingerprintsOf(CART_EXCEPTION).v2;
    const splitByTheRule: string = fingerprintsOf(REDACTED).v2;
    seed(fromBeforeTheRule, BEFORE - 2 * HOUR_MS);
    seed(splitByTheRule, BEFORE);

    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, AFTER);
    await ingestLogException(CART_EXCEPTION, AFTER + MINUTE_MS);
    await ingestLogs([
      logRecord({
        at: AFTER + 2 * MINUTE_MS,
        body: "No cart for ada@example.com",
      }),
    ]);

    // One statement for the pair in this process, however many occurrences.
    expect(splitRecords).toEqual([
      [
        PROJECT_ID.toString(),
        SERVICE_ID.toString(),
        splitByTheRule,
        fromBeforeTheRule,
      ],
    ]);
    // Both keep their own occurrences: only a person merges them.
    expect(table.get(splitByTheRule)!.occuranceCount).toBe(3);
    expect(table.get(fromBeforeTheRule)!.occuranceCount).toBe(1);
  });

  test("an exception first seen after the rule, with none from before it, is no split pair", async () => {
    const splitByTheRule: string = fingerprintsOf(REDACTED).v2;
    seed(splitByTheRule, BEFORE);

    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(splitRecords).toEqual([]);
    expect(table.get(splitByTheRule)!.splitFrom).toBeUndefined();
  });

  test("an occurrence no rule changed records no pair: nothing tells it what a rule split", async () => {
    const fromBeforeTheRule: string = fingerprintsOf(CART_EXCEPTION).v2;
    const splitByTheRule: string = fingerprintsOf(REDACTED).v2;
    seed(fromBeforeTheRule, BEFORE - 2 * HOUR_MS);
    seed(splitByTheRule, BEFORE);

    await ingestLogException(CART_EXCEPTION, AFTER);
    await ingestSpanException(CART_EXCEPTION, AFTER);

    expect(splitRecords).toEqual([]);
  });

  test("one first seen after the rule keeps its occurrences: the upgrade makes no new exception of it", async () => {
    const splitByTheRule: string = fingerprintsOf(REDACTED).v2;
    seed(splitByTheRule, BEFORE);

    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([splitByTheRule]);
    expect(table.size).toBe(1);
    expect(newExceptionsAround(AFTER)).toBe(0);
  });

  test("one made before grouping v2 that a rule split keeps its occurrences too", async () => {
    const splitByTheRule: string = fingerprintsOf(REDACTED).v1;
    seed(splitByTheRule, BEFORE);

    logRules = [EMAIL_RULE()];
    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([splitByTheRule]);
    expect(table.size).toBe(1);
  });

  test("an occurrence no rule hides anything of goes to the exception from before the rule", async () => {
    const fromBeforeTheRule: string = fingerprintsOf(CART_EXCEPTION).v2;
    const splitByTheRule: string = fingerprintsOf(REDACTED).v2;
    seed(fromBeforeTheRule, BEFORE - 2 * HOUR_MS);
    seed(splitByTheRule, BEFORE);

    await ingestLogException(CART_EXCEPTION, AFTER);

    expect(rowFingerprints()).toEqual([fromBeforeTheRule]);
  });
});

describe("two copies of one new exception in one batch", () => {
  // A rule that hides one address: the other copy's text is not changed.
  const ONE_ADDRESS_RULE: () => unknown = (): unknown => {
    return logRule({
      patternType: LogScrubPatternType.Custom,
      customRegex: "ada@example\\.com",
    });
  };
  const OTHER_ADDRESS: ExceptionText = {
    ...CART_EXCEPTION,
    message: "No cart for bo@example.org",
  };

  test.each([
    ["the hidden one first", [CART_EXCEPTION, OTHER_ADDRESS]],
    ["the other first", [OTHER_ADDRESS, CART_EXCEPTION]],
  ])(
    "one a rule changed and one it did not make one exception: %s",
    async (_name: string, exceptions: Array<ExceptionText>) => {
      logRules = [ONE_ADDRESS_RULE()];

      await ingestLogs(
        exceptions.map((exception: ExceptionText): JSONObject => {
          return logRecord({
            at: AFTER,
            attributes: exceptionAttributes(exception),
          });
        }),
      );

      expect(exceptionRows).toHaveLength(2);
      expect(new Set(rowFingerprints()).size).toBe(1);
      expect(onlyException().occuranceCount).toBe(2);
    },
  );
});

describe("an exception a log pipeline names", () => {
  // A vendor's error fields, named as OpenTelemetry's by a pipeline.
  function remapPipeline(): LoadedPipeline {
    return {
      pipeline: { name: "vendor errors" },
      compiledFilter: FilterEvaluator.compileFilter(""),
      processors: [
        {
          name: "type",
          processorType: LogPipelineProcessorType.AttributeRemapper,
          configuration: {
            sourceKey: "error.kind",
            targetKey: "exception.type",
          },
        },
        {
          name: "message",
          processorType: LogPipelineProcessorType.AttributeRemapper,
          configuration: {
            sourceKey: "error.text",
            targetKey: "exception.message",
          },
        },
      ],
    } as unknown as LoadedPipeline;
  }

  function vendorRecord(at: number): JSONObject {
    return logRecord({
      at,
      severityNumber: 9,
      attributes: [
        attribute("error.kind", CART_EXCEPTION.type),
        attribute("error.text", CART_EXCEPTION.message),
      ],
    });
  }

  test("keeps its group when a rule hides part of what the pipeline named", async () => {
    logPipelines = [remapPipeline()];

    await ingestLogs([vendorRecord(BEFORE)]);
    const before: StoredException = onlyException();

    logRules = [EMAIL_RULE()];
    await ingestLogs([vendorRecord(AFTER)]);

    expect(onlyException()).toBe(before);
    expect(newExceptionsAround(AFTER)).toBe(0);
    expect(exceptionRows[1]!["message"]).toBe("No cart for [REDACTED]");
  });

  test("a record the rules change nothing in goes through the pipelines once; an exception record they change, once more for its group", async () => {
    logPipelines = [remapPipeline()];
    const processLog: jest.SpyInstance = jest.spyOn(
      LogPipelineService,
      "processLog",
    );

    // A rule with nothing to hide.
    logRules = [logRule({ patternType: LogScrubPatternType.SSN })];
    await ingestLogs([
      vendorRecord(AFTER),
      logRecord({ at: AFTER, severityNumber: 9, body: "signed in" }),
    ]);

    expect(processLog).toHaveBeenCalledTimes(2);

    processLog.mockClear();
    logRules = [EMAIL_RULE()];
    await ingestLogs([
      vendorRecord(AFTER),
      logRecord({
        at: AFTER,
        severityNumber: 9,
        body: "signed in as ada@example.com",
      }),
    ]);

    // The exception record's copy as it arrived; the other holds no exception.
    expect(processLog).toHaveBeenCalledTimes(3);
  });
});

/*
 * An exception made before #10434 - a span's, or any made before its rule -
 * keeps the unkeyed fingerprint it was made under, and that fingerprint
 * hashes what the rule now hides: whoever reads it and the redacted message
 * hashes every guess and gets the value back. Its next occurrence the rule
 * changed moves it to the keyed fingerprint of the same text, keeping the
 * old one only as a row merged into it, so its occurrences from before stay
 * its own: nothing split, nothing new (#10619).
 */
describe("an exception whose unkeyed fingerprint hashes what a rule now hides", () => {
  const ssnException: ExceptionText = {
    type: "InvalidSsnError",
    message: "Invalid SSN 123-45-6789 on file",
  };
  const SSN_TRACE_RULE: () => unknown = (): unknown => {
    return traceRule({ patternType: TraceScrubPatternType.SSN });
  };

  // Every guess at the last four digits whose unkeyed fingerprint is this one.
  function lastFourMatching(fingerprint: string): Array<string> {
    const found: Array<string> = [];

    for (let value: number = 0; value < 10000; value++) {
      const lastFour: string = value.toString().padStart(4, "0");
      const guess: { v1: string; v2: string } = fingerprintsOf({
        ...ssnException,
        message: `Invalid SSN 123-45-${lastFour} on file`,
      });

      if (guess.v1 === fingerprint || guess.v2 === fingerprint) {
        found.push(lastFour);
      }
    }

    return found;
  }

  function exceptionWithId(id: string): StoredException {
    const found: StoredException | undefined = Array.from(table.values()).find(
      (entry: StoredException): boolean => {
        return entry.id === id;
      },
    );

    expect(found).toBeDefined();
    return found!;
  }

  /*
   * A span's exception from before #10434 and grouping v3, grouped under its
   * unkeyed v2, which holds the number.
   */
  async function spanExceptionFromBefore(): Promise<StoredException> {
    seed(fingerprintsOf(ssnException).v2, BEFORE);

    const before: StoredException = onlyException();
    expect(before.fingerprint).toBe(fingerprintsOf(ssnException).v2);
    // Anyone who reads it can work the number back.
    expect(lastFourMatching(before.fingerprint)).toEqual(["6789"]);

    return before;
  }

  test("moves to the private fingerprint on its next occurrence: the same exception, counted again, and New Exception does not fire", async () => {
    const before: StoredException = await spanExceptionFromBefore();

    traceRules = [SSN_TRACE_RULE()];
    await ingestSpanException(ssnException, AFTER);

    const exception: StoredException = exceptionWithId(before.id);
    const keyed: string = fingerprintsOf(ssnException).keyed;

    expect(exception).toBe(before);
    expect(exception.fingerprint).toBe(keyed);
    expect(exception.occuranceCount).toBe(2);
    expect(newExceptionsAround(AFTER)).toBe(0);
    // Its new occurrence carries the private fingerprint.
    expect(rowFingerprints()).toEqual([keyed]);
    // Which gives no guess back, and the number is stored nowhere new.
    expect(lastFourMatching(exception.fingerprint)).toEqual([]);
    expect(JSON.stringify(exceptionRows[0])).not.toContain("6789");
  });

  test("keeps its old fingerprint only as a row merged into it, which the occurrences from before still carry", async () => {
    const before: StoredException = await spanExceptionFromBefore();
    const oldFingerprint: string = before.fingerprint;
    const firstSeenAt: Date = before.firstSeenAt;

    traceRules = [SSN_TRACE_RULE()];
    await ingestSpanException(ssnException, AFTER);

    expect(table.size).toBe(2);

    const kept: StoredException = table.get(oldFingerprint)!;
    expect(kept.formerFingerprintOf).toBe(before.id);
    expect(kept.occuranceCount).toBe(0);
    // When the occurrences it stands for were seen: the exception's, till now.
    expect(kept.firstSeenAt).toEqual(firstSeenAt);
    expect(movesWritten).toBe(1);
  });

  test("every later occurrence goes to the private fingerprint: in another process, with the rule removed, or from a log", async () => {
    const before: StoredException = await spanExceptionFromBefore();
    const keyed: string = fingerprintsOf(ssnException).keyed;

    traceRules = [SSN_TRACE_RULE()];
    await ingestSpanException(ssnException, AFTER);

    // Another worker, which read nothing before: found through the old one.
    clearExistingV1FingerprintCache();
    exceptionRows = [];
    await ingestSpanException(ssnException, AFTER + MINUTE_MS);

    // The rule removed: an occurrence no rule changed finds it the same way.
    clearExistingV1FingerprintCache();
    traceRules = [];
    await ingestSpanException(ssnException, AFTER + 2 * MINUTE_MS);

    // A log's copy, a log rule hiding the number.
    clearExistingV1FingerprintCache();
    logRules = [logRule({ patternType: LogScrubPatternType.SSN })];
    await ingestLogException(ssnException, AFTER + 3 * MINUTE_MS);

    expect(rowFingerprints()).toEqual([keyed, keyed, keyed]);
    expect(exceptionWithId(before.id).occuranceCount).toBe(5);
    expect(table.size).toBe(2);
    // Moved once.
    expect(movesWritten).toBe(1);
  });

  test("a log's copy a rule changed moves it too", async () => {
    const before: StoredException = await spanExceptionFromBefore();

    logRules = [logRule({ patternType: LogScrubPatternType.SSN })];
    await ingestLogException(ssnException, AFTER);

    expect(exceptionWithId(before.id).fingerprint).toBe(
      fingerprintsOf(ssnException).keyed,
    );
    expect(newExceptionsAround(AFTER)).toBe(0);
  });

  test("one made before grouping v2 moves to the private fingerprint of its first fingerprint's text, and is found there", async () => {
    const fingerprints: { v1: string; keyedV1: string } =
      fingerprintsOf(ssnException);
    seed(fingerprints.v1);
    const before: StoredException = onlyException();

    traceRules = [SSN_TRACE_RULE()];
    await ingestSpanException(ssnException, AFTER);

    expect(before.fingerprint).toBe(fingerprints.keyedV1);
    expect(table.get(fingerprints.v1)!.formerFingerprintOf).toBe(before.id);

    clearExistingV1FingerprintCache();
    await ingestSpanException(ssnException, AFTER + MINUTE_MS);

    expect(rowFingerprints()).toEqual([
      fingerprints.keyedV1,
      fingerprints.keyedV1,
    ]);
    expect(before.occuranceCount).toBe(3);
    expect(lastFourMatching(before.fingerprint)).toEqual([]);
  });

  test("one whose fingerprint never held what the rule hid stays where it is: an email address is folded before it is hashed", async () => {
    await ingestSpanException(CART_EXCEPTION, BEFORE);
    const before: StoredException = onlyException();
    const fingerprint: string = before.fingerprint;

    traceRules = [traceRule({ patternType: TraceScrubPatternType.Email })];
    await ingestSpanException(CART_EXCEPTION, AFTER);

    expect(onlyException()).toBe(before);
    expect(before.fingerprint).toBe(fingerprint);
    expect(movesWritten).toBe(0);
  });

  test("the private fingerprint taken by another exception: nothing moves and nothing merges", async () => {
    const fingerprints: { v2: string; keyed: string } =
      fingerprintsOf(ssnException);
    seed(fingerprints.v2, BEFORE - 2 * HOUR_MS);
    seed(fingerprints.keyed, BEFORE);

    traceRules = [SSN_TRACE_RULE()];
    await ingestSpanException(ssnException, AFTER);

    expect(rowFingerprints()).toEqual([fingerprints.v2]);
    expect(table.get(fingerprints.v2)!.occuranceCount).toBe(2);
    expect(table.get(fingerprints.keyed)!.occuranceCount).toBe(1);
    expect(table.size).toBe(2);
    expect(movesWritten).toBe(0);
  });

  test("a move that fails loses nothing: the occurrence counts on the exception under its old fingerprint, and a later one moves it", async () => {
    const before: StoredException = await spanExceptionFromBefore();
    const oldFingerprint: string = before.fingerprint;

    traceRules = [SSN_TRACE_RULE()];
    movesFail = true;
    await ingestSpanException(ssnException, AFTER);

    expect(rowFingerprints()).toEqual([oldFingerprint]);
    expect(before.occuranceCount).toBe(2);
    expect(table.size).toBe(1);

    // Not tried again by this process for a while...
    movesFail = false;
    await ingestSpanException(ssnException, AFTER + MINUTE_MS);
    expect(movesWritten).toBe(0);

    // ...but by the next one to read it.
    clearExistingV1FingerprintCache();
    await ingestSpanException(ssnException, AFTER + 2 * MINUTE_MS);

    expect(before.fingerprint).toBe(fingerprintsOf(ssnException).keyed);
    expect(before.occuranceCount).toBe(4);
    expect(movesWritten).toBe(1);
  });
});

/*
 * An exception with no stack trace is grouped by its message, with the
 * values that change from call to call taken out. Before grouping v3 that
 * left in the numbers people write with separators, so every card, Social
 * Security or phone number made an exception of its own, and set off New
 * Exception. New exceptions are grouped by v3, which folds them; an
 * exception made before keeps the fingerprint it was made under, found
 * first, so nothing splits or merges on upgrade (#10620).
 */
describe("an exception whose message holds a card number in groups, an SSN or a phone number", () => {
  interface NumberCase {
    name: string;
    type: string;
    messages: Array<string>;
  }

  const CASES: Array<NumberCase> = [
    {
      name: "a card number in groups",
      type: "PaymentDeclinedError",
      messages: [
        "card 4111-1111-1111-1234 declined",
        "card 5500-0000-0000-0004 declined",
        "card 4111 1111 1111 9876 declined",
      ],
    },
    {
      name: "a Social Security number",
      type: "InvalidSsnError",
      messages: [
        "Invalid SSN 123-45-6789 on file",
        "Invalid SSN 987-65-4321 on file",
        "Invalid SSN 555-11-2222 on file",
      ],
    },
    {
      name: "a phone number with separators",
      type: "CallFailedError",
      messages: [
        "call 555-123-4567 failed",
        "call 555.987.6543 failed",
        "call (555) 222-3333 failed",
      ],
    },
  ];

  function textsOf(numberCase: NumberCase): Array<ExceptionText> {
    return numberCase.messages.map((message: string): ExceptionText => {
      return { type: numberCase.type, message };
    });
  }

  test.each(CASES)(
    "$name: every value is one exception, from logs and spans alike, and New Exception fires once",
    async (numberCase: NumberCase) => {
      const [first, second, third] = textsOf(numberCase) as [
        ExceptionText,
        ExceptionText,
        ExceptionText,
      ];

      await ingestLogException(first, BEFORE);
      await ingestSpanException(second, BEFORE + MINUTE_MS);
      clearExistingV1FingerprintCache();
      await ingestLogException(third, BEFORE + 2 * MINUTE_MS);

      const exception: StoredException = onlyException();
      expect(exception.occuranceCount).toBe(3);
      expect(exception.fingerprint).toBe(fingerprintsOf(first).v3);
      expect(new Set(rowFingerprints()).size).toBe(1);
      expect(newExceptionsAround(BEFORE)).toBe(1);
    },
  );

  test.each(CASES)(
    "$name: an exception made before for one value keeps it, and every value since goes to one new exception",
    async (numberCase: NumberCase) => {
      const [first, second, third] = textsOf(numberCase) as [
        ExceptionText,
        ExceptionText,
        ExceptionText,
      ];
      // Made under grouping v2, one exception per value, before the upgrade.
      seed(fingerprintsOf(first).v2, BEFORE);
      const fromBefore: StoredException = onlyException();

      await ingestSpanException(first, AFTER);
      await ingestLogException(second, AFTER);
      await ingestSpanException(third, AFTER + MINUTE_MS);
      await ingestLogException(first, AFTER + MINUTE_MS);

      // Its own value still lands on it: nothing split.
      expect(fromBefore.occuranceCount).toBe(3);
      expect(fromBefore.fingerprint).toBe(fingerprintsOf(first).v2);

      // The values since: one exception, not one each; nothing merged into it.
      const since: StoredException | undefined = table.get(
        fingerprintsOf(second).v3,
      );
      expect(since).toBeDefined();
      expect(since!.occuranceCount).toBe(2);
      expect(fingerprintsOf(third).v3).toBe(since!.fingerprint);
      expect(exceptions()).toHaveLength(2);
    },
  );

  test("one made before grouping v2 keeps its value too", async () => {
    const [first, second] = textsOf(CASES[1]!) as [
      ExceptionText,
      ExceptionText,
    ];
    seed(fingerprintsOf(first).v1, BEFORE);
    const fromBefore: StoredException = onlyException();

    await ingestSpanException(first, AFTER);
    await ingestSpanException(second, AFTER);

    expect(fromBefore.occuranceCount).toBe(2);
    expect(table.get(fingerprintsOf(second).v3)!.occuranceCount).toBe(1);
  });

  test("with a scrub rule hiding the number: one exception under v3, which needs no key, and no number stored", async () => {
    logRules = [logRule({ patternType: LogScrubPatternType.SSN })];

    for (const text of textsOf(CASES[1]!)) {
      await ingestLogException(text, AFTER);
    }

    const exception: StoredException = onlyException();
    expect(exception.occuranceCount).toBe(3);
    expect(exception.fingerprint).toBe(
      fingerprintsOf(textsOf(CASES[1]!)[0]!).v3,
    );
    expect(JSON.stringify(exceptionRows)).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });

  test("an exception grouped by its frames is grouped exactly as before: v3 reads no message", async () => {
    const framed: (ssn: string) => ExceptionText = (ssn: string) => {
      return {
        type: "TypeError",
        message: `no cart for ${ssn}`,
        stackTrace: [
          `TypeError: no cart for ${ssn}`,
          "    at checkout (/app/src/cart.ts:10:15)",
        ].join("\n"),
      };
    };

    await ingestSpanException(framed("123-45-6789"), AFTER);
    await ingestSpanException(framed("987-65-4321"), AFTER);

    expect(onlyException().fingerprint).toBe(
      fingerprintsOf(framed("123-45-6789")).v2,
    );
    expect(fingerprintsOf(framed("123-45-6789")).v3).toBe(
      fingerprintsOf(framed("123-45-6789")).v2,
    );
  });

  test("a message without such a number is one exception per message, as ever", async () => {
    await ingestSpanException(
      { type: "OrderError", message: "Order 4821 not found" },
      AFTER,
    );
    await ingestSpanException(
      { type: "OrderError", message: "Order 9932 not found" },
      AFTER,
    );

    expect(exceptions()).toHaveLength(2);
  });
});
