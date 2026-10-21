import { AddRunbookRuleMatchCriteria1797500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797500000000-AddRunbookRuleMatchCriteria";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import RunbookRule from "../../../../Models/DatabaseModels/RunbookRule";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../../Types/Rules/RuleCriteriaFieldRegistry";
import { describe, expect, test } from "@jest/globals";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * The schema half of runbook rule criteria: one join table per relation a
 * runbook rule can now match on, and the two monitor pattern columns.
 *
 * The migration was generated against the model, so its names are TypeORM's
 * by construction. What this pins is that it STAYS the migration for these
 * columns: every join table the model declares is created, keyed and cleaned
 * up the way TypeORM names it (a hand edit that renamed a constraint would
 * pass review and then fail the Schema Drift job), the pattern columns are as
 * wide as the other rules', existing rules are not touched, and down() undoes
 * up() in reverse.
 *
 * Fake QueryRunner only. Applying it to Postgres 15 after every registered
 * migration, re-generating to "No schema drift", reverting it and applying it
 * again is how it was verified when written.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddRunbookRuleMatchCriteria1797500000000()[direction](queryRunner);

  return statements;
};

interface JoinTableSpec {
  property: string;
  tableName: string;
  relatedColumn: string;
  relatedTable: string;
}

const JOIN_TABLES: Array<JoinTableSpec> = [
  {
    property: "monitors",
    tableName: "RunbookRuleMonitor",
    relatedColumn: "monitorId",
    relatedTable: "Monitor",
  },
  {
    property: "incidentSeverities",
    tableName: "RunbookRuleIncidentSeverity",
    relatedColumn: "incidentSeverityId",
    relatedTable: "IncidentSeverity",
  },
  {
    property: "alertSeverities",
    tableName: "RunbookRuleAlertSeverity",
    relatedColumn: "alertSeverityId",
    relatedTable: "AlertSeverity",
  },
  {
    property: "labels",
    tableName: "RunbookRuleLabel",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    property: "monitorLabels",
    tableName: "RunbookRuleMonitorLabel",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
];

const PATTERN_COLUMNS: Array<string> = [
  "monitorNamePattern",
  "monitorDescriptionPattern",
];

function createTableStatement(
  statements: Array<string>,
  tableName: string,
): string {
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(`CREATE TABLE "${tableName}" (`);
    },
  );

  expect({ tableName, found: matches.length }).toEqual({
    tableName,
    found: 1,
  });

  return matches[0]!;
}

function foreignKeyStatement(
  statements: Array<string>,
  tableName: string,
  columnName: string,
): string {
  const name: string = namingStrategy.foreignKeyName(tableName, [columnName]);
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(
        `ALTER TABLE "${tableName}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${columnName}")`,
      );
    },
  );

  expect({ tableName, columnName, found: matches.length }).toEqual({
    tableName,
    columnName,
    found: 1,
  });

  return matches[0]!;
}

