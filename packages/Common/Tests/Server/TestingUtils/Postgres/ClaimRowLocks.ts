import { expect, jest } from "@jest/globals";
import { isPostgresLockContentionError } from "../../../../Server/Utils/Database/PostgresLockContention";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, QueryRunner } from "typeorm";
import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";

/*
 * Row locks, for the opt-in Postgres suites of the probes' claims: VMware
 * vCenters, OpenStack clouds and checks, and data stores (OneUptime issues
 * #7194 and #7390), and the on-demand jobs a probe is handed - monitor
 * tests, device diagnostics, packet captures and connection tests (#7392).
 *
 * A claim locks the rows it hands out FOR NO KEY UPDATE SKIP LOCKED, and
 * moves them on in the same self-committing statement. Each suite proves
 * two things of its own claim with these:
 *
 * - Claims at once hand out each due row exactly once: none twice, none
 *   lost.
 * - A row another writer holds is skipped, never waited for, and is handed
 *   out once it is free.
 * - While a claim holds its rows, a row that names one of them is still
 *   written: its foreign key check takes FOR KEY SHARE, which does not wait
 *   for FOR NO KEY UPDATE. It did wait for FOR UPDATE, which the claims
 *   used to hold for a whole transaction.
 *
 * Every name is qualified by the suite's schema.
 */

/*
 * A table whose rows name `parentTable`'s by a foreign key, as a finding
 * names its data store or an incident its vCenter. The cloned tables have
 * no foreign keys (CREATE TABLE ... LIKE copies none), so this is the one
 * whose check a claim must not hold up. Its rows go with their parent's.
 */
export async function createReferencingTable(data: {
  database: DataSource;
  schema: string;
  parentTable: string;
}): Promise<string> {
  const table: string = `${data.parentTable}Reference`;

  await data.database.query(
    `CREATE TABLE "${data.schema}"."${table}" (
       "_id" uuid PRIMARY KEY,
       "parentId" uuid NOT NULL
         REFERENCES "${data.schema}"."${data.parentTable}"("_id") ON DELETE CASCADE
     )`,
  );

  return table;
}

/*
 * Another writer holding one row's lock in an open transaction: a
 * collection report, say. Its UPDATE changes no column a key covers, so it
 * takes the lock any ordinary write of the row takes.
 */
export async function holdRow(data: {
  database: DataSource;
  schema: string;
  table: string;
  id: ObjectID;
}): Promise<{ release: () => Promise<void> }> {
  const holder: QueryRunner = data.database.createQueryRunner();
  await holder.connect();
  await holder.startTransaction();

  try {
    await holder.query(
      `UPDATE "${data.schema}"."${data.table}" SET "updatedAt" = "updatedAt" WHERE "_id" = $1`,
      [data.id.toString()],
    );
  } catch (err) {
    await holder.rollbackTransaction();
    await holder.release();
    throw err;
  }

  return {
    release: async (): Promise<void> => {
      await holder.rollbackTransaction();
      await holder.release();
    },
  };
}

/*
 * Four claims at once, each with room for its share of the due rows: every
 * due row is handed out exactly once - to no two claims, and to none
 * lost. A claim skips the rows another is claiming and takes the next due
 * ones, and passes over a row another has just moved on.
 *
 * `claim` hands out up to `limit` rows, and answers their ids.
 */
export async function expectConcurrentClaimsHandOutEachRowOnce(data: {
  due: Array<string>;
  claims?: number;
  claim: (limit: number) => Promise<Array<string>>;
}): Promise<void> {
  const claims: number = data.claims ?? 4;
  const limit: number = Math.ceil(data.due.length / claims);

  const handedOut: Array<string> = (
    await Promise.all(
      Array.from({ length: claims }, (): Promise<Array<string>> => {
        return data.claim(limit);
      }),
    )
  ).flat();

  expect(new Set(handedOut).size).toBe(handedOut.length);
  expect([...handedOut].sort()).toEqual([...data.due].sort());
}

/*
 * The claim hands out every due row but the one another writer holds - it
 * skips that one, rather than waiting for it, which would run past the
 * connection's lock_timeout and fail the claim - and hands that one out as
 * soon as it is free.
 *
 * `free` is what the claim is expected to answer while `held` is held, in
 * claim order; `claim` answers the ids it was handed.
 */
