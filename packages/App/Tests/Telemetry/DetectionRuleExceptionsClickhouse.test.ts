import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
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
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import { DetectionRetrohuntResult } from "Common/Types/SecurityEvent/DetectionRetrohunt";
import {
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
} from "Common/Types/SecurityEvent/DetectionRuleException";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Detection rule exceptions and retrohunt against a real ClickHouse server.
 *
 * Common's DetectionRuleExceptions and DetectionRuleRetrohunt suites pin
 * the statements; this one shows what ClickHouse makes of them, on events
 * built by the row builder ingest uses:
 *
 *   - each kind of exception skips exactly what it names: a user, a
 *     pattern of accounts, a host, an address range (with events whose
 *     address is empty - ClickHouse's isIPAddressInRange throws on those),
 *     a typed field's value, an attribute's value, a value among the
 *     observables, and a time window;
 *   - a rule's `cidr` reads events with no address without failing;
 *   - a retrohunt counts in windows as long as the rule's interval, fires a
 *     group in a window only at its threshold, says how many events it
 *     matched, how many its exceptions skipped and how many firings they
 *     prevented - for a distinct count too - and reads a correlation with
 *     the exceptions in every read;
 *   - another project's events are never read.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/DetectionRuleExceptionsClickhouse.test.ts
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
import DetectionRuleExceptionService from "Common/Server/Services/DetectionRuleExceptionService";
import {
  buildDetectionRuleExceptionsFilter,
  buildDetectionRuleExceptionsMatch,
} from "Common/Server/Utils/SecurityEvent/DetectionRuleExceptions";
import DetectionRuleRetrohunt from "Common/Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import SigmaClickhouseCompiler from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `detection_exceptions_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

/*
 * One clock for every fixture and read: six whole hours ago, on an hour,
 * so the 5-minute windows of a retrohunt start where the fixture's do.
 */
const NOW: Date = new Date(Math.floor(Date.now() / HOUR) * HOUR);
const BASE: Date = new Date(NOW.getTime() - 6 * HOUR);

const projectId: ObjectID = new ObjectID(
  "88000000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "88000000-0000-4000-8000-00000000000b",
);
const RULE_ID: ObjectID = new ObjectID("88000000-0000-4000-8000-00000000000d");

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Exception fixtures",
  primaryEntityId: new ObjectID("88000000-0000-4000-8000-00000000000c"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

interface EventFixture {
  // Minutes from BASE.
  at: number;
  statusName?: string;
  user?: string;
  targetUser?: string;
  host?: string;
  sourceIp?: string;
  targetIp?: string;
  processName?: string;
  attributes?: JSONObject;
  observables?: Array<string>;
  message?: string;
  project?: ObjectID;
}

let sequence: number = 0;

function event(fixture: EventFixture): JSONObject {
  sequence++;

  const normalized: NormalizedSecurityEvent = {
    time: new Date(BASE.getTime() + fixture.at * MINUTE),
    eventUid: `exception-fixture-${sequence}`,
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
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
    processName: fixture.processName || "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: fixture.targetUser || "",
    targetHost: "",
    targetIp: fixture.targetIp || "",
    targetPort: 0,
    targetResource: "",
    observables: fixture.observables || [],
    attributes: fixture.attributes || {},
  };

  return buildSecurityEventDbRow({
    normalized,
    projectId: fixture.project || projectId,
    serviceMetadata: SERVICE_METADATA,
    retentionDays: 15,
  });
}

function burst(
  from: number,
  count: number,
  fixture: Omit<EventFixture, "at">,
): Array<EventFixture> {
  const list: Array<EventFixture> = [];

  for (let index: number = 0; index < count; index++) {
    list.push({ ...fixture, at: from + index * 0.5 });
  }

  return list;
}

/*
 * Every fixture fails a sign-in, unless it says otherwise. In 5-minute
 * windows from BASE:
 *
 *   alice    4 in [0,5), 2 in [10,15), 5 in [20,25)  - fires twice at 3
 *   bob      2 in [0,5)                               - never reaches 3
 *   carol    3 in [30,35)                             - fires, unless skipped
 *   svc-*    3 + 3 service accounts in [40,45)        - each fires, unless skipped
 *   ''       3 with no user in [50,55)                - the '' group
 */
const FIXTURES: Array<EventFixture> = [
  ...burst(1, 4, { user: "alice", sourceIp: "10.20.5.5", host: "web-01" }),
  ...burst(11, 2, { user: "alice", sourceIp: "198.51.100.7" }),
  ...burst(21, 5, {
    user: "alice",
    sourceIp: "198.51.100.7",
    message: "alice again",
  }),
  ...burst(1, 2, { user: "bob", sourceIp: "198.51.100.8" }),
  ...burst(31, 3, {
    user: "Carol",
    sourceIp: "198.51.100.9",
    processName: "Backup.exe",
  }),
  ...burst(41, 3, { user: "svc-backup", host: "db-01.corp.example.com" }),
  ...burst(41, 3, { user: "svc-deploy", targetUser: "root" }),
  // No user, no address: the empty group, and '' in every IP column.
  ...burst(51, 3, {
    attributes: { "http.user_agent": "Nessus/10.6" },
    observables: ["scanner-7"],
  }),
  // A success: the rule never matches it.
  { at: 2, user: "alice", statusName: "Success" },
  // Another project's burst, never read.
  ...burst(1, 6, { user: "alice", project: otherProjectId }),
];

const FAILED_SIGN_IN_YAML: string = `title: Failed sign-in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

function exception(
  overrides: Partial<DetectionRuleExceptionShape>,
): DetectionRuleExceptionShape {
  return {
    kind: DetectionRuleExceptionKind.Entity,
    entityType: SecurityEntityType.User,
    ...overrides,
  };
}

// The failed sign-ins a rule's exceptions leave, by user.
async function usersLeft(
  exceptions: Array<DetectionRuleExceptionShape>,
): Promise<Record<string, number>> {
  const filter: Statement | null =
    buildDetectionRuleExceptionsFilter(exceptions);
  const statement: Statement = SQL`SELECT principalUser AS user, count() AS events FROM ${database}.${new SecurityEvent().tableName} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: projectId,
  }} AND statusName = 'Failure'`;

  if (filter) {
    statement.append(" AND ");
    statement.append(filter);
  }

  statement.append(" GROUP BY user ORDER BY user");

  const response: { data?: Array<JSONObject> } = await (
    await SecurityEventService.executeQuery(statement)
  ).json();

  const left: Record<string, number> = {};

  for (const row of response.data || []) {
    left[String(row["user"])] = Number(row["events"]);
  }

  return left;
}

const EVERYONE: Record<string, number> = {
  "": 3,
  Carol: 3,
  alice: 11,
  bob: 2,
  "svc-backup": 3,
  "svc-deploy": 3,
};

function without(...users: Array<string>): Record<string, number> {
  const left: Record<string, number> = { ...EVERYONE };

  for (const user of users) {
    delete left[user];
  }

  return left;
}

function savedException(
  overrides: Partial<DetectionRuleExceptionShape>,
): DetectionRuleException {
  const row: DetectionRuleException = new DetectionRuleException();
  row._id = "88000000-0000-4000-8000-0000000000e1";
  row.projectId = projectId;
  row.detectionRuleId = RULE_ID;
  Object.assign(row, exception(overrides));
  return row;
}

integration(
  "Detection rule exceptions and retrohunt against ClickHouse",
  () => {
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

    afterEach(() => {
      jest.restoreAllMocks();
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

    describe("each kind of exception skips exactly what it names", () => {
      test("no exception: every failed sign-in is read", async () => {
        expect(await usersLeft([])).toEqual(EVERYONE);
      });

      test("a user, whatever the case, as who acted", async () => {
        expect(await usersLeft([exception({ value: "CAROL" })])).toEqual(
          without("Carol"),
        );
      });

      test("a user as who was acted on", async () => {
        expect(await usersLeft([exception({ value: "root" })])).toEqual(
          without("svc-deploy"),
        );
      });

      test("a pattern of service accounts", async () => {
        expect(await usersLeft([exception({ value: "svc-*" })])).toEqual(
          without("svc-backup", "svc-deploy"),
        );
      });

      test("a host pattern of a domain", async () => {
        expect(
          await usersLeft([
            exception({
              entityType: SecurityEntityType.Host,
              value: "*.corp.example.com",
            }),
          ]),
        ).toEqual(without("svc-backup"));
      });

      test("an address range, over events whose address is empty without failing the read", async () => {
        expect(
          await usersLeft([
            exception({
              entityType: SecurityEntityType.IpAddress,
              value: "10.20.0.0/16",
            }),
          ]),
        ).toEqual({ ...EVERYONE, alice: 7 });
      });

      test("an IPv6 range reads IPv4 and empty addresses as outside it", async () => {
        expect(
          await usersLeft([
            exception({
              entityType: SecurityEntityType.IpAddress,
              value: "fe80::/10",
            }),
          ]),
        ).toEqual(EVERYONE);
      });

      test("a typed field's value, whatever the case", async () => {
        expect(
          await usersLeft([
            {
              kind: DetectionRuleExceptionKind.Value,
              fieldName: "processName",
              value: "backup.EXE",
            },
          ]),
        ).toEqual(without("Carol"));
      });

      test("an attribute's value, by a pattern", async () => {
        expect(
          await usersLeft([
            {
              kind: DetectionRuleExceptionKind.Value,
              fieldName: "http.user_agent",
              value: "nessus/*",
            },
          ]),
        ).toEqual(without(""));
      });

      test("a value among the observables", async () => {
        expect(
          await usersLeft([
            exception({
              entityType: SecurityEntityType.Host,
              value: "scanner-7",
            }),
          ]),
        ).toEqual(without(""));
      });

      test("a time window: every event from its start up to its end", async () => {
        expect(
          await usersLeft([
            {
              kind: DetectionRuleExceptionKind.TimeWindow,
              startsAt: new Date(BASE.getTime() + 40 * MINUTE),
              endsAt: new Date(BASE.getTime() + 60 * MINUTE),
            },
          ]),
        ).toEqual(without("", "svc-backup", "svc-deploy"));
      });

      test("several exceptions: an event any of them names is skipped", async () => {
        const match: Statement | null = buildDetectionRuleExceptionsMatch([
          exception({ value: "bob" }),
          exception({ value: "svc-*" }),
        ]);

        expect(match).not.toBeNull();
        expect(
          await usersLeft([
            exception({ value: "bob" }),
            exception({ value: "svc-*" }),
          ]),
        ).toEqual(without("bob", "svc-backup", "svc-deploy"));
      });
    });

    test("a rule's cidr reads events with no address without failing", async () => {
      const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
        `title: Internal sign-in failures
