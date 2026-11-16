import Entities from "../../../../Models/DatabaseModels/Index";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Redis from "../../../../Server/Infrastructure/Redis";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import WorkflowListeners, {
  WORKFLOW_LISTENER_TRIGGERS_SQL,
} from "../../../../Server/Utils/Workflow/WorkflowListeners";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger, QueryRunner } from "typeorm";

/*
 * WHICH TRIGGERS A PROJECT'S WORKFLOWS LISTEN TO, READ FROM A REAL POSTGRES
 * (issue #8861).
 *
 * A write posts its workflow trigger only when an enabled workflow of its
 * project that is not archived listens to it (WorkflowListeners). Here the
 * read of those triggers runs against a copy of the migrated Workflow
 * table, and is held to what the workflow service's handler reads when a
 * trigger is posted (OnTriggerBaseModel.initTrigger, through
 * WorkflowService.findBy): for every trigger of every project seeded, a
 * write is told a workflow listens exactly when that read finds one. And it
 * counts the statements: one read for a project's first write, none for the
 * writes after it.
 *
 * Redis is held in memory (WorkflowListenersValkey runs it on Valkey). Opt
 * in with RUN_POSTGRES_WORKFLOW_LISTENER_TESTS=true and a migrated database
 * (WORKFLOW_LISTENER_TEST_DATABASE_HOST, _PORT, _NAME; DATABASE_USERNAME,
 * DATABASE_PASSWORD). Every write is to a schema of its own; only the
 * table's structure is copied, never its rows.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WORKFLOW_LISTENER_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../../Server/Utils/Logger", () => {
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

const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/i;

// Every statement the DataSource runs while counting is on.
class StatementLog implements Logger {
  public statements: Array<string> = [];
  public isCounting: boolean = false;

  public logQuery(
    query: string,
    _parameters?: Array<unknown>,
    _queryRunner?: QueryRunner,
  ): void {
    if (this.isCounting && !TRANSACTION_CONTROL.test(query)) {
      this.statements.push(query);
    }
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();

const TRIGGERS: Array<string> = [
  "incident-on-create",
  "incident-on-update",
  "incident-on-create-or-update",
  "monitor-on-create",
  "alert-on-create",
  "alert-on-delete",
];

describePostgres(
  "which triggers a project's workflows listen to, against Postgres",
  () => {
    const schema: string = `workflow_listener_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const statementLog: StatementLog = new StatementLog();
    const redis: Map<string, string> = new Map<string, string>();
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["WORKFLOW_LISTENER_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["WORKFLOW_LISTENER_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WORKFLOW_LISTENER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["query"],
        logger: statementLog,
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."Workflow" (LIKE public."Workflow" INCLUDING ALL)`,
      );

      // A row names only what the read reads; keys stay NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'Workflow'
         AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."Workflow" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Redis, held in memory.
      jest.spyOn(Redis, "getClient").mockReturnValue({} as never);
      jest.spyOn(Redis, "isConnected").mockReturnValue(true);
      jest
        .spyOn(GlobalCache, "getStrings")
        .mockImplementation(async (namespace: string, keys: Array<string>) => {
          return keys.map((key: string): string | null => {
            return redis.get(`${namespace}-${key}`) ?? null;
          });
        });
      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (namespace: string, key: string) => {
          return redis.get(`${namespace}-${key}`) ?? null;
        });
      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            redis.set(`${namespace}-${key}`, value);
          },
        );
      jest
        .spyOn(GlobalCache, "setStringIfNotExists")
        .mockImplementation(
          async (namespace: string, key: string, value: string) => {
            if (redis.has(`${namespace}-${key}`)) {
              return false;
            }

            redis.set(`${namespace}-${key}`, value);
            return true;
          },
        );
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      statementLog.isCounting = false;
      statementLog.statements = [];
      redis.clear();
      WorkflowListeners.clear();
      await database.query(`DELETE FROM "${schema}"."Workflow"`);
    });

    async function seed(data: {
      project: ObjectID;
      triggerId: string | null;
      isEnabled: boolean;
      isArchived?: boolean | undefined;
      isDeleted?: boolean | undefined;
    }): Promise<void> {
      const now: Date = new Date();

      await database.query(
        `INSERT INTO "${schema}"."Workflow" ("_id", "projectId", "name", "slug", "triggerId", "isEnabled", "isArchived", "deletedAt", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $8, 1)`,
        [
          ObjectID.generate().toString(),
          data.project.toString(),
          `workflow-${ObjectID.generate().toString()}`,
          data.triggerId,
          data.isEnabled,
          data.isArchived ?? false,
          data.isDeleted ? now : null,
          now,
        ],
      );
    }

    async function seedEveryKind(): Promise<void> {
      // Heard: enabled, not archived - two of one trigger, read once.
      await seed({
        project: PROJECT,
        triggerId: "incident-on-create",
        isEnabled: true,
      });
      await seed({
        project: PROJECT,
        triggerId: "incident-on-create",
        isEnabled: true,
      });
      await seed({
        project: PROJECT,
        triggerId: "incident-on-create-or-update",
        isEnabled: true,
      });
      // Not heard: turned off, archived, deleted, with no trigger.
      await seed({
        project: PROJECT,
        triggerId: "incident-on-update",
        isEnabled: false,
      });
      await seed({
        project: PROJECT,
        triggerId: "monitor-on-create",
        isEnabled: true,
        isArchived: true,
      });
      await seed({
        project: PROJECT,
        triggerId: "alert-on-create",
        isEnabled: true,
        isDeleted: true,
      });
      await seed({ project: PROJECT, triggerId: null, isEnabled: true });
      // Another project's.
      await seed({
        project: OTHER_PROJECT,
        triggerId: "alert-on-delete",
        isEnabled: true,
      });
    }

    test("reads the triggers of the project's enabled workflows that are not archived nor deleted, and no other", async () => {
      await seedEveryKind();

      expect(
        Array.from((await WorkflowListeners.getTriggerIds(PROJECT))!).sort(),
      ).toEqual(["incident-on-create", "incident-on-create-or-update"]);
      expect(
        Array.from((await WorkflowListeners.getTriggerIds(OTHER_PROJECT))!),
      ).toEqual(["alert-on-delete"]);
    });

    test("a write is told a workflow listens exactly when the workflow service's handler finds one", async () => {
      await seedEveryKind();

      for (const project of [PROJECT, OTHER_PROJECT]) {
        for (const triggerId of TRIGGERS) {
          // What OnTriggerBaseModel.initTrigger reads when a trigger is posted.
          const found: Array<Workflow> = await WorkflowService.findBy({
            query: {
              triggerId: QueryHelper.any([triggerId]),
              projectId: project,
              isEnabled: true,
              isArchived: false,
            },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
            select: { _id: true },
          });

          expect([
            project.toString(),
            triggerId,
            await WorkflowListeners.isAnyListening({
              projectId: project,
              triggerIds: [triggerId],
            }),
          ]).toEqual([project.toString(), triggerId, found.length > 0]);
        }
      }
    });

    test("a project's first write reads its workflows in one statement; the writes after it read none", async () => {
      await seedEveryKind();

      statementLog.isCounting = true;

      for (let write: number = 0; write < 20; write++) {
        await WorkflowListeners.isAnyListening({
          projectId: PROJECT,
          triggerIds: ["incident-on-update", "incident-on-create-or-update"],
        });
      }

      statementLog.isCounting = false;

      expect(statementLog.statements).toEqual([WORKFLOW_LISTENER_TRIGGERS_SQL]);
    });

    test("a workflow turned on is heard by the next write, once its project's workflows are said to have changed", async () => {
      await seed({
        project: PROJECT,
        triggerId: "monitor-on-create",
        isEnabled: false,
      });

      expect(
        await WorkflowListeners.isAnyListening({
          projectId: PROJECT,
          triggerIds: ["monitor-on-create"],
        }),
      ).toBe(false);

      await database.query(
        `UPDATE "${schema}"."Workflow" SET "isEnabled" = true WHERE "projectId" = $1`,
        [PROJECT.toString()],
      );
      await WorkflowListeners.changed([PROJECT]);

      expect(
        await WorkflowListeners.isAnyListening({
          projectId: PROJECT,
          triggerIds: ["monitor-on-create"],
        }),
      ).toBe(true);
    });
  },
);
