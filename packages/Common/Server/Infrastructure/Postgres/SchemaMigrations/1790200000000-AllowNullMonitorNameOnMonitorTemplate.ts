import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * "Default Monitor Name" on a Monitor Template becomes optional (issue #3486).
 *
 * A Network Device auto-import rule names every monitor it provisions
 * "<device> - <template's default monitor name>". While the column was NOT
 * NULL there was nothing an operator could type that would not become a
 * suffix on every imported device in the estate — "UN0660WANRTR01 - Unit
 * Router" for a router whose name is already UN0660WANRTR01. Blank now means
 * the monitor is named after the device alone.
 *
 * Nullable with no default and no backfill: every template that already
 * exists keeps the name it was created with, so nothing about an existing
 * project's monitor naming changes when this ships.
 */
export class AllowNullMonitorNameOnMonitorTemplate1790200000000
  implements MigrationInterface
{
  public name: string = "AllowNullMonitorNameOnMonitorTemplate1790200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "monitorName" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Templates written while the column was nullable have no name, and
     * restoring NOT NULL would fail on every one of them. "Monitor" is the
     * exact string the pre-#3486 code substituted when a template's name was
     * blank, so it is the one value that reconstructs the old behaviour
     * rather than inventing a new one.
     */
    await queryRunner.query(
      `UPDATE "MonitorTemplate" SET "monitorName" = 'Monitor' WHERE "monitorName" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "monitorName" SET NOT NULL`,
    );
  }
}
