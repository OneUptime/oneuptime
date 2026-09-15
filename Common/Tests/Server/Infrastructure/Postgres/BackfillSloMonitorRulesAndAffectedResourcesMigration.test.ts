import {
  BURN_RATE_FINGERPRINT_LIKE_PATTERN,
  BackfillSloMonitorRulesAndAffectedResources1793000000000,
  MIGRATED_MONITOR_RULE_DESCRIPTION,
  MIGRATED_MONITOR_RULE_NAME,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1793000000000-BackfillSloMonitorRulesAndAffectedResources";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * The data half of the SLO product overhaul. Two things silently regress if
 * this SQL drifts, and neither shows up as an error:
 *
 *   - An SLO's label rule is dropped on upgrade: the engine now reads only
 *     SLO Monitor Rules, so an SLO whose labels were not copied into one loses
 *     every auto-attached monitor on the first sync, and its SLI measures
 *     nothing.
 *   - The SLO's Alerts and Incidents pages go empty: they now query the new
 *     affected-resource relation, so every pre-upgrade burn-rate record that
 *     was not linked disappears from them.
 *
 * Plus the safety properties that make a data migration shippable: tenant
 * isolation, no cast errors on malformed data, re-runnable, and a down() that
 * only removes what it wrote.
 *
 * Fake QueryRunner only; the SQL itself was executed against Postgres when the
 * migration was written (see the migration header).
 */

type RecordedQueriesFunction = (direction: "up" | "down") => Promise<
  Array<string>
>;

const recordQueries: RecordedQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new BackfillSloMonitorRulesAndAffectedResources1793000000000()[
    direction
  ](queryRunner);

  return statements;
};

type FindStatementFunction = (
  statements: Array<string>,
  fragment: string,
) => string;

const findStatement: FindStatementFunction = (
  statements: Array<string>,
  fragment: string,
): string => {
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.includes(fragment);
    },
  );

  expect(matches).toHaveLength(1);

  return matches[0]!;
};

describe("BackfillSloMonitorRulesAndAffectedResources migration - identity", () => {
  test("its class name and name field carry its timestamp", () => {
    const migration: BackfillSloMonitorRulesAndAffectedResources1793000000000 =
      new BackfillSloMonitorRulesAndAffectedResources1793000000000();

    expect(migration.name).toBe(
      "BackfillSloMonitorRulesAndAffectedResources1793000000000",
    );
  });

  test("it is registered, and after the schema migration that creates its tables", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    const backfillIndex: number = names.indexOf(
      "BackfillSloMonitorRulesAndAffectedResources1793000000000",
    );
    const schemaIndex: number = names.indexOf("SloProductOverhaul1792900000000");

    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(schemaIndex);
  });

  test("up() issues exactly three statements and down() three", async () => {
    expect(await recordQueries("up")).toHaveLength(3);
    expect(await recordQueries("down")).toHaveLength(3);
  });
});

