import { MigrationInterface, QueryRunner } from "typeorm";
import { TABLES_WITH_AI_REMEDIATION_MODE } from "./1796800000000-FoldAiSwitchesIntoEnableAi";

/*
 * Fixing new incidents and alerts gets a switch of its own, and which ones
 * are investigated or fixed can be narrowed by rules.
 *
 * Schema (generated):
 *   - Project.enableAutomaticIncidentRemediation and
 *     Project.enableAutomaticAlertRemediation: "Fix new incidents
 *     automatically" and "Fix new alerts automatically", off by default
 *     (for new projects too: fixing changes infrastructure).
 *   - AutoRemediationRule.remediationAction: what a rule fixes with -
 *     OneUptime AI (the default) or the rule's runbooks.
 *   - AIInvestigationRule and its join tables: which new incidents and
 *     alerts OneUptime AI investigates. No rule: every one.
 *
 * Data (hand-added): a project keeps fixing exactly what it fixed before.
 *   1. A rule that let AI compose commands or pick a runbook is marked
 *      OneUptime AI (the column's default) and keeps doing that; every other
 *      rule ran its runbooks, and is marked Runbooks.
 *   2. Until now OneUptime AI fixed every signal on the clusters and
 *      resources it was linked to whatever the rules said, but with rules
 *      now only the signals that match one are fixed. A project with enabled
 *      rules for a kind of signal and fixes on for any of its clusters or
 *      resources gets a rule that matches every one of them and lets
 *      OneUptime AI fix it, without asking (the cluster's or resource's own
 *      mode still decides that), so nothing it fixed before stops. Deleting
 *      that rule narrows fixing to what the other rules match.
 *   3. The switch is on for a kind of signal where the project fixed any
 *      automatically: it had an enabled rule for that kind, or fixes on for
 *      any of its clusters or resources. Everywhere else it stays off.
 *
 * down() drops what up() added: the data updates go with the columns they
 * wrote, and the rules of step 2 are deleted - to the code before this
 * change they would read as runbook rules with no runbook, and a re-run of
 * up() adds them again.
 */

type RuleTrigger = "Incident" | "Alert";

const RULE_TRIGGERS: Array<RuleTrigger> = ["Incident", "Alert"];

// The rule step 2 adds, named for what it does.
export const CATCH_ALL_RULE_NAMES: Record<RuleTrigger, string> = {
  Incident: "Fix every incident with OneUptime AI",
  Alert: "Fix every alert with OneUptime AI",
};

export const CATCH_ALL_RULE_DESCRIPTIONS: Record<RuleTrigger, string> = {
  Incident:
    "Added on upgrade so OneUptime AI keeps fixing every incident on the clusters and hosts it is linked to, as it did before rules decided which incidents are fixed. Delete it to fix only the incidents your other rules match.",
  Alert:
    "Added on upgrade so OneUptime AI keeps fixing every alert on the clusters and hosts it is linked to, as it did before rules decided which alerts are fixed. Delete it to fix only the alerts your other rules match.",
};

const SWITCH_COLUMNS: Record<RuleTrigger, string> = {
  Incident: "enableAutomaticIncidentRemediation",
  Alert: "enableAutomaticAlertRemediation",
};

// SQL over a Project aliased `p`: it has an enabled rule for this trigger.
export const getHasEnabledRuleSql: (trigger: RuleTrigger) => string = (
  trigger: RuleTrigger,
): string => {
  return `EXISTS (SELECT 1 FROM "AutoRemediationRule" r WHERE r."projectId" = p."_id" AND r."deletedAt" IS NULL AND r."isEnabled" = true AND r."triggerEntityType" = '${trigger}')`;
};

/*
 * SQL over a Project aliased `p`: fixes are on for one of its clusters or
 * resources, so OneUptime AI fixed the signals linked to it.
 */
export const HAS_FIXES_ON_SQL: string = `(${TABLES_WITH_AI_REMEDIATION_MODE.map(
  (table: string): string => {
    return `EXISTS (SELECT 1 FROM "${table}" t WHERE t."projectId" = p."_id" AND t."deletedAt" IS NULL AND t."aiRemediationMode" <> 'Disabled')`;
  },
).join(" OR ")})`;

