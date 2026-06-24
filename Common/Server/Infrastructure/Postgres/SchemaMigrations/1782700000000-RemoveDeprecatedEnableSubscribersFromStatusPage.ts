import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Drops the deprecated StatusPage.enableSubscribers column.
 *
 * enableSubscribers was the old master "Can subscribers subscribe?" toggle,
 * superseded by showSubscriberPageOnStatusPage + the per-channel
 * enableEmailSubscribers / enableSmsSubscribers / enableSlackSubscribers flags.
 * It was already marked deprecated in the model and gated nothing at runtime —
 * its only consumer was a dashboard warning banner that wrongly claimed "no
 * notifications will be sent" when it was off. That banner has been corrected,
 * so this column now has no readers and is safe to remove.
 *
 * NOTE: the SQL below is exactly what `npm run generate-postgres-migration`
 * produced for this model change; the generator additionally emitted unrelated
 * cosmetic JSON-default churn on OnCallDutyPolicyScheduleLayer, which was
 * stripped so this migration only does the intended drop.
 */
export class RemoveDeprecatedEnableSubscribersFromStatusPage1782700000000
  implements MigrationInterface
{
  public name = "RemoveDeprecatedEnableSubscribersFromStatusPage1782700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableSubscribers"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableSubscribers" boolean NOT NULL DEFAULT true`,
    );
  }
}
