import { AddSloLabelAndOwnerRules1794100000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1794100000000-AddSloLabelAndOwnerRules";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ServiceLevelObjectiveLabelRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import ServiceLevelObjectiveOwnerRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import { describe, expect, test } from "@jest/globals";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of SLO label and owner rules.
 *
 * The migration was generated against the models, so its names are TypeORM's
 * by construction. What this pins is that it STAYS the migration for these
 * models: every table and join table is created with every column the models
 * persist (criteria included, which 1792500000000 never added to these new
 * tables), every constraint carries TypeORM's own name - a hand edit that
 * renamed one would pass review and then fail the Schema Drift job - rules go
 * with their project and a label, user or team leaves every rule that named
 * it, nothing unrelated rode along, and down() undoes up() in reverse.
 *
 * Fake QueryRunner only. Applying it to Postgres 15, re-generating to "No
 * changes in database schema were found", reverting and applying it again is
 * how it was verified when written.
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

  await new AddSloLabelAndOwnerRules1794100000000()[direction](queryRunner);

  return statements;
};

// Columns a model persists, inherited ones (_id, version, criteria) included.
function persistedColumns(modelType: unknown): Array<string> {
  const names: Array<string> = [];
  let current: unknown = modelType;

  while (typeof current === "function" && current !== Function.prototype) {
    for (const column of getMetadataArgsStorage().columns) {
      if (column.target === current) {
        const args: ColumnMetadataArgs = column;
        names.push(args.options.name || args.propertyName);
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return names;
}

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

const RULE_TABLES: Array<[string, unknown]> = [
  ["ServiceLevelObjectiveLabelRule", ServiceLevelObjectiveLabelRule],
  ["ServiceLevelObjectiveOwnerRule", ServiceLevelObjectiveOwnerRule],
];

interface JoinTableSpec {
  tableName: string;
  ruleColumn: string;
  ruleTable: string;
  relatedColumn: string;
  relatedTable: string;
}

const JOIN_TABLES: Array<JoinTableSpec> = [
  {
    tableName: "ServiceLevelObjectiveLabelRuleServiceLevelObjectiveLabel",
    ruleColumn: "serviceLevelObjectiveLabelRuleId",
    ruleTable: "ServiceLevelObjectiveLabelRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "ServiceLevelObjectiveLabelRuleLabelToAdd",
    ruleColumn: "serviceLevelObjectiveLabelRuleId",
    ruleTable: "ServiceLevelObjectiveLabelRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "ServiceLevelObjectiveOwnerRuleServiceLevelObjectiveLabel",
    ruleColumn: "serviceLevelObjectiveOwnerRuleId",
    ruleTable: "ServiceLevelObjectiveOwnerRule",
    relatedColumn: "labelId",
    relatedTable: "Label",
  },
  {
    tableName: "ServiceLevelObjectiveOwnerRuleOwnerUser",
    ruleColumn: "serviceLevelObjectiveOwnerRuleId",
    ruleTable: "ServiceLevelObjectiveOwnerRule",
    relatedColumn: "userId",
    relatedTable: "User",
  },
  {
    tableName: "ServiceLevelObjectiveOwnerRuleOwnerTeam",
    ruleColumn: "serviceLevelObjectiveOwnerRuleId",
    ruleTable: "ServiceLevelObjectiveOwnerRule",
    relatedColumn: "teamId",
    relatedTable: "Team",
  },
];

const ALL_TABLES: Array<string> = [
  ...RULE_TABLES.map(([tableName]: [string, unknown]): string => {
    return tableName;
  }),
  ...JOIN_TABLES.map((spec: JoinTableSpec): string => {
    return spec.tableName;
  }),
];

describe("AddSloLabelAndOwnerRules1794100000000", () => {
  test("is registered, last, under the name its class carries", () => {
    const migration: AddSloLabelAndOwnerRules1794100000000 =
      new AddSloLabelAndOwnerRules1794100000000();

    expect(migration.name).toBe("AddSloLabelAndOwnerRules1794100000000");
    expect(SchemaMigrations[SchemaMigrations.length - 1]).toBe(
      AddSloLabelAndOwnerRules1794100000000,
    );
  });

  test("touches only the seven new tables", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const statement of statements) {
      const table: RegExpMatchArray | null = statement.match(
        /^(?:CREATE TABLE|ALTER TABLE|CREATE INDEX "[^"]+" ON) "([^"]+)"/,
      );

      expect({ statement, table: table?.[1] }).toEqual({
        statement,
        table: expect.stringMatching(new RegExp(`^(${ALL_TABLES.join("|")})$`)),
      });
    }

    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith("CREATE TABLE");
      }),
    ).toHaveLength(ALL_TABLES.length);
  });

  test.each(RULE_TABLES)(
    "creates %s with every column the model persists",
    async (tableName: string, modelType: unknown) => {
      const statement: string = createTableStatement(
        await recordQueries("up"),
        tableName,
      );

      for (const column of persistedColumns(modelType)) {
        expect({
          tableName,
          column,
          created: statement.includes(`"${column}"`),
        }).toEqual({ tableName, column, created: true });
      }

      expect(statement).toContain('"criteria" jsonb');
      expect(statement).toContain('"isEnabled" boolean NOT NULL DEFAULT true');
      expect(statement).toContain('"projectId" uuid NOT NULL');
    },
  );

  test("defaults an owner rule to notifying the owners it adds", async () => {
    expect(
      createTableStatement(
        await recordQueries("up"),
        "ServiceLevelObjectiveOwnerRule",
      ),
    ).toContain('"notifyOwners" boolean NOT NULL DEFAULT true');
  });

  test.each(RULE_TABLES)(
    "deletes %s with its project, and keeps it when its author is deleted",
    async (tableName: string) => {
      const statements: Array<string> = await recordQueries("up");

      expect(foreignKeyStatement(statements, tableName, "projectId")).toContain(
        'REFERENCES "Project"("_id") ON DELETE CASCADE',
      );
      expect(
        foreignKeyStatement(statements, tableName, "createdByUserId"),
      ).toContain('REFERENCES "User"("_id") ON DELETE SET NULL');
      expect(
        foreignKeyStatement(statements, tableName, "deletedByUserId"),
      ).toContain('REFERENCES "User"("_id") ON DELETE SET NULL');
    },
  );

  test.each(JOIN_TABLES)(
    "creates $tableName, keyed by the rule and the $relatedTable",
    async (spec: JoinTableSpec) => {
      const statements: Array<string> = await recordQueries("up");
      const statement: string = createTableStatement(
        statements,
        spec.tableName,
      );

      expect(statement).toContain(
        `PRIMARY KEY ("${spec.ruleColumn}", "${spec.relatedColumn}")`,
      );
      expect(spec.tableName.length).toBeLessThanOrEqual(63);

      // Both sides clean up after themselves.
      expect(
        foreignKeyStatement(statements, spec.tableName, spec.ruleColumn),
      ).toContain(`REFERENCES "${spec.ruleTable}"("_id") ON DELETE CASCADE`);
      expect(
        foreignKeyStatement(statements, spec.tableName, spec.relatedColumn),
      ).toContain(`REFERENCES "${spec.relatedTable}"("_id") ON DELETE CASCADE`);

      for (const column of [spec.ruleColumn, spec.relatedColumn]) {
        const indexName: string = namingStrategy.indexName(spec.tableName, [
          column,
        ]);

        expect(statements).toContain(
          `CREATE INDEX "${indexName}" ON "${spec.tableName}" ("${column}") `,
        );
      }
    },
  );

  test("indexes the columns the rule engines and tables filter on", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const [tableName] of RULE_TABLES) {
      for (const column of ["projectId", "name", "isEnabled"]) {
        const indexName: string = namingStrategy.indexName(tableName, [column]);

        expect(statements).toContain(
          `CREATE INDEX "${indexName}" ON "${tableName}" ("${column}") `,
        );
      }
    }
  });

  test("down() drops every table up() created, join tables first", async () => {
    const down: Array<string> = await recordQueries("down");
    const dropped: Array<string> = down
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^DROP TABLE "([^"]+)"$/,
        );
        return match ? match[1]! : null;
      })
      .filter((tableName: string | null): tableName is string => {
        return tableName !== null;
      });

    expect([...dropped].sort()).toEqual([...ALL_TABLES].sort());

    for (const spec of JOIN_TABLES) {
      expect(dropped.indexOf(spec.tableName)).toBeLessThan(
        dropped.indexOf(spec.ruleTable),
      );
    }
  });

  test("down() removes every constraint and index up() added, in reverse", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const addedConstraints: Array<string> = up
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /ADD CONSTRAINT "([^"]+)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });
    const droppedConstraints: Array<string> = down
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /DROP CONSTRAINT "([^"]+)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });

    expect(droppedConstraints).toEqual([...addedConstraints].reverse());

    const addedIndexes: Array<string> = up
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^CREATE INDEX "([^"]+)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });
    const droppedIndexes: Array<string> = down
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^DROP INDEX "public"\."([^"]+)"$/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });

    expect([...droppedIndexes].sort()).toEqual([...addedIndexes].sort());
  });
});
