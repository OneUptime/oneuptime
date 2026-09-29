import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1718126316684 implements MigrationInterface {
  public name = "MigrationName1718126316684";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceRepository" ADD "enablePullRequests" boolean NOT NULL DEFAULT true`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceRepository" DROP COLUMN "enablePullRequests"`,
    );
  }
}
