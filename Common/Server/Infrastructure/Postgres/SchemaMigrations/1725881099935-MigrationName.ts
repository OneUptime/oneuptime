import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725881099935 implements MigrationInterface {
  public name = "MigrationName1725881099935";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" ADD "recurringInterval" jsonb`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplate" DROP COLUMN "recurringInterval"`,
    );
  }
}
