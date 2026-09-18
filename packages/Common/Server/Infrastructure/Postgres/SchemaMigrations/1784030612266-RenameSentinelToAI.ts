import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/**
 * Retires the "Sentinel" codename from the live schema.
 *
 * The user-visible string rebrand shipped separately; this migration catches
 * the persisted artifacts up with the code-identifier sweep:
 *
 *   - table  "SentinelInsight"                  -> "AIInsight"
 *   - column Project."enableSentinelInsights"   -> "enableAiInsights"
 *   - column AIRun."triggeredBySentinelInsightId" -> "triggeredByAiInsightId"
 *   - the hand-named PK/FK/index identifiers, so the schema is self-consistent
 *   - the persisted LlmLog.feature labels
 *
 * This is an ADDITIVE rename migration on purpose. The two shipped migrations
 * (AddSentinelInsight1784010274993, AddSentinelInsightFlags1784010274994) are
 * left untouched: their class name is the key in the `migrations` table, so
 * editing them in place would make TypeORM believe they had never run and
 * re-execute them against databases that already have the objects.
 *
 * The column names above are spelled exactly as the entity properties
 * (Project.enableAiInsights, AIRun.triggeredByAiInsightId). TypeORM derives the
 * column name from the property name -- there is no @Column({ name: ... })
 * override on either -- so any other spelling would make every read of those
 * entities fail with "column does not exist".
 */
export class RenameSentinelToAI1784030612266 implements MigrationInterface {
  public name: string = "RenameSentinelToAI1784030612266";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rename the table.
    await queryRunner.query(
      `ALTER TABLE "SentinelInsight" RENAME TO "AIInsight"`,
    );

    // 2. Rename the Project feature flag column.
    await queryRunner.query(
      `ALTER TABLE "Project" RENAME COLUMN "enableSentinelInsights" TO "enableAiInsights"`,
    );

    // 3. Rename the AIRun back-reference column.
    await queryRunner.query(
      `ALTER TABLE "AIRun" RENAME COLUMN "triggeredBySentinelInsightId" TO "triggeredByAiInsightId"`,
    );

    /*
     * 4. Rename the hand-named constraints and indexes. Postgres keeps these
     * pointing at the right table/columns after a RENAME, but they would still
     * read "sentinel_insight" in \d output and in any future migration that
     * refers to them by name, so rename them too.
     */
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "PK_sentinel_insight_id" TO "PK_ai_insight_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "FK_sentinel_insight_projectId" TO "FK_ai_insight_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "FK_sentinel_insight_createdByUserId" TO "FK_ai_insight_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "FK_sentinel_insight_deletedByUserId" TO "FK_ai_insight_deletedByUserId"`,
    );

    await queryRunner.query(
      `ALTER INDEX "IDX_sentinel_insight_projectId" RENAME TO "IDX_ai_insight_projectId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_sentinel_insight_telemetryServiceId" RENAME TO "IDX_ai_insight_telemetryServiceId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_sentinel_insight_telemetryExceptionId" RENAME TO "IDX_ai_insight_telemetryExceptionId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_sentinel_insight_triageAiRunId" RENAME TO "IDX_ai_insight_triageAiRunId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_sentinel_insight_fixAiRunId" RENAME TO "IDX_ai_insight_fixAiRunId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_sentinel_insight_projectId_status" RENAME TO "IDX_ai_insight_projectId_status"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_sentinel_insight_projectId_fingerprint" RENAME TO "IDX_ai_insight_projectId_fingerprint"`,
    );

    await queryRunner.query(
      `ALTER INDEX "IDX_airun_triggeredBySentinelInsightId" RENAME TO "IDX_airun_triggeredByAiInsightId"`,
    );

    /*
     * 5. Rewrite the persisted LlmLog feature labels.
     *
     * These are set-based UPDATEs in a SCHEMA migration rather than a row-by-row
     * data migration on purpose. The daily-budget guard sums spend by matching
     * LlmLog."feature" against an IN-list of literal strings held in code. Schema
     * migrations run to completion BEFORE the app pods start serving traffic,
     * whereas data migrations run alongside a live app. If this backfill lagged
     * behind the deploy, rows written under the old labels earlier the same day
     * would no longer match the new IN-list, so the budget would under-count
     * same-day spend and let projects overspend until the next UTC rollover.
     * Doing it here makes the label flip atomic with respect to the code change.
     */
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'AI Incident Investigation' WHERE "feature" = 'Sentinel Incident Investigation'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'AI Alert Investigation' WHERE "feature" = 'Sentinel Alert Investigation'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'AI Investigation Grading' WHERE "feature" = 'Sentinel Investigation Grading'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'AI Confidence Classification' WHERE "feature" = 'Sentinel Confidence Classification'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'AI Code Fix' WHERE "feature" = 'Sentinel Code Fix'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'AI Insight Triage' WHERE "feature" = 'Sentinel Insight Triage'`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    // 5. Restore the persisted LlmLog feature labels.
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'Sentinel Insight Triage' WHERE "feature" = 'AI Insight Triage'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'Sentinel Code Fix' WHERE "feature" = 'AI Code Fix'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'Sentinel Confidence Classification' WHERE "feature" = 'AI Confidence Classification'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'Sentinel Investigation Grading' WHERE "feature" = 'AI Investigation Grading'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'Sentinel Alert Investigation' WHERE "feature" = 'AI Alert Investigation'`,
    );
    await queryRunner.query(
      `UPDATE "LlmLog" SET "feature" = 'Sentinel Incident Investigation' WHERE "feature" = 'AI Incident Investigation'`,
    );

    // 4. Restore the constraint and index names.
    await queryRunner.query(
      `ALTER INDEX "IDX_airun_triggeredByAiInsightId" RENAME TO "IDX_airun_triggeredBySentinelInsightId"`,
    );

    await queryRunner.query(
      `ALTER INDEX "IDX_ai_insight_projectId_fingerprint" RENAME TO "IDX_sentinel_insight_projectId_fingerprint"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_ai_insight_projectId_status" RENAME TO "IDX_sentinel_insight_projectId_status"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_ai_insight_fixAiRunId" RENAME TO "IDX_sentinel_insight_fixAiRunId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_ai_insight_triageAiRunId" RENAME TO "IDX_sentinel_insight_triageAiRunId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_ai_insight_telemetryExceptionId" RENAME TO "IDX_sentinel_insight_telemetryExceptionId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_ai_insight_telemetryServiceId" RENAME TO "IDX_sentinel_insight_telemetryServiceId"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_ai_insight_projectId" RENAME TO "IDX_sentinel_insight_projectId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "FK_ai_insight_deletedByUserId" TO "FK_sentinel_insight_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "FK_ai_insight_createdByUserId" TO "FK_sentinel_insight_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "FK_ai_insight_projectId" TO "FK_sentinel_insight_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME CONSTRAINT "PK_ai_insight_id" TO "PK_sentinel_insight_id"`,
    );

    // 3. Restore the AIRun back-reference column.
    await queryRunner.query(
      `ALTER TABLE "AIRun" RENAME COLUMN "triggeredByAiInsightId" TO "triggeredBySentinelInsightId"`,
    );

    // 2. Restore the Project feature flag column.
    await queryRunner.query(
      `ALTER TABLE "Project" RENAME COLUMN "enableAiInsights" TO "enableSentinelInsights"`,
    );

    // 1. Restore the table name.
    await queryRunner.query(
      `ALTER TABLE "AIInsight" RENAME TO "SentinelInsight"`,
    );
  }
}
