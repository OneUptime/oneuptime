import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725898621366 implements MigrationInterface {
  public name = "MigrationName1725898621366";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "isRecurringEvent" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ALTER COLUMN "startsAt" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ALTER COLUMN "endsAt" DROP NOT NULL`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ALTER COLUMN "endsAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ALTER COLUMN "startsAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "isRecurringEvent"`,
    );
  }
}
