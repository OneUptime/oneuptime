import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1731435267537 implements MigrationInterface {
  public name = "MigrationName1731435267537";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01ac1d1ef9e72aeb6dac6575dd"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_01ac1d1ef9e72aeb6dac6575dd" ON "MonitorStatusTimeline" ("rootCause") `,
    );
  }
}
