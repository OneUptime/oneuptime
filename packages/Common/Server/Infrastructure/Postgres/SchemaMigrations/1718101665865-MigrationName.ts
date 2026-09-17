import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1718101665865 implements MigrationInterface {
  public name = "MigrationName1718101665865";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ALTER COLUMN "fromNumber" DROP NOT NULL`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ALTER COLUMN "fromNumber" SET NOT NULL`,
    );
  }
}
