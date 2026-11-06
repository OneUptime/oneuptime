import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import SigmaClickhouseCompiler, {
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
} from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { getRealTimeCountWindow } from "Common/Types/SecurityEvent/RealTimeDetection";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Real-time detection rules that count, against a real ClickHouse server.
 *
 * A rule that counts (a threshold above 1, a distinct count) and a
 * correlation read, in real time, the window of their interval a write's
 * events fall in, as it stood when the write came in: every event whose id
 * is no later than the write's last (ids are time-ordered), and only the
 * groups its events name. A group fires when the write is what made it
 * match - with only what came in before the write's first id it did not.
 *
 * The Common suites pin the statements; this one shows what ClickHouse
 * makes of them, on events built by the row builder ingest uses and given
 * ids in the order they "came in": that a burst written an event at a time
 * fires once, on the event that makes the count, and never again in its
 * window; that a late event that makes the count fires; that a write
 * naming one group fires only that group; that the next window fires
 * again; that a distinct count counts different values; and that each
 * correlation type - a rolling count across windows, a sequence, a first
 * seen value - fires on the write that makes it match, and only on it.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/SecurityRealTimeCountingClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import SecurityEventService, {
  DetectionArrivalRead,
  DetectionMatchGroup,
} from "Common/Server/Services/SecurityEventService";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import CorrelationRuleMatcher, {
  CorrelationMatchResult,
} from "Common/Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `security_real_time_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

/*
 * The rules count in 10-minute windows. WINDOW_START is the start of one,
 * two hours ago, so every fixture time is in the past: minutes from it.
 */
const INTERVAL_IN_MINUTES: number = 10;
const WINDOW_START: Date = getRealTimeCountWindow({
  time: new Date(Date.now() - 2 * HOUR),
  evaluationIntervalInMinutes: INTERVAL_IN_MINUTES,
}).startTime;

