import {
  AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000,
  CATCH_ALL_RULE_DESCRIPTIONS,
  CATCH_ALL_RULE_NAMES,
  HAS_FIXES_ON_SQL,
  getHasEnabledRuleSql,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799400000000-AddAutomaticRemediationSwitchesAndInvestigationRules";
import { TABLES_WITH_AI_REMEDIATION_MODE } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796800000000-FoldAiSwitchesIntoEnableAi";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * Fixing new incidents and alerts gets a switch of its own, and which ones
 * are investigated or fixed can be narrowed by rules.
 *
 *   - Schema: the two Project switches (off by default), the rule's Fix
 *     With, and the AIInvestigationRule table with its join tables;
 *   - Data: a project keeps fixing exactly what it fixed before - a rule
 *     with no AI flag is marked Runbooks; a project with enabled rules and
 *     fixes on for any of its clusters or resources gets a rule that lets
 *     OneUptime AI fix every signal of that kind (so rules no longer stop
 *     the cluster and resource fixes it had); and the switch is on where
 *     fixing happened;
 *   - down() drops what up() added, the catch-all rules included.
 *
 * Fake QueryRunner only; the Schema Drift job applies it to a real
 * database.
 */

const MIGRATION_NAME: string =
  "AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000";

interface Statement {
  sql: string;
  parameters?: Array<unknown> | undefined;
}

async function record(direction: "up" | "down"): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];
  const queryRunner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<void> => {
      statements.push({ sql, parameters });
    },
  } as unknown as QueryRunner;

  await new AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000()[
    direction
  ](queryRunner);

  return statements;
}

function indexOf(statements: Array<Statement>, pattern: RegExp): number {
  return statements.findIndex((statement: Statement): boolean => {
    return pattern.test(statement.sql);
  });
}

