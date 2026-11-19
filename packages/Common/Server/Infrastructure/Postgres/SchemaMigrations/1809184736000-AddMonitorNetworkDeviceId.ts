import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Monitor.networkDeviceId (OneUptime issue #9545): the network device a
 * monitor a person made checks - tied from the monitor's form or the
 * device's Monitors card, or, when the monitor is created on an address
 * exactly one device in the project has, to that device. It is what makes a
 * hand-made monitor one of the device's own, for its pages and for the
 * duplicate check imports and auto import rules run.
 *
 * Generated with npm run generate-postgres-migration. A nullable column with
 * no default: adding it rewrites nothing and reads no row. Its index and
 * foreign key are built online, apart, in
 * AddMonitorNetworkDeviceIdIndexAndKey1809184736100: "Monitor" is written by
 * every probe result, so neither may block its writers
 * (Docs/migrations/README.md). Existing monitors are tied once by the
 * LinkMonitorsToTheirNetworkDevices data migration.
 */
export class AddMonitorNetworkDeviceId1809184736000
  implements MigrationInterface
{
  public name: string = "AddMonitorNetworkDeviceId1809184736000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Monitor" ADD "networkDeviceId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "networkDeviceId"`,
    );
  }
}