const projectId: ObjectID = new ObjectID(
  "78000000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "78000000-0000-4000-8000-00000000000b",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Real-time fixtures",
  primaryEntityId: new ObjectID("78000000-0000-4000-8000-00000000000c"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

interface EventFixture {
  // When it came in: the order of its id, as UUIDv7 ids sort.
  arrival: number;
  // When it happened: minutes from WINDOW_START.
  at: number;
  statusName?: string;
  user?: string;
  sourceIp?: string;
  project?: ObjectID;
}

// A time-ordered id of an arrival: a later arrival sorts after an earlier one.
function arrivalId(arrival: number): string {
  return `019a0000-${String(arrival).padStart(4, "0")}-7000-8000-000000000000`;
}

function event(fixture: EventFixture): JSONObject {
  const normalized: NormalizedSecurityEvent = {
    time: new Date(WINDOW_START.getTime() + fixture.at * MINUTE),
    eventUid: `fixture-${fixture.arrival}`,
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 1,
    severityName: OcsfSeverity.Informational,
    statusName: fixture.statusName || "Failure",
    message: `event ${fixture.arrival}`,
    vendorName: "Fixture",
    productName: "Fixture",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: fixture.user || "",
    principalHost: "",
    principalIp: fixture.sourceIp || "",
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables: [fixture.user, fixture.sourceIp].filter(
      (value: string | undefined): value is string => {
        return Boolean(value);
      },
    ),
    attributes: {},
  };

  return {
    ...buildSecurityEventDbRow({
      normalized,
      projectId: fixture.project || projectId,
      serviceMetadata: SERVICE_METADATA,
      retentionDays: 15,
    }),
    _id: arrivalId(fixture.arrival),
  };
}

const FIXTURES: Array<EventFixture> = [
  // A brute force from 203.0.113.7, one failure a write, at minutes 1 to 6.
  ...[1, 2, 3, 4, 5, 6].map((arrival: number): EventFixture => {
    return { arrival, at: arrival, user: "alice", sourceIp: "203.0.113.7" };
  }),
  // ...and four more in the next window, at minutes 11 to 14.
  ...[7, 8, 9, 10, 11].map((arrival: number): EventFixture => {
    return {
      arrival,
      at: arrival + 4,
      user: "alice",
      sourceIp: "203.0.113.7",
    };
  }),
  // 198.51.100.9: four failures on time, then a late one from before them.
  ...[21, 22, 23, 24].map((arrival: number): EventFixture => {
    return { arrival, at: arrival - 18, user: "bob", sourceIp: "198.51.100.9" };
  }),
  { arrival: 25, at: 2, user: "bob", sourceIp: "198.51.100.9" },
  // 192.0.2.50 sprays five accounts, one a write - bob twice.
  ...["u1", "u2", "u2", "u3", "u4", "u5"].map(
    (user: string, index: number): EventFixture => {
      return {
        arrival: 31 + index,
        at: 1 + index,
        user,
        sourceIp: "192.0.2.50",
      };
    },
  ),
  // carol: three failures, then a success - the sequence completes on arrival 44.
  ...[41, 42, 43].map((arrival: number): EventFixture => {
    return {
      arrival,
      at: arrival - 40,
      user: "carol",
      sourceIp: "198.51.100.20",
    };
  }),
  {
    arrival: 44,
    at: 5,
    user: "carol",
    sourceIp: "198.51.100.20",
    statusName: "Success",
  },
  // frank's history (a week ago) from one address, then a new one, twice.
  {
    arrival: 50,
    at: -7 * 24 * 60,
    user: "frank",
    sourceIp: "198.51.100.50",
    statusName: "Success",
  },
  {
    arrival: 51,
    at: 3,
    user: "frank",
    sourceIp: "203.0.113.99",
    statusName: "Success",
  },
  {
    arrival: 52,
    at: 4,
    user: "frank",
    sourceIp: "203.0.113.99",
    statusName: "Success",
  },
  // Another project's brute force, never read.
  ...[61, 62, 63, 64, 65, 66].map((arrival: number): EventFixture => {
    return {
      arrival,
      at: arrival - 60,
      user: "alice",
      sourceIp: "203.0.113.7",
      project: otherProjectId,
    };
  }),
];

const FAILED_SIGN_IN: string = `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

const SUCCESSFUL_SIGN_IN: string = `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

// The window a minute falls in, the write's arrivals, and the time it covers.
function arrivalRead(arrivals: Array<number>): DetectionArrivalRead {
  const fixtures: Array<EventFixture> = FIXTURES.filter(
    (fixture: EventFixture): boolean => {
      return arrivals.includes(fixture.arrival);
    },
  );
  const times: Array<number> = fixtures.map((fixture: EventFixture): number => {
    return WINDOW_START.getTime() + fixture.at * MINUTE;
  });
  const ids: Array<string> = arrivals.map(arrivalId).sort();

  return {
    candidateIds: ids,
    firstId: ids[0]!,
    lastId: ids[ids.length - 1]!,
    candidateStartTime: new Date(Math.min(...times) - 1000),
    candidateEndTime: new Date(Math.max(...times) + 1000),
  };
}

function windowOf(minute: number): { startTime: Date; endTime: Date } {
  return getRealTimeCountWindow({
    time: new Date(WINDOW_START.getTime() + minute * MINUTE),
    evaluationIntervalInMinutes: INTERVAL_IN_MINUTES,
  });
}

async function countingGroups(data: {
  arrivals: Array<number>;
  // A minute of the window it reads.
  minute: number;
  threshold: number;
  distinctCountField?: string | undefined;
}): Promise<Array<DetectionMatchGroup>> {
  const definition: DetectionRuleDefinition =
    SigmaRuleSetParser.parse(FAILED_SIGN_IN);

  if (definition.kind !== "single") {
    throw new Error("expected a single rule");
  }

  const window: { startTime: Date; endTime: Date } = windowOf(data.minute);

  return SecurityEventService.findDetectionMatches({
    projectId,
    startTime: window.startTime,
    endTime: window.endTime,
    whereFragment: SigmaClickhouseCompiler.compile(definition.rule),
    groupByExpression: buildSigmaFieldExpression("principalIp"),
    distinctCountExpression: data.distinctCountField
      ? buildSigmaDistinctCountExpression(data.distinctCountField)
      : null,
    minMatchCount: data.threshold,
    maxGroups: 100,
    arrival: arrivalRead(data.arrivals),
  });
}

function correlation(
  yaml: string,
): Extract<DetectionRuleDefinition, { kind: "correlation" }> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);

  if (definition.kind !== "correlation") {
    throw new Error("expected a correlation");
  }

  return definition;
}

async function correlationGroups(
  definition: Extract<DetectionRuleDefinition, { kind: "correlation" }>,
  data: { arrivals: Array<number>; minute: number },
): Promise<Array<DetectionMatchGroup>> {
  const window: { startTime: Date; endTime: Date } = windowOf(data.minute);
  const result: CorrelationMatchResult =
    await CorrelationRuleMatcher.findMatches({
      projectId,
      correlation: definition.correlation,
      steps: definition.steps,
      startTime: window.startTime,
      endTime: window.endTime,
      maxGroups: 100,
      arrival: arrivalRead(data.arrivals),
    });

  return result.groups;
}

