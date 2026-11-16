import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import {
  CascadeRunsAndFixesWithTheirRecord1809182600000,
  RECORD_LINKS,
  RecordLink,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182600000-CascadeRunsAndFixesWithTheirRecord";
import {
  DELETE_FIXES_OF_DELETED_RECORDS,
  DELETE_RUNS_OF_DELETED_RECORDS,
  DELETE_RUNS_OF_FIXES_OF_DELETED_RECORDS,
  DeleteRunsAndFixesOfDeletedRecords1809182610000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182610000-DeleteRunsAndFixesOfDeletedRecords";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import RunbookTriggerType from "../../../../Types/Runbook/RunbookTriggerType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The two migrations that make a runbook run and a fix go with the incident
 * or alert they are about (#9103):
 *
 *   - CascadeRunsAndFixesWithTheirRecord: the run's and the fix's incident
 *     and alert keys go from ON DELETE SET NULL to ON DELETE CASCADE, each
 *     handed to OnlineDdl.replaceForeignKey as the generator wrote its ADD
 *     (the DROP and the ADD swapped in one statement, NOT VALID, then
 *     validated without blocking writers), in a migration without a
 *     transaction. The migration drops no key itself. Before each, the rows
 *     naming a record that is gone are deleted, so the validation passes on
 *     a database that lost a key. The keys are exactly the ones the models
 *     declare CASCADE, so the schema drift check and the migration agree;
 *     down puts SET NULL back.
 *   - DeleteRunsAndFixesOfDeletedRecords: what already outlived its record
 *     - the fixes naming neither an incident nor an alert, the runs they
 *     started, the rule and auto-remediation runs naming no record - in one
 *     transaction, after the keys.
 *
 * Pinned against a fake QueryRunner, with OnlineDdl recorded rather than
 * run (OnlineDdl.test.ts covers it: a key already replaced is not swapped
 * again, one left NOT VALID is validated). CascadeRunsAndFixesWithTheirRecord
 * Postgres.test.ts runs both on a real database.
 */

interface FakeRun {
  runner: QueryRunner;
  // Every statement, the keys handed to OnlineDdl as "<replace STATEMENT>", in order.
  statements: Array<string>;
  // The statements handed to OnlineDdl.replaceForeignKey, in order.
  replaced: Array<string>;
}

function fakeRun(): FakeRun {
  const statements: Array<string> = [];
  const replaced: Array<string> = [];

  const runner: QueryRunner = {
    query: async (sql: string): Promise<unknown> => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      return [];
    },
  } as unknown as QueryRunner;

  jest
    .spyOn(OnlineDdl, "replaceForeignKey")
    .mockImplementation(
      async (queryRunner: QueryRunner, statement: string): Promise<void> => {
        expect(queryRunner).toBe(runner);
        replaced.push(statement);
        statements.push(`<replace ${statement}>`);
      },
    );

  for (const step of ["addForeignKey", "createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async () => {
      throw new Error(`OnlineDdl.${step} is not expected here.`);
    }) as never);
  }

  return { runner, statements, replaced };
}

function cascadeStatement(link: RecordLink): string {
  return `ALTER TABLE "${link.table}" ADD CONSTRAINT "${link.constraintName}" FOREIGN KEY ("${link.column}") REFERENCES "${link.recordTable}"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`;
}

function deleteOfDeletedRecords(link: RecordLink): string {
  return `DELETE FROM "${link.table}" row_of_record WHERE row_of_record."${link.column}" IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM "${link.recordTable}" named_record WHERE named_record."_id" = row_of_record."${link.column}" )`;
}

