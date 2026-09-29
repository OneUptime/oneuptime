import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1719228104620 implements MigrationInterface {
  public name = "MigrationName1719228104620";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    const doesTableExist: boolean = await queryRunner.hasTable("CopilotEvent");
    if (doesTableExist) {
      await queryRunner.query(`DROP TABLE "CopilotEvent"`);
    }
  }

  @CaptureSpan()
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // we dont use this table anymore.
  }
}