describe("AddRunbookRuleMatchCriteria1797500000000", () => {
  test("is registered under the name its class carries, after every earlier migration", () => {
    const migration: AddRunbookRuleMatchCriteria1797500000000 =
      new AddRunbookRuleMatchCriteria1797500000000();

    expect(migration.name).toBe("AddRunbookRuleMatchCriteria1797500000000");
    expect(SchemaMigrations).toContain(
      AddRunbookRuleMatchCriteria1797500000000,
    );

    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((registered: { name: string }): string => {
      return registered.name;
    });
    const ownIndex: number = names.indexOf(
      "AddRunbookRuleMatchCriteria1797500000000",
    );

    expect(ownIndex).toBeGreaterThan(0);
    expect(
      names.slice(0, ownIndex).filter((className: string): boolean => {
        const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
        return match !== null && Number(match[1]) >= 1797500000000;
      }),
    ).toEqual([]);
  });

  test("creates a join table for every relation the model declares, and nothing else", async () => {
    const statements: Array<string> = await recordQueries("up");
    const declared: Array<string> = getMetadataArgsStorage()
      .joinTables.filter((joinTable: JoinTableMetadataArgs): boolean => {
        return (
          joinTable.target === RunbookRule &&
          JOIN_TABLES.some((spec: JoinTableSpec): boolean => {
            return spec.property === joinTable.propertyName;
          })
        );
      })
      .map((joinTable: JoinTableMetadataArgs): string => {
        return joinTable.name || "";
      })
      .sort();

    expect(declared).toEqual(
      JOIN_TABLES.map((spec: JoinTableSpec): string => {
        return spec.tableName;
      }).sort(),
    );
    expect(
      statements
        .filter((statement: string): boolean => {
          return statement.startsWith("CREATE TABLE");
        })
        .map((statement: string): string => {
          return statement.match(/^CREATE TABLE "([^"]+)"/)![1]!;
        })
        .sort(),
    ).toEqual(declared);
  });

  test.each(JOIN_TABLES)(
    "creates $tableName, keyed by the rule and the $relatedTable",
    async (spec: JoinTableSpec) => {
      const statements: Array<string> = await recordQueries("up");
      const statement: string = createTableStatement(
        statements,
        spec.tableName,
      );

      expect(statement).toContain(
        `PRIMARY KEY ("runbookRuleId", "${spec.relatedColumn}")`,
      );
      expect(spec.tableName.length).toBeLessThanOrEqual(63);

      // Deleting a rule, or what it names, removes the link only.
      expect(
        foreignKeyStatement(statements, spec.tableName, "runbookRuleId"),
      ).toContain(`REFERENCES "RunbookRule"("_id") ON DELETE CASCADE`);
      expect(
        foreignKeyStatement(statements, spec.tableName, spec.relatedColumn),
      ).toContain(`REFERENCES "${spec.relatedTable}"("_id") ON DELETE CASCADE`);

      for (const column of ["runbookRuleId", spec.relatedColumn]) {
        const indexName: string = namingStrategy.indexName(spec.tableName, [
          column,
        ]);

        expect(statements).toContain(
          `CREATE INDEX "${indexName}" ON "${spec.tableName}" ("${column}") `,
        );
      }
    },
  );

  test("adds the monitor name and description patterns, nullable, as wide as the title pattern", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const column of PATTERN_COLUMNS) {
      expect(statements).toContain(
        `ALTER TABLE "RunbookRule" ADD "${column}" character varying(500)`,
      );
      expect(new RunbookRule().getTableColumnMetadata(column)?.type).toBe(
        TableColumnType.LongText,
      );
    }
  });

  test("leaves every existing rule as it is: no rewrite, no default, no new NOT NULL", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const statement of statements) {
      expect(statement).not.toMatch(/^(UPDATE|DELETE|INSERT)\b/);
      expect(statement).not.toMatch(/ALTER TABLE "RunbookRule" .*NOT NULL/);
      expect(statement).not.toMatch(/DEFAULT/);
      expect(statement).not.toContain('"criteria"');
    }
  });

  test("covers every new criterion the API allows on runbook rules", () => {
    const covered: Array<string> = [
      ...JOIN_TABLES.map((spec: JoinTableSpec): string => {
        return spec.property;
      }),
      ...PATTERN_COLUMNS,
      // Columns RunbookRule had before this migration.
      "titlePattern",
      "descriptionPattern",
    ].sort();

    expect(covered).toEqual(
      [...RULE_CRITERIA_FIELDS_BY_MODEL["RunbookRule"]!].sort(),
    );
  });

  test("down() drops exactly what up() created, constraints first", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    for (const spec of JOIN_TABLES) {
      const dropTable: number = down.indexOf(`DROP TABLE "${spec.tableName}"`);

      expect(dropTable).toBeGreaterThan(-1);

      for (const column of ["runbookRuleId", spec.relatedColumn]) {
        const constraint: string = namingStrategy.foreignKeyName(
          spec.tableName,
          [column],
        );
        const dropConstraint: number = down.indexOf(
          `ALTER TABLE "${spec.tableName}" DROP CONSTRAINT "${constraint}"`,
        );
        const dropIndex: number = down.indexOf(
          `DROP INDEX "public"."${namingStrategy.indexName(spec.tableName, [
            column,
          ])}"`,
        );

        expect({ constraint, dropped: dropConstraint > -1 }).toEqual({
          constraint,
          dropped: true,
        });
        expect(dropConstraint).toBeLessThan(dropTable);
        expect(dropIndex).toBeGreaterThan(-1);
        expect(dropIndex).toBeLessThan(dropTable);
      }
    }

    for (const column of PATTERN_COLUMNS) {
      expect(down).toContain(
        `ALTER TABLE "RunbookRule" DROP COLUMN "${column}"`,
      );
    }

    // One undo per thing done.
    expect(down).toHaveLength(up.length);
  });
});
