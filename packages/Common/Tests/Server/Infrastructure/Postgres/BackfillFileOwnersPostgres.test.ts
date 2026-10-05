import {
  BackfillFileOwners1797900000000,
  FILE_PROJECT_REFERENCES,
  FileProjectReference,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797900000000-BackfillFileOwners";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * BackfillFileOwners1797900000000 against a real Postgres, on real rows:
 * a file uploaded before files recorded their project takes the project of
 * the records that point at it when they are all of one project, a
 * profile picture takes its one user, and nothing else moves.
 *
 * Opt in with RUN_POSTGRES_FILE_OWNER_BACKFILL_TESTS=true and the normal
 * database credentials; FILE_OWNER_BACKFILL_TEST_DATABASE_HOST / _PORT
 * point it at a database other than the local development one. Every
 * table is created - with only the columns the backfill reads - in a
 * uniquely named schema, inside a transaction rolled back after each test,
 * and the schema is dropped afterwards: no application row is touched.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_FILE_OWNER_BACKFILL_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_A: string = "a0000000-0000-4000-8000-000000000001";
const PROJECT_B: string = "b0000000-0000-4000-8000-000000000001";

function id(): string {
  return ObjectID.generate().toString();
}

// The tables the backfill reads, with the columns it reads.
function createTablesSql(): Array<string> {
  const statements: Array<string> = [
    `CREATE TABLE "File" ("_id" uuid PRIMARY KEY, "projectId" uuid, "deletedAt" TIMESTAMP)`,
    `CREATE TABLE "User" ("_id" uuid PRIMARY KEY, "profilePictureId" uuid)`,
  ];

  const tables: Map<string, Set<string>> = new Map();

  const columnsOf: (table: string) => Set<string> = (
    table: string,
  ): Set<string> => {
    if (!tables.has(table)) {
      tables.set(table, new Set<string>());
    }

    return tables.get(table)!;
  };

  for (const reference of FILE_PROJECT_REFERENCES) {
    if (reference.owner) {
      columnsOf(reference.owner.table).add(`"projectId" uuid`);
      columnsOf(reference.table).add(`"${reference.owner.idColumn}" uuid`);
      columnsOf(reference.table).add(`"${reference.fileIdColumn}" uuid`);
    } else {
      columnsOf(reference.table).add(`"projectId" uuid`);
      columnsOf(reference.table).add(`"${reference.fileIdColumn}" uuid`);
    }
  }

  for (const [table, columns] of tables) {
    statements.push(
      `CREATE TABLE "${table}" ("_id" uuid DEFAULT gen_random_uuid(), ${Array.from(columns).join(", ")})`,
    );
  }

  return statements;
}

function referenceTo(table: string, fileIdColumn: string): FileProjectReference {
  const reference: FileProjectReference | undefined =
    FILE_PROJECT_REFERENCES.find(
      (candidate: FileProjectReference): boolean => {
        return (
          candidate.table === table && candidate.fileIdColumn === fileIdColumn
        );
      },
    );

  expect(reference).toBeDefined();

  return reference!;
}

describePostgres("BackfillFileOwners against Postgres", () => {
  const schema: string = `file_owner_backfill_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const migration: BackfillFileOwners1797900000000 =
    new BackfillFileOwners1797900000000();

  let database: DataSource;
  let runner: QueryRunner;

  async function insertFile(projectId: string | null = null): Promise<string> {
    const fileId: string = id();

    await runner.query(
      `INSERT INTO "File" ("_id", "projectId") VALUES ($1, $2)`,
      [fileId, projectId],
    );

    return fileId;
  }

  // A record of `projectId` pointing at `fileId` the way `reference` does.
  async function point(
    reference: FileProjectReference,
    fileId: string,
    projectId: string | null,
  ): Promise<void> {
    if (reference.owner) {
      const ownerId: string = id();

      await runner.query(
        `INSERT INTO "${reference.owner.table}" ("_id", "projectId") VALUES ($1, $2)`,
        [ownerId, projectId],
      );
      await runner.query(
        `INSERT INTO "${reference.table}" ("${reference.owner.idColumn}", "${reference.fileIdColumn}") VALUES ($1, $2)`,
        [ownerId, fileId],
      );
      return;
    }

    await runner.query(
      `INSERT INTO "${reference.table}" ("projectId", "${reference.fileIdColumn}") VALUES ($1, $2)`,
      [projectId, fileId],
    );
  }

  async function ownersOf(
    fileId: string,
  ): Promise<{ projectId: string | null; createdByUserId: string | null }> {
    const rows: Array<{
      projectId: string | null;
      createdByUserId: string | null;
    }> = await runner.query(
      `SELECT "projectId", "createdByUserId" FROM "File" WHERE "_id" = $1`,
      [fileId],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["FILE_OWNER_BACKFILL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["FILE_OWNER_BACKFILL_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: [],
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    runner = database.createQueryRunner();
    await runner.connect();

    const currentSchema: Array<{ current_schema: string }> =
      await runner.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    await runner.startTransaction();

    for (const statement of createTablesSql()) {
      await runner.query(statement);
    }
  });

  afterEach(async () => {
    if (runner?.isTransactionActive) {
      await runner.rollbackTransaction();
    }
  });

  afterAll(async () => {
    if (runner) {
      await runner.release();
    }
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test.each(FILE_PROJECT_REFERENCES)(
    "a file only $table ($fileIdColumn) of one project points at takes that project",
    async (reference: FileProjectReference) => {
      const fileId: string = await insertFile();
      await point(reference, fileId, PROJECT_A);

      await migration.up(runner);

      expect((await ownersOf(fileId)).projectId).toBe(PROJECT_A);
    },
  );

  test("a file records of two projects point at stays without one", async () => {
    const fileId: string = await insertFile();
    await point(referenceTo("StatusPage", "logoFileId"), fileId, PROJECT_A);
    await point(referenceTo("IncidentPublicNoteFile", "fileId"), fileId, PROJECT_B);

    await migration.up(runner);

    expect((await ownersOf(fileId)).projectId).toBeNull();
  });

  test("a file several records of one project point at takes that project", async () => {
    const fileId: string = await insertFile();
    await point(referenceTo("StatusPage", "logoFileId"), fileId, PROJECT_A);
    await point(referenceTo("StatusPage", "faviconFileId"), fileId, PROJECT_A);
    await point(referenceTo("Dashboard", "logoFileId"), fileId, PROJECT_A);
    await point(
      referenceTo("StatusPageAnnouncementFile", "fileId"),
      fileId,
      PROJECT_A,
    );

    await migration.up(runner);

    expect((await ownersOf(fileId)).projectId).toBe(PROJECT_A);
  });

  test("a record outside any project claims nothing", async () => {
    const globalOnly: string = await insertFile();
    await point(referenceTo("Probe", "iconFileId"), globalOnly, null);

    const globalAndProject: string = await insertFile();
    await point(referenceTo("AIAgent", "iconFileId"), globalAndProject, null);
    await point(referenceTo("AIAgent", "iconFileId"), globalAndProject, PROJECT_B);

    await migration.up(runner);

    expect((await ownersOf(globalOnly)).projectId).toBeNull();
    expect((await ownersOf(globalAndProject)).projectId).toBe(PROJECT_B);
  });

  test("a file that has a project keeps it, whatever points at it", async () => {
    const fileId: string = await insertFile(PROJECT_B);
    await point(referenceTo("StatusPage", "coverImageFileId"), fileId, PROJECT_A);

    await migration.up(runner);

    expect((await ownersOf(fileId)).projectId).toBe(PROJECT_B);
  });

  test("a file nothing points at stays without a project", async () => {
    const fileId: string = await insertFile();

    await migration.up(runner);

    expect(await ownersOf(fileId)).toEqual({
      projectId: null,
      createdByUserId: null,
    });
  });

  test("a profile picture takes the one user who has it", async () => {
    const pictureId: string = await insertFile();
    const userId: string = id();

    await runner.query(
      `INSERT INTO "User" ("_id", "profilePictureId") VALUES ($1, $2)`,
      [userId, pictureId],
    );

    await migration.up(runner);

    expect(await ownersOf(pictureId)).toEqual({
      projectId: null,
      createdByUserId: userId,
    });
  });

  test("a picture two users share takes neither", async () => {
    const pictureId: string = await insertFile();

    for (const userId of [id(), id()]) {
      await runner.query(
        `INSERT INTO "User" ("_id", "profilePictureId") VALUES ($1, $2)`,
        [userId, pictureId],
      );
    }

    await migration.up(runner);

    expect((await ownersOf(pictureId)).createdByUserId).toBeNull();
  });

  test("touches no file but the ones it gives an owner", async () => {
    const own: string = await insertFile();
    await point(referenceTo("Form", "logoFileId"), own, PROJECT_A);
    const untouched: string = await insertFile(PROJECT_B);

    await migration.up(runner);

    expect((await ownersOf(own)).projectId).toBe(PROJECT_A);
    expect(await ownersOf(untouched)).toEqual({
      projectId: PROJECT_B,
      createdByUserId: null,
    });
  });

  test("down() takes the uploader column away again", async () => {
    await migration.up(runner);
    await migration.down(runner);

    const columns: Array<{ column_name: string }> = await runner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'File'`,
      [schema],
    );

    expect(
      columns
        .map((column: { column_name: string }): string => {
          return column.column_name;
        })
        .sort(),
    ).toEqual(["_id", "deletedAt", "projectId"]);
  });
});
