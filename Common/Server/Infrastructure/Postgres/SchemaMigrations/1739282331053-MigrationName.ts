import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1739282331053 implements MigrationInterface {
  public name = "MigrationName1739282331053";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "postUpdatesToSlackChannelId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "postUpdatesToSlackChannelId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "postUpdatesToSlackChannelId" character varying(100)`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "postUpdatesToSlackChannelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "postUpdatesToSlackChannelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "postUpdatesToSlackChannelId"`,
    );
  }
}
