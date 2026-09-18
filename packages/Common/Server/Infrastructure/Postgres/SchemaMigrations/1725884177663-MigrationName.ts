import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725884177663 implements MigrationInterface {
  public name = "MigrationName1725884177663";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP CONSTRAINT "FK_aea47be8b8af9673e9639e7dae3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aea47be8b8af9673e9639e7dae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "currentScheduledMaintenanceStateId"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "currentScheduledMaintenanceStateId" uuid NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aea47be8b8af9673e9639e7dae" ON "ScheduledMaintenanceTemplate" ("currentScheduledMaintenanceStateId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD CONSTRAINT "FK_aea47be8b8af9673e9639e7dae3" FOREIGN KEY ("currentScheduledMaintenanceStateId") REFERENCES "ScheduledMaintenanceState"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
