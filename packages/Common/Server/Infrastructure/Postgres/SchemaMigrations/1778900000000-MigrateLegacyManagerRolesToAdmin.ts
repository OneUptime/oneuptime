import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Migrates legacy single-tier "Manager" role values in TeamPermission to the
 * new per-domain Admin tier. Existing IncidentManager assignments become
 * IncidentAdmin, and so on for every domain. The Admin tier is chosen over
 * Member or Viewer so no existing user loses capabilities they had before.
 */
export class MigrateLegacyManagerRolesToAdmin1778900000000
  implements MigrationInterface
{
  public name: string = "MigrateLegacyManagerRolesToAdmin1778900000000";

  private static readonly ROLE_MAP: ReadonlyArray<[string, string]> = [
    ["IncidentManager", "IncidentAdmin"],
    ["AlertManager", "AlertAdmin"],
    ["MonitorManager", "MonitorAdmin"],
    ["StatusPageManager", "StatusPageAdmin"],
    ["OnCallManager", "OnCallAdmin"],
    ["ScheduledMaintenanceManager", "ScheduledMaintenanceAdmin"],
    ["TelemetryManager", "TelemetryAdmin"],
    ["SettingsManager", "SettingsAdmin"],
    ["BillingManager", "BillingAdmin"],
    ["WorkflowManager", "WorkflowAdmin"],
    ["RunbookManager", "RunbookAdmin"],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [
      legacy,
      replacement,
    ] of MigrateLegacyManagerRolesToAdmin1778900000000.ROLE_MAP) {
      await queryRunner.query(
        `UPDATE "TeamPermission" SET "permission" = $1 WHERE "permission" = $2`,
        [replacement, legacy],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [
      legacy,
      replacement,
    ] of MigrateLegacyManagerRolesToAdmin1778900000000.ROLE_MAP) {
      await queryRunner.query(
        `UPDATE "TeamPermission" SET "permission" = $1 WHERE "permission" = $2`,
        [legacy, replacement],
      );
    }
  }
}
