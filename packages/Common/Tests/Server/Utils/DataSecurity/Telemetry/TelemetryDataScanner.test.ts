import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import RumApplication from "../../../../../Models/DatabaseModels/RumApplication";
import Service from "../../../../../Models/DatabaseModels/Service";
import AnalyticsDatabaseService, {
  Results,
} from "../../../../../Server/Services/AnalyticsDatabaseService";
import RumApplicationService from "../../../../../Server/Services/RumApplicationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  buildTelemetryLargeMetricSampleStatement,
  buildTelemetryMetricSampleStatement,
  buildTelemetryMetricsStatement,
  buildTelemetryOwnersStatement,
  buildTelemetrySampleStatement,
  getMetricReadsByOwner,
  getMetricRotationPosition,
  getMetricTurn,
  getNewMetricSlots,
  isLargeMetric,
  isMetricNameAKey,
  METRIC_ROTATION_CURSOR_STATE_KEY,
  MetricScanPlan,
  MetricToRead,
  planMetricsToRead,
  readMetricRotationCursor,
  readMetricsToRead,
  readTelemetryRecordValues,
  TELEMETRY_SCAN_MAX_BATCHED_METRIC_POINTS,
  TELEMETRY_SCAN_METRIC_SHARE_PER_OWNER,
  TELEMETRY_SCAN_MAX_METRICS_PER_READ,
  TELEMETRY_SCAN_MAX_SERIES_PER_METRIC,
  TELEMETRY_SCAN_NEW_METRIC_LOOKBACK_IN_HOURS,
  TELEMETRY_SCAN_NEW_METRIC_WINDOW_IN_HOURS,
  TelemetryRecordValue,
  foldAttributeKey,
  fromRawJsonValue,
  getSampleRecordsByDataType,
  getTelemetrySource,
  isConversationContentKey,
  isExcludedLocation,
  readSampleRecord,
  RESTRICTED_CONVERSATIONS_WARNING,
  scanProjectTelemetry,
  TELEMETRY_SCAN_MAX_TEXT_LENGTH,
  TelemetrySampleSource,
  TelemetryStoreScan,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import logger from "../../../../../Server/Utils/Logger";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import {
  FindingSampleRecord,
  MAX_FINDING_SAMPLE_RECORDS,
} from "../../../../../Types/DataSecurity/FindingSampleRecord";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { compileCustomDataType } from "../../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { FieldClassification } from "../../../../../Utils/DataSecurity/FieldClassifier";
import { ScanDetector } from "../../../../../Utils/DataSecurity/TextScanner";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";

