import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * SNMP tables: OID Collection Templates and devices can now define tables
 * to walk (one row per tunnel, radio, neighbour ...), and each device keeps
 * the rows of its last walk. Three nullable jsonb columns - adding them
 * rewrites no rows and takes no long lock.
 */
export class AddSnmpTablesToNetworkDevices1799700000000
  implements MigrationInterface
{
  public name = "AddSnmpTablesToNetworkDevices1799700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOidTemplate" ADD "tables" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpTables" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpTableSnapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpTableSnapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpTables"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceOidTemplate" DROP COLUMN "tables"`,
    );
  }
}