describe("AddAutomaticRemediationSwitchesAndInvestigationRules migration", () => {
  test("is registered after every migration before it", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(names).toContain(MIGRATION_NAME);
    expect(names[names.length - 1]).toBe(MIGRATION_NAME);
    expect(
      new AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000()
        .name,
    ).toBe(MIGRATION_NAME);
  });

  test("adds both switches, off, and the rule's Fix With, OneUptime AI unless set", async () => {
    const sqls: Array<string> = (await record("up")).map((s: Statement) => {
      return s.sql;
    });

    expect(sqls).toContain(
      `ALTER TABLE "Project" ADD "enableAutomaticIncidentRemediation" boolean NOT NULL DEFAULT false`,
    );
    expect(sqls).toContain(
      `ALTER TABLE "Project" ADD "enableAutomaticAlertRemediation" boolean NOT NULL DEFAULT false`,
    );
    expect(sqls).toContain(
      `ALTER TABLE "AutoRemediationRule" ADD "remediationAction" character varying(100) NOT NULL DEFAULT 'OneUptimeAI'`,
    );
  });

  test("creates the investigation rules and their five join tables, each removed with its rule", async () => {
    const sqls: Array<string> = (await record("up")).map((s: Statement) => {
      return s.sql;
    });

    expect(
      sqls.filter((sql: string): boolean => {
        return sql.startsWith(`CREATE TABLE "AIInvestigationRule`);
      }),
    ).toHaveLength(6);

    for (const joinTable of [
      "AIInvestigationRuleMonitor",
      "AIInvestigationRuleIncidentSeverity",
      "AIInvestigationRuleAlertSeverity",
      "AIInvestigationRuleLabel",
      "AIInvestigationRuleMonitorLabel",
    ]) {
      expect({
        joinTable,
        cascades: sqls.some((sql: string): boolean => {
          return (
            sql.startsWith(`ALTER TABLE "${joinTable}" ADD CONSTRAINT`) &&
            sql.includes(
              `FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE`,
            )
          );
        }),
      }).toEqual({ joinTable, cascades: true });
    }

    // A project's rules go with the project.
    expect(
      sqls.some((sql: string): boolean => {
        return (
          sql.startsWith(`ALTER TABLE "AIInvestigationRule" ADD CONSTRAINT`) &&
          sql.includes(
            `FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE`,
          )
        );
      }),
    ).toBe(true);
  });

  test("marks every rule with no AI flag Runbooks, after the column exists", async () => {
    const statements: Array<Statement> = await record("up");
    const backfill: number = indexOf(
      statements,
      /^UPDATE "AutoRemediationRule" SET "remediationAction" = 'Runbooks' WHERE "aiComposesCommands" = false AND "aiSelectsRunbook" = false$/,
    );

    expect(backfill).toBeGreaterThan(
      indexOf(statements, /ADD "remediationAction"/),
    );
  });

  test.each([
    ["Incident", "enableAutomaticIncidentRemediation"],
    ["Alert", "enableAutomaticAlertRemediation"],
  ] as Array<["Incident" | "Alert", string]>)(
    "%s: adds the catch-all rule where rules and fixes met, then turns the switch on where fixing happened",
    async (trigger: "Incident" | "Alert", column: string) => {
      const statements: Array<Statement> = await record("up");
      const insert: number = statements.findIndex(
        (statement: Statement): boolean => {
          return (
            statement.sql.startsWith(`INSERT INTO "AutoRemediationRule"`) &&
            statement.parameters?.[2] === trigger
          );
        },
      );
      const turnOn: number = indexOf(
        statements,
        new RegExp(`^UPDATE "Project" p SET "${column}" = true WHERE `),
      );

      expect(insert).toBeGreaterThan(-1);
      expect(turnOn).toBeGreaterThan(insert);

      const insertStatement: Statement = statements[insert]!;

      expect(insertStatement.parameters).toEqual([
        CATCH_ALL_RULE_NAMES[trigger],
        CATCH_ALL_RULE_DESCRIPTIONS[trigger],
        trigger,
      ]);
      // A live project with enabled rules of the kind and fixes on somewhere.
      expect(insertStatement.sql).toContain(`p."deletedAt" IS NULL`);
      expect(insertStatement.sql).toContain(
        `AND ${getHasEnabledRuleSql(trigger)} AND ${HAS_FIXES_ON_SQL}`,
      );
      // Fixes without asking: the cluster's or resource's own mode decides.
      expect(insertStatement.sql).toContain(
        `SELECT p."_id", 1, $1, $2, true, $3, 'FullAuto', 'OneUptimeAI'`,
      );

      expect(statements[turnOn]!.sql).toBe(
        `UPDATE "Project" p SET "${column}" = true WHERE ${getHasEnabledRuleSql(trigger)} OR ${HAS_FIXES_ON_SQL}`,
      );
    },
  );

  test("counts only enabled, live rules of the kind, and fixes on for any of the project's live clusters or resources", () => {
    expect(getHasEnabledRuleSql("Alert")).toBe(
      `EXISTS (SELECT 1 FROM "AutoRemediationRule" r WHERE r."projectId" = p."_id" AND r."deletedAt" IS NULL AND r."isEnabled" = true AND r."triggerEntityType" = 'Alert')`,
    );

    expect(TABLES_WITH_AI_REMEDIATION_MODE).toContain("KubernetesCluster");

    for (const table of TABLES_WITH_AI_REMEDIATION_MODE) {
      expect(HAS_FIXES_ON_SQL).toContain(
        `EXISTS (SELECT 1 FROM "${table}" t WHERE t."projectId" = p."_id" AND t."deletedAt" IS NULL AND t."aiRemediationMode" <> 'Disabled')`,
      );
    }
  });

  test("names the catch-all rules for what they do, and says how to stop them", () => {
    expect(CATCH_ALL_RULE_NAMES).toEqual({
      Incident: "Fix every incident with OneUptime AI",
      Alert: "Fix every alert with OneUptime AI",
    });
    expect(CATCH_ALL_RULE_DESCRIPTIONS.Incident).toContain(
      "Delete it to fix only the incidents your other rules match.",
    );
    expect(CATCH_ALL_RULE_DESCRIPTIONS.Alert).toContain(
      "Delete it to fix only the alerts your other rules match.",
    );

    // Each fits the rule's name and description columns.
    for (const name of Object.values(CATCH_ALL_RULE_NAMES)) {
      expect(name.length).toBeLessThanOrEqual(100);
    }
    for (const description of Object.values(CATCH_ALL_RULE_DESCRIPTIONS)) {
      expect(description.length).toBeLessThanOrEqual(500);
    }
  });

  test("down() deletes the catch-all rules first, then drops what up() added", async () => {
    const statements: Array<Statement> = await record("down");

    expect(statements[0]!.sql).toBe(
      `DELETE FROM "AutoRemediationRule" WHERE "name" = ANY($1) AND "description" = ANY($2) AND "remediationAction" = 'OneUptimeAI' AND "aiComposesCommands" = false AND "aiSelectsRunbook" = false AND "criteria" IS NULL`,
    );
    expect(statements[0]!.parameters).toEqual([
      Object.values(CATCH_ALL_RULE_NAMES),
      Object.values(CATCH_ALL_RULE_DESCRIPTIONS),
    ]);

    const sqls: Array<string> = statements.map((s: Statement) => {
      return s.sql;
    });

    for (const sql of [
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "remediationAction"`,
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticAlertRemediation"`,
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticIncidentRemediation"`,
      `DROP TABLE "AIInvestigationRule"`,
      `DROP TABLE "AIInvestigationRuleMonitor"`,
      `DROP TABLE "AIInvestigationRuleIncidentSeverity"`,
      `DROP TABLE "AIInvestigationRuleAlertSeverity"`,
      `DROP TABLE "AIInvestigationRuleLabel"`,
      `DROP TABLE "AIInvestigationRuleMonitorLabel"`,
    ]) {
      expect(sqls).toContain(sql);
    }

    // The rules go before the column that says what they fix with.
    expect(
      indexOf(statements, /^DELETE FROM "AutoRemediationRule"/),
    ).toBeLessThan(indexOf(statements, /DROP COLUMN "remediationAction"/));
  });
});
