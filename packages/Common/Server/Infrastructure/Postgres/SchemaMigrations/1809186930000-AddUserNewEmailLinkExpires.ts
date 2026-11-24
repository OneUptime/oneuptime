import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * User.newUnverifiedTemporaryEmailExpires (#9908): when the link that
 * confirms a waiting change of email address stops working, kept beside the
 * waiting address so User Profile can say the link has expired and offer
 * to send it again.
 *
 * One nullable column on an existing table, with no default, no index and
 * no key: adding it rewrites nothing and blocks nothing. A change asked for
 * before it has no expiry, and the profile says it is waiting, as before.
 */
export class AddUserNewEmailLinkExpires1809186930000
  implements MigrationInterface
{
  public name: string = "AddUserNewEmailLinkExpires1809186930000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "newUnverifiedTemporaryEmailExpires" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "newUnverifiedTemporaryEmailExpires"`,
    );
  }
}
