import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMetricRecordingRules1776600000000
  implements MigrationInterface
{
  public name = "AddMetricRecordingRules1776600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MetricRecordingRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "outputMetricName" character varying(100) NOT NULL, "definition" jsonb NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_630db247e0db8ff27fe7c564dd8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_686e0d0602b42fd0ac3461c36f" ON "MetricRecordingRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9df0d13c3421159ebd323ed60a" ON "MetricRecordingRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ADD CONSTRAINT "FK_686e0d0602b42fd0ac3461c36f6" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ADD CONSTRAINT "FK_3bb94b2180cac96e239b4fd00d6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" ADD CONSTRAINT "FK_889e2b5640ac7ac63d19d511f9d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" DROP CONSTRAINT "FK_889e2b5640ac7ac63d19d511f9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" DROP CONSTRAINT "FK_3bb94b2180cac96e239b4fd00d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricRecordingRule" DROP CONSTRAINT "FK_686e0d0602b42fd0ac3461c36f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9df0d13c3421159ebd323ed60a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_686e0d0602b42fd0ac3461c36f"`,
    );
    await queryRunner.query(`DROP TABLE "MetricRecordingRule"`);
  }
}
