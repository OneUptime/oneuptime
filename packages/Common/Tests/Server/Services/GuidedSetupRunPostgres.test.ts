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
import GuidedSetupRunService, {
  GuidedSetupRunCaller,
} from "../../../Server/Services/GuidedSetupRunService";
import OlderRowsPurge from "../../../Server/Utils/Retention/OlderRowsPurge";
import {
  GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS,
  GuidedSetupKey,
  GuidedSetupResourceStatus,
  GuidedSetupRunChange,
  GuidedSetupRunState,
} from "../../../Types/GuidedSetup/GuidedSetupRun";
import ObjectID from "../../../Types/ObjectID";
import { DataSource, Logger } from "typeorm";

/*
 * A GUIDED SETUP'S RUN AGAINST A MIGRATED POSTGRES (#7253).
 *
 * GuidedSetupRun keeps one person's pass through one guided setup in one
 * project (1809187025300-AddGuidedSetupRun). The route tests
 * (GuidedSetupRunAPI.test.ts) fake the service; what only a database shows
 * is that its SQL holds: a run is made by its first change and read back on
 * another device, devices saving at once all keep what they saved in one
 * row, a step tried again replaces its failure, one person's run is never
 * another's, starting afresh forgets everything, and the daily purge takes
 * a run nobody changed for 30 days - and that the migration made the table
 * as the model says, removed with its project and its person.
 *
 * Opt in with RUN_POSTGRES_GUIDED_SETUP_RUN_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_GUIDED_SETUP_RUN_TESTS=true \
 *   GUIDED_SETUP_RUN_TEST_DATABASE_HOST=127.0.0.1 \
 *   GUIDED_SETUP_RUN_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/GuidedSetupRunPostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped, so the Common test job - whose
 * Postgres is not migrated - never runs it.
 *
 * The migrated public table is only inspected. Behaviour runs in a uniquely
 * named schema holding a structure-only clone of it (LIKE ... INCLUDING ALL,
 * which copies the unique index but no foreign key), dropped afterwards;
 * every row is synthetic. The production GuidedSetupRunService runs
 * unchanged, and every statement Postgres rejects fails the test.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_GUIDED_SETUP_RUN_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "GuidedSetupRun";

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

interface StoredRun {
  projectId: string;
  userId: string;
  setup: string;
  revision: number;
}

const change: (
  values?: GuidedSetupRunChange["values"],
  resources?: GuidedSetupRunChange["resources"],
) => GuidedSetupRunChange = (
  values: GuidedSetupRunChange["values"] = {},
  resources: GuidedSetupRunChange["resources"] = {},
): GuidedSetupRunChange => {
  return { values: values, resources: resources };
};

describePostgres("GuidedSetupRun against a migrated Postgres", () => {
  const schema: string = `guided_setup_run_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;

  const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();

  const acme: ObjectID = ObjectID.generate();
  const globex: ObjectID = ObjectID.generate();
  const ana: ObjectID = ObjectID.generate();
  const bo: ObjectID = ObjectID.generate();
  const monitorId: string = ObjectID.generate().toString();
  const policyId: string = ObjectID.generate().toString();

  const anasWebsiteRun: GuidedSetupRunCaller = {
    projectId: acme,
    userId: ana,
    setup: GuidedSetupKey.WebsiteDown,
  };

  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["GUIDED_SETUP_RUN_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["GUIDED_SETUP_RUN_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["GUIDED_SETUP_RUN_TEST_DATABASE_NAME"] ||
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
      .spyOn(GuidedSetupRunService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(GuidedSetupRunService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    // Every statement Postgres refused fails the test.
    expect(failedQueries.failures).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function stored(): Promise<Array<StoredRun>> {
    return (await database.query(
      `SELECT "projectId", "userId", "setup", "revision"
           FROM "${schema}"."${TABLE}"
          ORDER BY "createdAt" ASC`,
    )) as Array<StoredRun>;
  }

  test("the migrated table: its columns, one run per project, person and setup, and gone with its project or its person", async () => {
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
    expect(byName["userId"]).toEqual({ nullable: "NO", type: "uuid" });
    expect(byName["setup"]).toEqual({
      nullable: "NO",
      type: "character varying",
    });
    expect(byName["values"]).toEqual({ nullable: "YES", type: "jsonb" });
    expect(byName["resources"]).toEqual({ nullable: "YES", type: "jsonb" });
    expect(byName["revision"]).toEqual({ nullable: "NO", type: "integer" });

    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
      [TABLE],
    );

    expect(
      indexes.some((index: { indexdef: string }): boolean => {
        return (
          index.indexdef.includes("UNIQUE") &&
          index.indexdef.includes('("projectId", "userId", setup)')
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
            WHERE n.nspname = 'public' AND t.relname = $1 AND c.contype = 'f'
            ORDER BY r.relname`,
        [TABLE],
      );

    // "c": ON DELETE CASCADE - gone with its project, and with its person.
    expect(foreignKeys).toEqual([
      { referenced: "Project", onDelete: "c" },
      { referenced: "User", onDelete: "c" },
    ]);
  });

  test("no run yet reads as none, and makes no row", async () => {
    expect(await GuidedSetupRunService.getRun(anasWebsiteRun)).toBeNull();
    expect(await stored()).toEqual([]);
  });

  test("the first change makes the run, and another device reads it back as it was saved", async () => {
    const saved: GuidedSetupRunState | null =
      await GuidedSetupRunService.changeRun(
        anasWebsiteRun,
        change(
          { monitorId: monitorId, address: "https://acme.example" },
          {
            monitor: {
              status: GuidedSetupResourceStatus.Created,
              recordId: monitorId,
              name: "acme.example",
            },
          },
        ),
      );

    expect(saved?.revision).toBe(1);
    expect(saved?.values).toEqual({
      monitorId: monitorId,
      address: "https://acme.example",
    });

    // Ana's phone, a private window, or this laptop after a reload.
    const resumed: GuidedSetupRunState | null =
      await GuidedSetupRunService.getRun({ ...anasWebsiteRun });

    expect(resumed).toEqual(saved);
    expect(resumed?.resources["monitor"]).toMatchObject({
      status: GuidedSetupResourceStatus.Created,
      recordId: monitorId,
      name: "acme.example",
    });
    expect(Number.isNaN(Date.parse(resumed!.updatedAt))).toBe(false);
    expect(await stored()).toHaveLength(1);
  });

  test("when a resource changed is the server's clock", async () => {
    const before: number = Date.now() - 1000;

    const saved: GuidedSetupRunState | null =
      await GuidedSetupRunService.changeRun(
        anasWebsiteRun,
        change(
          {},
          {
            monitor: { status: GuidedSetupResourceStatus.Creating },
          },
        ),
      );

    const at: number = Date.parse(saved!.resources["monitor"]!.at);

    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("a laptop and a phone that save different steps both keep theirs", async () => {
    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change({ monitorId: monitorId }),
    );
    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change({ policyId: policyId }),
    );
    const latest: GuidedSetupRunState | null =
      await GuidedSetupRunService.changeRun(
        anasWebsiteRun,
        change({ testSkipped: true }),
      );

    expect(latest?.values).toEqual({
      monitorId: monitorId,
      policyId: policyId,
      testSkipped: true,
    });
    expect(latest?.revision).toBe(3);
  });

  test("devices saving at the same moment wait for each other: every change is kept, in one row", async () => {
    const names: Array<string> = Array.from(
      { length: 12 },
      (_: unknown, index: number): string => {
        return `step${index}`;
      },
    );

    await Promise.all(
      names.map((name: string): Promise<GuidedSetupRunState | null> => {
        return GuidedSetupRunService.changeRun(
          anasWebsiteRun,
          change({ [name]: true }),
        );
      }),
    );

    const run: GuidedSetupRunState | null =
      await GuidedSetupRunService.getRun(anasWebsiteRun);

    expect(Object.keys(run!.values).sort()).toEqual([...names].sort());
    expect(run?.revision).toBe(names.length);
    expect(await stored()).toHaveLength(1);
  });

  test("a step tried again replaces its failure: one entry for the record, never a second", async () => {
    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change(
        {},
        {
          monitor: { status: GuidedSetupResourceStatus.Creating },
        },
      ),
    );
    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change(
        {},
        {
          monitor: {
            status: GuidedSetupResourceStatus.Failed,
            error: "OneUptime could not be reached.",
          },
        },
      ),
    );

    const failed: GuidedSetupRunState | null =
      await GuidedSetupRunService.getRun(anasWebsiteRun);

    expect(failed?.resources["monitor"]).toMatchObject({
      status: GuidedSetupResourceStatus.Failed,
      error: "OneUptime could not be reached.",
    });

    const retried: GuidedSetupRunState | null =
      await GuidedSetupRunService.changeRun(
        anasWebsiteRun,
        change(
          { monitorId: monitorId },
          {
            monitor: {
              status: GuidedSetupResourceStatus.Created,
              recordId: monitorId,
            },
          },
        ),
      );

    expect(Object.keys(retried!.resources)).toEqual(["monitor"]);
    expect(retried?.resources["monitor"]).toMatchObject({
      status: GuidedSetupResourceStatus.Created,
      recordId: monitorId,
    });
    expect(retried?.resources["monitor"]).not.toHaveProperty("error");
    expect(retried?.values).toEqual({ monitorId: monitorId });
    expect(await stored()).toHaveLength(1);
  });

  test("one person's run is never another's: by person, by project and by setup", async () => {
    const bosRun: GuidedSetupRunCaller = {
      projectId: acme,
      userId: bo,
      setup: GuidedSetupKey.WebsiteDown,
    };
    const anasRunInGlobex: GuidedSetupRunCaller = {
      projectId: globex,
      userId: ana,
      setup: GuidedSetupKey.WebsiteDown,
    };
    const anasOnCallRun: GuidedSetupRunCaller = {
      projectId: acme,
      userId: ana,
      setup: GuidedSetupKey.OnCall,
    };

    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change({ monitorId: monitorId }),
    );

    expect(await GuidedSetupRunService.getRun(bosRun)).toBeNull();
    expect(await GuidedSetupRunService.getRun(anasRunInGlobex)).toBeNull();
    expect(await GuidedSetupRunService.getRun(anasOnCallRun)).toBeNull();

    await GuidedSetupRunService.changeRun(
      bosRun,
      change({ policyId: policyId }),
    );
    await GuidedSetupRunService.changeRun(
      anasOnCallRun,
      change({ reachConfirmed: true }),
    );

    expect(
      (await GuidedSetupRunService.getRun(anasWebsiteRun))?.values,
    ).toEqual({ monitorId: monitorId });
    expect((await GuidedSetupRunService.getRun(bosRun))?.values).toEqual({
      policyId: policyId,
    });
    expect((await GuidedSetupRunService.getRun(anasOnCallRun))?.values).toEqual(
      { reachConfirmed: true },
    );

    // Bo starting afresh leaves Ana's runs as they are.
    await GuidedSetupRunService.forgetRun(bosRun);

    expect(await GuidedSetupRunService.getRun(bosRun)).toBeNull();
    expect(
      (await GuidedSetupRunService.getRun(anasWebsiteRun))?.values,
    ).toEqual({ monitorId: monitorId });
    expect(await stored()).toHaveLength(2);
  });

  test("starting afresh deletes the run, and the next one starts from nothing", async () => {
    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change({ monitorId: monitorId, testSkipped: true }),
    );

    await GuidedSetupRunService.forgetRun(anasWebsiteRun);

    expect(await stored()).toEqual([]);
    expect(await GuidedSetupRunService.getRun(anasWebsiteRun)).toBeNull();

    const fresh: GuidedSetupRunState | null =
      await GuidedSetupRunService.changeRun(
        anasWebsiteRun,
        change({ address: "https://globex.example" }),
      );

    expect(fresh?.values).toEqual({ address: "https://globex.example" });
    expect(fresh?.revision).toBe(1);
  });

  test("a change that leaves nothing in the run deletes it", async () => {
    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change({ monitorId: monitorId }),
    );

    expect(
      await GuidedSetupRunService.changeRun(
        anasWebsiteRun,
        change({ monitorId: null }),
      ),
    ).toBeNull();
    expect(await stored()).toEqual([]);
  });

  test("a change that names nothing makes nothing", async () => {
    expect(
      await GuidedSetupRunService.changeRun(anasWebsiteRun, change()),
    ).toBeNull();
    expect(await stored()).toEqual([]);
  });

  test("a run deleted but not yet purged reads as none, and a change starts afresh from it", async () => {
    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change({ monitorId: monitorId }),
    );
    await database.query(
      `UPDATE "${schema}"."${TABLE}" SET "deletedAt" = now()`,
    );

    expect(await GuidedSetupRunService.getRun(anasWebsiteRun)).toBeNull();

    const fresh: GuidedSetupRunState | null =
      await GuidedSetupRunService.changeRun(
        anasWebsiteRun,
        change({ testSkipped: true }),
      );

    expect(fresh?.values).toEqual({ testSkipped: true });
    expect(fresh?.revision).toBe(1);
    expect(await GuidedSetupRunService.getRun(anasWebsiteRun)).toEqual(fresh);
  });

  test("the daily purge deletes a run nobody changed for 30 days, and keeps the rest", async () => {
    const abandoned: GuidedSetupRunCaller = {
      projectId: acme,
      userId: bo,
      setup: GuidedSetupKey.StatusPage,
    };
    const quiet: GuidedSetupRunCaller = {
      projectId: acme,
      userId: bo,
      setup: GuidedSetupKey.Telemetry,
    };

    await GuidedSetupRunService.changeRun(
      anasWebsiteRun,
      change({ monitorId: monitorId }),
    );
    await GuidedSetupRunService.changeRun(
      abandoned,
      change({ statusPageId: monitorId }),
    );
    await GuidedSetupRunService.changeRun(
      quiet,
      change({ serviceId: policyId }),
    );

    await database.query(
      `UPDATE "${schema}"."${TABLE}" SET "updatedAt" = now() - interval '31 days' WHERE "setup" = 'status_page'`,
    );
    await database.query(
      `UPDATE "${schema}"."${TABLE}" SET "updatedAt" = now() - interval '29 days' WHERE "setup" = 'telemetry'`,
    );

    expect(OlderRowsPurge.isPurged(GuidedSetupRunService)).toBe(true);
    expect(GuidedSetupRunService.hardDeleteItemByColumnName).toBe("updatedAt");
    expect(GuidedSetupRunService.hardDeleteItemsOlderThanDays).toBe(
      GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS,
    );

    expect(await OlderRowsPurge.purgeBatch(GuidedSetupRunService)).toBe(1);

    expect(await GuidedSetupRunService.getRun(abandoned)).toBeNull();
    expect((await GuidedSetupRunService.getRun(quiet))?.values).toEqual({
      serviceId: policyId,
    });
    expect(
      (await GuidedSetupRunService.getRun(anasWebsiteRun))?.values,
    ).toEqual({ monitorId: monitorId });

    // A change brings a quiet run back to life: its 30 days start again.
    await GuidedSetupRunService.changeRun(
      quiet,
      change({ alertSkipped: true }),
    );

    const rows: Array<{ updatedAt: Date }> = await database.query(
      `SELECT "updatedAt" FROM "${schema}"."${TABLE}" WHERE "setup" = 'telemetry'`,
    );

    expect(Date.now() - new Date(rows[0]!.updatedAt).getTime()).toBeLessThan(
      60 * 1000,
    );
  });
});
