import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A person's language, as part of their account (Types/UserLanguage).
 *
 * "User"."language" is the language OneUptime writes the person's on-call
 * pages in - email, text, push, Telegram and their own chat messages - and
 * the Dashboard starts in on every browser they sign in on. Nullable and
 * with no default: everybody starts with none, which is English for what
 * OneUptime sends and the browser's language on the Dashboard, exactly as
 * before. Adding a nullable column without a default rewrites no row.
 *
 * Generated with npm run generate-postgres-migration, then numbered after
 * the last registered migration (and outside the range another session's
 * migrations take, 18089951xxxxx and 18089952xxxxx).
 */
export class AddUserLanguage1808995300000 implements MigrationInterface {
  public name: string = "AddUserLanguage1808995300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "language" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "language"`);
  }
}