export class AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000
  implements MigrationInterface
{
  public name: string =
    "AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "triggerEntityType" character varying(100) NOT NULL, "titlePattern" character varying(500), "descriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_fd17647c7a5667770f2644b9914" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6d47d7e399cf9909e4bf60aff" ON "AIInvestigationRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_444f69f9b5df28cc59cf88f550" ON "AIInvestigationRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e99f07e5ce6d693de07606fa28" ON "AIInvestigationRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c3aa0ef89674fd4e1f3094a372" ON "AIInvestigationRule" ("triggerEntityType") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRuleMonitor" ("aiInvestigationRuleId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_0c4bef0dd3a6f061c7cf7fdd4c2" PRIMARY KEY ("aiInvestigationRuleId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4bdb4c2c1f9da7bc0b99d2f3f" ON "AIInvestigationRuleMonitor" ("aiInvestigationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8fc4fcd2dc25485fd8ffd622c1" ON "AIInvestigationRuleMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRuleIncidentSeverity" ("aiInvestigationRuleId" uuid NOT NULL, "incidentSeverityId" uuid NOT NULL, CONSTRAINT "PK_4f5f196c71227d3bad1b167b40b" PRIMARY KEY ("aiInvestigationRuleId", "incidentSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f65a7cc025aacbe63398bc8c83" ON "AIInvestigationRuleIncidentSeverity" ("aiInvestigationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f6437c35b61241e540849af46" ON "AIInvestigationRuleIncidentSeverity" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRuleAlertSeverity" ("aiInvestigationRuleId" uuid NOT NULL, "alertSeverityId" uuid NOT NULL, CONSTRAINT "PK_9d6ad6076c7dc68d7448b832f21" PRIMARY KEY ("aiInvestigationRuleId", "alertSeverityId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_141ac9ce844de561a2a415f076" ON "AIInvestigationRuleAlertSeverity" ("aiInvestigationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1f9024dc2fc05325907f2fe42" ON "AIInvestigationRuleAlertSeverity" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRuleLabel" ("aiInvestigationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_4b63157cebfb203a7c5fe5956d0" PRIMARY KEY ("aiInvestigationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5161bf6f8214cc854b33874cf1" ON "AIInvestigationRuleLabel" ("aiInvestigationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5ba3de99d9be0f6dc8322bdb28" ON "AIInvestigationRuleLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRuleMonitorLabel" ("aiInvestigationRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_76a5c20d2db59c46a20d9d41051" PRIMARY KEY ("aiInvestigationRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88b619ff8ce32766023f4e9cda" ON "AIInvestigationRuleMonitorLabel" ("aiInvestigationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bff670c18ed4673b93db647ecf" ON "AIInvestigationRuleMonitorLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticIncidentRemediation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticAlertRemediation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "remediationAction" character varying(100) NOT NULL DEFAULT 'OneUptimeAI'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" ADD CONSTRAINT "FK_e6d47d7e399cf9909e4bf60aff1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" ADD CONSTRAINT "FK_c6ac8fecf306710eda6a1c25dc2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" ADD CONSTRAINT "FK_d92ec38868bba1224c2c76ef1ed" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitor" ADD CONSTRAINT "FK_e4bdb4c2c1f9da7bc0b99d2f3f5" FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitor" ADD CONSTRAINT "FK_8fc4fcd2dc25485fd8ffd622c13" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleIncidentSeverity" ADD CONSTRAINT "FK_f65a7cc025aacbe63398bc8c833" FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleIncidentSeverity" ADD CONSTRAINT "FK_8f6437c35b61241e540849af46a" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleAlertSeverity" ADD CONSTRAINT "FK_141ac9ce844de561a2a415f0760" FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleAlertSeverity" ADD CONSTRAINT "FK_e1f9024dc2fc05325907f2fe42d" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleLabel" ADD CONSTRAINT "FK_5161bf6f8214cc854b33874cf13" FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleLabel" ADD CONSTRAINT "FK_5ba3de99d9be0f6dc8322bdb280" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitorLabel" ADD CONSTRAINT "FK_88b619ff8ce32766023f4e9cdac" FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitorLabel" ADD CONSTRAINT "FK_bff670c18ed4673b93db647ecf9" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // 1. What each rule fixes with, as it did before.
    await queryRunner.query(
      `UPDATE "AutoRemediationRule" SET "remediationAction" = 'Runbooks' WHERE "aiComposesCommands" = false AND "aiSelectsRunbook" = false`,
    );

    for (const trigger of RULE_TRIGGERS) {
      // 2. Rules no longer leave the clusters and resources fixing everything.
      await queryRunner.query(
        `INSERT INTO "AutoRemediationRule" ("projectId", "version", "name", "description", "isEnabled", "triggerEntityType", "executionMode", "remediationAction") SELECT p."_id", 1, $1, $2, true, $3, 'FullAuto', 'OneUptimeAI' FROM "Project" p WHERE p."deletedAt" IS NULL AND ${getHasEnabledRuleSql(trigger)} AND ${HAS_FIXES_ON_SQL}`,
        [
          CATCH_ALL_RULE_NAMES[trigger],
          CATCH_ALL_RULE_DESCRIPTIONS[trigger],
          trigger,
        ],
      );

      // 3. Fixing stays on where it happened.
      await queryRunner.query(
        `UPDATE "Project" p SET "${SWITCH_COLUMNS[trigger]}" = true WHERE ${getHasEnabledRuleSql(trigger)} OR ${HAS_FIXES_ON_SQL}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The rules step 2 added, as it added them.
    await queryRunner.query(
      `DELETE FROM "AutoRemediationRule" WHERE "name" = ANY($1) AND "description" = ANY($2) AND "remediationAction" = 'OneUptimeAI' AND "aiComposesCommands" = false AND "aiSelectsRunbook" = false AND "criteria" IS NULL`,
      [
        Object.values(CATCH_ALL_RULE_NAMES),
        Object.values(CATCH_ALL_RULE_DESCRIPTIONS),
      ],
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitorLabel" DROP CONSTRAINT "FK_bff670c18ed4673b93db647ecf9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitorLabel" DROP CONSTRAINT "FK_88b619ff8ce32766023f4e9cdac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleLabel" DROP CONSTRAINT "FK_5ba3de99d9be0f6dc8322bdb280"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleLabel" DROP CONSTRAINT "FK_5161bf6f8214cc854b33874cf13"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleAlertSeverity" DROP CONSTRAINT "FK_e1f9024dc2fc05325907f2fe42d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleAlertSeverity" DROP CONSTRAINT "FK_141ac9ce844de561a2a415f0760"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleIncidentSeverity" DROP CONSTRAINT "FK_8f6437c35b61241e540849af46a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleIncidentSeverity" DROP CONSTRAINT "FK_f65a7cc025aacbe63398bc8c833"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitor" DROP CONSTRAINT "FK_8fc4fcd2dc25485fd8ffd622c13"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleMonitor" DROP CONSTRAINT "FK_e4bdb4c2c1f9da7bc0b99d2f3f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" DROP CONSTRAINT "FK_d92ec38868bba1224c2c76ef1ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" DROP CONSTRAINT "FK_c6ac8fecf306710eda6a1c25dc2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" DROP CONSTRAINT "FK_e6d47d7e399cf9909e4bf60aff1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "remediationAction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticAlertRemediation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticIncidentRemediation"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bff670c18ed4673b93db647ecf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88b619ff8ce32766023f4e9cda"`,
    );
    await queryRunner.query(`DROP TABLE "AIInvestigationRuleMonitorLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5ba3de99d9be0f6dc8322bdb28"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5161bf6f8214cc854b33874cf1"`,
    );
    await queryRunner.query(`DROP TABLE "AIInvestigationRuleLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1f9024dc2fc05325907f2fe42"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_141ac9ce844de561a2a415f076"`,
    );
    await queryRunner.query(`DROP TABLE "AIInvestigationRuleAlertSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f6437c35b61241e540849af46"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f65a7cc025aacbe63398bc8c83"`,
    );
    await queryRunner.query(`DROP TABLE "AIInvestigationRuleIncidentSeverity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8fc4fcd2dc25485fd8ffd622c1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4bdb4c2c1f9da7bc0b99d2f3f"`,
    );
    await queryRunner.query(`DROP TABLE "AIInvestigationRuleMonitor"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c3aa0ef89674fd4e1f3094a372"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e99f07e5ce6d693de07606fa28"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_444f69f9b5df28cc59cf88f550"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6d47d7e399cf9909e4bf60aff"`,
    );
    await queryRunner.query(`DROP TABLE "AIInvestigationRule"`);
  }
}
