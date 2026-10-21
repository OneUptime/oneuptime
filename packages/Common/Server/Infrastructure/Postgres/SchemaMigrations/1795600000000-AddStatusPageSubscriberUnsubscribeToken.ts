import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Unsubscribing without signing in (StatusPageSubscriber.unsubscribeToken,
 * StatusPageSubscriber.unsubscribedAt).
 *
 * - unsubscribeToken: the random secret in each subscriber's unsubscribe
 *   link, {statusPageUrl}/unsubscribe/{id}-{token}. Holding the link is what
 *   lets a subscriber of a private status page unsubscribe without an account
 *   on it. New subscribers get one from StatusPageSubscriberService.
 * - unsubscribedAt: when a subscription was cancelled. Subscriptions
 *   cancelled before this column existed have none - there is no record of
 *   when they were - and are left empty rather than given a made-up date.
 *
 * Only the two nullable columns, which Postgres adds without rewriting the
 * table. Existing subscribers are given their tokens by the
 * BackfillStatusPageSubscriberUnsubscribeTokens data migration, in batches
 * and outside this migration's transaction: one UPDATE of every row here
 * would hold ADD COLUMN's exclusive lock on the table - blocking every
 * notification, subscribe and subscriber list - for as long as it took, and
 * on a large table it would run into the connection's statement timeout and
 * fail the deploy. Until the backfill reaches a subscriber, the first sender
 * to need its link gives it one (StatusPageSubscriberService
 * .ensureUnsubscribeTokens).
 *
 * down() drops both columns; the tokens cannot be recovered afterwards, and
 * every link already sent stops working.
 */
export class AddStatusPageSubscriberUnsubscribeToken1795600000000
  implements MigrationInterface
{
  public name: string = "AddStatusPageSubscriberUnsubscribeToken1795600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "unsubscribedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "unsubscribeToken" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "unsubscribeToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "unsubscribedAt"`,
    );
  }
}
