import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1737141420441 implements MigrationInterface {
  public name = "MigrationName1737141420441";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "triggeredByAlertId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "alertSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD "triggeredByAlertId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "triggeredByAlertId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_90119ec7f77fa2efd82261e0448"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ALTER COLUMN "triggeredByIncidentId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_eeb0dd05d1dec542c3de5fb5074"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ALTER COLUMN "triggeredByIncidentId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_58a44736718a5ec4fe41526289a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "triggeredByIncidentId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30358ab25e4c6c9ad72e74f201" ON "OnCallDutyPolicyExecutionLogTimeline" ("triggeredByAlertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d73339f6c26fd6ebd0326badcd" ON "UserNotificationRule" ("alertSeverityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42d9916277fcbefa0cdd3904c6" ON "UserOnCallLogTimeline" ("triggeredByAlertId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_90119ec7f77fa2efd82261e0448" FOREIGN KEY ("triggeredByIncidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_30358ab25e4c6c9ad72e74f201c" FOREIGN KEY ("triggeredByAlertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_d73339f6c26fd6ebd0326badcd7" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_eeb0dd05d1dec542c3de5fb5074" FOREIGN KEY ("triggeredByIncidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_0ee3711cdc64957845d9d028c31" FOREIGN KEY ("triggeredByAlertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_58a44736718a5ec4fe41526289a" FOREIGN KEY ("triggeredByIncidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_42d9916277fcbefa0cdd3904c63" FOREIGN KEY ("triggeredByAlertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_42d9916277fcbefa0cdd3904c63"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_58a44736718a5ec4fe41526289a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_0ee3711cdc64957845d9d028c31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_eeb0dd05d1dec542c3de5fb5074"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_d73339f6c26fd6ebd0326badcd7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_30358ab25e4c6c9ad72e74f201c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_90119ec7f77fa2efd82261e0448"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42d9916277fcbefa0cdd3904c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d73339f6c26fd6ebd0326badcd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30358ab25e4c6c9ad72e74f201"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "triggeredByIncidentId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_58a44736718a5ec4fe41526289a" FOREIGN KEY ("triggeredByIncidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ALTER COLUMN "triggeredByIncidentId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_eeb0dd05d1dec542c3de5fb5074" FOREIGN KEY ("triggeredByIncidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ALTER COLUMN "triggeredByIncidentId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_90119ec7f77fa2efd82261e0448" FOREIGN KEY ("triggeredByIncidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "triggeredByAlertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP COLUMN "triggeredByAlertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "alertSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "triggeredByAlertId"`,
    );
  }
}
