import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A Network Device Diagnostic can be an SNMP Walk (issue #5184): the
 * subtree it walks (snmpWalkRootOid), the OID a walk that continues another
 * reads after (snmpWalkAfterOid), and what the probe read (snmpWalkResult).
 *
 * Three nullable columns on an existing table, with no default, no index
 * and no key: adding them rewrites nothing and blocks nothing. Nothing to
 * backfill - every row there is is a ping or a traceroute, which has none
 * of them.
 */
export class AddNetworkDeviceDiagnosticSnmpWalk1806600000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceDiagnosticSnmpWalk1806600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD "snmpWalkRootOid" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD "snmpWalkAfterOid" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" ADD "snmpWalkResult" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP COLUMN "snmpWalkResult"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP COLUMN "snmpWalkAfterOid"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiagnostic" DROP COLUMN "snmpWalkRootOid"`,
    );
  }
}
