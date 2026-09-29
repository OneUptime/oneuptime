import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765633554715 implements MigrationInterface {
  public name = "MigrationName1765633554715";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceCatalogCodeRepository" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, "codeRepositoryId" uuid NOT NULL, "servicePathInRepository" character varying, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_1a0f992cb6c55f48d9fae93369a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41a90624dfbb954e3b50c93dfc" ON "ServiceCatalogCodeRepository" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4638e464dc7cab644c7926674b" ON "ServiceCatalogCodeRepository" ("serviceCatalogId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_05b6c65746b28329def0accba9" ON "ServiceCatalogCodeRepository" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD CONSTRAINT "FK_41a90624dfbb954e3b50c93dfc1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD CONSTRAINT "FK_4638e464dc7cab644c7926674b8" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD CONSTRAINT "FK_05b6c65746b28329def0accba94" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD CONSTRAINT "FK_c838ecb46958f5de7a699f50c53" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD CONSTRAINT "FK_1aae6b3a023a36f7c004749afe4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP CONSTRAINT "FK_1aae6b3a023a36f7c004749afe4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP CONSTRAINT "FK_c838ecb46958f5de7a699f50c53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP CONSTRAINT "FK_05b6c65746b28329def0accba94"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP CONSTRAINT "FK_4638e464dc7cab644c7926674b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP CONSTRAINT "FK_41a90624dfbb954e3b50c93dfc1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05b6c65746b28329def0accba9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4638e464dc7cab644c7926674b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_41a90624dfbb954e3b50c93dfc"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceCatalogCodeRepository"`);
  }
}