function migrationNames(): Array<string> {
  return SchemaMigrations.map((migration: { name: string }): string => {
    return migration.name;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CascadeRunsAndFixesWithTheirRecord1809182600000", () => {
  test("is registered under its own name, after every migration before it", () => {
    const names: Array<string> = migrationNames();

    expect(new CascadeRunsAndFixesWithTheirRecord1809182600000().name).toBe(
      "CascadeRunsAndFixesWithTheirRecord1809182600000",
    );
    expect(names).toContain("CascadeRunsAndFixesWithTheirRecord1809182600000");
    const index: number = names.indexOf(
      "CascadeRunsAndFixesWithTheirRecord1809182600000",
    );

    expect(index).toBeGreaterThan(0);

    for (const name of names.slice(0, index)) {
      const stamp: string | undefined = name.match(/(\d{13})$/)?.[1];

      if (stamp) {
        expect({ name, isEarlier: Number(stamp) < 1809182600000 }).toEqual({
          name,
          isEarlier: true,
        });
      }
    }
  });

  test("runs without a transaction, as OnlineDdl requires", () => {
    const migration: MigrationInterface & { transaction?: boolean } =
      new CascadeRunsAndFixesWithTheirRecord1809182600000();

    expect(migration.transaction).toBe(false);
  });

  test("names the run's and the fix's incident and alert keys", () => {
    expect(
      RECORD_LINKS.map((link: RecordLink): string => {
        return `${link.table}.${link.column} -> ${link.recordTable}`;
      }),
    ).toEqual([
      "RunbookExecution.incidentId -> Incident",
      "RunbookExecution.alertId -> Alert",
      "AutoRemediationSuggestion.incidentId -> Incident",
      "AutoRemediationSuggestion.alertId -> Alert",
    ]);
  });

  test("each key's rows of records already gone are deleted, then the key is replaced CASCADE through OnlineDdl, as generated", async () => {
    const run: FakeRun = fakeRun();

    await new CascadeRunsAndFixesWithTheirRecord1809182600000().up(run.runner);

    const expected: Array<string> = [];

    for (const link of RECORD_LINKS) {
      expected.push(
        deleteOfDeletedRecords(link),
        `<replace ${cascadeStatement(link)}>`,
      );
    }

    expect(run.statements).toEqual(expected);
    expect(run.replaced).toEqual(RECORD_LINKS.map(cascadeStatement));
  });

  test("drops no key itself: never a moment without one, in which a delete would leave a run or a fix naming nothing", async () => {
    const run: FakeRun = fakeRun();

    await new CascadeRunsAndFixesWithTheirRecord1809182600000().up(run.runner);

    expect(
      run.statements.filter((statement: string): boolean => {
        return (
          !statement.startsWith("<replace ") &&
          (statement.includes("DROP CONSTRAINT") ||
            statement.includes("ADD CONSTRAINT"))
        );
      }),
    ).toEqual([]);
  });

  test("the keys are exactly the run's and the fix's record keys the models declare CASCADE", () => {
    const declared: Array<string> = getMetadataArgsStorage()
      .relations.filter((relation: RelationMetadataArgs): boolean => {
        return (
          (relation.target === RunbookExecution ||
            relation.target === AutoRemediationSuggestion) &&
          ["incident", "alert"].includes(relation.propertyName)
        );
      })
      .map((relation: RelationMetadataArgs): string => {
        return `${(relation.target as { name: string }).name}.${relation.propertyName}Id: ${String(relation.options?.onDelete)}`;
      })
      .sort();

    expect(declared).toEqual(
      RECORD_LINKS.map((link: RecordLink): string => {
        return `${link.table}.${link.column}: CASCADE`;
      }).sort(),
    );
  });

  test("down puts SET NULL back on all four", async () => {
    const statements: Array<string> = [];
    const runner: QueryRunner = {
      query: async (sql: string): Promise<unknown> => {
        statements.push(sql.replace(/\s+/g, " ").trim());
        return [];
      },
    } as unknown as QueryRunner;

    await new CascadeRunsAndFixesWithTheirRecord1809182600000().down(runner);

    for (const link of RECORD_LINKS) {
      expect(statements).toContain(
        `ALTER TABLE "${link.table}" DROP CONSTRAINT "${link.constraintName}"`,
      );
      expect(statements).toContain(
        `ALTER TABLE "${link.table}" ADD CONSTRAINT "${link.constraintName}" FOREIGN KEY ("${link.column}") REFERENCES "${link.recordTable}"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    }

    expect(statements).toHaveLength(8);
  });
});

describe("DeleteRunsAndFixesOfDeletedRecords1809182610000", () => {
  test("is registered right after the keys cascade, in a transaction of its own", () => {
    const names: Array<string> = migrationNames();

    expect(
      names.indexOf("DeleteRunsAndFixesOfDeletedRecords1809182610000"),
    ).toBe(
      names.indexOf("CascadeRunsAndFixesWithTheirRecord1809182600000") + 1,
    );

    const migration: MigrationInterface & { transaction?: boolean } =
      new DeleteRunsAndFixesOfDeletedRecords1809182610000();

    expect(migration.name).toBe(
      "DeleteRunsAndFixesOfDeletedRecords1809182610000",
    );
    expect(migration.transaction).toBeUndefined();
  });

  test("deletes the fixes' runs before the fixes, then the rule and auto-remediation runs naming no record", async () => {
    const statements: Array<string> = [];
    const runner: QueryRunner = {
      query: async (sql: string): Promise<unknown> => {
        statements.push(sql);
        return [];
      },
    } as unknown as QueryRunner;

    await new DeleteRunsAndFixesOfDeletedRecords1809182610000().up(runner);

    expect(statements).toEqual([
      DELETE_RUNS_OF_FIXES_OF_DELETED_RECORDS,
      DELETE_FIXES_OF_DELETED_RECORDS,
      DELETE_RUNS_OF_DELETED_RECORDS,
    ]);
  });

  test("a fix is deleted only when it names neither an incident nor an alert", () => {
    expect(DELETE_FIXES_OF_DELETED_RECORDS).toBe(
      `DELETE FROM "AutoRemediationSuggestion" WHERE "incidentId" IS NULL AND "alertId" IS NULL`,
    );
    expect(DELETE_RUNS_OF_FIXES_OF_DELETED_RECORDS).toContain(
      `SELECT "runbookExecutionId" FROM "AutoRemediationSuggestion" WHERE "incidentId" IS NULL AND "alertId" IS NULL`,
    );
  });

  test("a run is deleted only when a rule or auto-remediation started it and it names no incident, alert or maintenance event", () => {
    expect(DELETE_RUNS_OF_DELETED_RECORDS).toBe(
      `DELETE FROM "RunbookExecution" WHERE "triggerType" IN ('${RunbookTriggerType.Rule}', '${RunbookTriggerType.AutoRemediation}') AND "incidentId" IS NULL AND "alertId" IS NULL AND "scheduledMaintenanceId" IS NULL`,
    );
  });

  test("down deletes nothing back", async () => {
    const query: ReturnType<typeof jest.fn> = jest.fn();

    await new DeleteRunsAndFixesOfDeletedRecords1809182610000().down({
      query: query,
    } as unknown as QueryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
