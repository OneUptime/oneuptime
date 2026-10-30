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
  isConversationContentKey,
  isExcludedLocation,
  RESTRICTED_CONVERSATIONS_WARNING,
  scanProjectTelemetry,
  TELEMETRY_SCAN_MAX_TEXT_LENGTH,
  TelemetrySampleSource,
  TelemetryStoreScan,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import logger from "../../../../../Server/Utils/Logger";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
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