/*
 * A sample of a project's telemetry, read without a database: every
 * statement is checked for what binds it - the project, the window, the
 * owners, LIMIT n BY - and the rows ClickHouse would answer (tuples as
 * arrays, counts as quoted numbers) are classified into the stores they
 * belong to: each service's logs, traces, exceptions and AI conversations,
 * each RUM application's session replays. A company AI tool's
 * conversations are never read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d6001",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000000da001";
const AI_TOOL: string = "0192f1a0-0000-7000-8000-0000000da002";
const WEB_APP: string = "0192f1a0-0000-7000-8000-0000000db001";

const GITHUB_TOKEN: string = "ghp_R8sK2mQ9vX4tL7wN1pZ6cB3yH5jD0fG2aE8u";
const CARD: string = "4539 1488 0343 6467";

// A statement's parameter, by the SQL it follows.
const PROJECT_PARAMETER: RegExp = /projectId = \{(p\d+):String\}/;
const LIMIT_BY: RegExp =
  /LIMIT \{(p\d+):Int32\} BY (primaryEntityId|rumApplicationId)/;
// A metric rollup's window is its minutes' (bucketTime).
const WINDOW_START: RegExp =
  /(?:time|startTime|bucketTime) >= \{(p\d+):DateTime64\(9\)\}/;
const WINDOW_END: RegExp =
  /(?:time|startTime|bucketTime) <= \{(p\d+):DateTime64\(9\)\}/;
const METRICS_LIST_LIMIT_BY: RegExp = /LIMIT \{(p\d+):Int32\} BY ownerId/;
const METRIC_OWNER: RegExp = /primaryEntityId = \{(p\d+):String\}/;
const OWNERS_IN: RegExp =
  /(?:primaryEntityId|rumApplicationId) IN \(\{(p\d+):Array\(String\)\}\)/;
const OWNERS_NOT_IN: RegExp = /NOT IN \(\{(p\d+):Array\(String\)\}\)/;

function parameterAfter(statement: Statement, pattern: RegExp): unknown {
  const match: RegExpMatchArray | null = statement.query.match(pattern);

  expect(match).not.toBeNull();

  return statement.query_params[match![1]!];
}

function answer(rows: Array<JSONObject>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

type SourceRows = Partial<Record<TelemetrySampleSource, Array<JSONObject>>>;

let ownerRows: SourceRows = {};
let sampleRows: SourceRows = {};
// What the metrics rollup lists: each service's metrics and their newest minute.
let metricListRows: Array<JSONObject> = [];
let statements: Array<Statement> = [];

// The newest whole minute, in seconds, as the rollup answers it.
function newestMinuteNow(): string {
  return String(Math.floor(Date.now() / 60_000) * 60);
}

function sourceOf(statement: Statement): TelemetrySampleSource {
  const query: string = statement.query;
  const isRum: boolean = Object.values(statement.query_params).includes(
    "RealUserMonitor",
  );

  if (query.includes("MetricItemV3") || query.includes("MetricItemAggMV1m")) {
    return TelemetrySampleSource.Metrics;
  }

  if (query.includes("RumSessionV1")) {
    return TelemetrySampleSource.RumSessions;
  }

  if (query.includes("LogItemV3")) {
    return isRum ? TelemetrySampleSource.RumLogs : TelemetrySampleSource.Logs;
  }

  if (query.includes("ExceptionItemV3")) {
    return TelemetrySampleSource.Exceptions;
  }

  if (isRum) {
    return TelemetrySampleSource.RumSpans;
  }

  return query.includes("isLlmSpan = 1")
    ? TelemetrySampleSource.AiConversations
    : TelemetrySampleSource.Traces;
}

function isOwnersRead(statement: Statement): boolean {
  return statement.query.includes(" AS records FROM ");
}

// Which metrics each service wrote: the rollup's list, not a sample.
function isMetricsList(statement: Statement): boolean {
  return statement.query.includes(" AS newestMinutePoints, ");
}

function statementsOf(
  source: TelemetrySampleSource,
  owners: boolean,
): Array<Statement> {
  return statements.filter((statement: Statement): boolean => {
    return sourceOf(statement) === source && isOwnersRead(statement) === owners;
  });
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
      deadline: new Date(Date.now() + 60 * 60 * 1000),
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

async function scan(
  scanOptions: ContentScanOptions = options(),
): Promise<Array<TelemetryStoreScan>> {
  return await scanProjectTelemetry({
    projectId: PROJECT_ID,
    sampleSize: 100,
    since: new Date(Date.now() - 60 * 60 * 1000),
    options: scanOptions,
  });
}

function storeOf(
  scans: Array<TelemetryStoreScan>,
  kind: DataStoreKind,
  serviceId: string,
): TelemetryStoreScan {
  const found: TelemetryStoreScan | undefined = scans.find(
    (item: TelemetryStoreScan): boolean => {
      return item.kind === kind && item.serviceId === serviceId;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function typesAt(
  result: ContentScanResult,
  location: string,
): Array<string> | undefined {
  const found: LocationFindings | undefined = result.locations.find(
    (entry: LocationFindings): boolean => {
      return entry.location === location;
    },
  );

  return found?.classifications.map(
    (classification: FieldClassification): string => {
      return classification.dataTypeId;
    },
  );
}

function kindAt(
  result: ContentScanResult,
  location: string,
): DataStoreLocationKind | undefined {
  return result.locations.find((entry: LocationFindings): boolean => {
    return entry.location === location;
  })?.locationKind;
}

function locationsOf(result: ContentScanResult): Array<string> {
  return result.locations.map((entry: LocationFindings): string => {
    return entry.location;
  });
}

function namedService(id: string, name: string): Service {
  const service: Service = new Service();
  service._id = id;
  service.name = name;
  return service;
}

beforeEach(() => {
  statements = [];
  ownerRows = {
    [TelemetrySampleSource.Logs]: [{ ownerId: CHECKOUT, records: "1200" }],
    [TelemetrySampleSource.Traces]: [{ ownerId: CHECKOUT, records: "40" }],
    [TelemetrySampleSource.Exceptions]: [{ ownerId: CHECKOUT, records: "5" }],
    [TelemetrySampleSource.AiConversations]: [
      { ownerId: CHECKOUT, records: "10" },
      { ownerId: AI_TOOL, records: "99" },
    ],
    [TelemetrySampleSource.RumLogs]: [{ ownerId: WEB_APP, records: "3" }],
    [TelemetrySampleSource.RumSessions]: [{ ownerId: WEB_APP, records: "2" }],
    [TelemetrySampleSource.Metrics]: [{ ownerId: CHECKOUT, records: "2400" }],
  };
  metricListRows = [
    {
      ownerId: CHECKOUT,
      metricName: "user.logins",
      points: "2000",
      newestMinute: newestMinuteNow(),
      newestMinutePoints: "40",
    },
    {
      ownerId: CHECKOUT,
      metricName: "signups.kim.lee@acmecorp.io.count",
      points: "60",
      newestMinute: newestMinuteNow(),
      newestMinutePoints: "1",
    },
  ];
  sampleRows = {
    [TelemetrySampleSource.Logs]: [
      {
        ownerId: CHECKOUT,
        readBody: "Signed up jane.doe@acmecorp.io from the mobile app",
        readAttributes: [
          ["user.email", "jane.doe@acmecorp.io"],
          ["oneuptime.service.name", "checkout"],
          ["http.status_code", "200"],
        ],
      },
      {
        ownerId: CHECKOUT,
        readBody: `Paid with card ${CARD}`,
        readAttributes: [["config.github", GITHUB_TOKEN]],
      },
    ],
    [TelemetrySampleSource.Traces]: [
      {
        ownerId: CHECKOUT,
        readAttributes: [["enduser.email", "sam.lee@acmecorp.io"]],
        readEvents: [
          [
            "login",
            [
              ["user.email", '"sam.lee@acmecorp.io"'],
              ["attempt", "3"],
            ],
          ],
          ["exception", [["exception.message", `"bad token ${GITHUB_TOKEN}"`]]],
        ],
      },
    ],
    [TelemetrySampleSource.Exceptions]: [
      {
        ownerId: CHECKOUT,
        readMessage: "Could not charge jane.doe@acmecorp.io",
        readStackTrace: "Error: declined\n    at pay (pay.js:10:5)",
        readAttributes: [],
      },
    ],
    [TelemetrySampleSource.AiConversations]: [
      {
        ownerId: CHECKOUT,
        readAttributes: [
          [
            "gen_ai.input.messages",
            JSON.stringify([
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "My email is pat.kim@acmecorp.io" },
            ]),
          ],
          ["gen_ai.prompt.0.content", "Please write to pat.kim@acmecorp.io"],
          ["gen_ai.prompt.0.role", "user"],
          ["gen_ai.request.model", "claude-opus"],
          ["user.email", "pat.kim@acmecorp.io"],
        ],
        readEvents: [
          [
            "gen_ai.user.message",
            [["content", '"reach me at pat.kim@acmecorp.io"']],
          ],
        ],
      },
      // A row for an owner the read was not for: never classified.
      {
        ownerId: AI_TOOL,
        readAttributes: [["gen_ai.input.messages", "chat of kim@acmecorp.io"]],
        readEvents: [],
      },
    ],
    [TelemetrySampleSource.RumLogs]: [
      {
        ownerId: WEB_APP,
        readAttributes: [["user.email", "kai.wu@acmecorp.io"]],
      },
    ],
    [TelemetrySampleSource.RumSessions]: [
      {
        ownerId: WEB_APP,
        readSessionId: "session-1",
        readAttributes: [["plan", "pro"]],
        readTraits: [["email", "kai.wu@acmecorp.io"]],
        readLabel: "kai.wu@acmecorp.io",
      },
      // The same session's older version.
      {
        ownerId: WEB_APP,
        readSessionId: "session-1",
        readAttributes: [["plan", "free"]],
        readTraits: [["email", "kai.wu@acmecorp.io"]],
        readLabel: "kai.wu@acmecorp.io",
      },
    ],
    // Two series of a login counter, the same series again, and a named metric.
    [TelemetrySampleSource.Metrics]: [
      {
        ownerId: CHECKOUT,
        readRecordTime: String(Date.now() - 30_000),
        readMetricName: "user.logins",
        readAttributes: [
          ["user.email", "lee.park@acmecorp.io"],
          ["resource.client.ip", "34.120.7.19"],
          ["oneuptime.service.id", CHECKOUT],
        ],
      },
      {
        ownerId: CHECKOUT,
        readRecordTime: String(Date.now() - 30_000),
        readMetricName: "user.logins",
        readAttributes: [
          ["user.email", "ana.ruiz@acmecorp.io"],
          ["resource.client.ip", "34.120.7.19"],
          ["oneuptime.service.id", CHECKOUT],
        ],
      },
      {
        ownerId: CHECKOUT,
        readRecordTime: String(Date.now() - 20_000),
        readMetricName: "user.logins",
        readAttributes: [
          ["user.email", "lee.park@acmecorp.io"],
          ["resource.client.ip", "34.120.7.19"],
          ["oneuptime.service.id", CHECKOUT],
        ],
      },
      {
        ownerId: CHECKOUT,
        readRecordTime: String(Date.now() - 10_000),
        readMetricName: "signups.kim.lee@acmecorp.io.count",
        readAttributes: [["plan", "pro"]],
      },
    ],
  };

  jest
    .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
    .mockImplementation((async (statement: Statement): Promise<Results> => {
      statements.push(statement);

      if (isMetricsList(statement)) {
        return answer(metricListRows);
      }

      const rows: SourceRows = isOwnersRead(statement) ? ownerRows : sampleRows;

      return answer(rows[sourceOf(statement)] || []);
    }) as never);
  jest
    .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
    .mockResolvedValue([AI_TOOL]);
  // The scan logs what it could not read; these tests read its results.
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest
    .spyOn(ServiceService, "findBy")
    .mockResolvedValue([
      namedService(CHECKOUT, "checkout"),
      namedService(AI_TOOL, "Claude Enterprise"),
    ] as never);

  const web: RumApplication = new RumApplication();
  web._id = WEB_APP;
  web.name = "web";
  jest.spyOn(RumApplicationService, "findBy").mockResolvedValue([web] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the statements", () => {
  test("every read is the project's, of the window, bound as parameters, with LIMIT n BY", async () => {
    await scan();

    expect(statements.length).toBeGreaterThan(0);

    for (const statement of statements) {
      expect(parameterAfter(statement, PROJECT_PARAMETER)).toBe(
        PROJECT_ID.toString(),
      );
      expect(statement.query).not.toContain(PROJECT_ID.toString());
      expect(statement.query).toContain("retentionDate >= now()");
      expect(String(parameterAfter(statement, WINDOW_START))).toMatch(
        /^\d{4}-\d{2}-\d{2} /,
      );
      expect(String(parameterAfter(statement, WINDOW_END))).toMatch(
        /^\d{4}-\d{2}-\d{2} /,
      );
      expect(statement.query).toContain("max_execution_time = 30");
      expect(statement.query).toContain("max_result_bytes");

      if (isOwnersRead(statement)) {
        continue;
      }

      if (isMetricsList(statement)) {
        // Which metrics the services found wrote: the services', bounded.
        expect(
          Number(parameterAfter(statement, METRICS_LIST_LIMIT_BY)),
        ).toBeGreaterThan(0);
        expect(parameterAfter(statement, OWNERS_IN)).toEqual(expect.any(Array));
      } else if (sourceOf(statement) === TelemetrySampleSource.Metrics) {
        // A metric's newest minute: its service's own range, a few points of it.
        expect(parameterAfter(statement, METRIC_OWNER)).toBe(CHECKOUT);
        expect(Number(parameterAfter(statement, LIMIT_BY))).toBeGreaterThan(0);
      } else {
        expect(Number(parameterAfter(statement, LIMIT_BY))).toBeGreaterThan(0);
        expect(parameterAfter(statement, OWNERS_IN)).toEqual(expect.any(Array));
      }
    }

    // Every source was read, metrics with them.
    expect(statementsOf(TelemetrySampleSource.Metrics, true)).toHaveLength(1);
  });

  test("a sample asks for the owners found, the newest per owner, and cuts every value short", () => {
    const statement: Statement = buildTelemetrySampleStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-10-27T10:00:00.000Z"),
      until: new Date("2026-10-27T11:00:00.000Z"),
      source: TelemetrySampleSource.Logs,
      ownerIds: [CHECKOUT],
      perOwner: 25,
      total: 25,
      caps: {
        textLength: 8192,
        attributeValueLength: 4096,
        attributesPerRecord: 128,
        eventsPerSpan: 16,
        attributesPerEvent: 32,
      },
    });

    expect(statement.query).toContain("substringUTF8(body, 1, {");
    expect(statement.query).toContain("arraySlice(mapKeys(attributes), 1, {");
    // The keys first, from the light columns, then the wide ones of those.
    expect(statement.query).toContain(
      "AND (primaryEntityId, time) GLOBAL IN (SELECT primaryEntityId, time FROM ",
    );
    expect(statement.query.match(/ BY primaryEntityId/g)?.length).toBe(2);
    expect(statement.query).toContain("ORDER BY time DESC LIMIT {");
    expect(parameterAfter(statement, OWNERS_IN)).toEqual([CHECKOUT]);
    expect(parameterAfter(statement, LIMIT_BY)).toBe(25);
    expect(Object.values(statement.query_params)).toContain(8192);
    expect(Object.values(statement.query_params)).toContain("OpenTelemetry");
    expect(String(parameterAfter(statement, WINDOW_START))).toContain(
      "2026-10-27 10:00:00",
    );
    expect(String(parameterAfter(statement, WINDOW_END))).toContain(
      "2026-10-27 11:00:00",
    );
  });

  test("spans read their events parsed in the database; AI calls only the AI calls", () => {
    const statement: Statement = buildTelemetrySampleStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-10-27T10:00:00.000Z"),
      until: new Date("2026-10-27T11:00:00.000Z"),
      source: TelemetrySampleSource.AiConversations,
      ownerIds: [CHECKOUT],
      perOwner: 10,
      total: 10,
      caps: {
        textLength: 8192,
        attributeValueLength: 16384,
        attributesPerRecord: 64,
        eventsPerSpan: 16,
        attributesPerEvent: 32,
      },
    });

    expect(statement.query).toContain("JSONExtractArrayRaw(events)");
    expect(statement.query).toContain(
      "JSONExtractKeysAndValuesRaw(e, 'attributes')",
    );
    expect(statement.query).toContain("isLlmSpan = 1");
    expect(statement.query).toContain("startTime >= {");
    expect(statement.query).not.toContain("readBody");
  });

  test("RUM reads are a RUM application's, and sessions are read from their own table", () => {
    const owners: Statement = buildTelemetryOwnersStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-10-27T10:00:00.000Z"),
      until: new Date("2026-10-27T11:00:00.000Z"),
      source: TelemetrySampleSource.RumSpans,
      excludedOwnerIds: [],
      limit: 200,
    });

    expect(Object.values(owners.query_params)).toContain("RealUserMonitor");
    expect(owners.query).toContain("GROUP BY primaryEntityId");

    const sessions: Statement = buildTelemetrySampleStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-10-27T10:00:00.000Z"),
      until: new Date("2026-10-27T11:00:00.000Z"),
      source: TelemetrySampleSource.RumSessions,
      ownerIds: [WEB_APP],
      perOwner: 10,
      total: 10,
      caps: {
        textLength: 8192,
        attributeValueLength: 4096,
        attributesPerRecord: 128,
        eventsPerSpan: 16,
        attributesPerEvent: 32,
      },
    });

    expect(sessions.query).toContain("RumSessionV1");
    expect(sessions.query).toContain("mapKeys(identifiedUserTraits)");
    expect(sessions.query).toContain("LIMIT {");
    expect(sessions.query).toContain("BY rumApplicationId");
    // Never a recording.
    expect(sessions.query).not.toContain("RumSessionChunk");
    expect(sessions.query).not.toContain("payload");
  });

  test("the traces read leaves the restricted services out, by a bound list", async () => {
    await scan();

    const [tracesOwners] = statementsOf(TelemetrySampleSource.Traces, true);

    expect(parameterAfter(tracesOwners!, OWNERS_NOT_IN)).toEqual([AI_TOOL]);

    const [conversations] = statementsOf(
      TelemetrySampleSource.AiConversations,
      false,
    );

    expect(parameterAfter(conversations!, OWNERS_IN)).toEqual([CHECKOUT]);

    for (const statement of statements) {
      if (!isOwnersRead(statement) && statement.query.includes("SpanItemV3")) {
        expect(
          JSON.stringify(parameterAfter(statement, OWNERS_IN)),
        ).not.toContain(AI_TOOL);
      }
    }
  });
});

describe("what a sample holds", () => {
  test("a service's logs: each attribute and the body, never OneUptime's own attributes", async () => {
    const logs: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(logs.serviceName).toBe("checkout");
    expect(typesAt(logs.result, "attributes.user.email")).toEqual([
      "email-address",
    ]);
    expect(kindAt(logs.result, "attributes.user.email")).toBe(
      DataStoreLocationKind.Attribute,
    );
    expect(typesAt(logs.result, "body")).toEqual(
      expect.arrayContaining(["email-address", "credit-card-number"]),
    );
    expect(kindAt(logs.result, "body")).toBe(DataStoreLocationKind.Body);
    expect(typesAt(logs.result, "attributes.config.github")).toEqual([
      "github-token",
    ]);
    expect(locationsOf(logs.result)).not.toContain(
      "attributes.oneuptime.service.name",
    );
    expect(logs.result.rowsRead).toBe(2);
    expect(logs.result.bytesRead).toBeGreaterThan(0);
    expect(logs.result.isComplete).toBe(true);
    expect(logs.result.readLog[0]).toContain('service "checkout"');
    expect(logs.result.readLog[0]).toContain("logs");
    expect(logs.result.readLog[0]).toContain("1200");
    // Masked, never the value.
    expect(JSON.stringify(logs.result)).not.toContain("jane.doe@acmecorp.io");
    expect(JSON.stringify(logs.result)).not.toContain(GITHUB_TOKEN);
  });

  test("a service's traces: span attributes and each event's attributes", async () => {
    const traces: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryTraces,
      CHECKOUT,
    );

    expect(typesAt(traces.result, "attributes.enduser.email")).toEqual([
      "email-address",
    ]);
    expect(typesAt(traces.result, "events.login.user.email")).toEqual([
      "email-address",
    ]);
    expect(kindAt(traces.result, "events.login.user.email")).toBe(
      DataStoreLocationKind.Attribute,
    );
    expect(
      typesAt(traces.result, "events.exception.exception.message"),
    ).toEqual(["github-token"]);
  });

  test("a service's exceptions: the message and stack trace as text, and the attributes", async () => {
    const exceptions: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryExceptions,
      CHECKOUT,
    );

    expect(typesAt(exceptions.result, "message")).toEqual(["email-address"]);
    expect(kindAt(exceptions.result, "message")).toBe(
      DataStoreLocationKind.Body,
    );
    expect(typesAt(exceptions.result, "stackTrace")).toBeUndefined();
  });

  test("AI conversations: the prompts by their keys, as text, and the other attributes", async () => {
    const conversations: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryAiConversations,
      CHECKOUT,
    );
    const result: ContentScanResult = conversations.result;

    expect(typesAt(result, "gen_ai.input.messages")).toEqual(["email-address"]);
    expect(kindAt(result, "gen_ai.input.messages")).toBe(
      DataStoreLocationKind.Body,
    );
    // Numbered messages are one location.
    expect(typesAt(result, "gen_ai.prompt[].content")).toEqual([
      "email-address",
    ]);
    expect(kindAt(result, "gen_ai.prompt[].content")).toBe(
      DataStoreLocationKind.Body,
    );
    expect(typesAt(result, "attributes.user.email")).toEqual(["email-address"]);
    expect(kindAt(result, "attributes.user.email")).toBe(
      DataStoreLocationKind.Attribute,
    );
    expect(typesAt(result, "events.gen_ai.user.message.content")).toEqual([
      "email-address",
    ]);
    expect(kindAt(result, "events.gen_ai.user.message.content")).toBe(
      DataStoreLocationKind.Body,
    );
    expect(result.rowsRead).toBe(1);
  });

  test("a company AI tool's conversations are reported as not read", async () => {
    const scans: Array<TelemetryStoreScan> = await scan();
    const restricted: TelemetryStoreScan = storeOf(
      scans,
      DataStoreKind.TelemetryAiConversations,
      AI_TOOL,
    );

    expect(restricted.result.warnings).toEqual([
      RESTRICTED_CONVERSATIONS_WARNING,
    ]);
    expect(restricted.result.locations).toEqual([]);
    expect(restricted.result.rowsRead).toBe(0);
    expect(restricted.result.isComplete).toBe(false);
    // And no other store of it was read.
    expect(
      scans.filter((item: TelemetryStoreScan): boolean => {
        return item.serviceId === AI_TOOL;
      }),
    ).toHaveLength(1);
  });

  test("a RUM application's session replays: its logs' attributes, and its sessions' attributes, traits and user", async () => {
    const replays: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetrySessionReplays,
      WEB_APP,
    );

    expect(replays.serviceName).toBe("web");
    expect(typesAt(replays.result, "logs.attributes.user.email")).toEqual([
      "email-address",
    ]);
    expect(
      typesAt(replays.result, "sessions.identifiedUserTraits.email"),
    ).toEqual(["email-address"]);
    expect(typesAt(replays.result, "sessions.identifiedUserLabel")).toEqual([
      "email-address",
    ]);
    expect(kindAt(replays.result, "sessions.identifiedUserLabel")).toBe(
      DataStoreLocationKind.Field,
    );
    // One log, and one session read once though two versions came back.
    expect(replays.result.rowsRead).toBe(2);
    expect(replays.result.readLog.join("\n")).toContain(
      'RUM application "web"',
    );
  });
});

describe("the scan's options", () => {
  test("disabled types, allowed values and exclusions are left out; custom types are found", async () => {
    sampleRows[TelemetrySampleSource.Logs] = [
      {
        ownerId: CHECKOUT,
        readBody: `Paid with card ${CARD} by employee EMP-204817`,
        readAttributes: [
          ["user.email", "jane.doe@acmecorp.io"],
          ["billing.email", "billing@acmecorp.io"],
          ["config.github", GITHUB_TOKEN],
        ],
      },
    ];

    const employee: ScanDetector | null = compileCustomDataType({
      dataTypeId: "custom:employee",
      pattern: "EMP-[0-9]{6}",
    });

    const logs: TelemetryStoreScan = storeOf(
      await scan(
        options({
          customDetectors: [employee!],
          disabledDataTypeIds: new Set(["credit-card-number"]),
          allowedValues: new Set(["billing@acmecorp.io"]),
          exclusions: ["config.github"],
        }),
      ),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(typesAt(logs.result, "body")).toEqual(["custom:employee"]);
    expect(typesAt(logs.result, "attributes.user.email")).toEqual([
      "email-address",
    ]);
    expect(typesAt(logs.result, "attributes.billing.email")).toBeUndefined();
    expect(locationsOf(logs.result)).not.toContain("attributes.config.github");
  });

  test("a scan out of time reads nothing", async () => {
    const scans: Array<TelemetryStoreScan> = await scan(
      options({
        limits: {
          ...options().limits,
          deadline: new Date(Date.now() - 1000),
        },
      }),
    );

    expect(scans).toEqual([]);
    expect(statements).toEqual([]);
  });

  test("a scan stops classifying at its byte budget, and says so", async () => {
    const scans: Array<TelemetryStoreScan> = await scan(
      options({ limits: { ...options().limits, maxBytesTotal: 60 } }),
    );
    const logs: TelemetryStoreScan = storeOf(
      scans,
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(logs.result.bytesRead).toBeLessThanOrEqual(60);
    expect(logs.result.isComplete).toBe(false);
    expect(logs.result.warnings.join(" ")).toContain("as much as it may");
    // Spent: no other source is read.
    expect(
      statements.some((statement: Statement): boolean => {
        return !statement.query.includes("LogItemV3");
      }),
    ).toBe(false);
  });

  test("a megabyte-long value is read only as far as the read cuts it", async () => {
    const longBody: string =
      "a".repeat(3 * 1024 * 1024) + " jane.doe@acmecorp.io";
    sampleRows[TelemetrySampleSource.Logs] = [
      {
        ownerId: CHECKOUT,
        readBody: "jane.doe@acmecorp.io " + longBody,
        readAttributes: [["payload", longBody]],
      },
    ];

    const logs: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(logs.result.bytesRead).toBeLessThanOrEqual(
      TELEMETRY_SCAN_MAX_TEXT_LENGTH * 2,
    );
    expect(typesAt(logs.result, "body")).toEqual(["email-address"]);
  });
});

describe("when a read fails", () => {
  test("a failed sample is a warning on the stores it was for, and the scan goes on", async () => {
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);

        if (
          sourceOf(statement) === TelemetrySampleSource.Logs &&
          !isOwnersRead(statement)
        ) {
          throw new Error("Code: 241. Memory limit exceeded");
        }

        const rows: SourceRows = isOwnersRead(statement)
          ? ownerRows
          : sampleRows;

        return answer(rows[sourceOf(statement)] || []);
      }) as never);

    const scans: Array<TelemetryStoreScan> = await scan();
    const logs: TelemetryStoreScan = storeOf(
      scans,
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(logs.result.isComplete).toBe(false);
    expect(logs.result.warnings[0]).toContain("Could not read");
    // Not the database's words: they can carry the query.
    expect(logs.result.warnings.join(" ")).not.toContain("Memory limit");
    expect(
      typesAt(
        storeOf(scans, DataStoreKind.TelemetryTraces, CHECKOUT).result,
        "attributes.enduser.email",
      ),
    ).toEqual(["email-address"]);
  });

  test("when who may read which conversations cannot be told, no span is read", async () => {
    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockRejectedValue(new Error("Postgres is down"));

    const scans: Array<TelemetryStoreScan> = await scan();

    expect(
      statements.filter((statement: Statement): boolean => {
        return (
          statement.query.includes("SpanItemV3") &&
          !Object.values(statement.query_params).includes("RealUserMonitor")
        );
      }),
    ).toEqual([]);
    expect(
      scans.some((item: TelemetryStoreScan): boolean => {
        return (
          item.kind === DataStoreKind.TelemetryTraces ||
          item.kind === DataStoreKind.TelemetryAiConversations
        );
      }),
    ).toBe(false);
    expect(
      storeOf(scans, DataStoreKind.TelemetryLogs, CHECKOUT).result.rowsRead,
    ).toBe(2);
  });

  test("a service that no longer exists is named so", async () => {
    jest.spyOn(ServiceService, "findBy").mockResolvedValue([] as never);

    const logs: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(logs.serviceName).toBeUndefined();
    expect(logs.result.warnings.join(" ")).toContain("No service with this ID");
  });
});

/*
 * The services the sources read through import, through their hooks, code
 * that imports the scanner (SpanService -> ResourceEntityFilter -> ... ->
 * DataSecurityRunner -> the scanner), so the scanner can load while one of
 * them is still loading: the App loads SpanService first since #6894. A
 * service the scanner took as it loaded was undefined then, and no span or
 * AI call was ever read.
 */
