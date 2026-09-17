import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725618842598 implements MigrationInterface {
  public name = "MigrationName1725618842598";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ALTER COLUMN "endAnnouncementAt" DROP NOT NULL`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ALTER COLUMN "endAnnouncementAt" SET NOT NULL`,
    );
  }
}
