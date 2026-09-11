import { AddConfigurableRuleCriteria1792400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1792400000000-AddConfigurableRuleCriteria";
import ObjectID from "../../../../Types/ObjectID";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../../Types/Rules/RuleCriteriaFieldRegistry";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

const REMINDER_TABLES: ReadonlyArray<string> = [
  "AlertReminderRule",
  "IncidentReminderRule",
  "ScheduledMaintenanceReminderRule",
];
const NEVER_MATCH_PATTERN: string = "(?!)";
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RULE_CRITERIA_MIGRATION_TESTS"] === "true"
    ? describe
    : describe.skip;

interface LegacyShadowTrigger {
  triggerName: string;
  tableName: string;
  functionName: string;
  fieldName: string;
}

interface RelationOnlyShadowTrigger {
  triggerName: string;
  tableName: string;
  functionName: string;
}

async function queriesFor(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  const migration: AddConfigurableRuleCriteria1792400000000 =
    new AddConfigurableRuleCriteria1792400000000();
  await migration[direction](queryRunner);

  return statements;
}

function tablesMatching(
  statements: ReadonlyArray<string>,
  expression: RegExp,
): Array<string> {
  return statements.flatMap((statement: string): Array<string> => {
    const match: RegExpMatchArray | null = statement.match(expression);
    return match?.[1] ? [match[1]] : [];
  });
}

function expectedLegacyShadowMappings(): Array<readonly [string, string]> {
  const registeredEntries: Array<[string, ReadonlyArray<string>]> =
    Object.entries(RULE_CRITERIA_FIELDS_BY_MODEL) as Array<
      [string, ReadonlyArray<string>]
    >;

  return registeredEntries.flatMap(
    ([tableName, fields]: [string, ReadonlyArray<string>]): Array<
      readonly [string, string]
    > => {
      const fieldName: string | undefined = fields.find(
        (field: string): boolean => {
          return field.match(/(pattern|regex)/i) !== null;
        },
      );

      return fieldName ? [[tableName, fieldName]] : [];
    },
  );
}

function legacyShadowTriggers(
  statements: ReadonlyArray<string>,
): Array<LegacyShadowTrigger> {
  return statements
    .filter((statement: string): boolean => {
      return statement.match(/EXECUTE FUNCTION "[^"]+"\('[^']+'\)$/) !== null;
    })
    .map((statement: string): LegacyShadowTrigger => {
      const match: RegExpMatchArray | null = statement.match(
        /^CREATE TRIGGER "([^"]+)" BEFORE INSERT OR UPDATE ON "([^"]+)" FOR EACH ROW EXECUTE FUNCTION "([^"]+)"\('([^']+)'\)$/,
      );

      if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
        throw new Error(`Unexpected rule criteria trigger: ${statement}`);
      }

      return {
        triggerName: match[1],
        tableName: match[2],
        functionName: match[3],
        fieldName: match[4],
      };
    });
}

function relationOnlyShadowTriggers(
  statements: ReadonlyArray<string>,
): Array<RelationOnlyShadowTrigger> {
  return statements
    .filter((statement: string): boolean => {
      return (
        statement.startsWith("CREATE TRIGGER ") &&
        statement.match(/EXECUTE FUNCTION "[^"]+"\(\)$/) !== null
      );
    })
    .map((statement: string): RelationOnlyShadowTrigger => {
      const match: RegExpMatchArray | null = statement.match(
        /^CREATE TRIGGER "([^"]+)" BEFORE INSERT OR UPDATE ON "([^"]+)" FOR EACH ROW EXECUTE FUNCTION "([^"]+)"\(\)$/,
      );

      if (!match?.[1] || !match[2] || !match[3]) {
        throw new Error(
          `Unexpected relation-only rule criteria trigger: ${statement}`,
        );
      }

      return {
        triggerName: match[1],
        tableName: match[2],
        functionName: match[3],
      };
    });
}

