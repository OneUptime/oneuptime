import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMetricPipelineRules1776430228051 implements MigrationInterface {
  name = "AddMetricPipelineRules1776430228051";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MetricPipelineRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceId" uuid, "name" character varying(50) NOT NULL, "description" character varying(500), "ruleType" character varying(100) NOT NULL, "matchMetricNameRegex" character varying(500), "matchAttributeKey" character varying(100), "matchAttributeValueRegex" character varying(500), "renameFromKey" character varying(100), "renameToKey" character varying(100), "addAttributeKey" character varying(100), "addAttributeValue" character varying(500), "redactReplacement" character varying(100) NOT NULL DEFAULT '[REDACTED]', "samplePercentage" integer NOT NULL DEFAULT '100', "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8095847bfd8645395b017b4caa2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a998093e4ce311de800b097a8" ON "MetricPipelineRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f721c65f32d1adf2c95f8e9f68" ON "MetricPipelineRule" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d40cdea3189290e196073c7c8b" ON "MetricPipelineRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "defaultMetricCardinalityBudget" integer NOT NULL DEFAULT '10000'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "defaultMetricDownsamplingRetentionDays" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "metricCardinalityBudget" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "metricDownsamplingRetentionDays" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_6a998093e4ce311de800b097a83" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_f721c65f32d1adf2c95f8e9f68b" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_8818020752998f385dab57f33d0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" ADD CONSTRAINT "FK_5a45d3f3917790440570168084b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_5a45d3f3917790440570168084b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_8818020752998f385dab57f33d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_f721c65f32d1adf2c95f8e9f68b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricPipelineRule" DROP CONSTRAINT "FK_6a998093e4ce311de800b097a83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "metricDownsamplingRetentionDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "metricCardinalityBudget"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "defaultMetricDownsamplingRetentionDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "defaultMetricCardinalityBudget"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d40cdea3189290e196073c7c8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f721c65f32d1adf2c95f8e9f68"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a998093e4ce311de800b097a8"`,
    );
    await queryRunner.query(`DROP TABLE "MetricPipelineRule"`);
  }
}
