import ProjectCallSMSConfig from "../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import { AddTwilioConfigDefaultPerKind1809086574000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809086574000-AddTwilioConfigDefaultPerKind";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import TwilioConfigDefaults, {
  TwilioConfigDefaultFlags,
} from "../../../../Types/CallAndSMS/TwilioConfigDefaults";
import {
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "../../../../Types/CallAndSMS/TwilioConfigUse";
import TableColumnType from "../../../../Types/Database/TableColumnType";
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
import fs from "fs";
import path from "path";
import { DataSource, MigrationInterface, QueryRunner } from "typeorm";

/*
 * AddTwilioConfigDefaultPerKind1809086574000: a project has a default Twilio
 * config for SMS and one for calls (#6574). It adds
 * ProjectCallSMSConfig.isProjectDefaultForSms and isProjectDefaultForCalls,
 * and moves each project's one default onto them, so every message goes
 * where it went before: the default becomes the default for what it is used
 * for. A project with more than one default keeps the first one made.
 *
 * The SQL contract runs up() and down() against a fake QueryRunner. The
 * Postgres half runs them on real rows - opt in with
 * RUN_POSTGRES_TWILIO_DEFAULT_PER_KIND_MIGRATION_TESTS=true (the Common test
 * job does) - in a uniquely named schema whose search_path leaves public
 * out: a stand-in table with the columns the migration reads, as they were
 * before it. Each project the migration leaves is one the server's rule
 * (Types/CallAndSMS/TwilioConfigDefaults) finds settled, so the next write
 * moves nothing it does not ask to.
 */

const MIGRATION_TIMESTAMP: string = "1809086574000";
const MIGRATION_BASE_NAME: string = "AddTwilioConfigDefaultPerKind";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

const NEW_COLUMNS: Array<string> = [
  "isProjectDefaultForSms",
  "isProjectDefaultForCalls",
];

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;

  await new AddTwilioConfigDefaultPerKind1809086574000()[direction](runner);

  return statements;
}

