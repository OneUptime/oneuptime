import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddMonitorNetworkDeviceId1809184900000, and moved into a migration of its
 * own: "Monitor" is written by every probe result, heartbeat and status
 * change, so both statements run online, without blocking its readers or
 * writers (Docs/migrations/README.md).
 *
 *   - The index the monitors a person tied to a network device are read by
 *     (issue #9545): the device's pages, and the duplicate check an import
 *     runs for every device it gives a monitor. Partial, so it holds only
 *     the monitors that are tied, and it serves the key's ON DELETE SET
 *     NULL when a device is deleted, without reading the table.
 *   - The key from a monitor to the device it is tied to, ON DELETE SET
 *     NULL: a person made the monitor, so the device going unties it and
 *     nothing more. Added NOT VALID, then validated; every existing row
 *     names no device.
 *
 * The names are the model's own (IDX_monitor_network_device,
 * FK_monitor_network_device), so the drift check finds nothing to change.
 * Safe to run again after a stop part way.
 */
export class AddMonitorNetworkDeviceIdIndexAndKey1809184900100
  implements MigrationInterface
{
  public name: string = "AddMonitorNetworkDeviceIdIndexAndKey1809184900100";

  // CREATE INDEX CONCURRENTLY and VALIDATE CONSTRAINT run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_monitor_network_device" ON "Monitor" ("networkDeviceId") WHERE "networkDeviceId" IS NOT NULL`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_monitor_network_device" FOREIGN KEY ("networkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_monitor_network_device"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_monitor_network_device"`,
    );
  }
}
