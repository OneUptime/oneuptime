import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736703138918 implements MigrationInterface {
  public name = "MigrationName1736703138918";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" ADD "incidentLogSeverity" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" ADD "alertLogSeverity" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" ADD "scheduledMaintenanceLogSeverity" character varying NOT NULL`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" DROP COLUMN "scheduledMaintenanceLogSeverity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLog" DROP COLUMN "alertLogSeverity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLog" DROP COLUMN "incidentLogSeverity"`,
    );
  }
}
