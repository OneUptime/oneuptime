import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1718121103363 implements MigrationInterface {
    public name = 'MigrationName1718121103363';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "CopilotService" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "servicePathInRepository" character varying(500) NOT NULL DEFAULT '/', "limitNumberOfOpenPullRequestsCount" integer DEFAULT '3', "createdByUserId" uuid, "deletedByUserId" uuid, "codeRepositoryId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, CONSTRAINT "PK_2d18b7fe97f4bbfcff6b97b914e" PRIMARY KEY ("_id"))`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_36e92a170d7ec38334ac3ebb90" ON "CopilotService" ("projectId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_52205be2c47a084993710bc415" ON "CopilotService" ("codeRepositoryId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_0473bee1732ba1d182fbcf72ae" ON "CopilotService" ("serviceCatalogId") `
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD "serviceCatalogId" uuid NOT NULL`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD "copilotServiceId" uuid NOT NULL`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_1ae20e42e24919a32772f11ccc" ON "CopilotEvent" ("serviceCatalogId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e808df486c4ed604786c1c8f78" ON "CopilotEvent" ("copilotServiceId") `
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" ADD CONSTRAINT "FK_36e92a170d7ec38334ac3ebb905" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" ADD CONSTRAINT "FK_582b763b1df79b7fbfc13b4acf5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" ADD CONSTRAINT "FK_7892e66e216040f2bf0b26ce154" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" ADD CONSTRAINT "FK_52205be2c47a084993710bc4157" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" ADD CONSTRAINT "FK_0473bee1732ba1d182fbcf72aec" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_1ae20e42e24919a32772f11ccc8" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" ADD CONSTRAINT "FK_e808df486c4ed604786c1c8f783" FOREIGN KEY ("copilotServiceId") REFERENCES "CopilotService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_e808df486c4ed604786c1c8f783"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP CONSTRAINT "FK_1ae20e42e24919a32772f11ccc8"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" DROP CONSTRAINT "FK_0473bee1732ba1d182fbcf72aec"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" DROP CONSTRAINT "FK_52205be2c47a084993710bc4157"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" DROP CONSTRAINT "FK_7892e66e216040f2bf0b26ce154"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" DROP CONSTRAINT "FK_582b763b1df79b7fbfc13b4acf5"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotService" DROP CONSTRAINT "FK_36e92a170d7ec38334ac3ebb905"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_e808df486c4ed604786c1c8f78"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_1ae20e42e24919a32772f11ccc"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP COLUMN "copilotServiceId"`
        );
        await queryRunner.query(
            `ALTER TABLE "CopilotEvent" DROP COLUMN "serviceCatalogId"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_0473bee1732ba1d182fbcf72ae"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_52205be2c47a084993710bc415"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_36e92a170d7ec38334ac3ebb90"`
        );
        await queryRunner.query(`DROP TABLE "CopilotService"`);
    }
}
