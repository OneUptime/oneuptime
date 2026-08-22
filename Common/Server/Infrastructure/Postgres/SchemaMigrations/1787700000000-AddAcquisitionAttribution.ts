import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAcquisitionAttribution1787700000000
  implements MigrationInterface
{
  public name: string = "AddAcquisitionAttribution1787700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD "acquisitionAttribution" jsonb`);
    await queryRunner.query(`ALTER TABLE "Project" ADD "acquisitionAttribution" jsonb`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "anonymousVisitorId" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "sourceEventId" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "touchpointType" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "consentState" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "externalReferenceId" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" ADD "attribution" jsonb`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_marketing_conversion_source_event" ON "MarketingConversion" ("sourceEventId")`);
    await queryRunner.query(`CREATE INDEX "idx_marketing_conversion_visitor" ON "MarketingConversion" ("anonymousVisitorId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_marketing_conversion_visitor"`);
    await queryRunner.query(`DROP INDEX "uq_marketing_conversion_source_event"`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "attribution"`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "externalReferenceId"`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "consentState"`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "touchpointType"`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "sourceEventId"`);
    await queryRunner.query(`ALTER TABLE "MarketingConversion" DROP COLUMN "anonymousVisitorId"`);
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "acquisitionAttribution"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "acquisitionAttribution"`);
  }
}
