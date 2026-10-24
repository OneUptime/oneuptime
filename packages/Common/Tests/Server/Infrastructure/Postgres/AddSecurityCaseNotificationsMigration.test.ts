import { AddSecurityCaseNotifications1805700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805700000000-AddSecurityCaseNotifications";
import { AddSecurityCasePrioritiesAndStatuses1807200000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807200000000-AddSecurityCasePrioritiesAndStatuses";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The migration behind security case notifications: the highest priority
 * people were told about a case at (SecurityCase.notifiedPriority), and the
 * priority a person chose on their New Security Case setting
 * (UserNotificationSetting.minimumSecurityCasePriority).
 *
 * It pins that the statements add the columns exactly as TypeORM generated
 * them, that both are nullable with no default - so no existing row is
 * rewritten and an empty choice reads as the default, High - that down()
 * undoes up() in reverse, and that the migration is registered where it runs
 * after everything before it. Fake QueryRunner only.
 *
 * Both columns held a priority's text. AddSecurityCasePrioritiesAndStatuses
 * (1807200000000) replaced each with the id of one of the project's own
 * priorities, and dropped them: the models declare them no more, and that
 * migration is what puts them back, as they were here, on its way down.
 */

const OWN_CLASS_NAME: string = "AddSecurityCaseNotifications1805700000000";

const OWN_TIMESTAMP: number = 1805700000000;

const PREVIOUS_CLASS_NAME: string = "AddAIRunHandedBackCount1805650000000";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_FILE: string = "1805700000000-AddSecurityCaseNotifications.ts";

interface AddedColumn {
  table: string;
  model: unknown;
  column: string;
}

// In the order up() adds them.
const COLUMNS: Array<AddedColumn> = [
  { table: "SecurityCase", model: SecurityCase, column: "notifiedPriority" },
  {
    table: "UserNotificationSetting",
    model: UserNotificationSetting,
    column: "minimumSecurityCasePriority",
  },
];

type MigrationClass = new () => MigrationInterface;

const registered: Array<MigrationClass> =
  SchemaMigrations as unknown as Array<MigrationClass>;

const registeredNames: Array<string> = registered.map(
  (migration: MigrationClass): string => {
    return migration.name;
  },
);

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddSecurityCaseNotifications1805700000000()[direction](queryRunner);

  return statements;
}

// What the later migration that replaced these columns runs, on a database that answers nothing.
async function recordLaterQueries(
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement);
      return [];
    },
  } as unknown as QueryRunner;

  await new AddSecurityCasePrioritiesAndStatuses1807200000000()[direction](
    queryRunner,
  );

  return statements;
}

function declaredColumn(entry: AddedColumn): ColumnMetadataArgs {
  const declared: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return (
          column.target === entry.model && column.propertyName === entry.column
        );
      },
    );

  if (!declared) {
    throw new Error(`${entry.table}.${entry.column} is not on the model.`);
  }

  return declared;
}

function expectedDropStatement(entry: AddedColumn): string {
  return `ALTER TABLE "${entry.table}" DROP COLUMN "${entry.column}"`;
}

describe("AddSecurityCaseNotifications migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, MIGRATION_FILE),
      "utf8",
    );

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddSecurityCaseNotifications1805700000000().name).toBe(
      OWN_CLASS_NAME,
    );
    expect(AddSecurityCaseNotifications1805700000000.name).toBe(OWN_CLASS_NAME);
    expect(timestampOfClassName(OWN_CLASS_NAME)).toBe(OWN_TIMESTAMP);
  });

  test("is the only file on its timestamp", () => {
    const files: Array<string> = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file: string): boolean => {
        return file.startsWith(`${OWN_TIMESTAMP}-`);
      });

    expect(files).toEqual([MIGRATION_FILE]);
  });

  test("runs in a transaction, like every migration that only adds columns", () => {
    expect(
      (
        new AddSecurityCaseNotifications1805700000000() as unknown as {
          transaction?: boolean;
        }
      ).transaction,
    ).toBeUndefined();
  });

  test("is registered once, after the migration it was numbered after", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);

    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const previousIndex: number = registeredNames.indexOf(PREVIOUS_CLASS_NAME);

    expect(previousIndex).toBeGreaterThanOrEqual(0);
    expect(ownIndex).toBeGreaterThan(previousIndex);
  });

  test("runs after every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    expect(
      registeredNames.slice(0, ownIndex).filter((className: string) => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= OWN_TIMESTAMP;
      }),
    ).toEqual([]);
  });

  test("is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${OWN_CLASS_NAME} } from "./1805700000000-AddSecurityCaseNotifications";`,
    );
    expect(index.match(new RegExp(`\\b${OWN_CLASS_NAME},`, "g"))).toHaveLength(
      1,
    );
  });
});

describe("AddSecurityCaseNotifications migration - up()", () => {
  test("added two columns the models no longer declare: a later migration replaced each with an id", async () => {
    for (const entry of COLUMNS) {
      expect(() => {
        return declaredColumn(entry);
      }).toThrow(`${entry.table}.${entry.column} is not on the model.`);
    }

    const later: Array<string> = await recordLaterQueries("up");

    for (const entry of COLUMNS) {
      expect(later).toContain(expectedDropStatement(entry));
    }
  });

  test("the later migration's down() puts each back exactly as it was added here", async () => {
    const added: Array<string> = await recordQueries("up");
    const restored: Array<string> = await recordLaterQueries("down");

    for (const statement of added) {
      expect(restored).toContain(statement);
    }
  });

  test("writes the statements TypeORM generated for these columns", async () => {
    expect(await recordQueries("up")).toEqual([
      `ALTER TABLE "SecurityCase" ADD "notifiedPriority" character varying(100)`,
      `ALTER TABLE "UserNotificationSetting" ADD "minimumSecurityCasePriority" character varying(100)`,
    ]);
  });

  test("adds each nullable, with no default, so no existing row is rewritten", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).toMatch(/^ALTER TABLE "\w+" ADD "\w+" character varying\(100\)$/);
    }
  });

  test("backfills nothing and builds no index", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(
        /UPDATE|ALTER COLUMN|INDEX|CONSTRAINT|DEFAULT|NOT NULL/,
      );
    }
  });
});

describe("AddSecurityCaseNotifications migration - down()", () => {
  test("drops exactly the two columns, in the reverse of the order up() added them", async () => {
    expect(await recordQueries("down")).toEqual(
      [...COLUMNS].reverse().map((entry: AddedColumn): string => {
        return expectedDropStatement(entry);
      }),
    );
  });
});