describe("AddConfigurableRuleCriteria migration", () => {
  test("adds and removes criteria for every registered rule model exactly once", async () => {
    const upStatements: Array<string> = await queriesFor("up");
    const downStatements: Array<string> = await queriesFor("down");
    const registeredModels: Array<string> = Object.keys(
      RULE_CRITERIA_FIELDS_BY_MODEL,
    ).sort();

    const addedTables: Array<string> = tablesMatching(
      upStatements,
      /^ALTER TABLE "([^"]+)" ADD "criteria" jsonb$/,
    );
    const removedTables: Array<string> = tablesMatching(
      downStatements,
      /^ALTER TABLE "([^"]+)" DROP COLUMN "criteria"$/,
    );

    expect(addedTables).toHaveLength(registeredModels.length);
    expect(removedTables).toHaveLength(registeredModels.length);
    expect([...addedTables].sort()).toEqual(registeredModels);
    expect([...removedTables].sort()).toEqual(registeredModels);
  });

  test("guards every pattern-backed criteria row with its exact legacy shadow", async () => {
    const statements: Array<string> = await queriesFor("up");
    const expectedMappings: Array<readonly [string, string]> =
      expectedLegacyShadowMappings();
    const triggers: Array<LegacyShadowTrigger> =
      legacyShadowTriggers(statements);
    const functionStatements: Array<string> = statements.filter(
      (statement: string): boolean => {
        return statement.includes("jsonb_build_object(TG_ARGV[0], '(?!)')");
      },
    );

    expect(expectedMappings).toHaveLength(70);
    expect(triggers).toHaveLength(expectedMappings.length);
    expect(
      triggers
        .map((trigger: LegacyShadowTrigger): string => {
          return `${trigger.tableName}:${trigger.fieldName}`;
        })
        .sort(),
    ).toEqual(
      expectedMappings
        .map(([tableName, fieldName]: readonly [string, string]): string => {
          return `${tableName}:${fieldName}`;
        })
        .sort(),
    );
    expect(
      new Set(
        triggers.map((trigger: LegacyShadowTrigger): string => {
          return trigger.triggerName;
        }),
      ).size,
    ).toBe(1);
    expect(
      new Set(
        triggers.map((trigger: LegacyShadowTrigger): string => {
          return trigger.functionName;
        }),
      ).size,
    ).toBe(1);
    expect(
      triggers.filter((trigger: LegacyShadowTrigger): boolean => {
        return REMINDER_TABLES.includes(trigger.tableName);
      }),
    ).toEqual([]);

    expect(functionStatements).toHaveLength(1);
    expect(functionStatements[0]).toContain(
      'IF NEW."criteria" IS NOT NULL THEN',
    );
    expect(functionStatements[0]).toContain(
      "jsonb_build_object(TG_ARGV[0], '(?!)')",
    );
    expect(functionStatements[0]).toContain("RETURN NEW;");
  });

  test("guards exactly the three relation-only rules from legacy enabled writes", async () => {
    const statements: Array<string> = await queriesFor("up");
    const triggers: Array<RelationOnlyShadowTrigger> =
      relationOnlyShadowTriggers(statements);
    const functionStatements: Array<string> = statements.filter(
      (statement: string): boolean => {
        return statement.includes(
          `NEW."criteria" -> 'isEnabled' = 'true'::jsonb`,
        );
      },
    );

    expect(triggers).toHaveLength(REMINDER_TABLES.length);
    expect(
      triggers
        .map((trigger: RelationOnlyShadowTrigger): string => {
          return trigger.tableName;
        })
        .sort(),
    ).toEqual([...REMINDER_TABLES].sort());
    expect(
      new Set(
        triggers.map((trigger: RelationOnlyShadowTrigger): string => {
          return trigger.triggerName;
        }),
      ).size,
    ).toBe(1);
    expect(
      new Set(
        triggers.map((trigger: RelationOnlyShadowTrigger): string => {
          return trigger.functionName;
        }),
      ).size,
    ).toBe(1);
    expect(functionStatements).toHaveLength(1);
    expect(functionStatements[0]).toContain(
      `WHEN NEW."criteria" -> 'isEnabled' = 'true'::jsonb THEN NULL`,
    );
    expect(functionStatements[0]).toContain("ELSE false");
  });

  test("removes every legacy-shadow guard before removing criteria", async () => {
    const statements: Array<string> = await queriesFor("down");
    const expectedMappings: Array<readonly [string, string]> =
      expectedLegacyShadowMappings();
    const droppedTriggerTables: Array<string> = tablesMatching(
      statements,
      /^DROP TRIGGER "TRG_rule_criteria_legacy_shadow_1792400000000" ON "([^"]+)"$/,
    );
    const functionDropIndexes: Array<number> = statements.flatMap(
      (statement: string, index: number): Array<number> => {
        return statement ===
          'DROP FUNCTION "set_rule_criteria_legacy_shadow_1792400000000"()'
          ? [index]
          : [];
      },
    );
    const lastPatternTriggerDropIndex: number = statements.reduce(
      (lastIndex: number, statement: string, index: number): number => {
        return statement.startsWith(
          'DROP TRIGGER "TRG_rule_criteria_legacy_shadow_1792400000000"',
        )
          ? index
          : lastIndex;
      },
      -1,
    );
    const firstCriteriaDropIndex: number = statements.findIndex(
      (statement: string): boolean => {
        return statement.match(/DROP COLUMN "criteria"$/) !== null;
      },
    );

    expect(droppedTriggerTables).toHaveLength(expectedMappings.length);
    expect([...droppedTriggerTables].sort()).toEqual(
      expectedMappings
        .map(([tableName]: readonly [string, string]): string => {
          return tableName;
        })
        .sort(),
    );
    expect(functionDropIndexes).toHaveLength(1);
    expect(lastPatternTriggerDropIndex).toBeGreaterThanOrEqual(0);
    expect(functionDropIndexes[0]).toBeGreaterThan(lastPatternTriggerDropIndex);
    expect(firstCriteriaDropIndex).toBeGreaterThan(functionDropIndexes[0]!);
  });

  test("removes all relation-only guards before rollback normalization", async () => {
    const statements: Array<string> = await queriesFor("down");
    const droppedTriggerTables: Array<string> = tablesMatching(
      statements,
      /^DROP TRIGGER "TRG_relation_only_rule_criteria_shadow_1792400000000" ON "([^"]+)"$/,
    );
    const functionDropIndex: number = statements.indexOf(
      'DROP FUNCTION "set_relation_only_rule_criteria_shadow_1792400000000"()',
    );
    const lastTriggerDropIndex: number = statements.reduce(
      (lastIndex: number, statement: string, index: number): number => {
        return statement.startsWith(
          'DROP TRIGGER "TRG_relation_only_rule_criteria_shadow_1792400000000"',
        )
          ? index
          : lastIndex;
      },
      -1,
    );
    const firstReminderBackfillIndex: number = statements.findIndex(
      (statement: string): boolean => {
        return (
          statement.startsWith('UPDATE "') &&
          statement.includes(
            'ReminderRule" SET "isEnabled" = true WHERE "isEnabled" IS NULL',
          )
        );
      },
    );

    expect(droppedTriggerTables.sort()).toEqual([...REMINDER_TABLES].sort());
    expect(functionDropIndex).toBeGreaterThan(lastTriggerDropIndex);
    expect(firstReminderBackfillIndex).toBeGreaterThan(functionDropIndex);
  });

  test("restores enabled reminder rows before making legacy columns required", async () => {
    const statements: Array<string> = await queriesFor("down");

    for (const tableName of REMINDER_TABLES) {
      const dropCheckIndex: number = statements.findIndex(
        (statement: string): boolean => {
          return (
            statement.startsWith(
              `ALTER TABLE "${tableName}" DROP CONSTRAINT`,
            ) && statement.includes("CHK_")
          );
        },
      );
      const backfillIndex: number = statements.indexOf(
        `UPDATE "${tableName}" SET "isEnabled" = true WHERE "isEnabled" IS NULL`,
      );
      const requireEnabledIndex: number = statements.indexOf(
        `ALTER TABLE "${tableName}" ALTER COLUMN "isEnabled" SET NOT NULL`,
      );
      const dropCriteriaIndex: number = statements.indexOf(
        `ALTER TABLE "${tableName}" DROP COLUMN "criteria"`,
      );

      expect(dropCheckIndex).toBeGreaterThanOrEqual(0);
      expect(backfillIndex).toBeGreaterThan(dropCheckIndex);
      expect(requireEnabledIndex).toBeGreaterThan(backfillIndex);
      expect(dropCriteriaIndex).toBeGreaterThan(requireEnabledIndex);
    }
  });
});

