import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCloudAccountAiAgentKeys1808994400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994400000-AddCloudAccountAiAgentKeys";
import { AddGroupingRuleMinimumCount1808994560000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994560000-AddGroupingRuleMinimumCount";
import { AddGroupingWaitKeyIndexes1808994570000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994570000-AddGroupingWaitKeyIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind "wait for more incidents" (issue #5374): a
 * grouping rule's switch and count (enableMinimumIncidentCount /
 * minimumIncidentCount, enableMinimumAlertCount / minimumAlertCount), and
 * the group a waiting incident or alert waits in (groupingWaitKey). The
 * switches and counts have constant defaults - off, 3 - and the marks are
 * nullable with none, so each is added without rewriting its table, and
 * every existing rule groups as before. The marks' partial indexes are built
 * online, outside a transaction, in a migration of their own. Statements are
 * recorded against a fake QueryRunner.
 */

const COLUMN_MIGRATION: string = "AddGroupingRuleMinimumCount1808994560000";
const INDEX_MIGRATION: string = "AddGroupingWaitKeyIndexes1808994570000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const INCIDENT_INDEX: string = `CREATE INDEX "IDX_0e3a062eee0590da9f8b45bd85" ON "Incident" ("groupingWaitKey", "createdAt") WHERE "groupingWaitKey" IS NOT NULL AND "deletedAt" IS NULL`;
const ALERT_INDEX: string = `CREATE INDEX "IDX_d4d29d92155c66bee78492d27d" ON "Alert" ("groupingWaitKey", "createdAt") WHERE "groupingWaitKey" IS NOT NULL AND "deletedAt" IS NULL`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddGroupingRuleMinimumCount1808994560000,
  AddGroupingWaitKeyIndexes1808994570000,
];

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

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      steps.push(`online: ${statement}`);
    }) as never);
  }

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

function indexesOf(model: { new (): BaseModel }): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter(
    (index: IndexMetadataArgs): boolean => {
      return index.target === model;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the grouping rule minimum count migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddGroupingRuleMinimumCount1808994560000().name).toBe(
      COLUMN_MIGRATION,
    );
    expect(new AddGroupingWaitKeyIndexes1808994570000().name).toBe(
      INDEX_MIGRATION,
    );
  });

  test("are registered once each, after every earlier migration, the indexes right after the columns", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddGroupingRuleMinimumCount1808994560000,
    );

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(at).toBeGreaterThan(
      registered.indexOf(AddCloudAccountAiAgentKeys1808994400000),
    );
    expect(registered[at + 1]).toBe(AddGroupingWaitKeyIndexes1808994570000);
    expect(timestampOf(AddGroupingWaitKeyIndexes1808994570000)).toBeGreaterThan(
      timestampOf(AddGroupingRuleMinimumCount1808994560000),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddGroupingRuleMinimumCount1808994560000),
      );
    }
  });

  test("are backed by exactly one file each", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    for (const migration of MIGRATIONS) {
      expect(
        files.filter((file: string): boolean => {
          return file.startsWith(`${timestampOf(migration)}-`);
        }),
      ).toHaveLength(1);
    }
  });

  test("add the switches off, the counts at 3 and the marks empty - nothing backfilled", async () => {
    const steps: Array<string> = await record(
      new AddGroupingRuleMinimumCount1808994560000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "IncidentGroupingRule" ADD "enableMinimumIncidentCount" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "IncidentGroupingRule" ADD "minimumIncidentCount" integer NOT NULL DEFAULT '3'`,
      `ALTER TABLE "Incident" ADD "groupingWaitKey" character varying(100)`,
      `ALTER TABLE "AlertGroupingRule" ADD "enableMinimumAlertCount" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "AlertGroupingRule" ADD "minimumAlertCount" integer NOT NULL DEFAULT '3'`,
      `ALTER TABLE "Alert" ADD "groupingWaitKey" character varying(100)`,
    ]);

    for (const step of steps) {
      expect(step).not.toMatch(/UPDATE |CREATE INDEX|FOREIGN KEY/);
    }

    // The marks on the big tables: nullable, with no default to write.
    for (const step of steps.filter((sql: string): boolean => {
      return sql.includes('"groupingWaitKey"');
    })) {
      expect(step).not.toMatch(/NOT NULL|DEFAULT/);
    }
  });

  test("build the two partial indexes online, outside a transaction", async () => {
    const migration: AddGroupingWaitKeyIndexes1808994570000 =
      new AddGroupingWaitKeyIndexes1808994570000();

    expect(migration.transaction).toBe(false);
    expect(new AddGroupingRuleMinimumCount1808994560000()).not.toHaveProperty(
      "transaction",
      false,
    );
    expect(await record(migration, "up")).toEqual([
      `online: ${INCIDENT_INDEX}`,
      `online: ${ALERT_INDEX}`,
    ]);
  });

  test("down drops the indexes online, then the columns, in the reverse order", async () => {
    expect(
      await record(new AddGroupingWaitKeyIndexes1808994570000(), "down"),
    ).toEqual([
      `online: DROP INDEX "public"."IDX_d4d29d92155c66bee78492d27d"`,
      `online: DROP INDEX "public"."IDX_0e3a062eee0590da9f8b45bd85"`,
    ]);
    expect(
      await record(new AddGroupingRuleMinimumCount1808994560000(), "down"),
    ).toEqual([
      `ALTER TABLE "Alert" DROP COLUMN "groupingWaitKey"`,
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "minimumAlertCount"`,
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "enableMinimumAlertCount"`,
      `ALTER TABLE "Incident" DROP COLUMN "groupingWaitKey"`,
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "minimumIncidentCount"`,
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "enableMinimumIncidentCount"`,
    ]);
  });

  describe("the models declare the partial indexes the migration builds", () => {
    test.each([
      ["Incident", Incident as { new (): BaseModel }],
      ["Alert", Alert as { new (): BaseModel }],
    ])("%s", (_name: string, model: { new (): BaseModel }) => {
      const partial: Array<IndexMetadataArgs> = indexesOf(model).filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.where ===
            `"groupingWaitKey" IS NOT NULL AND "deletedAt" IS NULL`
          );
        },
      );

      expect(partial).toHaveLength(1);
      expect(partial[0]!.columns).toEqual(["groupingWaitKey", "createdAt"]);
    });
  });
});
