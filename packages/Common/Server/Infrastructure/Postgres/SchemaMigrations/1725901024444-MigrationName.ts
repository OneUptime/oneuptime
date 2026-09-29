import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725901024444 implements MigrationInterface {
  public name = "MigrationName1725901024444";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "scheduleNextEventAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "scheduleNextEventAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "scheduleNextEventAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "scheduleNextEventAt" boolean NOT NULL`,
    );
  }
}
