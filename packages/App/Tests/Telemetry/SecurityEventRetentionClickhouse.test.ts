import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DetectionRetrohuntGroup,
  DetectionRetrohuntResult,
} from "Common/Types/SecurityEvent/DetectionRetrohunt";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * HOW FAR BACK SECURITY EVENTS GO, ON A REAL CLICKHOUSE (#10432).
 *
 * A security event is kept until its retentionDate, but ClickHouse deletes
 * it only when it merges: the table drops a part once every row in it has
 * expired, so a row past its retention can still be read for a while. A
 * First seen rule whose timespan was longer than the project kept its
 * events read such rows as history, and what it called new depended on
 * what the server had merged away - and once they were gone, a value last
 * seen 20 days ago read as never seen, with a sentence claiming 30 days.
 *
 * Told how long the project keeps its events, a rule's history holds only
 * the events still kept, and its sentence says the span it could see;
 * Run on Past Events reads the whole period's kept events (a late arrival
 * from before the kept days included, never an expired row) and says where
 * the kept events start.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/SecurityEventRetentionClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server; the guard at the bottom fails the
 * run there if it ever goes missing.
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
  CorrelationKeptEvents,
  CorrelationMatchResult,
} from "Common/Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";
import DetectionRuleRetrohunt from "Common/Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import SecurityEventRetention from "Common/Server/Utils/SecurityEvent/SecurityEventRetention";
import SecurityWatchlists from "Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `security_event_retention_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// The moment the reads happen at, to the second: every expiry is said from it.
const NOW: Date = new Date(Math.floor(Date.now() / 1000) * 1000);

// A run's window: from an hour before NOW, fifty minutes long.
const WINDOW_START: Date = new Date(NOW.getTime() - HOUR);

