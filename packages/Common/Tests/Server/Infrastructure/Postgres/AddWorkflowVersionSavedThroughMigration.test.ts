import { AddWorkflowGraphRevision1808995900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808995900000-AddWorkflowGraphRevision";
import { AddWorkflowVersionSavedThrough1808996000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808996000000-AddWorkflowVersionSavedThrough";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import WorkflowVersion from "../../../../Models/DatabaseModels/WorkflowVersion";
import WriteSource from "../../../../Types/BaseDatabase/WriteSource";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind "Ask AI's changes are versions of their own" (issue
 * #6258): WorkflowVersion.savedThrough, Ask AI when Ask AI saved a version
 * for the person who asked. Nullable, with no default: added without
 * rewriting the table, and every existing version reads as the person's
 * own, as it was recorded. Statements are recorded against a fake
 * QueryRunner.
 */

const MIGRATION: string = "AddWorkflowVersionSavedThrough1808996000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

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

describe("the workflow version saved-through migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddWorkflowVersionSavedThrough1808996000000().name).toBe(
      MIGRATION,
    );
  });

  test("is registered once, after every earlier migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddWorkflowVersionSavedThrough1808996000000,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddWorkflowVersionSavedThrough1808996000000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddWorkflowGraphRevision1808995900000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddWorkflowVersionSavedThrough1808996000000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    expect(
      files.filter((file: string): boolean => {
        return file.startsWith("1808996000000-");
      }),
    ).toEqual(["1808996000000-AddWorkflowVersionSavedThrough.ts"]);
  });

  test("adds the column empty, with no default: nothing rewritten, nothing backfilled", async () => {
    const steps: Array<string> = await record(
      new AddWorkflowVersionSavedThrough1808996000000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "WorkflowVersion" ADD "savedThrough" character varying(100)`,
    ]);
    expect(steps[0]).not.toMatch(
      /UPDATE |CREATE INDEX|FOREIGN KEY|NOT NULL|DEFAULT/,
    );
  });

  test("down drops the column", async () => {
    expect(
      await record(new AddWorkflowVersionSavedThrough1808996000000(), "down"),
    ).toEqual([`ALTER TABLE "WorkflowVersion" DROP COLUMN "savedThrough"`]);
  });

  test("matches the model: empty for the person's own saves, one of the write sources otherwise", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === WorkflowVersion &&
            candidate.propertyName === "savedThrough"
          );
        },
      );

    expect(column?.options.nullable).toBe(true);
    expect(column?.options.length).toBe(100);

    const version: WorkflowVersion = new WorkflowVersion();

    expect(
      version.getTableColumnMetadata("savedThrough")?.allowedValues,
    ).toEqual(Object.values(WriteSource));
    expect(version.getColumnAccessControlFor("savedThrough")).toMatchObject({
      create: [],
      update: [],
    });
  });
});
