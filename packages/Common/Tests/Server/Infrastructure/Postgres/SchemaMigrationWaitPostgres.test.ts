import Database from "../../../../Server/Infrastructure/PostgresDatabase";
import SchemaMigrationRunner, {
  SchemaMigrationLockPolicy,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrationRunner";
import SchemaMigrationWait, {
  SchemaMigrationWaitPolicy,
  SchemaMigrationWaitTimeoutError,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrationWait";
import GracefulShutdown from "../../../../Server/Utils/GracefulShutdown";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
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
import { Client } from "pg";
import {
  DataSource,
  DataSourceOptions,
  MigrationInterface,
  QueryRunner,
} from "typeorm";

/*
 * A runtime process waiting for the schema migrations, on a real Postgres.
 *
 * What happened in 14.0.13: the async migrate Job was still adding
 * Monitor."isArchived" - its ALTER TABLE waiting for the locks a long
 * transaction held - when the new worker pods started, and every query they
 * ran on "Monitor" failed with `column ... does not exist` until the migration
 * committed.
 *
 * Here a runtime process (migrationsRun false) connects through
 * PostgresDatabase.connect() while "the migrate Job" (SchemaMigrationRunner)
 * applies two migrations, the second held back by a session that keeps its
 * table open, as that transaction did:
 *
 *  - on a new database the wait reads every migration as pending and creates
 *    nothing, where DataSource.showMigrations() would create the migrations
 *    table, racing the Job's own;
 *  - connect() returns only once the last migration has committed - not when
 *    the first one has - and the process can then run the query it needed;
 *  - when the migrations never come, connect() fails after the timeout and
 *    the process is not connected.
 *
 * Opt in with RUN_POSTGRES_SCHEMA_MIGRATION_WAIT_TESTS=true:
 *
 *   RUN_POSTGRES_SCHEMA_MIGRATION_WAIT_TESTS=true \
 *   SCHEMA_MIGRATION_WAIT_TEST_DATABASE_HOST=127.0.0.1 \
 *   SCHEMA_MIGRATION_WAIT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/SchemaMigrationWaitPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Everything it
 * creates lives in a uniquely named schema that is dropped afterwards; it
 * needs no migrated tables.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SCHEMA_MIGRATION_WAIT_TESTS"] === "true"
    ? describe
    : describe.skip;

const CONNECTION: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} = {
  host: process.env["SCHEMA_MIGRATION_WAIT_TEST_DATABASE_HOST"] || "localhost",
  port: Number(
    process.env["SCHEMA_MIGRATION_WAIT_TEST_DATABASE_PORT"] || "5400",
  ),
  user: process.env["DATABASE_USERNAME"] || "postgres",
  password: process.env["DATABASE_PASSWORD"] || "password",
  database:
    process.env["SCHEMA_MIGRATION_WAIT_TEST_DATABASE_NAME"] ||
    process.env["DATABASE_NAME"] ||
    "oneuptimedb",
};

/* The runtime's wait, scaled down: read every 100 ms. */
const WAIT_POLICY: SchemaMigrationWaitPolicy = {
  timeoutInMs: 30_000,
  pollIntervalInMs: 100,
  logIntervalInMs: 60_000,
};

/* The migrate Job's lock bound, scaled down likewise. */
const LOCK_POLICY: SchemaMigrationLockPolicy = {
  lockTimeoutInMs: 300,
  retryTimeoutInMs: 30_000,
  firstRetryDelayInMs: 100,
  maxRetryDelayInMs: 400,
};

type MigrationClass = new () => MigrationInterface;

function migration(
  name: string,
  up: (queryRunner: QueryRunner) => Promise<void>,
): MigrationClass {
  return class implements MigrationInterface {
    public name: string = name;
    public async up(queryRunner: QueryRunner): Promise<void> {
      await up(queryRunner);
    }
    public async down(): Promise<void> {
      return undefined;
    }
  } as MigrationClass;
}

/* Resolves once `condition` holds; fails the test if it does not in time. */
async function until(
  condition: () => boolean | Promise<boolean>,
  timeoutInMs: number = 20_000,
): Promise<void> {
  const startedAt: number = Date.now();
  while (!(await condition())) {
    if (Date.now() - startedAt > timeoutInMs) {
      throw new Error(`Condition not met within ${timeoutInMs} ms`);
    }
    await pause(50);
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

const CREATE_AUDIT: string = "CreateAudit1799100000001";
const ADD_IS_ARCHIVED: string = "AddIsArchivedToHot1799100000002";

/* A quick migration on a table nobody holds... */
const CREATE_AUDIT_MIGRATION: MigrationClass = migration(
  CREATE_AUDIT,
  async (queryRunner: QueryRunner) => {
    await queryRunner.query(`CREATE TABLE "Audit" ("_id" serial PRIMARY KEY)`);
  },
);

/* ...and AddArchiveToMoreResources' ALTER on a table someone does. */
const ADD_IS_ARCHIVED_MIGRATION: MigrationClass = migration(
  ADD_IS_ARCHIVED,
  async (queryRunner: QueryRunner) => {
    await queryRunner.query(
      `ALTER TABLE "Hot" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
  },
);

const MIGRATIONS: Array<MigrationClass> = [
  CREATE_AUDIT_MIGRATION,
  ADD_IS_ARCHIVED_MIGRATION,
];

describePostgres("Waiting for the schema migrations, against Postgres", () => {
  const schema: string = `schema_migration_wait_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let admin: Client;
  let tables: number = 0;

  /* A migrations table of its own for each test. */
  function nextMigrationsTable(): string {
    tables++;
    return `migrations_${tables}`;
  }

  function options(
    migrationsTableName: string,
    migrationsRun: boolean,
  ): DataSourceOptions {
    return {
      type: "postgres",
      host: CONNECTION.host,
      port: CONNECTION.port,
      username: CONNECTION.user,
      password: CONNECTION.password,
      database: CONNECTION.database,
      schema,
      entities: [],
      synchronize: false,
      migrations: MIGRATIONS,
      migrationsTableName,
      migrationsTransactionMode: "each",
      migrationsRun,
      extra: {
        options: `-c search_path=${schema}`,
        statement_timeout: 30_000,
        query_timeout: 35_000,
      },
    } as DataSourceOptions;
  }

  async function tableExists(table: string): Promise<boolean> {
    const rows: Array<{ found: string | null }> = (
      await admin.query(`SELECT to_regclass($1)::text AS found`, [
        `"${schema}"."${table}"`,
      ])
    ).rows;
    return rows[0]!.found !== null;
  }

  async function applied(table: string): Promise<Array<string>> {
    if (!(await tableExists(table))) {
      return [];
    }
    const rows: Array<{ name: string }> = (
      await admin.query(`SELECT name FROM "${schema}"."${table}" ORDER BY id`)
    ).rows;
    return rows.map((row: { name: string }) => {
      return row.name;
    });
  }

  /* A session holding `table` (ACCESS SHARE) inside an open transaction. */
  async function holdOpen(table: string): Promise<Client> {
    const holder: Client = new Client({
      ...CONNECTION,
      options: `-c search_path=${schema}`,
    });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query(`SELECT 1 FROM "${table}" LIMIT 1`);
    return holder;
  }

  /* Points connect() at `table`, as a runtime process, with the short wait. */
  function asRuntimeProcess(
    table: string,
    policy: SchemaMigrationWaitPolicy,
  ): void {
    jest
      .spyOn(Database, "getDatasourceOptions")
      .mockReturnValue(options(table, false));
    const wait: typeof SchemaMigrationWait.waitForPendingMigrations =
      SchemaMigrationWait.waitForPendingMigrations.bind(SchemaMigrationWait);
    jest
      .spyOn(SchemaMigrationWait, "waitForPendingMigrations")
      .mockImplementation((dataSource: DataSource) => {
        return wait(dataSource, policy);
      });
  }

  beforeAll(async () => {
    admin = new Client(CONNECTION);
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
      return undefined as never;
    });
    // The 14.0.11 schema: "Hot" exists, without the column.
    await admin.query(`DROP TABLE IF EXISTS "${schema}"."Hot" CASCADE`);
    await admin.query(`DROP TABLE IF EXISTS "${schema}"."Audit" CASCADE`);
    await admin.query(
      `CREATE TABLE "${schema}"."Hot" ("_id" serial PRIMARY KEY, "projectId" uuid)`,
    );
    await admin.query(
      `INSERT INTO "${schema}"."Hot" ("projectId") SELECT gen_random_uuid() FROM generate_series(1, 200)`,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Database.disconnect();
  });

  test("on a new database every migration is pending, and reading that creates nothing", async () => {
    const table: string = nextMigrationsTable();
    const runtime: DataSource = await new DataSource(
      options(table, false),
    ).initialize();

    try {
      await expect(
        SchemaMigrationWait.getPendingMigrationNames(runtime),
      ).resolves.toEqual([CREATE_AUDIT, ADD_IS_ARCHIVED]);
      expect(await tableExists(table)).toBe(false);

      // What the wait does not use: showMigrations() creates the table.
      await expect(runtime.showMigrations()).resolves.toBe(true);
      expect(await tableExists(table)).toBe(true);
    } finally {
      await runtime.destroy();
    }
  });

  test("a runtime process connects only once the migrate Job's last migration has committed", async () => {
    const table: string = nextMigrationsTable();
    asRuntimeProcess(table, WAIT_POLICY);
    const holder: Client = await holdOpen("Hot");
    let holderOpen: boolean = true;

    try {
      let connected: boolean = false;
      const connecting: Promise<DataSource> = Database.connect().then(
        (dataSource: DataSource) => {
          connected = true;
          return dataSource;
        },
      );

      // The Job starts: the first migration commits, the second is held back.
      const migrating: Promise<Array<string>> =
        SchemaMigrationRunner.runPendingMigrations(
          options(table, true),
          LOCK_POLICY,
        );

      await until(async () => {
        return (await applied(table)).includes(CREATE_AUDIT);
      });
      // Many reads later, the runtime is still waiting, not connected.
      await pause(WAIT_POLICY.pollIntervalInMs * 10);
      expect(await applied(table)).toEqual([CREATE_AUDIT]);
      expect(connected).toBe(false);
      expect(Database.isConnected()).toBe(false);

      await holder.query("COMMIT");
      await holder.end();
      holderOpen = false;

      await expect(migrating).resolves.toEqual([CREATE_AUDIT, ADD_IS_ARCHIVED]);
      const dataSource: DataSource = await connecting;

      expect(connected).toBe(true);
      expect(Database.getDataSource()).toBe(dataSource);
      // The query that failed in 14.0.13 works now.
      const rows: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*) FROM "Hot" WHERE "isArchived" = false`,
      );
      expect(Number(rows[0]!.count)).toBe(200);
    } finally {
      if (holderOpen) {
        await holder.query("ROLLBACK").catch(() => {
          return undefined;
        });
        await holder.end();
      }
    }
  });

  test("when the migrations never come, connect() gives up after its timeout, unconnected", async () => {
    const table: string = nextMigrationsTable();
    asRuntimeProcess(table, { ...WAIT_POLICY, timeoutInMs: 1_000 });

    const startedAt: number = Date.now();
    const error: unknown = await Database.connect().then(
      () => {
        throw new Error("connect() did not give up");
      },
      (caught: unknown) => {
        return caught;
      },
    );

    expect(error).toBeInstanceOf(SchemaMigrationWaitTimeoutError);
    expect(
      (error as SchemaMigrationWaitTimeoutError).pendingMigrationNames,
    ).toEqual([CREATE_AUDIT, ADD_IS_ARCHIVED]);
    // Once: no reconnect retries on top of the wait.
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(Database.isConnected()).toBe(false);
    // And it touched nothing on the way.
    expect(await tableExists(table)).toBe(false);
  });
});
