import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStatusPageLanguageSettings1776971364783
  implements MigrationInterface
{
  public name: string = "AddStatusPageLanguageSettings1776971364783";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "defaultLanguage" character varying DEFAULT 'en'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enabledLanguages" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enabledLanguages"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "defaultLanguage"`,
    );
  }
}
