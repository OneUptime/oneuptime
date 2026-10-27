import Entities from "../../../Models/DatabaseModels/Index";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Redis from "../../../Server/Infrastructure/Redis";
import WorkflowLabelRuleEngineService from "../../../Server/Services/WorkflowLabelRuleEngineService";
import WorkflowOwnerRuleEngineService from "../../../Server/Services/WorkflowOwnerRuleEngineService";
import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../../Server/Services/WorkflowService";
import { ExecuteWorkflowType } from "../../../Server/Types/Workflow/TriggerCode";
import Encryption from "../../../Server/Utils/Encryption";
import HuntressConnectionsToWorkflows, {
  HuntressMoveSummary,
  LegacyQuery,
  LegacyTablesDropSummary,
} from "../../../Server/Utils/Huntress/HuntressConnectionsToWorkflows";
import HuntressWebhookHandler, {
  HuntressWebhookAnswer,
} from "../../../Server/Utils/Huntress/HuntressWebhookHandler";
import StandardWebhookSignature from "../../../Server/Utils/Webhook/StandardWebhookSignature";
import ObjectID from "../../../Types/ObjectID";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  HuntressTriggerEvent,
  HuntressTriggerSetting,
  HuntressTriggerValue,
} from "../../../Types/Workflow/HuntressTrigger";
import {
  HUNTRESS_REPORT_ID_CUSTOM_FIELD,
  HUNTRESS_TEMPLATE_OPTIONS,
  buildHuntressIncidentWorkflowGraph,
} from "../../../Types/Workflow/Templates";
import API from "../../../Utils/API";
import { getHuntressIncidentReportBody } from "../../Types/Huntress/HuntressWebhookFixtures";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import { DataSource, Logger } from "typeorm";

