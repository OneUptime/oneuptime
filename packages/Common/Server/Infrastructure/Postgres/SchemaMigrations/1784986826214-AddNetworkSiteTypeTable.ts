import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Site types become a per-project lookup instead of a hardcoded enum.
 *
 * "siteType" (the inline string) is only made nullable here, not dropped: the
 * BackfillNetworkSiteTypes data migration still reads it to point every
 * existing site at its new NetworkSiteType row. It is dropped in a follow-up
 * once that backfill has run everywhere.
 *
 * Trimmed from the generator's output: it also emitted unrelated drift between
 * the local dev database and the current models — a destructive
 * DROP/ADD COLUMN pair on NetworkDeviceDiscoveryScan.snmpV3AuthKey and
 * .snmpV3PrivKey (which would have discarded stored SNMP v3 credentials) plus
 * two OnCallDutyPolicyScheduleLayer default changes. None of it belongs to this
 * change, so none of it is here.
 */
export class AddNetworkSiteTypeTable1784986826214
  implements MigrationInterface
{
  public name = "AddNetworkSiteTypeTable1784986826214";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkSiteType" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "order" integer, "isUnitLevel" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_accbcdba5c9872f2a993ff68a98" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7680ac82b732f9cae73354ec5" ON "NetworkSiteType" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "networkSiteTypeId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ALTER COLUMN "siteType" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7de8eaaa47632114c6864d67d3" ON "NetworkSite" ("networkSiteTypeId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" ADD CONSTRAINT "FK_d7680ac82b732f9cae73354ec50" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" ADD CONSTRAINT "FK_e55f1301b15db2a9a1881b82e0a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" ADD CONSTRAINT "FK_219288481a872d2a7333de2e317" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_7de8eaaa47632114c6864d67d35" FOREIGN KEY ("networkSiteTypeId") REFERENCES "NetworkSiteType"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_7de8eaaa47632114c6864d67d35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" DROP CONSTRAINT "FK_219288481a872d2a7333de2e317"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" DROP CONSTRAINT "FK_e55f1301b15db2a9a1881b82e0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSiteType" DROP CONSTRAINT "FK_d7680ac82b732f9cae73354ec50"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7de8eaaa47632114c6864d67d3"`,
    );
    /*
     * Sites created after this migration have no inline siteType, so restoring
     * NOT NULL needs a value for them. The type's name is exactly what the
     * column used to hold.
     */
    await queryRunner.query(
      `UPDATE "NetworkSite" SET "siteType" = COALESCE("NetworkSite"."siteType", (SELECT "NetworkSiteType"."name" FROM "NetworkSiteType" WHERE "NetworkSiteType"."_id" = "NetworkSite"."networkSiteTypeId"), 'Other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ALTER COLUMN "siteType" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP COLUMN "networkSiteTypeId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7680ac82b732f9cae73354ec5"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkSiteType"`);
  }
}
