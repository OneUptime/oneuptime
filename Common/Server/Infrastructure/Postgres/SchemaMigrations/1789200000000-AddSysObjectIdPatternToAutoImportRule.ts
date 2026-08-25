import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Vendor-based auto-import conditions (issue #3378, phase 2): the probe now
 * reports the full SNMP system group per discovered host (sysObjectId,
 * sysLocation, sysContact, sysUpTimeSeconds ride inside the scan's existing
 * discoveredDevices jsonb, so they need no column), and a rule can match on
 * the sysObjectID — the vendor's registered enterprise OID.
 */
export class AddSysObjectIdPatternToAutoImportRule1789200000000
  implements MigrationInterface
{
  public name: string = "AddSysObjectIdPatternToAutoImportRule1789200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD "sysObjectIdPattern" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP COLUMN "sysObjectIdPattern"`,
    );
  }
}
