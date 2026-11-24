import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Monitor.networkDeviceTieSource (OneUptime issue #9904): who set the
 * monitor's Network Device - OneUptime, by the address it checks seen from
 * its probes, or a person. OneUptime works its own tie out again when the
 * monitor's probes change, and never changes a person's.
 *
 * Generated with npm run generate-postgres-migration. A nullable column with
 * no default: adding it rewrites nothing and reads no row, and it needs no
 * index, as it is only ever read with its monitor. Every monitor tied
 * before is left empty, which keeps its tie as it is: it may be a person's.
 */
export class AddMonitorNetworkDeviceTieSource1809186700000
  implements MigrationInterface
{
  public name: string = "AddMonitorNetworkDeviceTieSource1809186700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "networkDeviceTieSource" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "networkDeviceTieSource"`,
    );
  }
}
