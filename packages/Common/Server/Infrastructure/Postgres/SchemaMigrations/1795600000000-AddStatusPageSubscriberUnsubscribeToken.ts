import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Unsubscribing without signing in (StatusPageSubscriber.unsubscribeToken,
 * StatusPageSubscriber.unsubscribedAt).
 *
 * - unsubscribeToken: the random secret in each subscriber's unsubscribe
 *   link, {statusPageUrl}/unsubscribe/{id}-{token}. Holding the link is what
 *   lets a subscriber of a private status page unsubscribe without an account
 *   on it. New subscribers get one from StatusPageSubscriberService; every
 *   existing subscriber is given one here, so the first notification after
 *   the upgrade already carries a working link.
 * - unsubscribedAt: when a subscription was cancelled. Subscriptions
 *   cancelled before this column existed have none - there is no record of
 *   when they were - and are left empty rather than given a made-up date.
 *
 * The backfill draws the token from two random UUIDs with their dashes
 * removed: 64 lowercase hex characters, the shape
 * StatusPageSubscriberUnsubscribeToken generates (32 random bytes as hex),
 * so a backfilled link and a new one are indistinguishable. gen_random_uuid()
 * is built into Postgres 13 and later and draws from the server's
 * cryptographically strong random source, and it is volatile, so each row
 * gets its own value. Soft-deleted rows are included: a restored subscriber
 * must not come back without a token.
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
    await queryRunner.query(
      `UPDATE "StatusPageSubscriber" SET "unsubscribeToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') WHERE "unsubscribeToken" IS NULL`,
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
