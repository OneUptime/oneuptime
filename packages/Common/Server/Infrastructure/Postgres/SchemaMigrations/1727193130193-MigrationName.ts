import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1727193130193 implements MigrationInterface {
  public name = "MigrationName1727193130193";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ALTER COLUMN "createdAt" TYPE TIMESTAMP`,
    );
  }
}
