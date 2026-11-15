import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { GlobalConfigCredentialsEncryptedColumns1809126000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809126000000-GlobalConfigCredentialsEncryptedColumns";

/*
 * THE SERVER'S CREDENTIALS GET ROOM FOR THEIR CIPHERTEXT (#7739): the
 * migration behind GlobalConfig's credential columns becoming encrypted.
 *
 *  - each credential column that was a varchar becomes text, in place
 *    (ALTER COLUMN TYPE): the value stored stays for the
 *    EncryptGlobalConfigCredentials data migration to encrypt, where the
 *    generator's DROP COLUMN + ADD COLUMN would throw it away;
 *  - their unique constraints go - each write stores a different
 *    ciphertext - by the names every installation's migrations gave them;
 *  - down() puts back what was there, in the opposite order;
 *  - it is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 */

const MIGRATION_TIMESTAMP: string = "1809126000000";
const MIGRATION_BASE_NAME: string = "GlobalConfigCredentialsEncryptedColumns";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const MIGRATION_SOURCE_FILE: RegExp = /^\d{13}-.*\.ts$/;

// The columns that were a varchar: 100 characters, or no length (SendGrid's).
const WIDENED: Readonly<Record<string, string>> = {
  smtpPassword: "character varying(100)",
  twilioAuthToken: "character varying(100)",
  callAndSmsGatewaySecret: "character varying(100)",
  metaWhatsAppWebhookVerifyToken: "character varying(100)",
  telegramWebhookSecretToken: "character varying(100)",
  sendgridApiKey: "character varying",
  enterpriseLicenseKey: "character varying(100)",
};

// The columns that were unique.
const NO_LONGER_UNIQUE: ReadonlyArray<string> = [
  "smtpPassword",
  "twilioAuthToken",
  "metaWhatsAppAccessToken",
  "metaWhatsAppAppSecret",
  "metaWhatsAppWebhookVerifyToken",
  "telegramBotToken",
  "telegramWebhookSecretToken",
  "sendgridApiKey",
  "enterpriseLicenseKey",
  "enterpriseLicenseToken",
];

const DROP_CONSTRAINT: RegExp =
  /^ALTER TABLE "GlobalConfig" DROP CONSTRAINT "(UQ_[0-9a-f]{27})"$/;
const ALTER_TYPE: RegExp =
  /^ALTER TABLE "GlobalConfig" ALTER COLUMN "([A-Za-z]+)" TYPE (.+)$/;
const ADD_UNIQUE: RegExp =
  /^ALTER TABLE "GlobalConfig" ADD CONSTRAINT "(UQ_[0-9a-f]{27})" UNIQUE \("([A-Za-z]+)"\)$/;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new GlobalConfigCredentialsEncryptedColumns1809126000000()[step](
    runner,
  );

  return statements;
}

// The name TypeORM gives a column's unique constraint, on every installation.
function uniqueConstraintOf(column: string): string {
  return new DefaultNamingStrategy().uniqueConstraintName("GlobalConfig", [
    column,
  ]);
}

function columnOf(column: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (entry: ColumnMetadataArgs): boolean => {
      return entry.target === GlobalConfig && entry.propertyName === column;
    },
  );
}

// Every earlier migration's statements, to find where a constraint was made.
function earlierMigrationSources(): Array<{ file: string; source: string }> {
  return fs
    .readdirSync(MIGRATION_DIRECTORY)
    .filter((file: string): boolean => {
      return (
        MIGRATION_SOURCE_FILE.test(file) &&
        Number(file.slice(0, 13)) < Number(MIGRATION_TIMESTAMP)
      );
    })
    .map((file: string): { file: string; source: string } => {
      return {
        file,
        source: fs.readFileSync(path.join(MIGRATION_DIRECTORY, file), "utf8"),
      };
    });
}