describe("up(): SLO label lists become SLO Monitor Rules", () => {
  test("inserts one enabled rule, version 1, with the migrated name and description", async () => {
    const statement: string = findStatement(
      await recordQueries("up"),
      'INSERT INTO "ServiceLevelObjectiveMonitorRule"',
    );

    expect(statement).toContain(
      'INSERT INTO "ServiceLevelObjectiveMonitorRule" ("_id", "version", "projectId", "serviceLevelObjectiveId", "name", "description", "isEnabled") SELECT uuid_generate_v4(), 1, slo."projectId", slo."_id",',
    );
    expect(statement).toContain(
      `'${MIGRATED_MONITOR_RULE_NAME}', '${MIGRATED_MONITOR_RULE_DESCRIPTION}', true FROM "ServiceLevelObjective" slo`,
    );
    expect(MIGRATED_MONITOR_RULE_NAME).toBe("Auto-add monitors with labels");
  });

  test("keeps each rule in its SLO's project", async () => {
    const statement: string = findStatement(
      await recordQueries("up"),
      'INSERT INTO "ServiceLevelObjectiveMonitorRule"',
    );

    // projectId is read off the SLO row itself, never from anywhere else.
    expect(statement).toContain('slo."projectId", slo."_id"');
  });

  test("only migrates non-deleted SLOs that actually have labels", async () => {
    const statement: string = findStatement(
      await recordQueries("up"),
      'INSERT INTO "ServiceLevelObjectiveMonitorRule"',
    );

    expect(statement).toContain('WHERE slo."deletedAt" IS NULL');
    expect(statement).toContain(
      'EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorLabel" sml WHERE sml."serviceLevelObjectiveId" = slo."_id")',
    );
  });

  test("is idempotent: an SLO that already has the migrated rule is skipped", async () => {
    const statement: string = findStatement(
      await recordQueries("up"),
      'INSERT INTO "ServiceLevelObjectiveMonitorRule"',
    );

    expect(statement).toContain(
      `NOT EXISTS (SELECT 1 FROM "ServiceLevelObjectiveMonitorRule" existing WHERE existing."serviceLevelObjectiveId" = slo."_id" AND existing."name" = '${MIGRATED_MONITOR_RULE_NAME}')`,
    );
  });

  test("copies labels into the legacy M2M join table, not into criteria JSON", async () => {
    /*
     * Criteria relation filters cap at 100 values and fail closed, so an SLO
     * with more labels would silently match nothing. The legacy join table
     * has no cap and any-of semantics identical to the old label list.
     */
    const statement: string = findStatement(
      await recordQueries("up"),
      'INSERT INTO "ServiceLevelObjectiveMonitorRule"',
    );

    expect(statement).toContain(
      'INSERT INTO "ServiceLevelObjectiveMonitorRuleMonitorLabel" ("serviceLevelObjectiveMonitorRuleId", "labelId") SELECT "insertedRules"."_id", sml."labelId"',
    );
    expect(statement).toContain(
      'INNER JOIN "ServiceLevelObjectiveMonitorLabel" sml ON sml."serviceLevelObjectiveId" = "insertedRules"."serviceLevelObjectiveId"',
    );
    expect(statement).not.toContain('"criteria"');
  });

  test("copies labels ONLY for rules inserted by the same statement", async () => {
    /*
     * The label copy reads from the CTE's RETURNING set rather than from the
     * rule table, so a rule a user created (or renamed to the migrated name)
     * can never pick up an SLO's old labels on a re-run.
     */
    const statement: string = findStatement(
      await recordQueries("up"),
      'INSERT INTO "ServiceLevelObjectiveMonitorRule"',
    );

    expect(statement.startsWith('WITH "insertedRules" AS (INSERT INTO')).toBe(
      true,
    );
    expect(statement).toContain(
      'RETURNING "_id", "serviceLevelObjectiveId")',
    );
    expect(statement).toContain('FROM "insertedRules"');
    expect(statement).toContain("ON CONFLICT DO NOTHING");
  });

  test("never touches the deprecated label list itself", async () => {
    const statements: Array<string> = [
      ...(await recordQueries("up")),
      ...(await recordQueries("down")),
    ];

    for (const statement of statements) {
      expect(statement).not.toMatch(
        /(INSERT INTO|DELETE FROM|UPDATE|DROP TABLE) "ServiceLevelObjectiveMonitorLabel"/,
      );
    }
  });

  test("the inlined name and description cannot break out of their SQL literals", () => {
    expect(MIGRATED_MONITOR_RULE_NAME).not.toContain("'");
    expect(MIGRATED_MONITOR_RULE_DESCRIPTION).not.toContain("'");
    // The description must fit the LongText column.
    expect(MIGRATED_MONITOR_RULE_DESCRIPTION.length).toBeLessThanOrEqual(500);
  });
});

