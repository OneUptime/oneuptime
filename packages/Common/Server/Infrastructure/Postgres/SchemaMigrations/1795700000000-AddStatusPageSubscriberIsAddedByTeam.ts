import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * StatusPageSubscriber.isAddedByTeam: whether the status page's team added a
 * subscriber (from the dashboard, with an API key or by a workflow) rather
 * than the subscriber signing up on the status page. It decides whether the
 * page's owners are told when the subscriber unsubscribes itself - Created
 * By cannot, because an API key's or a workflow's create carries no user.
 *
 * Postgres 11 and later add a NOT NULL column with a constant default without
 * rewriting the table. Subscribers that already exist are marked from Created
 * By by the BackfillStatusPageSubscriberUnsubscribeTokens data migration, in
 * batches outside this transaction (see
 * 1795600000000-AddStatusPageSubscriberUnsubscribeToken for why); until it
 * reaches one, StatusPageSubscriberService reads Created By as well.
 */
export class AddStatusPageSubscriberIsAddedByTeam1795700000000
  implements MigrationInterface
{
  public name: string = "AddStatusPageSubscriberIsAddedByTeam1795700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "isAddedByTeam" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "isAddedByTeam"`,
    );
  }
}
