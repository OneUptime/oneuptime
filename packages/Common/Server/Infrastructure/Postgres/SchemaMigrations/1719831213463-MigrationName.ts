import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1719831213463 implements MigrationInterface {
  public name = "MigrationName1719831213463";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "isAllProbesDisconnectedFromThisMonitor" boolean DEFAULT false`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "isAllProbesDisconnectedFromThisMonitor"`,
    );
  }
}
