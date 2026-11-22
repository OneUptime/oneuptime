import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { buildMassDeleteStatement } from "Common/Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import { TelemetryWindowRead } from "Common/Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanTypes";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import UserType from "Common/Types/UserType";
import { WorkflowRunAs } from "Common/Types/Workflow/WorkflowRunAs";
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
 * Security Events' mass delete read against a real ClickHouse server
 * (#10430).
 *
 * The read summed the audit log's deletes by userId and apiKeyId alone. A
 * workflow's step acts as no person and no key, and neither does
 * OneUptime's own bookkeeping, so every workflow's deletes in a window, and
 * OneUptime's own, were one actor with no id: two workflows deleting 15
 * records each read as "Someone deleted 30 records", a High case. Common's
 * suites pin the statement and the events; this one shows what ClickHouse
 * sums - each workflow apart, named as its latest entry names it, with what
 * it ran as; OneUptime's own apart again; a person and a key as before -
 * under both analyzers, and what the scan of a window makes of it.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18126:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *     npx jest Tests/Telemetry/AuditLogMassDeleteClickhouse.test.ts
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

import AuditLogService, {
  AuditLogService as AuditLogStore,
} from "Common/Server/Services/AuditLogService";
import AuditLogSecurityScan from "Common/Server/Utils/SecurityEvent/TelemetryScan/AuditLogSecurityScan";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `audit_log_mass_delete_test_${process.pid}_${Date.now()}`;

const PROJECT: ObjectID = new ObjectID("10430000-0000-4000-8000-0000000000a1");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "10430000-0000-4000-8000-0000000000a2",
);

const NIGHTLY: ObjectID = new ObjectID("10430000-0000-4000-8000-0000000000b1");
const ARCHIVER: ObjectID = new ObjectID("10430000-0000-4000-8000-0000000000b2");
const PURGE: ObjectID = new ObjectID("10430000-0000-4000-8000-0000000000b3");
const MALLORY: ObjectID = new ObjectID("10430000-0000-4000-8000-0000000000c1");
const TERRAFORM: ObjectID = new ObjectID(
  "10430000-0000-4000-8000-0000000000c2",
);
const JANE: ObjectID = new ObjectID("10430000-0000-4000-8000-0000000000c3");

const NOW: number = Date.now();
const ARRIVED_AFTER: Date = new Date(NOW - 10 * 60 * 1000);
const ARRIVED_UNTIL: Date = new Date(NOW + 10 * 60 * 1000);

type Actor = (entry: AuditLog) => void;

function workflow(data: {
  id: ObjectID;
  name: string;
  runAs?: WorkflowRunAs;
  givenBy?: string;
}): Actor {
  return (entry: AuditLog): void => {
    entry.userType = UserType.Workflow;
    entry.workflowId = data.id;
    entry.workflowName = data.name;
    entry.workflowRunAs = data.runAs || WorkflowRunAs.Default;

    if (data.givenBy) {
      entry.workflowRunAsGiverUserId = JANE;
      entry.workflowRunAsGiverName = data.givenBy;
    }
  };
}

const ONEUPTIME: Actor = (entry: AuditLog): void => {
  entry.userType = "System";
};

const MALLORY_ACTOR: Actor = (entry: AuditLog): void => {
  entry.userType = UserType.User;
  entry.userId = MALLORY;
  entry.userName = "Mallory";
  entry.userEmail = "mallory@example.com";
};

const TERRAFORM_ACTOR: Actor = (entry: AuditLog): void => {
  entry.userType = UserType.API;
  entry.apiKeyId = TERRAFORM;
  entry.apiKeyName = "terraform";
};

function entries(data: {
  count: number;
  actor: Actor;
  projectId?: ObjectID;
  action?: AuditLogAction;
  resourceType?: string;
}): Array<AuditLog> {
  return Array.from({ length: data.count }, (): AuditLog => {
    const entry: AuditLog = new AuditLog();
    entry.id = ObjectID.generate();
    entry.projectId = data.projectId || PROJECT;
    entry.action = data.action || AuditLogAction.Delete;
    entry.resourceType = data.resourceType || "Incident";
    entry.resourceId = ObjectID.generate();
    entry.resourceName = "Old incident";
    entry.changes = [];
    entry.retentionDate = new Date(NOW + 30 * 24 * 60 * 60 * 1000);
    data.actor(entry);
    return entry;
  });
}

