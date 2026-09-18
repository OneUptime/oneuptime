import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * LLM cost budgets no longer alert directly: the evaluation worker publishes
 * spend / percent-used as oneuptime.llm.budget.* metrics and Metrics monitors
 * own the alerting. Drop the alert-configuration columns and the on-call
 * join table the direct-alerting design used.
 */
export class RemoveLlmCostBudgetAlertColumns1788500000000
  implements MigrationInterface
{
  public name: string = "RemoveLlmCostBudgetAlertColumns1788500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP CONSTRAINT "FK_dfe6c27c42564e7422d26c8b1ed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfe6c27c42564e7422d26c8b1e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP COLUMN "warningThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP COLUMN "alertSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP COLUMN "lastWarningAlertCreatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP COLUMN "lastBreachAlertCreatedAt"`,
    );
    /*
     * The ManyToMany junction table is orphaned once the relation is gone;
     * typeorm's generator does not emit a drop for it, so do it here.
     */
    await queryRunner.query(
      `DROP TABLE IF EXISTS "LlmCostBudgetOnCallDutyPolicy"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LlmCostBudgetOnCallDutyPolicy" ("llmCostBudgetId" uuid NOT NULL, "onCallDutyPolicyId" uuid NOT NULL, CONSTRAINT "PK_1312da5439a5bc0ba61e5cbf005" PRIMARY KEY ("llmCostBudgetId", "onCallDutyPolicyId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d05f7b557fdd92c4c9ff42e910" ON "LlmCostBudgetOnCallDutyPolicy" ("llmCostBudgetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76020c2c8f8f264128f6adfd89" ON "LlmCostBudgetOnCallDutyPolicy" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_d05f7b557fdd92c4c9ff42e9107" FOREIGN KEY ("llmCostBudgetId") REFERENCES "LlmCostBudget"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudgetOnCallDutyPolicy" ADD CONSTRAINT "FK_76020c2c8f8f264128f6adfd899" FOREIGN KEY ("onCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD "lastBreachAlertCreatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD "lastWarningAlertCreatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD "alertSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD "warningThresholdPercent" integer NOT NULL DEFAULT '80'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dfe6c27c42564e7422d26c8b1e" ON "LlmCostBudget" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD CONSTRAINT "FK_dfe6c27c42564e7422d26c8b1ed" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
