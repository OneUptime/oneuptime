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
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddTwilioSmsPhoneNumbers1804700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804700000000-AddTwilioSmsPhoneNumbers";

/*
 * THE MIGRATION THAT GIVES TWILIO CONFIGS NUMBERS FOR SMS.
 *
 * Four nullable columns - the SMS phone number and the SMS secondary
 * numbers, on a project's Twilio config and on the server's own - and
 * nothing else. NULL is what every existing config holds afterwards, and it
 * means "SMS go out from the numbers calls do", which is exactly what every
 * config did before: so no backfill, no default and no NOT NULL, and every
 * existing project and installation sends as it did the moment it upgrades.
 *
 * The SQL was generated (npm run generate-postgres-migration) and the
 * schema drift job proves it matches the models. Pinned here: that up()
 * adds only those four columns, that down() takes back exactly them, that
 * the migration and the models describe the same columns, and that it is
 * registered after every migration before it.
 */

const MIGRATION_TIMESTAMP: string = "1804700000000";
const MIGRATION_NAME: string = "AddTwilioSmsPhoneNumbers";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_NAME}${MIGRATION_TIMESTAMP}`;
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}.ts`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

const ADD_STATEMENTS: Array<string> = [
  `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioSmsPhoneNumber" character varying(${ColumnLength.Phone})`,
  `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioSmsSecondaryPhoneNumbers" character varying(${ColumnLength.LongText})`,
  `ALTER TABLE "GlobalConfig" ADD "twilioSmsPhoneNumber" character varying(${ColumnLength.Phone})`,
  `ALTER TABLE "GlobalConfig" ADD "twilioSmsSecondaryPhoneNumbers" character varying(${ColumnLength.LongText})`,
];

const DROP_STATEMENTS: Array<string> = [
  `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioSmsSecondaryPhoneNumbers"`,
  `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioSmsPhoneNumber"`,
  `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioSmsSecondaryPhoneNumbers"`,
  `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioSmsPhoneNumber"`,
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

function typeOrmColumn(
  target: object,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === propertyName;
    },
  );
}

describe("running it", () => {
  test("up() adds the four columns, and does nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await new AddTwilioSmsPhoneNumbers1804700000000().up(runner);

    expect(statements).toEqual(ADD_STATEMENTS);
  });

  test("down() drops exactly what up() added, in reverse, and nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await new AddTwilioSmsPhoneNumbers1804700000000().down(runner);

    expect(statements).toEqual(DROP_STATEMENTS);
  });

  /*
   * NULL is "SMS go out from the numbers calls do" - what every config did -
   * so an existing row needs no value, and no row is rewritten.
   */
  test("no column arrives with a default, a NOT NULL, or a backfill", async () => {
    const { runner, statements } = recordingRunner();

    await new AddTwilioSmsPhoneNumbers1804700000000().up(runner);

    for (const statement of statements) {
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain(";");
    }
  });

  test("is a MigrationInterface whose two steps are up and down", () => {
    const migration: MigrationInterface =
      new AddTwilioSmsPhoneNumbers1804700000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddTwilioSmsPhoneNumbers1804700000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the migration and the models", () => {
  /*
   * ColumnType.Phone and ColumnType.LongText are both varchar: the length
   * tells them apart, and is what the migration writes.
   */
  test.each([
    [
      ProjectCallSMSConfig,
      "twilioSmsPhoneNumber",
      ColumnType.Phone,
      ColumnLength.Phone,
    ],
    [
      ProjectCallSMSConfig,
      "twilioSmsSecondaryPhoneNumbers",
      ColumnType.LongText,
      ColumnLength.LongText,
    ],
    [GlobalConfig, "twilioSmsPhoneNumber", ColumnType.Phone, ColumnLength.Phone],
    [
      GlobalConfig,
      "twilioSmsSecondaryPhoneNumbers",
      ColumnType.LongText,
      ColumnLength.LongText,
    ],
  ] as Array<[object, string, ColumnType, ColumnLength]>)(
    "describe the same column: %p.%s, nullable, without a default",
    (target: object, column: string, type: ColumnType, length: ColumnLength) => {
      const options: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
        target,
        column,
      )?.options;

      expect(options).toBeDefined();
      expect(options!.type).toBe(type);
      expect(options!.length).toBe(length);
      expect(options!.nullable).toBe(true);
      expect(options!.default).toBeUndefined();
      expect(options!.unique).toBe(false);
    },
  );

  test("each SMS column is the same kind as the column it stands in for", () => {
    for (const target of [ProjectCallSMSConfig, GlobalConfig]) {
      expect(
        typeOrmColumn(target, "twilioSmsPhoneNumber")?.options.type,
      ).toBe(typeOrmColumn(target, "twilioPrimaryPhoneNumber")?.options.type);
      expect(
        typeOrmColumn(target, "twilioSmsSecondaryPhoneNumbers")?.options.length,
      ).toBe(
        typeOrmColumn(target, "twilioSecondaryPhoneNumbers")?.options.length,
      );
    }
  });
});

describe("the migration runs", () => {
  test("it is registered, and in the exported list", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(`from "./${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}"`);
    expect(index).toContain(`${MIGRATION_CLASS_NAME},`);
    expect(SchemaMigrations).toContain(AddTwilioSmsPhoneNumbers1804700000000);
  });

  test("its declared name is its class name", () => {
    expect(new AddTwilioSmsPhoneNumbers1804700000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddTwilioSmsPhoneNumbers1804700000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
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
      AddTwilioSmsPhoneNumbers1804700000000,
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
