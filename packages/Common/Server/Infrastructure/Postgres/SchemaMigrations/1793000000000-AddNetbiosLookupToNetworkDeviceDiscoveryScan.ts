import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * OneUptime issue #3677: a discovery scan can ask hosts that are still
 * unnamed after the sweep for their NetBIOS name.
 *
 * - NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled is NOT NULL DEFAULT
 *   false. Turning it on sends a UDP 137 datagram to each unnamed host, which
 *   IDS rules on regulated networks flag, so every existing scan must keep
 *   sweeping exactly as it does today until someone turns it on.
 */
export class AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000
  implements MigrationInterface
{
  public name: string =
    "AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "isNetbiosLookupEnabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "isNetbiosLookupEnabled"`,
    );
  }
}
