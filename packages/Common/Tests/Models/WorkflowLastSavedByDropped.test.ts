import SchemaMigrations from "../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddWorkflowLastSavedBy1800600000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1800600000000-AddWorkflowLastSavedBy";
import { AddWorkflowLastSavedByForeignKey1800650000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1800650000000-AddWorkflowLastSavedByForeignKey";
import { DropWorkflowLastSavedBy1801200000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1801200000000-DropWorkflowLastSavedBy";
import Workflow from "../../Models/DatabaseModels/Workflow";
import UserAttribution from "../../Types/Database/UserAttribution";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * WORKFLOW.LASTSAVEDBYUSERID IS GONE.
 *
 * Releases 14.0.26 to 14.0.31 recorded who last saved a workflow's steps,
 * to answer its steps' read of runbook credentials with that person's. A
 * step is now never lent that read (RunbookCredentialReaders), so nothing
 * reads it: the column and its foreign key are dropped by a migration of
 * their own, after the two that added them - which stay registered, so an
 * install that never ran them runs all three, in order, and ends where
 * every other does.
 */

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

// The names the saver went by: the column and the props that carried it.
const SAVER_NAMES: RegExp = /lastSavedBy|workflowSavedByUserId/;

type QueryRunnerAndStatements = {
  runner: QueryRunner;
  statements: Array<string>;
};

function makeQueryRunner(): QueryRunnerAndStatements {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements: statements,
  };
}

function registeredNames(): Array<string> {
  return (
    SchemaMigrations as unknown as Array<new () => MigrationInterface>
  ).map((type: new () => MigrationInterface): string => {
    return type.name;
  });
}

describe("Workflow", () => {
  test("has no column recording who last saved its steps", () => {
    const workflow: Workflow = new Workflow();

    expect(workflow.hasColumn("lastSavedByUserId")).toBe(false);
    expect(workflow.hasColumn("lastSavedByUser")).toBe(false);
    expect(
      workflow.getTableColumns().columns.filter((column: string): boolean => {
        return column.startsWith("lastSaved");
      }),
    ).toEqual([]);
  });

  test("records who created, deleted and archived it, as before", () => {
    const workflow: Workflow = new Workflow();

    for (const column of [
      "createdByUserId",
      "deletedByUserId",
      "archivedByUserId",
    ]) {
      expect(workflow.hasColumn(column)).toBe(true);
      expect(UserAttribution.isDecidedByServer(column)).toBe(true);
    }
  });

  test("no code outside its migrations names the column", () => {
    const serverRoot: string = path.join(__dirname, "../../Server");
    const found: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (
            entry.name !== "SchemaMigrations" &&
            entry.name !== "node_modules"
          ) {
            walk(full);
          }
          continue;
        }

        if (
          entry.name.endsWith(".ts") &&
          SAVER_NAMES.test(fs.readFileSync(full, "utf8"))
        ) {
          found.push(path.relative(serverRoot, full));
        }
      }
    };

    walk(serverRoot);

    for (const file of [
      "../Models/DatabaseModels/Workflow.ts",
      "../Types/BaseDatabase/DatabaseCommonInteractionProps.ts",
    ]) {
      if (
        SAVER_NAMES.test(fs.readFileSync(path.join(serverRoot, file), "utf8"))
      ) {
        found.push(file);
      }
    }

    expect(found).toEqual([]);
  });
});

describe("the migration that drops it", () => {
  const migration: DropWorkflowLastSavedBy1801200000000 =
    new DropWorkflowLastSavedBy1801200000000();

  test("drops the foreign key the earlier migration added, then the column, and nothing else", async () => {
    const added: QueryRunnerAndStatements = makeQueryRunner();
    await new AddWorkflowLastSavedByForeignKey1800650000000().down(
      added.runner,
    );

    const { runner, statements } = makeQueryRunner();
    await migration.up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "Workflow" DROP CONSTRAINT IF EXISTS "FK_cfb3d733c4f4b78897f3339187b"`,
      `ALTER TABLE "Workflow" DROP COLUMN IF EXISTS "lastSavedByUserId"`,
    ]);

    /*
     * The very constraint the foreign key migration adds, and drops on its
     * way down - here only if it is there still.
     */
    expect(added.statements).toEqual([
      statements[0]!.replace("DROP CONSTRAINT IF EXISTS", "DROP CONSTRAINT"),
    ]);
  });

  test("starts on an install whose foreign key and column are gone already", async () => {
    const { runner, statements } = makeQueryRunner();
    await migration.up(runner);

    for (const statement of statements) {
      expect(statement).toContain(" IF EXISTS ");
    }
  });

  test("puts the column back empty on the way down, with its foreign key", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "Workflow" ADD "lastSavedByUserId" uuid`,
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_cfb3d733c4f4b78897f3339187b" FOREIGN KEY ("lastSavedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);

    // As the column was first added: nullable, with no default.
    const first: QueryRunnerAndStatements = makeQueryRunner();
    await new AddWorkflowLastSavedBy1800600000000().up(first.runner);
    expect(statements[0]).toBe(first.statements[0]);
  });

  test("runs in a transaction: dropping changes no row and scans nothing", () => {
    expect(
      (migration as unknown as { transaction?: boolean }).transaction,
    ).toBeUndefined();
  });

  test("is named after its class and timestamp", () => {
    expect(migration.name).toBe("DropWorkflowLastSavedBy1801200000000");
  });

  test("is registered after the two that added the column, which stay registered", () => {
    const names: Array<string> = registeredNames();

    const added: number = names.indexOf("AddWorkflowLastSavedBy1800600000000");
    const foreignKey: number = names.indexOf(
      "AddWorkflowLastSavedByForeignKey1800650000000",
    );
    const dropped: number = names.indexOf(
      "DropWorkflowLastSavedBy1801200000000",
    );

    expect(added).toBeGreaterThanOrEqual(0);
    expect(foreignKey).toBeGreaterThan(added);
    expect(dropped).toBeGreaterThan(foreignKey);
  });

  test("runs after every migration registered before it, and before every one after", () => {
    const names: Array<string> = registeredNames();
    const own: number = 1801200000000;
    const index: number = names.indexOf("DropWorkflowLastSavedBy1801200000000");

    names.forEach((name: string, position: number): void => {
      const match: RegExpMatchArray | null = name.match(CLASS_TIMESTAMP);

      if (!match || position === index) {
        return;
      }

      if (position < index) {
        expect(Number(match[1])).toBeLessThan(own);
      } else {
        expect(Number(match[1])).toBeGreaterThan(own);
      }
    });
  });
});