describe("loading", () => {
  test("with SpanService loaded first, every source still reads through its service", () => {
    jest.isolateModules((): void => {
      const spans: unknown = (
        jest.requireActual("../../../../../Server/Services/SpanService") as {
          default: unknown;
        }
      ).default;
      const scanner: { getTelemetrySource: typeof getTelemetrySource } =
        jest.requireActual(
          "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner",
        ) as { getTelemetrySource: typeof getTelemetrySource };

      expect(spans).toBeDefined();

      for (const source of Object.values(TelemetrySampleSource)) {
        expect(scanner.getTelemetrySource(source).runner).toBeDefined();
      }

      for (const source of [
        TelemetrySampleSource.Traces,
        TelemetrySampleSource.AiConversations,
        TelemetrySampleSource.RumSpans,
      ]) {
        expect(scanner.getTelemetrySource(source).runner).toBe(spans);
      }
    });
  });
});

describe("reading keys and values", () => {
  test("numbered parts of a key fold into one location", () => {
    expect(foldAttributeKey("gen_ai.prompt.3.content")).toBe(
      "gen_ai.prompt[].content",
    );
    expect(foldAttributeKey("llm.input_messages.0.message.content")).toBe(
      "llm.input_messages[].message.content",
    );
    expect(foldAttributeKey("items.0.1.email")).toBe("items[][].email");
    expect(foldAttributeKey("http.status_code")).toBe("http.status_code");
  });

  test("the keys GenAI conventions keep what was said under", () => {
    for (const key of [
      "gen_ai.input.messages",
      "gen_ai.output.messages",
      "gen_ai.prompt",
      "gen_ai.completion",
      "gen_ai.system_instructions",
      "gen_ai.prompt.0.content",
      "gen_ai.completion.2.content",
      "llm.input_messages.1.message.content",
      "llm.output_messages.0.message.content",
      "gen_ai.tool.call.arguments",
    ]) {
      expect(isConversationContentKey(key)).toBe(true);
    }

    for (const key of [
      "gen_ai.prompt.0.role",
      "llm.input_messages.0.message.role",
      "gen_ai.request.model",
      "user.email",
      "gen_ai.prompt.x.content",
    ]) {
      expect(isConversationContentKey(key)).toBe(false);
    }
  });

  test("an event attribute's raw JSON value, whole or cut short", () => {
    expect(fromRawJsonValue('"jane@acmecorp.io"')).toBe("jane@acmecorp.io");
    expect(fromRawJsonValue('"line one\\nghp_abc')).toBe("line one\nghp_abc");
    expect(fromRawJsonValue('"caf\\u00')).toBe("caf");
    expect(fromRawJsonValue("42")).toBe("42");
    expect(fromRawJsonValue("null")).toBe("");
    expect(fromRawJsonValue('["a","b"]')).toBe('["a","b"]');
  });

  test("exclusions name a location, a part of one, or a bare attribute key", () => {
    expect(isExcludedLocation("attributes.http.url", ["attributes.http"])).toBe(
      true,
    );
    expect(isExcludedLocation("attributes.http.url", ["http.url"])).toBe(true);
    expect(isExcludedLocation("spans.attributes.http.url", ["http"])).toBe(
      true,
    );
    expect(isExcludedLocation("body", ["body"])).toBe(true);
    expect(isExcludedLocation("attributes.http.url", ["http.ur"])).toBe(false);
    expect(isExcludedLocation("attributes.user.email", [])).toBe(false);
  });
});

/*
 * A STORE WHOSE SCAN CONTENT SWITCH IS OFF IS NEVER READ (OneUptime issue
 * #8323). The switch did nothing for a service's telemetry: its logs were
 * sampled every hour and their findings kept masked samples all the same.
 * Now the scan is told which owners' stores of each kind are off
 * (DataSecurityTelemetryScanRule), and leaves them out of every read of
 * that kind: by a bound NOT IN in the owners' read, so they take no place
 * among the owners read, and never in a sample read.
 */
describe("a store whose Scan Content switch is off", () => {
  async function scanWithout(
    ownersNotScanned: Map<DataStoreKind, Set<string>>,
  ): Promise<Array<TelemetryStoreScan>> {
    return await scanProjectTelemetry({
      projectId: PROJECT_ID,
      sampleSize: 100,
      since: new Date(Date.now() - 60 * 60 * 1000),
      options: options(),
      ownersNotScanned,
    });
  }

  function storesOf(
    scans: Array<TelemetryStoreScan>,
    ownerId: string,
  ): Array<DataStoreKind> {
    return scans
      .filter((item: TelemetryStoreScan): boolean => {
        return item.serviceId === ownerId;
      })
      .map((item: TelemetryStoreScan): DataStoreKind => {
        return item.kind;
      })
      .sort();
  }

  function sampledOwners(source: TelemetrySampleSource): Array<string> {
    return statementsOf(source, false).flatMap(
      (statement: Statement): Array<string> => {
        return parameterAfter(statement, OWNERS_IN) as Array<string>;
      },
    );
  }

  test("nothing switched off: every store is read, and no owner is left out of the logs' read", async () => {
    const scans: Array<TelemetryStoreScan> = await scanWithout(new Map());

    expect(storesOf(scans, CHECKOUT)).toEqual(
      [
        DataStoreKind.TelemetryLogs,
        DataStoreKind.TelemetryTraces,
        DataStoreKind.TelemetryExceptions,
        DataStoreKind.TelemetryAiConversations,
        DataStoreKind.TelemetryMetrics,
      ].sort(),
    );

    const [logsOwners] = statementsOf(TelemetrySampleSource.Logs, true);

    expect(logsOwners!.query).not.toMatch(OWNERS_NOT_IN);
  });

  test("a service's logs store off: its logs are left out of the owners' read, never sampled, and have no result", async () => {
    const scans: Array<TelemetryStoreScan> = await scanWithout(
      new Map([[DataStoreKind.TelemetryLogs, new Set([CHECKOUT])]]),
    );

    const [logsOwners] = statementsOf(TelemetrySampleSource.Logs, true);

    expect(parameterAfter(logsOwners!, OWNERS_NOT_IN)).toEqual([CHECKOUT]);
    // The mock answers the owner anyway: it is still never sampled.
    expect(statementsOf(TelemetrySampleSource.Logs, false)).toHaveLength(0);
    expect(storesOf(scans, CHECKOUT)).not.toContain(
      DataStoreKind.TelemetryLogs,
    );
    expect(JSON.stringify(scans)).not.toContain("jane.doe");
  });

  test("only that kind is left out: the service's other stores are read as before", async () => {
    const scans: Array<TelemetryStoreScan> = await scanWithout(
      new Map([[DataStoreKind.TelemetryLogs, new Set([CHECKOUT])]]),
    );

    expect(storesOf(scans, CHECKOUT)).toEqual(
      [
        DataStoreKind.TelemetryTraces,
        DataStoreKind.TelemetryExceptions,
        DataStoreKind.TelemetryAiConversations,
        DataStoreKind.TelemetryMetrics,
      ].sort(),
    );
    expect(sampledOwners(TelemetrySampleSource.Traces)).toEqual([CHECKOUT]);
    expect(sampledOwners(TelemetrySampleSource.Exceptions)).toEqual([CHECKOUT]);
  });

  test("an id in another case is left out all the same", async () => {
    const scans: Array<TelemetryStoreScan> = await scanWithout(
      new Map([
        [DataStoreKind.TelemetryExceptions, new Set([CHECKOUT.toUpperCase()])],
      ]),
    );

    const [owners] = statementsOf(TelemetrySampleSource.Exceptions, true);

    expect(parameterAfter(owners!, OWNERS_NOT_IN)).toEqual([CHECKOUT]);
    expect(statementsOf(TelemetrySampleSource.Exceptions, false)).toHaveLength(
      0,
    );
    expect(storesOf(scans, CHECKOUT)).not.toContain(
      DataStoreKind.TelemetryExceptions,
    );
  });

  test("traces: the switched-off services and the restricted ones are left out together", async () => {
    await scanWithout(
      new Map([[DataStoreKind.TelemetryTraces, new Set([CHECKOUT])]]),
    );

    const [tracesOwners] = statementsOf(TelemetrySampleSource.Traces, true);

    expect(
      (parameterAfter(tracesOwners!, OWNERS_NOT_IN) as Array<string>).sort(),
    ).toEqual([AI_TOOL, CHECKOUT].sort());
    expect(statementsOf(TelemetrySampleSource.Traces, false)).toHaveLength(0);
  });

  test("a company AI tool whose conversations store is off is not even listed as not read", async () => {
    const scans: Array<TelemetryStoreScan> = await scanWithout(
      new Map([[DataStoreKind.TelemetryAiConversations, new Set([AI_TOOL])]]),
    );

    const [conversationOwners] = statementsOf(
      TelemetrySampleSource.AiConversations,
      true,
    );

    expect(parameterAfter(conversationOwners!, OWNERS_NOT_IN)).toEqual([
      AI_TOOL,
    ]);
    expect(storesOf(scans, AI_TOOL)).toEqual([]);
    // The other service's conversations are still read.
    expect(sampledOwners(TelemetrySampleSource.AiConversations)).toEqual([
      CHECKOUT,
    ]);
  });

  test("a RUM application's session replays store off: none of its logs, spans or sessions are read", async () => {
    const scans: Array<TelemetryStoreScan> = await scanWithout(
      new Map([[DataStoreKind.TelemetrySessionReplays, new Set([WEB_APP])]]),
    );

    for (const source of [
      TelemetrySampleSource.RumLogs,
      TelemetrySampleSource.RumSpans,
      TelemetrySampleSource.RumSessions,
    ]) {
      for (const owners of statementsOf(source, true)) {
        expect(parameterAfter(owners, OWNERS_NOT_IN)).toEqual([WEB_APP]);
      }

      expect(statementsOf(source, false)).toHaveLength(0);
    }

    expect(storesOf(scans, WEB_APP)).toEqual([]);
    expect(JSON.stringify(scans)).not.toContain("kai.wu");
  });

  test("every store of a service off: nothing of it is read at all", async () => {
    const off: Map<DataStoreKind, Set<string>> = new Map();

    for (const kind of [
      DataStoreKind.TelemetryLogs,
      DataStoreKind.TelemetryTraces,
      DataStoreKind.TelemetryExceptions,
      DataStoreKind.TelemetryAiConversations,
      DataStoreKind.TelemetryMetrics,
    ]) {
      off.set(kind, new Set([CHECKOUT]));
    }

    const scans: Array<TelemetryStoreScan> = await scanWithout(off);

    expect(storesOf(scans, CHECKOUT)).toEqual([]);
    // Not even which metrics it wrote is read.
    expect(statements.filter(isMetricsList)).toHaveLength(0);

    for (const statement of statements) {
      if (!isOwnersRead(statement)) {
        expect(
          JSON.stringify(parameterAfter(statement, OWNERS_IN)),
        ).not.toContain(CHECKOUT);
      }
    }
  });
});

/*
 * THE RECORDS EACH FINDING WAS FOUND IN (issue #9549).
 *
 * A finding's records used to be looked for among the service's newest
 * ones, where a type seen in one sampled line of four hundred was never
 * found. The scan now keeps, by location and data type, which records of
 * its sample held it - when each was written and its trace, span or
 * session - so the issue's page reads those very records again.
 */
