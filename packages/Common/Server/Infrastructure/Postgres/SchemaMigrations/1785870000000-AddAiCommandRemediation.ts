import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AI-composed remediation commands (auto-remediation Phase 3):
 *
 * - Project.enableAiCommandExecution — project-level opt-in (default off).
 * - Runner.canRunAiCommands — per-Runner operator consent (default off).
 * - RunnerJob.origin — discriminates runbook-step jobs from ad-hoc
 *   AI-composed command jobs; runbookExecutionId becomes nullable because
 *   AiRemediation-origin jobs have no parent runbook execution (they link
 *   to an AI run + suggestion instead, via plain indexed uuid columns —
 *   same pattern as AIRun's triggeredBy* columns, no FK on purpose so the
 *   job survives as an audit record).
 * - AutoRemediationRule.aiComposesCommands + commandAllowlist — the rule
 *   mode and the operator-authored auto-execution allowlist.
 * - AutoRemediationRuleRunner — which Runners a rule's AI may target.
 * - AutoRemediationSuggestion.suggestionType + commandPlan — command-plan
 *   suggestions carry the frozen plan and its execution results.
 */
export class AddAiCommandRemediation1785870000000
  implements MigrationInterface
{
  public name = "AddAiCommandRemediation1785870000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAiCommandExecution" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `ALTER TABLE "Runner" ADD "canRunAiCommands" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD "origin" character varying(100) NOT NULL DEFAULT 'Runbook'`,
    );
    await queryRunner.query(`ALTER TABLE "RunnerJob" ADD "aiRunId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD "autoRemediationSuggestionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ALTER COLUMN "runbookExecutionId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunnerJob_origin" ON "RunnerJob" ("origin")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunnerJob_aiRunId" ON "RunnerJob" ("aiRunId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_RunnerJob_autoRemediationSuggestionId" ON "RunnerJob" ("autoRemediationSuggestionId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "aiComposesCommands" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "commandAllowlist" jsonb`,
    );

    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "suggestionType" character varying(100) NOT NULL DEFAULT 'Runbook'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "commandPlan" jsonb`,
    );

    /*
     * Explicit constraint/index names — TypeORM only requires them to be
     * unique, and named ones keep later migrations legible.
     */
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleRunner" (
        "autoRemediationRuleId" uuid NOT NULL,
        "runnerId" uuid NOT NULL,
        CONSTRAINT "PK_AutoRemediationRuleRunner" PRIMARY KEY ("autoRemediationRuleId", "runnerId")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AutoRemediationRuleRunner_ruleId" ON "AutoRemediationRuleRunner" ("autoRemediationRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_AutoRemediationRuleRunner_runnerId" ON "AutoRemediationRuleRunner" ("runnerId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" ADD CONSTRAINT "FK_AutoRemediationRuleRunner_ruleId" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" ADD CONSTRAINT "FK_AutoRemediationRuleRunner_runnerId" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" DROP CONSTRAINT "FK_AutoRemediationRuleRunner_runnerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleRunner" DROP CONSTRAINT "FK_AutoRemediationRuleRunner_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_AutoRemediationRuleRunner_runnerId"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_AutoRemediationRuleRunner_ruleId"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleRunner"`);

    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "commandPlan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "suggestionType"`,
    );

    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "commandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "aiComposesCommands"`,
    );

    await queryRunner.query(
      `DROP INDEX "IDX_RunnerJob_autoRemediationSuggestionId"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_RunnerJob_aiRunId"`);
    await queryRunner.query(`DROP INDEX "IDX_RunnerJob_origin"`);
    /*
     * Any AiRemediation-origin rows (null runbookExecutionId) must go
     * before the NOT NULL constraint can come back.
     */
    await queryRunner.query(
      `DELETE FROM "RunnerJob" WHERE "runbookExecutionId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ALTER COLUMN "runbookExecutionId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP COLUMN "autoRemediationSuggestionId"`,
    );
    await queryRunner.query(`ALTER TABLE "RunnerJob" DROP COLUMN "aiRunId"`);
    await queryRunner.query(`ALTER TABLE "RunnerJob" DROP COLUMN "origin"`);

    await queryRunner.query(
      `ALTER TABLE "Runner" DROP COLUMN "canRunAiCommands"`,
    );

    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAiCommandExecution"`,
    );
  }
}
