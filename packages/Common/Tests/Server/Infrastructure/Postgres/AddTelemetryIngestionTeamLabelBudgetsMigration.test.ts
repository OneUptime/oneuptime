import { DELETED_BY_USER_ID_COLUMN } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187480000-DropDeletedByUserColumns";
import { RecordActorUtil } from "../../../../Types/Database/RecordActor";
import { AddTelemetryIngestionTeamLabelBudgets1809186905386 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186905386-AddTelemetryIngestionTeamLabelBudgets";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import TelemetryIngestionTeamLabelBudget from "../../../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
} from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind team and label ingestion budgets (#6386) and the
 * usage-as-metrics switch (#6355): the TelemetryIngestionTeamLabelBudget
 * table, and Project.publishTelemetryUsageMetrics.
 *
 * The table is new, so its indexes are built and its keys checked on no
 * rows; the column has a constant default, which Postgres adds without
 * rewriting Project. No row is read or written. Its names are TypeORM's own
 * (DefaultNamingStrategy), so the schema drift check finds the models and
 * the database alike. Statements are recorded against a fake QueryRunner.
 */

const MIGRATION_NAME: string =
  "AddTelemetryIngestionTeamLabelBudgets1809186905386";
const TABLE: string = "TelemetryIngestionTeamLabelBudget";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;
const CREATE_TABLE: RegExp = /^CREATE TABLE "([A-Za-z]+)"/;
const DROP_TABLE: RegExp = /^DROP TABLE "([A-Za-z]+)"$/;
const ADD_CONSTRAINT: RegExp = /ADD CONSTRAINT "([A-Za-z0-9_]+)"/;
const DROP_CONSTRAINT: RegExp = /DROP CONSTRAINT "([A-Za-z0-9_]+)"$/;
const CREATE_INDEX: RegExp = /^CREATE (?:UNIQUE )?INDEX "([A-Za-z0-9_]+)"/;
const DROP_INDEX: RegExp = /^DROP INDEX "public"\."([A-Za-z0-9_]+)"$/;
const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;

const NAMING: DefaultNamingStrategy = new DefaultNamingStrategy();

type MigrationClass = new () => MigrationInterface;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddTelemetryIngestionTeamLabelBudgets1809186905386 =
    new AddTelemetryIngestionTeamLabelBudgets1809186905386();

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

function createStatement(steps: Array<string>): string {
  const statement: string | undefined = steps.find((step: string) => {
    return step.startsWith(`CREATE TABLE "${TABLE}" `);
  });

  expect(statement).toBeDefined();

  return statement!;
}

describe("the team and label budgets migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddTelemetryIngestionTeamLabelBudgets1809186905386().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("is registered once, after every earlier migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddTelemetryIngestionTeamLabelBudgets1809186905386,
    );

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddTelemetryIngestionTeamLabelBudgets1809186905386;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(0);

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddTelemetryIngestionTeamLabelBudgets1809186905386),
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
          `${timestampOf(AddTelemetryIngestionTeamLabelBudgets1809186905386)}-`,
        );
      }),
    ).toEqual(["1809186905386-AddTelemetryIngestionTeamLabelBudgets.ts"]);
  });

  test("creates the table with every column the model stores", async () => {
    const budget: TelemetryIngestionTeamLabelBudget =
      new TelemetryIngestionTeamLabelBudget();
    const stored: Array<string> = Object.keys(getTableColumns(budget))
      .filter((column: string): boolean => {
        return !budget.isEntityColumn(column);
      })
      .filter((column: string): boolean => {
        // Added to every table later (AddRecordCreatedByAndLastModifiedColumns, #10290).
        return !RecordActorUtil.isColumn(column);
      })
      // Dropped from every table later (DropDeletedByUserColumns, #10469).
      .concat([DELETED_BY_USER_ID_COLUMN])
      .sort();

    const created: Array<string> = Array.from(
      createStatement(await record("up")).matchAll(CREATED_COLUMN),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .sort();

    expect(created).toEqual(stored);
  });

  test("the project is required; the team or the label, and every budget, may be empty", async () => {
    const statement: string = createStatement(await record("up"));

    expect(statement).toContain(`"projectId" uuid NOT NULL`);
    expect(statement).toContain(`"teamId" uuid,`);
    expect(statement).toContain(`"labelId" uuid,`);

    for (const signal of ["logs", "traces", "metrics", "profiles"]) {
      expect(statement).toContain(
        `"${signal}DailyIngestionBudgetInGB" numeric,`,
      );
    }

    // No rate: a team's or a label's budget is daily only.
    expect(statement).not.toContain("RateLimit");
  });

  test("one budget per team and per label in a project, under TypeORM's names", async () => {
    expect(
      (await record("up")).filter((step: string): boolean => {
        return CREATE_INDEX.test(step);
      }),
    ).toEqual([
      `CREATE INDEX "${NAMING.indexName(TABLE, ["projectId"])}" ON "${TABLE}" ("projectId") `,
      `CREATE UNIQUE INDEX "${NAMING.indexName(TABLE, ["projectId", "labelId"])}" ON "${TABLE}" ("projectId", "labelId") `,
      `CREATE UNIQUE INDEX "${NAMING.indexName(TABLE, ["projectId", "teamId"])}" ON "${TABLE}" ("projectId", "teamId") `,
    ]);
  });

  test("a deleted project, team or label takes its budget with it; a deleted person leaves it", async () => {
    expect(
      (await record("up")).filter((step: string): boolean => {
        return ADD_CONSTRAINT.test(step);
      }),
    ).toEqual([
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["projectId"])}" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["teamId"])}" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["labelId"])}" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["createdByUserId"])}" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${NAMING.foreignKeyName(TABLE, ["deletedByUserId"])}" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("adds the usage switch to Project, off, without rewriting the table", async () => {
    expect(await record("up")).toContain(
      `ALTER TABLE "Project" ADD "publishTelemetryUsageMetrics" boolean NOT NULL DEFAULT false`,
    );
    expect(await record("down")).toContain(
      `ALTER TABLE "Project" DROP COLUMN "publishTelemetryUsageMetrics"`,
    );
  });

  test("reads and writes no row", async () => {
    for (const step of [...(await record("up")), ...(await record("down"))]) {
      expect(step).not.toMatch(ROW_STATEMENT);
    }
  });

  test("down drops exactly what up made, keys first and the table last", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(named(down, DROP_TABLE)).toEqual(named(up, CREATE_TABLE));
    expect(named(down, DROP_CONSTRAINT).sort()).toEqual(
      named(up, ADD_CONSTRAINT).sort(),
    );
    expect(named(down, DROP_INDEX).sort()).toEqual(
      named(up, CREATE_INDEX).sort(),
    );

    const lastKey: number = Math.max(
      ...down.map((step: string, index: number): number => {
        return DROP_CONSTRAINT.test(step) ? index : -1;
      }),
    );
    const firstIndex: number = down.findIndex((step: string): boolean => {
      return DROP_INDEX.test(step);
    });

    expect(lastKey).toBeLessThan(firstIndex);
    expect(down[down.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
  });
});
