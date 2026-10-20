import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import {
  AddAutoRemediationRuleRunner1804400000000,
  DROP_MOVED_COMMAND_RUNNER_ROWS,
  PICK_THE_ONE_COMMAND_RUNNER,
  RESTORE_COMMAND_RUNNER_ROWS,
  WRITE_OUT_ANY_RUNNER_RULES,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804400000000-AddAutoRemediationRuleRunner";
import { AddAutoRemediationRuleRunnerIndexAndKey1804450000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804450000000-AddAutoRemediationRuleRunnerIndexAndKey";
import { AddCodeRepositoryRunnerIndexAndKey1804350000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1804350000000-AddCodeRepositoryRunnerIndexAndKey";
import { IS_KUBERNETES_AGENT_RUNNER_SQL } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796800000000-FoldAiSwitchesIntoEnableAi";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Runner from "../../../../Models/DatabaseModels/Runner";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind an auto remediation rule's Runner: the rule gets
 * the Runner OneUptime AI runs its commands on (AutoRemediationRule
 * .runnerId), and every rule keeps doing what it did - a rule saved before
 * rules were simplified that composes commands and names no Command Runners
 * ran on any Runner of its project with "Runs AI Remediation Commands" on,
 * so those Runners are written out, and one that then names exactly one
 * picks it as its Runner. No Runner's switch is changed. In a migration of
 * its own, outside a transaction, the column's index and its foreign key to
 * "Runner" are built online.
 *
 * Statements are recorded against a fake QueryRunner;
 * AddAutoRemediationRuleRunnerPostgres.test.ts runs both on Postgres, on
 * rows.
 */

const COLUMN_MIGRATION: string = "AddAutoRemediationRuleRunner1804400000000";
const KEY_MIGRATION: string =
  "AddAutoRemediationRuleRunnerIndexAndKey1804450000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const INDEX: string = `CREATE INDEX "IDX_338f34b0d3cbf32aa45e778ade" ON "AutoRemediationRule" ("runnerId") `;
const FOREIGN_KEY: string = `ALTER TABLE "AutoRemediationRule" ADD CONSTRAINT "FK_338f34b0d3cbf32aa45e778ade1" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddAutoRemediationRuleRunner1804400000000,
  AddAutoRemediationRuleRunnerIndexAndKey1804450000000,
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

describe("the auto remediation rule Runner migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddAutoRemediationRuleRunner1804400000000().name).toBe(
      COLUMN_MIGRATION,
    );
    expect(
      new AddAutoRemediationRuleRunnerIndexAndKey1804450000000().name,
    ).toBe(KEY_MIGRATION);
  });

  test("are registered once each, after the code repository's Runner, the index and key right after the column", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddAutoRemediationRuleRunner1804400000000,
    );

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(at).toBeGreaterThan(
      registered.indexOf(AddCodeRepositoryRunnerIndexAndKey1804350000000),
    );
    expect(registered[at + 1]).toBe(
      AddAutoRemediationRuleRunnerIndexAndKey1804450000000,
    );
    expect(
      timestampOf(AddAutoRemediationRuleRunnerIndexAndKey1804450000000),
    ).toBeGreaterThan(timestampOf(AddAutoRemediationRuleRunner1804400000000));

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddAutoRemediationRuleRunner1804400000000),
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

  test("add the rule's Runner, write out the Runners a command rule ran on, pick the one, and move it", async () => {
    expect(
      await record(new AddAutoRemediationRuleRunner1804400000000(), "up"),
    ).toEqual([
      `ALTER TABLE "AutoRemediationRule" ADD "runnerId" uuid`,
      WRITE_OUT_ANY_RUNNER_RULES,
      PICK_THE_ONE_COMMAND_RUNNER,
      DROP_MOVED_COMMAND_RUNNER_ROWS,
    ]);
  });

  test("change no Runner's switch: a Runner bound with it off keeps it off", async () => {
    const steps: Array<string> = await record(
      new AddAutoRemediationRuleRunner1804400000000(),
      "up",
    );

    for (const step of steps) {
      expect(step).not.toMatch(/UPDATE "Runner"/);
      expect(step).not.toMatch(/SET "canRunAiCommands"/);
    }
  });

  test("build the column's index and its key online, outside a transaction", async () => {
    const migration: AddAutoRemediationRuleRunnerIndexAndKey1804450000000 =
      new AddAutoRemediationRuleRunnerIndexAndKey1804450000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: ${INDEX}`,
      `online: ${FOREIGN_KEY}`,
    ]);
  });

  test("a deleted Runner leaves its rules picking none: the key sets their Runner to null", () => {
    expect(FOREIGN_KEY).toContain(`REFERENCES "Runner"("_id")`);
    expect(FOREIGN_KEY).toContain("ON DELETE SET NULL");
  });

  test("down hands every rule's Runner back to its Command Runners before the column goes", async () => {
    expect(
      await record(new AddAutoRemediationRuleRunner1804400000000(), "down"),
    ).toEqual([
      RESTORE_COMMAND_RUNNER_ROWS,
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "runnerId"`,
    ]);
  });

  test("undo the key and the index", async () => {
    expect(
      await record(
        new AddAutoRemediationRuleRunnerIndexAndKey1804450000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "AutoRemediationRule" DROP CONSTRAINT "FK_338f34b0d3cbf32aa45e778ade1"`,
      `online: DROP INDEX "public"."IDX_338f34b0d3cbf32aa45e778ade"`,
    ]);
  });

  test("the models match: a rule has its Runner, and a Runner keeps the column OneUptime writes", () => {
    expect(Object.keys(getTableColumns(new AutoRemediationRule()))).toEqual(
      expect.arrayContaining(["runner", "runnerId", "commandRunners"]),
    );
    expect(Object.keys(getTableColumns(new Runner()))).toContain(
      "canRunAiCommands",
    );
  });

  describe("the carry-over", () => {
    // A rule saved before rules were simplified that composes commands.
    const COMMAND_RULE: string = `rule."aiComposesCommands" = true AND rule."remediationAction" <> 'Runbooks' AND rule."deletedAt" IS NULL`;

    // A Runner its commands could run on: the project's own, switch on.
    const COMMAND_RUNNER: string = `runner."canRunAiCommands" = true AND runner."isGlobalRunner" = false AND runner."deletedAt" IS NULL AND NOT ${IS_KUBERNETES_AGENT_RUNNER_SQL}`;

    test("writes out only for a live command rule that names no Runner, the Runners of its own project it could run on", () => {
      expect(WRITE_OUT_ANY_RUNNER_RULES).toMatch(
        /^INSERT INTO "AutoRemediationRuleRunner" \("autoRemediationRuleId", "runnerId"\) SELECT rule."_id", runner."_id" FROM "AutoRemediationRule" AS rule INNER JOIN "Runner" AS runner ON runner."projectId" = rule."projectId"/,
      );
      expect(WRITE_OUT_ANY_RUNNER_RULES).toContain(COMMAND_RULE);
      expect(WRITE_OUT_ANY_RUNNER_RULES).toContain(COMMAND_RUNNER);
      expect(WRITE_OUT_ANY_RUNNER_RULES).toContain(
        `NOT EXISTS (SELECT 1 FROM "AutoRemediationRuleRunner" AS named WHERE named."autoRemediationRuleId" = rule."_id")`,
      );
      expect(WRITE_OUT_ANY_RUNNER_RULES).toMatch(/ON CONFLICT DO NOTHING$/);
    });

    test("picks as the rule's Runner only the one Runner a command rule names, of its own project, that it could run on", () => {
      expect(PICK_THE_ONE_COMMAND_RUNNER).toMatch(
        /^UPDATE "AutoRemediationRule" AS rule SET "runnerId" = "single"."runnerId"/,
      );
      expect(PICK_THE_ONE_COMMAND_RUNNER).toContain("HAVING count(*) = 1");
      expect(PICK_THE_ONE_COMMAND_RUNNER).toContain(
        `runner."projectId" = rule."projectId" AND rule."runnerId" IS NULL`,
      );
      expect(PICK_THE_ONE_COMMAND_RUNNER).toContain(COMMAND_RULE);
      expect(PICK_THE_ONE_COMMAND_RUNNER).toContain(COMMAND_RUNNER);
    });

    test("drops only the Command Runners row a command rule's Runner moved out of", () => {
      expect(DROP_MOVED_COMMAND_RUNNER_ROWS).toBe(
        `DELETE FROM "AutoRemediationRuleRunner" AS named USING "AutoRemediationRule" AS rule WHERE named."autoRemediationRuleId" = rule."_id" AND named."runnerId" = rule."runnerId" AND rule."aiComposesCommands" = true`,
      );
    });

    test("down's data step: every rule's Runner, as one of its Command Runners", () => {
      expect(RESTORE_COMMAND_RUNNER_ROWS).toBe(
        `INSERT INTO "AutoRemediationRuleRunner" ("autoRemediationRuleId", "runnerId") SELECT rule."_id", rule."runnerId" FROM "AutoRemediationRule" AS rule WHERE rule."runnerId" IS NOT NULL ON CONFLICT DO NOTHING`,
      );
    });
  });
});
