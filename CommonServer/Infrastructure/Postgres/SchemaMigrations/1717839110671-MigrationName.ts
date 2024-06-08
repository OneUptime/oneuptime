import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1717839110671 implements MigrationInterface {
    public name = 'MigrationName1717839110671';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "ServiceCatalog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "serviceColor" character varying, CONSTRAINT "PK_5186d54b1b97610ea80b5c55aad" PRIMARY KEY ("_id"))`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e712ff4cf5c1a865a5baa242e2" ON "ServiceCatalog" ("projectId") `
        );
        await queryRunner.query(
            `CREATE TABLE "ServiceCatalogLabel" ("serviceCatalogId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_a2c59f364d3bdb0d28307ad1d46" PRIMARY KEY ("serviceCatalogId", "labelId"))`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_98e9d83b6ff61003a29590f398" ON "ServiceCatalogLabel" ("serviceCatalogId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_701f84e45404bdddcffdcaaba2" ON "ServiceCatalogLabel" ("labelId") `
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "FK_e712ff4cf5c1a865a5baa242e2e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "FK_b8d64daaf462acd6f694ca47dad" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "FK_42f81942e36f5f42a5dce8e606d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogLabel" ADD CONSTRAINT "FK_98e9d83b6ff61003a29590f3987" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE CASCADE`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogLabel" ADD CONSTRAINT "FK_701f84e45404bdddcffdcaaba20" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogLabel" DROP CONSTRAINT "FK_701f84e45404bdddcffdcaaba20"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogLabel" DROP CONSTRAINT "FK_98e9d83b6ff61003a29590f3987"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalog" DROP CONSTRAINT "FK_42f81942e36f5f42a5dce8e606d"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalog" DROP CONSTRAINT "FK_b8d64daaf462acd6f694ca47dad"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalog" DROP CONSTRAINT "FK_e712ff4cf5c1a865a5baa242e2e"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_701f84e45404bdddcffdcaaba2"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_98e9d83b6ff61003a29590f398"`
        );
        await queryRunner.query(`DROP TABLE "ServiceCatalogLabel"`);
        await queryRunner.query(
            `DROP INDEX "public"."IDX_e712ff4cf5c1a865a5baa242e2"`
        );
        await queryRunner.query(`DROP TABLE "ServiceCatalog"`);
    }
}