describe("executing it", () => {
  test("up() drops each unique constraint and widens each varchar to text, in place", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_26512a721317adaa03d37eb00d4"`,
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "smtpPassword" TYPE text`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_bc4b634ed3ed8854b06872115a0"`,
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "twilioAuthToken" TYPE text`,
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "callAndSmsGatewaySecret" TYPE text`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_83bd5d0c54a21bfe12316fa6520"`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_d4669bf754f937bae16c4a1837c"`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_afe98d53b718f485d3d64b383b8"`,
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "metaWhatsAppWebhookVerifyToken" TYPE text`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_31520e25e0cb9d1e8c8efb66a59"`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_cab6bddc355be1d75097f372eff"`,
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "telegramWebhookSecretToken" TYPE text`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_1489dd2e4879912dd7caa0dee5c"`,
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "sendgridApiKey" TYPE text`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_89f80e8a18c3372ee150a3812c1"`,
      `ALTER TABLE "GlobalConfig" ALTER COLUMN "enterpriseLicenseKey" TYPE text`,
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_b0b9322c111c0cc629fedbb4eb3"`,
    ]);
  });

  test("up() keeps every stored value: no column is dropped or added", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/DROP COLUMN|ADD "|ADD COLUMN/);
      expect(
        DROP_CONSTRAINT.test(statement) || ALTER_TYPE.test(statement),
      ).toBe(true);
    }
  });

  test("up() drops exactly the unique constraints of the credential columns, by the names TypeORM gave them", async () => {
    const dropped: Array<string> = (await statementsOf("up"))
      .map((statement: string): string | undefined => {
        return statement.match(DROP_CONSTRAINT)?.[1];
      })
      .filter((name: string | undefined): name is string => {
        return Boolean(name);
      });

    expect(dropped.sort()).toEqual(
      NO_LONGER_UNIQUE.map(uniqueConstraintOf).sort(),
    );
  });

  test("each constraint it drops is one an earlier migration made on that column", () => {
    const sources: Array<{ file: string; source: string }> =
      earlierMigrationSources();

    for (const column of NO_LONGER_UNIQUE) {
      const made: RegExp = new RegExp(
        `CONSTRAINT "${uniqueConstraintOf(column)}" UNIQUE \\("${column}"\\)`,
      );

      expect([
        column,
        sources.some((migration: { file: string; source: string }) => {
          return made.test(migration.source);
        }),
      ]).toEqual([column, true]);
    }
  });

  test("up() widens exactly the credential columns that were a varchar, to text", async () => {
    const widened: Array<[string, string]> = (await statementsOf("up"))
      .map((statement: string): RegExpMatchArray | null => {
        return statement.match(ALTER_TYPE);
      })
      .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
        return Boolean(match);
      })
      .map((match: RegExpMatchArray): [string, string] => {
        return [match[1]!, match[2]!];
      });

    expect(widened).toEqual(
      Object.keys(WIDENED).map((column: string): [string, string] => {
        return [column, "text"];
      }),
    );
  });

  test("down() puts back each type and constraint, in the opposite order", async () => {
    const up: Array<string> = await statementsOf("up");
    const down: Array<string> = await statementsOf("down");

    expect(down).toHaveLength(up.length);

    const undo: Array<string> = [...up].reverse().map((statement: string) => {
      const drop: RegExpMatchArray | null = statement.match(DROP_CONSTRAINT);

      if (drop) {
        const column: string | undefined = NO_LONGER_UNIQUE.find(
          (candidate: string): boolean => {
            return uniqueConstraintOf(candidate) === drop[1];
          },
        );

        return `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "${drop[1]}" UNIQUE ("${column}")`;
      }

      const alter: RegExpMatchArray = statement.match(ALTER_TYPE)!;

      return `ALTER TABLE "GlobalConfig" ALTER COLUMN "${alter[1]}" TYPE ${WIDENED[alter[1]!]}`;
    });

    expect(down).toEqual(undo);

    for (const statement of down) {
      expect(ADD_UNIQUE.test(statement) || ALTER_TYPE.test(statement)).toBe(
        true,
      );
    }
  });

  test("builds no index and adds no foreign key, so no online DDL is owed", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/INDEX|FOREIGN KEY/);
    }
  });
});

describe("the columns it leaves", () => {
  test("every column it touches is an encrypted text column of the model, not unique", async () => {
    const touched: Set<string> = new Set<string>([
      ...Object.keys(WIDENED),
      ...NO_LONGER_UNIQUE,
    ]);
    const model: GlobalConfig = new GlobalConfig();

    for (const column of touched) {
      expect([
        column,
        model.getTableColumnMetadata(column).encrypted,
        columnOf(column)?.options.type,
        Boolean(columnOf(column)?.options.unique),
      ]).toEqual([column, true, "text", false]);
    }
  });

  test("every encrypted column of the model is text and has no unique constraint left", () => {
    const model: GlobalConfig = new GlobalConfig();

    for (const column of model.getEncryptedColumns().columns) {
      expect([
        column,
        columnOf(column)?.options.type,
        Boolean(columnOf(column)?.options.unique),
      ]).toEqual([column, "text", false]);
    }
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(
      new GlobalConfigCredentialsEncryptedColumns1809126000000().name,
    ).toBe(MIGRATION_CLASS_NAME);
  });

  test("it is registered once, after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const position: number = names.indexOf(MIGRATION_CLASS_NAME);

    expect(position).toBeGreaterThan(-1);
    expect(names.lastIndexOf(MIGRATION_CLASS_NAME)).toBe(position);

    for (const earlier of names.slice(0, position)) {
      const timestamp: string | undefined = earlier.match(CLASS_TIMESTAMP)?.[1];

      if (timestamp) {
        expect([
          earlier,
          Number(timestamp) < Number(MIGRATION_TIMESTAMP),
        ]).toEqual([earlier, true]);
      }
    }
  });
});
