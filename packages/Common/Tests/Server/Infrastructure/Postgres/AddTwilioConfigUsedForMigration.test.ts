import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import { TwilioConfigUse } from "../../../../Types/CallAndSMS/TwilioConfigUse";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddTwilioConfigUsedFor1806100000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806100000000-AddTwilioConfigUsedFor";

/*
 * THE MIGRATION THAT SAYS WHAT EVERY TWILIO CONFIG IS USED FOR.
 *
 * Two columns - a project's config's usedFor and the server's account's
 * twilioUsedFor - NOT NULL with the default "Calls and SMS": every existing
 * config reads as used for calls and SMS the moment the column is added,
 * and sends exactly as it did. A constant default is stored in the catalog,
 * so no row is rewritten and no backfill runs.
 *
 * The SQL was generated (npm run generate-postgres-migration) and the
 * schema drift job proves it matches the models. Pinned here: that up()
 * adds exactly those two columns with that default, that down() takes back
 * exactly them, that the migration and the models describe the same
 * columns, and that it is registered after every migration before it.
 */

const MIGRATION_TIMESTAMP: string = "1806100000000";
const MIGRATION_NAME: string = "AddTwilioConfigUsedFor";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_NAME}${MIGRATION_TIMESTAMP}`;
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}.ts`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

const ADD_STATEMENTS: Array<string> = [
  `ALTER TABLE "ProjectCallSMSConfig" ADD "usedFor" character varying(${ColumnLength.ShortText}) NOT NULL DEFAULT 'Calls and SMS'`,
  `ALTER TABLE "GlobalConfig" ADD "twilioUsedFor" character varying(${ColumnLength.ShortText}) NOT NULL DEFAULT 'Calls and SMS'`,
];

const DROP_STATEMENTS: Array<string> = [
  `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioUsedFor"`,
  `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "usedFor"`,
];

type RecordingRunner = {
  runner: QueryRunner;
  statements: Array<string>;
};

function recordingRunner(): RecordingRunner {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return { runner: { query } as unknown as QueryRunner, statements };
}

type TwilioModelClass = typeof ProjectCallSMSConfig | typeof GlobalConfig;

function typeOrmColumn(
  target: TwilioModelClass,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === propertyName;
    },
  );
}

describe("running it", () => {
  test("up() adds the two columns, and does nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await new AddTwilioConfigUsedFor1806100000000().up(runner);

    expect(statements).toEqual(ADD_STATEMENTS);
  });

  test("down() drops exactly what up() added, in reverse, and nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await new AddTwilioConfigUsedFor1806100000000().down(runner);

    expect(statements).toEqual(DROP_STATEMENTS);
  });

  /*
   * The default is the value every existing config is read with: calls and
   * SMS, what each one did before. A constant default rewrites no rows, and
   * nothing else touches them.
   */
  test("every existing row reads as used for calls and SMS, with no backfill", async () => {
    const { runner, statements } = recordingRunner();

    await new AddTwilioConfigUsedFor1806100000000().up(runner);

    for (const statement of statements) {
      expect(statement).toContain(`DEFAULT '${TwilioConfigUse.CallsAndSms}'`);
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain(";");
    }
  });

  test("is a MigrationInterface whose two steps are up and down", () => {
    const migration: MigrationInterface =
      new AddTwilioConfigUsedFor1806100000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddTwilioConfigUsedFor1806100000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the migration and the models", () => {
  test.each([
    [ProjectCallSMSConfig, "usedFor"],
    [GlobalConfig, "twilioUsedFor"],
  ] as Array<[TwilioModelClass, string]>)(
    "describe the same column: %p.%s, NOT NULL, defaulting to calls and SMS",
    (target: TwilioModelClass, column: string) => {
      const options: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
        target,
        column,
      )?.options;

      expect(options).toBeDefined();
      expect(options!.type).toBe(ColumnType.ShortText);
      expect(options!.length).toBe(ColumnLength.ShortText);
      expect(options!.nullable).toBe(false);
      expect(options!.default).toBe(TwilioConfigUse.CallsAndSms);
      expect(options!.unique).toBe(false);
    },
  );
});

describe("the migration runs", () => {
  test("it is registered, and in the exported list", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `from "./${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}"`,
    );
    expect(index).toContain(`${MIGRATION_CLASS_NAME},`);
    expect(SchemaMigrations).toContain(AddTwilioConfigUsedFor1806100000000);
  });

  test("its declared name is its class name", () => {
    expect(new AddTwilioConfigUsedFor1806100000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddTwilioConfigUsedFor1806100000000.name).toBe(MIGRATION_CLASS_NAME);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddTwilioConfigUsedFor1806100000000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlier: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(CLASS_TIMESTAMP);

      if (match) {
        earlier.push(Number(match[1]));
      }
    }

    expect(earlier.length).toBeGreaterThan(100);
    expect(Math.max(...earlier)).toBeLessThan(Number(MIGRATION_TIMESTAMP));
  });
});
