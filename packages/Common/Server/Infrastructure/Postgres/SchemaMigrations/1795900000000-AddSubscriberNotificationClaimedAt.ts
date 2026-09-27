import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * When a subscriber job claimed the 'incident created', 'postmortem' and
 * 'episode created' notifications (SubscriberNotificationClaim), for the
 * sweeper (StatusPageSubscriber:TimeoutStuckNotifications) to time an
 * interrupted send from. It used updatedAt, which other code writes on a
 * schedule while an incident or episode is open - the owners' reminders,
 * state changes, incidents joining an episode - so a send cut off by a
 * redeploy could stay In progress until the incident went quiet.
 *
 * Nullable timestamps with no default: adding them rewrites nothing. A row
 * claimed before they existed has none, and the sweeper times it from
 * updatedAt, as before.
 */
export class AddSubscriberNotificationClaimedAt1795900000000
  implements MigrationInterface
{
  public name: string = "AddSubscriberNotificationClaimedAt1795900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "subscriberNotificationClaimedAtOnEpisodeCreated" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "subscriberNotificationClaimedAtOnIncidentCreated" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "subscriberNotificationClaimedAtOnPostmortemPublished" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationClaimedAtOnPostmortemPublished"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationClaimedAtOnIncidentCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "subscriberNotificationClaimedAtOnEpisodeCreated"`,
    );
  }
}
