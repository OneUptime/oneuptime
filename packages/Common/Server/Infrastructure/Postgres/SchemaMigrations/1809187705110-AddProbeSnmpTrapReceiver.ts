import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A probe's SNMP trap receiver, as the probe reports it (#11005):
 * Probe.snmpTrapReceiver - whether it is on, its SNMPv3 engine ID, how many
 * SNMPv3 users it accepts and the SNMPv3 traps it refused
 * (Types/Probe/SnmpTrapReceiver). Nullable, with no default: adding it
 * rewrites no row, and a probe has none until it reports, every thirty
 * seconds once it runs this release.
 */
export class AddProbeSnmpTrapReceiver1809187705110
  implements MigrationInterface
{
  public name: string = "AddProbeSnmpTrapReceiver1809187705110";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Probe" ADD "snmpTrapReceiver" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "snmpTrapReceiver"`,
    );
  }
}
