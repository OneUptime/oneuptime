import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A private status page's sign-in links (#5600, Types/StatusPage/
 * StatusPageMagicLink): StatusPage.enableMagicLinkLogin, on for every page -
 * the ones that exist too - until its team turns it off, and the latest
 * link a private user was emailed, StatusPagePrivateUser.magicLinkToken (its
 * hash) and magicLinkExpires, empty until one is asked for. A column with a
 * constant default is added without rewriting the table.
 */
export class AddStatusPageMagicLinkLogin1808920000000
  implements MigrationInterface
{
  public name: string = "AddStatusPageMagicLinkLogin1808920000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableMagicLinkLogin" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ADD "magicLinkToken" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ADD "magicLinkExpires" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" DROP COLUMN "magicLinkExpires"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" DROP COLUMN "magicLinkToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableMagicLinkLogin"`,
    );
  }
}
