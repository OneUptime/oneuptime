import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What a monitor secret holds (issue #9703): Text, a value filled in as
 * written, or TOTP, a two-factor seed the probe makes one-time codes from.
 *
 * The column default is the only behaviour there was, so every existing
 * secret becomes Text and is filled in exactly as before. Adding a column
 * with a constant default rewrites nothing in Postgres 11 and later, and
 * MonitorSecret is a small table.
 */
export class AddMonitorSecretType1809184930000 implements MigrationInterface {
  public name: string = "AddMonitorSecretType1809184930000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" ADD "secretType" character varying(100) NOT NULL DEFAULT 'Text'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorSecret" DROP COLUMN "secretType"`,
    );
  }
}
