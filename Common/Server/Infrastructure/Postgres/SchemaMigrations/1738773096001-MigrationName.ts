import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1738773096001 implements MigrationInterface {
  public name = "MigrationName1738773096001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceProviderSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "settings" jsonb NOT NULL, "serviceProviderType" character varying(500) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_067585897cee83c2724244e3531" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9058eb1588c022d397933b2c07" ON "ServiceProviderSetting" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" ADD CONSTRAINT "FK_9058eb1588c022d397933b2c07e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" ADD CONSTRAINT "FK_c606b8363bb5109bb7a878123aa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" ADD CONSTRAINT "FK_1abb759b95955aa055be8e7b0da" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" DROP CONSTRAINT "FK_1abb759b95955aa055be8e7b0da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" DROP CONSTRAINT "FK_c606b8363bb5109bb7a878123aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceProviderSetting" DROP CONSTRAINT "FK_9058eb1588c022d397933b2c07e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9058eb1588c022d397933b2c07"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceProviderSetting"`);
  }
}
