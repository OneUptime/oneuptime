import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725357719072 implements MigrationInterface {
  public name = "MigrationName1725357719072";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD "copilotActionProp" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD "statusMessage" text`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP COLUMN "statusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP COLUMN "copilotActionProp"`,
    );
  }
}