describe("the records a sample's findings were found in", () => {
  const CAPS: {
    textLength: number;
    attributeValueLength: number;
    attributesPerRecord: number;
    eventsPerSpan: number;
    attributesPerEvent: number;
  } = {
    textLength: 8192,
    attributeValueLength: 4096,
    attributesPerRecord: 128,
    eventsPerSpan: 16,
    attributesPerEvent: 32,
  };

  function sampleOf(source: TelemetrySampleSource): Statement {
    return buildTelemetrySampleStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-10-27T10:00:00.000Z"),
      until: new Date("2026-10-27T11:00:00.000Z"),
      source,
      ownerIds: [source.startsWith("Rum") ? WEB_APP : CHECKOUT],
      perOwner: 10,
      total: 10,
      caps: CAPS,
    });
  }

  function recordsAt(
    result: ContentScanResult,
    location: string,
    dataTypeId: string,
  ): Array<FindingSampleRecord> | undefined {
    return result.locations.find((entry: LocationFindings): boolean => {
      return entry.location === location;
    })?.sampleRecords?.[dataTypeId];
  }

  const T1: number = Date.UTC(2026, 9, 27, 10, 59, 58, 123);
  const T2: number = Date.UTC(2026, 9, 27, 10, 58, 1, 7);
  const T3: number = Date.UTC(2026, 9, 27, 10, 41, 0, 0);

  test("every sample reads each record's time to the millisecond, and the keys that tell it apart", () => {
    for (const source of [
      TelemetrySampleSource.Logs,
      TelemetrySampleSource.Traces,
      TelemetrySampleSource.Exceptions,
      TelemetrySampleSource.AiConversations,
      TelemetrySampleSource.RumLogs,
      TelemetrySampleSource.RumSpans,
      TelemetrySampleSource.RumSessions,
    ]) {
      const query: string = sampleOf(source).query;
      const timeColumn: string = getTelemetrySource(source).timeColumn;

      expect(query).toContain(
        `toUnixTimestamp64Milli(toDateTime64(${timeColumn}, 3)) AS readRecordTime`,
      );
      expect(
        query.includes("traceId AS readTraceId, spanId AS readSpanId"),
      ).toBe(source !== TelemetrySampleSource.RumSessions);
      expect(query.includes("sessionId AS readSessionId")).toBe(
        source.startsWith("Rum"),
      );
      // A log line's own id, which opens that very line (#9793): logs only.
      expect(query.includes("_id AS readLogId")).toBe(
        source === TelemetrySampleSource.Logs ||
          source === TelemetrySampleSource.RumLogs,
      );
    }

    // The metrics' reads take no line's id either.
    expect(
      buildTelemetryMetricSampleStatement({
        projectId: PROJECT_ID,
        since: new Date("2026-10-27T10:00:00.000Z"),
        until: new Date("2026-10-27T11:00:00.000Z"),
        metrics: [
          {
            ownerId: CHECKOUT,
            metricName: "user.logins",
            points: 10,
            newestMinute: new Date("2026-10-27T10:59:00.000Z"),
            newestMinutePoints: 2,
          },
        ],
        perMetric: 10,
        caps: CAPS,
      }).query,
    ).not.toContain("readLogId");
  });

  test("a log line is kept with its own id; a row whose id is not one is kept without it", async () => {
    const LOG_ID: string = "0192f1a0-0000-7000-8000-00000009793a";

    sampleRows[TelemetrySampleSource.Logs] = [
      {
        ownerId: CHECKOUT,
        readRecordTime: String(T1),
        readTraceId: "",
        readSpanId: "",
        readLogId: LOG_ID,
        readBody: "Signed up jane.doe@acmecorp.io from the mobile app",
        readAttributes: [],
      },
      {
        ownerId: CHECKOUT,
        readRecordTime: String(T2),
        readTraceId: "",
        readSpanId: "",
        readLogId: "not-an-id",
        readBody: "Signed up kai.wu@acmecorp.io from the web",
        readAttributes: [],
      },
    ];

    const logs: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(recordsAt(logs.result, "body", "email-address")).toEqual([
      { time: new Date(T1).toISOString(), logId: LOG_ID },
      { time: new Date(T2).toISOString() },
    ]);
    expect(
      readSampleRecord({ readRecordTime: String(T1), readLogId: LOG_ID }),
    ).toEqual({ time: new Date(T1).toISOString(), logId: LOG_ID });
  });

  test("each location's findings keep the records whose value held them, the newest first", async () => {
    sampleRows[TelemetrySampleSource.Logs] = [
      {
        ownerId: CHECKOUT,
        // ClickHouse quotes a 64-bit number in JSON.
        readRecordTime: String(T1),
        readTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        readSpanId: "00f067aa0ba902b7",
        readBody: "Signed up jane.doe@acmecorp.io from the mobile app",
        readAttributes: [["http.status_code", "200"]],
      },
      {
        ownerId: CHECKOUT,
        readRecordTime: String(T2),
        readTraceId: "",
        readSpanId: "",
        readBody: "Health check ok",
        readAttributes: [["http.status_code", "200"]],
      },
      {
        ownerId: CHECKOUT,
        readRecordTime: String(T3),
        readTraceId: "a3ce929d0e0e47364bf92f3577b34da6",
        readSpanId: "53995c3f42cd8ad8",
        readBody: `Paid with card ${CARD} by kai.wu@acmecorp.io`,
        readAttributes: [],
      },
    ];

    const logs: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(recordsAt(logs.result, "body", "email-address")).toEqual([
      {
        time: new Date(T1).toISOString(),
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
      },
      {
        time: new Date(T3).toISOString(),
        traceId: "a3ce929d0e0e47364bf92f3577b34da6",
        spanId: "53995c3f42cd8ad8",
      },
    ]);
    expect(recordsAt(logs.result, "body", "credit-card-number")).toEqual([
      {
        time: new Date(T3).toISOString(),
        traceId: "a3ce929d0e0e47364bf92f3577b34da6",
        spanId: "53995c3f42cd8ad8",
      },
    ]);
  });

  test("the classifications written carry no index into the sample", async () => {
    const logs: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    for (const location of logs.result.locations) {
      for (const classification of location.classifications) {
        expect(
          Object.keys(classification).includes("matchedValueIndexes"),
        ).toBe(false);
      }
    }
  });

  test("a record with no time is classified, but kept as no reference", async () => {
    // The fixture's rows carry no time: their findings are found, with no record.
    const logs: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetryLogs,
      CHECKOUT,
    );

    expect(typesAt(logs.result, "attributes.user.email")).toEqual([
      "email-address",
    ]);
    expect(
      recordsAt(logs.result, "attributes.user.email", "email-address"),
    ).toEqual([]);
  });

  test("a session's records keep its id; the same record is kept once, ten at most", async () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index < 14; index++) {
      rows.push({
        ownerId: WEB_APP,
        readRecordTime: String(T1 - index * 1000),
        readTraceId: `trace-${index}`,
        readSpanId: `span-${index}`,
        readSessionId: `session-${index % 3}`,
        readAttributes: [["user.email", `user${index}@acmecorp.io`]],
      });
    }

    sampleRows[TelemetrySampleSource.RumLogs] = rows;
    ownerRows[TelemetrySampleSource.RumLogs] = [
      { ownerId: WEB_APP, records: "14" },
    ];

    const replays: TelemetryStoreScan = storeOf(
      await scan(),
      DataStoreKind.TelemetrySessionReplays,
      WEB_APP,
    );
    const records: Array<FindingSampleRecord> =
      recordsAt(
        replays.result,
        "logs.attributes.user.email",
        "email-address",
      ) || [];

    expect(records.length).toBe(MAX_FINDING_SAMPLE_RECORDS);
    expect(records[0]).toEqual({
      time: new Date(T1).toISOString(),
      traceId: "trace-0",
      spanId: "span-0",
      sessionId: "session-0",
    });
  });

  test("reading a row's keys, and mapping the values that held a type to their records", () => {
    expect(
      readSampleRecord({
        readRecordTime: String(T1),
        readTraceId: " t ",
        readSpanId: "",
        readSessionId: "s",
      }),
    ).toEqual({
      time: new Date(T1).toISOString(),
      traceId: "t",
      sessionId: "s",
    });
    expect(readSampleRecord({ readRecordTime: "0" })).toBe(null);
    expect(readSampleRecord({})).toBe(null);

    const first: FindingSampleRecord = { time: new Date(T1).toISOString() };
    const second: FindingSampleRecord = { time: new Date(T2).toISOString() };
    const classification: FieldClassification = {
      dataTypeId: "email-address",
      matchedValueIndexes: [0, 2, 3, 4],
    } as unknown as FieldClassification;

    expect(
      getSampleRecordsByDataType({
        classifications: [classification],
        records: [first, second, null, first, second],
        valueCount: 5,
      }),
    ).toEqual({ "email-address": [first, second] });
    // Values and records out of step: no records, rather than the wrong ones.
    expect(
      getSampleRecordsByDataType({
        classifications: [classification],
        records: [first, second],
        valueCount: 5,
      }),
    ).toEqual({});
  });
});

/*
 * A SERVICE'S METRICS (issue #9604).
 *
 * A metric attribute that holds a user's email, a client's IP or a token
 * was never read. A service's metrics are a store of their own now: each
 * data point's attributes, its resource's among them, and the metrics'
 * names. Sampled by series, not points - each metric's newest minute, a
 * few points of it, each value classified once - and bounded: which
 * metrics come from the per-minute rollup, a scan reads a hundred of them
 * at most, each service's busiest and the rest in turn, in one read of
 * their ranges of the table, and a metric of many series by a branch of
 * its own that stops early.
 */
