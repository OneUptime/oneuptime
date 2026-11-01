import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The language a status page subscriber is notified in
 * (StatusPageSubscriber.language): kept at sign-up when the visitor read
 * the page in another language than its default, so their notifications
 * and the messages about their subscription are written in it. A nullable
 * column with no default: adding it rewrites nothing, and every subscriber
 * already signed up has none, so they keep being written in the page's
 * default language (Server/Utils/StatusPage/SubscriberLanguage).
 */
export class AddStatusPageSubscriberLanguage1808726000000
  implements MigrationInterface
{
  public name: string = "AddStatusPageSubscriberLanguage1808726000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "language" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "language"`,
    );
  }
}
