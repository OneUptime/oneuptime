import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Numbers for SMS on a Twilio config - a project's (ProjectCallSMSConfig)
 * and the OneUptime server's own (GlobalConfig): a Twilio number can make
 * calls and send SMS, or only one of the two, and in some countries no one
 * number does both (in Singapore, calls need a national number and SMS a
 * mobile number). When set, SMS go out from these instead of the primary and
 * secondary numbers (Types/CallAndSMS/TwilioPhoneNumbers).
 *
 * Four nullable columns and nothing to backfill: empty, as on every config
 * that exists today, means SMS go out from the same numbers as calls - what
 * every config did before - so existing projects and installations send
 * exactly as they did. Adding a nullable column without a default rewrites
 * no rows.
 */
export class AddTwilioSmsPhoneNumbers1804700000000 implements MigrationInterface {
  public name: string = "AddTwilioSmsPhoneNumbers1804700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioSmsPhoneNumber" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioSmsSecondaryPhoneNumbers" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "twilioSmsPhoneNumber" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "twilioSmsSecondaryPhoneNumbers" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioSmsSecondaryPhoneNumbers"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioSmsPhoneNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioSmsSecondaryPhoneNumbers"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioSmsPhoneNumber"`,
    );
  }
}
