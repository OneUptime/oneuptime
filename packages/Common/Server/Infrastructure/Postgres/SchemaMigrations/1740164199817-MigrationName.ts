import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1740164199817 implements MigrationInterface {
  public name = "MigrationName1740164199817";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "isVisibleOnStatusPage" boolean DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "isVisibleOnStatusPage" boolean DEFAULT true`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "isVisibleOnStatusPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "isVisibleOnStatusPage"`,
    );
  }
}
