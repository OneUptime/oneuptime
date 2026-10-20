import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The numbers SMS go out from, on a Twilio config - a project's
 * (ProjectCallSMSConfig) and the OneUptime server's own (GlobalConfig): a
 * Twilio number can make calls and send SMS, or only one of the two, and in
 * some countries no one number does both (Singapore's national numbers are
 * voice-only; SMS there need a mobile number). Once a config lists SMS
 * numbers, every SMS goes out from one of them
 * (Types/CallAndSMS/TwilioPhoneNumbers).
 *
 * Two nullable columns and nothing to backfill: empty, as on every config
 * that exists today, means SMS go out from the same numbers as calls - what
 * every config did before - so existing projects and installations send
 * exactly as they did. Adding a nullable column without a default rewrites
 * no rows.
 */
export class AddTwilioSmsPhoneNumbers1804700000000 implements MigrationInterface {
  public name: string = "AddTwilioSmsPhoneNumbers1804700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioSmsPhoneNumbers" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "twilioSmsPhoneNumbers" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioSmsPhoneNumbers"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioSmsPhoneNumbers"`,
    );
  }
}