export async function expectHeldRowSkipped(data: {
  database: DataSource;
  schema: string;
  table: string;
  held: ObjectID;
  free: Array<ObjectID>;
  claim: () => Promise<Array<string>>;
}): Promise<void> {
  const holder: { release: () => Promise<void> } = await holdRow({
    database: data.database,
    schema: data.schema,
    table: data.table,
    id: data.held,
  });

  try {
    expect(await data.claim()).toEqual(
      data.free.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
  } finally {
    await holder.release();
  }

  expect(await data.claim()).toEqual([data.held.toString()]);
}

/*
 * Runs the claim with its statement kept open in a transaction of its own,
 * so the claim's row locks stay held - the worst case, which the old
 * claims' round trips made the common one - and, while they are held,
 * writes from a second connection with a short lock_timeout:
 *
 * - a row that names the claimed row: it is written, without waiting;
 * - the claimed row itself: that write waits, and times out - so the
 *   claim's lock really was held while the first one went through.
 *
 * Only the claim's first getRepository call on `service` - its statement -
 * is pointed at that transaction, so whatever the claim reads afterwards,
 * it reads as it always does. `claim` must hand out `id` alone.
 */
export async function expectClaimLocksHoldOnlyTheRow(data: {
  database: DataSource;
  schema: string;
  service: { getRepository: () => unknown };
  table: string;
  referencingTable: string;
  id: ObjectID;
  claim: () => Promise<Array<string>>;
}): Promise<void> {
  const claimer: QueryRunner = data.database.createQueryRunner();
  await claimer.connect();
  await claimer.startTransaction();

  const writer: QueryRunner = data.database.createQueryRunner();
  await writer.connect();

  try {
    jest
      .spyOn(data.service, "getRepository")
      .mockReturnValueOnce({ manager: claimer.manager });

    expect(await data.claim()).toEqual([data.id.toString()]);

    await writer.startTransaction();
    await writer.query("SET LOCAL lock_timeout = '1s'");

    // A row that names the claimed one: its foreign key check does not wait.
    await writer.query(
      `INSERT INTO "${data.schema}"."${data.referencingTable}" ("_id", "parentId") VALUES ($1, $2)`,
      [ObjectID.generate().toString(), data.id.toString()],
    );

    // The claimed row itself is held: a write to it waits, and times out.
    let rowWrite: unknown = null;

    try {
      await writer.query("SAVEPOINT row_write");
      await writer.query(
        `UPDATE "${data.schema}"."${data.table}" SET "updatedAt" = now() WHERE "_id" = $1`,
        [data.id.toString()],
      );
    } catch (err) {
      rowWrite = err;
      await writer.query("ROLLBACK TO SAVEPOINT row_write");
    }

    expect(isPostgresLockContentionError(rowWrite)).toBe(true);

    await writer.commitTransaction();
  } finally {
    if (writer.isTransactionActive) {
      await writer.rollbackTransaction();
    }

    await writer.release();
    await claimer.rollbackTransaction();
    await claimer.release();
  }

  const references: Array<{ count: string }> = await data.database.query(
    `SELECT count(*)::text AS count FROM "${data.schema}"."${data.referencingTable}" WHERE "parentId" = $1`,
    [data.id.toString()],
  );

  expect(references[0]!.count).toBe("1");
}

// Transaction control, as TypeORM sends it.
const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)\b/i;

/*
 * Every statement `run` sends to Postgres, in order, transaction control
 * included: counted at PostgresQueryRunner.query, which every statement
 * TypeORM sends goes through - a manager's query, a repository's, and the
 * START TRANSACTION and COMMIT of a transaction (OneUptime issue #7392).
 */
export async function statementsSentBy<T>(
  run: () => Promise<T>,
): Promise<{ result: T; statements: Array<string> }> {
  const statements: Array<string> = [];
  const realQuery: PostgresQueryRunner["query"] =
    PostgresQueryRunner.prototype.query;

  PostgresQueryRunner.prototype.query = function (
    this: PostgresQueryRunner,
    ...args: Parameters<PostgresQueryRunner["query"]>
  ): ReturnType<PostgresQueryRunner["query"]> {
    statements.push(String(args[0]));
    return realQuery.apply(this, args);
  };

  try {
    return { result: await run(), statements: statements };
  } finally {
    PostgresQueryRunner.prototype.query = realQuery;
  }
}

/*
 * A claim is one self-committing statement: no transaction around it, and
 * one statement that locks the rows it hands out (FOR NO KEY UPDATE SKIP
 * LOCKED) and moves them on. The claims of on-demand probe jobs used to take
 * four round trips - START TRANSACTION, SELECT ... FOR UPDATE, an UPDATE of
 * the ids, COMMIT - on every probe tick, even with nothing to hand out.
 *
 * `statements` is what statementsSentBy recorded of the claim. Answers the
 * claim statement.
 */
export function expectOneSelfCommittingClaim(
  statements: Array<string>,
): string {
  expect(
    statements.filter((statement: string): boolean => {
      return TRANSACTION_CONTROL.test(statement);
    }),
  ).toEqual([]);

  const claims: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.includes("SKIP LOCKED");
    },
  );

  expect(claims).toHaveLength(1);
  expect(claims[0]).toContain("FOR NO KEY UPDATE OF");
  expect(claims[0]).not.toContain("FOR UPDATE OF");

  return claims[0]!;
}
