import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionInstance from "../../../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../../../Models/AnalyticsModels/Log";
import RumSession from "../../../../../Models/AnalyticsModels/RumSession";
import Span from "../../../../../Models/AnalyticsModels/Span";
import AnalyticsDatabaseService, {
  Results,
} from "../../../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  foldAttributeKey,
  readTelemetryRecordValues,
  TELEMETRY_SCAN_MAX_KEY_LENGTH,
  TelemetryRecordValue,
  TelemetrySampleCaps,
  TelemetrySampleSource,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  buildOccurrenceMatcher,
  buildTelemetryOccurrenceStatement,
  findTelemetryFindingOccurrences,
  foldedKeyPattern,
  getOccurrenceModel,
  getOccurrenceReadLimit,
  getTelemetryStoreOwnerId,
  keyMatchOf,
  MAX_OCCURRENCES,
  OCCURRENCE_EVENT_RECORDS_PER_READ,
  OCCURRENCE_RECORDS_PER_READ,
  OCCURRENCE_WINDOW_IN_DAYS,
  OccurrencePlan,
  planOccurrenceRead,
  readOccurrenceRows,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import logger from "../../../../../Server/Utils/Logger";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceRecordKind,
} from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { compileCustomDataType } from "../../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { ScanDetector } from "../../../../../Utils/DataSecurity/TextScanner";
import { generatedTexts } from "../../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";

