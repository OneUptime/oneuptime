import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import { RecordActorUtil } from "../../../../Types/Database/RecordActor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCloudCostBasesAndCommitments1809187660117 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187660117-AddCloudCostBasesAndCommitments";
import CloudCommitment from "../../../../Models/DatabaseModels/CloudCommitment";
import CloudCostSetting from "../../../../Models/DatabaseModels/CloudCostSetting";
import {
  CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD,
  CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT,
  CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
} from "../../../../Types/Cloud/CloudCommitmentAlerts";
import { CLOUD_COST_DEFAULT_BASIS } from "../../../../Types/Cloud/CloudCostBasis";

/*
 * The migration behind billed, amortized and net costs (#11007) and the
 * commitments inventory (#11011): two new tables - every commitment the
 * connections read, and a project's cost settings with their alert
 * policies and owners - and two nullable columns on tables that hold rows
 * already: a budget's own basis, and what a "commit to use" recommendation
 * would buy. The new tables are empty, so their indexes and keys are built
 * inside the migration (SchemaMigrationsOnlineDdl); the two columns have
 * no default, so adding them rewrites no row. down() takes away exactly
 * what up() made.
 *
 * Run against a fake QueryRunner, so the statements are what is pinned;
 * the schema drift check holds them to the models, and the migration ran
 * on a real Postgres when it was written (CloudCommitmentsPostgres copies
 * its tables).
 */

const MIGRATION_TIMESTAMP: string = "1809187660117";
const MIGRATION_BASE_NAME: string = "AddCloudCostBasesAndCommitments";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const NEW_TABLES: Array<string> = [
  "CloudCommitment",
  "CloudCostSetting",
  "CloudCostSettingOnCallDutyPolicy",
  "CloudCostSettingOwnerUser",
  "CloudCostSettingOwnerTeam",
];

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddCloudCostBasesAndCommitments1809187660117();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

function createOf(statements: Array<string>, table: string): string {
  return statements.find((statement: string): boolean => {
    return statement.startsWith(`CREATE TABLE "${table}" (`);
  })!;
}

// The quoted column names a CREATE TABLE statement declares, in order.
function createdColumns(statement: string): Array<string> {
  const open: number = statement.indexOf("(");
  const columns: Array<string> = [];

  for (const part of statement.slice(open + 1).split(", ")) {
    if (part.startsWith('"')) {
      columns.push(part.slice(1, part.indexOf('"', 1)));
    }
  }

  return columns;
}

// A model's own columns, as the table holds them: relations are their id columns.
function declaredColumns(
  columns: Array<string>,
  relations: Array<string>,
): Array<string> {
  return columns.filter((column: string): boolean => {
    return !relations.includes(column) && !RecordActorUtil.isColumn(column);
  });
}

