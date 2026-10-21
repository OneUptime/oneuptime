import { AddCriticalAlertSoundVolumeAndPushRepeat1801650000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1801650000000-AddCriticalAlertSoundVolumeAndPushRepeat";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import UserNotificationRule from "../../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../../Models/DatabaseModels/UserPush";
import ColumnType from "../../../../Types/Database/ColumnType";
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
 * The migration behind the critical alert sound and volume a device chooses
 * (UserPush.criticalAlertSound, UserPush.criticalAlertVolume) and the repeat
 * a push rule can be given (UserNotificationRule.repeatEveryMinutes).
 *
 * It pins that the statements add the columns exactly as the models declare
 * them (a mismatch is a red Schema Drift job, and a wrong default re-pages
 * or re-sounds every existing device and rule), that every existing row is
 * backfilled with the value that keeps it paging as it did - the system
 * sound, full volume, no repeat - without rewriting either table, that
 * down() undoes up() in reverse, and that the migration is registered where
 * it runs after everything before it. Fake QueryRunner only.
 */

const OWN_CLASS_NAME: string =
  "AddCriticalAlertSoundVolumeAndPushRepeat1801650000000";

const OWN_TIMESTAMP: number = 1801650000000;

const PREVIOUS_CLASS_NAME: string =
  "AddUserNotificationRulePushNotificationLevel1801600000000";

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

const MIGRATION_FILE: string =
  "1801650000000-AddCriticalAlertSoundVolumeAndPushRepeat.ts";

interface AddedColumn {
  table: string;
  model: unknown;
  column: string;
}

// In the order up() adds them.
const COLUMNS: Array<AddedColumn> = [
  { table: "UserPush", model: UserPush, column: "criticalAlertSound" },
  { table: "UserPush", model: UserPush, column: "criticalAlertVolume" },
  {
    table: "UserNotificationRule",
    model: UserNotificationRule,
    column: "repeatEveryMinutes",
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

  await new AddCriticalAlertSoundVolumeAndPushRepeat1801650000000()[direction](
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

/*
 * What TypeORM generates to add the column as its model declares it: the
 * Postgres type, NOT NULL, and the default quoted as the generator quotes
 * string and number defaults alike.
 */
function expectedAddStatement(entry: AddedColumn): string {
  const options: ColumnMetadataArgs["options"] = declaredColumn(entry).options;
  const declaredType: string = String(options.type);

  let postgresType: string;

  if (declaredType === ColumnType.ShortText) {
    postgresType = `character varying(${String(options.length)})`;
  } else if (declaredType === ColumnType.Number) {
    postgresType = "integer";
  } else {
    throw new Error(`This suite does not know how to write ${declaredType}.`);
  }

  const notNull: string = options.nullable === false ? " NOT NULL" : "";
  const columnDefault: string =
    options.default === undefined
      ? ""
      : ` DEFAULT '${String(options.default)}'`;

  return `ALTER TABLE "${entry.table}" ADD "${entry.column}" ${postgresType}${notNull}${columnDefault}`;
}

function expectedDropStatement(entry: AddedColumn): string {
  return `ALTER TABLE "${entry.table}" DROP COLUMN "${entry.column}"`;
}

describe("AddCriticalAlertSoundVolumeAndPushRepeat migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, MIGRATION_FILE),
      "utf8",
    );

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(
      new AddCriticalAlertSoundVolumeAndPushRepeat1801650000000().name,
    ).toBe(OWN_CLASS_NAME);
    expect(AddCriticalAlertSoundVolumeAndPushRepeat1801650000000.name).toBe(
      OWN_CLASS_NAME,
    );
    expect(timestampOfClassName(OWN_CLASS_NAME)).toBe(OWN_TIMESTAMP);
    expect(MIGRATION_FILE.startsWith(`${OWN_TIMESTAMP}-`)).toBe(true);
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
    /*
     * transaction = false is reserved for the online index and foreign key
     * builds (OnlineDdl). Adding a column with a constant default is a
     * catalog-only change that belongs in the ordinary transaction, so a
     * failure part way leaves neither table half-migrated.
     */
    expect(
      (
        new AddCriticalAlertSoundVolumeAndPushRepeat1801650000000() as unknown as {
          transaction?: boolean;
        }
      ).transaction,
    ).toBeUndefined();
  });

  test("is registered once, as the class this file exports", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(registered).toContain(
      AddCriticalAlertSoundVolumeAndPushRepeat1801650000000 as unknown as MigrationClass,
    );
  });

  test("is registered after the push notification level migration it builds on", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const previousIndex: number = registeredNames.indexOf(PREVIOUS_CLASS_NAME);

    expect(previousIndex).toBeGreaterThanOrEqual(0);
    expect(ownIndex).toBeGreaterThan(previousIndex);
    expect(timestampOfClassName(OWN_CLASS_NAME)!).toBeGreaterThan(
      timestampOfClassName(PREVIOUS_CLASS_NAME)!,
    );
  });

  test("runs after every migration registered before it", () => {
    /*
     * A fresh install runs the array in order while an existing one runs
     * whatever it has not recorded; a stamp below an earlier entry would make
     * the two disagree (SchemaMigrationsOrdering).
     */
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
      `import { ${OWN_CLASS_NAME} } from "./1801650000000-AddCriticalAlertSoundVolumeAndPushRepeat";`,
    );
    expect(index.match(new RegExp(`\\b${OWN_CLASS_NAME},`, "g"))).toHaveLength(
      1,
    );
  });
});

