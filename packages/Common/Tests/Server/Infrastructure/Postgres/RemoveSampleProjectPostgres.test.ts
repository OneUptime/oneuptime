import { RemoveSampleProject1809180800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180800000-RemoveSampleProject";
import { KeepSampleProjectColumns1809183200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183200000-KeepSampleProjectColumns";
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
import { DataSource, QueryRunner } from "typeorm";

/*
 * RemoveSampleProject against a real Postgres, on a database whose deletes
 * of a "User" row are slow - as they are on OneUptime Cloud.
 *
 * Deleting a "User" row makes Postgres look for the user in every column
 * that references "User" - over a thousand there, most without an index -
 * one sequential scan each: about 12 s a person. The migration first deleted
 * every sample project in one statement, which took the samples' made-up
 * people with it (User.sampleProjectId cascades): 13 samples and 52 people,
 * ten minutes, against a 30 s statement timeout. It failed at every attempt,
 * the release's migrate Job failed, and its pods never started.
 *
 * Here a trigger makes each delete of a "User" row take longer than the
 * session's whole statement timeout, as those scans do, and the session has
 * the short timeout the app's pool connects with. What it pins:
 *   - the one statement the migration used to run fails on it;
 *   - the migration now succeeds on it: one person, then one sample, a
 *     statement, each within OnlineDdl's long limits - and the session has
 *     its own statement timeout back afterwards;
 *   - only the samples and their made-up people go: a real project, a real
 *     person and what they made are untouched, a real incident a made-up
 *     person created keeps its row with no creator (ON DELETE SET NULL);
 *   - the columns, the key and the index stay - the release before still
 *     reads them - and a second run does nothing and fails on nothing;
 *   - KeepSampleProjectColumns puts them back, empty, where 15.0.0 already
 *     dropped them, and changes nothing where they never went.
 *
 * Opt in with RUN_POSTGRES_SAMPLE_REMOVAL_TESTS=true and a database, for
 * example a disposable one:
 *
 *   docker run -d --rm -p 15433:5432 -e POSTGRES_PASSWORD=password \
 *     -e POSTGRES_DB=oneuptimedb postgres:15
 *   RUN_POSTGRES_SAMPLE_REMOVAL_TESTS=true \
 *     SAMPLE_REMOVAL_TEST_DATABASE_PORT=15433 \
 *     npx jest Tests/Server/Infrastructure/Postgres/RemoveSampleProjectPostgres.test.ts
 *
 * Everything is made in a schema of its own, dropped afterwards. The
 * migration's online index drop names the index in "public"; it is the
 * index this migration exists to drop, and IF EXISTS.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SAMPLE_REMOVAL_TESTS"] === "true"
    ? describe
    : describe.skip;

// The statement timeout the session connects with, as the app's pool does.
const SESSION_STATEMENT_TIMEOUT_IN_MS: number = 1000;

// How long deleting one "User" row takes: past the whole session timeout.
const USER_DELETE_IN_SECONDS: number = 1.2;

const OLD_STATEMENT: string = `DELETE FROM "Project" WHERE "isSampleProject" = true`;

interface Seeded {
  realProjectId: string;
  realUserId: string;
  realIncidentId: string;
  // A real incident a made-up person created (the samples' rows are theirs).
  realIncidentByMadeUpPersonId: string;
  sampleProjectIds: Array<string>;
  madeUpPeopleIds: Array<string>;
}

describePostgres("RemoveSampleProject against Postgres", () => {
  const schema: string = `sample_removal_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let seeded: Seeded;

  async function withRunner<T>(
    step: (queryRunner: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const queryRunner: QueryRunner = database.createQueryRunner();

    try {
      return await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function count(
    sql: string,
    parameters: Array<unknown> = [],
  ): Promise<number> {
    const rows: Array<{ count: string }> = await database.query(
      sql,
      parameters,
    );
    return Number(rows[0]!.count);
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    return (
      (await count(
        `SELECT count(*) FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
        [schema, table, column],
      )) > 0
    );
  }

  // A schema as the models had it before this migration, with data.
  async function seed(): Promise<Seeded> {
    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await database.query(`CREATE SCHEMA "${schema}"`);

    await database.query(`
      CREATE TABLE "${schema}"."Project" (
        "_id" uuid PRIMARY KEY,
        "name" text NOT NULL,
        "isSampleProject" boolean NOT NULL DEFAULT false
      )`);
    await database.query(`
      CREATE TABLE "${schema}"."User" (
        "_id" uuid PRIMARY KEY,
        "email" text NOT NULL,
        "sampleProjectId" uuid
      )`);
    await database.query(
      `CREATE INDEX "IDX_25e3ed56d0b14e81457332f204" ON "${schema}"."User" ("sampleProjectId")`,
    );
    await database.query(
      `ALTER TABLE "${schema}"."User" ADD CONSTRAINT "FK_25e3ed56d0b14e81457332f2048" FOREIGN KEY ("sampleProjectId") REFERENCES "${schema}"."Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await database.query(`
      CREATE TABLE "${schema}"."TeamMember" (
        "_id" uuid PRIMARY KEY,
        "projectId" uuid NOT NULL REFERENCES "${schema}"."Project"("_id") ON DELETE CASCADE,
        "userId" uuid NOT NULL REFERENCES "${schema}"."User"("_id") ON DELETE CASCADE
      )`);
    await database.query(
      `CREATE INDEX ON "${schema}"."TeamMember" ("projectId")`,
    );
    // createdByUserId unindexed, as most columns that reference "User" are.
    await database.query(`
      CREATE TABLE "${schema}"."Incident" (
        "_id" uuid PRIMARY KEY,
        "projectId" uuid NOT NULL REFERENCES "${schema}"."Project"("_id") ON DELETE CASCADE,
        "createdByUserId" uuid REFERENCES "${schema}"."User"("_id") ON DELETE SET NULL
      )`);
    await database.query(
      `CREATE INDEX ON "${schema}"."Incident" ("projectId")`,
    );

    // Deleting a person is slow, as the scans of a large install make it.
    await database.query(`
      CREATE FUNCTION "${schema}".slow_user_delete() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_sleep(${USER_DELETE_IN_SECONDS});
        RETURN OLD;
      END
      $$ LANGUAGE plpgsql`);
    await database.query(
      `CREATE TRIGGER slow_user_delete BEFORE DELETE ON "${schema}"."User" FOR EACH ROW EXECUTE FUNCTION "${schema}".slow_user_delete()`,
    );

    const realProjectId: string = ObjectID.generate().toString();
    const realUserId: string = ObjectID.generate().toString();
    const realIncidentId: string = ObjectID.generate().toString();
    const realIncidentByMadeUpPersonId: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name") VALUES ($1, 'Acme')`,
      [realProjectId],
    );
    await database.query(
      `INSERT INTO "${schema}"."User" ("_id", "email") VALUES ($1, 'owner@acme.example')`,
      [realUserId],
    );
    await database.query(
      `INSERT INTO "${schema}"."TeamMember" ("_id", "projectId", "userId") VALUES ($1, $2, $3)`,
      [ObjectID.generate().toString(), realProjectId, realUserId],
    );
    await database.query(
      `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "createdByUserId") VALUES ($1, $2, $3)`,
      [realIncidentId, realProjectId, realUserId],
    );

    const sampleProjectIds: Array<string> = [];
    const madeUpPeopleIds: Array<string> = [];

    for (let sample: number = 0; sample < 2; sample++) {
      const sampleId: string = ObjectID.generate().toString();
      sampleProjectIds.push(sampleId);

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "isSampleProject") VALUES ($1, 'Sample', true)`,
        [sampleId],
      );

      for (let person: number = 0; person < 2; person++) {
        const personId: string = ObjectID.generate().toString();
        madeUpPeopleIds.push(personId);

        await database.query(
          `INSERT INTO "${schema}"."User" ("_id", "email", "sampleProjectId") VALUES ($1, $2, $3)`,
          [personId, `person-${personId}@sample.invalid`, sampleId],
        );
        await database.query(
          `INSERT INTO "${schema}"."TeamMember" ("_id", "projectId", "userId") VALUES ($1, $2, $3)`,
          [ObjectID.generate().toString(), sampleId, personId],
        );
        await database.query(
          `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "createdByUserId") VALUES ($1, $2, $3)`,
          [ObjectID.generate().toString(), sampleId, personId],
        );
      }
    }

    await database.query(
      `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "createdByUserId") VALUES ($1, $2, $3)`,
      [realIncidentByMadeUpPersonId, realProjectId, madeUpPeopleIds[0]],
    );

    return {
      realProjectId,
      realUserId,
      realIncidentId,
      realIncidentByMadeUpPersonId,
      sampleProjectIds,
      madeUpPeopleIds,
    };
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["SAMPLE_REMOVAL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["SAMPLE_REMOVAL_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SAMPLE_REMOVAL_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      synchronize: false,
      // Connected as the app's pool connects: with a short statement timeout.
      extra: {
        options: `-c search_path=${schema} -c statement_timeout=${SESSION_STATEMENT_TIMEOUT_IN_MS}`,
      },
    });

    await database.initialize();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    jest.spyOn(logger, "info").mockImplementation((() => {
      return undefined;
    }) as never);

    seeded = await seed();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the one statement the migration used to run runs out of the session's statement timeout", async () => {
    await expect(
      withRunner((queryRunner: QueryRunner) => {
        return queryRunner.query(OLD_STATEMENT);
      }),
    ).rejects.toThrow("canceling statement due to statement timeout");

    // Nothing was deleted: the statement was cancelled whole.
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Project" WHERE "isSampleProject"`,
      ),
    ).toBe(2);
  });

  test("the migration removes every sample and made-up person, one statement each, within its own limits", async () => {
    await withRunner(async (queryRunner: QueryRunner) => {
      await new RemoveSampleProject1809180800000().up(queryRunner);

      // The session has its own statement timeout back.
      const rows: Array<{ statement_timeout: string }> =
        await queryRunner.query(`SHOW statement_timeout`);
      expect(rows[0]!.statement_timeout).toBe("1s");
    });

    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Project" WHERE "_id" = ANY($1::uuid[])`,
        [seeded.sampleProjectIds],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."User" WHERE "_id" = ANY($1::uuid[])`,
        [seeded.madeUpPeopleIds],
      ),
    ).toBe(0);
    // Everything in the samples went with them.
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."TeamMember" WHERE "projectId" = ANY($1::uuid[])`,
        [seeded.sampleProjectIds],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Incident" WHERE "projectId" = ANY($1::uuid[])`,
        [seeded.sampleProjectIds],
      ),
    ).toBe(0);
  });

  test("a real project, a real person and what they made are untouched", async () => {
    await withRunner((queryRunner: QueryRunner) => {
      return new RemoveSampleProject1809180800000().up(queryRunner);
    });

    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Project" WHERE "_id" = $1`,
        [seeded.realProjectId],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) FROM "${schema}"."User" WHERE "_id" = $1`, [
        seeded.realUserId,
      ]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."TeamMember" WHERE "userId" = $1`,
        [seeded.realUserId],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Incident" WHERE "_id" = $1 AND "createdByUserId" = $2`,
        [seeded.realIncidentId, seeded.realUserId],
      ),
    ).toBe(1);
    // A real row a made-up person made stays, with nobody as its creator.
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Incident" WHERE "_id" = $1 AND "createdByUserId" IS NULL`,
        [seeded.realIncidentByMadeUpPersonId],
      ),
    ).toBe(1);
  });

  async function keyAndIndexExist(): Promise<{ key: number; index: number }> {
    return {
      key: await count(
        `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND c.conname = 'FK_25e3ed56d0b14e81457332f2048' AND c.convalidated`,
        [schema],
      ),
      index: await count(
        `SELECT count(*) FROM pg_indexes WHERE schemaname = $1 AND indexname = 'IDX_25e3ed56d0b14e81457332f204'`,
        [schema],
      ),
    };
  }

  test("the columns, the key and the index stay - the release before still reads them - and a second run does nothing and fails on nothing", async () => {
    await withRunner((queryRunner: QueryRunner) => {
      return new RemoveSampleProject1809180800000().up(queryRunner);
    });

    expect(await columnExists("User", "sampleProjectId")).toBe(true);
    expect(await columnExists("Project", "isSampleProject")).toBe(true);
    expect(await keyAndIndexExist()).toEqual({ key: 1, index: 1 });

    const before: number = await count(
      `SELECT count(*) FROM "${schema}"."User"`,
    );

    await withRunner((queryRunner: QueryRunner) => {
      return new RemoveSampleProject1809180800000().up(queryRunner);
    });

    expect(await count(`SELECT count(*) FROM "${schema}"."User"`)).toBe(before);
  });

  test("KeepSampleProjectColumns changes nothing where the columns never went", async () => {
    await withRunner((queryRunner: QueryRunner) => {
      return new RemoveSampleProject1809180800000().up(queryRunner);
    });

    const people: number = await count(
      `SELECT count(*) FROM "${schema}"."User"`,
    );

    await withRunner((queryRunner: QueryRunner) => {
      return new KeepSampleProjectColumns1809183200000().up(queryRunner);
    });

    expect(await columnExists("User", "sampleProjectId")).toBe(true);
    expect(await columnExists("Project", "isSampleProject")).toBe(true);
    expect(await keyAndIndexExist()).toEqual({ key: 1, index: 1 });
    expect(await count(`SELECT count(*) FROM "${schema}"."User"`)).toBe(people);
  });

  test("KeepSampleProjectColumns puts back, empty, what 15.0.0 already dropped, so this release's inserts work", async () => {
    await withRunner((queryRunner: QueryRunner) => {
      return new RemoveSampleProject1809180800000().up(queryRunner);
    });

    // As 15.0.0's RemoveSampleProject left an install it finished on.
    await database.query(
      `ALTER TABLE "${schema}"."User" DROP CONSTRAINT "FK_25e3ed56d0b14e81457332f2048"`,
    );
    await database.query(
      `DROP INDEX "${schema}"."IDX_25e3ed56d0b14e81457332f204"`,
    );
    await database.query(
      `ALTER TABLE "${schema}"."User" DROP COLUMN "sampleProjectId"`,
    );
    await database.query(
      `ALTER TABLE "${schema}"."Project" DROP COLUMN "isSampleProject"`,
    );

    await withRunner((queryRunner: QueryRunner) => {
      return new KeepSampleProjectColumns1809183200000().up(queryRunner);
    });

    expect(await columnExists("User", "sampleProjectId")).toBe(true);
    expect(await columnExists("Project", "isSampleProject")).toBe(true);
    expect(await keyAndIndexExist()).toEqual({ key: 1, index: 1 });

    // Empty: every project not a sample, nobody a sample person.
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Project" WHERE "isSampleProject"`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."User" WHERE "sampleProjectId" IS NOT NULL`,
      ),
    ).toBe(0);

    // An insert naming both, as this release's models make one, works.
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "isSampleProject") VALUES ($1, 'Fresh', false)`,
      [ObjectID.generate().toString()],
    );
    await database.query(
      `INSERT INTO "${schema}"."User" ("_id", "email", "sampleProjectId") VALUES ($1, 'new@acme.example', NULL)`,
      [ObjectID.generate().toString()],
    );

    // And a second run changes nothing.
    await withRunner((queryRunner: QueryRunner) => {
      return new KeepSampleProjectColumns1809183200000().up(queryRunner);
    });

    expect(await keyAndIndexExist()).toEqual({ key: 1, index: 1 });
  });

  test("a run stopped part way keeps what it removed, and the next run removes the rest", async () => {
    // Stopped after one person: that person is gone, the rest are not.
    await withRunner(async (queryRunner: QueryRunner) => {
      await queryRunner.startTransaction();
      await queryRunner.query(`SET LOCAL statement_timeout = 0`);
      await queryRunner.query(
        `DELETE FROM "${schema}"."User" WHERE "_id" = $1`,
        [seeded.madeUpPeopleIds[0]],
      );
      await queryRunner.commitTransaction();
    });

    await withRunner((queryRunner: QueryRunner) => {
      return new RemoveSampleProject1809180800000().up(queryRunner);
    });

    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."User" WHERE "_id" = ANY($1::uuid[])`,
        [seeded.madeUpPeopleIds],
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) FROM "${schema}"."Project" WHERE "_id" = ANY($1::uuid[])`,
        [seeded.sampleProjectIds],
      ),
    ).toBe(0);
  });
});
