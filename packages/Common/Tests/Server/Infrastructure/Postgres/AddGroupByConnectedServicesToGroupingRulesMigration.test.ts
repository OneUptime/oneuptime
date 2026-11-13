import { AddProxmoxClusterAgentLastSeenAt1809123900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123900000-AddProxmoxClusterAgentLastSeenAt";
import { AddGroupByConnectedServicesToGroupingRules1809124000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809124000000-AddGroupByConnectedServicesToGroupingRules";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AlertGroupingRule from "../../../../Models/DatabaseModels/AlertGroupingRule";
import IncidentGroupingRule from "../../../../Models/DatabaseModels/IncidentGroupingRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
 * The migration behind grouping by connected services (issue #6798): the
 * grouping rules' switch, IncidentGroupingRule.groupByConnectedServices and
 * AlertGroupingRule.groupByConnectedServices. Off on every existing rule -
 * a constant default, so each is added without rewriting its table - and
 * every rule groups as it did. Statements are recorded against a fake
 * QueryRunner.
 */

const MIGRATION_NAME: string =
  "AddGroupByConnectedServicesToGroupingRules1809124000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    isTransactionActive: false,
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

function columnOf(
  model: { new (): BaseModel },
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === model && column.propertyName === propertyName;
    },
  );
}

describe("the grouping rules' connected services migration", () => {
  test("names itself after its timestamp", () => {
    expect(
      new AddGroupByConnectedServicesToGroupingRules1809124000000().name,
    ).toBe(MIGRATION_NAME);
  });

  test("is registered once, after every earlier migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddGroupByConnectedServicesToGroupingRules1809124000000,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return (
          candidate === AddGroupByConnectedServicesToGroupingRules1809124000000
        );
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(AddProxmoxClusterAgentLastSeenAt1809123900000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddGroupByConnectedServicesToGroupingRules1809124000000),
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
        return file.startsWith(
          `${timestampOf(AddGroupByConnectedServicesToGroupingRules1809124000000)}-`,
        );
      }),
    ).toHaveLength(1);
  });

  test("adds the switch off on both rule tables - nothing backfilled, no index, no key", async () => {
    const steps: Array<string> = await record(
      new AddGroupByConnectedServicesToGroupingRules1809124000000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "IncidentGroupingRule" ADD "groupByConnectedServices" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "AlertGroupingRule" ADD "groupByConnectedServices" boolean NOT NULL DEFAULT false`,
    ]);

    for (const step of steps) {
      expect(step).not.toMatch(/UPDATE |CREATE INDEX|FOREIGN KEY/);
    }
  });

  test("down drops the columns, in the reverse order", async () => {
    expect(
      await record(
        new AddGroupByConnectedServicesToGroupingRules1809124000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "groupByConnectedServices"`,
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "groupByConnectedServices"`,
    ]);
  });

  describe("the models declare the column the migration adds", () => {
    test.each([
      ["IncidentGroupingRule", IncidentGroupingRule as { new (): BaseModel }],
      ["AlertGroupingRule", AlertGroupingRule as { new (): BaseModel }],
    ])("%s", (_name: string, model: { new (): BaseModel }) => {
      const column: ColumnMetadataArgs | undefined = columnOf(
        model,
        "groupByConnectedServices",
      );

      expect(column).toBeDefined();
      expect(column!.options.type).toBe("boolean");
      expect(column!.options.nullable).toBe(false);
      expect(column!.options.default).toBe(false);
    });
  });
});
