import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * GHSA-5cr8-vph4-3hrf: expiry, attempt counting and resend throttling for the
 * notification-channel verification codes.
 *
 * Three columns per channel table:
 *
 *   verificationCodeExpiresAt    NULL means there is no live code. Every row
 *                                that exists when this runs gets NULL, which
 *                                is read as expired — so the plaintext codes
 *                                those rows are carrying stop being accepted
 *                                the moment this lands, and their owners
 *                                press "resend" once. That is the intended
 *                                behaviour, not a side effect: those codes
 *                                never expired and were never attempt-limited.
 *
 *   verificationFailedAttempts   The counter that bounds guessing. NOT NULL
 *                                DEFAULT 0 so the atomic increment never has
 *                                to deal with a NULL.
 *
 *   verificationCodeSentAt       Drives the resend cooldown. NULL on existing
 *                                rows, which allows one immediate resend —
 *                                correct, since the code they hold has just
 *                                been invalidated above.
 *
 * The up() also SCRUBS the plaintext codes those rows are still carrying.
 * They are already unusable by the time the scrub runs, but they are live
 * six-digit secrets sitting in a table, its replicas and every backup taken
 * while they were there, and the whole point of the change this migration
 * supports is that the column holds a keyed digest and never the code.
 */

export class MigrationName1787142779538 implements MigrationInterface {
  public name: string = "MigrationName1787142779538";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserCall" ADD "verificationCodeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" ADD "verificationFailedAttempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" ADD "verificationCodeSentAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" ADD "verificationCodeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" ADD "verificationFailedAttempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" ADD "verificationCodeSentAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" ADD "verificationCodeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" ADD "verificationFailedAttempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" ADD "verificationCodeSentAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" ADD "verificationCodeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" ADD "verificationFailedAttempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" ADD "verificationCodeSentAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" ADD "verificationCodeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" ADD "verificationFailedAttempts" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" ADD "verificationCodeSentAt" TIMESTAMP WITH TIME ZONE`,
    );

    /*
     * Replace every stored plaintext code with a value nothing can hash
     * to. Two md5s give the 64 hex characters a real digest has, using
     * only functions core Postgres always has — gen_random_bytes would
     * need pgcrypto, which is not a dependency this schema otherwise has.
     *
     * Restricted to values that look like a code rather than applied
     * blindly, so re-running against a database that has already moved on
     * cannot damage a real digest.
     */
    for (const tableName of [
      "UserEmail",
      "UserSMS",
      "UserCall",
      "UserWhatsApp",
      "UserIncomingCallNumber",
    ]) {
      await queryRunner.query(
        `UPDATE "${tableName}" SET "verificationCode" = md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text) WHERE "verificationCode" ~ '^[0-9]{1,10}$'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" DROP COLUMN "verificationCodeSentAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" DROP COLUMN "verificationFailedAttempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserIncomingCallNumber" DROP COLUMN "verificationCodeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" DROP COLUMN "verificationCodeSentAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" DROP COLUMN "verificationFailedAttempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWhatsApp" DROP COLUMN "verificationCodeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" DROP COLUMN "verificationCodeSentAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" DROP COLUMN "verificationFailedAttempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSMS" DROP COLUMN "verificationCodeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" DROP COLUMN "verificationCodeSentAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" DROP COLUMN "verificationFailedAttempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserEmail" DROP COLUMN "verificationCodeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" DROP COLUMN "verificationCodeSentAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" DROP COLUMN "verificationFailedAttempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserCall" DROP COLUMN "verificationCodeExpiresAt"`,
    );
  }
}
