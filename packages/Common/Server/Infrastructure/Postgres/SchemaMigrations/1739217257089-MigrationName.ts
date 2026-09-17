import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1739217257089 implements MigrationInterface {
  public name = "MigrationName1739217257089";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "scheduledMaintenanceNumber" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_207fe82fd8bdc67bbe1aa0ebf8" ON "ScheduledMaintenance" ("scheduledMaintenanceNumber") `,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_207fe82fd8bdc67bbe1aa0ebf8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "scheduledMaintenanceNumber"`,
    );
  }
}
