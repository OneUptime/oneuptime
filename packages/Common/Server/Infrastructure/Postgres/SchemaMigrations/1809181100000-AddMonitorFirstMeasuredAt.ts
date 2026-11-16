import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #8899) after
 * Monitor gained firstMeasuredAt: when a check result, heartbeat, email,
 * agent report or evaluation first reached the monitor. Until one has, its
 * status is only the operational one every monitor is created in, and the
 * Monitors list, the Monitor List widget and status pages say it is
 * waiting for its first check instead of Operational.
 *
 * Nullable, with no default, and in no index: adding it rewrites nothing
 * and locks "Monitor" for no longer than the catalog change, and the one
 * write each monitor ever gets (MonitorFirstMeasured) can still be a HOT
 * update. The monitors measured before it existed are stamped by the
 * BackfillMonitorFirstMeasuredAt data migration.
 */
export class AddMonitorFirstMeasuredAt1809180900000
  implements MigrationInterface
{
  public name: string = "AddMonitorFirstMeasuredAt1809180900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "firstMeasuredAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "firstMeasuredAt"`,
    );
  }
}
