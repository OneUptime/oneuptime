import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725975175669 implements MigrationInterface {
  public name = "MigrationName1725975175669";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "sendSubscriberNotificationsOnBeforeTheEvent" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "nextSubscriberNotificationBeforeTheEventAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_37b2094ce25cc62b4766a7d3b1" ON "ScheduledMaintenance" ("nextSubscriberNotificationBeforeTheEventAt") `,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_37b2094ce25cc62b4766a7d3b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "nextSubscriberNotificationBeforeTheEventAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "sendSubscriberNotificationsOnBeforeTheEvent"`,
    );
  }
}
