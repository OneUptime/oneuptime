import { AddRuleOwningTeams1808995800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808995800000-AddRuleOwningTeams";
import { AddWorkflowGraphRevision1808995900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808995900000-AddWorkflowGraphRevision";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
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
 * The migration behind "a save no longer silently overwrites a teammate's
 * changes" (issue #6257): Workflow.graphRevision, how many times the graph
 * has been saved. Its default is a constant, so the column is added without
 * rewriting the table, and every existing workflow starts at 0 - which is
 * what the builder reads when it opens one, and the revision its first save
 * names. Statements are recorded against a fake QueryRunner.
 */

const MIGRATION: string = "AddWorkflowGraphRevision1808995900000";
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

describe("the workflow graph revision migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddWorkflowGraphRevision1808995900000().name).toBe(MIGRATION);
    expect(timestampOf(AddWorkflowGraphRevision1808995900000)).toBe(
      1808995900000,
    );
  });

  test("is registered once, after every earlier migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddWorkflowGraphRevision1808995900000,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddWorkflowGraphRevision1808995900000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddRuleOwningTeams1808995800000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddWorkflowGraphRevision1808995900000),
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
        return file.startsWith("1808995900000-");
      }),
    ).toEqual(["1808995900000-AddWorkflowGraphRevision.ts"]);
  });

  test("adds the count with a constant default of 0: nothing is rewritten, nothing backfilled, nothing locked for a scan", async () => {
    const steps: Array<string> = await record(
      new AddWorkflowGraphRevision1808995900000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "Workflow" ADD "graphRevision" integer NOT NULL DEFAULT '0'`,
    ]);
    expect(steps[0]).not.toMatch(/UPDATE |CREATE INDEX|FOREIGN KEY/);
    // A plain migration: no online DDL needed.
    expect(new AddWorkflowGraphRevision1808995900000()).not.toHaveProperty(
      "transaction",
      false,
    );
  });

  test("down drops the column", async () => {
    expect(
      await record(new AddWorkflowGraphRevision1808995900000(), "down"),
    ).toEqual([`ALTER TABLE "Workflow" DROP COLUMN "graphRevision"`]);
  });

  test("matches the model: a whole number, never empty, 0 until the graph is first saved", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === Workflow &&
            candidate.propertyName === "graphRevision"
          );
        },
      );

    expect(column?.options.type).toBe("integer");
    expect(column?.options.nullable).toBe(false);
    expect(column?.options.default).toBe(0);

    const workflow: Workflow = new Workflow();

    expect(workflow.getColumnAccessControlFor("graphRevision")).toMatchObject({
      create: [],
      update: [],
    });
    expect(workflow.getColumnAccessControlFor("graphRevision")?.read).toEqual(
      workflow.getColumnAccessControlFor("graph")?.read,
    );
  });
});
