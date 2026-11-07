import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statement it generates
 * for the model), then renumbered after the last registered migration.
 *
 * An audit log export says which version of the record it sends
 * (AuditLogExport.schemaVersion, issue #6247): version 2 also says what
 * changed in a workflow's steps and in JSON. Every export saved before this
 * migration sends version 1, as it always did, so nothing that reads it has
 * to change: the column's constant default gives each of them 1, and on
 * Postgres 11 and later the ADD changes the table's metadata only - no row
 * is rewritten. A new export is given the newest version when it is created
 * (AuditLogExportService), never this default.
 */
export class AddAuditLogExportSchemaVersion1808996130000
  implements MigrationInterface
{
  public name: string = "AddAuditLogExportSchemaVersion1808996130000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" ADD "schemaVersion" integer NOT NULL DEFAULT '1'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" DROP COLUMN "schemaVersion"`,
    );
  }
}