function groupValues(groups: Array<DetectionMatchGroup>): Array<string> {
  return groups
    .map((group: DetectionMatchGroup): string => {
      return group.groupValue;
    })
    .sort();
}

/*
 * Every scenario, as each analyzer reads it.
 */
function scenarios(): void {
  test("a burst written an event at a time fires once, on the event that makes the count, in this project only", async () => {
    const fired: Array<number> = [];

    for (const arrival of [1, 2, 3, 4, 5, 6]) {
      const groups: Array<DetectionMatchGroup> = await countingGroups({
        arrivals: [arrival],
        minute: 1,
        threshold: 5,
      });

      if (groups.length > 0) {
        fired.push(arrival);
        expect(groupValues(groups)).toEqual(["203.0.113.7"]);
        // Five events in the window when the fifth came in.
        expect(groups[0]!.matchCount).toBe(5);
      }
    }

    expect(fired).toEqual([5]);

    // Another project's write names nothing of this one.
    expect(
      await countingGroups({ arrivals: [66], minute: 1, threshold: 5 }),
    ).toEqual([]);
  });

  test("one write that brings a group past the threshold fires once, with what the window holds", async () => {
    const groups: Array<DetectionMatchGroup> = await countingGroups({
      arrivals: [3, 4, 5, 6],
      minute: 1,
      threshold: 5,
    });

    expect(groupValues(groups)).toEqual(["203.0.113.7"]);
    expect(groups[0]!.matchCount).toBe(6);
  });

  test("the next window counts again: a burst that goes on fires again once it makes the count there", async () => {
    const fired: Array<number> = [];

    for (const arrival of [7, 8, 9, 10, 11]) {
      if (
        (
          await countingGroups({
            arrivals: [arrival],
            minute: 11,
            threshold: 5,
          })
        ).length > 0
      ) {
        fired.push(arrival);
      }
    }

    // Minutes 11 to 15 of the next window: five failures, the fifth on arrival 11.
    expect(fired).toEqual([11]);
  });

  test("a late event that makes the count fires, though it happened before the others", async () => {
    for (const arrival of [21, 22, 23, 24]) {
      expect(
        await countingGroups({ arrivals: [arrival], minute: 1, threshold: 5 }),
      ).toEqual([]);
    }

    const late: Array<DetectionMatchGroup> = await countingGroups({
      arrivals: [25],
      minute: 1,
      threshold: 5,
    });

    expect(groupValues(late)).toEqual(["198.51.100.9"]);
  });

  test("a group past the threshold before the write stays quiet in its window", async () => {
    // 198.51.100.9 held four failures before arrival 25: at a threshold of 3 it fired already.
    expect(
      await countingGroups({ arrivals: [25], minute: 1, threshold: 3 }),
    ).toEqual([]);
    expect(
      groupValues(
        await countingGroups({ arrivals: [23], minute: 1, threshold: 3 }),
      ),
    ).toEqual(["198.51.100.9"]);
  });

  test("a distinct count fires on the write that brings the fifth different value; a repeat brings none", async () => {
    const fired: Array<number> = [];

    for (const arrival of [31, 32, 33, 34, 35, 36]) {
      const groups: Array<DetectionMatchGroup> = await countingGroups({
        arrivals: [arrival],
        minute: 1,
        threshold: 5,
        distinctCountField: "principalUser",
      });

      if (groups.length > 0) {
        fired.push(arrival);
        expect(groups[0]!.distinctCount).toBe(5);
      }
    }

    // u1, u2, u2 (no new value), u3, u4, u5: the fifth different account on arrival 36.
    expect(fired).toEqual([36]);
  });

  test("an event_count correlation fires on the write that makes its rolling count, and again in the next window", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 30m
  condition:
    gte: 5
---
${FAILED_SIGN_IN}`);

    const firstWindow: Array<number> = [];

    for (const arrival of [1, 2, 3, 4, 5, 6]) {
      if (
        (
          await correlationGroups(definition, {
            arrivals: [arrival],
            minute: 1,
          })
        ).length > 0
      ) {
        firstWindow.push(arrival);
      }
    }

    expect(firstWindow).toEqual([5]);

    /*
     * In the next window the rolling count still holds the first's events:
     * the burst going on fires again, on its first event there, as a
     * scheduled run of that window would.
     */
    const nextWindow: Array<number> = [];

    for (const arrival of [7, 8, 9, 10, 11]) {
      if (
        (
          await correlationGroups(definition, {
            arrivals: [arrival],
            minute: 11,
          })
        ).length > 0
      ) {
        nextWindow.push(arrival);
      }
    }

    expect(nextWindow).toEqual([7]);
  });

  test("a value_count correlation counts different values, and fires when the fifth comes in", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 30m
  condition:
    field: principalUser
    gte: 5
---
${FAILED_SIGN_IN}`);

    const fired: Array<number> = [];

    for (const arrival of [31, 32, 33, 34, 35, 36]) {
      const groups: Array<DetectionMatchGroup> = await correlationGroups(
        definition,
        { arrivals: [arrival], minute: 1 },
      );

      if (groups.length > 0) {
        fired.push(arrival);
        expect(groupValues(groups)).toEqual(["192.0.2.50"]);
      }
    }

    expect(fired).toEqual([36]);
  });

  test("a sequence fires on the write that completes it, and only on it", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Failures, then a success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m
---
${FAILED_SIGN_IN}
---
${SUCCESSFUL_SIGN_IN}`);

    const fired: Array<number> = [];

    for (const arrival of [41, 42, 43, 44]) {
      const groups: Array<DetectionMatchGroup> = await correlationGroups(
        definition,
        { arrivals: [arrival], minute: 1 },
      );

      if (groups.length > 0) {
        fired.push(arrival);
        expect(groupValues(groups)).toEqual(["carol"]);
      }
    }

    expect(fired).toEqual([44]);
  });

  test("a new value fires on the write that first brings it, and not on the next that repeats it", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Sign-in from a new address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 14d
  condition:
    field: principalIp
---
${SUCCESSFUL_SIGN_IN}`);

    const first: Array<DetectionMatchGroup> = await correlationGroups(
      definition,
      { arrivals: [51], minute: 1 },
    );

    expect(groupValues(first)).toEqual(["frank"]);
    expect(first[0]!.summary).toBe(
      "First principalIp in 2 weeks: 203.0.113.99",
    );

    expect(
      await correlationGroups(definition, { arrivals: [52], minute: 1 }),
    ).toEqual([]);
  });
}

