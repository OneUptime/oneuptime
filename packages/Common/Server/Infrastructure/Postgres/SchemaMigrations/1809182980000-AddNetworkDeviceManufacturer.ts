import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A Network Device keeps the maker OneUptime names it by (issue #9363):
 * manufacturer, the one its Devices list's Vendor / Model column, its page and
 * its Inventory item show - worked out by the server from its vendor, its
 * SNMP identity, its network controller and the Discovered Devices list, and
 * written again whenever one of them changes. The lists' Vendor filter and
 * sort read it, so a device is found under the maker it is shown with.
 *
 * One nullable varchar column on an existing table, with no default, no index
 * and no key: adding it rewrites nothing and blocks nothing. The data
 * migration BackfillNetworkDeviceManufacturer works it out for the devices
 * that exist; every device created or changed after this has it from then on.
 */
export class AddNetworkDeviceManufacturer1809182980000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceManufacturer1809182980000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "manufacturer" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "manufacturer"`,
    );
  }
}