describe("AddCriticalAlertSoundVolumeAndPushRepeat migration - up()", () => {
  test("adds exactly the three columns, in order, each as its model declares it", async () => {
    expect(await recordQueries("up")).toEqual(
      COLUMNS.map((entry: AddedColumn): string => {
        return expectedAddStatement(entry);
      }),
    );
  });

  test("writes the statements TypeORM generates for these columns", async () => {
    /*
     * Spelled out as well as derived from the models, so the derivation
     * cannot quietly agree with a wrong migration.
     */
    expect(await recordQueries("up")).toEqual([
      `ALTER TABLE "UserPush" ADD "criticalAlertSound" character varying(100) NOT NULL DEFAULT 'default'`,
      `ALTER TABLE "UserPush" ADD "criticalAlertVolume" integer NOT NULL DEFAULT '100'`,
      `ALTER TABLE "UserNotificationRule" ADD "repeatEveryMinutes" integer NOT NULL DEFAULT '0'`,
    ]);
  });

  test.each(COLUMNS)(
    "backfills every existing row of $table.$column with the model's default, so nothing pages differently",
    async (entry: AddedColumn) => {
      const declared: ColumnMetadataArgs = declaredColumn(entry);

      expect(declared.options.nullable).toBe(false);
      expect(declared.options.default).toBeDefined();
      expect(await recordQueries("up")).toContain(expectedAddStatement(entry));
    },
  );

  test("the defaults are the system sound, full volume and no repeat", () => {
    expect(declaredColumn(COLUMNS[0]!).options.default).toBe("default");
    expect(declaredColumn(COLUMNS[1]!).options.default).toBe(100);
    expect(declaredColumn(COLUMNS[2]!).options.default).toBe(0);
  });

  test("rewrites neither table: constant defaults only, no backfill, no index, no constraint", async () => {
    /*
     * A constant default is a catalog-only change on Postgres 11 and later.
     * An UPDATE backfill, a computed default, a type change or an index would
     * hold UserPush - read on every page - or UserNotificationRule under a
     * lock for as long as it scans the table.
     */
    for (const statement of await recordQueries("up")) {
      expect(statement).toMatch(
        /^ALTER TABLE "[A-Za-z]+" ADD "[A-Za-z]+" [a-z ()0-9]+ NOT NULL DEFAULT '[a-z0-9_]+'$/,
      );
      expect(statement).not.toMatch(
        /UPDATE|ALTER COLUMN|INDEX|CONSTRAINT|\(\)/,
      );
    }
  });
});

describe("AddCriticalAlertSoundVolumeAndPushRepeat migration - down()", () => {
  test("drops exactly the three columns, in the reverse of the order up() added them", async () => {
    expect(await recordQueries("down")).toEqual(
      [...COLUMNS].reverse().map((entry: AddedColumn): string => {
        return expectedDropStatement(entry);
      }),
    );
  });

  test("undoes up(): applying both leaves the tables as they were", async () => {
    // The columns each table has, as the statements leave them.
    const schema: Map<string, Set<string>> = new Map<string, Set<string>>([
      ["UserPush", new Set<string>(["deviceToken", "isCriticalAlertEnabled"])],
      [
        "UserNotificationRule",
        new Set<string>(["notifyAfterMinutes", "pushNotificationLevel"]),
      ],
    ]);

    const before: Array<string> = [...schema.entries()].map(
      ([table, columns]: [string, Set<string>]): string => {
        return `${table}: ${[...columns].sort().join(", ")}`;
      },
    );

    const apply: (statement: string) => void = (statement: string): void => {
      const added: RegExpMatchArray | null = statement.match(
        /^ALTER TABLE "([A-Za-z]+)" ADD "([A-Za-z]+)" /,
      );
      const dropped: RegExpMatchArray | null = statement.match(
        /^ALTER TABLE "([A-Za-z]+)" DROP COLUMN "([A-Za-z]+)"$/,
      );

      if (added) {
        const columns: Set<string> = schema.get(added[1]!)!;
        expect(columns.has(added[2]!)).toBe(false);
        columns.add(added[2]!);
        return;
      }

      if (dropped) {
        const columns: Set<string> = schema.get(dropped[1]!)!;
        expect(columns.has(dropped[2]!)).toBe(true);
        columns.delete(dropped[2]!);
        return;
      }

      throw new Error(`Not a statement this suite reads: ${statement}`);
    };

    for (const statement of await recordQueries("up")) {
      apply(statement);
    }

    expect(schema.get("UserPush")).toEqual(
      new Set<string>([
        "deviceToken",
        "isCriticalAlertEnabled",
        "criticalAlertSound",
        "criticalAlertVolume",
      ]),
    );
    expect(schema.get("UserNotificationRule")).toEqual(
      new Set<string>([
        "notifyAfterMinutes",
        "pushNotificationLevel",
        "repeatEveryMinutes",
      ]),
    );

    for (const statement of await recordQueries("down")) {
      apply(statement);
    }

    expect(
      [...schema.entries()].map(
        ([table, columns]: [string, Set<string>]): string => {
          return `${table}: ${[...columns].sort().join(", ")}`;
        },
      ),
    ).toEqual(before);
  });

  test("drops nothing it did not add", async () => {
    const added: Array<string> = COLUMNS.map((entry: AddedColumn): string => {
      return `${entry.table}.${entry.column}`;
    });

    for (const statement of await recordQueries("down")) {
      const dropped: RegExpMatchArray | null = statement.match(
        /^ALTER TABLE "([A-Za-z]+)" DROP COLUMN "([A-Za-z]+)"$/,
      );

      expect(dropped).not.toBeNull();
      expect(added).toContain(`${dropped![1]}.${dropped![2]}`);
    }
  });
});
