import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * THE CLAIMS A PERSON'S ON-CALL NOTIFICATIONS ARE SENT UNDER, AGAINST A
 * MIGRATED POSTGRES.
 *
 * claimNotificationExecution keeps two overlapping runs of the person's-log
 * worker from both sending one notification (audit F7), and
 * releaseNotificationRuleClaim gives a claim back only while the log still
 * holds the moment it was taken at (issue #8407). Each is one
 * `UPDATE ... RETURNING`, and TypeORM's postgres query() answers an UPDATE
 * with [rows, rowCount] - an array of two whether or not anything matched.
 * The unit suites faked the driver with a bare array of rows, so nothing
 * saw that reading that answer's length made every claim a win and every
 * give-back a success (found by OnCallPageMergePostgres, issue #7837). This
 * runs both statements as Postgres answers them:
 *
 *   - a claim wins once: the same key again loses, another key wins, and of
 *     several runs claiming one key at once exactly one wins;
 *   - a claim is given back by the moment it was taken at, once, and can
 *     then be claimed again; one held at another moment is not given back;
 *   - a claim, or a give-back, on a log that is not there loses;
 *   - none of it falls back to the claim's non-atomic marking, which logs an
 *     error.
 *
 * Opt in with RUN_POSTGRES_ONCALL_CLAIMS_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The UserOnCallLog table's STRUCTURE
 * is cloned into a unique schema (search_path holds only that schema) that
 * is dropped afterwards; every row is synthetic. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * ONCALL_CLAIMS_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * ONCALL_CLAIMS_TEST_DATABASE_HOST / _PORT (default localhost:5400,
 * Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_ONCALL_CLAIMS_TESTS"] === "true"
    ? describe
    : describe.skip;

const CLAIMED_AT: Date = new Date("2026-11-16T08:00:00.000Z");
const CLAIMED_LATER: Date = new Date("2026-11-16T08:02:00.000Z");

describePostgres("on-call notification claims against Postgres", () => {
  const schema: string = `oncall_claims_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let loggedErrors: jest.SpyInstance;

  async function addLog(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."UserOnCallLog" ("_id", "projectId", "userId", "status", "version")
      VALUES ($1, $2, $3, 'Executing', 1)`,
      [
        id.toString(),
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function executedOf(id: ObjectID): Promise<JSONObject | null> {
    const rows: Array<{ executed: JSONObject | null }> = await database.query(
      `SELECT "executedNotificationRules" AS "executed" FROM "${schema}"."UserOnCallLog" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0]?.executed || null;
  }

  async function claim(
    id: ObjectID,
    claimKey: string,
    claimedAt?: Date,
  ): Promise<boolean> {
    return await UserOnCallLogService.claimNotificationExecution({
      userOnCallLogId: id,
      claimKey: claimKey,
      claimedAt: claimedAt,
    });
  }

  async function giveBack(
    id: ObjectID,
    claimKey: string,
    claimedAt: Date,
  ): Promise<boolean> {
    return await UserOnCallLogService.releaseNotificationRuleClaim({
      userOnCallLogId: id,
      claimKey: claimKey,
      claimedAt: claimedAt,
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["ONCALL_CLAIMS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["ONCALL_CLAIMS_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ONCALL_CLAIMS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."UserOnCallLog" (LIKE public."UserOnCallLog" INCLUDING ALL)`,
    );
    // A fixture names only what the claims touch; the key stays NOT NULL.
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'UserOnCallLog' AND is_nullable = 'NO' AND column_name <> '_id'`,
      [schema],
    );
    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."UserOnCallLog" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    loggedErrors = jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`DELETE FROM "${schema}"."UserOnCallLog"`);
  });

  afterEach(() => {
    // The claim falls back to a non-atomic marking when its UPDATE throws.
    expect(loggedErrors).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test("REGRESSION: a claim wins once; the same key again loses, and another key wins", async () => {
    const log: ObjectID = await addLog();

    expect(await claim(log, "rule-1", CLAIMED_AT)).toBe(true);
    expect(await claim(log, "rule-1")).toBe(false);
    expect(await claim(log, "rule-1:repeat:1")).toBe(true);
    expect(await claim(log, "__fallback__")).toBe(true);
    expect(await claim(log, "__fallback__")).toBe(false);

    const executed: JSONObject | null = await executedOf(log);
    expect(Object.keys(executed || {}).sort()).toEqual(
      ["__fallback__", "rule-1", "rule-1:repeat:1"].sort(),
    );
    // The claim holds the moment it was taken at, for its give-back.
    expect(executed?.["rule-1"]).toBe(CLAIMED_AT.toISOString());
  });

  test("REGRESSION: of several runs claiming one notification at once, exactly one wins", async () => {
    const log: ObjectID = await addLog();

    const claims: Array<boolean> = await Promise.all(
      Array.from({ length: 6 }, (): Promise<boolean> => {
        return claim(log, "rule-1");
      }),
    );

    expect(
      claims.filter((won: boolean): boolean => {
        return won;
      }),
    ).toHaveLength(1);
  });

  test("REGRESSION: a claim is given back only by the moment it was taken at, once, and can then be claimed again", async () => {
    const log: ObjectID = await addLog();
    expect(await claim(log, "rule-1", CLAIMED_LATER)).toBe(true);

    // The log holds a claim taken at another moment: not given back.
    expect(await giveBack(log, "rule-1", CLAIMED_AT)).toBe(false);
    expect(await executedOf(log)).toEqual({
      "rule-1": CLAIMED_LATER.toISOString(),
    });

    expect(await giveBack(log, "rule-1", CLAIMED_LATER)).toBe(true);
    expect(await executedOf(log)).toEqual({});

    // Given back already.
    expect(await giveBack(log, "rule-1", CLAIMED_LATER)).toBe(false);

    // The next try claims it, and sends it.
    expect(await claim(log, "rule-1")).toBe(true);
  });

  test("a claim, or a give-back, on a log that is not there loses", async () => {
    expect(await claim(ObjectID.generate(), "rule-1")).toBe(false);
    expect(await giveBack(ObjectID.generate(), "rule-1", CLAIMED_AT)).toBe(
      false,
    );
  });
});
