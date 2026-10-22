import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * What a Twilio config is used for - calls and SMS, SMS only or calls only
 * (Types/CallAndSMS/TwilioConfigUse) - on a project's config
 * (ProjectCallSMSConfig.usedFor) and on the OneUptime server's own
 * (GlobalConfig.twilioUsedFor). A config used for SMS only needs no number
 * to make calls from and makes no calls; one used for calls only sends no
 * SMS.
 *
 * Every existing config is used for calls and SMS, as it always was: the
 * columns are NOT NULL with that DEFAULT, so every existing row reads it the
 * moment the column is added, and sends exactly as it did. A constant
 * default is stored once, in the catalog: adding the column rewrites no
 * rows.
 */
export class AddTwilioConfigUsedFor1806100000000 implements MigrationInterface {
  public name: string = "AddTwilioConfigUsedFor1806100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "usedFor" character varying(100) NOT NULL DEFAULT 'Calls and SMS'`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "twilioUsedFor" character varying(100) NOT NULL DEFAULT 'Calls and SMS'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioUsedFor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "usedFor"`,
    );
  }
}
