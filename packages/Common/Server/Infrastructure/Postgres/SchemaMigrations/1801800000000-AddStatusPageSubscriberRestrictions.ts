import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Who may be a status page's subscriber (Types/StatusPage/
 * SubscriberRestrictions): Only Private Users Can Subscribe
 * (limitSubscribersToPrivateUsers, off) and Allowed Email Domains
 * (allowedSubscriberEmailDomains, empty). Both leave every existing page as
 * it was. Adding a column with a constant default, or none, rewrites no
 * rows.
 */
export class AddStatusPageSubscriberRestrictions1801800000000
  implements MigrationInterface
{
  public name: string = "AddStatusPageSubscriberRestrictions1801800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "limitSubscribersToPrivateUsers" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "allowedSubscriberEmailDomains" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "allowedSubscriberEmailDomains"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "limitSubscribersToPrivateUsers"`,
    );
  }
}
