import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The name a discovery scan gave a network device, and where it came from
 * (OneUptime issue #4518): NetworkDevice.discoveredName and
 * NetworkDevice.discoveredNameSource. A later scan that finds a better name
 * renames a device still called exactly its discovered name; a name a person
 * typed differs from it and is never touched. Both columns are nullable with
 * no default, so the ALTERs only touch the catalog, and every existing device
 * reads as one discovery did not name - an upgrade renames nothing.
 */
export class AddNetworkDeviceDiscoveredName1800900000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceDiscoveredName1800900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "discoveredName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "discoveredNameSource" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "discoveredNameSource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "discoveredName"`,
    );
  }
}