describePostgres("rule criteria migration against Postgres", () => {
  const schema: string = `rule_criteria_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const representativeTable: string = "StatusPageMonitorRule";
  const representativeField: string = "monitorNamePattern";
  const migration: AddConfigurableRuleCriteria1792400000000 =
    new AddConfigurableRuleCriteria1792400000000();
  let database: DataSource;
  let runner: QueryRunner;
  let migrationApplied: boolean = false;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["RULE_CRITERIA_MIGRATION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["RULE_CRITERIA_MIGRATION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: [],
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    runner = database.createQueryRunner();
    await runner.connect();
    const currentSchemaRows: Array<{ current_schema: string }> =
      await runner.query("SELECT current_schema()");
    expect(currentSchemaRows[0]?.current_schema).toBe(schema);

    const upStatements: Array<string> = await queriesFor("up");
    const criteriaTables: Array<string> = tablesMatching(
      upStatements,
      /^ALTER TABLE "([^"]+)" ADD "criteria" jsonb$/,
    );
    const shadowFieldsByTable: Map<string, string> = new Map(
      legacyShadowTriggers(upStatements).map(
        (trigger: LegacyShadowTrigger): [string, string] => {
          return [trigger.tableName, trigger.fieldName];
        },
      ),
    );

    for (const tableName of criteriaTables) {
      const shadowField: string | undefined =
        shadowFieldsByTable.get(tableName);
      if (!shadowField && !REMINDER_TABLES.includes(tableName)) {
        throw new Error(`Missing legacy shadow field for ${tableName}`);
      }

      const legacyColumn: string = shadowField
        ? `, "${shadowField}" text`
        : ', "isEnabled" boolean NOT NULL DEFAULT true';
      await runner.query(
        `CREATE TABLE "${tableName}" ("_id" uuid PRIMARY KEY${legacyColumn})`,
      );
    }

    await migration.up(runner);
    migrationApplied = true;
  });

  afterAll(async () => {
    if (runner) {
      if (migrationApplied) {
        await migration.down(runner);
      }
      await runner.release();
    }
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("keeps inserts and legacy updates fail-closed, then rolls back cleanly", async () => {
    interface StoredShadow {
      monitorNamePattern: string | null;
    }

    interface StoredReminderShadow {
      isEnabled: boolean | null;
    }

    interface ReminderIds {
      enabledId: string;
      disabledId: string;
    }

    const rowId: string = ObjectID.generate().toString();
    const reminderIdsByTable: Map<string, ReminderIds> = new Map(
      REMINDER_TABLES.map((tableName: string): [string, ReminderIds] => {
        return [
          tableName,
          {
            enabledId: ObjectID.generate().toString(),
            disabledId: ObjectID.generate().toString(),
          },
        ];
      }),
    );
    const criteria: string = JSON.stringify({
      schemaVersion: 1,
      filterCondition: "All",
      filters: [
        {
          field: "monitorNamePattern",
          operator: "Contains",
          value: "api",
        },
      ],
    });
    const enabledReminderCriteria: string = JSON.stringify({
      schemaVersion: 1,
      filterCondition: "All",
      filters: [],
      isEnabled: true,
    });
    const disabledReminderCriteria: string = JSON.stringify({
      schemaVersion: 1,
      filterCondition: "All",
      filters: [],
      isEnabled: false,
    });
    const storedPattern: () => Promise<string | null> = async (): Promise<
      string | null
    > => {
      const rows: Array<StoredShadow> = await runner.query(
        `SELECT "${representativeField}" FROM "${representativeTable}" WHERE "_id" = $1`,
        [rowId],
      );
      return rows[0]?.monitorNamePattern ?? null;
    };
    const storedReminderEnabled: (
      tableName: string,
      id: string,
    ) => Promise<boolean | null> = async (
      tableName: string,
      id: string,
    ): Promise<boolean | null> => {
      const rows: Array<StoredReminderShadow> = await runner.query(
        `SELECT "isEnabled" FROM "${tableName}" WHERE "_id" = $1`,
        [id],
      );
      return rows[0]?.isEnabled ?? null;
    };

    const insertedRows: Array<StoredShadow> = await runner.query(
      `INSERT INTO "${representativeTable}" ("_id", "${representativeField}", "criteria") VALUES ($1, $2, $3::jsonb) RETURNING "${representativeField}"`,
      [rowId, "legacy-match-all", criteria],
    );
    expect(insertedRows[0]?.monitorNamePattern).toBe(NEVER_MATCH_PATTERN);

    await runner.query(
      `UPDATE "${representativeTable}" SET "${representativeField}" = $2 WHERE "_id" = $1`,
      [rowId, "old-worker-overwrite"],
    );
    expect(await storedPattern()).toBe(NEVER_MATCH_PATTERN);

    await runner.query(
      `UPDATE "${representativeTable}" SET "criteria" = NULL, "${representativeField}" = $2 WHERE "_id" = $1`,
      [rowId, "legacy-visible"],
    );
    expect(await storedPattern()).toBe("legacy-visible");

    await runner.query(
      `UPDATE "${representativeTable}" SET "criteria" = $2::jsonb, "${representativeField}" = $3 WHERE "_id" = $1`,
      [rowId, criteria, "must-close-again"],
    );
    expect(await storedPattern()).toBe(NEVER_MATCH_PATTERN);

    for (const tableName of REMINDER_TABLES) {
      const ids: ReminderIds = reminderIdsByTable.get(tableName)!;
      await runner.query(
        `INSERT INTO "${tableName}" ("_id", "isEnabled", "criteria") VALUES ($1, true, $2::jsonb), ($3, true, $4::jsonb)`,
        [
          ids.enabledId,
          enabledReminderCriteria,
          ids.disabledId,
          disabledReminderCriteria,
        ],
      );
      expect(await storedReminderEnabled(tableName, ids.enabledId)).toBeNull();
      expect(await storedReminderEnabled(tableName, ids.disabledId)).toBe(
        false,
      );

      await runner.query(
        `UPDATE "${tableName}" SET "isEnabled" = true WHERE "_id" IN ($1, $2)`,
        [ids.enabledId, ids.disabledId],
      );
      expect(await storedReminderEnabled(tableName, ids.enabledId)).toBeNull();
      expect(await storedReminderEnabled(tableName, ids.disabledId)).toBe(
        false,
      );

      await runner.query(
        `UPDATE "${tableName}" SET "criteria" = $2::jsonb, "isEnabled" = true WHERE "_id" = $1`,
        [ids.enabledId, disabledReminderCriteria],
      );
      expect(await storedReminderEnabled(tableName, ids.enabledId)).toBe(false);
      await runner.query(
        `UPDATE "${tableName}" SET "criteria" = $2::jsonb, "isEnabled" = false WHERE "_id" = $1`,
        [ids.enabledId, enabledReminderCriteria],
      );
      expect(await storedReminderEnabled(tableName, ids.enabledId)).toBeNull();
    }

    await migration.down(runner);
    migrationApplied = false;

    const criteriaColumns: Array<{ column_name: string }> = await runner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ($2, $3, $4, $5) AND column_name = 'criteria'`,
      [schema, representativeTable, ...REMINDER_TABLES],
    );
    const remainingFunctions: Array<{ proname: string }> = await runner.query(
      `SELECT routine_name AS proname FROM information_schema.routines WHERE routine_schema = $1 AND routine_name IN ('set_rule_criteria_legacy_shadow_1792400000000', 'set_relation_only_rule_criteria_shadow_1792400000000')`,
      [schema],
    );
    const remainingTriggers: Array<{ trigger_name: string }> =
      await runner.query(
        `SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = $1 AND event_object_table IN ($2, $3, $4, $5)`,
        [schema, representativeTable, ...REMINDER_TABLES],
      );
    expect(criteriaColumns).toEqual([]);
    expect(remainingFunctions).toEqual([]);
    expect(remainingTriggers).toEqual([]);
    for (const tableName of REMINDER_TABLES) {
      const ids: ReminderIds = reminderIdsByTable.get(tableName)!;
      expect(await storedReminderEnabled(tableName, ids.enabledId)).toBe(true);
      expect(await storedReminderEnabled(tableName, ids.disabledId)).toBe(
        false,
      );
    }

    await runner.query(
      `UPDATE "${representativeTable}" SET "${representativeField}" = $2 WHERE "_id" = $1`,
      [rowId, "legacy-after-rollback"],
    );
    expect(await storedPattern()).toBe("legacy-after-rollback");
  });
});