describe("a service's metrics", () => {
  const WINDOW: { projectId: ObjectID; since: Date; until: Date } = {
    projectId: PROJECT_ID,
    since: new Date("2026-10-27T10:00:00.000Z"),
    until: new Date("2026-10-27T11:00:00.000Z"),
  };
  const CAPS: {
    textLength: number;
    attributeValueLength: number;
    attributesPerRecord: number;
    eventsPerSpan: number;
    attributesPerEvent: number;
  } = {
    textLength: 8192,
    attributeValueLength: 4096,
    attributesPerRecord: 128,
    eventsPerSpan: 16,
    attributesPerEvent: 32,
  };

  function metric(
    metricName: string,
    data: Partial<MetricToRead> = {},
  ): MetricToRead {
    return {
      ownerId: CHECKOUT,
      metricName,
      points: 100,
      newestMinute: new Date("2026-10-27T10:59:00.000Z"),
      newestMinutePoints: 40,
      ...data,
    };
  }

  function metricsStore(scans: Array<TelemetryStoreScan>): TelemetryStoreScan {
    return storeOf(scans, DataStoreKind.TelemetryMetrics, CHECKOUT);
  }

  function sampleStatements(): Array<Statement> {
    return statementsOf(TelemetrySampleSource.Metrics, false).filter(
      (statement: Statement): boolean => {
        return !isMetricsList(statement);
      },
    );
  }

  function boundValues(statement: Statement): Array<unknown> {
    return Object.values(statement.query_params);
  }

  describe("the statements", () => {
    test("the services with metrics, then which metrics they wrote from the rollup, then each metric's newest minute", async () => {
      await scan();

      const [owners] = statementsOf(TelemetrySampleSource.Metrics, true);
      const lists: Array<Statement> = statements.filter(isMetricsList);
      const samples: Array<Statement> = sampleStatements();

      // The services': never a monitor's or a host's metrics.
      expect(owners!.query).toContain("FROM oneuptime.MetricItemV3");
      expect(boundValues(owners!)).toContain("OpenTelemetry");
      expect(lists).toHaveLength(1);
      expect(lists[0]!.query).toContain("FROM oneuptime.MetricItemAggMV1m");
      expect(lists[0]!.query).toContain("countMerge(valueCountState)");
      expect(parameterAfter(lists[0]!, OWNERS_IN)).toEqual([CHECKOUT]);
      expect(samples).toHaveLength(1);
      expect(samples[0]!.query).toContain("FROM oneuptime.MetricItemV3");
      // Each metric by its own range of the primary key: name, service, time.
      expect(boundValues(samples[0]!)).toEqual(
        expect.arrayContaining([
          "user.logins",
          "signups.kim.lee@acmecorp.io.count",
          CHECKOUT,
        ]),
      );
      expect(samples[0]!.query).not.toContain("user.logins");
      expect(samples[0]!.query).not.toContain(CHECKOUT);
    });

    test("the rollup's list: a day of each service's metrics, the ones it started writing lately first, then the busiest, the newest minute and how full it is", () => {
      const statement: Statement = buildTelemetryMetricsStatement({
        ...WINDOW,
        ownerIds: [CHECKOUT],
        perOwner: 1000,
        total: 20000,
        fromRollup: true,
      });

      const query: string = statement.query;

      expect(query).toContain(
        "max(lastMinutePoints) AS newestMinutePoints, min(firstWrote) AS firstMinute",
      );
      expect(query).toContain(
        "argMax(minutePoints, minute) AS lastMinutePoints",
      );
      expect(query).toContain("toUnixTimestamp(max(minute)) AS lastMinute");
      expect(query.match(/retentionDate >= now\(\)/g)).toHaveLength(2);
      // The window's minutes counted one by one, from the minute it starts in...
      expect(query).toContain(
        "FROM (SELECT primaryEntityId AS ownerId, name AS metricName, bucketTime AS minute, countMerge(valueCountState) AS minutePoints FROM oneuptime.MetricItemAggMV1m WHERE projectId = ",
      );
      const ranges: Array<string> = Array.from(
        query.matchAll(
          /bucketTime >= \{(p\d+):DateTime64\(9\)\} AND bucketTime (<=?) \{(p\d+):DateTime64\(9\)\}/g,
        ),
      ).map((range: RegExpMatchArray): string => {
        return `${String(statement.query_params[range[1]!]).slice(0, 19)} ${range[2]} ${String(statement.query_params[range[3]!]).slice(0, 19)}`;
      });

      expect(ranges).toEqual([
        "2026-10-27 10:00:00 <= 2026-10-27 11:00:00",
        // ...and of the day before, only when each first wrote: no count merged.
        "2026-10-26 11:00:00 < 2026-10-27 10:00:00",
      ]);
      expect(query).toContain(
        " UNION ALL SELECT primaryEntityId AS ownerId, name AS metricName, 0 AS windowPoints, 0 AS lastMinute, 0 AS lastMinutePoints, toUnixTimestamp(min(bucketTime)) AS firstWrote FROM oneuptime.MetricItemAggMV1m WHERE ",
      );
      expect(query.match(/countMerge/g)).toHaveLength(1);
      expect(
        query.match(/primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/g),
      ).toHaveLength(2);
      // Only a metric written in the window; the new ones first, then the busiest.
      expect(statement.query).toContain(
        ") GROUP BY ownerId, metricName HAVING points > 0 ORDER BY firstMinute >= {",
      );
      expect(statement.query).toContain(
        "} DESC, points DESC, ownerId ASC, metricName ASC LIMIT {",
      );
      expect(
        parameterAfter(
          statement,
          /ORDER BY firstMinute >= \{(p\d+):Int64\} DESC/,
        ),
      ).toBe(
        Math.floor(
          (WINDOW.until.getTime() -
            TELEMETRY_SCAN_NEW_METRIC_WINDOW_IN_HOURS * 3_600_000) /
            1000,
        ),
      );
      expect(TELEMETRY_SCAN_NEW_METRIC_WINDOW_IN_HOURS).toBe(2);
      expect(TELEMETRY_SCAN_NEW_METRIC_LOOKBACK_IN_HOURS).toBe(24);
      expect(Number(parameterAfter(statement, METRICS_LIST_LIMIT_BY))).toBe(
        1000,
      );
      expect(statement.query).toContain("max_execution_time = 30");
    });

    test("the points' list, when the rollup cannot answer: the light columns of the services' points", () => {
      const statement: Statement = buildTelemetryMetricsStatement({
        ...WINDOW,
        ownerIds: [CHECKOUT],
        perOwner: 1000,
        total: 20000,
        fromRollup: false,
      });

      expect(statement.query).toContain("FROM oneuptime.MetricItemV3");
      expect(statement.query).toContain("toStartOfMinute(time) AS minute");
      expect(statement.query).not.toContain("attributes");
      expect(boundValues(statement)).toContain("OpenTelemetry");
      // The window's points alone, never a day of them: no first minute is known.
      expect(statement.query).toContain("0 AS firstWrote FROM (");
      expect(statement.query).not.toContain("UNION ALL");
      expect(String(parameterAfter(statement, WINDOW_START))).toMatch(
        /^2026-10-27 10:00:00/,
      );
    });

    test("one read of the metrics' newest minutes: each metric's range, at most a few series of each, every value cut short", () => {
      const statement: Statement = buildTelemetryMetricSampleStatement({
        ...WINDOW,
        metrics: [metric("user.logins"), metric("http.requests")],
        perMetric: 100,
        caps: CAPS,
      });

      expect(statement.query.match(/\(name = \{p\d+:String\}/g)).toHaveLength(
        2,
      );
      expect(statement.query).toContain(" OR ");
      expect(Number(parameterAfter(statement, LIMIT_BY))).toBe(100);
      expect(statement.query).toContain("BY primaryEntityId, name LIMIT");
      expect(statement.query).toContain("substringUTF8(name, 1, {");
      expect(statement.query).toContain("arraySlice(mapKeys(attributes), 1, {");
      expect(statement.query).toContain("toUnixTimestamp64Milli");
      expect(boundValues(statement)).toEqual(
        expect.arrayContaining(["user.logins", "http.requests", CHECKOUT]),
      );
      expect(statement.query).not.toContain("UNION ALL");
    });

    /*
     * #9756: the first hundred points of a minute were a hundred series only
     * where each series wrote one point; a series that wrote more - scraped
     * every fifteen seconds, or a busy route beside quiet ones - took the
     * others' places. A point of each series first, then a hundred series.
     */
    test("a point of each series first, kept once by a hash of its metric and attributes, then a hundred series of each metric", () => {
      const statement: Statement = buildTelemetryMetricSampleStatement({
        ...WINDOW,
        metrics: [metric("user.logins"), metric("http.requests")],
        perMetric: 100,
        caps: CAPS,
      });
      const query: string = statement.query;
      const inner: number = query.indexOf(
        " FROM (SELECT primaryEntityId, name, time, attributes FROM oneuptime.MetricItemV3 WHERE projectId = ",
      );
      const series: number = query.indexOf(
        ") LIMIT 1 BY cityHash64(primaryEntityId, name, attributes)) LIMIT {",
      );
      const ranges: number = query.indexOf("(name = {");

      // The points' columns, of the metrics' ranges, then each series once.
      expect(inner).toBeGreaterThan(0);
      expect(ranges).toBeGreaterThan(inner);
      expect(series).toBeGreaterThan(ranges);
      // Then a hundred series of each metric, a hundred of each in all.
      expect(query.slice(series)).toMatch(
        /^\) LIMIT 1 BY cityHash64\(primaryEntityId, name, attributes\)\) LIMIT \{p\d+:Int32\} BY primaryEntityId, name LIMIT \{p\d+:Int32\} SETTINGS /,
      );
      expect(
        Number(
          parameterAfter(
            statement,
            /\) LIMIT \{(p\d+):Int32\} BY primaryEntityId, name/,
          ),
        ),
      ).toBe(100);
      expect(
        Number(
          parameterAfter(
            statement,
            /BY primaryEntityId, name LIMIT \{(p\d+):Int32\} SETTINGS/,
          ),
        ),
      ).toBe(200);
      // What is read out of each series: cut short outside the subquery, on its rows only.
      expect(query.indexOf("substringUTF8(name, 1, {")).toBeLessThan(inner);
      expect(
        query.indexOf("arraySlice(mapKeys(attributes), 1, {"),
      ).toBeLessThan(inner);
      expect(query.indexOf("toUnixTimestamp64Milli")).toBeLessThan(inner);
      // The project, the window and the type: the subquery's, as every read's.
      expect(parameterAfter(statement, PROJECT_PARAMETER)).toBe(
        PROJECT_ID.toString(),
      );
      expect(query).toContain("retentionDate >= now()");
      expect(query.match(/\bSETTINGS\b/g)).toHaveLength(1);
      expect(query).toContain("max_execution_time = 30");
      expect(query).not.toContain("ORDER BY");
    });

    test("the busiest metric's series no longer crowd out a quiet one: a point of each series is what a scan classifies", async () => {
      // What the per-series read answers for a busy route and a quiet one.
      sampleRows[TelemetrySampleSource.Metrics] = [
        {
          ownerId: CHECKOUT,
          readRecordTime: String(Date.now() - 50_000),
          readMetricName: "user.logins",
          readAttributes: [["http.route", "/api/busy"]],
        },
        {
          ownerId: CHECKOUT,
          readRecordTime: String(Date.now() - 20_000),
          readMetricName: "user.logins",
          readAttributes: [
            ["http.route", "/users/quiet.user@acmecorp.io/orders"],
          ],
        },
      ];

      const metrics: TelemetryStoreScan = storeOf(
        await scan(),
        DataStoreKind.TelemetryMetrics,
        CHECKOUT,
      );

      expect(typesAt(metrics.result, "attributes.http.route")).toEqual([
        "email-address",
      ]);
      // The ordinary read was the per-series one.
      expect(
        statements.some((statement: Statement): boolean => {
          return statement.query.includes(
            "LIMIT 1 BY cityHash64(primaryEntityId, name, attributes)",
          );
        }),
      ).toBe(true);
    });

    test("a metric of many series: a branch of its own, stopped at its first points", () => {
      const statement: Statement = buildTelemetryLargeMetricSampleStatement({
        ...WINDOW,
        metrics: [
          metric("user.logins", { newestMinutePoints: 1_000_000 }),
          metric("session.views", { newestMinutePoints: 500_000 }),
        ],
        perMetric: 100,
        caps: CAPS,
      });

      expect(statement.query.startsWith("SELECT * FROM ((SELECT")).toBe(true);
      expect(statement.query.match(/UNION ALL/g)).toHaveLength(1);
      // A LIMIT with no ORDER BY in each branch: the read stops there.
      expect(statement.query.match(/LIMIT \{p\d+:Int32\}\)/g)).toHaveLength(2);
      expect(statement.query).not.toContain("ORDER BY");
      expect(statement.query).toContain("max_execution_time = 30");
    });

    test("which metric is read by a branch of its own", () => {
      expect(
        isLargeMetric(
          metric("a", {
            newestMinutePoints: TELEMETRY_SCAN_MAX_BATCHED_METRIC_POINTS,
          }),
        ),
      ).toBe(false);
      expect(
        isLargeMetric(
          metric("a", {
            newestMinutePoints: TELEMETRY_SCAN_MAX_BATCHED_METRIC_POINTS + 1,
          }),
        ),
      ).toBe(true);
    });

    test("a scan reads a metric of many series by its own branch, and the others together", async () => {
      metricListRows = [
        {
          ownerId: CHECKOUT,
          metricName: "user.logins",
          points: "2000000",
          newestMinute: newestMinuteNow(),
          newestMinutePoints: String(
            TELEMETRY_SCAN_MAX_BATCHED_METRIC_POINTS + 1,
          ),
        },
        {
          ownerId: CHECKOUT,
          metricName: "http.requests",
          points: "500",
          newestMinute: newestMinuteNow(),
          newestMinutePoints: "20",
        },
      ];

      await scan();

      const samples: Array<Statement> = sampleStatements();
      const large: Statement | undefined = samples.find(
        (statement: Statement): boolean => {
          return (
            statement.query.includes("UNION ALL") ||
            statement.query.startsWith("SELECT * FROM ((")
          );
        },
      );
      const batch: Statement | undefined = samples.find(
        (statement: Statement): boolean => {
          return !statement.query.startsWith("SELECT * FROM ((");
        },
      );

      expect(samples).toHaveLength(2);
      expect(boundValues(large!)).toContain("user.logins");
      expect(boundValues(large!)).not.toContain("http.requests");
      expect(boundValues(batch!)).toContain("http.requests");
      expect(boundValues(batch!)).not.toContain("user.logins");
    });
  });

  describe("what a sample holds", () => {
    test("each data point's attributes, its resource's among them, and the metric's name - never OneUptime's own", async () => {
      const result: ContentScanResult = metricsStore(await scan()).result;

      expect(typesAt(result, "attributes.user.email")).toEqual([
        "email-address",
      ]);
      expect(typesAt(result, "attributes.resource.client.ip")).toEqual([
        "ip-address",
      ]);
      expect(typesAt(result, "name")).toContain("email-address");
      expect(kindAt(result, "attributes.user.email")).toBe(
        DataStoreLocationKind.Attribute,
      );
      expect(kindAt(result, "name")).toBe(DataStoreLocationKind.Field);
      expect(locationsOf(result)).not.toContain(
        "attributes.oneuptime.service.id",
      );
      // The point's value is a number: never read.
      expect(JSON.stringify(result)).not.toContain("readValue");
    });

    test("a value is classified once, however many points and series repeat it", async () => {
      const result: ContentScanResult = metricsStore(await scan()).result;
      const email: LocationFindings = result.locations.find(
        (entry: LocationFindings): boolean => {
          return entry.location === "attributes.user.email";
        },
      )!;
      const ip: LocationFindings = result.locations.find(
        (entry: LocationFindings): boolean => {
          return entry.location === "attributes.resource.client.ip";
        },
      )!;

      // Two users' series, one of them twice: two values.
      expect(email.classifications[0]!.valueCount).toBe(2);
      // The same client on every point: one value.
      expect(ip.classifications[0]!.valueCount).toBe(1);
    });

    test("a metric's records: an attribute's name their metric, a name's never, and a name holding data is never kept", async () => {
      const result: ContentScanResult = metricsStore(await scan()).result;
      const recordsOf: (location: string) => Array<FindingSampleRecord> = (
        location: string,
      ): Array<FindingSampleRecord> => {
        return (
          result.locations.find((entry: LocationFindings): boolean => {
            return entry.location === location;
          })?.sampleRecords?.["email-address"] || []
        );
      };

      expect(recordsOf("attributes.user.email").length).toBeGreaterThan(0);
      expect(
        recordsOf("attributes.user.email").every(
          (record: FindingSampleRecord): boolean => {
            return record.metricName === "user.logins";
          },
        ),
      ).toBe(true);
      expect(recordsOf("name")).toHaveLength(1);
      expect(recordsOf("name")[0]!.metricName).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("kim.lee");
    });

    test("a metric's points are read as the scan reads them: the name, then the attributes", () => {
      const values: Array<TelemetryRecordValue> = readTelemetryRecordValues(
        TelemetrySampleSource.Metrics,
        {
          readMetricName: "http.requests",
          readAttributes: [
            ["http.route", "/orders"],
            ["oneuptime.service.name", "checkout"],
            ["resource.host.name", "web-1"],
            ["empty", ""],
          ],
        },
        CAPS,
      )!;

      expect(
        values.map((value: TelemetryRecordValue): Array<string> => {
          return [value.location, value.value];
        }),
      ).toEqual([
        ["name", "http.requests"],
        ["attributes.http.route", "/orders"],
        ["attributes.resource.host.name", "web-1"],
      ]);
      expect(values[1]!.field).toBe("http.route");
    });

    test("exclusions leave a metric's attribute out, named whole or as its bare key", async () => {
      const result: ContentScanResult = metricsStore(
        await scan(options({ exclusions: ["user.email", "name"] })),
      ).result;

      expect(locationsOf(result)).not.toContain("attributes.user.email");
      expect(locationsOf(result)).not.toContain("name");
      expect(locationsOf(result)).toContain("attributes.resource.client.ip");
    });

    test("the read log says how many points of how many metrics were read", async () => {
      const result: ContentScanResult = metricsStore(await scan()).result;

      expect(result.readLog).toHaveLength(1);
      expect(result.readLog[0]).toContain('service "checkout"');
      expect(result.readLog[0]).toContain(
        "read 4 data points, a point of each series, of the newest minute of 2 of its metrics - its busiest, and others in turn -",
      );
      expect(result.readLog[0]).toContain("of the 2400 written between");
    });
  });

  describe("when a read fails", () => {
    test("the rollup cannot answer: the metrics are listed from the points", async () => {
      jest
        .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
        .mockImplementation((async (statement: Statement): Promise<Results> => {
          statements.push(statement);

          if (statement.query.includes("MetricItemAggMV1m")) {
            throw new Error("Table oneuptime.MetricItemAggMV1m does not exist");
          }

          if (isMetricsList(statement)) {
            return answer(metricListRows);
          }

          const rows: SourceRows = isOwnersRead(statement)
            ? ownerRows
            : sampleRows;

          return answer(rows[sourceOf(statement)] || []);
        }) as never);

      const result: ContentScanResult = metricsStore(await scan()).result;
      const lists: Array<Statement> = statements.filter(isMetricsList);

      expect(lists).toHaveLength(2);
      expect(lists[1]!.query).toContain("FROM oneuptime.MetricItemV3");
      expect(typesAt(result, "attributes.user.email")).toEqual([
        "email-address",
      ]);
      expect(result.isComplete).toBe(true);
    });

    test("neither list answers: each service's metrics say so, and the scan goes on", async () => {
      jest
        .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
        .mockImplementation((async (statement: Statement): Promise<Results> => {
          statements.push(statement);

          if (isMetricsList(statement)) {
            throw new Error("Memory limit exceeded");
          }

          const rows: SourceRows = isOwnersRead(statement)
            ? ownerRows
            : sampleRows;

          return answer(rows[sourceOf(statement)] || []);
        }) as never);

      const scans: Array<TelemetryStoreScan> = await scan();
      const metrics: ContentScanResult = metricsStore(scans).result;

      expect(metrics.isComplete).toBe(false);
      expect(metrics.warnings).toContain(
        "Could not read this service's metrics in this scan; the next scan reads them again.",
      );
      expect(metrics.locations).toEqual([]);
      // The other stores were read as ever.
      expect(
        typesAt(
          storeOf(scans, DataStoreKind.TelemetryLogs, CHECKOUT).result,
          "attributes.user.email",
        ),
      ).toEqual(["email-address"]);
    });

    test("a failed sample is a warning on the services it was for", async () => {
      jest
        .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
        .mockImplementation((async (statement: Statement): Promise<Results> => {
          statements.push(statement);

          if (isMetricsList(statement)) {
            return answer(metricListRows);
          }

          if (
            sourceOf(statement) === TelemetrySampleSource.Metrics &&
            !isOwnersRead(statement)
          ) {
            throw new Error("Timeout exceeded");
          }

          const rows: SourceRows = isOwnersRead(statement)
            ? ownerRows
            : sampleRows;

          return answer(rows[sourceOf(statement)] || []);
        }) as never);

      const metrics: ContentScanResult = metricsStore(await scan()).result;

      expect(metrics.isComplete).toBe(false);
      expect(metrics.warnings).toContain(
        "Could not read some of this service's metrics in this scan; the next scan reads them again.",
      );
    });
  });

  describe("how much a scan reads", () => {
    test("at most a hundred metrics - a service's ten, and the reads no other service takes - a hundred series of each, never more than the sample size", async () => {
      metricListRows = Array.from(
        { length: 160 },
        (_: unknown, index: number) => {
          return {
            ownerId: CHECKOUT,
            metricName: `app.metric.${String(index).padStart(3, "0")}`,
            points: String(1000 - index),
            newestMinute: newestMinuteNow(),
            newestMinutePoints: "20",
          };
        },
      );

      const scans: Array<TelemetryStoreScan> = await scanProjectTelemetry({
        projectId: PROJECT_ID,
        sampleSize: 30,
        since: new Date(Date.now() - 60 * 60 * 1000),
        options: options(),
      });

      const [sample] = sampleStatements();
      const read: Array<string> = boundValues(sample!).filter(
        (value: unknown): boolean => {
          return typeof value === "string" && value.startsWith("app.metric.");
        },
      ) as Array<string>;

      expect(TELEMETRY_SCAN_METRIC_SHARE_PER_OWNER).toBe(10);
      expect(TELEMETRY_SCAN_MAX_METRICS_PER_READ).toBe(100);
      expect(TELEMETRY_SCAN_MAX_SERIES_PER_METRIC).toBe(100);
      // The project's only service: its ten, and the ninety no other service takes (#9947).
      expect(read).toHaveLength(TELEMETRY_SCAN_MAX_METRICS_PER_READ);
      expect(new Set(read).size).toBe(TELEMETRY_SCAN_MAX_METRICS_PER_READ);
      // The busiest five, every scan.
      expect(read).toEqual(
        expect.arrayContaining([
          "app.metric.000",
          "app.metric.001",
          "app.metric.002",
          "app.metric.003",
          "app.metric.004",
        ]),
      );
      // The read log says why it read more than its ten.
      expect(metricsStore(scans).result.readLog[0]).toContain(
        "and others in turn, 90 of them with reads other services left unused -",
      );
      // A sample size of 30: thirty series of each metric at most.
      expect(Number(parameterAfter(sample!, LIMIT_BY))).toBe(30);
    });
  });

  describe("which metrics a scan reads", () => {
    const many: Array<MetricToRead> = Array.from(
      { length: 25 },
      (_: unknown, index: number): MetricToRead => {
        return metric(`m.${String(index).padStart(2, "0")}`, {
          points: 1000 - index,
        });
      },
    );

    function namesOf(metrics: Array<MetricToRead>): Array<string> {
      return metrics.map((planned: MetricToRead): string => {
        return planned.metricName;
      });
    }

    const SERVICE_KEY: string = CHECKOUT.toLowerCase();
    const NOW_HOUR: number = getMetricTurn(
      new Date("2026-10-27T11:00:00.000Z"),
    );
    const NEW_SINCE: Date = new Date("2026-10-27T09:00:00.000Z");

    /*
     * One scan's plan, from where the last one stopped. Its total is its
     * service's share unless the test says otherwise: a project whose other
     * services take every other read, so what is planned is the share's
     * own, and its bound the one that holds with no read to spare (#9947
     * gives a service more only when others leave reads unused).
     */
    function scanOf(data: {
      metrics: ReadonlyArray<MetricToRead>;
      turn: number;
      cursor?: number | undefined;
      newSince?: Date | undefined;
      perOwner?: number | undefined;
      total?: number | undefined;
    }): MetricScanPlan {
      return planMetricsToRead({
        metrics: data.metrics,
        perOwner: data.perOwner ?? 10,
        total: data.total ?? data.perOwner ?? 10,
        turn: data.turn,
        newSince: data.newSince,
        cursors:
          data.cursor === undefined
            ? undefined
            : new Map([[SERVICE_KEY, data.cursor]]),
      });
    }

    /*
     * Hour after hour, each scan going on from where the last one stopped:
     * the most hours any metric that was there throughout waited between
     * two reads, and the metrics read in each.
     */
    function simulate(data: {
      hours: number;
      metricsAt: (hour: number) => Array<MetricToRead>;
      newSince?: ((hour: number) => Date) | undefined;
    }): { longestWait: Map<string, number>; reads: Array<Array<string>> } {
      const lastRead: Map<string, number> = new Map();
      const longestWait: Map<string, number> = new Map();
      const reads: Array<Array<string>> = [];
      let cursor: number | undefined = undefined;

      for (let hour: number = 0; hour < data.hours; hour++) {
        const plan: MetricScanPlan = scanOf({
          metrics: data.metricsAt(hour),
          turn: NOW_HOUR + hour,
          cursor,
          newSince: data.newSince?.(hour),
        });
        const names: Array<string> = namesOf(plan.metrics);

        cursor = plan.cursors.get(SERVICE_KEY);
        reads.push(names);

        for (const name of names) {
          const since: number = lastRead.has(name) ? lastRead.get(name)! : -1;

          if (since >= 0) {
            longestWait.set(
              name,
              Math.max(longestWait.get(name) || 0, hour - since),
            );
          }

          lastRead.set(name, hour);
        }
      }

      return { longestWait, reads };
    }

    function service(count: number, prefix: string = "m"): Array<MetricToRead> {
      return Array.from(
        { length: count },
        (_: unknown, index: number): MetricToRead => {
          return metric(`${prefix}.${String(index).padStart(4, "0")}`, {
            points: 1000 - index,
          });
        },
      );
    }

    test("a service with few metrics: every one, every scan", () => {
      expect(
        namesOf(
          planMetricsToRead({
            metrics: many.slice(0, 4),
            perOwner: 10,
            total: 100,
            turn: 7,
          }).metrics,
        ),
      ).toEqual(["m.00", "m.01", "m.02", "m.03"]);
    });

    test("its busiest half every scan, and the rest in turn from where the last scan stopped: every metric within a few hours", () => {
      const seen: Set<string> = new Set();
      let cursor: number | undefined = undefined;

      for (let turn: number = 0; turn < 4; turn++) {
        const plan: MetricScanPlan = scanOf({ metrics: many, turn, cursor });
        const planned: Array<string> = namesOf(plan.metrics);

        expect(planned).toHaveLength(10);
        // The busiest five, every scan.
        expect(planned).toEqual(
          expect.arrayContaining(["m.00", "m.01", "m.02", "m.03", "m.04"]),
        );
        expect(new Set(planned).size).toBe(10);
        // Where the rotation stopped: a number, never a name.
        expect(typeof plan.cursors.get(SERVICE_KEY)).toBe("number");

        cursor = plan.cursors.get(SERVICE_KEY);

        for (const name of planned) {
          seen.add(name);
        }
      }

      // 20 others, 5 a turn: all of them in 4 hours.
      expect(seen.size).toBe(25);
    });

    /*
     * #9755's bound: a service of M metrics, `inTurn` of them read in turn
     * each scan, has each read at least once every ceil(M / inTurn) hours.
     */
    test("a service of 300 metrics: each read at least once every 60 hours, its busiest every hour", () => {
      const metrics: Array<MetricToRead> = service(300);
      const { longestWait, reads } = simulate({
        hours: 240,
        metricsAt: (): Array<MetricToRead> => {
          return metrics;
        },
      });

      expect(longestWait.size).toBe(300);
      expect(Math.max(...longestWait.values())).toBeLessThanOrEqual(
        Math.ceil(300 / 5),
      );
      // Its busiest five, every hour.
      expect(longestWait.get("m.0000")).toBe(1);
      // Ten a scan, never one twice.
      for (const read of reads) {
        expect(new Set(read).size).toBe(10);
      }
    });

    test("regression: the rest's order no longer moves with their points, so none misses its turn for good", () => {
      const random: SeededRandom = seededRandom(9755);
      const names: Array<string> = namesOf(service(120));
      const { longestWait } = simulate({
        hours: 200,
        // Every hour each metric wrote a different number of points.
        metricsAt: (): Array<MetricToRead> => {
          return names.map((name: string): MetricToRead => {
            return metric(name, { points: Math.floor(random() * 10_000) });
          });
        },
      });

      expect(longestWait.size).toBe(120);
      expect(Math.max(...longestWait.values())).toBeLessThanOrEqual(
        Math.ceil(120 / 5),
      );
    });

    test("metrics that come and go do not move the others' turns: one that is always there is read within its bound", () => {
      const random: SeededRandom = seededRandom(97551);
      const steady: Array<MetricToRead> = service(100, "steady");
      const sporadic: Array<MetricToRead> = service(60, "sporadic");
      const { longestWait } = simulate({
        hours: 200,
        // Each sporadic metric writes in a third of the hours.
        metricsAt: (): Array<MetricToRead> => {
          return [
            ...steady,
            ...sporadic.filter((): boolean => {
              return random() < 1 / 3;
            }),
          ];
        },
      });

      for (const read of steady) {
        expect(longestWait.get(read.metricName)).toBeLessThanOrEqual(
          Math.ceil(160 / 5),
        );
      }
    });

    test("a metric the service started writing lately is read the hour it first writes, ahead of the rest's turns", () => {
      const metrics: Array<MetricToRead> = service(300);
      const deployed: MetricToRead = metric("checkout.coupon.redeemed", {
        points: 3,
        firstMinute: new Date("2026-10-27T10:41:00.000Z"),
      });
      // Where the rotation would be nowhere near it.
      const plan: MetricScanPlan = scanOf({
        metrics: [...metrics, deployed],
        turn: NOW_HOUR,
        cursor: getMetricRotationPosition("checkout.coupon.redeemed") + 1,
        newSince: NEW_SINCE,
      });

      expect(namesOf(plan.metrics)).toContain("checkout.coupon.redeemed");
      expect(plan.newMetricsRead.get(SERVICE_KEY)).toBe(1);
      expect(plan.metrics).toHaveLength(10);
      // Its first minute before the new window: one of the rest, read in turn.
      expect(
        namesOf(
          scanOf({
            metrics: [
              ...metrics,
              {
                ...deployed,
                firstMinute: new Date("2026-10-27T08:59:00.000Z"),
              },
            ],
            turn: NOW_HOUR,
            cursor: getMetricRotationPosition("checkout.coupon.redeemed") + 1,
            newSince: NEW_SINCE,
          }).metrics,
        ),
      ).not.toContain("checkout.coupon.redeemed");
    });

    test("new metrics take at most half the in-turn reads: the rotation keeps the rest, and its bound, however many keep coming", () => {
      const steady: Array<MetricToRead> = service(100, "steady");
      const { longestWait, reads } = simulate({
        hours: 120,
        // Ten new metrics every hour: a name built from what varies.
        metricsAt: (hour: number): Array<MetricToRead> => {
          return [
            ...steady,
            ...Array.from(
              { length: 10 },
              (_: unknown, index: number): MetricToRead => {
                return metric(`signup.${hour}.${index}.count`, {
                  points: 1,
                  firstMinute: new Date(
                    Date.UTC(2026, 9, 27, 0, 0, 0) + hour * 3_600_000,
                  ),
                });
              },
            ),
          ];
        },
        newSince: (hour: number): Date => {
          return new Date(
            Date.UTC(2026, 9, 27, 0, 0, 0) + (hour - 1) * 3_600_000,
          );
        },
      });

      // Every scan reads ten, the busiest five among them.
      for (const read of reads) {
        expect(read).toHaveLength(10);
      }

      for (let hour: number = 0; hour < 6; hour++) {
        // Two or three a scan by their own share, of the five in turn.
        const plan: MetricScanPlan = scanOf({
          metrics: [
            ...steady,
            ...Array.from(
              { length: 10 },
              (_: unknown, index: number): MetricToRead => {
                return metric(`signup.${index}.count`, {
                  points: 1,
                  firstMinute: new Date("2026-10-27T10:30:00.000Z"),
                });
              },
            ),
          ],
          turn: NOW_HOUR + hour,
          newSince: NEW_SINCE,
        });

        expect(plan.newMetricsRead.get(SERVICE_KEY)).toBe(hour % 2 ? 2 : 3);
      }

      /*
       * The steady ones: the rotation keeps at least five reads in two
       * scans, so each is read within twice the quiet bound of the ring -
       * its 100 metrics and the 20 new ones a two-hour window holds.
       */
      for (const read of steady) {
        expect(longestWait.get(read.metricName)).toBeLessThanOrEqual(
          2 * Math.ceil(120 / 5),
        );
      }
    });

    test("more new metrics than their share: the next of them the next hour", () => {
      const metrics: Array<MetricToRead> = service(50);
      const deploy: Array<MetricToRead> = Array.from(
        { length: 6 },
        (_: unknown, index: number): MetricToRead => {
          return metric(`checkout.new.${index}`, {
            points: 1,
            firstMinute: new Date("2026-10-27T10:30:00.000Z"),
          });
        },
      );
      const first: MetricScanPlan = scanOf({
        metrics: [...metrics, ...deploy],
        turn: NOW_HOUR,
        newSince: NEW_SINCE,
      });
      const second: MetricScanPlan = scanOf({
        metrics: [...metrics, ...deploy],
        turn: NOW_HOUR + 1,
        cursor: first.cursors.get(SERVICE_KEY),
        newSince: NEW_SINCE,
      });
      const newOf: (plan: MetricScanPlan) => Array<string> = (
        plan: MetricScanPlan,
      ): Array<string> => {
        return namesOf(plan.metrics).filter((name: string): boolean => {
          return name.startsWith("checkout.new.");
        });
      };

      // Their own share: five in two hours, the next ones the second hour.
      expect(
        (first.newMetricsRead.get(SERVICE_KEY) || 0) +
          (second.newMetricsRead.get(SERVICE_KEY) || 0),
      ).toBe(5);
      // So at least five of the six are read within those two hours.
      expect(
        new Set([...newOf(first), ...newOf(second)]).size,
      ).toBeGreaterThanOrEqual(5);
    });

    test("a new metric among the busiest is read as one of them, its new place left to another", () => {
      const metrics: Array<MetricToRead> = service(40);
      const busyAndNew: MetricToRead = metric("checkout.flood", {
        points: 1_000_000,
        firstMinute: new Date("2026-10-27T10:30:00.000Z"),
      });
      const quietAndNew: MetricToRead = metric("checkout.trickle", {
        points: 1,
        firstMinute: new Date("2026-10-27T10:30:00.000Z"),
      });
      const plan: MetricScanPlan = scanOf({
        metrics: [...metrics, busyAndNew, quietAndNew],
        turn: NOW_HOUR,
        newSince: NEW_SINCE,
      });

      expect(namesOf(plan.metrics)).toEqual(
        expect.arrayContaining(["checkout.flood", "checkout.trickle"]),
      );
      expect(plan.newMetricsRead.get(SERVICE_KEY)).toBe(1);
      expect(plan.metrics).toHaveLength(10);
    });

    test("half the in-turn reads for new metrics, the odd one every other hour", () => {
      for (let inTurn: number = 0; inTurn <= 10; inTurn++) {
        for (let turn: number = NOW_HOUR; turn < NOW_HOUR + 6; turn++) {
          const two: number =
            getNewMetricSlots(inTurn, turn) +
            getNewMetricSlots(inTurn, turn + 1);

          // Over any two hours, exactly the in-turn reads of one.
          expect(two).toBe(inTurn);
          expect(getNewMetricSlots(inTurn, turn)).toBeLessThanOrEqual(
            Math.ceil(inTurn / 2),
          );
        }
      }

      expect(getNewMetricSlots(5, 0)).toBe(2);
      expect(getNewMetricSlots(5, 1)).toBe(3);
      expect(getNewMetricSlots(1, 0)).toBe(0);
      expect(getNewMetricSlots(1, 1)).toBe(1);
    });

    test("a metric's place on the ring is a number from its name alone: the same on every server, a different one for each name", () => {
      const position: number = getMetricRotationPosition(
        "http.server.duration",
      );

      expect(position).toBe(getMetricRotationPosition("http.server.duration"));
      expect(Number.isSafeInteger(position)).toBe(true);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThan(2 ** 48);

      const positions: Set<number> = new Set(
        namesOf(service(5_000)).map(getMetricRotationPosition),
      );

      expect(positions.size).toBe(5_000);
    });

    test("where a store's rotation stopped is read back defensively", () => {
      expect(
        readMetricRotationCursor({
          [METRIC_ROTATION_CURSOR_STATE_KEY]: 123456789,
          plaintextPasswordFields: [],
        }),
      ).toBe(123456789);

      for (const state of [
        undefined,
        null,
        "x",
        [],
        {},
        { [METRIC_ROTATION_CURSOR_STATE_KEY]: -1 },
        { [METRIC_ROTATION_CURSOR_STATE_KEY]: 1.5 },
        { [METRIC_ROTATION_CURSOR_STATE_KEY]: 2 ** 48 },
        { [METRIC_ROTATION_CURSOR_STATE_KEY]: "123" },
      ] as Array<unknown>) {
        expect(readMetricRotationCursor(state)).toBeUndefined();
      }
    });

    test("the services share the read: fewer of each when there are many, at least one of each", () => {
      const ownersOfMetrics: Array<MetricToRead> = [];

      for (let owner: number = 0; owner < 40; owner++) {
        for (let index: number = 0; index < 5; index++) {
          ownersOfMetrics.push(
            metric(`m.${index}`, {
              ownerId: `0192f1a0-0000-7000-8000-0000000e${String(owner).padStart(4, "0")}`,
              points: 100 - index,
            }),
          );
        }
      }

      const planned: Array<MetricToRead> = planMetricsToRead({
        metrics: ownersOfMetrics,
        perOwner: 10,
        total: 100,
        turn: 0,
      }).metrics;
      const readOf: Map<string, number> = new Map();

      for (const read of planned) {
        readOf.set(read.ownerId, (readOf.get(read.ownerId) || 0) + 1);
      }

      /*
       * A hundred metrics for forty services: two of each, and the twenty
       * that leaves one more each to twenty of them (#9947) - it read 80
       * before, leaving 20 unused.
       */
      expect(planned).toHaveLength(100);
      expect(readOf.size).toBe(40);
      expect(
        Array.from(readOf.values()).sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual([...Array(20).fill(2), ...Array(20).fill(3)]);

      const manyOwners: Array<MetricToRead> = ownersOfMetrics.map(
        (planned: MetricToRead, index: number): MetricToRead => {
          return { ...planned, ownerId: `owner-${index}` };
        },
      );

      // Two hundred services of one metric each: one of each, whatever the total.
      expect(
        planMetricsToRead({
          metrics: manyOwners,
          perOwner: 10,
          total: 100,
          turn: 0,
        }).metrics,
      ).toHaveLength(200);
    });

    test("ties go by name, so every server takes the same turns", () => {
      const tied: Array<MetricToRead> = [
        metric("b", { points: 5 }),
        metric("c", { points: 5 }),
        metric("a", { points: 5 }),
      ];

      expect(
        namesOf(
          planMetricsToRead({
            metrics: tied,
            perOwner: 10,
            total: 100,
            turn: 3,
          }).metrics,
        ),
      ).toEqual(["a", "b", "c"]);
      expect(
        planMetricsToRead({ metrics: [], perOwner: 10, total: 100, turn: 0 })
          .metrics,
      ).toEqual([]);
    });

    test("the turn is the hour the scan reads", () => {
      expect(getMetricTurn(new Date("2026-10-27T10:59:59.999Z"))).toBe(
        getMetricTurn(new Date("2026-10-27T10:00:00.000Z")),
      );
      expect(getMetricTurn(new Date("2026-10-27T11:00:00.000Z"))).toBe(
        getMetricTurn(new Date("2026-10-27T10:00:00.000Z")) + 1,
      );
    });

    test("the rollup's rows, read defensively: the services asked for, each metric once", () => {
      const seconds: number = Math.floor(
        new Date("2026-10-27T10:59:00.000Z").getTime() / 1000,
      );

      expect(
        readMetricsToRead(
          [
            {
              ownerId: CHECKOUT.toUpperCase(),
              metricName: "http.requests",
              points: "120",
              newestMinute: String(seconds),
              newestMinutePoints: "12",
            },
            // The same metric again, another service, no name, no time.
            {
              ownerId: CHECKOUT,
              metricName: "http.requests",
              points: "1",
              newestMinute: String(seconds),
            },
            {
              ownerId: AI_TOOL,
              metricName: "x",
              newestMinute: String(seconds),
            },
            {
              ownerId: CHECKOUT,
              metricName: "",
              newestMinute: String(seconds),
            },
            { ownerId: CHECKOUT, metricName: "y", newestMinute: "0" },
            {
              ownerId: CHECKOUT,
              metricName: "z".repeat(2000),
              newestMinute: String(seconds),
            },
          ],
          new Set([CHECKOUT]),
        ),
      ).toEqual([
        {
          ownerId: CHECKOUT.toUpperCase(),
          metricName: "http.requests",
          points: 120,
          newestMinute: new Date("2026-10-27T10:59:00.000Z"),
          newestMinutePoints: 12,
        },
      ]);
    });

    /*
     * #9947: the reads a scan leaves unused - a service of few metrics
     * leaves most of its share, and a total that does not divide by the
     * services leaves the rest - go to the services that still have
     * metrics waiting their turn, one at a time, round after round. A
     * service never reads fewer than its share, a scan never more than its
     * total, and the extra reads are in-turn reads: they move a service's
     * rotation on, and its cursor with it.
     */
    describe("the reads a scan leaves unused (#9947)", () => {
      const OWNERS: Array<string> = [
        "0192f1a0-0000-7000-8000-00000000a001",
        "0192f1a0-0000-7000-8000-00000000a002",
        "0192f1a0-0000-7000-8000-00000000a003",
      ];
      const SHARE: number = TELEMETRY_SCAN_METRIC_SHARE_PER_OWNER;
      const TOTAL: number = TELEMETRY_SCAN_MAX_METRICS_PER_READ;
      const BUSIEST: number = Math.floor(SHARE / 2);

      // A service's metrics, the first the busiest, none of them new.
      function serviceOf(owner: string, count: number): Array<MetricToRead> {
        return Array.from(
          { length: count },
          (_: unknown, index: number): MetricToRead => {
            return metric(
              `${owner.slice(-4)}.m.${String(index).padStart(4, "0")}`,
              { ownerId: owner, points: 100_000 - index },
            );
          },
        );
      }

      function readsOf(plan: MetricScanPlan): Map<string, number> {
        const reads: Map<string, number> = new Map();

        for (const read of plan.metrics) {
          const owner: string = read.ownerId.toLowerCase();

          reads.set(owner, (reads.get(owner) || 0) + 1);
        }

        return reads;
      }

      // A service's metrics, those its busiest are not, in their ring's order.
      function ringOf(metrics: Array<MetricToRead>): Array<MetricToRead> {
        return metrics
          .slice(BUSIEST)
          .sort((a: MetricToRead, b: MetricToRead): number => {
            return (
              getMetricRotationPosition(a.metricName) -
              getMetricRotationPosition(b.metricName)
            );
          });
      }

      /*
       * Hour after hour, a project's scans, each service going on from
       * where it stopped: by metric, the hour it was first read and the
       * most hours it waited between two reads; and each scan's plan.
       */
      function simulateProject(data: {
        hours: number;
        metricsAt: (hour: number) => Array<MetricToRead>;
        newSince?: ((hour: number) => Date) | undefined;
        total?: number | undefined;
      }): {
        firstRead: Map<string, number>;
        longestWait: Map<string, number>;
        plans: Array<MetricScanPlan>;
      } {
        const firstRead: Map<string, number> = new Map();
        const lastRead: Map<string, number> = new Map();
        const longestWait: Map<string, number> = new Map();
        const plans: Array<MetricScanPlan> = [];
        let cursors: Map<string, number> = new Map();

        for (let hour: number = 0; hour < data.hours; hour++) {
          const plan: MetricScanPlan = planMetricsToRead({
            metrics: data.metricsAt(hour),
            perOwner: SHARE,
            total: data.total ?? TOTAL,
            turn: NOW_HOUR + hour,
            newSince: data.newSince?.(hour),
            cursors,
          });

          cursors = plan.cursors;
          plans.push(plan);

          for (const read of plan.metrics) {
            const since: number | undefined = lastRead.get(read.metricName);

            if (since === undefined) {
              firstRead.set(read.metricName, hour);
            } else {
              longestWait.set(
                read.metricName,
                Math.max(longestWait.get(read.metricName) || 0, hour - since),
              );
            }

            lastRead.set(read.metricName, hour);
          }
        }

        return { firstRead, longestWait, plans };
      }

      test("how many each service reads: its share, then what is left, one read at a time round the services still waiting", () => {
        const counts: Map<string, number> = new Map([
          ["c", 300],
          ["a", 300],
          ["b", 300],
        ]);

        // 30 of the shares, and 70 left: 23 more each, and the odd one in turn.
        expect(
          getMetricReadsByOwner({
            metricsByOwner: counts,
            share: 10,
            total: 100,
            turn: 0,
          }),
        ).toEqual(
          new Map([
            ["a", 34],
            ["b", 33],
            ["c", 33],
          ]),
        );
        expect(
          getMetricReadsByOwner({
            metricsByOwner: counts,
            share: 10,
            total: 100,
            turn: 1,
          }),
        ).toEqual(
          new Map([
            ["a", 33],
            ["b", 34],
            ["c", 33],
          ]),
        );
        expect(
          getMetricReadsByOwner({
            metricsByOwner: counts,
            share: 10,
            total: 100,
            turn: 5,
          }).get("c"),
        ).toBe(34);

        /*
         * A service that runs out of metrics takes no more: the others share
         * what it could not take.
         */
        expect(
          getMetricReadsByOwner({
            metricsByOwner: new Map([
              ["a", 3],
              ["b", 12],
              ["c", 400],
            ]),
            share: 10,
            total: 100,
            turn: 7,
          }),
        ).toEqual(
          new Map([
            ["a", 3],
            ["b", 12],
            ["c", 85],
          ]),
        );
        // Every service's metrics all read: what is left stays unused.
        expect(
          getMetricReadsByOwner({
            metricsByOwner: new Map([
              ["a", 3],
              ["b", 12],
            ]),
            share: 10,
            total: 100,
            turn: 0,
          }),
        ).toEqual(
          new Map([
            ["a", 3],
            ["b", 12],
          ]),
        );
        // More services than reads: one of each, as before, and none to spare.
        expect(
          Array.from(
            getMetricReadsByOwner({
              metricsByOwner: new Map(
                Array.from({ length: 150 }, (_: unknown, index: number) => {
                  return [`s${index}`, 20] as [string, number];
                }),
              ),
              share: 1,
              total: 100,
              turn: 3,
            }).values(),
          ),
        ).toEqual(Array(150).fill(1));
        expect(
          getMetricReadsByOwner({
            metricsByOwner: new Map(),
            share: 10,
            total: 100,
            turn: 0,
          }).size,
        ).toBe(0);
        // A total or share that is no number reads one.
        expect(
          getMetricReadsByOwner({
            metricsByOwner: new Map([["a", 5]]),
            share: Number.NaN,
            total: Number.NaN,
            turn: Number.NaN,
          }),
        ).toEqual(new Map([["a", 1]]));
      });

      test("the issue's project: three services of 300 metrics read 100 metrics a scan, not 30 - 34, 33 and 33, the odd read going to each in turn", () => {
        const metrics: Array<MetricToRead> = OWNERS.flatMap(
          (owner: string): Array<MetricToRead> => {
            return serviceOf(owner, 300);
          },
        );
        const timesWithTheOddRead: Map<string, number> = new Map();

        for (let hour: number = 0; hour < 6; hour++) {
          const plan: MetricScanPlan = planMetricsToRead({
            metrics,
            perOwner: SHARE,
            total: TOTAL,
            turn: NOW_HOUR + hour,
          });
          const reads: Map<string, number> = readsOf(plan);

          expect(plan.metrics).toHaveLength(TOTAL);
          expect(new Set(namesOf(plan.metrics)).size).toBe(TOTAL);
          expect(
            Array.from(reads.values()).sort((a: number, b: number) => {
              return a - b;
            }),
          ).toEqual([33, 33, 34]);

          for (const owner of OWNERS) {
            // Its own ten, and 23 or 24 of the 70 the shares left.
            expect(plan.extraReads.get(owner)).toBe(reads.get(owner)! - SHARE);

            if (reads.get(owner) === 34) {
              timesWithTheOddRead.set(
                owner,
                (timesWithTheOddRead.get(owner) || 0) + 1,
              );
            }
          }
        }

        // Six hours: each service got the odd read twice.
        expect(Array.from(timesWithTheOddRead.values())).toEqual([2, 2, 2]);
      });

      test("over many scans, every metric of those three services within 11 hours, where their shares alone took 60 - their busiest every hour", () => {
        const metrics: Array<MetricToRead> = OWNERS.flatMap(
          (owner: string): Array<MetricToRead> => {
            return serviceOf(owner, 300);
          },
        );
        // In turn: 5 of its share, and at least 23 of the 70 left.
        const inTurn: number = SHARE - BUSIEST + Math.floor((TOTAL - 30) / 3);
        const bound: number = Math.ceil(300 / inTurn);

        expect(inTurn).toBe(28);
        expect(bound).toBe(11);

        const shared: {
          firstRead: Map<string, number>;
          longestWait: Map<string, number>;
        } = simulateProject({
          hours: 40,
          metricsAt: (): Array<MetricToRead> => {
            return metrics;
          },
        });

        expect(shared.firstRead.size).toBe(900);
        expect(Math.max(...shared.firstRead.values())).toBeLessThan(bound);
        expect(shared.longestWait.size).toBe(900);
        expect(Math.max(...shared.longestWait.values())).toBeLessThanOrEqual(
          bound,
        );

        for (const owner of OWNERS) {
          expect(shared.longestWait.get(`${owner.slice(-4)}.m.0000`)).toBe(1);
        }

        // Their shares alone - what a project of ten such services leaves them: 60 hours.
        const alone: { longestWait: Map<string, number> } = simulateProject({
          hours: 130,
          total: 3 * SHARE,
          metricsAt: (): Array<MetricToRead> => {
            return metrics;
          },
        });
        const longest: number = Math.max(...alone.longestWait.values());

        expect(longest).toBeLessThanOrEqual(Math.ceil(300 / (SHARE - BUSIEST)));
        expect(longest).toBeGreaterThan(5 * bound);
      });

      test("a service of few metrics reads them all every scan, and the reads it leaves go to the service with more, further round its ring", () => {
        const big: Array<MetricToRead> = serviceOf(OWNERS[2]!, 500);
        const plan: MetricScanPlan = planMetricsToRead({
          metrics: [
            ...serviceOf(OWNERS[0]!, 3),
            ...serviceOf(OWNERS[1]!, 4),
            ...big,
          ],
          perOwner: SHARE,
          total: TOTAL,
          turn: NOW_HOUR,
        });
        const reads: Map<string, number> = readsOf(plan);

        expect(reads.get(OWNERS[0]!)).toBe(3);
        expect(reads.get(OWNERS[1]!)).toBe(4);
        expect(reads.get(OWNERS[2]!)).toBe(93);
        expect(plan.extraReads.get(OWNERS[2]!)).toBe(83);
        expect(plan.extraReads.has(OWNERS[0]!)).toBe(false);
        expect(plan.extraReads.has(OWNERS[1]!)).toBe(false);
        // A service whose metrics are all read keeps its rotation where it was.
        expect(plan.cursors.has(OWNERS[0]!)).toBe(false);

        // Its busiest five, then the first 88 of its ring: its cursor is the 88th.
        const ring: Array<MetricToRead> = ringOf(big);
        const read: Set<string> = new Set(namesOf(plan.metrics));

        expect(
          namesOf(big.slice(0, BUSIEST)).every((name: string): boolean => {
            return read.has(name);
          }),
        ).toBe(true);
        expect(
          namesOf(ring.slice(0, 88)).every((name: string): boolean => {
            return read.has(name);
          }),
        ).toBe(true);
        expect(read.has(ring[88]!.metricName)).toBe(false);
        expect(plan.cursors.get(OWNERS[2]!)).toBe(
          getMetricRotationPosition(ring[87]!.metricName),
        );
      });

      test("over several scans, a service's cursor goes as far as the reads it got: its ring in stretches one after another, none passed over", () => {
        const big: Array<MetricToRead> = serviceOf(OWNERS[0]!, 400);
        const ring: Array<MetricToRead> = ringOf(big);
        const others: Array<MetricToRead> = [
          ...serviceOf(OWNERS[1]!, 6),
          ...serviceOf(OWNERS[2]!, 6),
        ];
        const busiest: Set<string> = new Set(namesOf(big.slice(0, BUSIEST)));
        let cursors: Map<string, number> = new Map();

        for (let hour: number = 0; hour < 8; hour++) {
          const plan: MetricScanPlan = planMetricsToRead({
            metrics: [...big, ...others],
            perOwner: SHARE,
            total: TOTAL,
            turn: NOW_HOUR + hour,
            cursors,
          });
          const inTurn: Array<string> = namesOf(plan.metrics).filter(
            (name: string): boolean => {
              return name.startsWith("a001.") && !busiest.has(name);
            },
          );
          // 100 less the others' 12: 88, of which 83 in turn.
          const expected: Array<string> = Array.from(
            { length: 83 },
            (_: unknown, index: number): string => {
              return ring[(hour * 83 + index) % ring.length]!.metricName;
            },
          );

          expect(inTurn.sort()).toEqual(expected.sort());
          expect(plan.cursors.get(OWNERS[0]!)).toBe(
            getMetricRotationPosition(
              ring[(hour * 83 + 82) % ring.length]!.metricName,
            ),
          );

          cursors = plan.cursors;
        }
      });

      test("no service starves, a scan never reads more than its total, and no read is left unused while a metric waits: random projects", () => {
        const random: SeededRandom = seededRandom(9947);

        for (let round: number = 0; round < 250; round++) {
          const owners: number = 1 + random(160);
          const counts: Map<string, number> = new Map();

          for (let owner: number = 0; owner < owners; owner++) {
            counts.set(
              `s${String(owner).padStart(3, "0")}`,
              1 + (random() < 0.6 ? random(12) : random(600)),
            );
          }

          const share: number = Math.max(
            1,
            Math.min(SHARE, Math.floor(TOTAL / owners)),
          );
          const reads: Map<string, number> = getMetricReadsByOwner({
            metricsByOwner: counts,
            share,
            total: TOTAL,
            turn: random(100_000),
          });
          let sum: number = 0;
          let isAnyWaiting: boolean = false;
          const waitingExtras: Array<number> = [];
          const extras: Array<number> = [];

          for (const [owner, count] of counts) {
            const read: number = reads.get(owner) || 0;
            const extra: number = read - Math.min(count, share);

            // Never fewer than its share, never more than it has.
            expect(read).toBeGreaterThanOrEqual(Math.min(count, share));
            expect(read).toBeLessThanOrEqual(count);
            sum += read;
            extras.push(extra);

            if (read < count) {
              isAnyWaiting = true;
              waitingExtras.push(extra);
            }
          }

          // Never more than the scan's total - or one of each service, when there are more.
          expect(sum).toBeLessThanOrEqual(Math.max(TOTAL, owners));

          if (isAnyWaiting) {
            // Nothing left unused while a metric waits its turn.
            expect(sum).toBe(Math.max(TOTAL, owners));

            // Round after round: the services still waiting got as many as each other, give or take the odd one...
            const most: number = Math.max(...waitingExtras);

            expect(most - Math.min(...waitingExtras)).toBeLessThanOrEqual(1);
            // ...and a service that ran out, no more than they did.
            expect(Math.max(...extras)).toBeLessThanOrEqual(most);
          }
        }
      });

      test("the plan reads what the allotment says, of each service, with no metric twice", () => {
        const random: SeededRandom = seededRandom(99471);

        for (let round: number = 0; round < 30; round++) {
          const owners: number = 1 + random(40);
          const metrics: Array<MetricToRead> = [];
          const counts: Map<string, number> = new Map();

          for (let index: number = 0; index < owners; index++) {
            const owner: string = `0192f1a0-0000-7000-8000-00000000${String(index).padStart(4, "0")}`;
            const count: number =
              1 + (random() < 0.5 ? random(8) : random(200));

            counts.set(owner, count);
            metrics.push(...serviceOf(owner, count));
          }

          const turn: number = NOW_HOUR + random(1000);
          const plan: MetricScanPlan = planMetricsToRead({
            metrics,
            perOwner: SHARE,
            total: TOTAL,
            turn,
          });

          expect(readsOf(plan)).toEqual(
            getMetricReadsByOwner({
              metricsByOwner: counts,
              share: Math.max(1, Math.min(SHARE, Math.floor(TOTAL / owners))),
              total: TOTAL,
              turn,
            }),
          );
          expect(new Set(namesOf(plan.metrics)).size).toBe(plan.metrics.length);
        }
      });

      test("new metrics take at most half of a service's in-turn reads, its extra ones among them: more of them than its share alone, and none of those passed over", () => {
        const steady: Array<MetricToRead> = serviceOf(OWNERS[0]!, 300);
        const deployed: Array<MetricToRead> = Array.from(
          { length: 60 },
          (_: unknown, index: number): MetricToRead => {
            return metric(`a001.deployed.${String(index).padStart(2, "0")}`, {
              ownerId: OWNERS[0]!,
              points: 1,
              firstMinute: new Date("2026-10-27T10:30:00.000Z"),
            });
          },
        );
        const metrics: Array<MetricToRead> = [
          ...steady,
          ...deployed,
          ...serviceOf(OWNERS[1]!, 3),
          ...serviceOf(OWNERS[2]!, 3),
        ];
        const newOf: (plan: MetricScanPlan) => Set<string> = (
          plan: MetricScanPlan,
        ): Set<string> => {
          return new Set(
            namesOf(plan.metrics).filter((name: string): boolean => {
              return name.startsWith("a001.deployed.");
            }),
          );
        };

        for (let hour: number = 0; hour < 4; hour++) {
          const turn: number = NOW_HOUR + hour;
          const withExtra: MetricScanPlan = planMetricsToRead({
            metrics,
            perOwner: SHARE,
            total: TOTAL,
            turn,
            newSince: NEW_SINCE,
          });
          // The same service with no read to spare: its share alone.
          const shareAlone: MetricScanPlan = planMetricsToRead({
            metrics: [...steady, ...deployed],
            perOwner: SHARE,
            total: SHARE,
            turn,
            newSince: NEW_SINCE,
          });

          // 100 less the others' 6: 94 reads, its busiest 5, 89 in turn.
          expect(readsOf(withExtra).get(OWNERS[0]!)).toBe(94);
          expect(withExtra.newMetricsRead.get(OWNERS[0]!)).toBe(
            getNewMetricSlots(89, turn),
          );
          expect(shareAlone.newMetricsRead.get(OWNERS[0]!)).toBe(
            getNewMetricSlots(SHARE - BUSIEST, turn),
          );
          // Half of them at most: the rotation keeps the rest.
          expect(getNewMetricSlots(89, turn)).toBeLessThanOrEqual(45);
          // Every new metric its share alone reads this hour, and more.
          for (const name of newOf(shareAlone)) {
            expect(newOf(withExtra).has(name)).toBe(true);
          }

          expect(newOf(withExtra).size).toBeGreaterThanOrEqual(
            getNewMetricSlots(89, turn),
          );
          expect(newOf(withExtra).size).toBeGreaterThan(newOf(shareAlone).size);
        }

        // Extra reads never take a new metric's place: more reads in turn, never fewer slots.
        for (let reads: number = 0; reads < 120; reads++) {
          for (let turn: number = NOW_HOUR; turn < NOW_HOUR + 4; turn++) {
            expect(getNewMetricSlots(reads + 1, turn)).toBeGreaterThanOrEqual(
              getNewMetricSlots(reads, turn),
            );
          }
        }
      });
    });
  });

  /*
   * #9755: a service's metrics are read in turn from where the last scan
   * stopped, which its metrics store keeps - and the ones it started
   * writing lately come first.
   */
  describe("where each service's rotation stopped", () => {
    const seconds: (iso: string) => string = (iso: string): string => {
      return String(Math.floor(new Date(iso).getTime() / 1000));
    };

    function listOf(count: number): Array<JSONObject> {
      return Array.from({ length: count }, (_: unknown, index: number) => {
        return {
          ownerId: CHECKOUT,
          metricName: `app.metric.${String(index).padStart(2, "0")}`,
          points: String(1000 - index),
          newestMinute: newestMinuteNow(),
          newestMinutePoints: "20",
          // Written all day: none of them new.
          firstMinute: String(Math.floor(Date.now() / 1000) - 23 * 3600),
        };
      });
    }

    function readNames(): Array<string> {
      const [sample] = statements.filter((statement: Statement): boolean => {
        return (
          sourceOf(statement) === TelemetrySampleSource.Metrics &&
          !isOwnersRead(statement) &&
          !isMetricsList(statement)
        );
      });

      return (
        boundValues(sample!).filter((value: unknown): boolean => {
          return typeof value === "string" && value.startsWith("app.metric.");
        }) as Array<string>
      ).sort();
    }

    async function scanFrom(
      cursor: number | undefined,
    ): Promise<TelemetryStoreScan> {
      statements = [];

      return storeOf(
        await scanProjectTelemetry({
          projectId: PROJECT_ID,
          sampleSize: 100,
          since: new Date(Date.now() - 60 * 60 * 1000),
          options: options(),
          metricCursors:
            cursor === undefined
              ? undefined
              : new Map([[CHECKOUT.toUpperCase(), cursor]]),
        }),
        DataStoreKind.TelemetryMetrics,
        CHECKOUT,
      );
    }

    /*
     * More metrics than the scan reads in all, so even the project's only
     * service - which gets every read no other takes (#9947) - reads some
     * in turn.
     */
    test("a scan says where it stopped, and the next goes on from there: every metric in turn", async () => {
      metricListRows = listOf(250);

      const seen: Set<string> = new Set();
      let cursor: number | undefined = undefined;

      for (let scan: number = 0; scan < 4; scan++) {
        const metrics: TelemetryStoreScan = await scanFrom(cursor);
        const state: JSONObject | undefined = metrics.result.nextState;

        cursor = readMetricRotationCursor(state);

        // A number in the store's state, never a metric's name.
        expect(typeof cursor).toBe("number");
        expect(Object.keys(state || {})).toEqual([
          METRIC_ROTATION_CURSOR_STATE_KEY,
        ]);

        for (const name of readNames()) {
          seen.add(name);
        }
      }

      // 245 others, 95 a turn: all of them in 3 scans.
      expect(seen.size).toBe(250);
    });

    test("a read of its metrics that fails leaves its rotation where it was, so their turn comes again", async () => {
      metricListRows = listOf(250);

      const first: TelemetryStoreScan = await scanFrom(undefined);
      const cursor: number = readMetricRotationCursor(first.result.nextState)!;
      const turnRead: Array<string> = readNames();

      jest
        .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
        .mockImplementation((async (statement: Statement): Promise<Results> => {
          statements.push(statement);

          if (isMetricsList(statement)) {
            return answer(metricListRows);
          }

          if (
            sourceOf(statement) === TelemetrySampleSource.Metrics &&
            !isOwnersRead(statement)
          ) {
            throw new Error("Code: 241. Memory limit exceeded.");
          }

          return answer(
            (isOwnersRead(statement) ? ownerRows : sampleRows)[
              sourceOf(statement)
            ] || [],
          );
        }) as never);

      const failed: TelemetryStoreScan = await scanFrom(cursor);

      expect(failed.result.isComplete).toBe(false);
      expect(readMetricRotationCursor(failed.result.nextState)).toBe(cursor);
      expect(turnRead.length).toBeGreaterThan(0);
    });

    test("when no list of its metrics can be read, the rotation is kept as it was", async () => {
      jest
        .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
        .mockImplementation((async (statement: Statement): Promise<Results> => {
          statements.push(statement);

          if (isMetricsList(statement)) {
            throw new Error("Code: 60. Table does not exist.");
          }

          return answer(
            (isOwnersRead(statement) ? ownerRows : sampleRows)[
              sourceOf(statement)
            ] || [],
          );
        }) as never);

      const metrics: TelemetryStoreScan = await scanFrom(424242);

      expect(readMetricRotationCursor(metrics.result.nextState)).toBe(424242);
    });

    test("a metric the service started writing lately is read the scan it first writes, and the read log says so", async () => {
      metricListRows = [
        ...listOf(250),
        {
          ownerId: CHECKOUT,
          metricName: "app.metric.deployed",
          points: "3",
          newestMinute: newestMinuteNow(),
          newestMinutePoints: "1",
          firstMinute: seconds(
            new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          ),
        },
      ];

      const metrics: TelemetryStoreScan = await scanFrom(
        // Where the rotation would be nowhere near it.
        getMetricRotationPosition("app.metric.deployed") + 1,
      );

      expect(readNames()).toContain("app.metric.deployed");
      expect(metrics.result.readLog[0]).toContain(
        "its busiest, 1 it started writing in the last 2 hours, and others in turn",
      );
    });

    test("the rollup's first minute, read defensively: never after its newest, never none", () => {
      const rows: Array<JSONObject> = [
        {
          ownerId: CHECKOUT,
          metricName: "a",
          points: "1",
          newestMinute: seconds("2026-10-27T10:59:00.000Z"),
          newestMinutePoints: "1",
          firstMinute: seconds("2026-10-27T10:41:00.000Z"),
        },
        // From the points: no first minute.
        {
          ownerId: CHECKOUT,
          metricName: "b",
          points: "1",
          newestMinute: seconds("2026-10-27T10:59:00.000Z"),
          newestMinutePoints: "1",
          firstMinute: "0",
        },
        // A first minute after its newest is no first minute.
        {
          ownerId: CHECKOUT,
          metricName: "c",
          points: "1",
          newestMinute: seconds("2026-10-27T10:59:00.000Z"),
          newestMinutePoints: "1",
          firstMinute: seconds("2026-10-27T11:30:00.000Z"),
        },
      ];
      const [a, b, c] = readMetricsToRead(rows, new Set([CHECKOUT]));

      expect(a?.firstMinute).toEqual(new Date("2026-10-27T10:41:00.000Z"));
      expect(b?.firstMinute).toBeUndefined();
      expect(c?.firstMinute).toBeUndefined();
    });
  });

  describe("a metric's name as a record's key", () => {
    test("a name with no sensitive data in it is a key; one built from an email or a project's own type is not", () => {
      expect(isMetricNameAKey("http.server.request.duration")).toBe(true);
      expect(isMetricNameAKey("signups.kim.lee@acmecorp.io.count")).toBe(false);
      expect(isMetricNameAKey("")).toBe(false);

      const detector: ScanDetector = compileCustomDataType({
        dataTypeId: "custom:loyalty",
        pattern: "LOY-[0-9]{6}",
      })!;

      expect(isMetricNameAKey("orders.LOY-123456.total", [detector])).toBe(
        false,
      );
      expect(isMetricNameAKey("orders.LOY-123456.total")).toBe(true);
    });
  });
});
