import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The owners' Created notification of an incident or alert is held for its
 * owners while its create adds them (CreatedNotificationHold, #7210). The
 * hold is now written on the record too (issue #7571):
 *
 *   - Incident / Alert.createdNotificationHeldAt - while the notification is
 *     held, when the hold began. Cleared when the hold is let go, and when
 *     the Created job takes the record; a hold nobody lets go - the process
 *     that made the record stopped - is taken by the job once it is a few
 *     minutes old, so its owners are told after all. Empty on every
 *     existing record: none of them is held by it.
 *
 * Generated with npm run generate-postgres-migration. The columns are
 * nullable with no default, so each is added without rewriting its table;
 * nothing is backfilled. Their indexes are on tables projects already have
 * rows in, so they are built online, in the migration registered right
 * after this one: AddCreatedNotificationHeldAtIndexes1809174710000.
 */
export class AddCreatedNotificationHeldAt1809174700000
  implements MigrationInterface
{
  public name: string = "AddCreatedNotificationHeldAt1809174700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "createdNotificationHeldAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "createdNotificationHeldAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "createdNotificationHeldAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "createdNotificationHeldAt"`,
    );
  }
}
