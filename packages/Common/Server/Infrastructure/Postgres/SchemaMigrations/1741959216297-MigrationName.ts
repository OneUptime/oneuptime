import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1741959216297 implements MigrationInterface {
  public name = "MigrationName1741959216297";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "overridedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_356ab0badd7e70f4d25045dcbf3" FOREIGN KEY ("overridedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_356ab0badd7e70f4d25045dcbf3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "overridedByUserId"`,
    );
  }
}