describe("AddTwilioConfigDefaultPerKind1809086574000 SQL contract", () => {
  test("adds the two columns, false for every config, then moves each project's default onto them", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements).toHaveLength(4);
    expect(statements.slice(0, 2)).toEqual([
      `ALTER TABLE "ProjectCallSMSConfig" ADD "isProjectDefaultForSms" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "ProjectCallSMSConfig" ADD "isProjectDefaultForCalls" boolean NOT NULL DEFAULT false`,
    ]);

    for (const statement of statements.slice(2)) {
      expect(statement).toMatch(/^UPDATE "ProjectCallSMSConfig" /);
    }
  });

  test("builds no index, adds no key, and neither inserts nor deletes a row", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /\b(CREATE|DROP|DELETE|INSERT|TRUNCATE)\b|FOREIGN KEY/i,
      );
    }
  });

  test("reads what a config is used for as the column stores it", async () => {
    const backfill: string = (await statementsOf("up"))[2]!;

    /*
     * A config for calls only takes no SMS, and one for SMS only no calls;
     * any other - calls and SMS - takes both.
     */
    expect(backfill).toContain(
      `"isProjectDefaultForSms" = ("config"."usedFor" IS DISTINCT FROM '${TwilioConfigUse.CallsOnly}')`,
    );
    expect(backfill).toContain(
      `"isProjectDefaultForCalls" = ("config"."usedFor" IS DISTINCT FROM '${TwilioConfigUse.SmsOnly}')`,
    );
  });

  test("touches only the live defaults", async () => {
    const [backfill, settle]: Array<string> = (await statementsOf("up")).slice(
      2,
    );

    expect(backfill).toContain(
      `WHERE "config"."isProjectDefault" = true AND "config"."deletedAt" IS NULL AND NOT EXISTS`,
    );
    expect(settle).toBe(
      `UPDATE "ProjectCallSMSConfig" SET "isProjectDefault" = false WHERE "isProjectDefault" = true AND "deletedAt" IS NULL AND "isProjectDefaultForSms" = false AND "isProjectDefaultForCalls" = false`,
    );
  });

  test("down() drops the two columns, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "isProjectDefaultForCalls"`,
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "isProjectDefaultForSms"`,
    ]);
  });

  test("is registered once, named for its class, and ordered after every migration before it", () => {
    const registered: Array<new () => MigrationInterface> =
      SchemaMigrations.filter(
        (migration: new () => MigrationInterface): boolean => {
          return migration === AddTwilioConfigDefaultPerKind1809086574000;
        },
      );

    expect(registered).toHaveLength(1);
    expect(new AddTwilioConfigDefaultPerKind1809086574000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);

    const at: number = SchemaMigrations.indexOf(
      AddTwilioConfigDefaultPerKind1809086574000,
    );

    for (const earlier of SchemaMigrations.slice(0, at)) {
      const name: string = new earlier().name || "";
      const match: RegExpMatchArray | null = name.match(TIMESTAMP_OF_NAME);
      const timestamp: number = match ? parseInt(match[1]!, 10) : 0;

      expect({
        name,
        isEarlier: timestamp < parseInt(MIGRATION_TIMESTAMP, 10),
      }).toEqual({ name, isEarlier: true });
    }
  });

  test("matches the model it was generated from", () => {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    for (const column of NEW_COLUMNS) {
      const metadata: ReturnType<typeof config.getTableColumnMetadata> =
        config.getTableColumnMetadata(column);

      expect({
        column,
        type: metadata.type,
        required: metadata.required,
        defaultValue: metadata.defaultValue,
        isDefaultValueColumn: metadata.isDefaultValueColumn,
      }).toEqual({
        column,
        type: TableColumnType.Boolean,
        required: true,
        defaultValue: false,
        isDefaultValueColumn: true,
      });
    }
  });
});

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TWILIO_DEFAULT_PER_KIND_MIGRATION_TESTS"] === "true"
    ? describe
    : describe.skip;

interface ConfigSeed {
  projectId: string;
  use: TwilioConfigUse;
  isProjectDefault: boolean;
  createdAt: string;
  id?: string | undefined;
  isDeleted?: boolean | undefined;
}

interface StoredConfig {
  _id: string;
  usedFor: string;
  isProjectDefault: boolean;
  isProjectDefaultForSms: boolean;
  isProjectDefaultForCalls: boolean;
  isDeleted: boolean;
}

const NO_DEFAULT: TwilioConfigDefaultFlags = {
  isProjectDefault: false,
  isProjectDefaultForSms: false,
  isProjectDefaultForCalls: false,
};

const DEFAULT_FOR_BOTH: TwilioConfigDefaultFlags = {
  isProjectDefault: true,
  isProjectDefaultForSms: true,
  isProjectDefaultForCalls: true,
};

describePostgres("AddTwilioConfigDefaultPerKind against Postgres", () => {
  const schema: string = `twilio_default_per_kind_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const migration: AddTwilioConfigDefaultPerKind1809086574000 =
    new AddTwilioConfigDefaultPerKind1809086574000();

  let database: DataSource;
  let runner: QueryRunner;

  async function insert(seed: ConfigSeed): Promise<string> {
    const id: string = seed.id || ObjectID.generate().toString();

    await runner.query(
      `INSERT INTO "ProjectCallSMSConfig" ("_id", "createdAt", "projectId", "usedFor", "isProjectDefault", "deletedAt") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        seed.createdAt,
        seed.projectId,
        seed.use,
        seed.isProjectDefault,
        seed.isDeleted ? seed.createdAt : null,
      ],
    );

    return id;
  }

  // A project's configs, as the migration left them, by id.
  async function readProject(
    projectId: string,
  ): Promise<Map<string, StoredConfig>> {
    const rows: Array<StoredConfig> = await runner.query(
      `SELECT "_id", "usedFor", "isProjectDefault", "isProjectDefaultForSms", "isProjectDefaultForCalls", "deletedAt" IS NOT NULL AS "isDeleted" FROM "ProjectCallSMSConfig" WHERE "projectId" = $1`,
      [projectId],
    );

    return new Map(
      rows.map((row: StoredConfig): [string, StoredConfig] => {
        return [row._id, row];
      }),
    );
  }

  function flagsOf(row: StoredConfig | undefined): TwilioConfigDefaultFlags {
    expect(row).toBeDefined();

    return {
      isProjectDefault: row!.isProjectDefault,
      isProjectDefaultForSms: row!.isProjectDefaultForSms,
      isProjectDefaultForCalls: row!.isProjectDefaultForCalls,
    };
  }

  /*
   * The server's rule finds nothing to change in the project's live
   * configs: no write is needed to bring them to it, so the next one moves
   * only what it asks to.
   */
  function expectSettled(rows: Map<string, StoredConfig>): void {
    const live: Array<StoredConfig> = Array.from(rows.values()).filter(
      (row: StoredConfig): boolean => {
        return !row.isDeleted;
      },
    );

    expect(
      TwilioConfigDefaults.getProjectDefaultChanges({
        configs: live.map((row: StoredConfig) => {
          return {
            id: row._id,
            use: row.usedFor,
            isProjectDefault: row.isProjectDefault,
            isProjectDefaultForSms: row.isProjectDefaultForSms,
            isProjectDefaultForCalls: row.isProjectDefaultForCalls,
          };
        }),
        madeDefaultIds: [],
      }),
    ).toEqual([]);
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["TWILIO_DEFAULT_PER_KIND_MIGRATION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["TWILIO_DEFAULT_PER_KIND_MIGRATION_TEST_DATABASE_PORT"] ||
          "5400",
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

    const currentSchema: Array<{ current_schema: string }> = await runner.query(
      "SELECT current_schema()",
    );
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    await runner.startTransaction();
    // The columns the migration reads, as the table declared them before it.
    await runner.query(
      `CREATE TABLE "ProjectCallSMSConfig" ("_id" uuid PRIMARY KEY, "createdAt" timestamp with time zone NOT NULL DEFAULT now(), "projectId" uuid NOT NULL, "usedFor" character varying NOT NULL DEFAULT '${TwilioConfigUse.CallsAndSms}', "isProjectDefault" boolean NOT NULL DEFAULT false, "deletedAt" timestamp with time zone)`,
    );
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

  test.each([...TWILIO_CONFIG_USES])(
    "a project's one default, used for %s, becomes the default for what it sends",
    async (use: TwilioConfigUse) => {
      const projectId: string = ObjectID.generate().toString();
      const id: string = await insert({
        projectId,
        use,
        isProjectDefault: true,
        createdAt: "2026-11-01T00:00:00Z",
      });

      await migration.up(runner);

      const rows: Map<string, StoredConfig> = await readProject(projectId);

      expect(flagsOf(rows.get(id))).toEqual({
        isProjectDefault: true,
        isProjectDefaultForSms: use !== TwilioConfigUse.CallsOnly,
        isProjectDefaultForCalls: use !== TwilioConfigUse.SmsOnly,
      });
      expectSettled(rows);
    },
  );

  test("a config that is no default stays the default for nothing", async () => {
    const projectId: string = ObjectID.generate().toString();
    const theDefault: string = await insert({
      projectId,
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      createdAt: "2026-11-01T00:00:00Z",
    });
    const other: string = await insert({
      projectId,
      use: TwilioConfigUse.SmsOnly,
      isProjectDefault: false,
      createdAt: "2026-11-02T00:00:00Z",
    });

    await migration.up(runner);

    const rows: Map<string, StoredConfig> = await readProject(projectId);

    expect(flagsOf(rows.get(theDefault))).toEqual(DEFAULT_FOR_BOTH);
    expect(flagsOf(rows.get(other))).toEqual(NO_DEFAULT);
    expectSettled(rows);
  });

  test("of two defaults, the first made keeps it, and the other is no default", async () => {
    const projectId: string = ObjectID.generate().toString();
    const first: string = await insert({
      projectId,
      use: TwilioConfigUse.CallsOnly,
      isProjectDefault: true,
      createdAt: "2026-11-01T00:00:00Z",
    });
    const second: string = await insert({
      projectId,
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      createdAt: "2026-11-02T00:00:00Z",
    });

    await migration.up(runner);

    const rows: Map<string, StoredConfig> = await readProject(projectId);

    /*
     * The first one's calls go through it as before, and the SMS it could
     * not send through OneUptime's own account, as before.
     */
    expect(flagsOf(rows.get(first))).toEqual({
      isProjectDefault: true,
      isProjectDefaultForSms: false,
      isProjectDefaultForCalls: true,
    });
    expect(flagsOf(rows.get(second))).toEqual(NO_DEFAULT);
    expectSettled(rows);
  });

  test("of two defaults made at the same moment, the lower id is the first", async () => {
    const projectId: string = ObjectID.generate().toString();
    const higher: string = await insert({
      id: "00000000-0000-4000-8000-000000000002",
      projectId,
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      createdAt: "2026-11-01T00:00:00Z",
    });
    const lower: string = await insert({
      id: "00000000-0000-4000-8000-000000000001",
      projectId,
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      createdAt: "2026-11-01T00:00:00Z",
    });

    await migration.up(runner);

    const rows: Map<string, StoredConfig> = await readProject(projectId);

    expect(flagsOf(rows.get(lower))).toEqual(DEFAULT_FOR_BOTH);
    expect(flagsOf(rows.get(higher))).toEqual(NO_DEFAULT);
    expectSettled(rows);
  });

  test("a deleted config is left as it is, and is not the first made", async () => {
    const projectId: string = ObjectID.generate().toString();
    const deleted: string = await insert({
      projectId,
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      createdAt: "2026-10-01T00:00:00Z",
      isDeleted: true,
    });
    const live: string = await insert({
      projectId,
      use: TwilioConfigUse.SmsOnly,
      isProjectDefault: true,
      createdAt: "2026-11-01T00:00:00Z",
    });

    await migration.up(runner);

    const rows: Map<string, StoredConfig> = await readProject(projectId);

    expect(flagsOf(rows.get(deleted))).toEqual({
      isProjectDefault: true,
      isProjectDefaultForSms: false,
      isProjectDefaultForCalls: false,
    });
    expect(flagsOf(rows.get(live))).toEqual({
      isProjectDefault: true,
      isProjectDefaultForSms: true,
      isProjectDefaultForCalls: false,
    });
    expectSettled(rows);
  });

  test("a project's configs are read apart from every other project's", async () => {
    const earlierProject: string = ObjectID.generate().toString();
    const laterProject: string = ObjectID.generate().toString();
    const earlier: string = await insert({
      projectId: earlierProject,
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      createdAt: "2026-10-01T00:00:00Z",
    });
    const later: string = await insert({
      projectId: laterProject,
      use: TwilioConfigUse.CallsOnly,
      isProjectDefault: true,
      createdAt: "2026-11-01T00:00:00Z",
    });

    await migration.up(runner);

    expect(flagsOf((await readProject(earlierProject)).get(earlier))).toEqual(
      DEFAULT_FOR_BOTH,
    );
    expect(flagsOf((await readProject(laterProject)).get(later))).toEqual({
      isProjectDefault: true,
      isProjectDefaultForSms: false,
      isProjectDefaultForCalls: true,
    });
  });

  test("down() drops the two columns, and the project keeps the one default up left it", async () => {
    const projectId: string = ObjectID.generate().toString();
    const first: string = await insert({
      projectId,
      use: TwilioConfigUse.SmsOnly,
      isProjectDefault: true,
      createdAt: "2026-11-01T00:00:00Z",
    });
    await insert({
      projectId,
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      createdAt: "2026-11-02T00:00:00Z",
    });

    await migration.up(runner);
    await migration.down(runner);

    const columns: Array<{ column_name: string }> = await runner.query(
      `SELECT "column_name" FROM information_schema.columns WHERE "table_schema" = $1 AND "table_name" = 'ProjectCallSMSConfig'`,
      [schema],
    );

    expect(
      columns
        .map((column: { column_name: string }): string => {
          return column.column_name;
        })
        .filter((name: string): boolean => {
          return NEW_COLUMNS.includes(name);
        }),
    ).toEqual([]);

    const defaults: Array<{ _id: string }> = await runner.query(
      `SELECT "_id" FROM "ProjectCallSMSConfig" WHERE "projectId" = $1 AND "isProjectDefault" = true`,
      [projectId],
    );

    expect(
      defaults.map((row: { _id: string }): string => {
        return row._id;
      }),
    ).toEqual([first]);
  });
});
