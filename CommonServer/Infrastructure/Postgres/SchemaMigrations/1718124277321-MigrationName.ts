import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1718124277321 implements MigrationInterface {
    public name = 'MigrationName1718124277321';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "ServiceRepository" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "servicePathInRepository" character varying(500) NOT NULL DEFAULT '/', "limitNumberOfOpenPullRequestsCount" integer DEFAULT '3', "createdByUserId" uuid, "deletedByUserId" uuid, "codeRepositoryId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, CONSTRAINT "PK_364ee8145cc35d43da0ef95d232" PRIMARY KEY ("_id"))`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_3fd668d4dc10d87963b19c5112" ON "ServiceRepository" ("projectId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_da3f196daf93e32b5ae51b865e" ON "ServiceRepository" ("codeRepositoryId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_1f1b62e84894dbebb145361c27" ON "ServiceRepository" ("serviceCatalogId") `
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD "serviceCatalogId" uuid NOT NULL`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD "serviceRepositoryId" uuid NOT NULL`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_1ae20e42e24919a32772f11ccc" ON "CopilotEvent" ("serviceCatalogId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_b567d8c08ac3810e87efc3222c" ON "CopilotEvent" ("serviceRepositoryId") `
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" ADD CONSTRAINT "FK_3fd668d4dc10d87963b19c5112c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" ADD CONSTRAINT "FK_ef96f4ebdf6327f7c06fad89127" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" ADD CONSTRAINT "FK_04df693e197a04b0b7a81e3893e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" ADD CONSTRAINT "FK_da3f196daf93e32b5ae51b865ef" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" ADD CONSTRAINT "FK_1f1b62e84894dbebb145361c27b" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_1ae20e42e24919a32772f11ccc8" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_b567d8c08ac3810e87efc3222c5" FOREIGN KEY ("serviceRepositoryId") REFERENCES "ServiceRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_b567d8c08ac3810e87efc3222c5"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_1ae20e42e24919a32772f11ccc8"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" DROP CONSTRAINT "FK_1f1b62e84894dbebb145361c27b"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" DROP CONSTRAINT "FK_da3f196daf93e32b5ae51b865ef"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" DROP CONSTRAINT "FK_04df693e197a04b0b7a81e3893e"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" DROP CONSTRAINT "FK_ef96f4ebdf6327f7c06fad89127"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceRepository" DROP CONSTRAINT "FK_3fd668d4dc10d87963b19c5112c"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_b567d8c08ac3810e87efc3222c"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_1ae20e42e24919a32772f11ccc"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP COLUMN "serviceRepositoryId"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP COLUMN "serviceCatalogId"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_1f1b62e84894dbebb145361c27"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_da3f196daf93e32b5ae51b865e"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_3fd668d4dc10d87963b19c5112"`
        );
        await queryRunner.query(`DROP TABLE "ServiceRepository"`);
    }
}
