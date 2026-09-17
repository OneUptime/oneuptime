import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1737715240684 implements MigrationInterface {
  public name = "MigrationName1737715240684";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "subscriberEmailNotificationFooterText"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "subscriberEmailNotificationFooterText" text`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "subscriberEmailNotificationFooterText"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "subscriberEmailNotificationFooterText" character varying(100)`,
    );
  }
}