describe("AddCloudCostBasesAndCommitments1809187660117", () => {
  test("creates the commitments' table with every column the model declares", async () => {
    const create: string = createOf(await statementsOf("up"), "CloudCommitment");
    const columns: Array<string> = createdColumns(create);

    for (const column of declaredColumns(
      new CloudCommitment().getTableColumns().columns,
      ["project", "cloudAccount", "createdByUser", "deletedByUser"],
    )) {
      expect({ column, created: columns.includes(column) }).toEqual({
        column,
        created: true,
      });
    }

    // What a read always says of a commitment; the rest is as its cloud says.
    for (const required of [
      '"projectId" uuid NOT NULL',
      '"cloudAccountId" uuid NOT NULL',
      '"provider" character varying(100) NOT NULL',
      '"commitmentId" character varying(500) NOT NULL',
      '"kind" character varying(100) NOT NULL',
      '"name" character varying(500) NOT NULL',
      '"state" character varying(100) NOT NULL',
      '"currency" character varying(100) NOT NULL',
    ]) {
      expect(create).toContain(required);
    }

    for (const optional of [
      '"endsAt" TIMESTAMP WITH TIME ZONE,',
      '"hourlyCommitment" numeric,',
      '"utilizationPercent" numeric,',
      '"weekUtilizationPercent" numeric,',
      '"figures" jsonb,',
      '"alertState" jsonb,',
    ]) {
      expect(create).toContain(optional);
    }
  });

  test("creates the settings' table with the defaults a project starts from", async () => {
    const create: string = createOf(await statementsOf("up"), "CloudCostSetting");
    const columns: Array<string> = createdColumns(create);

    for (const column of declaredColumns(
      new CloudCostSetting().getTableColumns().columns,
      [
        "project",
        "commitmentAlertSeverity",
        "commitmentOnCallDutyPolicies",
        "commitmentAlertOwnerUsers",
        "commitmentAlertOwnerTeams",
        "createdByUser",
        "deletedByUser",
      ],
    )) {
      expect({ column, created: columns.includes(column) }).toEqual({
        column,
        created: true,
      });
    }

    expect(create).toContain(
      `"costBasis" character varying(100) NOT NULL DEFAULT '${CLOUD_COST_DEFAULT_BASIS}'`,
    );
    expect(create).toContain(
      '"isCommitmentAlertsEnabled" boolean NOT NULL DEFAULT true',
    );
    expect(create).toContain(
      `"commitmentExpiryAlertDays" character varying(100) NOT NULL DEFAULT '${CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT}'`,
    );
    expect(create).toContain(
      `"commitmentUtilizationThreshold" integer NOT NULL DEFAULT '${CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD}'`,
    );
    // Coverage may be turned off: empty is off.
    expect(create).toContain(
      `"commitmentCoverageThreshold" integer DEFAULT '${CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD}',`,
    );
  });

  test("one commitment a cloud id in a project, and one settings row a project", async () => {
    const unique: Array<string> = (await statementsOf("up")).filter(
      (statement: string): boolean => {
        return statement.startsWith("CREATE UNIQUE INDEX");
      },
    );

    expect(
      unique.map((statement: string): string => {
        return statement.slice(statement.indexOf(" ON ")).trim();
      }),
    ).toEqual([
      'ON "CloudCommitment" ("projectId", "provider", "commitmentId")',
      'ON "CloudCostSetting" ("projectId")',
    ]);
  });

  test("indexes what is read by: a project's commitments, an account's, the soonest to end", async () => {
    const indexes: Array<string> = (await statementsOf("up"))
      .filter((statement: string): boolean => {
        return (
          statement.startsWith("CREATE INDEX") &&
          statement.includes('ON "CloudCommitment"')
        );
      })
      .map((statement: string): string => {
        return statement.slice(statement.indexOf(" ON ")).trim();
      });

    expect(indexes).toEqual([
      'ON "CloudCommitment" ("projectId")',
      'ON "CloudCommitment" ("cloudAccountId")',
      'ON "CloudCommitment" ("endsAt")',
    ]);
  });

  test("a commitment goes with its account and its project; settings with their project; a deleted severity leaves the default", async () => {
    const keys: Array<string> = (await statementsOf("up")).filter(
      (statement: string): boolean => {
        return statement.includes("FOREIGN KEY");
      },
    );
    const keyOf: (table: string, column: string) => string | undefined = (
      table: string,
      column: string,
    ): string | undefined => {
      return keys.find((statement: string): boolean => {
        return (
          statement.startsWith(`ALTER TABLE "${table}" `) &&
          statement.includes(`FOREIGN KEY ("${column}")`)
        );
      });
    };

    expect(keyOf("CloudCommitment", "projectId")).toContain(
      'REFERENCES "Project"("_id") ON DELETE CASCADE',
    );
    expect(keyOf("CloudCommitment", "cloudAccountId")).toContain(
      'REFERENCES "CloudAccount"("_id") ON DELETE CASCADE',
    );
    expect(keyOf("CloudCostSetting", "projectId")).toContain(
      'REFERENCES "Project"("_id") ON DELETE CASCADE',
    );
    expect(keyOf("CloudCostSetting", "commitmentAlertSeverityId")).toContain(
      'REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL',
    );

    // The join tables go with either side.
    for (const [table, column, target] of [
      ["CloudCostSettingOnCallDutyPolicy", "onCallDutyPolicyId", "OnCallDutyPolicy"],
      ["CloudCostSettingOwnerUser", "userId", "User"],
      ["CloudCostSettingOwnerTeam", "teamId", "Team"],
    ] as Array<[string, string, string]>) {
      expect(keyOf(table, "cloudCostSettingId")).toContain(
        'REFERENCES "CloudCostSetting"("_id") ON DELETE CASCADE',
      );
      expect(keyOf(table, column)).toContain(
        `REFERENCES "${target}"("_id") ON DELETE CASCADE`,
      );
    }

    expect(keys).toHaveLength(10);
  });

  test("the tables with rows already get one nullable column each, no default: no row rewritten, no lock held long", async () => {
    const altered: Array<string> = (await statementsOf("up")).filter(
      (statement: string): boolean => {
        return (
          statement.startsWith("ALTER TABLE") &&
          !statement.includes("ADD CONSTRAINT") &&
          !NEW_TABLES.some((table: string): boolean => {
            return statement.startsWith(`ALTER TABLE "${table}" `);
          })
        );
      },
    );

    expect(altered).toEqual([
      'ALTER TABLE "CloudBudget" ADD "costBasis" character varying(100)',
      'ALTER TABLE "CloudCostRecommendation" ADD "commitmentDetails" jsonb',
    ]);

    // Every index and key it builds is on a table it made.
    for (const statement of await statementsOf("up")) {
      if (
        statement.startsWith("CREATE INDEX") ||
        statement.startsWith("CREATE UNIQUE INDEX")
      ) {
        expect(
          NEW_TABLES.some((table: string): boolean => {
            return statement.includes(`ON "${table}"`);
          }),
        ).toBe(true);
      }

      if (statement.includes("ADD CONSTRAINT")) {
        expect(
          NEW_TABLES.some((table: string): boolean => {
            return statement.startsWith(`ALTER TABLE "${table}" `);
          }),
        ).toBe(true);
      }
    }
  });

  test("down takes away exactly what up made", async () => {
    const up: Array<string> = await statementsOf("up");
    const down: Array<string> = await statementsOf("down");

    const constraintsUp: Array<string> = up
      .filter((statement: string): boolean => {
        return statement.includes("ADD CONSTRAINT");
      })
      .map((statement: string): string => {
        return statement.split('ADD CONSTRAINT "')[1]!.split('"')[0]!;
      });
    const indexesUp: Array<string> = up
      .filter((statement: string): boolean => {
        return statement.includes("INDEX");
      })
      .map((statement: string): string => {
        return statement.split('INDEX "')[1]!.split('"')[0]!;
      });

    // Every key dropped, before the tables they join.
    for (const constraint of constraintsUp) {
      expect(
        down.filter((statement: string): boolean => {
          return statement.endsWith(`DROP CONSTRAINT "${constraint}"`);
        }),
      ).toHaveLength(1);
    }

    for (const index of indexesUp) {
      expect(down).toContain(`DROP INDEX "public"."${index}"`);
    }

    for (const table of NEW_TABLES) {
      expect(down).toContain(`DROP TABLE "${table}"`);
    }

    expect(down).toContain('ALTER TABLE "CloudBudget" DROP COLUMN "costBasis"');
    expect(down).toContain(
      'ALTER TABLE "CloudCostRecommendation" DROP COLUMN "commitmentDetails"',
    );

    const lastKeyDrop: number = Math.max(
      ...down
        .map((statement: string, index: number): number => {
          return statement.includes("DROP CONSTRAINT") ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        }),
    );
    const firstTableDrop: number = down.findIndex((statement: string) => {
      return statement.startsWith("DROP TABLE");
    });

    expect(lastKeyDrop).toBeLessThan(firstTableDrop);
    // Nothing else.
    expect(down).toHaveLength(constraintsUp.length + indexesUp.length + 7);
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddCloudCostBasesAndCommitments1809187660117().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    // It runs after the migrations it follows.
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddUniqueNameIndexes1809187640010"),
    );

    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
