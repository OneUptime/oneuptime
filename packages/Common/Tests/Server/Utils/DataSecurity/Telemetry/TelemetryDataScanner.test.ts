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
  buildTelemetryOwnersStatement,
  buildTelemetrySampleStatement,
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
const WINDOW_START: RegExp = /(?:time|startTime) >= \{(p\d+):DateTime64\(9\)\}/;
const WINDOW_END: RegExp = /(?:time|startTime) <= \{(p\d+):DateTime64\(9\)\}/;
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
let statements: Array<Statement> = [];

function sourceOf(statement: Statement): TelemetrySampleSource {
  const query: string = statement.query;
  const isRum: boolean = Object.values(statement.query_params).includes(
    "RealUserMonitor",
  );

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
  };
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
  };

  jest
    .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
    .mockImplementation((async (statement: Statement): Promise<Results> => {
      statements.push(statement);

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

      if (!isOwnersRead(statement)) {
        expect(Number(parameterAfter(statement, LIMIT_BY))).toBeGreaterThan(0);
        expect(parameterAfter(statement, OWNERS_IN)).toEqual(expect.any(Array));
      }
    }
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
    ]) {
      off.set(kind, new Set([CHECKOUT]));
    }

    const scans: Array<TelemetryStoreScan> = await scanWithout(off);

    expect(storesOf(scans, CHECKOUT)).toEqual([]);

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
    }
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
