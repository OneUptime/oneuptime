import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A status page's Send Notifications to Subscribers (StatusPage.
 * sendSubscriberNotifications): the one switch for everything it tells its
 * subscribers (Types/StatusPage/SubscriberNotificationsSwitch). On for every
 * existing page, so the upgrade sends exactly what it sent before. Adding a
 * column with a constant default rewrites no rows.
 */
export class AddStatusPageSubscriberNotificationsSwitch1801850000000
  implements MigrationInterface
{
  public name: string =
    "AddStatusPageSubscriberNotificationsSwitch1801850000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "sendSubscriberNotifications" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "sendSubscriberNotifications"`,
    );
  }
}
