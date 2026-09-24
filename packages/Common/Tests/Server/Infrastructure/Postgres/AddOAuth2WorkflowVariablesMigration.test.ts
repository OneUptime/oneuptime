import { AddOAuth2WorkflowVariables1794300000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1794300000000-AddOAuth2WorkflowVariables";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import WorkflowVariable from "../../../../Models/DatabaseModels/WorkflowVariable";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import { WorkflowVariableType } from "../../../../Types/Workflow/WorkflowVariableOAuth";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of OAuth 2.0 workflow variables: a type column and the
 * columns an OAuth variable keeps, on the WorkflowVariable table the initial
 * migration created.
 *
 * It pins that every column is added exactly as the model declares it (a
 * mismatch is a green deploy followed by a red Schema Drift job), that
 * existing variables become Static without a backfill, and that down() undoes
 * up().
 *
 * Fake QueryRunner only. Applying every registered migration to an empty
 * Postgres, then this one, and generating again to "No changes in database
 * schema were found" is how it was verified; WorkflowVariableOAuthPostgres
 * exercises the columns against a real database.
 */

const OWN_CLASS_NAME: string = "AddOAuth2WorkflowVariables1794300000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1794300000000-AddOAuth2WorkflowVariables.ts",
);

type TimestampOfClassNameFunction = (className: string) => number | null;

const timestampOfClassName: TimestampOfClassNameFunction = (
  className: string,
): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddOAuth2WorkflowVariables1794300000000()[direction](queryRunner);

  return statements;
};

/*
 * What each column's DDL must be, given the model. character varying(n) is
 * varchar with a length; text, jsonb and timestamptz carry none.
 */
const EXPECTED_COLUMNS: Array<{ property: string; ddl: string }> = [
  {
    property: "variableType",
    ddl: "character varying(100) NOT NULL DEFAULT 'Static'",
  },
  { property: "oauthGrantType", ddl: "character varying(100)" },
  { property: "oauthTokenUrl", ddl: "text" },
  { property: "oauthClientId", ddl: "character varying(500)" },
  { property: "oauthClientSecret", ddl: "text" },
  { property: "oauthRefreshToken", ddl: "text" },
  { property: "oauthScope", ddl: "text" },
  { property: "oauthAdditionalParameters", ddl: "jsonb" },
  {
    property: "oauthClientAuthenticationMethod",
    ddl: "character varying(100)",
  },
  { property: "oauthAccessToken", ddl: "text" },
  { property: "oauthAccessTokenExpiresAt", ddl: "TIMESTAMP WITH TIME ZONE" },
  { property: "oauthLastRefreshedAt", ddl: "TIMESTAMP WITH TIME ZONE" },
  { property: "oauthLastRefreshError", ddl: "text" },
  { property: "oauthLastRefreshErrorAt", ddl: "TIMESTAMP WITH TIME ZONE" },
];

function declaredColumn(property: string): ColumnMetadataArgs {
  const declared: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return (
          column.target === WorkflowVariable && column.propertyName === property
        );
      },
    );

  if (!declared) {
    throw new Error(`WorkflowVariable declares no column ${property}`);
  }

  return declared;
}

const POSTGRES_SPELLING: Record<string, string> = {
  [ColumnType.ShortText]: "character varying",
  [ColumnType.VeryLongText]: "text",
  [ColumnType.JSON]: "jsonb",
  [ColumnType.Date]: "TIMESTAMP WITH TIME ZONE",
};

describe("AddOAuth2WorkflowVariables migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddOAuth2WorkflowVariables1794300000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered, so the columns actually reach every database", () => {
    expect(registeredNames).toContain(OWN_CLASS_NAME);
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    expect(ownIndex).toBeGreaterThan(0);

    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    const notBehind: Array<string> = registeredNames
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      });

    expect(notBehind).toEqual([]);
  });
});

describe("AddOAuth2WorkflowVariables migration - up()", () => {
  test("adds exactly the new columns, in order, and nothing else", async () => {
    expect(await recordQueries("up")).toEqual(
      EXPECTED_COLUMNS.map((column: { property: string; ddl: string }) => {
        return `ALTER TABLE "WorkflowVariable" ADD "${column.property}" ${column.ddl}`;
      }),
    );
  });

  test("adds every column the model declares that the table did not have", async () => {
    const added: Array<string> = EXPECTED_COLUMNS.map(
      (column: { property: string }) => {
        return column.property;
      },
    );

    const modelColumns: Array<string> = getMetadataArgsStorage()
      .columns.filter((column: ColumnMetadataArgs): boolean => {
        return (
          column.target === WorkflowVariable &&
          (column.propertyName.startsWith("oauth") ||
            column.propertyName === "variableType")
        );
      })
      .map((column: ColumnMetadataArgs): string => {
        return column.propertyName;
      });

    expect([...modelColumns].sort()).toEqual([...added].sort());
  });

  test.each(EXPECTED_COLUMNS)(
    "$property matches the column the model declares",
    ({ property, ddl }: { property: string; ddl: string }) => {
      const declared: ColumnMetadataArgs = declaredColumn(property);
      const type: string = String(declared.options.type);

      expect(declared.options.name).toBeUndefined();
      expect(ddl.startsWith(POSTGRES_SPELLING[type] || "unknown")).toBe(true);

      if (declared.options.length) {
        expect(ddl).toContain(`(${declared.options.length})`);
      }

      if (property === "variableType") {
        expect(declared.options.nullable).toBe(false);
        expect(declared.options.default).toBe(WorkflowVariableType.Static);
        expect(ddl).toContain("NOT NULL");
      } else {
        expect(declared.options.nullable).toBe(true);
        expect(declared.options.default).toBeUndefined();
        expect(ddl).not.toContain("NOT NULL");
      }
    },
  );

  test("uses the lengths ColumnLength defines", () => {
    expect(ColumnLength.ShortText).toBe(100);
    expect(ColumnLength.LongText).toBe(500);
    expect(declaredColumn("oauthClientId").options.type).toBe(
      ColumnType.LongText,
    );
  });

  /*
   * Every variable saved before this migration is a Static variable, and the
   * NOT NULL DEFAULT makes it one in the same statement - no backfill, no
   * window in which a row has no type.
   */
  test("turns every existing variable into a Static one without a backfill", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements[0]).toBe(
      `ALTER TABLE "WorkflowVariable" ADD "variableType" character varying(100) NOT NULL DEFAULT '${WorkflowVariableType.Static}'`,
    );
    expect(
      statements.some((statement: string) => {
        return statement.startsWith("UPDATE");
      }),
    ).toBe(false);
  });
});

describe("AddOAuth2WorkflowVariables migration - down()", () => {
  test("drops exactly the columns up() added, in reverse order", async () => {
    expect(await recordQueries("down")).toEqual(
      [...EXPECTED_COLUMNS].reverse().map((column: { property: string }) => {
        return `ALTER TABLE "WorkflowVariable" DROP COLUMN "${column.property}"`;
      }),
    );
  });
});
