import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A network device's Other Addresses (NetworkDevice.otherAddresses): the IP
 * addresses it sends traps, syslog and flow records from besides its
 * hostname - a loopback, the interface facing the probe - so those records
 * are matched to it (OneUptime issue #4610). Nullable, and existing devices
 * start without any: they keep matching by hostname as before.
 */
export class AddNetworkDeviceOtherAddresses1801250000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceOtherAddresses1801250000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "otherAddresses" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "otherAddresses"`,
    );
  }
}
