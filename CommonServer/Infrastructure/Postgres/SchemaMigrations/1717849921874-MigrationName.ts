import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrationName1717849921874 implements MigrationInterface {
    public name = 'MigrationName1717849921874';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "ServiceCatalogOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_da84693caf7072d56bedfc2dc1b" PRIMARY KEY ("_id"))`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_726241162b0a853b29d85e28c4" ON "ServiceCatalogOwnerTeam" ("projectId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_e3090773a4106e0c4375897993" ON "ServiceCatalogOwnerTeam" ("teamId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_c015513688ebd42e5569b4d6ac" ON "ServiceCatalogOwnerTeam" ("serviceCatalogId") `
        );
        await queryRunner.query(
            `CREATE TABLE "ServiceCatalogOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "serviceCatalogId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c0fbf81bd041371f8beb69b440d" PRIMARY KEY ("_id"))`
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_51c375fe9f6ffb0372d3425d99" ON "ServiceCatalogOwnerUser" ("projectId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_f6abd337058906d7912164ae12" ON "ServiceCatalogOwnerUser" ("userId") `
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_27a396dd77fb8c0d5d6cb89216" ON "ServiceCatalogOwnerUser" ("serviceCatalogId") `
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_726241162b0a853b29d85e28c4c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_e3090773a4106e0c4375897993f" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_c015513688ebd42e5569b4d6ac6" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_9afb156569266f66a2301eb09ff" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" ADD CONSTRAINT "FK_0e93a638ddc94aaad4ad33789d7" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_51c375fe9f6ffb0372d3425d999" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_f6abd337058906d7912164ae12e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_27a396dd77fb8c0d5d6cb892165" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_2d2c21db8da169b5b2d2bee3111" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" ADD CONSTRAINT "FK_d61607e823057b6516f05e8f1cd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_d61607e823057b6516f05e8f1cd"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_2d2c21db8da169b5b2d2bee3111"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_27a396dd77fb8c0d5d6cb892165"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_f6abd337058906d7912164ae12e"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerUser" DROP CONSTRAINT "FK_51c375fe9f6ffb0372d3425d999"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_0e93a638ddc94aaad4ad33789d7"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_9afb156569266f66a2301eb09ff"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_c015513688ebd42e5569b4d6ac6"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_e3090773a4106e0c4375897993f"`
        );
        await queryRunner.query(
            `ALTER TABLE "ServiceCatalogOwnerTeam" DROP CONSTRAINT "FK_726241162b0a853b29d85e28c4c"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_27a396dd77fb8c0d5d6cb89216"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_f6abd337058906d7912164ae12"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_51c375fe9f6ffb0372d3425d99"`
        );
        await queryRunner.query(`DROP TABLE "ServiceCatalogOwnerUser"`);
        await queryRunner.query(
            `DROP INDEX "public"."IDX_c015513688ebd42e5569b4d6ac"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_e3090773a4106e0c4375897993"`
        );
        await queryRunner.query(
            `DROP INDEX "public"."IDX_726241162b0a853b29d85e28c4"`
        );
        await queryRunner.query(`DROP TABLE "ServiceCatalogOwnerTeam"`);
    }
}
