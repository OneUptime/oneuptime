import { AddDataSecurityIdentities1808791000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808791000000-AddDataSecurityIdentities";
import { AddDataSecurityFieldSuggestions1808792000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808792000000-AddDataSecurityFieldSuggestions";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind OneUptime AI's field suggestions and a person's
 * confirmation of a finding: one column of DataStore and three of
 * DataStoreFinding, each nullable or with a constant default, so Postgres
 * adds them without rewriting a table and every existing row reads right
 * (no finding is a suggestion, none is confirmed). Statements are recorded
 * against a fake QueryRunner; the schema drift check runs the migration on
 * Postgres against the models.
 */

type MigrationClass = new () => MigrationInterface;

const MIGRATION_NAME: string = "AddDataSecurityFieldSuggestions1808792000000";
const MIGRATIONS_FOLDER: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
const ADD_COLUMN: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ADD "([A-Za-z]+)" (jsonb|boolean|character varying\(\d+\))( [A-Z][A-Za-z ]+)?$/;
const DROP_COLUMN: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" DROP COLUMN "([A-Za-z]+)"$/;
const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddDataSecurityFieldSuggestions1808792000000 =
    new AddDataSecurityFieldSuggestions1808792000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

describe("the Data Security field suggestions migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddDataSecurityFieldSuggestions1808792000000().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("is registered once, after the identities migration, above every migration before it", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddDataSecurityFieldSuggestions1808792000000,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddDataSecurityFieldSuggestions1808792000000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddDataSecurityIdentities1808791000000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddDataSecurityFieldSuggestions1808792000000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    expect(
      fs.readdirSync(MIGRATIONS_FOLDER).filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddDataSecurityFieldSuggestions1808792000000)}-`,
        );
      }),
    ).toEqual(["1808792000000-AddDataSecurityFieldSuggestions.ts"]);
  });

  test("up adds the four columns, each nullable or with a constant default, and touches no row", async () => {
    const steps: Array<string> = await record("up");

    expect(
      steps.map((step: string): Array<string> => {
        const match: RegExpMatchArray | null = step.match(ADD_COLUMN);

        return match
          ? [match[1]!, match[2]!, match[3]!, (match[4] || "").trim()]
          : [step];
      }),
    ).toEqual([
      ["DataStore", "fieldSuggestionState", "jsonb", ""],
      ["DataStoreFinding", "isConfirmed", "boolean", "NOT NULL DEFAULT false"],
      [
        "DataStoreFinding",
        "isAiSuggested",
        "boolean",
        "NOT NULL DEFAULT false",
      ],
      ["DataStoreFinding", "aiReason", "character varying(500)", ""],
    ]);
    expect(
      steps.filter((step: string): boolean => {
        return ROW_STATEMENT.test(step);
      }),
    ).toEqual([]);
  });

  test("each column it adds is a column of its model", () => {
    const store: Set<string> = new Set(
      Object.keys(getTableColumns(new DataStore())),
    );
    const finding: Set<string> = new Set(
      Object.keys(getTableColumns(new DataStoreFinding())),
    );

    expect(store.has("fieldSuggestionState")).toBe(true);

    for (const column of ["isConfirmed", "isAiSuggested", "aiReason"]) {
      expect({ column, isAColumn: finding.has(column) }).toEqual({
        column,
        isAColumn: true,
      });
    }
  });

  test("down drops exactly what up added, in the reverse order", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(
      down.map((step: string): string => {
        const match: RegExpMatchArray | null = step.match(DROP_COLUMN);
        return match ? `${match[1]}.${match[2]}` : step;
      }),
    ).toEqual(
      up
        .map((step: string): string => {
          const match: RegExpMatchArray | null = step.match(ADD_COLUMN);
          return match ? `${match[1]}.${match[2]}` : step;
        })
        .reverse(),
    );
  });
});
