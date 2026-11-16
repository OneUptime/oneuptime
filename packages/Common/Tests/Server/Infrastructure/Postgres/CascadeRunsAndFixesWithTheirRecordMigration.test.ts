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
import type { SpyInstance } from "jest-mock";
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
 *     dropped as generated and added back through OnlineDdl (NOT VALID,
 *     then validated without blocking writers), in a migration without a
 *     transaction. A run that stopped part way is safe to run again: a key
 *     already replaced is not dropped again, and the rows a record deleted
 *     between a DROP and its ADD left naming it are deleted before the key
 *     is validated. The keys are exactly the ones the models declare
 *     CASCADE, so the schema drift check and the migration agree; down puts
 *     SET NULL back.
 *   - DeleteRunsAndFixesOfDeletedRecords: what already outlived its record
 *     - the fixes naming neither an incident nor an alert, the runs they
 *     started, the rule and auto-remediation runs naming no record - in one
 *     transaction, after the keys.
 *
 * Pinned against a fake QueryRunner whose catalog answers what each key's ON
 * DELETE is (confdeltype), with OnlineDdl.addForeignKey recorded rather than
 * run (OnlineDdl.test.ts covers it). CascadeRunsAndFixesWithTheirRecord
 * Postgres.test.ts runs both on a real database.
 */

interface FakeRun {
  runner: QueryRunner;
  // Every statement, catalog lookups as "<lookup NAME on TABLE>", in order.
  statements: Array<string>;
  // The statements handed to OnlineDdl.addForeignKey, in order.
  onlineAdds: Array<string>;
}

let addForeignKey: SpyInstance<typeof OnlineDdl.addForeignKey>;

/*
 * `onDelete` is what the catalog says each key does now: 'n' as the
 * migrations before left it, 'c' once replaced; missing names read as absent.
 */
function fakeRun(onDelete: Record<string, string>): FakeRun {
  const statements: Array<string> = [];
  const onlineAdds: Array<string> = [];

  const runner: QueryRunner = {
    query: async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      const statement: string = sql.replace(/\s+/g, " ").trim();

      if (statement.includes("FROM pg_constraint")) {
        // Scoped to the key's own table, resolved the way the DROP resolves it.
        expect(statement).toContain("to_regclass($2)");

        const name: string = String(parameters?.[0]);
        statements.push(`<lookup ${name} on ${String(parameters?.[1])}>`);

        return onDelete[name] ? [{ onDelete: onDelete[name] }] : [];
      }

      statements.push(statement);
      return [];
    },
  } as unknown as QueryRunner;

  addForeignKey = jest
    .spyOn(OnlineDdl, "addForeignKey")
    .mockImplementation(
      async (_queryRunner: QueryRunner, statement: string): Promise<void> => {
        onlineAdds.push(statement);
        statements.push(`<online ${statement}>`);
      },
    );

  return { runner, statements, onlineAdds };
}

function everyKey(onDelete: string): Record<string, string> {
  const states: Record<string, string> = {};

  for (const link of RECORD_LINKS) {
    states[link.constraintName] = onDelete;
  }

  return states;
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
    expect(
      names.indexOf("CascadeRunsAndFixesWithTheirRecord1809182600000"),
    ).toBeGreaterThan(
      names.indexOf("AddCustomFieldsAndRemindersToUpdatesToPost1809182480026"),
    );
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

  test("each key is dropped as generated, the rows of records already gone deleted, then added back CASCADE through OnlineDdl", async () => {
    const run: FakeRun = fakeRun(everyKey("n"));

    await new CascadeRunsAndFixesWithTheirRecord1809182600000().up(run.runner);

    const expected: Array<string> = [];

    for (const link of RECORD_LINKS) {
      expected.push(
        `<lookup ${link.constraintName} on "${link.table}">`,
        `ALTER TABLE "${link.table}" DROP CONSTRAINT IF EXISTS "${link.constraintName}"`,
        deleteOfDeletedRecords(link),
        `<online ${cascadeStatement(link)}>`,
      );
    }

    expect(run.statements).toEqual(expected);
    expect(addForeignKey).toHaveBeenCalledTimes(4);

    for (const call of addForeignKey.mock.calls) {
      expect(call[0]).toBe(run.runner);
    }
  });

  test("run again after a stop part way, a key already replaced is not dropped again, and OnlineDdl still sees it", async () => {
    const states: Record<string, string> = everyKey("n");
    const replaced: Array<string> = [
      RECORD_LINKS[0]!.constraintName,
      RECORD_LINKS[1]!.constraintName,
    ];

    for (const name of replaced) {
      states[name] = "c";
    }

    const run: FakeRun = fakeRun(states);

    await new CascadeRunsAndFixesWithTheirRecord1809182600000().up(run.runner);

    const drops: Array<string> = run.statements.filter(
      (statement: string): boolean => {
        return statement.includes("DROP CONSTRAINT");
      },
    );

    expect(drops).toHaveLength(2);

    for (const name of replaced) {
      expect(drops.join("\n")).not.toContain(name);
    }

    expect(run.onlineAdds).toEqual(RECORD_LINKS.map(cascadeStatement));
  });

  test("a key that is not there at all is added", async () => {
    const run: FakeRun = fakeRun({});

    await new CascadeRunsAndFixesWithTheirRecord1809182600000().up(run.runner);

    // DROP IF EXISTS: nothing to drop is not an error.
    expect(run.onlineAdds).toHaveLength(4);
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
