import { AddDataSecurity1808500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808500000000-AddDataSecurity";
import { AddDataSecurityIdentities1808791000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808791000000-AddDataSecurityIdentities";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIdentity from "../../../../Models/DatabaseModels/DataSecurityIdentity";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind who can reach a project's data, one identity at a
 * time: the DataSecurityIdentity table, its indexes and its project key -
 * all on the table it makes, so each is built on no rows - and one column
 * of an existing table, DataStoreAccess.isUnused, a boolean with a
 * constant default that Postgres adds without rewriting the table.
 * Statements are recorded against a fake QueryRunner; the schema drift
 * check runs the migration on Postgres against the models.
 */

type MigrationClass = new () => MigrationInterface;

const MIGRATION_NAME: string = "AddDataSecurityIdentities1808791000000";
const MIGRATIONS_FOLDER: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
// A column of a CREATE TABLE: its quoted name, then its type.
const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;
const CREATE_TABLE: RegExp = /^CREATE TABLE "([A-Za-z]+)"/;
const ALTERED_TABLE: RegExp = /^ALTER TABLE "([A-Za-z]+)"/;
const INDEXED_TABLE: RegExp =
  /^CREATE (?:UNIQUE )?INDEX "[A-Za-z0-9_]+" ON "([A-Za-z]+)"/;
const CREATE_INDEX: RegExp = /^CREATE (?:UNIQUE )?INDEX "([A-Za-z0-9_]+)"/;
const DROP_INDEX: RegExp = /^DROP INDEX "public"\."([A-Za-z0-9_]+)"$/;
const ADD_CONSTRAINT: RegExp = /ADD CONSTRAINT "([A-Za-z0-9_]+)"/;
const DROP_CONSTRAINT: RegExp = /DROP CONSTRAINT "([A-Za-z0-9_]+)"$/;
const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;
const FOREIGN_KEY: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ADD CONSTRAINT "[A-Za-z0-9_]+" FOREIGN KEY \("([A-Za-z]+)"\) REFERENCES "([A-Za-z]+)"\("_id"\) ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT) ON UPDATE NO ACTION$/;
const UNIQUE_INDEX: RegExp =
  /^CREATE UNIQUE INDEX "[A-Za-z0-9_]+" ON "([A-Za-z]+)" \(([^)]+)\) $/;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddDataSecurityIdentities1808791000000 =
    new AddDataSecurityIdentities1808791000000();

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

function named(steps: Array<string>, pattern: RegExp): Array<string> {
  return steps.flatMap((step: string): Array<string> => {
    const match: RegExpMatchArray | null = step.match(pattern);

    return match ? [match[1]!] : [];
  });
}

// The columns a model keeps in its own table: its own and the base model's, never a relation.
function storedColumns(model: BaseModel): Array<string> {
  return Object.keys(getTableColumns(model))
    .filter((column: string): boolean => {
      return !model.isEntityColumn(column);
    })
    .concat(["createdAt", "updatedAt", "deletedAt", "version"])
    .filter((column: string, index: number, all: Array<string>): boolean => {
      return all.indexOf(column) === index;
    })
    .sort();
}

