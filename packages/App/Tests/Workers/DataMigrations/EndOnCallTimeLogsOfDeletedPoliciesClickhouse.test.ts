import EndOnCallTimeLogsOfDeletedPolicies, {
  AuditLogPolicyDeletions,
  DeletedPolicy,
  getPolicyKey,
} from "../../../FeatureSet/Workers/DataMigrations/EndOnCallTimeLogsOfDeletedPolicies";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { JSONObject } from "Common/Types/JSON";
import type { SpyInstance } from "jest-mock";
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
 * When the audit log says each on-call policy was deleted, read against a
 * real ClickHouse server (#11023).
 *
 * EndOnCallTimeLogsOfDeletedPolicies ends a deleted policy's time logs when
 * the audit log's Delete entry for it says it was deleted. Its unit and
 * Postgres suites stand that read in; this one runs it, through
 * AuditLogService, under both analyzers:
 *
 *   - each asked policy's Delete entries, in its own project, every one,
 *     earliest first - not its Create or Update entries, not a Delete of
 *     one of its escalation rules (whose root is the policy), not another
 *     policy's, and another project's entry for the same id kept apart;
 *   - asked about nothing, it reads nothing;
 *   - the install has the audit log's table, and an install without it is
 *     told apart.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18126:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *     npx jest Tests/Workers/DataMigrations/EndOnCallTimeLogsOfDeletedPoliciesClickhouse.test.ts
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

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `end_on_call_time_logs_test_${process.pid}_${Date.now()}`;

const PROJECT: string = "11023000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT: string = "11023000-0000-4000-8000-0000000000a2";

const DELETED_ONCE: string = "11023000-0000-4000-8000-0000000000b1";
const DELETED_TWICE: string = "11023000-0000-4000-8000-0000000000b2";
const DELETED_ELSEWHERE: string = "11023000-0000-4000-8000-0000000000b3";
const NEVER_DELETED: string = "11023000-0000-4000-8000-0000000000b4";
const NOT_ASKED: string = "11023000-0000-4000-8000-0000000000b5";
const RULE_OF_DELETED_ONCE: string = "11023000-0000-4000-8000-0000000000c1";

// Whole seconds: the audit log keeps an entry's time to the second.
const T0: number = Date.UTC(2026, 4, 1) / 1000;

function at(seconds: number): Date {
  return new Date(seconds * 1000);
}

let entries: number = 0;

/*
 * An entry as the recorder writes one, at a time of the test's choosing
 * (the service would stamp it with now): the columns the read looks at,
 * the rest left to their defaults.
 */
function entry(data: {
  projectId: string;
  resourceType: string;
  resourceId: string;
  action: AuditLogAction;
  createdAt: number;
  rootResourceId?: string;
}): JSONObject {
  entries++;

  return {
    _id: `11023000-0000-4000-8000-${entries.toString().padStart(12, "0")}`,
    // Seconds since 1970: no time zone to read them in.
    createdAt: data.createdAt,
    projectId: data.projectId,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    rootResourceType: "On-Call Policy",
    rootResourceId: data.rootResourceId || data.resourceId,
    action: data.action,
    // Kept well past the test: the table's TTL deletes by it.
    retentionDate: T0 + 10 * 365 * 24 * 60 * 60,
  };
}

const ENTRIES: Array<JSONObject> = [
  // Created, changed, then deleted: the deletion alone counts.
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy",
    resourceId: DELETED_ONCE,
    action: AuditLogAction.Create,
    createdAt: T0,
  }),
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy",
    resourceId: DELETED_ONCE,
    action: AuditLogAction.Update,
    createdAt: T0 + 3600,
  }),
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy",
    resourceId: DELETED_ONCE,
    action: AuditLogAction.Delete,
    createdAt: T0 + 86400,
  }),
  // One of its escalation rules, deleted first: the rule's entry, not the policy's.
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy Escalation Rule",
    resourceId: RULE_OF_DELETED_ONCE,
    rootResourceId: DELETED_ONCE,
    action: AuditLogAction.Delete,
    createdAt: T0 + 7200,
  }),
  // Deleted twice (a restore between): both, earliest first.
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy",
    resourceId: DELETED_TWICE,
    action: AuditLogAction.Delete,
    createdAt: T0 + 5 * 86400,
  }),
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy",
    resourceId: DELETED_TWICE,
    action: AuditLogAction.Delete,
    createdAt: T0 + 2 * 86400,
  }),
  // Deleted in the other project; an entry about the same id here is kept apart.
  entry({
    projectId: OTHER_PROJECT,
    resourceType: "On-Call Policy",
    resourceId: DELETED_ELSEWHERE,
    action: AuditLogAction.Delete,
    createdAt: T0 + 3 * 86400,
  }),
  entry({
    projectId: OTHER_PROJECT,
    resourceType: "On-Call Policy",
    resourceId: DELETED_ONCE,
    action: AuditLogAction.Delete,
    createdAt: T0 + 9 * 86400,
  }),
  // Changed, never deleted.
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy",
    resourceId: NEVER_DELETED,
    action: AuditLogAction.Update,
    createdAt: T0 + 4 * 86400,
  }),
  // Deleted, but not asked about.
  entry({
    projectId: PROJECT,
    resourceType: "On-Call Policy",
    resourceId: NOT_ASKED,
    action: AuditLogAction.Delete,
    createdAt: T0 + 6 * 86400,
  }),
];

const ASKED: Array<DeletedPolicy> = [
  { projectId: PROJECT, policyId: DELETED_ONCE },
  { projectId: PROJECT, policyId: DELETED_TWICE },
  { projectId: OTHER_PROJECT, policyId: DELETED_ELSEWHERE },
  { projectId: PROJECT, policyId: NEVER_DELETED },
];

