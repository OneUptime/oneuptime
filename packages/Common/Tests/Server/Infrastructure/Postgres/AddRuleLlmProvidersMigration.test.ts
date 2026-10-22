import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddRuleLlmProviders1805980000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805980000000-AddRuleLlmProviders";
import { AddRuleLlmProviderIndexesAndKeys1805990000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805990000000-AddRuleLlmProviderIndexesAndKeys";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind an AI rule's LLM provider
 * (Common/Types/AI/LlmProviderChoice): an investigation rule, an auto
 * remediation rule and a postmortem rule each get "llmProviderId", and a run
 * records the pick of the rule that started it (AIRun "llmProviderId"). In
 * a migration of its own, outside a transaction, each rule's column gets
 * its index and its foreign key to "LlmProvider" online - ON DELETE SET
 * NULL, so a deleted provider leaves its rules picking none. AIRun's column
 * gets neither: a run queued before its provider was deleted still knows it
 * had one, and says why it used another.
 *
 * Statements are recorded against a fake QueryRunner;
 * AddRuleLlmProvidersPostgres.test.ts runs both on Postgres, on rows.
 */

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
const RULE_TABLES: Array<string> = [
  "AutoRemediationRule",
  "AIInvestigationRule",
  "AIPostmortemRule",
];

const INDEXES: Array<string> = [
  `CREATE INDEX "IDX_1da91a0497a685dcc14535aa68" ON "AutoRemediationRule" ("llmProviderId") `,
  `CREATE INDEX "IDX_42204354d038fc00dc63646b72" ON "AIInvestigationRule" ("llmProviderId") `,
  `CREATE INDEX "IDX_57fa7734d3e32175d6100fb8d0" ON "AIPostmortemRule" ("llmProviderId") `,
];

const FOREIGN_KEYS: Array<string> = [
  `ALTER TABLE "AutoRemediationRule" ADD CONSTRAINT "FK_1da91a0497a685dcc14535aa681" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "AIInvestigationRule" ADD CONSTRAINT "FK_42204354d038fc00dc63646b72b" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "AIPostmortemRule" ADD CONSTRAINT "FK_57fa7734d3e32175d6100fb8d00" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
];

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddRuleLlmProviders1805980000000,
  AddRuleLlmProviderIndexesAndKeys1805990000000,
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

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the AI rules' LLM provider migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddRuleLlmProviders1805980000000().name).toBe(
      "AddRuleLlmProviders1805980000000",
    );
    expect(new AddRuleLlmProviderIndexesAndKeys1805990000000().name).toBe(
      "AddRuleLlmProviderIndexesAndKeys1805990000000",
    );
  });

  test("are registered once each, after every migration before them, the keys right after the columns", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddRuleLlmProviders1805980000000);

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(registered[at + 1]).toBe(
      AddRuleLlmProviderIndexesAndKeys1805990000000,
    );
    expect(
      timestampOf(AddRuleLlmProviderIndexesAndKeys1805990000000),
    ).toBeGreaterThan(timestampOf(AddRuleLlmProviders1805980000000));

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddRuleLlmProviders1805980000000),
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

  test("add the pick to every kind of rule, and to the run - nullable, with nothing to backfill", async () => {
    expect(await record(new AddRuleLlmProviders1805980000000(), "up")).toEqual([
      `ALTER TABLE "AIRun" ADD "llmProviderId" uuid`,
      `ALTER TABLE "AutoRemediationRule" ADD "llmProviderId" uuid`,
      `ALTER TABLE "AIInvestigationRule" ADD "llmProviderId" uuid`,
      `ALTER TABLE "AIPostmortemRule" ADD "llmProviderId" uuid`,
    ]);
  });

  test("build each rule's index and key online, outside a transaction", async () => {
    const migration: AddRuleLlmProviderIndexesAndKeys1805990000000 =
      new AddRuleLlmProviderIndexesAndKeys1805990000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      ...INDEXES.map((statement: string): string => {
        return `online: ${statement}`;
      }),
      ...FOREIGN_KEYS.map((statement: string): string => {
        return `online: ${statement}`;
      }),
    ]);
  });

  test("a deleted provider leaves its rules picking none: every key sets the pick to null", () => {
    for (const table of RULE_TABLES) {
      const key: string | undefined = FOREIGN_KEYS.find(
        (statement: string): boolean => {
          return statement.startsWith(`ALTER TABLE "${table}"`);
        },
      );

      expect(key).toBeDefined();
      expect(key).toContain(`REFERENCES "LlmProvider"("_id")`);
      expect(key).toContain("ON DELETE SET NULL");
    }
  });

  test("a run's pick has no key and no index: it outlives the provider", async () => {
    const steps: Array<string> = await record(
      new AddRuleLlmProviderIndexesAndKeys1805990000000(),
      "up",
    );

    for (const step of steps) {
      expect(step).not.toContain(`"AIRun"`);
    }
  });

  test("down takes the keys and indexes away, then the columns, the run's last", async () => {
    expect(
      await record(new AddRuleLlmProviderIndexesAndKeys1805990000000(), "down"),
    ).toEqual([
      `ALTER TABLE "AIPostmortemRule" DROP CONSTRAINT "FK_57fa7734d3e32175d6100fb8d00"`,
      `ALTER TABLE "AIInvestigationRule" DROP CONSTRAINT "FK_42204354d038fc00dc63646b72b"`,
      `ALTER TABLE "AutoRemediationRule" DROP CONSTRAINT "FK_1da91a0497a685dcc14535aa681"`,
      `online: DROP INDEX "public"."IDX_57fa7734d3e32175d6100fb8d0"`,
      `online: DROP INDEX "public"."IDX_42204354d038fc00dc63646b72"`,
      `online: DROP INDEX "public"."IDX_1da91a0497a685dcc14535aa68"`,
    ]);

    expect(
      await record(new AddRuleLlmProviders1805980000000(), "down"),
    ).toEqual([
      `ALTER TABLE "AIPostmortemRule" DROP COLUMN "llmProviderId"`,
      `ALTER TABLE "AIInvestigationRule" DROP COLUMN "llmProviderId"`,
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "llmProviderId"`,
      `ALTER TABLE "AIRun" DROP COLUMN "llmProviderId"`,
    ]);
  });
});
