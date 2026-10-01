import { AddTeamComplianceRuleNotificationChannels1796500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796500000000-AddTeamComplianceRuleNotificationChannels";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import TeamComplianceSetting from "../../../../Models/DatabaseModels/TeamComplianceSetting";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of compliance rules on several channels.
 *
 *  - TeamComplianceSetting.notificationChannels: the channels an on-call rule
 *    insists on, as a jsonb list. Nullable with no default.
 *  - Every rule that insisted on a channel gets it as a one-item list, so it
 *    checks what it checked before - and the edit form, which reads only the
 *    list, still shows it.
 *  - notificationChannel stays: older builds and older API clients read and
 *    write it, and the service keeps it equal to the list's first channel.
 *
 * The column was generated against the model, so its type is TypeORM's by
 * construction; this pins that it STAYS so (a hand edit passes review and
 * fails the Schema Drift job), that the backfill touches only the rows and
 * the column it should, that nothing outside the rule table rode along, and
 * that down() undoes up() without taking the older column with it. Fake
 * QueryRunner only - the backfill is run against real rows by
 * TeamComplianceSettingPostgres.test.ts.
 */

const OWN_CLASS_NAME: string =
  "AddTeamComplianceRuleNotificationChannels1796500000000";

const MIGRATIONS_DIRECTORY: string = path.join(
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

const MIGRATION_FILE_NAME: string =
  "1796500000000-AddTeamComplianceRuleNotificationChannels.ts";

const RULE_TABLE: string = "TeamComplianceSetting";

const ADD_COLUMN: string = `ALTER TABLE "${RULE_TABLE}" ADD "notificationChannels" jsonb`;

const BACKFILL: string = `UPDATE "${RULE_TABLE}" SET "notificationChannels" = jsonb_build_array("notificationChannel") WHERE "notificationChannel" IS NOT NULL AND "notificationChannels" IS NULL`;

const DROP_COLUMN: string = `ALTER TABLE "${RULE_TABLE}" DROP COLUMN "notificationChannels"`;

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await new AddTeamComplianceRuleNotificationChannels1796500000000()[direction](
    queryRunner,
  );

  return statements;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

type TimestampOfFunction = (className: string) => number | null;

const timestampOf: TimestampOfFunction = (className: string): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

type DeclaredColumnFunction = (
  propertyName: string,
) => ColumnMetadataArgs | undefined;

const declaredColumn: DeclaredColumnFunction = (
  propertyName: string,
): ColumnMetadataArgs | undefined => {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === TeamComplianceSetting &&
        column.propertyName === propertyName
      );
    },
  );
};

describe("AddTeamComplianceRuleNotificationChannels migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIRECTORY, MIGRATION_FILE_NAME),
      "utf8",
    );

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    // However prettier wraps it.
    expect(source).toMatch(
      new RegExp(`public name: string =\\s*"${OWN_CLASS_NAME}";`),
    );
    expect(
      new AddTeamComplianceRuleNotificationChannels1796500000000().name,
    ).toBe(OWN_CLASS_NAME);
  });

  test("is registered exactly once", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);
  });

  test("runs after every migration registered before it, and before every one registered after it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOf(OWN_CLASS_NAME)!;

    expect(
      registeredNames.slice(0, ownIndex).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);

    expect(
      registeredNames.slice(ownIndex + 1).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp === null || timestamp <= ownTimestamp;
      }),
    ).toEqual([]);

    /*
     * After the migration that gave rules their channel and severities in
     * the first place: the backfill reads the column that one added.
     */
    expect(registeredNames.indexOf(OWN_CLASS_NAME)).toBeGreaterThan(
      registeredNames.indexOf("AddTeamComplianceRuleScope1796000000000"),
    );
    expect(registeredNames[ownIndex - 1]).toBe("AddIncidentForms1796400000000");
  });

  test("no other migration file adds the column - the wall-clock one typeorm generated was not left behind", () => {
    expect(
      fs
        .readdirSync(MIGRATIONS_DIRECTORY)
        .filter((fileName: string): boolean => {
          return (
            fileName !== MIGRATION_FILE_NAME &&
            fs
              .readFileSync(path.join(MIGRATIONS_DIRECTORY, fileName), "utf8")
              .includes(`ADD "notificationChannels"`)
          );
        }),
    ).toEqual([]);
  });
});

describe("AddTeamComplianceRuleNotificationChannels migration - up()", () => {
  test("adds the column, then backfills it - and does nothing else", async () => {
    expect(await recordQueries("up")).toEqual([ADD_COLUMN, BACKFILL]);
  });

  test("adds the column as the model declares it: jsonb, nullable, no default", () => {
    const declared: ColumnMetadataArgs | undefined = declaredColumn(
      "notificationChannels",
    );

    expect(declared?.options.type).toBe(ColumnType.JSON);
    expect(ColumnType.JSON).toBe("jsonb");
    expect(declared?.options.nullable).toBe(true);
    expect(declared?.options.default).toBeUndefined();

    // No DEFAULT and no NOT NULL: an existing rule is never rewritten by it.
    expect(ADD_COLUMN).not.toMatch(/DEFAULT|NOT NULL/);
  });

  test("the backfill writes only the new column, and only on rules that insist on a channel and have no list yet", () => {
    /*
     * A rule on any channel keeps a NULL list, which reads as "any channel"
     * too; and a row that already has a list - written by this build, if the
     * statement ever runs twice - is left alone.
     */
    const setClause: string = BACKFILL.slice(
      BACKFILL.indexOf(" SET ") + 5,
      BACKFILL.indexOf(" WHERE "),
    );

    expect(setClause).toBe(
      `"notificationChannels" = jsonb_build_array("notificationChannel")`,
    );
    expect(BACKFILL.slice(BACKFILL.indexOf(" WHERE ") + 7)).toBe(
      `"notificationChannel" IS NOT NULL AND "notificationChannels" IS NULL`,
    );
  });

  test("the channel it copies from is the older column the model still declares", () => {
    const declared: ColumnMetadataArgs | undefined = declaredColumn(
      "notificationChannel",
    );

    expect(declared?.options.type).toBe(ColumnType.ShortText);
    expect(declared?.options.length).toBe(ColumnLength.ShortText);
    expect(declared?.options.nullable).toBe(true);
  });

  test("touches no table but the rule table", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).toMatch(
        /^(ALTER TABLE|UPDATE) "TeamComplianceSetting" /,
      );
    }

    for (const statement of await recordQueries("down")) {
      expect(statement).toMatch(/^ALTER TABLE "TeamComplianceSetting" /);
    }
  });
});

describe("AddTeamComplianceRuleNotificationChannels migration - down()", () => {
  test("drops the list and nothing else", async () => {
    expect(await recordQueries("down")).toEqual([DROP_COLUMN]);
  });

  test("keeps the older column, which still holds every rule's first channel", async () => {
    /*
     * Going back leaves each rule checking one of its channels - never
     * widened to "any channel", as it would be if the older column went too.
     */
    for (const statement of await recordQueries("down")) {
      expect(statement).not.toContain(`"notificationChannel"`);
    }
  });
});