interface Connection {
  database: ClickhouseDatabase;
  client: ClickhouseClient;
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
}

integration(
  "when the audit log says each on-call policy was deleted, against ClickHouse",
  () => {
    const connections: Array<Connection> = [];
    let original: ServiceConnection | undefined;

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

      const clickhouse: ClickhouseDatabase = new ClickhouseDatabase(options);
      const client: ClickhouseClient = await clickhouse.connect(options);

      connections.push({ database: clickhouse, client });

      // The older analyzer, by whichever name this server gives its setting.
      const settings: { json: () => Promise<{ data?: Array<JSONObject> }> } =
        (await client.query({
          query:
            "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
          format: "JSON",
        })) as unknown as {
          json: () => Promise<{ data?: Array<JSONObject> }>;
        };
      const setting: string = String(
        (await settings.json()).data?.[0]?.["name"] || "enable_analyzer",
      );

      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting]: 0 } as ClickHouseSettings,
      };
      const older: ClickhouseDatabase = new ClickhouseDatabase(olderOptions);

      connections.push({
        database: older,
        client: await older.connect(olderOptions),
      });

      const model: AuditLog = new AuditLog();
      const columns: Statement = new StatementGenerator<AuditLog>({
        modelType: AuditLog,
        database: clickhouse,
      }).toColumnsCreateStatement(model.tableColumns);

      await client.command({
        query: `CREATE DATABASE IF NOT EXISTS ${database}`,
      });

      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) TTL ${model.ttlExpression} SETTINGS ${model.tableSettings}`,
        query_params: columns.query_params,
      });

      await client.insert({
        table: `${database}.${model.tableName}`,
        format: "JSONEachRow",
        values: ENTRIES,
      });

      original = {
        database: AuditLogService.database,
        databaseClient: AuditLogService.databaseClient,
      };
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(AuditLogService, original);
      }

      if (connections[0]) {
        await connections[0].client.command({
          query: `DROP DATABASE IF EXISTS ${database}`,
        });
      }

      for (const connection of connections) {
        await connection.database.disconnect();
      }
    });

    describe.each([
      ["the current analyzer", 0],
      ["the older analyzer (enable_analyzer = 0)", 1],
    ])("through %s", (_name: string, position: number) => {
      beforeAll((): void => {
        const connection: Connection = connections[position]!;

        AuditLogService.database = connection.database;
        AuditLogService.databaseClient = connection.client;
      });

      test("reads the audit log's table by the database AuditLogService reads", async () => {
        expect(EndOnCallTimeLogsOfDeletedPolicies.getAuditLogTable()).toBe(
          `${database}.AuditLogV2`,
        );
        expect(await AuditLogPolicyDeletions.hasAuditLog()).toBe(true);
      });

      test("each asked policy's Delete entries in its own project, every one, earliest first - and nothing else", async () => {
        const deletions: Map<
          string,
          Array<Date>
        > = await AuditLogPolicyDeletions.readDeletions(ASKED);

        expect(
          deletions.get(
            getPolicyKey({ projectId: PROJECT, policyId: DELETED_ONCE }),
          ),
        ).toEqual([at(T0 + 86400)]);
        expect(
          deletions.get(
            getPolicyKey({ projectId: PROJECT, policyId: DELETED_TWICE }),
          ),
        ).toEqual([at(T0 + 2 * 86400), at(T0 + 5 * 86400)]);
        expect(
          deletions.get(
            getPolicyKey({
              projectId: OTHER_PROJECT,
              policyId: DELETED_ELSEWHERE,
            }),
          ),
        ).toEqual([at(T0 + 3 * 86400)]);

        // Never deleted, not asked, a rule's entry: nothing.
        expect(
          deletions.get(
            getPolicyKey({ projectId: PROJECT, policyId: NEVER_DELETED }),
          ),
        ).toBeUndefined();
        expect(
          deletions.get(
            getPolicyKey({ projectId: PROJECT, policyId: NOT_ASKED }),
          ),
        ).toBeUndefined();
        expect(
          deletions.get(
            getPolicyKey({
              projectId: PROJECT,
              policyId: RULE_OF_DELETED_ONCE,
            }),
          ),
        ).toBeUndefined();

        // The other project's entry for DELETED_ONCE is that project's, read apart.
        expect(
          deletions.get(
            getPolicyKey({ projectId: OTHER_PROJECT, policyId: DELETED_ONCE }),
          ),
        ).toEqual([at(T0 + 9 * 86400)]);
        expect(deletions.size).toBe(4);
      });

      test("asked about nothing, it reads nothing", async () => {
        const reads: SpyInstance<typeof AuditLogService.executeQuery> = jest
          .spyOn(AuditLogService, "executeQuery")
          .mockRejectedValue(new Error("not to be read"));

        try {
          expect((await AuditLogPolicyDeletions.readDeletions([])).size).toBe(
            0,
          );
          expect(reads).not.toHaveBeenCalled();
        } finally {
          reads.mockRestore();
        }
      });
    });

    test("an install without the audit log's table is told apart", async () => {
      const connection: Connection = connections[0]!;

      AuditLogService.database = connection.database;
      AuditLogService.databaseClient = connection.client;

      await connection.client.command({
        query: `DROP TABLE ${database}.${new AuditLog().tableName}`,
      });

      expect(await AuditLogPolicyDeletions.hasAuditLog()).toBe(false);
    });
  },
);

describe("When the audit log says a policy was deleted: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
