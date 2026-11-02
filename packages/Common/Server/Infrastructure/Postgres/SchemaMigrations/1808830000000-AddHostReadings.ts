import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * What a host last reported, kept on its record so the Hosts list, its Needs
 * attention card and a host's own page read it without a ClickHouse query:
 * CPU, memory and swap in use, the fullest filesystem and the one with the
 * fewest inodes left (each with its mount point), the 15-minute load, when
 * the host started, and its failed systemd units (HostReadingsScan, written
 * by the metrics ingest with the host's heartbeat).
 *
 * Every column is new and nullable, with no default: adding them only
 * changes the catalogue, never rewrites a row or holds a long lock. A host's
 * readings fill in with its next metrics, within a minute; one that sends no
 * swap, inodes, uptime or systemd units keeps those empty.
 */
export class AddHostReadings1808830000000 implements MigrationInterface {
  public name: string = "AddHostReadings1808830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestCpuPercent" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestMemoryPercent" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestSwapPercent" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestDiskPercent" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestDiskMountpoint" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestInodesPercent" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestInodesMountpoint" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "latestLoadAverage15m" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "bootedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "failedSystemdUnitCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "failedSystemdUnits" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "readingsUpdatedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "readingsUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "failedSystemdUnits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "failedSystemdUnitCount"`,
    );
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "bootedAt"`);
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestLoadAverage15m"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestInodesMountpoint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestInodesPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestDiskMountpoint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestDiskPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestSwapPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestMemoryPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "latestCpuPercent"`,
    );
  }
}
