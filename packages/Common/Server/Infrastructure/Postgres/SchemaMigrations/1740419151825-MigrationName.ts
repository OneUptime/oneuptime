import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1740419151825 implements MigrationInterface {
  public name = "MigrationName1740419151825";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "showIncidentsOnStatusPage" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "showAnnouncementsOnStatusPage" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "showScheduledMaintenanceEventsOnStatusPage" boolean NOT NULL DEFAULT true`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "showScheduledMaintenanceEventsOnStatusPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "showAnnouncementsOnStatusPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "showIncidentsOnStatusPage"`,
    );
  }
}