detection:
  selection:
    statusName: Failure
    principalIp|cidr: 10.20.0.0/16
  condition: selection`,
      );

      if (definition.kind !== "single") {
        throw new Error("expected a single rule");
      }

      const groups: Array<DetectionMatchGroup> =
        await SecurityEventService.findDetectionMatches({
          projectId,
          startTime: BASE,
          endTime: NOW,
          whereFragment: SigmaClickhouseCompiler.compile(definition.rule),
          groupByExpression: SQL`principalUser`,
          distinctCountExpression: null,
          minMatchCount: 1,
          maxGroups: 10,
        });

      expect(
        groups.map((group: DetectionMatchGroup): string => {
          return `${group.groupValue}:${group.matchCount}`;
        }),
      ).toEqual(["alice:4"]);
    });

    describe("a retrohunt", () => {
      function stubExceptions(rows: Array<DetectionRuleException>): void {
        jest
          .spyOn(DetectionRuleExceptionService, "findAllBy")
          .mockResolvedValue(rows as never);
      }

      async function retrohunt(
        rule: Partial<{
          groupByField: string;
          distinctCountField: string;
          matchCountThreshold: number;
          evaluationIntervalInMinutes: number;
          sigmaRuleYaml: string;
        }> = {},
      ): Promise<DetectionRetrohuntResult> {
        return DetectionRuleRetrohunt.run({
          projectId,
          rule: {
            id: RULE_ID,
            sigmaRuleYaml: FAILED_SIGN_IN_YAML,
            groupByField: "principalUser",
            matchCountThreshold: 3,
            evaluationIntervalInMinutes: 5,
            ...rule,
          },
          periodInHours: 24,
          serviceFilter: {},
          now: NOW,
        });
      }

      test("fires a group in each window its count reaches the threshold", async () => {
        stubExceptions([]);

        const result: DetectionRetrohuntResult = await retrohunt();

        // alice twice, Carol, svc-backup, svc-deploy and the '' group once each.
        expect(result.firedCount).toBe(6);
        expect(result.groupCount).toBe(5);
        // Every event behind a firing: alice 4 + 5, and 3 for each other.
        expect(result.eventCount).toBe(21);
        // Every match, firing or not: bob's 2 and alice's lone 2 too.
        expect(result.matchedEventCount).toBe(25);
        expect(result.skippedEventCount).toBe(0);
        expect(result.preventedFiredCount).toBe(0);
        expect(result.hasMoreGroups).toBe(false);

        const alice: DetectionRetrohuntResult["groups"][number] =
          result.groups[0]!;

        expect(alice.value).toBe("alice");
        expect(alice.entityType).toBe(SecurityEntityType.User);
        expect(alice.firedCount).toBe(2);
        expect(alice.eventCount).toBe(9);
        expect(alice.firstFiredAt).toEqual(BASE);
        expect(alice.lastFiredAt).toEqual(
          new Date(BASE.getTime() + 20 * MINUTE),
        );
        // The latest window's sample.
        expect(alice.sampleMessage).toBe("alice again");

        expect(
          result.groups.map((group: { value: string }): string => {
            return group.value;
          }),
        ).not.toContain("bob");
      });

      test("a threshold out of reach fires nothing, and still says how many events matched", async () => {
        stubExceptions([]);

        const result: DetectionRetrohuntResult = await retrohunt({
          matchCountThreshold: 50,
        });

        expect(result.firedCount).toBe(0);
        expect(result.groups).toEqual([]);
        expect(result.matchedEventCount).toBe(25);
        expect(result.threshold).toBe(50);
      });

      test("a longer interval counts across the bursts", async () => {
        stubExceptions([]);

        const result: DetectionRetrohuntResult = await retrohunt({
          evaluationIntervalInMinutes: 60,
          matchCountThreshold: 10,
        });

        // Only alice reaches 10 in one hour.
        expect(result.firedCount).toBe(1);
        expect(result.groups[0]!.value).toBe("alice");
        expect(result.groups[0]!.eventCount).toBe(11);
      });

      test("its exceptions skip events, and say which firings they prevented", async () => {
        stubExceptions([
          savedException({ value: "carol" }),
          savedException({ value: "svc-*" }),
        ]);

        const result: DetectionRetrohuntResult = await retrohunt();

        expect(result.exceptionCount).toBe(2);
        expect(result.firedCount).toBe(3);
        expect(result.skippedEventCount).toBe(9);
        expect(result.preventedFiredCount).toBe(3);
        expect(result.matchedEventCount).toBe(16);
        expect(
          result.groups
            .map((group: { value: string }): string => {
              return group.value;
            })
            .sort(),
        ).toEqual(["", "alice"]);
      });

      test("a distinct count counts different values, empty ones left out", async () => {
        stubExceptions([]);

        const result: DetectionRetrohuntResult = await retrohunt({
          groupByField: "",
          distinctCountField: "principalUser",
          matchCountThreshold: 2,
          evaluationIntervalInMinutes: 60,
        });

        // One group, every match: 6 users in the hour ('' not counted).
        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]!.value).toBe("");
        expect(result.firedCount).toBe(1);
        expect(result.eventCount).toBe(25);
      });

      test("a correlation is read with the exceptions in every read", async () => {
        stubExceptions([savedException({ value: "alice" })]);

        const result: DetectionRetrohuntResult = await retrohunt({
          sigmaRuleYaml: `title: Bursts
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalUser]
  timespan: 5m
  condition:
    gte: 3
---
title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    statusName: Failure
  condition: selection`,
        });

        expect(result.isCorrelation).toBe(true);
        expect(
          result.groups
            .map((group: { value: string }): string => {
              return group.value;
            })
            .sort(),
        ).toEqual(["Carol", "svc-backup", "svc-deploy"]);
      });
    });
  },
);

describe("Detection rule exceptions ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
