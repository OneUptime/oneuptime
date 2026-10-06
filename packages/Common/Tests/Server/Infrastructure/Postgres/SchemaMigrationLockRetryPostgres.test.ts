import OnlineDdl, {
  OnlineDdlLimits,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SchemaMigrationRunner, {
  SchemaMigrationLockPolicy,
  SchemaMigrationLockTimeoutError,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrationRunner";
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
import { DataSourceOptions, MigrationInterface, QueryRunner } from "typeorm";

/*
 * Schema migrations against a busy table, on a real Postgres.
 *
 * What happened in 14.0.13: the migrate Job's ALTER TABLE "Monitor" needed
 * ACCESS EXCLUSIVE, a transaction already held "Monitor", and the ALTER
 * waited - with no lock_timeout - at the head of the table's lock queue.
 * Every query on "Monitor" that arrived after it queued behind it and failed
 * on its own 3 s lock_timeout, for as long as the ALTER waited.
 *
 * Here a session holds a table open in a transaction, as that one did, while
 * an "app" connection (the runtime pool's lock_timeout) reads the table in a
 * loop, and the migrations run through SchemaMigrationRunner:
 *
 *  - unbounded (lock wait 0, the old migration path) the app's reads fail for
 *    as long as the holder lives - the incident, reproduced;
 *  - bounded, the migration gives up first, rolls back and steps aside, the
 *    reads go on (slowed, never failed), and the migration is applied once
 *    the holder is gone;
 *  - a holder that never goes away fails the run after the retry window,
 *    with nothing applied and nothing recorded;
 *  - `SET lock_timeout = DEFAULT` inside a migration keeps the bound;
 *  - OnlineDdl builds an index and validates a foreign key while writes run
 *    beside them, and both run again harmlessly.
 *
 * Opt in with RUN_POSTGRES_SCHEMA_MIGRATION_LOCK_TESTS=true:
 *
 *   RUN_POSTGRES_SCHEMA_MIGRATION_LOCK_TESTS=true \
 *   SCHEMA_MIGRATION_LOCK_TEST_DATABASE_HOST=127.0.0.1 \
 *   SCHEMA_MIGRATION_LOCK_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/SchemaMigrationLockRetryPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Everything it
 * creates lives in a uniquely named schema that is dropped afterwards; it
 * needs no migrated tables.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SCHEMA_MIGRATION_LOCK_TESTS"] === "true"
    ? describe
    : describe.skip;

const CONNECTION: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} = {
  host: process.env["SCHEMA_MIGRATION_LOCK_TEST_DATABASE_HOST"] || "localhost",
  port: Number(
    process.env["SCHEMA_MIGRATION_LOCK_TEST_DATABASE_PORT"] || "5400",
  ),
  user: process.env["DATABASE_USERNAME"] || "postgres",
  password: process.env["DATABASE_PASSWORD"] || "password",
  database:
    process.env["SCHEMA_MIGRATION_LOCK_TEST_DATABASE_NAME"] ||
    process.env["DATABASE_NAME"] ||
    "oneuptimedb",
};

/* The app pool's lock_timeout, scaled down with everything else here. */
const APP_LOCK_TIMEOUT_MS: number = 1000;

/* The migration bound: below the app's, as in production (2 s vs 3 s). */
const POLICY: SchemaMigrationLockPolicy = {
  lockTimeoutInMs: 300,
  retryTimeoutInMs: 30_000,
  firstRetryDelayInMs: 100,
  maxRetryDelayInMs: 400,
};

const ONLINE_LIMITS: OnlineDdlLimits = {
  statementTimeoutInMs: 60_000,
  lockTimeoutInMs: 10_000,
  clientTimeoutMarginInMs: 10_000,
  buildPollIntervalInMs: 100,
};

/*
 * Migrations are classes TypeORM instantiates; these build them around the
 * test schema's tables.
 */
type MigrationClass = new () => MigrationInterface;

function migration(
  name: string,
  up: (queryRunner: QueryRunner) => Promise<void>,
  options: { transaction?: boolean } = {},
): MigrationClass {
  return class implements MigrationInterface {
    public name: string = name;
    public transaction?: boolean;
    public constructor() {
      if (options.transaction !== undefined) {
        this.transaction = options.transaction;
      }
    }
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
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  }
}

interface Reads {
  stop: () => Promise<void>;
  failures: Array<string>;
  count: () => number;
}

describePostgres("Schema migrations on a busy table, against Postgres", () => {
  const schema: string = `schema_migration_lock_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let admin: Client;
  let migrationsTable: number = 0;

  function client(extra: Record<string, unknown> = {}): Client {
    return new Client({
      ...CONNECTION,
      options: `-c search_path=${schema}`,
      ...extra,
    });
  }

  /* An app connection reading `table` in a loop until stopped. */
  async function readContinuously(table: string): Promise<Reads> {
    const app: Client = client({ lock_timeout: APP_LOCK_TIMEOUT_MS });
    await app.connect();

    const failures: Array<string> = [];
    let count: number = 0;
    let running: boolean = true;

    const loop: Promise<void> = (async () => {
      while (running) {
        try {
          await app.query(`SELECT count(*) FROM "${table}"`);
          count++;
        } catch (error) {
          failures.push((error as Error).message);
        }
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 20);
        });
      }
    })();

    return {
      failures,
      count: () => {
        return count;
      },
      stop: async () => {
        running = false;
        await loop;
        await app.end();
      },
    };
  }

  /* Whether an ALTER TABLE on `table` is waiting in its lock queue now. */
  async function isAlterWaitingForLock(table: string): Promise<boolean> {
    const rows: Array<unknown> = (
      await admin.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE $1`,
        [`ALTER TABLE "${table}"%`],
      )
    ).rows;
    return rows.length > 0;
  }

  /* A session holding `table` (ACCESS SHARE) inside an open transaction. */
  async function holdOpen(table: string): Promise<Client> {
    const holder: Client = client();
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query(`SELECT 1 FROM "${table}" LIMIT 1`);
    return holder;
  }

  function options(migrations: Array<MigrationClass>): DataSourceOptions {
    migrationsTable++;
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
      migrations,
      migrationsTableName: `migrations_${migrationsTable}`,
      migrationsTransactionMode: "each",
      migrationsRun: true,
      // The app pool's other deadlines, as the migrate Job has them.
      extra: {
        options: `-c search_path=${schema}`,
        statement_timeout: 30_000,
        query_timeout: 35_000,
      },
    } as DataSourceOptions;
  }

  async function applied(table: string): Promise<Array<string>> {
    const rows: Array<{ name: string }> = (
      await admin.query(`SELECT name FROM "${schema}"."${table}" ORDER BY id`)
    ).rows;
    return rows.map((row: { name: string }) => {
      return row.name;
    });
  }

  async function columns(table: string): Promise<Array<string>> {
    const rows: Array<{ column_name: string }> = (
      await admin.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table],
      )
    ).rows;
    return rows.map((row: { column_name: string }) => {
      return row.column_name;
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
    await admin.query(`DROP TABLE IF EXISTS "${schema}"."Hot" CASCADE`);
    await admin.query(`DROP TABLE IF EXISTS "${schema}"."Owner" CASCADE`);
    await admin.query(
      `CREATE TABLE "${schema}"."Hot" ("_id" serial PRIMARY KEY, "projectId" uuid, "ownerId" integer)`,
    );
    await admin.query(
      `INSERT INTO "${schema}"."Hot" ("projectId") SELECT gen_random_uuid() FROM generate_series(1, 2000)`,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ADD_COLUMN: MigrationClass = migration(
    "AddIsArchivedToHot1799000000001",
    async (queryRunner: QueryRunner) => {
      await queryRunner.query(
        `ALTER TABLE "Hot" ADD "isArchived" boolean NOT NULL DEFAULT false`,
      );
    },
  );

  test("unbounded, as the migrate Job used to run, an ALTER waiting for its lock fails the app's reads for as long as it waits", async () => {
    const holder: Client = await holdOpen("Hot");
    const reads: Reads = await readContinuously("Hot");

    const run: Promise<Array<string>> =
      SchemaMigrationRunner.runPendingMigrations(options([ADD_COLUMN]), {
        ...POLICY,
        lockTimeoutInMs: 0,
      });

    // The ALTER sits in the lock queue behind the holder...
    await until(() => {
      return isAlterWaitingForLock("Hot");
    });
    // ...and the reads that arrive now queue behind the ALTER, and time out.
    await until(() => {
      return reads.failures.length >= 2;
    });
    await holder.query("COMMIT");
    await holder.end();

    await expect(run).resolves.toEqual(["AddIsArchivedToHot1799000000001"]);
    await reads.stop();

    expect(reads.failures[0]).toContain("lock timeout");
  });

  test("bounded, the migration steps aside: the app's reads never fail, and it is applied once the holder is gone", async () => {
    const warn: Array<string> = [];
    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warn.push(String(message));
    });
    const rolledBack: () => number = (): number => {
      return warn.filter((message: string) => {
        return message.startsWith(
          "Schema migration AddIsArchivedToHot1799000000001 rolled back: canceling statement due to lock timeout",
        );
      }).length;
    };
    const holder: Client = await holdOpen("Hot");
    const reads: Reads = await readContinuously("Hot");

    const run: Promise<Array<string>> =
      SchemaMigrationRunner.runPendingMigrations(options([ADD_COLUMN]), POLICY);

    // Let go only once it has given up, stepped aside and come back a few times.
    await until(() => {
      return rolledBack() >= 3;
    });
    const migratingWhileHeld: Array<string> = await columns("Hot");
    await holder.query("COMMIT");
    await holder.end();

    await expect(run).resolves.toEqual(["AddIsArchivedToHot1799000000001"]);
    await reads.stop();

    expect(migratingWhileHeld).not.toContain("isArchived");
    expect(await columns("Hot")).toContain("isArchived");
    /*
     * Postgres enforces the reads' own lock_timeout, so none failing means
     * none waited that long for a lock: each was held up by one migration
     * attempt at most - its 300 ms wait.
     */
    expect(reads.failures).toEqual([]);
    expect(reads.count()).toBeGreaterThan(10);
    // It tried, rolled back and tried again.
    expect(rolledBack()).toBeGreaterThanOrEqual(3);
    // And named the transaction it waited for.
    expect(
      warn.some((message: string) => {
        return (
          message.includes("idle in transaction") && message.includes("Hot")
        );
      }),
    ).toBe(true);
  });

  test("a holder that never lets go fails the run after the window, with nothing applied", async () => {
    const holder: Client = await holdOpen("Hot");
    const reads: Reads = await readContinuously("Hot");

    try {
      const name: string = `migrations_${migrationsTable + 1}`;

      await expect(
        SchemaMigrationRunner.runPendingMigrations(options([ADD_COLUMN]), {
          ...POLICY,
          retryTimeoutInMs: 1500,
        }),
      ).rejects.toBeInstanceOf(SchemaMigrationLockTimeoutError);

      expect(await applied(name)).toEqual([]);
      expect(await columns("Hot")).not.toContain("isArchived");
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
      await reads.stop();
    }

    expect(reads.failures).toEqual([]);
  });

  /*
   * 1798300000000 ends its build with `SET lock_timeout = DEFAULT`. Had the
   * bound been a SET, that would have switched it off for every migration
   * after; as a startup parameter, DEFAULT is the bound.
   */
  test("SET lock_timeout = DEFAULT inside a migration keeps the bound for the ones after it", async () => {
    const seen: Array<string> = [];
    const record: (queryRunner: QueryRunner) => Promise<void> = async (
      queryRunner: QueryRunner,
    ) => {
      seen.push(
        (
          await queryRunner.query(`SELECT current_setting('lock_timeout') AS v`)
        )[0].v,
      );
    };

    await SchemaMigrationRunner.runPendingMigrations(
      options([
        migration("ReadsTheBound1799000000002", record),
        migration(
          "ResetsItsOwnTimeout1799000000003",
          async (queryRunner: QueryRunner) => {
            await queryRunner.query(`SET lock_timeout = 120000`);
            await queryRunner.query(`SET lock_timeout = DEFAULT`);
          },
          { transaction: false },
        ),
        migration("ReadsTheBoundAfter1799000000004", record),
      ]),
      POLICY,
    );

    expect(seen).toEqual(["300ms", "300ms"]);
  });

  describe("OnlineDdl beside writes", () => {
    async function writeContinuously(): Promise<Reads> {
      const app: Client = client({ lock_timeout: APP_LOCK_TIMEOUT_MS });
      await app.connect();
      const failures: Array<string> = [];
      let count: number = 0;
      let running: boolean = true;

      const loop: Promise<void> = (async () => {
        while (running) {
          try {
            await app.query(
              `INSERT INTO "Hot" ("projectId") VALUES (gen_random_uuid())`,
            );
            count++;
          } catch (error) {
            failures.push((error as Error).message);
          }
          await new Promise((resolve: (value: unknown) => void) => {
            setTimeout(resolve, 10);
          });
        }
      })();

      return {
        failures,
        count: () => {
          return count;
        },
        stop: async () => {
          running = false;
          await loop;
          await app.end();
        },
      };
    }

    async function index(
      name: string,
    ): Promise<{ isValid: boolean; definition: string } | undefined> {
      return (
        await admin.query(
          `SELECT x.indisvalid AS "isValid", pg_get_indexdef(x.indexrelid) AS definition
             FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2`,
          [schema, name],
        )
      ).rows[0];
    }

    const CREATE_INDEX: string = `CREATE INDEX "IDX_hot_project" ON "Hot" ("projectId") `;

    test("builds the index while inserts carry on, through the runner, and does nothing the second time", async () => {
      const writes: Reads = await writeContinuously();
      const AddIndex: MigrationClass = migration(
        "AddHotProjectIndex1799000000005",
        async (queryRunner: QueryRunner) => {
          await OnlineDdl.createIndex(queryRunner, CREATE_INDEX, ONLINE_LIMITS);
        },
        { transaction: false },
      );

      try {
        await expect(
          SchemaMigrationRunner.runPendingMigrations(
            options([AddIndex]),
            POLICY,
          ),
        ).resolves.toEqual(["AddHotProjectIndex1799000000005"]);
      } finally {
        await writes.stop();
      }

      expect(writes.failures).toEqual([]);
      expect(writes.count()).toBeGreaterThan(0);
      expect(await index("IDX_hot_project")).toEqual({
        isValid: true,
        definition: expect.stringMatching(
          /^CREATE INDEX "IDX_hot_project" ON .*"Hot" USING btree \("projectId"\)$/,
        ),
      });

      // Run again (a retry, or a second runner): the valid index stays.
      const runner: Client = client();
      await runner.connect();
      try {
        await OnlineDdl.createIndex(
          {
            isTransactionActive: false,
            query: async (sql: string, parameters?: Array<unknown>) => {
              return (await runner.query(sql, parameters)).rows;
            },
            connect: async () => {
              return runner;
            },
          } as unknown as QueryRunner,
          CREATE_INDEX,
          ONLINE_LIMITS,
        );
      } finally {
        await runner.end();
      }
      expect((await index("IDX_hot_project"))!.isValid).toBe(true);
    });

    test("rebuilds the INVALID index a stopped build left", async () => {
      // A unique build over duplicates fails and leaves an INVALID index.
      await admin.query(
        `INSERT INTO "${schema}"."Hot" ("projectId") VALUES ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000001')`,
      );
      await expect(
        admin.query(
          `CREATE UNIQUE INDEX CONCURRENTLY "IDX_hot_unique" ON "${schema}"."Hot" ("projectId")`,
        ),
      ).rejects.toThrow();
      expect((await index("IDX_hot_unique"))!.isValid).toBe(false);
      await admin.query(
        `DELETE FROM "${schema}"."Hot" WHERE "projectId" = '00000000-0000-4000-8000-000000000001'`,
      );

      await SchemaMigrationRunner.runPendingMigrations(
        options([
          migration(
            "AddHotUniqueIndex1799000000006",
            async (queryRunner: QueryRunner) => {
              await OnlineDdl.createIndex(
                queryRunner,
                `CREATE UNIQUE INDEX "IDX_hot_unique" ON "Hot" ("projectId") `,
                ONLINE_LIMITS,
              );
            },
            { transaction: false },
          ),
        ]),
        POLICY,
      );

      expect((await index("IDX_hot_unique"))!.isValid).toBe(true);
    });

    test("adds a foreign key NOT VALID and validates it while inserts carry on", async () => {
      await admin.query(
        `CREATE TABLE "${schema}"."Owner" ("_id" serial PRIMARY KEY)`,
      );
      await admin.query(
        `INSERT INTO "${schema}"."Owner" SELECT FROM generate_series(1, 10)`,
      );
      await admin.query(`UPDATE "${schema}"."Hot" SET "ownerId" = 1`);
      const writes: Reads = await writeContinuously();

      try {
        await SchemaMigrationRunner.runPendingMigrations(
          options([
            migration(
              "AddHotOwnerForeignKey1799000000007",
              async (queryRunner: QueryRunner) => {
                await OnlineDdl.addForeignKey(
                  queryRunner,
                  `ALTER TABLE "Hot" ADD CONSTRAINT "FK_hot_owner" FOREIGN KEY ("ownerId") REFERENCES "Owner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
                  ONLINE_LIMITS,
                );
              },
              { transaction: false },
            ),
          ]),
          POLICY,
        );
      } finally {
        await writes.stop();
      }

      expect(writes.failures).toEqual([]);
      const constraint: { validated: boolean; definition: string } = (
        await admin.query(
          `SELECT convalidated AS validated, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint WHERE conname = 'FK_hot_owner'
              AND connamespace = $1::regnamespace`,
          [schema],
        )
      ).rows[0];
      expect(constraint).toEqual({
        validated: true,
        definition: expect.stringMatching(
          /^FOREIGN KEY \("ownerId"\) REFERENCES .*"Owner"\(_id\) ON DELETE SET NULL$/,
        ),
      });
    });

    test("a foreign key existing rows violate is not left behind", async () => {
      await admin.query(
        `CREATE TABLE "${schema}"."Owner" ("_id" serial PRIMARY KEY)`,
      );
      await admin.query(`UPDATE "${schema}"."Hot" SET "ownerId" = 999`);

      await expect(
        SchemaMigrationRunner.runPendingMigrations(
          options([
            migration(
              "AddHotOwnerForeignKey1799000000008",
              async (queryRunner: QueryRunner) => {
                await OnlineDdl.addForeignKey(
                  queryRunner,
                  `ALTER TABLE "Hot" ADD CONSTRAINT "FK_hot_owner_bad" FOREIGN KEY ("ownerId") REFERENCES "Owner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
                  ONLINE_LIMITS,
                );
              },
              { transaction: false },
            ),
          ]),
          POLICY,
        ),
      ).rejects.toThrow('Rows of "Hot" violate "FK_hot_owner_bad"');

      expect(
        (
          await admin.query(
            `SELECT 1 FROM pg_constraint WHERE conname = 'FK_hot_owner_bad'`,
          )
        ).rows,
      ).toEqual([]);
    });
  });
});
