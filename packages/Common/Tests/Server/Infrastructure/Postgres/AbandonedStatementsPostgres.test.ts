import AppDataSourceOptions from "../../../../Server/Infrastructure/Postgres/DataSourceOptions";
import StatementOutcome from "../../../../Server/Utils/Database/StatementOutcome";
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
  Column,
  DataSource,
  DataSourceOptions,
  Entity,
  PrimaryColumn,
  Repository,
} from "typeorm";

/*
 * A STATEMENT THE APP STOPS WAITING FOR IS STOPPED ON THE DATABASE TOO, AND
 * NEVER COMMITTED BY SOMEONE ELSE - on a real Postgres, through the app's own
 * pool (Infrastructure/Postgres/DataSourceOptions: its node-postgres client
 * and options), with no timeout on the database's side, as behind PgBouncer,
 * which drops the statement_timeout and lock_timeout the app asks for.
 *
 * What went wrong before: node-postgres' client-side query timeout
 * (DATABASE_QUERY_TIMEOUT_MS) stopped waiting for a statement without
 * cancelling it. Inside save() - every create - TypeORM sent ROLLBACK next,
 * which waited behind the statement still running and ran out of time too;
 * node-postgres dropped it unsent and the connection went back to the pool
 * with the transaction open. The next request to borrow it ran START
 * TRANSACTION (a warning) and COMMIT - committing the write the first
 * request had been told had failed. Outside a transaction an UPDATE the app
 * gave up on ran on, and landed whenever it got its lock.
 *
 * Here another session holds the table or the row the app's statement
 * needs, for longer than the app waits:
 *
 *   - a save() whose INSERT outlasts its own timeout and the ROLLBACK's: the
 *     next borrower's save commits only its own row;
 *   - the statement no longer waits on the database once the app has given
 *     up on it, and the caller is told what the database answered;
 *   - an UPDATE outside a transaction never lands after the app gave up on
 *     it;
 *   - the connection is not handed to anyone again.
 *
 * Opt in with RUN_POSTGRES_ABANDONED_STATEMENT_TESTS=true:
 *
 *   RUN_POSTGRES_ABANDONED_STATEMENT_TESTS=true \
 *   ABANDONED_STATEMENT_TEST_DATABASE_HOST=127.0.0.1 \
 *   ABANDONED_STATEMENT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/AbandonedStatementsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Everything it
 * creates lives in a uniquely named schema that is dropped afterwards; it
 * needs no migrated tables.
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ABANDONED_STATEMENT_TESTS"] === "true"
    ? describe
    : describe.skip;

const CONNECTION: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} = {
  host: process.env["ABANDONED_STATEMENT_TEST_DATABASE_HOST"] || "localhost",
  port: Number(process.env["ABANDONED_STATEMENT_TEST_DATABASE_PORT"] || "5400"),
  user: process.env["DATABASE_USERNAME"] || "postgres",
  password: process.env["DATABASE_PASSWORD"] || "password",
  database:
    process.env["ABANDONED_STATEMENT_TEST_DATABASE_NAME"] ||
    process.env["DATABASE_NAME"] ||
    "oneuptimedb",
};

// How long the app waits for one statement here (DATABASE_QUERY_TIMEOUT_MS).
const QUERY_TIMEOUT_MS: number = 1000;

// The SQLSTATE of a statement the database cancelled (query_canceled).
const QUERY_CANCELED: string = "57014";

@Entity({ name: "AbandonedWrite" })
class AbandonedWrite {
  @PrimaryColumn({ type: "varchar", length: 100 })
  public id!: string;

  @Column({ type: "varchar", length: 200 })
  public note!: string;
}

describePostgres("statements the app stops waiting for, on Postgres", () => {
  const schema: string = `abandoned_statements_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let admin: Client;
  const pools: Array<DataSource> = [];
  const holders: Array<Client> = [];

  /*
   * A pool as the app builds it - its node-postgres client and options - on
   * this schema, with no timeout the database enforces (as behind
   * PgBouncer) and the app's own wait scaled down. One connection, so the
   * next request is handed the one the last request gave back.
   */
  const appPool: (
    extra?: Record<string, unknown>,
  ) => Promise<DataSource> = async (
    extra?: Record<string, unknown>,
  ): Promise<DataSource> => {
    const appExtra: Record<string, unknown> = {
      ...((AppDataSourceOptions as { extra?: Record<string, unknown> }).extra ||
        {}),
    };

    const pool: DataSource = new DataSource({
      type: "postgres",
      host: CONNECTION.host,
      port: CONNECTION.port,
      username: CONNECTION.user,
      password: CONNECTION.password,
      database: CONNECTION.database,
      schema,
      entities: [AbandonedWrite],
      synchronize: false,
      extra: {
        ...appExtra,
        max: 1,
        // None of these reach the database behind PgBouncer.
        statement_timeout: 0,
        lock_timeout: 0,
        idle_in_transaction_session_timeout: 0,
        options: `-c search_path=${schema}`,
        query_timeout: QUERY_TIMEOUT_MS,
        ...(extra || {}),
      },
    } as DataSourceOptions);

    await pool.initialize();
    pools.push(pool);
    return pool;
  };

  /*
   * Another session, holding what the app's statement needs until told. In
   * SHARE mode the table can still be read - save() reads the row it is
   * handed before its transaction starts - but not written: the INSERT
   * inside save()'s transaction waits.
   */
  const holdTable: () => Promise<Client> = async (): Promise<Client> => {
    const holder: Client = new Client(CONNECTION);
    await holder.connect();
    holders.push(holder);
    await holder.query("BEGIN");
    await holder.query(`LOCK TABLE "${schema}"."AbandonedWrite" IN SHARE MODE`);
    return holder;
  };

  const holdRow: (id: string) => Promise<Client> = async (
    id: string,
  ): Promise<Client> => {
    const holder: Client = new Client(CONNECTION);
    await holder.connect();
    holders.push(holder);
    await holder.query("BEGIN");
    await holder.query(
      `SELECT "id" FROM "${schema}"."AbandonedWrite" WHERE "id" = $1 FOR UPDATE`,
      [id],
    );
    return holder;
  };

  const letGo: (holder: Client) => Promise<void> = async (
    holder: Client,
  ): Promise<void> => {
    await holder.query("COMMIT");
  };

  const failureOf: (run: () => Promise<unknown>) => Promise<unknown> = async (
    run: () => Promise<unknown>,
  ): Promise<unknown> => {
    try {
      await run();
    } catch (error) {
      return error;
    }

    throw new Error("Expected the statement to fail.");
  };

  // The statements of other sessions still waiting for a lock on the table.
  const waitingOnTheTable: () => Promise<number> =
    async (): Promise<number> => {
      const rows: Array<{ waiting: number }> = (
        await admin.query(
          `SELECT count(*)::int AS waiting
             FROM pg_locks l
             JOIN pg_class c ON c.oid = l.relation
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE NOT l.granted AND n.nspname = $1 AND c.relname = 'AbandonedWrite'`,
          [schema],
        )
      ).rows;

      return rows[0]?.waiting ?? -1;
    };

  // The statements still running on the database that read like this one.
  const runningLike: (pattern: string) => Promise<number> = async (
    pattern: string,
  ): Promise<number> => {
    const rows: Array<{ running: number }> = (
      await admin.query(
        `SELECT count(*)::int AS running
           FROM pg_stat_activity
          WHERE state = 'active' AND pid <> pg_backend_pid() AND query LIKE $1`,
        [pattern],
      )
    ).rows;

    return rows[0]?.running ?? -1;
  };

  const rows: () => Promise<Array<{ id: string; note: string }>> =
    async (): Promise<Array<{ id: string; note: string }>> => {
      return (
        await admin.query(
          `SELECT "id", "note" FROM "${schema}"."AbandonedWrite" ORDER BY "id"`,
        )
      ).rows;
    };

  const sleep: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
    return new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  };

  const backendOf: (pool: DataSource) => Promise<number> = async (
    pool: DataSource,
  ): Promise<number> => {
    const answer: Array<{ pid: number }> = await pool.query(
      "SELECT pg_backend_pid() AS pid",
    );

    return answer[0]!.pid;
  };

  // Whether a backend is still connected to the database.
  const isConnected: (pid: number) => Promise<boolean> = async (
    pid: number,
  ): Promise<boolean> => {
    const answer: Array<{ connected: boolean }> = (
      await admin.query(
        "SELECT count(*) > 0 AS connected FROM pg_stat_activity WHERE pid = $1",
        [pid],
      )
    ).rows;

    return answer[0]?.connected === true;
  };

  beforeAll(async () => {
    admin = new Client(CONNECTION);
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(
      `CREATE TABLE "${schema}"."AbandonedWrite" ("id" varchar(100) PRIMARY KEY, "note" varchar(200) NOT NULL)`,
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await admin.query(`DELETE FROM "${schema}"."AbandonedWrite"`);

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  });

  afterEach(async () => {
    for (const holder of holders.splice(0)) {
      await holder.query("ROLLBACK").catch(() => {
        return undefined;
      });
      await holder.end().catch(() => {
        return undefined;
      });
    }

    for (const pool of pools.splice(0)) {
      if (pool.isInitialized) {
        await pool.destroy().catch(() => {
          return undefined;
        });
      }
    }

    jest.restoreAllMocks();
  });

  test("a save() whose INSERT outlasts its own wait and the ROLLBACK's leaves nothing for the next borrower to commit", async () => {
    const pool: DataSource = await appPool();
    const writes: Repository<AbandonedWrite> =
      pool.getRepository(AbandonedWrite);
    const holder: Client = await holdTable();

    const failure: unknown = await failureOf(() => {
      return writes.save({
        id: "abandoned",
        note: "the request was told this failed",
      });
    });

    expect(failure).toBeTruthy();

    // The table is free again: whatever was left running may go on now.
    await letGo(holder);

    // The next request borrows a connection and saves its own row.
    await writes.save({ id: "next", note: "the next request" });

    // Only its own row is committed - never the write that was reported as failed.
    expect(await rows()).toEqual([{ id: "next", note: "the next request" }]);

    // And nothing that was given up on lands later.
    await sleep(500);
    expect(await rows()).toEqual([{ id: "next", note: "the next request" }]);
  }, 30_000);

  test("the INSERT no longer waits on the database once the app has given up on it, and the caller is told the database cancelled it", async () => {
    const pool: DataSource = await appPool();
    const writes: Repository<AbandonedWrite> =
      pool.getRepository(AbandonedWrite);
    const holder: Client = await holdTable();

    const failure: unknown = await failureOf(() => {
      return writes.save({ id: "abandoned", note: "given up on" });
    });

    // Stopped on the database, while the table is still held.
    expect(await waitingOnTheTable()).toBe(0);

    // The database's own answer: it cancelled the statement, which applied nothing.
    expect((failure as { code?: unknown }).code).toBe(QUERY_CANCELED);
    expect(StatementOutcome.mayStillApply(failure)).toBe(false);

    await letGo(holder);
    await sleep(500);
    expect(await rows()).toEqual([]);
  }, 30_000);

  test("an UPDATE outside a transaction that the app gave up on never lands", async () => {
    await admin.query(
      `INSERT INTO "${schema}"."AbandonedWrite" ("id", "note") VALUES ('kept', 'as it was')`,
    );

    const pool: DataSource = await appPool();
    const holder: Client = await holdRow("kept");

    const failure: unknown = await failureOf(() => {
      return pool.query(
        `UPDATE "AbandonedWrite" SET "note" = $1 WHERE "id" = $2`,
        ["written after the app gave up", "kept"],
      );
    });

    expect((failure as { code?: unknown }).code).toBe(QUERY_CANCELED);
    expect(await waitingOnTheTable()).toBe(0);

    // The row is free: an UPDATE still running would land now.
    await letGo(holder);
    await sleep(1000);

    expect(await rows()).toEqual([{ id: "kept", note: "as it was" }]);
  }, 30_000);

  test("a statement that runs past the app's wait is cancelled at once, not left to run to its end", async () => {
    const pool: DataSource = await appPool();
    const startedAt: number = Date.now();

    const failure: unknown = await failureOf(() => {
      return pool.query("SELECT pg_sleep(20) AS abandoned_sleep");
    });

    expect((failure as { code?: unknown }).code).toBe(QUERY_CANCELED);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(await runningLike("%abandoned_sleep%")).toBe(0);
  }, 30_000);

  test("the connection whose statement the app gave up on is closed, and the next request is handed a new one", async () => {
    const pool: DataSource = await appPool();
    const before: number = await backendOf(pool);

    await failureOf(() => {
      return pool.query("SELECT pg_sleep(20) AS abandoned_sleep");
    });

    const startedAt: number = Date.now();
    const after: number = await backendOf(pool);

    // A connection of its own, at once - not the one still busy with the old statement.
    expect(after).not.toBe(before);
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    // The old one is gone from the database.
    let stillThere: boolean = true;

    for (let attempt: number = 0; attempt < 50 && stillThere; attempt++) {
      stillThere = await isConnected(before);

      if (stillThere) {
        await sleep(100);
      }
    }

    expect(stillThere).toBe(false);
  }, 30_000);
});
