import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two additions to the Inventory product:
 *
 *   Archiving — `isArchived` and its bookkeeping columns. This is the
 *   disposal route that actually works for this table: deleting a discovered
 *   or mirrored row does not stick, because ingest re-creates it on the next
 *   reconcile and the poller re-mirrors it on the next sweep. Archiving is a
 *   user annotation the reconciler never writes, so it survives
 *   re-registration.
 *
 *   Custom fields — a `customFields` bag on the item plus the
 *   `InventoryItemCustomField` table that defines their shape, following the
 *   same two-part pattern as Monitor / Incident / ScheduledMaintenance.
 *
 * Hand-written for the same reason as the rename that precedes it: no
 * database was reachable to run the generator against. Index and foreign key
 * names are TypeORM's own (`"IDX_"/"FK_" + sha1(table_sortedColumns)`,
 * truncated to 26 and 27 characters respectively), so the Schema Drift job
 * finds nothing left to generate. The accompanying test recomputes every one
 * of them from TypeORM's DefaultNamingStrategy.
 */
export class AddInventoryItemArchiveAndCustomFields1786900000000
  implements MigrationInterface
{
  public name = "AddInventoryItemArchiveAndCustomFields1786900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" ADD "customFields" jsonb`,
    );

    /*
     * Every list view filters on isArchived alongside the tenant column, so
     * the two are indexed together rather than leaving isArchived to a scan.
     */
    await queryRunner.query(
      `CREATE INDEX "IDX_0fef41416ab141b1f344fc96c3" ON "InventoryItem" ("projectId", "isArchived") `,
    );

    await queryRunner.query(
      `ALTER TABLE "InventoryItem" ADD CONSTRAINT "FK_8567c6339bf4889d00d121b3047" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "InventoryItemCustomField" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "customFieldType" character varying(100), "dropdownOptions" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_InventoryItemCustomField" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f6a4cbd2f57a69e5d6fab9854" ON "InventoryItemCustomField" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" ADD CONSTRAINT "FK_9f6a4cbd2f57a69e5d6fab9854d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" ADD CONSTRAINT "FK_8f121d4daca9d74f5f948511aef" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" ADD CONSTRAINT "FK_85f9a41e4ecf947560491917527" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" DROP CONSTRAINT "FK_85f9a41e4ecf947560491917527"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" DROP CONSTRAINT "FK_8f121d4daca9d74f5f948511aef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItemCustomField" DROP CONSTRAINT "FK_9f6a4cbd2f57a69e5d6fab9854d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f6a4cbd2f57a69e5d6fab9854"`,
    );
    await queryRunner.query(`DROP TABLE "InventoryItemCustomField"`);

    await queryRunner.query(
      `ALTER TABLE "InventoryItem" DROP CONSTRAINT "FK_8567c6339bf4889d00d121b3047"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0fef41416ab141b1f344fc96c3"`,
    );

    await queryRunner.query(
      `ALTER TABLE "InventoryItem" DROP COLUMN "customFields"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "InventoryItem" DROP COLUMN "isArchived"`,
    );
  }
}