/*
 * THE RECORDS A TELEMETRY FINDING'S DATA WAS SEEN IN (issue #5594).
 *
 * "Show me actual data like traces / logs ... so I see it happening":
 * for a finding - a data type at a location of one service's telemetry -
 * the newest records that carry it there, each with what opens it and the
 * value masked as a finding's samples are. Read without a database: the
 * statement is checked for what binds it, and the rows ClickHouse would
 * answer (tuples as arrays, 64-bit numbers quoted) are matched as the scan
 * would read them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d7001",
);
const SERVICE: string = "0192f1a0-0000-7000-8000-0000000da101";
const WEB_APP: string = "0192f1a0-0000-7000-8000-0000000db101";
const NOW: Date = new Date(Date.UTC(2026, 10, 3, 12, 0, 0));

const EMAIL: string = "jane.doe@acme-corp.com";
const MASKED_EMAIL: string = "j***@a********.com";
const CARD: string = "4539 1488 0343 6467";
const TEST_CARD: string = "4242 4242 4242 4242";
const GITHUB_TOKEN: string = "ghp_R8sK2mQ9vX4tL7wN1pZ6cB3yH5jD0fG2aE8u";
const IP: string = "81.2.69.160";

const PROJECT_PARAMETER: RegExp = /projectId = \{(p\d+):String\}/;
const WINDOW_START: RegExp = /(?:time|startTime) >= \{(p\d+):DateTime64\(9\)\}/;
const WINDOW_END: RegExp = /(?:time|startTime) <= \{(p\d+):DateTime64\(9\)\}/;
const OWNERS_IN: RegExp =
  /(?:primaryEntityId|rumApplicationId) IN \(\{(p\d+):Array\(String\)\}\)/;
const LIMIT: RegExp = /DESC LIMIT \{(p\d+):Int32\}/;

const CAPS: TelemetrySampleCaps = {
  textLength: 8192,
  attributeValueLength: 4096,
  attributesPerRecord: 128,
  eventsPerSpan: 16,
  attributesPerEvent: 32,
};

function parameterAfter(statement: Statement, pattern: RegExp): unknown {
  const match: RegExpMatchArray | null = statement.query.match(pattern);

  expect(match).not.toBeNull();

  return statement.query_params[match![1]!];
}

function parameterValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function options(
  overrides: Partial<ContentScanOptions> = {},
): ContentScanOptions {
  return {
    limits: {
      maxObjects: 2000,
      maxBytesPerObject: 65536,
      maxBytesTotal: 52428800,
      maxRowsPerTable: 1000,
      maxTables: 200,
      deadline: new Date(NOW.getTime() + 60 * 60 * 1000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-key",
    ...overrides,
  };
}

function plan(kind: DataStoreKind, location: string): OccurrencePlan {
  const planned: OccurrencePlan | null = planOccurrenceRead(kind, location);

  expect(planned).not.toBeNull();

  return planned!;
}

function statementFor(
  kind: DataStoreKind,
  location: string,
  ownerId: string = SERVICE,
): Statement {
  const planned: OccurrencePlan = plan(kind, location);

  return buildTelemetryOccurrenceStatement({
    projectId: PROJECT_ID,
    since: new Date(NOW.getTime() - OCCURRENCE_WINDOW_IN_DAYS * 86_400_000),
    until: NOW,
    plan: planned,
    ownerId,
    limit: getOccurrenceReadLimit(planned),
    caps: CAPS,
  });
}

function rowAt(minutesAgo: number, row: JSONObject): JSONObject {
  return {
    ownerId: SERVICE,
    // ClickHouse quotes a 64-bit number in JSON.
    recordTime: String(NOW.getTime() - minutesAgo * 60_000),
    ...row,
  };
}

function matcherFor(
  dataTypeId: string,
  location: string,
  scanOptions: ContentScanOptions = options(),
): (value: string) => string | null {
  return buildOccurrenceMatcher({
    dataTypeId,
    location,
    options: scanOptions,
  });
}

function read(data: {
  kind: DataStoreKind;
  location: string;
  dataTypeId: string;
  rows: Array<JSONObject>;
  ownerId?: string | undefined;
  max?: number | undefined;
}): { occurrences: Array<DataSecurityFindingOccurrence>; recordsRead: number } {
  return readOccurrenceRows({
    plan: plan(data.kind, data.location),
    rows: data.rows,
    location: data.location,
    ownerId: data.ownerId || SERVICE,
    caps: CAPS,
    maskIfFound: matcherFor(data.dataTypeId, data.location),
    max: data.max || MAX_OCCURRENCES,
  });
}

describe("which records and which part of them a finding's location is in", () => {
  test("a service's logs: the body, or an attribute", () => {
    expect(planOccurrenceRead(DataStoreKind.TelemetryLogs, "body")).toEqual({
      source: TelemetrySampleSource.Logs,
      read: { kind: "text", column: "body" },
    });
    expect(
      planOccurrenceRead(DataStoreKind.TelemetryLogs, "attributes.user.email"),
    ).toEqual({
      source: TelemetrySampleSource.Logs,
      read: { kind: "pairs", column: "attributes", key: "user.email" },
    });
  });

  test("a service's traces: an attribute, or an event's attribute", () => {
    expect(
      planOccurrenceRead(DataStoreKind.TelemetryTraces, "attributes.user.pps"),
    ).toEqual({
      source: TelemetrySampleSource.Traces,
      read: { kind: "pairs", column: "attributes", key: "user.pps" },
    });
    expect(
      planOccurrenceRead(DataStoreKind.TelemetryTraces, "events.login.token"),
    ).toEqual({
      source: TelemetrySampleSource.Traces,
      read: { kind: "events", needle: "token" },
    });
    expect(
      planOccurrenceRead(DataStoreKind.TelemetryTraces, "events.batch.items[]"),
    ).toEqual({
      source: TelemetrySampleSource.Traces,
      read: { kind: "events", needle: "items" },
    });
  });

  test("a service's exceptions: the message, the stack trace, or an attribute", () => {
    for (const location of ["message", "stackTrace"]) {
      expect(
        planOccurrenceRead(DataStoreKind.TelemetryExceptions, location),
      ).toEqual({
        source: TelemetrySampleSource.Exceptions,
        read: { kind: "text", column: location },
      });
    }

    expect(
      planOccurrenceRead(
        DataStoreKind.TelemetryExceptions,
        "attributes.order.card",
      ),
    ).toEqual({
      source: TelemetrySampleSource.Exceptions,
      read: { kind: "pairs", column: "attributes", key: "order.card" },
    });
  });

  test("a service's AI conversations: what was said, by its key alone; every other attribute under attributes.", () => {
    expect(
      planOccurrenceRead(
        DataStoreKind.TelemetryAiConversations,
        "gen_ai.input.messages",
      ),
    ).toEqual({
      source: TelemetrySampleSource.AiConversations,
      read: {
        kind: "pairs",
        column: "attributes",
        key: "gen_ai.input.messages",
      },
    });
    expect(
      planOccurrenceRead(
        DataStoreKind.TelemetryAiConversations,
        "attributes.user.email",
      ),
    ).toEqual({
      source: TelemetrySampleSource.AiConversations,
      read: { kind: "pairs", column: "attributes", key: "user.email" },
    });
    expect(
      planOccurrenceRead(
        DataStoreKind.TelemetryAiConversations,
        "events.gen_ai.user.message.content",
      ),
    ).toEqual({
      source: TelemetrySampleSource.AiConversations,
      read: { kind: "events", needle: "content" },
    });
  });

  test("a RUM application's session replays: its logs', spans' and sessions' attributes, traits and label", () => {
    const replays: DataStoreKind = DataStoreKind.TelemetrySessionReplays;

    expect(planOccurrenceRead(replays, "logs.attributes.user.email")).toEqual({
      source: TelemetrySampleSource.RumLogs,
      read: { kind: "pairs", column: "attributes", key: "user.email" },
    });
    expect(planOccurrenceRead(replays, "spans.attributes.http.url")).toEqual({
      source: TelemetrySampleSource.RumSpans,
      read: { kind: "pairs", column: "attributes", key: "http.url" },
    });
    expect(planOccurrenceRead(replays, "sessions.attributes.plan")).toEqual({
      source: TelemetrySampleSource.RumSessions,
      read: { kind: "pairs", column: "attributes", key: "plan" },
    });
    expect(
      planOccurrenceRead(replays, "sessions.identifiedUserTraits.email"),
    ).toEqual({
      source: TelemetrySampleSource.RumSessions,
      read: { kind: "pairs", column: "identifiedUserTraits", key: "email" },
    });
    expect(planOccurrenceRead(replays, "sessions.identifiedUserLabel")).toEqual(
      {
        source: TelemetrySampleSource.RumSessions,
        read: { kind: "text", column: "identifiedUserLabel" },
      },
    );
  });

  test("a location no record has, or a store that is not telemetry, has no records", () => {
    expect(planOccurrenceRead(DataStoreKind.TelemetryLogs, "message")).toBe(
      null,
    );
    expect(planOccurrenceRead(DataStoreKind.TelemetryLogs, "attributes.")).toBe(
      null,
    );
    expect(planOccurrenceRead(DataStoreKind.TelemetryTraces, "body")).toBe(
      null,
    );
    expect(planOccurrenceRead(DataStoreKind.TelemetryTraces, "events.")).toBe(
      null,
    );
    expect(
      planOccurrenceRead(DataStoreKind.TelemetrySessionReplays, "sessions.x"),
    ).toBe(null);
    expect(planOccurrenceRead(DataStoreKind.TelemetryLogs, "")).toBe(null);
    expect(planOccurrenceRead(DataStoreKind.TelemetryLogs, null)).toBe(null);
    expect(
      planOccurrenceRead(DataStoreKind.AwsS3Bucket, "attributes.user.email"),
    ).toBe(null);
    expect(planOccurrenceRead(undefined, "body")).toBe(null);
  });

  test("each signal's records are read with the permissions of the table they are rows of", () => {
    expect(getOccurrenceModel(TelemetrySampleSource.Logs)).toBe(Log);
    expect(getOccurrenceModel(TelemetrySampleSource.RumLogs)).toBe(Log);
    expect(getOccurrenceModel(TelemetrySampleSource.Traces)).toBe(Span);
    expect(getOccurrenceModel(TelemetrySampleSource.AiConversations)).toBe(
      Span,
    );
    expect(getOccurrenceModel(TelemetrySampleSource.RumSpans)).toBe(Span);
    expect(getOccurrenceModel(TelemetrySampleSource.Exceptions)).toBe(
      ExceptionInstance,
    );
    expect(getOccurrenceModel(TelemetrySampleSource.RumSessions)).toBe(
      RumSession,
    );
  });
});

describe("the keys a folded key stands for", () => {
  test("a numbered part is any number", () => {
    const pattern: RegExp = new RegExp(
      foldedKeyPattern("gen_ai.prompt[].content"),
    );

    expect(foldedKeyPattern("gen_ai.prompt[].content")).toBe(
      "^gen_ai\\.prompt\\.[0-9]+\\.content$",
    );
    expect(pattern.test("gen_ai.prompt.0.content")).toBe(true);
    expect(pattern.test("gen_ai.prompt.12.content")).toBe(true);
    expect(pattern.test("gen_ai.prompt.x.content")).toBe(false);
    expect(pattern.test("gen_ai.prompt.0.content.extra")).toBe(false);
    expect(pattern.test("xgen_ai.prompt.0.content")).toBe(false);
  });

  test("a leading or repeated numbered part, and a key's own regular expression characters", () => {
    expect(foldedKeyPattern("[].email")).toBe("^[0-9]+\\.email$");
    expect(foldedKeyPattern("matrix[][]")).toBe("^matrix\\.[0-9]+\\.[0-9]+$");
    expect(foldedKeyPattern("a(b)+c|d*e?{1}^$\\[]")).toBe(
      "^a\\(b\\)\\+c\\|d\\*e\\?\\{1\\}\\^\\$\\\\\\.[0-9]+$",
    );
    expect(new RegExp(foldedKeyPattern("a.b[]")).test("aXb.1")).toBe(false);
  });

  test("every key the scan folds is one of the keys its folded key stands for", () => {
    const random: SeededRandom = seededRandom(5594);
    const words: Array<string> = generatedTexts(400, 5594, [
      "a",
      "b",
      "_",
      "-",
      "(",
      "+",
      "$",
      "x",
      "?",
      "[",
      "]",
    ]);

    for (let index: number = 0; index < 400; index++) {
      const parts: Array<string> = [];
      const length: number = 1 + random(5);

      for (let part: number = 0; part < length; part++) {
        parts.push(
          random(3) === 0
            ? String(random(1000))
            : words[(index + part) % words.length] || "w",
        );
      }

      const key: string = parts.join(".");
      const folded: string = foldAttributeKey(key);

      // A word that holds "[]" itself reads as a numbered part: left aside.
      if (
        parts.some((part: string): boolean => {
          return part.includes("[]");
        })
      ) {
        continue;
      }

      expect([key, new RegExp(foldedKeyPattern(folded)).test(key)]).toEqual([
        key,
        true,
      ]);
    }
  });

  test("a key is found as it is, as the numbered keys it folds, or as the keys a cut key starts", () => {
    expect(keyMatchOf("user.email")).toEqual({
      kind: "exact",
      key: "user.email",
    });
    expect(keyMatchOf("items[].email")).toEqual({
      kind: "pattern",
      pattern: "^items\\.[0-9]+\\.email$",
    });

    const long: string = "k".repeat(TELEMETRY_SCAN_MAX_KEY_LENGTH + 40);

    expect(keyMatchOf(long)).toEqual({
      kind: "prefix",
      prefix: "k".repeat(TELEMETRY_SCAN_MAX_KEY_LENGTH),
    });
  });
});

describe("the statement", () => {
  const CASES: Array<[DataStoreKind, string, string]> = [
    [DataStoreKind.TelemetryLogs, "body", SERVICE],
    [DataStoreKind.TelemetryLogs, "attributes.user.email", SERVICE],
    [DataStoreKind.TelemetryTraces, "attributes.user.pps", SERVICE],
    [DataStoreKind.TelemetryTraces, "events.login.token", SERVICE],
    [DataStoreKind.TelemetryExceptions, "message", SERVICE],
    [
      DataStoreKind.TelemetryAiConversations,
      "gen_ai.prompt[].content",
      SERVICE,
    ],
    [DataStoreKind.TelemetrySessionReplays, "logs.attributes.email", WEB_APP],
    [DataStoreKind.TelemetrySessionReplays, "spans.attributes.email", WEB_APP],
    [
      DataStoreKind.TelemetrySessionReplays,
      "sessions.identifiedUserTraits.email",
      WEB_APP,
    ],
  ];

  test.each(CASES)(
    "%s at %s is the project's, the owner's and the window's, newest first, bound as parameters",
    (kind: DataStoreKind, location: string, ownerId: string) => {
      const statement: Statement = statementFor(kind, location, ownerId);

      expect(statement.query.startsWith("SELECT ")).toBe(true);
      expect(parameterAfter(statement, PROJECT_PARAMETER)).toBe(
        PROJECT_ID.toString(),
      );
      expect(statement.query).not.toContain(PROJECT_ID.toString());
      expect(statement.query).not.toContain(ownerId);
      expect(parameterAfter(statement, OWNERS_IN)).toEqual([ownerId]);
      expect(statement.query).toContain("retentionDate >= now()");
      expect(String(parameterAfter(statement, WINDOW_START))).toMatch(
        /^2026-10-27 12:00:00/,
      );
      expect(String(parameterAfter(statement, WINDOW_END))).toMatch(
        /^2026-11-03 12:00:00/,
      );
      expect(statement.query).toMatch(/ORDER BY (time|startTime) DESC LIMIT/);
      expect(parameterAfter(statement, LIMIT)).toBe(
        location.startsWith("events.")
          ? OCCURRENCE_EVENT_RECORDS_PER_READ
          : OCCURRENCE_RECORDS_PER_READ,
      );
      expect(statement.query).toContain("max_execution_time = 20");
      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
      expect(statement.query).toContain("max_result_bytes");
      expect(statement.query).toContain("toUnixTimestamp64Milli(toDateTime64(");
    },
  );

  test("a log's body: the body, cut in the database, of logs that have one", () => {
    const statement: Statement = statementFor(
      DataStoreKind.TelemetryLogs,
      "body",
    );

    expect(statement.query).toContain("FROM ");
    expect(statement.query).toContain("LogItemV3");
    expect(statement.query).toMatch(
      /substringUTF8\(body, 1, \{p\d+:Int32\}\) AS readBody/,
    );
    expect(statement.query).toContain(" AND body != ''");
    expect(statement.query).toContain(
      "traceId AS readTraceId, spanId AS readSpanId, severityText AS readSeverity",
    );
    expect(statement.query).toContain("primaryEntityType = ''");
    expect(parameterValues(statement)).toContain(8192);
    expect(statement.query).not.toContain("readAttributes");
  });

  test("an attribute: the one value under its key, of records that have the key - the key bound, never written into the query", () => {
    const key: string = "user'); DROP TABLE x; --";
    const statement: Statement = statementFor(
      DataStoreKind.TelemetryLogs,
      `attributes.${key}`,
    );

    expect(statement.query).toMatch(
      /\[tuple\(\{p\d+:String\}, substringUTF8\(attributes\[\{p\d+:String\}\], 1, \{p\d+:Int32\}\)\)\] AS readAttributes/,
    );
    expect(statement.query).toMatch(
      / AND mapContains\(attributes, \{p\d+:String\}\)/,
    );
    expect(statement.query).not.toContain("DROP TABLE");
    expect(
      parameterValues(statement).filter((value: unknown): boolean => {
        return value === key;
      }).length,
    ).toBe(3);
  });

  test("a folded key: the pairs whose key is one of the keys it stands for", () => {
    const statement: Statement = statementFor(
      DataStoreKind.TelemetryAiConversations,
      "gen_ai.prompt[].content",
    );

    expect(statement.query).toContain("isLlmSpan = 1");
    expect(statement.query).toMatch(
      /arrayFilter\(kv -> match\(tupleElement\(kv, 1\), \{p\d+:String\}\), arrayZip\(mapKeys\(attributes\), mapValues\(attributes\)\)\)/,
    );
    expect(statement.query).toMatch(
      / AND arrayExists\(k -> match\(k, \{p\d+:String\}\), mapKeys\(attributes\)\)/,
    );
    expect(parameterValues(statement)).toContain(
      "^gen_ai\\.prompt\\.[0-9]+\\.content$",
    );
    expect(statement.query).toContain("substringUTF8(name, 1,");
  });

  test("a key the scan cut short: the pairs whose key it starts", () => {
    const long: string = "k".repeat(TELEMETRY_SCAN_MAX_KEY_LENGTH);
    const statement: Statement = statementFor(
      DataStoreKind.TelemetryTraces,
      `attributes.${long}`,
    );

    expect(statement.query).toContain("isLlmSpan = 0");
    expect(statement.query).toMatch(
      / AND arrayExists\(k -> startsWith\(k, \{p\d+:String\}\), mapKeys\(attributes\)\)/,
    );
    expect(parameterValues(statement)).toContain(long);
  });

  test("an event's attribute: the events holding the key's text, parsed in the database", () => {
    const statement: Statement = statementFor(
      DataStoreKind.TelemetryTraces,
      "events.login.token",
    );

    expect(statement.query).toMatch(
      /arrayFilter\(e -> position\(e, \{p\d+:String\}\) > 0, JSONExtractArrayRaw\(events\)\)/,
    );
    expect(statement.query).toMatch(
      / AND position\(events, \{p\d+:String\}\) > 0/,
    );
    expect(statement.query).toContain("AS readEvents");
    expect(parameterValues(statement)).toContain("token");
  });

  test("an exception: the message, its group and its type", () => {
    const statement: Statement = statementFor(
      DataStoreKind.TelemetryExceptions,
      "message",
    );

    expect(statement.query).toContain("ExceptionItemV3");
    expect(statement.query).toContain("fingerprint AS readFingerprint");
    expect(statement.query).toContain("substringUTF8(exceptionType, 1,");
    expect(statement.query).toContain(" AND message != ''");
  });

  test("a RUM application's records: its own, with the session each belongs to", () => {
    const spans: Statement = statementFor(
      DataStoreKind.TelemetrySessionReplays,
      "spans.attributes.email",
      WEB_APP,
    );
    const sessions: Statement = statementFor(
      DataStoreKind.TelemetrySessionReplays,
      "sessions.identifiedUserTraits.email",
      WEB_APP,
    );

    expect(parameterValues(spans)).toContain("RealUserMonitor");
    expect(spans.query).toContain("SpanItemV3");
    expect(spans.query).toContain("sessionId AS readSessionId");
    expect(sessions.query).toContain("RumSessionV1");
    expect(sessions.query).toContain("rumApplicationId IN");
    expect(sessions.query).toContain("sessionId AS readSessionId");
    expect(sessions.query).toMatch(
      /mapContains\(identifiedUserTraits, \{p\d+:String\}\)/,
    );
    expect(sessions.query).toContain("AS readTraits");
  });
});

describe("which values are the finding's data type, and how they read", () => {
  test("a real value is masked as a finding's samples are", () => {
    expect(matcherFor("email-address", "attributes.user.email")(EMAIL)).toBe(
      MASKED_EMAIL,
    );
    expect(matcherFor("credit-card-number", "attributes.card")(CARD)).toBe(
      "**** **** **** 6467",
    );
    expect(matcherFor("github-token", "attributes.config")(GITHUB_TOKEN)).toBe(
      "ghp_************aE8u",
    );
    expect(matcherFor("ip-address", "attributes.client.ip")(IP)).toBe(
      "81.***.***.***",
    );
  });

  test("the value inside a longer text is found and only it is masked", () => {
    expect(
      matcherFor("email-address", "body")(`Signed up ${EMAIL} from the app`),
    ).toBe(MASKED_EMAIL);
  });

  test("a value that is not the data type, a test value, or a value the project allows is none", () => {
    expect(
      matcherFor("email-address", "attributes.user.email")("anonymous"),
    ).toBe(null);
    expect(
      matcherFor("email-address", "attributes.user.email")("jane@example.com"),
    ).toBe(null);
    expect(matcherFor("credit-card-number", "attributes.card")(TEST_CARD)).toBe(
      null,
    );
    expect(
      matcherFor(
        "email-address",
        "attributes.user.email",
        options({ allowedValues: new Set([EMAIL]) }),
      )(EMAIL),
    ).toBe(null);
  });

  test("only the finding's own data type counts: a card number is no email", () => {
    expect(matcherFor("email-address", "attributes.card")(CARD)).toBe(null);
    expect(
      matcherFor("credit-card-number", "attributes.user.email")(EMAIL),
    ).toBe(null);
  });

  test("a masked value a scrub rule wrote at ingest is no longer the data type", () => {
    expect(
      matcherFor("email-address", "attributes.user.email")("[REDACTED]"),
    ).toBe(null);
    expect(matcherFor("credit-card-number", "attributes.card")("****")).toBe(
      null,
    );
  });

  test("a project's own data type is found with its own detector", () => {
    const employee: ScanDetector | null = compileCustomDataType({
      dataTypeId: "custom:employee",
      pattern: "EMP-[0-9]{6}",
    });
    const scanOptions: ContentScanOptions = options({
      customDetectors: [employee!],
    });

    expect(
      matcherFor(
        "custom:employee",
        "attributes.staff",
        scanOptions,
      )("EMP-123456"),
    ).toBe("***-**3456");
    expect(
      matcherFor("custom:other", "attributes.staff", scanOptions)("EMP-123456"),
    ).toBe(null);
  });

  test("a data type found by a field's name is the field's plausible values", () => {
    expect(
      matcherFor("person-name", "attributes.user.first_name")("Alice"),
    ).toBe("A****");
  });
});

describe("reading the rows", () => {
  test("the newest records whose value at the location is the data type, one each, with what opens them", () => {
    const result: {
      occurrences: Array<DataSecurityFindingOccurrence>;
      recordsRead: number;
    } = read({
      kind: DataStoreKind.TelemetryTraces,
      location: "attributes.user.email",
      dataTypeId: "email-address",
      rows: [
        rowAt(3, {
          readTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          readSpanId: "00f067aa0ba902b7",
          readName: "POST /api/signup",
          readAttributes: [["user.email", EMAIL]],
        }),
        rowAt(4, {
          readTraceId: "trace-2",
          readSpanId: "span-2",
          readName: "GET /me",
          readAttributes: [["user.email", "anonymous"]],
        }),
        rowAt(9, {
          readTraceId: "trace-3",
          readSpanId: "",
          readName: "",
          readAttributes: [["user.email", "kai.wu@acme-corp.com"]],
        }),
      ],
    });

    expect(result.recordsRead).toBe(3);
    expect(result.occurrences).toEqual([
      {
        time: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
        recordKind: DataSecurityOccurrenceRecordKind.Span,
        serviceId: SERVICE,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        name: "POST /api/signup",
        maskedValue: MASKED_EMAIL,
      },
      {
        time: new Date(NOW.getTime() - 9 * 60_000).toISOString(),
        recordKind: DataSecurityOccurrenceRecordKind.Span,
        serviceId: SERVICE,
        traceId: "trace-3",
        maskedValue: "k***@a********.com",
      },
    ]);
  });

  test("never more than asked for", () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index < 40; index++) {
      rows.push(rowAt(index, { readAttributes: [["user.email", EMAIL]] }));
    }

    const result: {
      occurrences: Array<DataSecurityFindingOccurrence>;
      recordsRead: number;
    } = read({
      kind: DataStoreKind.TelemetryLogs,
      location: "attributes.user.email",
      dataTypeId: "email-address",
      rows,
      max: 4,
    });

    expect(result.occurrences.length).toBe(4);
    expect(result.recordsRead).toBe(4);
    expect(MAX_OCCURRENCES).toBe(10);
  });

  test("a log line: its severity, its trace when it has one", () => {
    const [occurrence] = read({
      kind: DataStoreKind.TelemetryLogs,
      location: "body",
      dataTypeId: "credit-card-number",
      rows: [
        rowAt(1, {
          readTraceId: "trace-1",
          readSpanId: "span-1",
          readSeverity: "Error",
          readBody: `Charge failed for ${CARD}`,
        }),
      ],
    }).occurrences;

    expect(occurrence).toEqual({
      time: new Date(NOW.getTime() - 60_000).toISOString(),
      recordKind: DataSecurityOccurrenceRecordKind.Log,
      serviceId: SERVICE,
      traceId: "trace-1",
      spanId: "span-1",
      severity: "Error",
      maskedValue: "**** **** **** 6467",
    });
  });

  test("an exception: its group and its type", () => {
    const [occurrence] = read({
      kind: DataStoreKind.TelemetryExceptions,
      location: "message",
      dataTypeId: "email-address",
      rows: [
        rowAt(2, {
          readTraceId: "",
          readSpanId: "",
          readFingerprint: "fp-123",
          readName: "PaymentDeclined",
          readMessage: `Could not charge ${EMAIL}`,
          readStackTrace: "at pay (pay.js:10:5)",
        }),
      ],
    }).occurrences;

    expect(occurrence).toMatchObject({
      recordKind: DataSecurityOccurrenceRecordKind.Exception,
      fingerprint: "fp-123",
      name: "PaymentDeclined",
      maskedValue: MASKED_EMAIL,
    });
    expect(occurrence?.traceId).toBeUndefined();
  });

  test("what was said to a model, under a numbered key the location folds", () => {
    const [occurrence] = read({
      kind: DataStoreKind.TelemetryAiConversations,
      location: "gen_ai.prompt[].content",
      dataTypeId: "email-address",
      rows: [
        rowAt(1, {
          readTraceId: "trace-ai",
          readSpanId: "span-ai",
          readName: "chat claude-opus",
          readAttributes: [["gen_ai.prompt.3.content", `Write to ${EMAIL}`]],
        }),
      ],
    }).occurrences;

    expect(occurrence).toMatchObject({
      recordKind: DataSecurityOccurrenceRecordKind.AiCall,
      traceId: "trace-ai",
      name: "chat claude-opus",
      maskedValue: MASKED_EMAIL,
    });
  });

  test("an event's attribute, named as the scan names it", () => {
    const rows: Array<JSONObject> = [
      rowAt(1, {
        readTraceId: "trace-e",
        readSpanId: "span-e",
        readName: "login",
        readEvents: [
          ["exception", [["exception.message", `"bad ${GITHUB_TOKEN}"`]]],
          ["login", [["token", `"${GITHUB_TOKEN}"`]]],
        ],
      }),
    ];

    expect(
      read({
        kind: DataStoreKind.TelemetryTraces,
        location: "events.login.token",
        dataTypeId: "github-token",
        rows,
      }).occurrences[0]?.maskedValue,
    ).toBe("ghp_************aE8u");
    expect(
      read({
        kind: DataStoreKind.TelemetryTraces,
        location: "events.exception.exception.message",
        dataTypeId: "github-token",
        rows,
      }).occurrences.length,
    ).toBe(1);
    expect(
      read({
        kind: DataStoreKind.TelemetryTraces,
        location: "events.signup.token",
        dataTypeId: "github-token",
        rows,
      }).occurrences,
    ).toEqual([]);
  });

  test("a session the table keeps several versions of is one record, and belongs to its RUM application", () => {
    const result: {
      occurrences: Array<DataSecurityFindingOccurrence>;
      recordsRead: number;
    } = read({
      kind: DataStoreKind.TelemetrySessionReplays,
      location: "sessions.identifiedUserTraits.email",
      dataTypeId: "email-address",
      ownerId: WEB_APP,
      rows: [
        rowAt(1, {
          ownerId: WEB_APP,
          readSessionId: "session-1",
          readTraits: [["email", EMAIL]],
        }),
        rowAt(2, {
          ownerId: WEB_APP,
          readSessionId: "session-1",
          readTraits: [["email", EMAIL]],
        }),
        rowAt(3, {
          ownerId: WEB_APP,
          readSessionId: "session-2",
          readTraits: [["email", "kai.wu@acme-corp.com"]],
        }),
      ],
    });

    expect(result.recordsRead).toBe(2);
    expect(
      result.occurrences.map(
        (occurrence: DataSecurityFindingOccurrence): string => {
          return `${occurrence.recordKind} ${occurrence.sessionId} ${occurrence.rumApplicationId} ${occurrence.serviceId}`;
        },
      ),
    ).toEqual([
      `Session session-1 ${WEB_APP} undefined`,
      `Session session-2 ${WEB_APP} undefined`,
    ]);
  });

  test("OneUptime's own attributes are never a finding's", () => {
    expect(
      read({
        kind: DataStoreKind.TelemetryLogs,
        location: "attributes.oneuptime.user.email",
        dataTypeId: "email-address",
        rows: [rowAt(1, { readAttributes: [["oneuptime.user.email", EMAIL]] })],
      }).occurrences,
    ).toEqual([]);
  });

  test("a row without a time it was written is read but not shown", () => {
    const result: {
      occurrences: Array<DataSecurityFindingOccurrence>;
      recordsRead: number;
    } = read({
      kind: DataStoreKind.TelemetryLogs,
      location: "attributes.user.email",
      dataTypeId: "email-address",
      rows: [
        {
          ownerId: SERVICE,
          recordTime: "",
          readAttributes: [["user.email", EMAIL]],
        },
        {
          ownerId: SERVICE,
          recordTime: "nope",
          readAttributes: [["user.email", EMAIL]],
        },
      ],
    });

    expect(result).toEqual({ occurrences: [], recordsRead: 2 });
  });
});

describe("what a record holds, as the scan reads it", () => {
  test("a log: its body, then its attributes, empty values and OneUptime's own left out", () => {
    const values: Array<TelemetryRecordValue> | null =
      readTelemetryRecordValues(
        TelemetrySampleSource.Logs,
        {
          readBody: "hello",
          readAttributes: [
            ["user.email", EMAIL],
            ["empty", ""],
            ["oneuptime.service.name", "checkout"],
            ["items.0.sku", "A-1"],
          ],
        },
        CAPS,
      );

    expect(values).toEqual([
      { location: "body", locationKind: "Body", value: "hello" },
      {
        location: "attributes.user.email",
        locationKind: "Attribute",
        value: EMAIL,
      },
      {
        location: "attributes.items[].sku",
        locationKind: "Attribute",
        value: "A-1",
      },
    ]);
  });

  test("an exception: its message, its stack trace, then its attributes", () => {
    expect(
      readTelemetryRecordValues(
        TelemetrySampleSource.Exceptions,
        {
          readMessage: "m",
          readStackTrace: "s",
          readAttributes: [["a", "1"]],
        },
        CAPS,
      )!.map((value: TelemetryRecordValue): string => {
        return value.location;
      }),
    ).toEqual(["message", "stackTrace", "attributes.a"]);
  });

  test("a session: its attributes, its user's traits, then its user's label", () => {
    expect(
      readTelemetryRecordValues(
        TelemetrySampleSource.RumSessions,
        {
          readAttributes: [["plan", "pro"]],
          readTraits: [["email", EMAIL]],
          readLabel: "Kai",
        },
        CAPS,
      )!.map((value: TelemetryRecordValue): string => {
        return `${value.location}:${value.locationKind}`;
      }),
    ).toEqual([
      "sessions.attributes.plan:Attribute",
      "sessions.identifiedUserTraits.email:Attribute",
      "sessions.identifiedUserLabel:Field",
    ]);
  });

  test("values are cut as the scan cuts them", () => {
    const values: Array<TelemetryRecordValue> | null =
      readTelemetryRecordValues(
        TelemetrySampleSource.Logs,
        { readBody: "x".repeat(50), readAttributes: [["k", "y".repeat(50)]] },
        { ...CAPS, textLength: 10, attributeValueLength: 5 },
      );

    expect(
      values!.map((value: TelemetryRecordValue): number => {
        return value.value.length;
      }),
    ).toEqual([10, 5]);
  });

  test("a source with no records is none", () => {
    expect(
      readTelemetryRecordValues("Nothing" as TelemetrySampleSource, {}, CAPS),
    ).toBe(null);
  });
});

describe("the owner a store's records are sent under", () => {
  test("a service's store: its service", () => {
    expect(
      getTelemetryStoreOwnerId({
        kind: DataStoreKind.TelemetryTraces,
        serviceId: new ObjectID(SERVICE),
        storeKey: `telemetry:${SERVICE}:Traces`,
      }),
    ).toBe(SERVICE);
    expect(
      getTelemetryStoreOwnerId({
        kind: DataStoreKind.TelemetryLogs,
        serviceId: null,
      }),
    ).toBe(null);
  });

  test("a session replay store: the RUM application its key names", () => {
    expect(
      getTelemetryStoreOwnerId({
        kind: DataStoreKind.TelemetrySessionReplays,
        storeKey: `telemetry:${WEB_APP}:Session Replays`,
      }),
    ).toBe(WEB_APP);
    expect(
      getTelemetryStoreOwnerId({
        kind: DataStoreKind.TelemetrySessionReplays,
        storeKey: "telemetry:not-an-id:Session Replays",
      }),
    ).toBe(null);
    expect(
      getTelemetryStoreOwnerId({
        kind: DataStoreKind.TelemetrySessionReplays,
        storeKey: `cloud:${WEB_APP}:x`,
      }),
    ).toBe(null);
    expect(
      getTelemetryStoreOwnerId({ kind: DataStoreKind.TelemetrySessionReplays }),
    ).toBe(null);
  });
});

describe("findTelemetryFindingOccurrences", () => {
  let statements: Array<Statement> = [];
  let rows: Array<JSONObject> = [];
  let failure: Error | null = null;

  beforeEach(() => {
    statements = [];
    rows = [];
    failure = null;
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);

        if (failure) {
          throw failure;
        }

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({ data: rows });
          },
        } as unknown as Results;
      }) as never);
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function find(
    location: string,
    scanOptions: ContentScanOptions = options(),
  ): Promise<DataSecurityFindingOccurrences> {
    return await findTelemetryFindingOccurrences({
      projectId: PROJECT_ID,
      plan: plan(DataStoreKind.TelemetryLogs, location),
      ownerId: SERVICE,
      location,
      dataTypeId: "email-address",
      options: scanOptions,
      now: NOW,
    });
  }

  test("one read of the last week, the records that carry it, and whether every record with a value there was read", async () => {
    rows = [
      rowAt(5, {
        readTraceId: "t",
        readSpanId: "s",
        readSeverity: "Info",
        readAttributes: [["user.email", EMAIL]],
      }),
      rowAt(6, { readAttributes: [["user.email", "nobody"]] }),
    ];

    const result: DataSecurityFindingOccurrences = await find(
      "attributes.user.email",
    );

    expect(statements.length).toBe(1);
    expect(result).toEqual({
      occurrences: [
        {
          time: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
          recordKind: DataSecurityOccurrenceRecordKind.Log,
          serviceId: SERVICE,
          traceId: "t",
          spanId: "s",
          severity: "Info",
          maskedValue: MASKED_EMAIL,
        },
      ],
      since: "2026-10-27T12:00:00.000Z",
      until: "2026-11-03T12:00:00.000Z",
      recordsRead: 2,
      isComplete: true,
    });
  });

  test("a full read is not every record there was", async () => {
    for (let index: number = 0; index < OCCURRENCE_RECORDS_PER_READ; index++) {
      rows.push(rowAt(index, { readAttributes: [["user.email", "nobody"]] }));
    }

    const result: DataSecurityFindingOccurrences = await find(
      "attributes.user.email",
    );

    expect(result.isComplete).toBe(false);
    expect(result.occurrences).toEqual([]);
    expect(result.recordsRead).toBe(OCCURRENCE_RECORDS_PER_READ);
  });

  test("values are read as long as the project's scans read them", async () => {
    await find(
      "body",
      options({
        limits: { ...options().limits, maxBytesPerObject: 1000 },
      }),
    );

    expect(parameterValues(statements[0]!)).toContain(1000);
    expect(parameterValues(statements[0]!)).not.toContain(8192);
  });

  test("a read that fails says so in words a person can act on, and is logged", async () => {
    failure = new Error("Code: 159. DB::Exception: Timeout exceeded");

    await expect(find("attributes.user.email")).rejects.toEqual(
      new BadDataException(
        "Could not read these records just now. Try again in a minute.",
      ),
    );
    expect(logger.warn).toHaveBeenCalled();
  });
});
