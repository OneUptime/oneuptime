import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1739569321582 implements MigrationInterface {
  public name = "MigrationName1739569321582";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "postUpdatesToWorkspaceChannelName" TO "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" RENAME COLUMN "postUpdatesToWorkspaceChannelName" TO "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "postUpdatesToWorkspaceChannelName" TO "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "postUpdatesToWorkspaceChannels" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "postUpdatesToWorkspaceChannels" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "postUpdatesToWorkspaceChannels" jsonb`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "postUpdatesToWorkspaceChannels" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "postUpdatesToWorkspaceChannels" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "postUpdatesToWorkspaceChannels" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "postUpdatesToWorkspaceChannels" TO "postUpdatesToWorkspaceChannelName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" RENAME COLUMN "postUpdatesToWorkspaceChannels" TO "postUpdatesToWorkspaceChannelName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "postUpdatesToWorkspaceChannels" TO "postUpdatesToWorkspaceChannelName"`,
    );
  }
}
