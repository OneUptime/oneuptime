import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1720805596648 implements MigrationInterface {
  public name = "MigrationName1720805596648";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD "isSetupPullRequest" boolean`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP COLUMN "isSetupPullRequest"`,
    );
  }
}
