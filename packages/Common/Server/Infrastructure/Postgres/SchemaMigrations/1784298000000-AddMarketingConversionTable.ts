import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMarketingConversionTable1784298000000
  implements MigrationInterface
{
  public name: string = "AddMarketingConversionTable1784298000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MarketingConversion" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "conversionType" character varying(100) NOT NULL, "userId" uuid, "projectId" uuid, "email" character varying(100), "clickIds" jsonb NOT NULL, "conversionAt" TIMESTAMP WITH TIME ZONE NOT NULL, "conversionValueInUSDCents" integer, "uploadState" jsonb, CONSTRAINT "PK_MarketingConversion_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_marketing_conversion_user_id" ON "MarketingConversion" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_marketing_conversion_project_id" ON "MarketingConversion" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_marketing_conversion_type_user" ON "MarketingConversion" ("conversionType", "userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_marketing_conversion_type_project" ON "MarketingConversion" ("conversionType", "projectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "uq_marketing_conversion_type_project"`,
    );
    await queryRunner.query(`DROP INDEX "uq_marketing_conversion_type_user"`);
    await queryRunner.query(`DROP INDEX "idx_marketing_conversion_project_id"`);
    await queryRunner.query(`DROP INDEX "idx_marketing_conversion_user_id"`);
    await queryRunner.query(`DROP TABLE "MarketingConversion"`);
  }
}
