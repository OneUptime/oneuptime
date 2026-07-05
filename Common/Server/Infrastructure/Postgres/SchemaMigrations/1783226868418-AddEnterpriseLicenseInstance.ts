import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEnterpriseLicenseInstance1783226868418
  implements MigrationInterface
{
  public name = "AddEnterpriseLicenseInstance1783226868418";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "EnterpriseLicenseInstance" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "enterpriseLicenseId" uuid NOT NULL, "instanceId" character varying(100) NOT NULL, "host" character varying(100), "userCount" integer, "userEmailHashes" jsonb, "lastReportedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_af49c1c72bebf72915b9d38721d" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_743f3cfb5c7170f50de2159c3f" ON "EnterpriseLicenseInstance" ("enterpriseLicenseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_25feed2a867b2a3d81d0633878" ON "EnterpriseLicenseInstance" ("instanceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseInstances" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicenseInstance" ADD CONSTRAINT "FK_743f3cfb5c7170f50de2159c3f8" FOREIGN KEY ("enterpriseLicenseId") REFERENCES "EnterpriseLicense"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicenseInstance" DROP CONSTRAINT "FK_743f3cfb5c7170f50de2159c3f8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseInstances"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25feed2a867b2a3d81d0633878"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_743f3cfb5c7170f50de2159c3f"`,
    );
    await queryRunner.query(`DROP TABLE "EnterpriseLicenseInstance"`);
  }
}
