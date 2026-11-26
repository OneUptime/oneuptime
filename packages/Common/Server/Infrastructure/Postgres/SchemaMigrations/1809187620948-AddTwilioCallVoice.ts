import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * The voice OneUptime's phone calls speak with (#10948): one of a short list
 * of neural Amazon Polly and Google voices (Types/Call/CallVoice), for the
 * calls through a project's own Twilio config
 * (ProjectCallSMSConfig.twilioCallVoice) and through the server's own
 * account (GlobalConfig.twilioCallVoice).
 *
 * Nullable columns with no default: adding them rewrites no row and holds
 * each table's lock for an instant (Docs/migrations/README.md). Nothing is
 * backfilled: empty is the Twilio account's default voice, so every call
 * speaks exactly as it did until an admin chooses a voice.
 */
export class AddTwilioCallVoice1809187620948 implements MigrationInterface {
  public name: string = "AddTwilioCallVoice1809187620948";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioCallVoice" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "twilioCallVoice" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioCallVoice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioCallVoice"`,
    );
  }
}