const ALL: Array<AuditLog> = [
  // Two workflows, 15 deletes each: two actors, neither past the threshold.
  ...entries({
    count: 15,
    actor: workflow({
      id: NIGHTLY,
      name: "Nightly Cleanup",
      runAs: WorkflowRunAs.ProjectOwner,
      givenBy: "Jane Doe",
    }),
  }),
  ...entries({
    count: 15,
    actor: workflow({ id: ARCHIVER, name: "Archive Old Incidents" }),
  }),
  // One workflow past it, and the same workflow's updates, which are no deletes.
  ...entries({ count: 30, actor: workflow({ id: PURGE, name: "Purge" }) }),
  ...entries({
    count: 20,
    actor: workflow({ id: PURGE, name: "Purge" }),
    action: AuditLogAction.Update,
  }),
  // OneUptime's own bookkeeping, with system events stored.
  ...entries({ count: 40, actor: ONEUPTIME, resourceType: "Team Member" }),
  // A person past it, and a key under it.
  ...entries({ count: 26, actor: MALLORY_ACTOR }),
  ...entries({ count: 10, actor: TERRAFORM_ACTOR }),
  // Another project's workflow: never this project's.
  ...entries({
    count: 30,
    actor: workflow({ id: NIGHTLY, name: "Nightly Cleanup" }),
    projectId: OTHER_PROJECT,
  }),
];

interface Connection {
  name: string;
  database: ClickhouseDatabase;
  client: ClickhouseClient;
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

async function countEntries(client: ClickhouseClient): Promise<number> {
  const result: { json: () => Promise<{ data?: Array<JSONObject> }> } =
    (await client.query({
      query: `SELECT count() AS count FROM ${database}.${new AuditLog().tableName}`,
      format: "JSON",
    })) as unknown as { json: () => Promise<{ data?: Array<JSONObject> }> };

  return Number((await result.json()).data?.[0]?.["count"]);
}

// The actors the read sums, at any number of deletes, as a reader keeps them.
async function readActors(): Promise<Array<JSONObject>> {
  const statement: Statement = buildMassDeleteStatement({
    projectId: PROJECT,
    arrivedAfter: ARRIVED_AFTER,
    arrivedUntil: ARRIVED_UNTIL,
    minDeletes: 1,
    limit: 20,
  });
  const result: { json: () => Promise<{ data?: Array<JSONObject> }> } =
    (await AuditLogService.executeQuery(statement)) as unknown as {
      json: () => Promise<{ data?: Array<JSONObject> }>;
    };

  return ((await result.json()).data || []).map(
    (row: JSONObject): JSONObject => {
      return {
        type: row["actorUserType"],
        workflow: row["actorWorkflowName"] || null,
        runAs: row["actorWorkflowRunAs"] || null,
        givenBy: row["actorWorkflowRunAsGivenBy"] || null,
        email: row["actorUserEmail"] || null,
        key: row["actorApiKeyName"] || null,
        deletes: Number(row["deletes"]),
      };
    },
  );
}

function signalOf(event: NormalizedSecurityEvent): string {
  return String(event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE] ?? "");
}

