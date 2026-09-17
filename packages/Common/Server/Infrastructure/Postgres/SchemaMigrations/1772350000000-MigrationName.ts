import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1772350000000 implements MigrationInterface {
  public name = "MigrationName1772350000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "monitorMetricRetentionInDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_monitor_metric_retention" UNIQUE ("monitorMetricRetentionInDays")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_monitor_metric_retention"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "monitorMetricRetentionInDays"`,
    );
  }
}
