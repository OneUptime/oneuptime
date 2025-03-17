import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1718285877004 implements MigrationInterface {
  public name = "MigrationName1718285877004";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotEvent" ADD "pullRequestId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotEvent" ADD "copilotEventStatus" character varying NOT NULL`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotEvent" DROP COLUMN "copilotEventStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotEvent" DROP COLUMN "pullRequestId"`,
    );
  }
}
