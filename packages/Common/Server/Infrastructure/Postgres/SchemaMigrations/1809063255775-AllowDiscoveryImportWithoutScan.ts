import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), reduced to the one the change needs, then renumbered
 * after the last registered migration.
 *
 * An import of devices from the Discovered Devices list (issue #5775) has no
 * discovery scan behind it, so NetworkDeviceDiscoveryImport's scan id may be
 * empty. The generator also dropped and re-created the column's foreign key
 * and index around the change. Postgres needs neither for DROP NOT NULL, and
 * re-adding the foreign key would check every row under a lock (see
 * OnlineDdl), so both stay as they are - which is what the schema drift
 * check compares against, unchanged. DROP NOT NULL changes the table's
 * metadata only: no row is read or rewritten, and every existing import
 * keeps its scan.
 *
 * Down puts the constraint back after deleting the imports that have no
 * scan, which the old schema cannot hold. The devices and monitors they
 * created stay.
 */
export class AllowDiscoveryImportWithoutScan1809063255775
  implements MigrationInterface
{
  public name: string = "AllowDiscoveryImportWithoutScan1809063255775";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" ALTER COLUMN "networkDeviceDiscoveryScanId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "NetworkDeviceDiscoveryImport" WHERE "networkDeviceDiscoveryScanId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryImport" ALTER COLUMN "networkDeviceDiscoveryScanId" SET NOT NULL`,
    );
  }
}