const projectId: ObjectID = new ObjectID(
  "88000000-0000-4000-8000-00000000000a",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Retention fixtures",
  primaryEntityId: new ObjectID("88000000-0000-4000-8000-00000000000c"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

interface EventFixture {
  // When it happened.
  time: Date;
  // When it is deleted: in the past for a row past its retention its part still holds.
  expires: Date;
  user: string;
  sourceIp: string;
  statusName: string;
}

let sequence: number = 0;

function event(fixture: EventFixture): JSONObject {
  sequence++;

  const normalized: NormalizedSecurityEvent = {
    time: fixture.time,
    eventUid: `retention-fixture-${sequence}`,
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 1,
    severityName: OcsfSeverity.Informational,
    statusName: fixture.statusName,
    message: `sign-in ${sequence}`,
    vendorName: "Fixture",
    productName: "Fixture",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: fixture.user,
    principalHost: "",
    principalIp: fixture.sourceIp,
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
    observables: [fixture.user, fixture.sourceIp],
    attributes: {},
  };

  const row: JSONObject = buildSecurityEventDbRow({
    normalized,
    projectId,
    serviceMetadata: SERVICE_METADATA,
    retentionDays: 15,
  });

  row["retentionDate"] = OneUptimeDate.toClickhouseDateTime(fixture.expires);

  return row;
}

function minutesFromWindowStart(minutes: number): Date {
  return new Date(WINDOW_START.getTime() + minutes * MINUTE);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function daysAhead(days: number): Date {
  return new Date(NOW.getTime() + days * DAY);
}

const FIXTURES: Array<EventFixture> = [
  /*
   * henry signed in from .70 twenty days ago, in a project keeping 15 days:
   * that row is past its retention (expired 5 days ago), and its part
   * still holds it. Five days ago he signed in from .80, which is kept.
   * In this run, from .70 again.
   */
  {
    time: daysAgo(20),
    expires: daysAgo(5),
    user: "henry",
    sourceIp: "198.51.100.70",
    statusName: "Success",
  },
  {
    time: daysAgo(5),
    expires: daysAhead(10),
    user: "henry",
    sourceIp: "198.51.100.80",
    statusName: "Success",
  },
  {
    time: minutesFromWindowStart(28),
    expires: daysAhead(15),
    user: "henry",
    sourceIp: "198.51.100.70",
    statusName: "Success",
  },
  /*
   * iris signed in from .90 twenty days ago, and that row is still kept
   * (it arrived late, so it is kept from when it arrived): history, so
   * her sign-in from .90 in this run is nothing new.
   */
  {
    time: daysAgo(20),
    expires: daysAhead(10),
    user: "iris",
    sourceIp: "198.51.100.90",
    statusName: "Success",
  },
  {
    time: minutesFromWindowStart(29),
    expires: daysAhead(15),
    user: "iris",
    sourceIp: "198.51.100.90",
    statusName: "Success",
  },
  /*
   * For Run on Past Events: jack failed to sign in twenty days ago, and
   * the event arrived yesterday - kept, though it happened before the
   * kept days. kate failed twenty days ago too, but that row is past its
   * retention; two days ago she failed again, which is kept.
   */
  {
    time: daysAgo(20),
    expires: daysAhead(14),
    user: "jack",
    sourceIp: "203.0.113.10",
    statusName: "Failure",
  },
  {
    time: daysAgo(20),
    expires: daysAgo(5),
    user: "kate",
    sourceIp: "203.0.113.11",
    statusName: "Failure",
  },
  {
    time: daysAgo(2),
    expires: daysAhead(13),
    user: "kate",
    sourceIp: "203.0.113.11",
    statusName: "Failure",
  },
];

const FIRST_SEEN_30_DAYS: string = `title: Sign-in from a new address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 30d
  condition:
    field: principalIp
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

const FAILED_SIGN_IN: string = `title: Failed sign-in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

function correlation(
  yaml: string,
): Extract<DetectionRuleDefinition, { kind: "correlation" }> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);

  if (definition.kind !== "correlation") {
    throw new Error("expected a correlation");
  }

  return definition;
}

async function firstSeen(
  kept: CorrelationKeptEvents | undefined,
): Promise<Array<DetectionMatchGroup>> {
  const definition: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
    correlation(FIRST_SEEN_30_DAYS);

  const result: CorrelationMatchResult =
    await CorrelationRuleMatcher.findMatches({
      projectId,
      correlation: definition.correlation,
      steps: definition.steps,
      startTime: WINDOW_START,
      endTime: minutesFromWindowStart(50),
      maxGroups: 100,
      kept,
    });

  return result.groups;
}

function groupOf(
  groups: Array<DetectionMatchGroup>,
  value: string,
): DetectionMatchGroup | undefined {
  return groups.find((group: DetectionMatchGroup): boolean => {
    return group.groupValue === value;
  });
}

integration("how far back security events go, against ClickHouse", () => {
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

    /*
     * The table as the model makes it, with no TTL: what a part that still
     * holds an expired row looks like to a read, whenever it is dropped.
     */
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

  describe("a First seen rule after older events expire", () => {
    test("told nothing of what is kept, it reads an expired row as history: henry's address is not new while the part still holds it", async () => {
      const groups: Array<DetectionMatchGroup> = await firstSeen(undefined);

      expect(groupOf(groups, "henry")).toBeUndefined();
      expect(groupOf(groups, "iris")).toBeUndefined();
    });

    test("told the project keeps 15 days, the expired row is no history, and the value is new only for the 15 days it could see", async () => {
      const groups: Array<DetectionMatchGroup> = await firstSeen({
        retentionInDays: 15,
        at: NOW,
      });

      const henry: DetectionMatchGroup | undefined = groupOf(groups, "henry");

      expect(henry).toBeDefined();
      // Never "in 30 days": the 15 it could see.
      expect(henry!.summary).toBe(
        "First principalIp in 15 days: 198.51.100.70",
      );
      expect(henry!.summary).not.toContain("30 days");
    });

    test("a row still kept is history, however long ago it happened: iris's address is nothing new", async () => {
      const groups: Array<DetectionMatchGroup> = await firstSeen({
        retentionInDays: 15,
        at: NOW,
      });

      expect(groupOf(groups, "iris")).toBeUndefined();
    });

    test("the same reads, a day later, still hold what is kept then: henry's kept row from .80 is history for the group", async () => {
      const groups: Array<DetectionMatchGroup> = await firstSeen({
        retentionInDays: 15,
        at: new Date(NOW.getTime() + DAY),
      });

      // .80 is still kept a day on, so henry is a group the history holds.
      expect(groupOf(groups, "henry")?.summary).toBe(
        "First principalIp in 15 days: 198.51.100.70",
      );
    });

    test("once the group's every row has expired, it is a group never seen: nothing is said of it", async () => {
      const groups: Array<DetectionMatchGroup> = await firstSeen({
        retentionInDays: 15,
        // Eleven days on: henry's .80 has expired too.
        at: new Date(NOW.getTime() + 11 * DAY),
      });

      expect(groupOf(groups, "henry")).toBeUndefined();
    });
  });

  describe("Run on Past Events over a period that starts before the kept events", () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      jest
        .spyOn(SecurityEventRetention, "getRetentionInDays")
        .mockResolvedValue(15 as never);
      jest.spyOn(SecurityWatchlists, "readerFor").mockReturnValue({
        bind: async (definition: unknown): Promise<unknown> => {
          return definition;
        },
      } as never);
    });

    test("the last 30 days, 15 kept: says where the kept events start, counts a late arrival from before them, and never an expired row", async () => {
      const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run(
        {
          projectId,
          rule: {
            sigmaRuleYaml: FAILED_SIGN_IN,
            groupByField: "principalUser",
            matchCountThreshold: 1,
            evaluationIntervalInMinutes: 60,
          },
          periodInHours: 720,
          serviceFilter: {},
          now: NOW,
        },
      );

      expect(result.retentionInDays).toBe(15);
      expect(result.keptFrom?.getTime()).toBe(NOW.getTime() - 15 * DAY);

      const byUser: Map<string, DetectionRetrohuntGroup> = new Map(
        result.groups.map(
          (
            group: DetectionRetrohuntGroup,
          ): [string, DetectionRetrohuntGroup] => {
            return [group.value, group];
          },
        ),
      );

      // jack's failure happened 20 days ago and arrived late: kept, and read.
      expect(byUser.get("jack")?.eventCount).toBe(1);
      // kate's failure of 20 days ago is past its retention: only two days ago's is read.
      expect(byUser.get("kate")?.eventCount).toBe(1);
      expect(result.matchedEventCount).toBe(2);
      expect(result.firedCount).toBe(2);
    });

    test("the last 7 days: kept all through, so nothing is said of where they start", async () => {
      const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run(
        {
          projectId,
          rule: {
            sigmaRuleYaml: FAILED_SIGN_IN,
            groupByField: "principalUser",
            matchCountThreshold: 1,
            evaluationIntervalInMinutes: 60,
          },
          periodInHours: 168,
          serviceFilter: {},
          now: NOW,
        },
      );

      expect(result.keptFrom).toBeNull();
      expect(result.matchedEventCount).toBe(1);
    });

    test("a First seen rule over the last 7 days could see 8 of its 30 days before the period, and says so", async () => {
      const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run(
        {
          projectId,
          rule: { sigmaRuleYaml: FIRST_SEEN_30_DAYS },
          periodInHours: 168,
          serviceFilter: {},
          now: NOW,
        },
      );

      expect(result.isCorrelation).toBe(true);
      expect(result.firstSeenHistory).toEqual({
        lookbackInSeconds: 30 * 24 * 60 * 60,
        keptLookbackInSeconds: 8 * 24 * 60 * 60,
      });
    });

    test("over the last 30 days it could see none of its history: nothing found is not nothing new", async () => {
      const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run(
        {
          projectId,
          rule: { sigmaRuleYaml: FIRST_SEEN_30_DAYS },
          periodInHours: 720,
          serviceFilter: {},
          now: NOW,
        },
      );

      expect(result.firstSeenHistory?.keptLookbackInSeconds).toBe(0);
      expect(result.keptFrom?.getTime()).toBe(NOW.getTime() - 15 * DAY);
    });
  });
});

describe("how far back security events go: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
