import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * vCenter's own roll-up of its datacenters, kept on each datacenter's
 * inventory row so the vCenter's Overview, its parts' pages and the Topology
 * read it without a ClickHouse query: how many of the datacenter's hosts
 * vCenter has lost contact with (power state unknown) and how many vSphere
 * DPM put in standby, how many hosts have a critical (red) or a warning
 * (yellow) overall status, and how many VMs and clusters a critical one
 * (VMwareSnapshotScan, written by the metrics ingest with the datacenter's
 * other counts on every collection).
 *
 * Every column is new and nullable, with no default: adding them only
 * changes the catalogue, never rewrites a row or holds a long lock. A
 * datacenter's counts fill in with the vCenter's next collection.
 */
export class AddVMwareDatacenterHostStates1808870000000
  implements MigrationInterface
{
  public name: string = "AddVMwareDatacenterHostStates1808870000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "notRespondingHostCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "standbyHostCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "criticalHostCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "warningHostCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "criticalVmCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "criticalClusterCount" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "criticalClusterCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "criticalVmCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "warningHostCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "criticalHostCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "standbyHostCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "notRespondingHostCount"`,
    );
  }
}
