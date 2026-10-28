import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A Network Device remembers when someone last asked for it to be read
 * again now (refreshRequestedAt): Refresh on its Inventory card and on its
 * Inventory item's Asset Details. Its probe's next poll, the copy of its
 * Inventory item and its Meraki connection's next reading each compare it
 * with their own last reading.
 *
 * One nullable timestamptz column on an existing table, with no default, no
 * index and no key: adding it rewrites nothing and blocks nothing. Nothing
 * to backfill - no device has been asked to refresh yet.
 */
export class AddNetworkDeviceRefreshRequestedAt1808300000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceRefreshRequestedAt1808300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "refreshRequestedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "refreshRequestedAt"`,
    );
  }
}
