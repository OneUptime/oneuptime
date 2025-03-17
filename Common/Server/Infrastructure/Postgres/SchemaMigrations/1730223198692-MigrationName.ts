import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1730223198692 implements MigrationInterface {
  public name = "MigrationName1730223198692";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP COLUMN "lastMonitoringLog"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD "monitorStepProbeResponse" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD "isInQueue" boolean DEFAULT true`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP COLUMN "isInQueue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP COLUMN "monitorStepProbeResponse"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD "lastMonitoringLog" jsonb`,
    );
  }
}
