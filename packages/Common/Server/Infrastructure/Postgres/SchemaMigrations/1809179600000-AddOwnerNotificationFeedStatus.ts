import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Whether the feed item an owner notification writes on its record - the
 * entry naming whom it reached - is written yet (issue #8510):
 *
 *   - OwnerNotificationDelivery.feedStatus - Pending while the feed item is
 *     to write, Written once it is, NotWritten when it never will be; the
 *     same on every row of a notification. A run that told the last owner
 *     and stopped before the feed item leaves it Pending, and a later run
 *     writes it (OwnerNotificationDeliveries.resume).
 *
 * Empty on every existing row, which a later run never takes up: those
 * notifications' feed items were written, or lost, before this was kept.
 *
 * Generated with npm run generate-postgres-migration. The column is nullable
 * with no default, so it is added without rewriting the table; nothing is
 * backfilled. Its index is on a table that already holds rows, so it is
 * built online, in the migration registered right after this one:
 * AddOwnerNotificationFeedStatusIndex1809179610000.
 */
export class AddOwnerNotificationFeedStatus1809179600000
  implements MigrationInterface
{
  public name: string = "AddOwnerNotificationFeedStatus1809179600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OwnerNotificationDelivery" ADD "feedStatus" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OwnerNotificationDelivery" DROP COLUMN "feedStatus"`,
    );
  }
}
