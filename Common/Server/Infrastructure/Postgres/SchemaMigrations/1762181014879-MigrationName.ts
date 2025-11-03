import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1762181014879 implements MigrationInterface {
    public name = 'MigrationName1762181014879'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "EnterpriseLicense" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "companyName" character varying(100) NOT NULL, "licenseKey" character varying(100) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "annualContractValue" integer, CONSTRAINT "UQ_d35e76999092d8a16a66e84c17c" UNIQUE ("licenseKey"), CONSTRAINT "PK_731aa4437672f250fd51ec04166" PRIMARY KEY ("_id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d35e76999092d8a16a66e84c17" ON "EnterpriseLicense" ("licenseKey") `);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "enterpriseCompanyName" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_46983cb1a59503dc09fc84bbe0c" UNIQUE ("enterpriseCompanyName")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseKey" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_89f80e8a18c3372ee150a3812c1" UNIQUE ("enterpriseLicenseKey")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseExpiresAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_a361278e9ce4056d59e8fb13319" UNIQUE ("enterpriseLicenseExpiresAt")`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseToken" text`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_b0b9322c111c0cc629fedbb4eb3" UNIQUE ("enterpriseLicenseToken")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_b0b9322c111c0cc629fedbb4eb3"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseToken"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_a361278e9ce4056d59e8fb13319"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseExpiresAt"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_89f80e8a18c3372ee150a3812c1"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseKey"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_46983cb1a59503dc09fc84bbe0c"`);
        await queryRunner.query(`ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseCompanyName"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d35e76999092d8a16a66e84c17"`);
        await queryRunner.query(`DROP TABLE "EnterpriseLicense"`);
    }

}