integration("Security Events' mass delete read against ClickHouse", () => {
  const connections: Array<Connection> = [];
  let original: ServiceConnection | undefined;
  const originalDatabaseName: string | undefined =
    process.env["CLICKHOUSE_DATABASE"];

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

    connections.push({
      name: "the current analyzer",
      database: clickhouse,
      client,
    });

    // The older analyzer, by whichever name this server gives its setting.
    const settings: { json: () => Promise<{ data?: Array<JSONObject> }> } =
      (await client.query({
        query:
          "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
        format: "JSON",
      })) as unknown as { json: () => Promise<{ data?: Array<JSONObject> }> };
    const setting: string = String(
      (await settings.json()).data?.[0]?.["name"] || "enable_analyzer",
    );

    const olderOptions: ClickHouseClientConfigOptions = {
      ...options,
      clickhouse_settings: { [setting]: 0 } as ClickHouseSettings,
    };
    const older: ClickhouseDatabase = new ClickhouseDatabase(olderOptions);

    connections.push({
      name: "the older analyzer",
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

    original = {
      database: AuditLogService.database,
      databaseClient: AuditLogService.databaseClient,
      ingestDatabase: AuditLogService.ingestDatabase,
      ingestDatabaseClient: AuditLogService.ingestDatabaseClient,
    };

    AuditLogService.database = clickhouse;
    AuditLogService.databaseClient = client;
    AuditLogService.ingestDatabase = clickhouse;
    AuditLogService.ingestDatabaseClient = client;

    // The scan names its tables by the configured database.
    process.env["CLICKHOUSE_DATABASE"] = database;

    /*
     * As the recorder writes them: root, through the service - one built on
     * the test database, since a service's inserts name the database it was
     * built with. The scan reads through the default one, pointed here.
     */
    await new AuditLogStore(clickhouse).createMany({
      items: ALL,
      props: { isRoot: true },
    });

    for (let attempt: number = 0; attempt < 120; attempt++) {
      if ((await countEntries(client)) === ALL.length) {
        return;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 250);
      });
    }

    throw new Error("The fixture's entries never all became readable.");
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(AuditLogService, original);
    }

    if (originalDatabaseName === undefined) {
      delete process.env["CLICKHOUSE_DATABASE"];
    } else {
      process.env["CLICKHOUSE_DATABASE"] = originalDatabaseName;
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

    test("sums each workflow apart, named with what it ran as, OneUptime's own apart, and a person and a key as before", async () => {
      const actors: Array<JSONObject> = await readActors();

      // Most deletes first; the two workflows of 15 tie, so are read apart below.
      expect(
        actors.filter((row: JSONObject): boolean => {
          return row["deletes"] !== 15;
        }),
      ).toEqual([
        {
          type: "System",
          workflow: null,
          runAs: null,
          givenBy: null,
          email: null,
          key: null,
          deletes: 40,
        },
        {
          type: "Workflow",
          workflow: "Purge",
          runAs: "Default",
          givenBy: null,
          email: null,
          key: null,
          deletes: 30,
        },
        {
          type: "User",
          workflow: null,
          runAs: null,
          givenBy: null,
          email: "mallory@example.com",
          key: null,
          deletes: 26,
        },
        {
          type: "API",
          workflow: null,
          runAs: null,
          givenBy: null,
          email: null,
          key: "terraform",
          deletes: 10,
        },
      ]);

      // Two workflows of 15 are two actors, each named - never one of 30.
      expect(
        actors
          .filter((row: JSONObject): boolean => {
            return row["deletes"] === 15;
          })
          .map((row: JSONObject): string => {
            return `${row["type"]}: ${row["workflow"]} (${row["runAs"]}, ${row["givenBy"] || "nobody"})`;
          })
          .sort(),
      ).toEqual([
        "Workflow: Archive Old Incidents (Default, nobody)",
        "Workflow: Nightly Cleanup (ProjectOwner, Jane Doe)",
      ]);
    });

    test("the scan makes a named High event per actor past the threshold, OneUptime's Informational, and none for the two workflows of 15", async () => {
      const read: TelemetryWindowRead = await AuditLogSecurityScan.readWindow({
        window: {
          projectId: PROJECT,
          arrivedAfter: ARRIVED_AFTER,
          arrivedUntil: ARRIVED_UNTIL,
          happenedAfter: new Date(NOW - 24 * 60 * 60 * 1000),
        },
        offset: 0,
        pageSize: 1000,
      });

      const massDeletes: Array<NormalizedSecurityEvent> = read.events.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return (
            signalOf(event) === SecurityTelemetrySignal.MassDelete ||
            signalOf(event) === SecurityTelemetrySignal.OneUptimeMassDelete
          );
        },
      );

      expect(
        massDeletes.map((event: NormalizedSecurityEvent): JSONObject => {
          return {
            signal: signalOf(event),
            severity: event.severityName,
            principal: event.principalUser,
            message: event.message.replace(/ in \d+ minutes?/, ""),
          };
        }),
      ).toEqual([
        {
          signal: SecurityTelemetrySignal.OneUptimeMassDelete,
          severity: OcsfSeverity.Informational,
          principal: "oneuptime",
          message:
            "OneUptime deleted 40 records (Team Member): its own work, such as a scheduled cleanup, a SCIM sync or what another delete took with it",
        },
        {
          signal: SecurityTelemetrySignal.MassDelete,
          severity: OcsfSeverity.High,
          principal: `workflow:${PURGE.toString()}`,
          message: 'The workflow "Purge" deleted 30 records (Incident)',
        },
        {
          signal: SecurityTelemetrySignal.MassDelete,
          severity: OcsfSeverity.High,
          principal: "mallory@example.com",
          message: "mallory@example.com deleted 26 records (Incident)",
        },
      ]);
    });
  });
});

describe("Security Events' mass delete read: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
