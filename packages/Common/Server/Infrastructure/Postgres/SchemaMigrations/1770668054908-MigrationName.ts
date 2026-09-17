import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1770668054908 implements MigrationInterface {
  public name = "MigrationName1770668054908";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ALTER COLUMN "groupByMonitor" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ALTER COLUMN "groupByMonitor" SET DEFAULT false`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ALTER COLUMN "groupByMonitor" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ALTER COLUMN "groupByMonitor" SET DEFAULT true`,
    );
  }
}
