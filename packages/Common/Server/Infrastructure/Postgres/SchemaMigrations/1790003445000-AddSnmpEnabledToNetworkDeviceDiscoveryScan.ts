import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Whether a discovery scan queries each live host over SNMP, or stops at the
 * ping that found it (OneUptime issue #3445).
 *
 * NOT NULL DEFAULT true, so every scan that already exists is backfilled to
 * the only value that describes the sweep it actually ran: before this column,
 * every discovery scan was an SNMP scan. The default is what lets the reader
 * (Common/Utils/NetworkDiscovery/ScanModeUtil) treat an absent value as "SNMP"
 * as well — which is the case a new probe hits when it polls a server too old
 * to send the column.
 */
export class AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000
  implements MigrationInterface
{
  public name: string =
    "AddSnmpEnabledToNetworkDeviceDiscoveryScan1790003445000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "isSnmpEnabled" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "isSnmpEnabled"`,
    );
  }
}
