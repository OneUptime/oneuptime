import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSentinelInsight1784010274993 implements MigrationInterface {
  public name: string = "AddSentinelInsight1784010274993";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SentinelInsight" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "insightType" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "severity" character varying(100) NOT NULL, "fingerprint" character varying(500) NOT NULL, "title" character varying(500) NOT NULL, "detailMarkdown" text NOT NULL, "serviceName" character varying(500), "telemetryServiceId" uuid, "telemetryExceptionId" uuid, "traceId" character varying(100), "metricName" character varying(500), "evidence" jsonb, "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "occurrenceCount" integer NOT NULL DEFAULT '1', "triageAiRunId" uuid, "fixAiRunId" uuid, "triageSummaryMarkdown" text, "triageCompletedAt" TIMESTAMP WITH TIME ZONE, "humanVerdict" character varying(100), "humanVerdictAt" TIMESTAMP WITH TIME ZONE, "humanVerdictByUserId" uuid, "deletedByUserId" uuid, "createdByUserId" uuid, CONSTRAINT "PK_sentinel_insight_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sentinel_insight_projectId" ON "SentinelInsight" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sentinel_insight_telemetryServiceId" ON "SentinelInsight" ("telemetryServiceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sentinel_insight_telemetryExceptionId" ON "SentinelInsight" ("telemetryExceptionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sentinel_insight_triageAiRunId" ON "SentinelInsight" ("triageAiRunId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sentinel_insight_fixAiRunId" ON "SentinelInsight" ("fixAiRunId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sentinel_insight_projectId_status" ON "SentinelInsight" ("projectId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sentinel_insight_projectId_fingerprint" ON "SentinelInsight" ("projectId", "fingerprint")`,
    );
    await queryRunner.query(
      `ALTER TABLE "SentinelInsight" ADD CONSTRAINT "FK_sentinel_insight_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SentinelInsight" ADD CONSTRAINT "FK_sentinel_insight_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SentinelInsight" ADD CONSTRAINT "FK_sentinel_insight_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SentinelInsight" DROP CONSTRAINT "FK_sentinel_insight_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SentinelInsight" DROP CONSTRAINT "FK_sentinel_insight_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SentinelInsight" DROP CONSTRAINT "FK_sentinel_insight_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sentinel_insight_projectId_fingerprint"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sentinel_insight_projectId_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sentinel_insight_fixAiRunId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sentinel_insight_triageAiRunId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sentinel_insight_telemetryExceptionId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sentinel_insight_telemetryServiceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sentinel_insight_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "SentinelInsight"`);
  }
}
