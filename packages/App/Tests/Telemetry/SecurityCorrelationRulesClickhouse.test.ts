import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  DetectionRuleDefinition,
  SigmaRuleReferenceResolver,
} from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { indexSigmaRules } from "Common/Utils/SecurityEvent/Sigma/SigmaRuleIndex";
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
 * Sigma correlation rules against a real ClickHouse server.
 *
 * The Common unit suites pin the statements CorrelationQueries writes and
 * the time arithmetic CorrelationTimeline does on what they read. This one
 * shows what ClickHouse makes of the statements, on events built by the
 * same row builder ingest uses: that an event_count's rolling window counts
 * a burst whole when a run starts in the middle of it, that value_count
 * counts different values, that a sequence is found in order and only in
 * order, within its timespan and with its last step in the run, that an
 * event_count step of a sequence happens when its count is reached, that
 * aliases group the source address of one rule with the destination of
 * another, that new_value finds the address an account never used and
 * leaves out accounts never seen before, and that another project's events
 * are never read.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/SecurityCorrelationRulesClickhouse.test.ts
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
  DetectionMatchGroup,
} from "Common/Server/Services/SecurityEventService";
import CorrelationRuleMatcher, {
  CorrelationMatchResult,
} from "Common/Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `security_correlation_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

/*
 * A run's window: an hour ago to now, minus the delay a real run reads
 * behind the clock. Every fixture time is minutes from WINDOW_START.
 */
const WINDOW_START: Date = new Date(
  Math.floor(Date.now() / MINUTE) * MINUTE - HOUR,
);

