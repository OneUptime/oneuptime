import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736787495707 implements MigrationInterface {
  public name = "MigrationName1736787495707";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ALTER COLUMN "moreInformationInMarkdown" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ALTER COLUMN "moreInformationInMarkdown" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ALTER COLUMN "moreInformationInMarkdown" DROP NOT NULL`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ALTER COLUMN "moreInformationInMarkdown" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ALTER COLUMN "moreInformationInMarkdown" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ALTER COLUMN "moreInformationInMarkdown" SET NOT NULL`,
    );
  }
}
