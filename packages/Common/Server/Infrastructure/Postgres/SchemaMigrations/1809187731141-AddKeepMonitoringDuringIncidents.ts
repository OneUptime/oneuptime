import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Whether an incident declared by hand pauses a monitor's checks (#11141):
 *
 *   - Monitor "keepMonitoringDuringIncidents", the Keep monitoring during
 *     incidents switch on a monitor's Settings page. Off for every monitor,
 *     existing and new: an incident declared by hand pauses its checks
 *     until it is resolved, as it always did.
 *   - Incident "pauseMonitoring", Pause Monitoring where the incident is
 *     declared and on its Affected Resources. On for every incident,
 *     existing and new, as every incident declared by hand always paused
 *     its monitors.
 *
 * Both columns have a constant default, so they are added without
 * rewriting a row.
 */
export class AddKeepMonitoringDuringIncidents1809187731141
  implements MigrationInterface
{
  public name: string = "AddKeepMonitoringDuringIncidents1809187731141";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "keepMonitoringDuringIncidents" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "pauseMonitoring" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "pauseMonitoring"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "keepMonitoringDuringIncidents"`,
    );
  }
}
