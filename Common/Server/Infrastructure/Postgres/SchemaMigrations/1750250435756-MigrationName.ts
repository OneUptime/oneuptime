import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1750250435756 implements MigrationInterface {
  public name = "MigrationName1750250435756";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" RENAME COLUMN "type" TO "fileType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" RENAME COLUMN "type" TO "paymentMethodType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" RENAME COLUMN "type" TO "customFieldType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" RENAME COLUMN "type" TO "customFieldType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" RENAME COLUMN "type" TO "customFieldType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" RENAME COLUMN "type" TO "customFieldType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" RENAME COLUMN "type" TO "customFieldType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" RENAME COLUMN "type" TO "customFieldType"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertCustomField" RENAME COLUMN "customFieldType" TO "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageCustomField" RENAME COLUMN "customFieldType" TO "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCustomField" RENAME COLUMN "customFieldType" TO "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyCustomField" RENAME COLUMN "customFieldType" TO "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorCustomField" RENAME COLUMN "customFieldType" TO "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" RENAME COLUMN "customFieldType" TO "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingPaymentMethod" RENAME COLUMN "paymentMethodType" TO "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" RENAME COLUMN "fileType" TO "type"`,
    );
  }
}
