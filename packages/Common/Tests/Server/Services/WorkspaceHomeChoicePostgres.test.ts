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

jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import WorkspaceHomeChoiceService from "../../../Server/Services/WorkspaceHomeChoiceService";
import WorkspaceHomeProject from "../../../Server/Utils/Workspace/WorkspaceHomeProject";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { DataSource, Logger } from "typeorm";

/*
 * WHICH PROJECT A SLACK OR TEAMS HOME OPENS ON, AGAINST A MIGRATED POSTGRES.
 *
 * WorkspaceHomeChoice keeps the project somebody last chose in their Home's
 * Switch project menu (1808891613000-AddWorkspaceHomeChoice). The unit tests
 * (WorkspaceHomeProject.test.ts) fake every read and write; what only a
 * database shows is that the service's SQL holds: a choice written again
 * stays one row, two choices of one project at once leave one row and throw
 * nothing (the unique index, and the create's own check), the newest choice
 * is read first among the projects asked about, the chats and accounts are
 * kept apart - and that the migration made the table as the model says,
 * removed with its project.
 *
 * Opt in with RUN_POSTGRES_WORKSPACE_HOME_CHOICE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_WORKSPACE_HOME_CHOICE_TESTS=true \
 *   WORKSPACE_HOME_CHOICE_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKSPACE_HOME_CHOICE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/WorkspaceHomeChoicePostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped, so the Common test job - whose
 * Postgres is not migrated - never runs it.
 *
 * The migrated public table is only inspected. Behaviour runs in a uniquely
 * named schema holding a structure-only clone of it (LIKE ... INCLUDING ALL,
 * which copies the unique index), dropped afterwards; every row is
 * synthetic. The production WorkspaceHomeChoiceService runs unchanged. Every
 * statement Postgres rejects is recorded, and fails the test - but the one
 * the unique index refuses while two choices race, which the service means
 * to meet.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WORKSPACE_HOME_CHOICE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "WorkspaceHomeChoice";
const UNIQUE_INDEX_VIOLATION: string = "duplicate key value";

class FailedQueryRecorder implements Logger {
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

interface StoredChoice {
  projectId: string;
  workspaceType: string;
  workspaceUserId: string;
  chosenAt: Date;
}

describePostgres("WorkspaceHomeChoice against a migrated Postgres", () => {
  const schema: string = `workspace_home_choice_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;

  const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();

  const platform: ObjectID = ObjectID.generate();
  const nonProd: ObjectID = ObjectID.generate();
  const sandbox: ObjectID = ObjectID.generate();
  const deaneSlack: string = "U0DEANE";
  const deaneTeams: string = "00000000-0000-4000-8000-00000000dea1";

  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["WORKSPACE_HOME_CHOICE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["WORKSPACE_HOME_CHOICE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["WORKSPACE_HOME_CHOICE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: ["error"],
      logger: failedQueries,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    failedQueries.failures = [];

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(WorkspaceHomeChoiceService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WorkspaceHomeChoiceService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    // A failed statement fails the test - but a race the index settles.
    expect(
      failedQueries.failures.filter((failure: string): boolean => {
        return !failure.includes(UNIQUE_INDEX_VIOLATION);
      }),
    ).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function stored(): Promise<Array<StoredChoice>> {
    return (await database.query(
      `SELECT "projectId", "workspaceType", "workspaceUserId", "chosenAt"
           FROM "${schema}"."${TABLE}"
          ORDER BY "chosenAt" ASC`,
    )) as Array<StoredChoice>;
  }

  test("the migrated table: the columns, the unique index, and the foreign key that removes it with its project", async () => {
    const columns: Array<{
      column_name: string;
      is_nullable: string;
      data_type: string;
    }> = await database.query(
      `SELECT column_name, is_nullable, data_type
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY column_name`,
      [TABLE],
    );

    const byName: Record<string, { nullable: string; type: string }> = {};

    for (const column of columns) {
      byName[column.column_name] = {
        nullable: column.is_nullable,
        type: column.data_type,
      };
    }

    expect(byName["projectId"]).toEqual({ nullable: "NO", type: "uuid" });
    expect(byName["workspaceType"]?.nullable).toBe("NO");
    expect(byName["workspaceUserId"]?.nullable).toBe("NO");
    expect(byName["chosenAt"]).toEqual({
      nullable: "NO",
      type: "timestamp with time zone",
    });

    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
      [TABLE],
    );

    expect(
      indexes.some((index: { indexdef: string }): boolean => {
        return (
          index.indexdef.includes("UNIQUE") &&
          index.indexdef.includes(
            '("projectId", "workspaceType", "workspaceUserId")',
          )
        );
      }),
    ).toBe(true);

    const foreignKeys: Array<{ referenced: string; onDelete: string }> =
      await database.query(
        `SELECT r.relname AS "referenced", c.confdeltype AS "onDelete"
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_class r ON r.oid = c.confrelid
            WHERE n.nspname = 'public' AND t.relname = $1 AND c.contype = 'f'`,
        [TABLE],
      );

    // "c": ON DELETE CASCADE - gone with its project.
    expect(foreignKeys).toEqual([{ referenced: "Project", onDelete: "c" }]);
  });

  test("a choice made: one row; the same project chosen again writes its time again - still one row", async () => {
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: nonProd,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: deaneSlack,
      at: new Date("2026-11-01T09:00:00.000Z"),
    });
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: nonProd,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: deaneSlack,
      at: new Date("2026-11-03T09:00:00.000Z"),
    });

    const rows: Array<StoredChoice> = await stored();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.projectId).toBe(nonProd.toString());
    expect(new Date(rows[0]!.chosenAt).toISOString()).toBe(
      "2026-11-03T09:00:00.000Z",
    );
  });

  test("the newest choice is read, among the projects asked about - one chosen later but not asked about is not", async () => {
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: platform,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: deaneSlack,
      at: new Date("2026-11-01T09:00:00.000Z"),
    });
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: nonProd,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: deaneSlack,
      at: new Date("2026-11-02T09:00:00.000Z"),
    });
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: sandbox,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: deaneSlack,
      at: new Date("2026-11-03T09:00:00.000Z"),
    });

    expect(
      (
        await WorkspaceHomeChoiceService.findLastChosenProject({
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: deaneSlack,
          projectIds: [platform, nonProd, sandbox],
        })
      )?.toString(),
    ).toBe(sandbox.toString());

    // No longer one of his projects: the newest of those that are.
    expect(
      (
        await WorkspaceHomeChoiceService.findLastChosenProject({
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: deaneSlack,
          projectIds: [platform, nonProd],
        })
      )?.toString(),
    ).toBe(nonProd.toString());

    // Switching back to IRM Platform makes it the newest.
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: platform,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: deaneSlack,
      at: new Date("2026-11-04T09:00:00.000Z"),
    });

    expect(
      (
        await WorkspaceHomeProject.getChosenProject({
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: deaneSlack,
          memberProjectIds: [platform, nonProd, sandbox],
        })
      )?.toString(),
    ).toBe(platform.toString());
    expect(await stored()).toHaveLength(3);
  });

  test("each chat, and each account, keeps its own: Slack's choice is not Teams', nor another person's", async () => {
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: nonProd,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: deaneSlack,
    });
    await WorkspaceHomeChoiceService.recordChoice({
      projectId: sandbox,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: deaneTeams,
    });

    expect(
      (
        await WorkspaceHomeChoiceService.findLastChosenProject({
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: deaneTeams,
          projectIds: [platform, nonProd, sandbox],
        })
      )?.toString(),
    ).toBe(sandbox.toString());
    expect(
      await WorkspaceHomeChoiceService.findLastChosenProject({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: deaneSlack,
        projectIds: [platform, nonProd, sandbox],
      }),
    ).toBeNull();
    expect(
      await WorkspaceHomeChoiceService.findLastChosenProject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "U0NITIN",
        projectIds: [platform, nonProd, sandbox],
      }),
    ).toBeNull();
  });

  test("two choices of one project at once: one row, and neither throws", async () => {
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        await WorkspaceHomeChoiceService.recordChoice({
          projectId: nonProd,
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: deaneTeams,
        });
      }),
    );

    expect(await stored()).toHaveLength(1);
  });
});
