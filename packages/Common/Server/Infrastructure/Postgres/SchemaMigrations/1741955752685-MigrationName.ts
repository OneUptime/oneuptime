import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1741955752685 implements MigrationInterface {
  public name = "MigrationName1741955752685";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_c223b66a0ca2fa8095cb7a6c7cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP CONSTRAINT "UQ_50235223d7fd7b0c27063bfb08e"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD CONSTRAINT "UQ_50235223d7fd7b0c27063bfb08e" UNIQUE ("twilioPrimaryPhoneNumber")`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_c223b66a0ca2fa8095cb7a6c7cc" UNIQUE ("twilioPrimaryPhoneNumber")`,
    );
  }
}
