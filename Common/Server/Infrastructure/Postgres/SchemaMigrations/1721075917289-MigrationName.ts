import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1721075917289 implements MigrationInterface {
  public name = "MigrationName1721075917289";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ServiceCatlogDependency" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, "dependencyServiceCatalogId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f4c8003faa6daec34a5b97f88e8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d213c12854b956ed3c7f5f82f" ON "ServiceCatlogDependency" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd2b648fe0cd2955d73286f3f9" ON "ServiceCatlogDependency" ("serviceCatalogId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84855f72c816f5fa05c7636581" ON "ServiceCatlogDependency" ("dependencyServiceCatalogId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_5d213c12854b956ed3c7f5f82f5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_bd2b648fe0cd2955d73286f3f90" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_84855f72c816f5fa05c76365810" FOREIGN KEY ("dependencyServiceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_3741c2e3d35cb739451e50fcac2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" ADD CONSTRAINT "FK_a4e505f3feab672e2dbbb3a58a1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_a4e505f3feab672e2dbbb3a58a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_3741c2e3d35cb739451e50fcac2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_84855f72c816f5fa05c76365810"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_bd2b648fe0cd2955d73286f3f90"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatlogDependency" DROP CONSTRAINT "FK_5d213c12854b956ed3c7f5f82f5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84855f72c816f5fa05c7636581"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd2b648fe0cd2955d73286f3f9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d213c12854b956ed3c7f5f82f"`,
    );
    await queryRunner.query(`DROP TABLE "ServiceCatlogDependency"`);
  }
}
