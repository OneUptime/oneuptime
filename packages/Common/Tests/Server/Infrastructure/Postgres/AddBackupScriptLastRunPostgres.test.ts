import { AddBackupScriptLastRun1809183200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183200000-AddBackupScriptLastRun";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import {
  BackupScriptRun,
  readBackupScriptRun,
  toBackupScriptRun,
} from "../../../../Types/Backup/BackupScriptRun";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner, Repository } from "typeorm";

/*
 * The AddBackupScriptLastRun migration against a real Postgres, on the real
 * settings row (issue #7026): GlobalConfig.backupScriptLastRun keeps the last
 * run of `npm run backup` for the setup checklist's Backups check.
 *
 * Opt in with RUN_POSTGRES_BACKUP_SCRIPT_RUN_TESTS=true and the normal
 * database credentials; BACKUP_SCRIPT_RUN_TEST_DATABASE_HOST / _PORT / _NAME
 * point it at a database other than the local development one. The database
 * must already be migrated: GlobalConfig is cloned from public into a
 * uniquely named schema (so the source's row is never read or modified) and
 * put back as it was before the migration - without the column - and the
 * migration's up() then runs there. The schema is dropped afterwards.
 *
 * What it pins:
 *   - additive and nullable: one jsonb column, no default, and the row a
 *     server already has keeps every value it had, the new column null - an
 *     older server's row reads as a server the script never told;
 *   - a run written through the model, as GlobalConfigService writes it,
 *     reads back whole (readBackupScriptRun), and the next run replaces it:
 *     one record, never a growing list;
 *   - down() drops the column again, and up() adds it back.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_BACKUP_SCRIPT_RUN_TESTS"] === "true"
    ? describe
    : describe.skip;

const COLUMN: string = "backupScriptLastRun";

describePostgres("AddBackupScriptLastRun against Postgres", () => {
  const schema: string = `backup_script_run_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const zeroId: string = ObjectID.getZeroObjectID().toString();
  let database: DataSource;
  let models: DataSource;

  const connection: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  } = {
    host: process.env["BACKUP_SCRIPT_RUN_TEST_DATABASE_HOST"] || "localhost",
    port: Number(process.env["BACKUP_SCRIPT_RUN_TEST_DATABASE_PORT"] || "5400"),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["BACKUP_SCRIPT_RUN_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
  };

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function columnOf(): Promise<
    Array<{
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>
  > {
    return await database.query(
      `SELECT udt_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'GlobalConfig' AND column_name = $2`,
      [schema, COLUMN],
    );
  }

  async function storedRun(): Promise<unknown> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT "${COLUMN}" FROM "${schema}"."GlobalConfig" WHERE "_id" = $1`,
      [zeroId],
    );

    expect(rows).toHaveLength(1);

    return rows[0]![COLUMN];
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      ...connection,
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."GlobalConfig" (LIKE public."GlobalConfig" INCLUDING ALL)`,
    );

    // The table as it was BEFORE the migration, whether or not the source has run it.
    await database.query(
      `ALTER TABLE "${schema}"."GlobalConfig" DROP COLUMN IF EXISTS "${COLUMN}"`,
    );

    // The one settings row a server has, with a choice and a setting on it.
    await database.query(
      `INSERT INTO "${schema}"."GlobalConfig" ("_id", "disableSignup", "serverSetupChoices", "version")
       VALUES ($1, true, $2, 1)`,
      [zeroId, JSON.stringify({ choices: {}, hiddenBy: {} })],
    );

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddBackupScriptLastRun1809183200000().up(queryRunner);
    });

    // The model, on the migrated copy: how GlobalConfigService writes and reads it.
    models = new DataSource({
      type: "postgres",
      ...connection,
      schema: schema,
      entities: [GlobalConfig],
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await models.initialize();
  });

  afterAll(async () => {
    if (models?.isInitialized) {
      await models.destroy();
    }

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("adds one nullable jsonb column with no default", async () => {
    expect(await columnOf()).toEqual([
      { udt_name: "jsonb", is_nullable: "YES", column_default: null },
    ]);
  });

  test("the row the server had keeps its values, the new column null: a server the script never told", async () => {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT "disableSignup", "serverSetupChoices", "${COLUMN}" FROM "${schema}"."GlobalConfig" WHERE "_id" = $1`,
      [zeroId],
    );

    expect(rows).toEqual([
      {
        disableSignup: true,
        serverSetupChoices: { choices: {}, hiddenBy: {} },
        [COLUMN]: null,
      },
    ]);
    expect(readBackupScriptRun(rows[0]![COLUMN])).toBeNull();
  });

  test("a run written through the model reads back whole, and the next run replaces it", async () => {
    const repository: Repository<GlobalConfig> =
      models.getRepository(GlobalConfig);

    const first: BackupScriptRun = toBackupScriptRun({
      checkIn: { succeeded: true, sizeInBytes: 7_340_032 },
      now: new Date("2026-11-16T02:00:05.000Z"),
    });

    await repository.update(
      { _id: zeroId } as never,
      { [COLUMN]: first as unknown as JSONObject } as never,
    );

    expect(readBackupScriptRun(await storedRun())).toEqual(first);

    const read: GlobalConfig | null = await repository.findOne({
      where: { _id: zeroId } as never,
    });

    expect(readBackupScriptRun(read?.backupScriptLastRun)).toEqual(first);

    const second: BackupScriptRun = toBackupScriptRun({
      checkIn: { succeeded: false, sizeInBytes: null },
      now: new Date("2026-11-17T02:00:05.000Z"),
    });

    await repository.update(
      { _id: zeroId } as never,
      { [COLUMN]: second as unknown as JSONObject } as never,
    );

    expect(await storedRun()).toEqual({
      at: "2026-11-17T02:00:05.000Z",
      succeeded: false,
      sizeInBytes: null,
    });
  });

  test("down() drops the column again, and up() adds it back", async () => {
    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddBackupScriptLastRun1809183200000().down(queryRunner);
    });

    expect(await columnOf()).toEqual([]);

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddBackupScriptLastRun1809183200000().up(queryRunner);
    });

    expect(await columnOf()).toHaveLength(1);
    expect(await storedRun()).toBeNull();
  });
});