describe("the Data Security identities migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddDataSecurityIdentities1808791000000().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("is registered once, after the Data Security migration, above every migration before it", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddDataSecurityIdentities1808791000000,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddDataSecurityIdentities1808791000000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddDataSecurity1808500000000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddDataSecurityIdentities1808791000000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    expect(
      fs.readdirSync(MIGRATIONS_FOLDER).filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddDataSecurityIdentities1808791000000)}-`,
        );
      }),
    ).toEqual(["1808791000000-AddDataSecurityIdentities.ts"]);
  });

  test("runs inside its transaction: what it indexes and keys is the table it makes", async () => {
    expect(
      (
        new AddDataSecurityIdentities1808791000000() as {
          transaction?: boolean;
        }
      ).transaction,
    ).toBeUndefined();

    const steps: Array<string> = await record("up");

    expect(named(steps, CREATE_TABLE)).toEqual(["DataSecurityIdentity"]);
    expect(Array.from(new Set(named(steps, INDEXED_TABLE)))).toEqual([
      "DataSecurityIdentity",
    ]);
    expect(
      steps
        .filter((step: string): boolean => {
          return step.includes("ADD CONSTRAINT");
        })
        .map((step: string): string => {
          return step.match(ALTERED_TABLE)![1]!;
        }),
    ).toEqual(["DataSecurityIdentity"]);
  });

  test("creates the table with every column its model stores, and the base model's own", async () => {
    const statement: string = (await record("up")).find((step: string) => {
      return step.startsWith(`CREATE TABLE "DataSecurityIdentity" (`);
    })!;

    expect(
      Array.from(statement.matchAll(CREATED_COLUMN))
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .sort(),
    ).toEqual(storedColumns(new DataSecurityIdentity()));
    expect(statement).toContain(`"projectId" uuid NOT NULL`);
    expect(statement).toContain(
      `"identityKey" character varying(500) NOT NULL`,
    );
  });

  test("starts an identity quiet: inside, not public, used, reaching nothing, no risk", async () => {
    const statement: string = (await record("up")).find((step: string) => {
      return step.startsWith(`CREATE TABLE "DataSecurityIdentity" (`);
    })!;

    for (const fragment of [
      `"isExternal" boolean NOT NULL DEFAULT false`,
      `"isPublic" boolean NOT NULL DEFAULT false`,
      `"isUnused" boolean NOT NULL DEFAULT false`,
      `"isSeenInTraces" boolean NOT NULL DEFAULT false`,
      `"canChangeSensitiveData" boolean NOT NULL DEFAULT false`,
      `"storeCount" integer NOT NULL DEFAULT '0'`,
      `"riskScore" integer NOT NULL DEFAULT '0'`,
      `"highestSensitivity" character varying(100) NOT NULL DEFAULT 'Public'`,
    ]) {
      expect(statement).toContain(fragment);
    }
  });

  test("one identity per project and principal, and the riskiest found fast", async () => {
    const steps: Array<string> = await record("up");

    expect(
      steps.flatMap((step: string): Array<string> => {
        const match: RegExpMatchArray | null = step.match(UNIQUE_INDEX);
        return match ? [`${match[1]} ${match[2]}`] : [];
      }),
    ).toEqual([`DataSecurityIdentity "projectId", "identityKey"`]);
    expect(
      steps.some((step: string): boolean => {
        return step.includes(
          `ON "DataSecurityIdentity" ("projectId", "riskScore")`,
        );
      }),
    ).toBe(true);
  });

  test("an identity goes with its project", async () => {
    expect(
      (await record("up")).flatMap((step: string): Array<string> => {
        const match: RegExpMatchArray | null = step.match(FOREIGN_KEY);
        return match
          ? [`${match[1]}.${match[2]} -> ${match[3]} ${match[4]}`]
          : [];
      }),
    ).toEqual(["DataSecurityIdentity.projectId -> Project CASCADE"]);
  });

  test("adds the unused flag to every access entry, not unused until its cloud says so", async () => {
    const steps: Array<string> = await record("up");

    expect(
      steps.filter((step: string): boolean => {
        return step.startsWith(`ALTER TABLE "DataStoreAccess"`);
      }),
    ).toEqual([
      `ALTER TABLE "DataStoreAccess" ADD "isUnused" boolean NOT NULL DEFAULT false`,
    ]);
    expect(Object.keys(getTableColumns(new DataStoreAccess()))).toContain(
      "isUnused",
    );
  });

  test("reads or writes no row, either way", async () => {
    for (const step of [...(await record("up")), ...(await record("down"))]) {
      expect(step).not.toMatch(ROW_STATEMENT);
    }
  });

  test("down takes back exactly what up made: the key, the column, the indexes, then the table", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(named(down, DROP_CONSTRAINT).sort()).toEqual(
      named(up, ADD_CONSTRAINT).sort(),
    );
    expect(named(down, DROP_INDEX).sort()).toEqual(
      named(up, CREATE_INDEX).sort(),
    );
    expect(down).toContain(
      `ALTER TABLE "DataStoreAccess" DROP COLUMN "isUnused"`,
    );
    expect(down[down.length - 1]).toBe(`DROP TABLE "DataSecurityIdentity"`);
    expect(down[0]).toMatch(DROP_CONSTRAINT);
  });
});
