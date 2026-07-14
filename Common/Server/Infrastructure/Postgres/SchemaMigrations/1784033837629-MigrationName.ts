import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1784033837629 implements MigrationInterface {
  public name: string = "MigrationName1784033837629";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP CONSTRAINT "FK_ai_insight_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP CONSTRAINT "FK_ai_insight_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP CONSTRAINT "FK_ai_insight_deletedByUserId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_airun_triggeredByAiInsightId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ai_insight_projectId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ai_insight_fixAiRunId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_insight_projectId_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_insight_projectId_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_insight_telemetryServiceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_insight_telemetryExceptionId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ai_insight_triageAiRunId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ALTER COLUMN "completionTokens" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ALTER COLUMN "completionTokens" SET DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4bbaf6e55d46424a79fa33a153" ON "AIRun" ("triggeredByAiInsightId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c475b10e05707e6fd023ce837d" ON "AIInsight" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73a3cb310029e79cf4ba212927" ON "AIInsight" ("telemetryServiceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0502ba41c7d28bd4ecf761ae02" ON "AIInsight" ("telemetryExceptionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a97799d3f6ea959584552a2247" ON "AIInsight" ("triageAiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d26c0a68d5e1e7089018d0aae" ON "AIInsight" ("fixAiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa4c811c8e8eea71696d8b0c17" ON "AIInsight" ("projectId", "fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53414ea4ec8c25c189c23ca670" ON "AIInsight" ("projectId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD CONSTRAINT "FK_c475b10e05707e6fd023ce837d0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD CONSTRAINT "FK_5d57f7c210c9ec56efec43e2d50" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD CONSTRAINT "FK_6b465218068f61f3ea86e2f6ab1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP CONSTRAINT "FK_6b465218068f61f3ea86e2f6ab1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP CONSTRAINT "FK_5d57f7c210c9ec56efec43e2d50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" DROP CONSTRAINT "FK_c475b10e05707e6fd023ce837d0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53414ea4ec8c25c189c23ca670"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa4c811c8e8eea71696d8b0c17"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d26c0a68d5e1e7089018d0aae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a97799d3f6ea959584552a2247"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0502ba41c7d28bd4ecf761ae02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73a3cb310029e79cf4ba212927"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c475b10e05707e6fd023ce837d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4bbaf6e55d46424a79fa33a153"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ALTER COLUMN "completionTokens" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ALTER COLUMN "completionTokens" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_insight_triageAiRunId" ON "AIInsight" ("triageAiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_insight_telemetryExceptionId" ON "AIInsight" ("telemetryExceptionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_insight_telemetryServiceId" ON "AIInsight" ("telemetryServiceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_insight_projectId_fingerprint" ON "AIInsight" ("projectId", "fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_insight_projectId_status" ON "AIInsight" ("projectId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_insight_fixAiRunId" ON "AIInsight" ("fixAiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_insight_projectId" ON "AIInsight" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_airun_triggeredByAiInsightId" ON "AIRun" ("triggeredByAiInsightId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD CONSTRAINT "FK_ai_insight_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD CONSTRAINT "FK_ai_insight_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" ADD CONSTRAINT "FK_ai_insight_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
