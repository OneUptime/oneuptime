import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Signing in to OneUptime with a link emailed to the account (Types/Accounts/
 * MagicLink): the latest link an account was sent, User.magicLinkToken (its
 * hash) and magicLinkExpires, empty until one is asked for; and the master
 * admins' switch that turns them off, GlobalConfig.disableMagicLinkLogin,
 * false - sign-in links on - for the server that exists too. Columns that
 * are nullable or have a constant default are added without rewriting the
 * table.
 */
export class AddMagicLinkLogin1808992650000 implements MigrationInterface {
  public name: string = "AddMagicLinkLogin1808992650000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "magicLinkToken" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "magicLinkExpires" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "disableMagicLinkLogin" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "disableMagicLinkLogin"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "magicLinkExpires"`,
    );
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "magicLinkToken"`);
  }
}
