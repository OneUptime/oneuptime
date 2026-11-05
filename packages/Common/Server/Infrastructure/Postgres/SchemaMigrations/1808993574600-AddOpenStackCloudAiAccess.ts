import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackCloudAiAccess1808993574600 implements MigrationInterface {
  public name: string = "AddOpenStackCloudAiAccess1808993574600";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "aiCommandAllowlist" jsonb`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "aiAccessLastError" character varying`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "aiAccessConfiguredAt"`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "aiAccessLastError"`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "aiAccessLastVerifiedAt"`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "aiCommandAllowlist"`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "aiRemediationMode"`);
    await queryRunner.query(`ALTER TABLE "OpenStackCloud" DROP COLUMN "isAiInvestigationEnabled"`);
  }

}
