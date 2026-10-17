import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A status page's theme: Light, Dark or System (light or dark, as each
 * visitor's device is set). See Types/StatusPage/StatusPageTheme.
 *
 * ADD COLUMN ... DEFAULT 'Light' gives every status page that exists today
 * Light in the same statement - Postgres keeps the default as the value of
 * the rows it adds the column to, without rewriting the table - so each one
 * keeps looking exactly as it does now. Pages made from now on start with
 * System, which StatusPageService.onBeforeCreate sets when a create names no
 * theme; the column's default stays Light, which is also the default the
 * Terraform provider sends.
 */
export class AddStatusPageTheme1803200000000 implements MigrationInterface {
  public name: string = "AddStatusPageTheme1803200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "theme" character varying(100) DEFAULT 'Light'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "StatusPage" DROP COLUMN "theme"`);
  }
}