/*
 * Huntress workflows against a migrated Postgres.
 *
 * Opt in with RUN_POSTGRES_HUNTRESS_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_HUNTRESS_TESTS=true \
 *   HUNTRESS_TEST_DATABASE_HOST=127.0.0.1 HUNTRESS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/HuntressPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test Huntress
 * workflows and the move of Huntress connections on migrated Postgres"),
 * right after that job has applied every registered migration to an empty
 * database.
 *
 * Why a real Postgres. The signing secret is only as private as what is
 * written to the Workflow row, and the webhook reads that row by its key
 * and writes what each request did to it, without touching the row's
 * Updated At. And every Huntress connection made before becomes a workflow
 * by statements written against the legacy tables the migrations made
 * ("HuntressConnection", its join tables, "HuntressIncidentReport") and
 * Incident's custom fields (jsonb): a column renamed or a cast wrong only
 * fails on a real driver. Then the moved workflow answers at the
 * connection's address, signed with the connection's secret.
 *
 * The tables are cloned structure-only (LIKE ... INCLUDING ALL: columns,
 * defaults, indexes, no foreign keys) into a uniquely named schema that is
 * dropped afterwards. The workflow service, the workflow rules and Valkey,
 * the only side effects outside Postgres, are stubbed.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_HUNTRESS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Workflow",
  "Incident",
  "HuntressConnection",
  "HuntressConnectionOnCallDutyPolicy",
  "HuntressConnectionLabel",
  "HuntressIncidentReport",
];

class QueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

function svixSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64")}`;
}

function signedHeaders(
  body: string,
  secret: string,
  messageId: string = "msg_1",
): Record<string, string> {
  const timestamp: string = String(Math.floor(Date.now() / 1000));

  return {
    "content-type": "application/json",
    "svix-id": messageId,
    "svix-timestamp": timestamp,
    "svix-signature": StandardWebhookSignature.sign({
      secret,
      messageId,
      timestamp,
      body,
    }),
  };
}

interface StoredWorkflowRow {
  webhookSecretKey: string | null;
  webhookSigningSecret: string | null;
  isWebhookSigningSecretSet: boolean;
  isEnabled: boolean;
  triggerId: string | null;
  triggerArguments: Record<string, unknown> | null;
  lastWebhookRequestAt: Date | null;
  lastWebhookError: string | null;
  lastWebhookErrorAt: Date | null;
  updatedAt: Date;
  name: string;
}

describePostgres("Huntress workflows against a migrated Postgres", () => {
  const schema: string = `huntress_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectA: ObjectID = ObjectID.generate();
  const recorder: QueryRecorder = new QueryRecorder();
  const cache: Set<string> = new Set<string>();
  let database: DataSource;

  const legacyQuery: () => LegacyQuery = (): LegacyQuery => {
    return async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      return await database.query(sql, parameters);
    };
  };

  async function storedRow(id: string): Promise<StoredWorkflowRow> {
    const rows: Array<StoredWorkflowRow> = await database.query(
      `SELECT "webhookSecretKey", "webhookSigningSecret", "isWebhookSigningSecretSet", "isEnabled", "triggerId", "triggerArguments", "lastWebhookRequestAt", "lastWebhookError", "lastWebhookErrorAt", "updatedAt", "name" FROM "${schema}"."Workflow" WHERE "_id" = $1`,
      [id],
    );

    return rows[0]!;
  }

  async function createHuntressWorkflow(data: {
    name: string;
    secret?: string | undefined;
  }): Promise<Workflow> {
    const workflow: Workflow = new Workflow();
    workflow.projectId = projectA;
    workflow.name = data.name;
    workflow.isEnabled = true;
    workflow.graph = buildHuntressIncidentWorkflowGraph(
      HUNTRESS_TEMPLATE_OPTIONS,
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    if (data.secret) {
      workflow.webhookSigningSecret = data.secret;
    }

    return await WorkflowService.create({
      data: workflow,
      props: { isRoot: true },
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["HUNTRESS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["HUNTRESS_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["HUNTRESS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logger: recorder,
      extra: { options: `-c search_path=${schema},public` },
    });

    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    jest
      .spyOn(WorkflowService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WorkflowService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);

    // The workflow service is told of every saved workflow: not here.
    jest.spyOn(API, "post").mockResolvedValue({} as never);
    jest
      .spyOn(WorkflowLabelRuleEngineService, "applyRulesToWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WorkflowOwnerRuleEngineService, "applyRulesToWorkflow")
      .mockResolvedValue(undefined as never);

    // Valkey, for the deliveries already seen.
    jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    jest.spyOn(Redis, "getClient").mockImplementation((() => {
      return {
        set: async (key: string): Promise<string | null> => {
          if (cache.has(key)) {
            return null;
          }

          cache.add(key);
          return "OK";
        },
        del: async (key: string): Promise<number> => {
          return cache.delete(key) ? 1 : 0;
        },
      };
    }) as never);
  });

  beforeEach(async () => {
    recorder.failures = [];
    cache.clear();
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe("a workflow's signing secret", () => {
    test("is written encrypted, and read back as pasted only by the server", async () => {
      const secret: string = svixSecret();
      const created: Workflow = await createHuntressWorkflow({
        name: "Huntress",
        secret,
      });

      const row: StoredWorkflowRow = await storedRow(created.id!.toString());

      expect(row.isWebhookSigningSecretSet).toBe(true);
      expect(row.webhookSigningSecret).toBeTruthy();
      expect(row.webhookSigningSecret).not.toBe(secret);
      expect(row.webhookSigningSecret).not.toContain(
        secret.slice("whsec_".length),
      );

      const read: Workflow | null = await WorkflowService.findOneById({
        id: created.id!,
        select: { _id: true, webhookSigningSecret: true },
        props: { isRoot: true },
      });

      expect(read?.webhookSigningSecret).toBe(secret);
      expect(recorder.failures).toEqual([]);
    });

    test("a workflow saved without one says so, and its trigger is Huntress's", async () => {
      const created: Workflow = await createHuntressWorkflow({
        name: "Huntress",
      });

      const row: StoredWorkflowRow = await storedRow(created.id!.toString());

      expect(row.isWebhookSigningSecretSet).toBe(false);
      expect(row.webhookSigningSecret).toBeNull();
      expect(row.triggerId).toBe(ComponentID.HuntressIncidentReport);
      expect(row.webhookSecretKey).toBeTruthy();
    });

    test("a new secret replaces the old one and clears the refusal it fixed", async () => {
      const created: Workflow = await createHuntressWorkflow({
        name: "Huntress",
        secret: svixSecret(),
      });
      const id: string = created.id!.toString();

      await database.query(
        `UPDATE "${schema}"."Workflow" SET "lastWebhookError" = $1, "lastWebhookErrorAt" = now() WHERE "_id" = $2`,
        ["The request's signature does not match the signing secret.", id],
      );

      const before: StoredWorkflowRow = await storedRow(id);
      const replacement: string = svixSecret();

      await WorkflowService.updateOneById({
        id: created.id!,
        data: { webhookSigningSecret: replacement },
        props: { isRoot: true },
      });

      const after: StoredWorkflowRow = await storedRow(id);

      expect(after.webhookSigningSecret).not.toBe(before.webhookSigningSecret);
      expect(after.webhookSigningSecret).not.toBe(replacement);
      expect(after.isWebhookSigningSecretSet).toBe(true);
      expect(after.lastWebhookError).toBeNull();
      expect(after.lastWebhookErrorAt).toBeNull();

      const read: Workflow | null = await WorkflowService.findOneById({
        id: created.id!,
        select: { _id: true, webhookSigningSecret: true },
        props: { isRoot: true },
      });

      expect(read?.webhookSigningSecret).toBe(replacement);
      expect(recorder.failures).toEqual([]);
    });

    test("an edit without a secret keeps the saved one and the last refusal", async () => {
      const created: Workflow = await createHuntressWorkflow({
        name: "Huntress",
        secret: svixSecret(),
      });
      const id: string = created.id!.toString();

      await database.query(
        `UPDATE "${schema}"."Workflow" SET "lastWebhookError" = $1, "lastWebhookErrorAt" = now() WHERE "_id" = $2`,
        ["The request body is not valid JSON.", id],
      );

      const before: StoredWorkflowRow = await storedRow(id);

      await WorkflowService.updateOneById({
        id: created.id!,
        data: { description: "Pages the SOC.", webhookSigningSecret: "" },
        props: { isRoot: true },
      });

      const after: StoredWorkflowRow = await storedRow(id);

      expect(after.webhookSigningSecret).toBe(before.webhookSigningSecret);
      expect(after.lastWebhookError).toBe(
        "The request body is not valid JSON.",
      );
      expect(recorder.failures).toEqual([]);
    });

    test("one Huntress could not have issued is refused, and nothing is written", async () => {
      const created: Workflow = await createHuntressWorkflow({
        name: "Huntress",
        secret: svixSecret(),
      });
      const before: StoredWorkflowRow = await storedRow(created.id!.toString());

      await expect(
        WorkflowService.updateOneById({
          id: created.id!,
          data: { webhookSigningSecret: "https://example.com/not-a-secret" },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(WorkflowServiceClass.SIGNING_SECRET_PROBLEM);

      const after: StoredWorkflowRow = await storedRow(created.id!.toString());

      expect(after.webhookSigningSecret).toBe(before.webhookSigningSecret);
    });
  });

  describe("the webhook", () => {
    test("finds the workflow by its key, verifies with the stored secret, and keeps what the request did without touching Updated At", async () => {
      const secret: string = svixSecret();
      const created: Workflow = await createHuntressWorkflow({
        name: "Huntress",
        secret,
      });
      const id: string = created.id!.toString();
      const before: StoredWorkflowRow = await storedRow(id);
      const runs: Array<ExecuteWorkflowType> = [];
      const body: string = JSON.stringify(getHuntressIncidentReportBody());

      const answer: HuntressWebhookAnswer = await HuntressWebhookHandler.handle(
        {
          secretKey: before.webhookSecretKey!,
          headers: signedHeaders(body, secret),
          rawBody: body,
          executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
            runs.push(run);
          },
        },
      );

      expect(answer.statusCode).toBe(200);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.workflowId.toString()).toBe(id);

      const after: StoredWorkflowRow = await storedRow(id);

      expect(after.lastWebhookRequestAt).not.toBeNull();
      expect(after.lastWebhookError).toBeNull();
      expect(new Date(after.updatedAt).getTime()).toBe(
        new Date(before.updatedAt).getTime(),
      );
      expect(recorder.failures).toEqual([]);
    });

    test("writes why a request was refused", async () => {
      const created: Workflow = await createHuntressWorkflow({
        name: "Huntress",
      });
      const id: string = created.id!.toString();
      const row: StoredWorkflowRow = await storedRow(id);
      const body: string = JSON.stringify(getHuntressIncidentReportBody());

      const answer: HuntressWebhookAnswer = await HuntressWebhookHandler.handle(
        {
          secretKey: row.webhookSecretKey!,
          headers: signedHeaders(body, svixSecret()),
          rawBody: body,
          executeWorkflow: async (): Promise<void> => {},
        },
      );

      expect(answer.statusCode).toBe(401);

      const after: StoredWorkflowRow = await storedRow(id);

      expect(after.lastWebhookError).toBe(answer.body["message"]);
      expect(after.lastWebhookErrorAt).not.toBeNull();
    });
  });

  describe("the Huntress connections made before", () => {
    const connectionId: string = ObjectID.generate().toString();
    const policyId: string = ObjectID.generate().toString();
    const labelId: string = ObjectID.generate().toString();
    const criticalSeverityId: string = ObjectID.generate().toString();
    const incidentId: string = ObjectID.generate().toString();

    async function insertLegacy(secret: string): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."HuntressConnection" ("_id", "version", "projectId", "name", "signingSecret", "isSigningSecretSet", "pageOnCallFor", "criticalIncidentSeverityId", "watchedOrganizations", "resolveIncidentWhenReportCloses", "lastEventReceivedAt", "lastError", "lastErrorAt") VALUES ($1, 1, $2, 'Acme MSP', $3, true, 'critical', $4, $5, false, $6, NULL, NULL)`,
        [
          connectionId,
          projectA.toString(),
          await Encryption.encrypt(secret),
          criticalSeverityId,
          "Acme Corp\n4",
          new Date("2026-10-14T08:00:00.000Z"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."HuntressConnectionOnCallDutyPolicy" ("huntressConnectionId", "onCallDutyPolicyId") VALUES ($1, $2)`,
        [connectionId, policyId],
      );
      await database.query(
        `INSERT INTO "${schema}"."HuntressConnectionLabel" ("huntressConnectionId", "labelId") VALUES ($1, $2)`,
        [connectionId, labelId],
      );
      await database.query(
        `INSERT INTO "${schema}"."Incident" ("_id", "version", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "customFields") VALUES ($1, 1, $2, 'Huntress: Incident on DESKTOP-01 (Acme Corp)', 'huntress-incident', $3, $4, $5::jsonb)`,
        [
          incidentId,
          projectA.toString(),
          ObjectID.generate().toString(),
          criticalSeverityId,
          JSON.stringify({ region: "eu" }),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."HuntressIncidentReport" ("version", "projectId", "huntressConnectionId", "huntressAccountId", "huntressIncidentReportId", "incidentId", "outcome", "appliedMessageIds", "updatedAt") VALUES (1, $1, $2, '5', '1234', $3, 'IncidentOpened', $4::jsonb, now())`,
        [
          projectA.toString(),
          connectionId,
          incidentId,
          JSON.stringify(["msg_applied"]),
        ],
      );
    }

    test("each becomes the workflow that does what it did, answering at its address with its secret", async () => {
      const secret: string = svixSecret();
      await insertLegacy(secret);

      const summary: HuntressMoveSummary =
        await HuntressConnectionsToWorkflows.moveAll(legacyQuery());

      expect(summary).toEqual(
        expect.objectContaining({ moved: 1, failed: 0, incidentsLinked: 1 }),
      );
      expect(recorder.failures).toEqual([]);

      const row: StoredWorkflowRow = await storedRow(connectionId);

      expect(row.name).toBe("Acme MSP");
      expect(row.isEnabled).toBe(true);
      expect(row.webhookSecretKey).toBe(connectionId);
      expect(row.isWebhookSigningSecretSet).toBe(true);
      expect(row.webhookSigningSecret).not.toBe(secret);
      expect(row.triggerId).toBe(ComponentID.HuntressIncidentReport);
      expect(row.triggerArguments).toEqual({
        [HuntressTriggerSetting.Organizations]: "Acme Corp\n4",
        [HuntressTriggerSetting.CriticalIncidentSeverity]: criticalSeverityId,
      });
      expect(new Date(row.lastWebhookRequestAt!).toISOString()).toBe(
        "2026-10-14T08:00:00.000Z",
      );

      const incidents: Array<{ customFields: Record<string, unknown> }> =
        await database.query(
          `SELECT "customFields" FROM "${schema}"."Incident" WHERE "_id" = $1`,
          [incidentId],
        );

      expect(incidents[0]!.customFields).toEqual({
        region: "eu",
        [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: "1234",
      });

      // The delivery the connection applied is remembered for the workflow.
      expect(
        Array.from(cache).some((key: string): boolean => {
          return key.endsWith(`${connectionId}:msg_applied`);
        }),
      ).toBe(true);

      // Huntress, unchanged, reaches it: the connection's id, its secret.
      const runs: Array<ExecuteWorkflowType> = [];
      const body: string = JSON.stringify(getHuntressIncidentReportBody());

      const answer: HuntressWebhookAnswer = await HuntressWebhookHandler.handle(
        {
          secretKey: connectionId,
          headers: signedHeaders(body, secret, "msg_new"),
          rawBody: body,
          executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
            runs.push(run);
          },
        },
      );

      expect(answer.statusCode).toBe(200);
      expect(runs[0]!.returnValues[HuntressTriggerValue.Event]).toBe(
        HuntressTriggerEvent.Created,
      );

      // A delivery the connection already applied starts nothing.
      const retried: HuntressWebhookAnswer =
        await HuntressWebhookHandler.handle({
          secretKey: connectionId,
          headers: signedHeaders(body, secret, "msg_applied"),
          rawBody: body,
          executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
            runs.push(run);
          },
        });

      expect(retried.body["duplicate"]).toBe(true);
      expect(runs).toHaveLength(1);
    });

    test("run twice, it moves nothing twice and links nothing twice", async () => {
      await insertLegacy(svixSecret());

      await HuntressConnectionsToWorkflows.moveAll(legacyQuery());
      const again: HuntressMoveSummary =
        await HuntressConnectionsToWorkflows.moveAll(legacyQuery());

      expect(again).toEqual(
        expect.objectContaining({
          moved: 0,
          alreadyMoved: 1,
          failed: 0,
          incidentsLinked: 0,
        }),
      );

      const count: Array<{ count: string }> = await database.query(
        `SELECT count(*)::text AS "count" FROM "${schema}"."Workflow"`,
      );

      expect(count[0]!.count).toBe("1");
      expect(recorder.failures).toEqual([]);
    });

    test("a deleted connection is not moved", async () => {
      await insertLegacy(svixSecret());
      await database.query(
        `UPDATE "${schema}"."HuntressConnection" SET "deletedAt" = now() WHERE "_id" = $1`,
        [connectionId],
      );

      const summary: HuntressMoveSummary =
        await HuntressConnectionsToWorkflows.moveAll(legacyQuery());

      expect(summary.moved).toBe(0);
      expect(await storedRow(connectionId)).toBeUndefined();
    });

    /*
     * Once every connection in use has its workflow, the legacy tables go,
     * all four in one statement (the data migration
     * DropLegacyHuntressTables); a connection without one keeps them all.
     * Dropped here are this schema's clones - the search path finds them
     * first - which are made again after each test, from the migrated
     * tables, which are never touched.
     */
    describe("the legacy tables", () => {
      // The four the migrations made, named here rather than read from the code under test.
      const LEGACY_TABLE_NAMES: Array<string> = [
        "HuntressConnection",
        "HuntressConnectionLabel",
        "HuntressConnectionOnCallDutyPolicy",
        "HuntressIncidentReport",
      ];

      async function tablesLeft(tableSchema: string): Promise<Array<string>> {
        const rows: Array<{ table_name: string }> = await database.query(
          `SELECT "table_name" FROM information_schema.tables WHERE "table_schema" = $1 AND "table_name" = ANY($2::text[]) ORDER BY "table_name"`,
          [tableSchema, LEGACY_TABLE_NAMES],
        );

        return rows.map((row: { table_name: string }): string => {
          return row.table_name;
        });
      }

      afterEach(async () => {
        for (const table of LEGACY_TABLE_NAMES) {
          await database.query(
            `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
          );
        }
      });

      test("go, all four, once every connection in use has its workflow - a deleted one needs none", async () => {
        await insertLegacy(svixSecret());
        await HuntressConnectionsToWorkflows.moveAll(legacyQuery());

        // A connection deleted before the move, which made it no workflow.
        await database.query(
          `INSERT INTO "${schema}"."HuntressConnection" ("_id", "version", "projectId", "name", "deletedAt") VALUES ($1, 1, $2, 'Old MSP', now())`,
          [ObjectID.generate().toString(), projectA.toString()],
        );

        const summary: LegacyTablesDropSummary =
          await HuntressConnectionsToWorkflows.dropLegacyTables(legacyQuery());

        expect(summary).toEqual({ outcome: "dropped", unmoved: 0 });
        expect(await tablesLeft(schema)).toEqual([]);
        // The workflow, and the incident's report number, stay.
        expect((await storedRow(connectionId)).name).toBe("Acme MSP");
        // The migrated tables this schema was cloned from are not touched.
        expect(await tablesLeft("public")).toEqual(LEGACY_TABLE_NAMES);
        expect(recorder.failures).toEqual([]);
      });

      test("stay, all four, while a connection in use has no workflow - and say how many", async () => {
        await insertLegacy(svixSecret());

        const summary: LegacyTablesDropSummary =
          await HuntressConnectionsToWorkflows.dropLegacyTables(legacyQuery());

        expect(summary).toEqual({ outcome: "kept", unmoved: 1 });
        expect(await tablesLeft(schema)).toEqual(LEGACY_TABLE_NAMES);

        // What it was set up to do is all still there.
        const rows: Array<{ count: string }> = await database.query(
          `SELECT count(*)::text AS "count" FROM "${schema}"."HuntressConnectionOnCallDutyPolicy" WHERE "huntressConnectionId" = $1`,
          [connectionId],
        );

        expect(rows[0]!.count).toBe("1");
        expect(recorder.failures).toEqual([]);
      });

      test("a workflow deleted since keeps them too, and is not made again", async () => {
        await insertLegacy(svixSecret());
        await HuntressConnectionsToWorkflows.moveAll(legacyQuery());
        await database.query(
          `DELETE FROM "${schema}"."Workflow" WHERE "_id" = $1`,
          [connectionId],
        );

        const summary: LegacyTablesDropSummary =
          await HuntressConnectionsToWorkflows.dropLegacyTables(legacyQuery());

        expect(summary).toEqual({ outcome: "kept", unmoved: 1 });
        expect(await storedRow(connectionId)).toBeUndefined();
        expect(await tablesLeft(schema)).toEqual(LEGACY_TABLE_NAMES);
      });
    });
  });
});
