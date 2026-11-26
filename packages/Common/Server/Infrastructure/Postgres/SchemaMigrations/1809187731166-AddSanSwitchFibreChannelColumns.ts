import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * SAN switches (Brocade Fabric OS, Cisco MDS 9000):
 *
 *   - NetworkDevice.snmpV3ContextName: the SNMPv3 context a device is polled
 *     in, so each logical switch of a Brocade Virtual Fabric ("VF:128") is a
 *     device of its own;
 *   - NetworkInterface.fibreChannelPortType and downReason: what a Fibre
 *     Channel port is to the fabric, and why a down one is down.
 *
 * Nullable columns with no default: adding them rewrites no row.
 */
export class AddSanSwitchFibreChannelColumns1809187731166
  implements MigrationInterface
{
  public name: string = "AddSanSwitchFibreChannelColumns1809187731166";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3ContextName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD "fibreChannelPortType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" ADD "downReason" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP COLUMN "downReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" DROP COLUMN "fibreChannelPortType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3ContextName"`,
    );
  }
}
