import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * OneUptime issue #3678: discovered devices can be named by their short
 * hostname, with the full reverse-DNS name kept on the device.
 *
 * - NetworkDevice.dnsName is nullable: existing devices have no recorded DNS
 *   name, and reading that as "none" is the truth.
 * - NetworkDeviceDiscoveryScan.useShortDeviceNames is NOT NULL DEFAULT false,
 *   so every existing scan keeps importing devices under the names it always
 *   has until someone turns it on.
 */
export class AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000
  implements MigrationInterface
{
  public name: string =
    "AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "dnsName" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "useShortDeviceNames" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "useShortDeviceNames"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "dnsName"`,
    );
  }
}
