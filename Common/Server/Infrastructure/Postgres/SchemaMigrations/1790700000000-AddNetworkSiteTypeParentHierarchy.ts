import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkSiteTypeParentHierarchy1790700000000
  implements MigrationInterface
{
  public name: string = "AddNetworkSiteTypeParentHierarchy1790700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_33a461f17262b0a4d5be6948ebe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_7de8eaaa47632114c6864d67d35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" ADD "parentNetworkSiteTypeId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d693eaf5e12242179e348daf09" ON "NetworkSiteType" ("projectId", "parentNetworkSiteTypeId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" ADD CONSTRAINT "FK_ee9400ec824926d129b31d5fcf0" FOREIGN KEY ("parentNetworkSiteTypeId") REFERENCES "NetworkSiteType"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_7de8eaaa47632114c6864d67d35" FOREIGN KEY ("networkSiteTypeId") REFERENCES "NetworkSiteType"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_33a461f17262b0a4d5be6948ebe" FOREIGN KEY ("parentSiteId") REFERENCES "NetworkSite"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_33a461f17262b0a4d5be6948ebe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_7de8eaaa47632114c6864d67d35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" DROP CONSTRAINT "FK_ee9400ec824926d129b31d5fcf0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d693eaf5e12242179e348daf09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" DROP COLUMN "parentNetworkSiteTypeId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_7de8eaaa47632114c6864d67d35" FOREIGN KEY ("networkSiteTypeId") REFERENCES "NetworkSiteType"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_33a461f17262b0a4d5be6948ebe" FOREIGN KEY ("parentSiteId") REFERENCES "NetworkSite"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
