import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1732553444010 implements MigrationInterface {
  public name = "MigrationName1732553444010";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ALTER COLUMN "message" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ALTER COLUMN "stackTrace" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ALTER COLUMN "exceptionType" TYPE text`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    // revert changes made in up method - text to varchar
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ALTER COLUMN "message" TYPE varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ALTER COLUMN "stackTrace" TYPE varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ALTER COLUMN "exceptionType" TYPE varchar`,
    );
  }
}
