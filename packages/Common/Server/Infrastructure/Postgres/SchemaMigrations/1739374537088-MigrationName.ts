import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1739374537088 implements MigrationInterface {
  public name = "MigrationName1739374537088";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "postUpdatesToSlackChannelId" TO "postUpdatesToWorkspaceChannelName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" RENAME COLUMN "postUpdatesToSlackChannelId" TO "postUpdatesToWorkspaceChannelName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "postUpdatesToSlackChannelId" TO "postUpdatesToWorkspaceChannelName"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "postUpdatesToWorkspaceChannelName" TO "postUpdatesToSlackChannelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" RENAME COLUMN "postUpdatesToWorkspaceChannelName" TO "postUpdatesToSlackChannelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "postUpdatesToWorkspaceChannelName" TO "postUpdatesToSlackChannelId"`,
    );
  }
}