const projectId: ObjectID = new ObjectID(
  "77000000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "77000000-0000-4000-8000-00000000000b",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Correlation fixtures",
  primaryEntityId: new ObjectID("77000000-0000-4000-8000-00000000000c"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

interface EventFixture {
  // Minutes from WINDOW_START (negative: before the run's window).
  at: number;
  className?: string;
  statusName?: string;
  activityName?: string;
  user?: string;
  host?: string;
  sourceIp?: string;
  targetIp?: string;
  message?: string;
  project?: ObjectID;
}

let sequence: number = 0;

function event(fixture: EventFixture): JSONObject {
  sequence++;

  const normalized: NormalizedSecurityEvent = {
    time: new Date(WINDOW_START.getTime() + fixture.at * MINUTE),
    eventUid: `fixture-${sequence}`,
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: fixture.className || "Authentication",
    activityName: fixture.activityName || "Logon",
    severityId: 1,
    severityName: OcsfSeverity.Informational,
    statusName: fixture.statusName || "Failure",
    message: fixture.message || `event ${sequence}`,
    vendorName: "Fixture",
    productName: "Fixture",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: fixture.user || "",
    principalHost: fixture.host || "",
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
    targetIp: fixture.targetIp || "",
    targetPort: 0,
    targetResource: "",
    observables: [fixture.user, fixture.sourceIp, fixture.targetIp].filter(
      (value: string | undefined): value is string => {
        return Boolean(value);
      },
    ),
    attributes: {},
  };

  return buildSecurityEventDbRow({
    normalized,
    projectId: fixture.project || projectId,
    serviceMetadata: SERVICE_METADATA,
    retentionDays: 15,
  });
}

function times(from: number, count: number, every: number): Array<number> {
  const list: Array<number> = [];

  for (let index: number = 0; index < count; index++) {
    list.push(from + index * every);
  }

  return list;
}

const FIXTURES: Array<EventFixture> = [
  // Brute force from 203.0.113.7: twelve failures between minute 18 and 21.5.
  ...times(18, 12, 0.3).map((at: number): EventFixture => {
    return { at, user: "alice", sourceIp: "203.0.113.7" };
  }),
  // A trickle from 198.51.100.9: three failures, nowhere near ten.
  ...times(5, 3, 7).map((at: number): EventFixture => {
    return { at, user: "bob", sourceIp: "198.51.100.9" };
  }),
  // Password spraying from 192.0.2.50: one failure each for six accounts.
  ...["u1", "u2", "u3", "u4", "u5", "u6"].map(
    (user: string, index: number): EventFixture => {
      return { at: 30 + index * 0.5, user, sourceIp: "192.0.2.50" };
    },
  ),
  // carol: six failures, then a success two minutes later - the sequence.
  ...times(34, 6, 0.2).map((at: number): EventFixture => {
    return { at, user: "carol", sourceIp: "198.51.100.20" };
  }),
  { at: 37.5, user: "carol", sourceIp: "198.51.100.20", statusName: "Success" },
  // dave: a success first, failures after - out of order.
  { at: 10, user: "dave", sourceIp: "198.51.100.30", statusName: "Success" },
  ...times(11, 6, 0.2).map((at: number): EventFixture => {
    return { at, user: "dave", sourceIp: "198.51.100.30" };
  }),
  // erin: six failures, and a success forty minutes later - too late.
  ...times(-30, 6, 0.2).map((at: number): EventFixture => {
    return { at, user: "erin", sourceIp: "198.51.100.40" };
  }),
  { at: 12, user: "erin", sourceIp: "198.51.100.40", statusName: "Success" },
  // A scan out of 10.0.0.66, then a malware alert on the address it hit.
  {
    at: 40,
    className: "Network Activity",
    activityName: "Traffic",
    statusName: "Blocked",
    sourceIp: "10.0.0.66",
    targetIp: "10.0.0.99",
  },
  {
    at: 42,
    className: "Detection Finding",
    activityName: "Create",
    statusName: "New",
    sourceIp: "10.0.0.99",
    message: "malware found",
  },
  // frank's history: a month of sign-ins from 198.51.100.50.
  ...times(-20 * 24 * 60, 3, 24 * 60).map((at: number): EventFixture => {
    return {
      at,
      user: "frank",
      sourceIp: "198.51.100.50",
      statusName: "Success",
    };
  }),
  // frank in this run: the old address, and a new one.
  { at: 25, user: "frank", sourceIp: "198.51.100.50", statusName: "Success" },
  { at: 26, user: "frank", sourceIp: "203.0.113.99", statusName: "Success" },
  // gina has never signed in before: not "new for her", just new.
  { at: 27, user: "gina", sourceIp: "203.0.113.100", statusName: "Success" },
  // Another project's brute force, never read.
  ...times(18, 15, 0.1).map((at: number): EventFixture => {
    return {
      at,
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

function parse(
  yaml: string,
  resolveReference?: SigmaRuleReferenceResolver,
): Extract<DetectionRuleDefinition, { kind: "correlation" }> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml, {
    resolveReference,
  });

  if (definition.kind !== "correlation") {
    throw new Error("expected a correlation");
  }

  return definition;
}

async function run(
  definition: Extract<DetectionRuleDefinition, { kind: "correlation" }>,
  window: { startMinute: number; endMinute: number } = {
    startMinute: 0,
    endMinute: 50,
  },
  restrictTo?: Statement,
): Promise<Array<DetectionMatchGroup>> {
  const result: CorrelationMatchResult =
    await CorrelationRuleMatcher.findMatches({
      projectId,
      correlation: definition.correlation,
      steps: definition.steps,
      startTime: new Date(WINDOW_START.getTime() + window.startMinute * MINUTE),
      endTime: new Date(WINDOW_START.getTime() + window.endMinute * MINUTE),
      maxGroups: 100,
      restrictTo,
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

integration("Sigma correlation rules against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
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

  test("event_count finds the brute force and not the trickle, in this project only", async () => {
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10
---
${FAILED_SIGN_IN}`),
    );

    expect(groupValues(groups)).toEqual(["203.0.113.7"]);
    expect(groups[0]!.matchCount).toBe(12);
    expect(groups[0]!.summary).toBe("12 events in 5 minutes");
    expect(groups[0]!.groupFields).toEqual([
      { field: "principalIp", value: "203.0.113.7" },
    ]);
  });

  test("event_count counts a burst whole when the run starts in the middle of it", async () => {
    // The burst runs from minute 18 to 21.3; this run starts at minute 20.
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10
---
${FAILED_SIGN_IN}`),
      { startMinute: 20, endMinute: 30 },
    );

    expect(groupValues(groups)).toEqual(["203.0.113.7"]);
    expect(groups[0]!.matchCount).toBe(12);
  });

  test("event_count stays quiet for a run with none of the group's events", async () => {
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10
---
${FAILED_SIGN_IN}`),
      { startMinute: 25, endMinute: 29 },
    );

    expect(groups).toEqual([]);
  });

  test("value_count finds one address failing against six accounts", async () => {
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Password spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 10m
  condition:
    field: principalUser
    gte: 5
---
${FAILED_SIGN_IN}`),
    );

    expect(groupValues(groups)).toEqual(["192.0.2.50"]);
    expect(groups[0]!.distinctCount).toBe(6);
    expect(groups[0]!.summary).toBe(
      "6 different principalUser values in 10 minutes (6 events)",
    );
  });

  test("temporal_ordered: failed sign-ins then a success, in order and within the timespan", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = parse(`title: Brute force then success
correlation:
  type: temporal_ordered
  rules: [many_failures, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m
---
title: Many failures
name: many_failures
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalUser]
  timespan: 10m
  condition:
    gte: 5
---
${FAILED_SIGN_IN}
---
${SUCCESSFUL_SIGN_IN}`);

    const groups: Array<DetectionMatchGroup> = await run(definition);

    // carol only: dave's success came first, erin's forty minutes late.
    expect(groupValues(groups)).toEqual(["carol"]);
    expect(groups[0]!.summary).toBe(
      "Many failures (5+ events in 10 minutes), then Successful sign-in, 2 minutes apart",
    );
  });

  test("temporal_ordered reads its steps from the project's rules by name", async () => {
    const resolver: SigmaRuleReferenceResolver = indexSigmaRules([
      { id: "a", sigmaRuleYaml: FAILED_SIGN_IN },
      { id: "b", sigmaRuleYaml: SUCCESSFUL_SIGN_IN },
    ]);

    const groups: Array<DetectionMatchGroup> = await run(
      parse(
        `title: Failure then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 3m`,
        resolver,
      ),
    );

    // carol's last failure at 35 and success at 37.5; dave's success came first.
    expect(groupValues(groups)).toEqual(["carol"]);
  });

  test("temporal finds both rules within the timespan in any order, and only then", async () => {
    const inAnyOrder: Array<DetectionMatchGroup> = await run(
      parse(`title: Success near failures
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 3m
---
${FAILED_SIGN_IN}
---
${SUCCESSFUL_SIGN_IN}`),
    );

    // dave's success then failures counts now; erin's are 40 minutes apart.
    expect(groupValues(inAnyOrder)).toEqual(["carol", "dave"]);
  });

  test("aliases group one rule's source address with another's destination", async () => {
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Scanned host then infected
correlation:
  type: temporal_ordered
  rules: [blocked_traffic, malware_alert]
  group-by: [scanned_ip]
  timespan: 5m
  aliases:
    scanned_ip:
      blocked_traffic: targetIp
      malware_alert: principalIp
---
title: Blocked traffic
name: blocked_traffic
detection:
  selection:
    className: Network Activity
    statusName: Blocked
  condition: selection
---
title: Malware alert
name: malware_alert
detection:
  selection:
    className: Detection Finding
  condition: selection`),
    );

    expect(groupValues(groups)).toEqual(["10.0.0.99"]);
    expect(groups[0]!.groupFields).toEqual([
      { field: "scanned_ip", value: "10.0.0.99" },
    ]);
  });

  test("new_value finds the address an account never used, and not accounts never seen", async () => {
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Sign-in from a new address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 30d
  condition:
    field: principalIp
---
${SUCCESSFUL_SIGN_IN}`),
      { startMinute: 20, endMinute: 50 },
    );

    expect(groupValues(groups)).toEqual(["frank"]);
    expect(groups[0]!.distinctCount).toBe(1);
    expect(groups[0]!.summary).toBe(
      "First principalIp in 30 days: 203.0.113.99",
    );
    expect(groups[0]!.sampleObservables[0]).toBe("203.0.113.99");
  });

  test("new_value counts nothing as new that the history already holds", async () => {
    // From minute 26.5 on, frank's new address is history.
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Sign-in from a new address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 30d
  condition:
    field: principalIp
---
${SUCCESSFUL_SIGN_IN}`),
      { startMinute: 26.5, endMinute: 50 },
    );

    expect(groups).toEqual([]);
  });

  test("a setup test's restriction narrows every read", async () => {
    const groups: Array<DetectionMatchGroup> = await run(
      parse(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10
---
${FAILED_SIGN_IN}`),
      { startMinute: 0, endMinute: 50 },
      SQL`principalIp = ${{ type: TableColumnType.Text, value: "198.51.100.9" }}`,
    );

    expect(groups).toEqual([]);
  });
});

describe("Sigma correlation rules ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