integration("Real-time rules that count, against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let connectionOptions: ClickHouseClientConfigOptions | undefined;
  let original:
    | {
        database: ClickhouseDatabase;
        databaseClient: ClickhouseClient | null;
        ingestDatabase: ClickhouseDatabase;
        ingestDatabaseClient: ClickhouseClient | null;
      }
    | undefined;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    connectionOptions = options;
    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    const model: SecurityEvent = new SecurityEvent();
    const generator: StatementGenerator<SecurityEvent> =
      new StatementGenerator<SecurityEvent>({
        modelType: SecurityEvent,
        database: clickhouse,
      });
    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    original = {
      database: SecurityEventService.database,
      databaseClient: SecurityEventService.databaseClient,
      ingestDatabase: SecurityEventService.ingestDatabase,
      ingestDatabaseClient: SecurityEventService.ingestDatabaseClient,
    };

    SecurityEventService.database = clickhouse;
    SecurityEventService.databaseClient = client;
    SecurityEventService.ingestDatabase = clickhouse;
    SecurityEventService.ingestDatabaseClient = client;

    await SecurityEventService.insertJsonRows(FIXTURES.map(event), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(SecurityEventService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  describe("with the analyzer ClickHouse runs by default", () => {
    scenarios();
  });

  /*
   * A server, or a profile, that still turns the older analyzer on
   * (enable_analyzer = 0, under either of its names) reads every statement
   * the same.
   */
  describe("with the older analyzer", () => {
    let older: {
      database: ClickhouseDatabase;
      client: ClickhouseClient;
    } | null = null;

    beforeAll(async (): Promise<void> => {
      const found: { json: () => Promise<unknown> } = await client.query({
        query:
          "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
        format: "JSONEachRow",
      });
      const [setting] = (await found.json()) as Array<{ name: string }>;

      if (!setting) {
        return;
      }

      const olderOptions: ClickHouseClientConfigOptions = {
        ...connectionOptions!,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );
      const olderClient: ClickhouseClient =
        await olderDatabase.connect(olderOptions);

      const analyzer: { json: () => Promise<unknown> } =
        await olderClient.query({
          query: "SELECT toUInt8(getSetting({name:String})) AS analyzer",
          query_params: { name: setting.name },
          format: "JSONEachRow",
        });
      const [row] = (await analyzer.json()) as Array<{
        analyzer: string | number;
      }>;

      expect(Number(row!.analyzer)).toBe(0);

      older = { database: olderDatabase, client: olderClient };
      SecurityEventService.database = olderDatabase;
      SecurityEventService.databaseClient = olderClient;
    });

    afterAll(async (): Promise<void> => {
      SecurityEventService.database = clickhouse;
      SecurityEventService.databaseClient = client;

      if (older) {
        await older.database.disconnect();
      }
    });

    scenarios();
  });
});

describe("Real-time counting ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