describe.each([
  {
    table: "Incident",
    alias: "i",
    joinTable: "IncidentServiceLevelObjective",
    joinColumn: "incidentId",
  },
  {
    table: "Alert",
    alias: "a",
    joinTable: "AlertServiceLevelObjective",
    joinColumn: "alertId",
  },
])(
  "up(): burn rate $table records gain their SLO",
  (spec: {
    table: string;
    alias: string;
    joinTable: string;
    joinColumn: string;
  }) => {
    const statementFor: () => Promise<string> = async (): Promise<string> => {
      return findStatement(
        await recordQueries("up"),
        `INSERT INTO "${spec.joinTable}"`,
      );
    };

    test("inserts (record, SLO) pairs into the join table", async () => {
      expect(await statementFor()).toContain(
        `INSERT INTO "${spec.joinTable}" ("${spec.joinColumn}", "serviceLevelObjectiveId") SELECT ${spec.alias}."_id", s."_id" FROM "${spec.table}" ${spec.alias}`,
      );
    });

    test("only considers burn-rate fingerprints", async () => {
      expect(BURN_RATE_FINGERPRINT_LIKE_PATTERN).toBe("slo:%:burn-rule:%");
      expect(await statementFor()).toContain(
        `WHERE ${spec.alias}."seriesFingerprint" LIKE 'slo:%:burn-rule:%'`,
      );
    });

    test("joins on the SLO id as TEXT, so a malformed fingerprint cannot abort the migration", async () => {
      const statement: string = await statementFor();

      expect(statement).toContain(
        `s."_id"::text = split_part(${spec.alias}."seriesFingerprint", ':', 2)`,
      );
      // A ::uuid cast on user-influenced text would throw on the first bad row.
      expect(statement).not.toContain("::uuid");
    });

    test("requires the SLO to be in the record's own project", async () => {
      expect(await statementFor()).toContain(
        `AND s."projectId" = ${spec.alias}."projectId"`,
      );
    });

    test("is safe to re-run and safe alongside a worker that already linked it", async () => {
      expect((await statementFor()).endsWith("ON CONFLICT DO NOTHING")).toBe(
        true,
      );
    });
  },
);

describe("down()", () => {
  test("removes fingerprint-derived links first, then the migrated rules", async () => {
    const statements: Array<string> = await recordQueries("down");

    expect(statements[0]).toContain('DELETE FROM "AlertServiceLevelObjective"');
    expect(statements[1]).toContain(
      'DELETE FROM "IncidentServiceLevelObjective"',
    );
    expect(statements[2]).toContain(
      'DELETE FROM "ServiceLevelObjectiveMonitorRule"',
    );
  });

  test.each([
    ["AlertServiceLevelObjective", "aslo", "Alert", "a", "alertId"],
    ["IncidentServiceLevelObjective", "islo", "Incident", "i", "incidentId"],
  ])(
    "only deletes %s rows derivable from the record's fingerprint",
    async (
      joinTable: string,
      joinAlias: string,
      table: string,
      alias: string,
      joinColumn: string,
    ) => {
      const statement: string = findStatement(
        await recordQueries("down"),
        `DELETE FROM "${joinTable}"`,
      );

      expect(statement).toContain(
        `DELETE FROM "${joinTable}" ${joinAlias} USING "${table}" ${alias} WHERE ${joinAlias}."${joinColumn}" = ${alias}."_id"`,
      );
      expect(statement).toContain(
        `${alias}."seriesFingerprint" LIKE 'slo:%:burn-rule:%'`,
      );
      expect(statement).toContain(
        `${joinAlias}."serviceLevelObjectiveId"::text = split_part(${alias}."seriesFingerprint", ':', 2)`,
      );
    },
  );

  test("only deletes rules that carry BOTH the migrated name and description", async () => {
    /*
     * A user may well name their own rule "Auto-add monitors with labels";
     * the generated description is what marks a row as this migration's.
     */
    const statement: string = findStatement(
      await recordQueries("down"),
      'DELETE FROM "ServiceLevelObjectiveMonitorRule"',
    );

    expect(statement).toBe(
      `DELETE FROM "ServiceLevelObjectiveMonitorRule" WHERE "name" = '${MIGRATED_MONITOR_RULE_NAME}' AND "description" = '${MIGRATED_MONITOR_RULE_DESCRIPTION}'`,
    );
  });

  test("never drops or truncates anything", async () => {
    for (const statement of await recordQueries("down")) {
      expect(statement).not.toMatch(/DROP|TRUNCATE/);
    }
  });
});
