import { MigrationInterface, QueryRunner } from "typeorm";
import { IS_KUBERNETES_AGENT_RUNNER_SQL } from "./1796800000000-FoldAiSwitchesIntoEnableAi";

/*
 * Auto remediation rules pick the Runner OneUptime AI runs their commands
 * on (AutoRemediationRule.runnerId), and a Runner no longer has a "Runs AI
 * Remediation Commands" switch: picking it - in a rule, or in a Kubernetes
 * cluster's AI settings - is what lets OneUptime AI's commands run there
 * (Server/Utils/Runner/RunnerAiCommandsPick). The column the switch wrote
 * (Runner.canRunAiCommands) stays, written by OneUptime only.
 *
 * Every existing rule keeps doing what it did:
 *
 *   - A rule saved before rules were simplified that has AI compose
 *     commands, and names no Command Runners, ran them on any Runner of its
 *     project with the switch on. Nothing reads the switch for that any
 *     more - a rule runs commands only on the Runners it names - so its
 *     Runners are written out: the project's Runners with the switch on,
 *     its own, not deleted, and never an in-cluster Runner the Kubernetes
 *     agent chart installed (the toolkit never offered those as hosts),
 *     read with the predicate an earlier migration holds to the server's
 *     own rule, row by row (IS_KUBERNETES_AGENT_RUNNER_SQL, RunnerService
 *     .isKubernetesAgentRunnerRow).
 *   - Such a rule that then names exactly one Runner, with the switch on,
 *     picks it as its Runner, so the rule's form shows it: the Command
 *     Runners row moves to runnerId. A rule naming several keeps them
 *     where they are; it runs on all of them, as before.
 *   - A Runner a Kubernetes cluster's AI settings bind already had to have
 *     the switch on to be used; one bound without it is turned on, since
 *     the binding is the consent now and nothing else could turn it on.
 *
 * A Runbooks rule ("Run them every time") and a rule that has OneUptime AI
 * fix through the AI agents are not touched: what they do needs no Runner.
 */

// A rule saved before rules were simplified that composes commands.
const IS_COMMAND_RULE_SQL: string = `rule."aiComposesCommands" = true AND rule."remediationAction" <> 'Runbooks' AND rule."deletedAt" IS NULL`;

// A Runner a rule's commands could run on: its project's own, with the switch on.
const IS_COMMAND_RUNNER_SQL: string = `runner."canRunAiCommands" = true AND runner."isGlobalRunner" = false AND runner."deletedAt" IS NULL AND NOT ${IS_KUBERNETES_AGENT_RUNNER_SQL}`;

export const WRITE_OUT_ANY_RUNNER_RULES: string = `INSERT INTO "AutoRemediationRuleRunner" ("autoRemediationRuleId", "runnerId") SELECT rule."_id", runner."_id" FROM "AutoRemediationRule" AS rule INNER JOIN "Runner" AS runner ON runner."projectId" = rule."projectId" WHERE ${IS_COMMAND_RULE_SQL} AND ${IS_COMMAND_RUNNER_SQL} AND NOT EXISTS (SELECT 1 FROM "AutoRemediationRuleRunner" AS named WHERE named."autoRemediationRuleId" = rule."_id") ON CONFLICT DO NOTHING`;

export const PICK_THE_ONE_COMMAND_RUNNER: string = `UPDATE "AutoRemediationRule" AS rule SET "runnerId" = "single"."runnerId" FROM (SELECT named."autoRemediationRuleId", (array_agg(named."runnerId"))[1] AS "runnerId" FROM "AutoRemediationRuleRunner" AS named GROUP BY named."autoRemediationRuleId" HAVING count(*) = 1) AS "single", "Runner" AS runner WHERE rule."_id" = "single"."autoRemediationRuleId" AND runner."_id" = "single"."runnerId" AND runner."projectId" = rule."projectId" AND rule."runnerId" IS NULL AND ${IS_COMMAND_RULE_SQL} AND ${IS_COMMAND_RUNNER_SQL}`;

export const DROP_MOVED_COMMAND_RUNNER_ROWS: string = `DELETE FROM "AutoRemediationRuleRunner" AS named USING "AutoRemediationRule" AS rule WHERE named."autoRemediationRuleId" = rule."_id" AND named."runnerId" = rule."runnerId" AND rule."aiComposesCommands" = true`;

export const ALLOW_BOUND_CLUSTER_RUNNERS: string = `UPDATE "Runner" AS runner SET "canRunAiCommands" = true WHERE runner."canRunAiCommands" = false AND runner."isGlobalRunner" = false AND runner."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "KubernetesCluster" AS cluster WHERE cluster."aiAccessRunnerId" = runner."_id" AND cluster."projectId" = runner."projectId" AND cluster."deletedAt" IS NULL)`;

/*
 * `down` hands every rule's Runner back to its Command Runners, so a
 * rollback leaves a rule that composes commands running them where it does.
 */
export const RESTORE_COMMAND_RUNNER_ROWS: string = `INSERT INTO "AutoRemediationRuleRunner" ("autoRemediationRuleId", "runnerId") SELECT rule."_id", rule."runnerId" FROM "AutoRemediationRule" AS rule WHERE rule."runnerId" IS NOT NULL ON CONFLICT DO NOTHING`;

/*
 * Generated with npm run generate-postgres-migration, then the carry-over
 * above was put after adding the column. The column is nullable, so it is
 * added without a rewrite. Its index and its foreign key to "Runner" are on
 * a table projects already have rules in, so they are built online, in the
 * migration registered right after this one:
 * AddAutoRemediationRuleRunnerIndexAndKey1804450000000.
 */
export class AddAutoRemediationRuleRunner1804400000000
  implements MigrationInterface
{
  public name: string = "AddAutoRemediationRuleRunner1804400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "runnerId" uuid`,
    );

    await queryRunner.query(WRITE_OUT_ANY_RUNNER_RULES);

    await queryRunner.query(PICK_THE_ONE_COMMAND_RUNNER);

    await queryRunner.query(DROP_MOVED_COMMAND_RUNNER_ROWS);

    await queryRunner.query(ALLOW_BOUND_CLUSTER_RUNNERS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(RESTORE_COMMAND_RUNNER_ROWS);

    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "runnerId"`,
    );
  }
}
