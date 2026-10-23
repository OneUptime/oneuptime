import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddInvestigationRuleWait1805030000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805030000000-AddInvestigationRuleWait";
import { AddInvestigationRuleWaitIndexes1805040000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805040000000-AddInvestigationRuleWaitIndexes";
import { AddAutoRemediationRuleRunnerIndexAndKey1804800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804800000000-AddAutoRemediationRuleRunnerIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";
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
 * The two migrations behind an investigation rule's wait (issue #5074): a
 * rule's wait (AIInvestigationRule.onlyIfOpenAfterMinutes), when a waiting
 * incident's or alert's wait ends (aiInvestigationWaitUntil), and on a run a
 * rule made wait, the wait (AIRun.ruleWaitMinutes). Every column is nullable
 * with no default, so it is added without rewriting its table and every
 * existing rule, record and run reads as before - no wait. Their partial
 * indexes are built online, outside a transaction, in a migration of their
 * own. Statements are recorded against a fake QueryRunner.
 */

const COLUMN_MIGRATION: string = "AddInvestigationRuleWait1805030000000";
const INDEX_MIGRATION: string = "AddInvestigationRuleWaitIndexes1805040000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const INCIDENT_INDEX: string = `CREATE INDEX "IDX_301974537e3094dbcd5a2b14ba" ON "Incident" ("aiInvestigationWaitUntil") WHERE "aiInvestigationWaitUntil" IS NOT NULL AND "deletedAt" IS NULL`;
const ALERT_INDEX: string = `CREATE INDEX "IDX_e6dad46c4d8795ceeda63315aa" ON "Alert" ("aiInvestigationWaitUntil") WHERE "aiInvestigationWaitUntil" IS NOT NULL AND "deletedAt" IS NULL`;
const RUN_INDEX: string = `CREATE INDEX "IDX_f64302b4e3a0a32291184248c6" ON "AIRun" ("projectId", "completedAt") WHERE "ruleWaitMinutes" IS NOT NULL AND "deletedAt" IS NULL`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddInvestigationRuleWait1805030000000,
  AddInvestigationRuleWaitIndexes1805040000000,
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

describe("the investigation rule wait migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddInvestigationRuleWait1805030000000().name).toBe(
      COLUMN_MIGRATION,
    );
    expect(new AddInvestigationRuleWaitIndexes1805040000000().name).toBe(
      INDEX_MIGRATION,
    );
  });

  test("are registered once each, after every earlier migration, the indexes right after the columns", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddInvestigationRuleWait1805030000000,
    );

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(at).toBeGreaterThan(
      registered.indexOf(AddAutoRemediationRuleRunnerIndexAndKey1804800000000),
    );
    expect(registered[at + 1]).toBe(
      AddInvestigationRuleWaitIndexes1805040000000,
    );
    expect(
      timestampOf(AddInvestigationRuleWaitIndexes1805040000000),
    ).toBeGreaterThan(timestampOf(AddInvestigationRuleWait1805030000000));

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddInvestigationRuleWait1805030000000),
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

  test("add the four columns, nullable, with no default and nothing backfilled", async () => {
    const steps: Array<string> = await record(
      new AddInvestigationRuleWait1805030000000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "Incident" ADD "aiInvestigationWaitUntil" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "Alert" ADD "aiInvestigationWaitUntil" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "AIRun" ADD "ruleWaitMinutes" integer`,
      `ALTER TABLE "AIInvestigationRule" ADD "onlyIfOpenAfterMinutes" integer`,
    ]);

    for (const step of steps) {
      expect(step).not.toMatch(/NOT NULL|DEFAULT|UPDATE /);
    }
  });

  test("build the three partial indexes online, outside a transaction", async () => {
    const migration: AddInvestigationRuleWaitIndexes1805040000000 =
      new AddInvestigationRuleWaitIndexes1805040000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: ${INCIDENT_INDEX}`,
      `online: ${ALERT_INDEX}`,
      `online: ${RUN_INDEX}`,
    ]);
  });

  test("down drops the indexes online, then the columns, in the reverse order", async () => {
    expect(
      await record(new AddInvestigationRuleWaitIndexes1805040000000(), "down"),
    ).toEqual([
      `online: DROP INDEX "public"."IDX_f64302b4e3a0a32291184248c6"`,
      `online: DROP INDEX "public"."IDX_e6dad46c4d8795ceeda63315aa"`,
      `online: DROP INDEX "public"."IDX_301974537e3094dbcd5a2b14ba"`,
    ]);
    expect(
      await record(new AddInvestigationRuleWait1805030000000(), "down"),
    ).toEqual([
      `ALTER TABLE "AIInvestigationRule" DROP COLUMN "onlyIfOpenAfterMinutes"`,
      `ALTER TABLE "AIRun" DROP COLUMN "ruleWaitMinutes"`,
      `ALTER TABLE "Alert" DROP COLUMN "aiInvestigationWaitUntil"`,
      `ALTER TABLE "Incident" DROP COLUMN "aiInvestigationWaitUntil"`,
    ]);
  });

  /*
   * AIInvestigationRule.onlyIfOpenAfterMinutes is left in the database,
   * unread: the investigation rules moved into the AI rules, their waits
   * with them (MergeInvestigationRulesIntoAiRules), and the AI rule's own
   * column is AddAiRuleInvestigation's.
   */
  describe("the models declare what the migrations build", () => {
    test.each([
      ["Incident", Incident, "aiInvestigationWaitUntil", TableColumnType.Date],
      ["Alert", Alert, "aiInvestigationWaitUntil", TableColumnType.Date],
      ["AIRun", AIRun, "ruleWaitMinutes", TableColumnType.Number],
    ])(
      "%s.%s",
      (
        _name: string,
        model: { new (): BaseModel },
        column: string,
        type: TableColumnType,
      ) => {
        expect(new model().getTableColumnMetadata(column)?.type).toBe(type);
      },
    );

    test.each([
      [
        "Incident",
        Incident,
        `"aiInvestigationWaitUntil" IS NOT NULL AND "deletedAt" IS NULL`,
        ["aiInvestigationWaitUntil"],
      ],
      [
        "Alert",
        Alert,
        `"aiInvestigationWaitUntil" IS NOT NULL AND "deletedAt" IS NULL`,
        ["aiInvestigationWaitUntil"],
      ],
      [
        "AIRun",
        AIRun,
        `"ruleWaitMinutes" IS NOT NULL AND "deletedAt" IS NULL`,
        ["projectId", "completedAt"],
      ],
    ])(
      "%s's partial index, as the migration builds it",
      (
        _name: string,
        model: { new (): BaseModel },
        where: string,
        columns: Array<string>,
      ) => {
        const partial: Array<IndexMetadataArgs> = indexesOf(model).filter(
          (index: IndexMetadataArgs): boolean => {
            return index.where === where;
          },
        );

        expect(partial).toHaveLength(1);
        expect(partial[0]!.columns).toEqual(columns);
      },
    );
  });
});
