import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The channels each step of an on-call run paged its person by - a phone
 * call, an SMS, an email, a push notification - kept on the step itself,
 * for the run's Execution Timeline to show as "Notified Via" (#6585). The
 * person's own notifications say the same, but only that person can read
 * them. A nullable jsonb column with no default: no row is rewritten, and
 * steps written before it read as not set - the Dashboard shows nothing
 * for them, rather than claiming they reached nobody.
 */
export class AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850
  implements MigrationInterface
{
  public name: string =
    "AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "notificationChannels" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "notificationChannels"`,
    );
  }
}
