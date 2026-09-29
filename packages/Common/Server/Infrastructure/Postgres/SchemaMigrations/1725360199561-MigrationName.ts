import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725360199561 implements MigrationInterface {
  public name = "MigrationName1725360199561";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CopilotAction" ADD "logs" text`);
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CopilotAction" DROP COLUMN "logs"`);
  }
}
