import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Corrects the otpauth:// URLs behind every un-scanned 2FA QR code.
 *
 * OneUptime used to build those URLs with `algorithm=SHA256`. Google
 * Authenticator and Microsoft Authenticator parse the URL, ignore that
 * parameter, and compute SHA1 — so the app displayed six digits the server
 * could never agree with and enrolment failed with "Invalid code" forever, no
 * matter how many fresh codes the user tried.
 *
 * This migration is NOT what unsticks those users. The code fix already does:
 * verification tries SHA1 first, which is what those apps were emitting all
 * along, so a pending enrolment starts working the moment the new build ships
 * and the stored URL is never consulted during verification. What this fixes
 * is the URL still claiming something untrue, which matters for the apps that
 * DO honour the parameter and do not implement SHA256 — some hardware tokens,
 * older FreeOTP builds — and which would otherwise keep minting new rows that
 * depend on the SHA256 fallback long after the fallback should have gone.
 *
 * Only the algorithm label changes; the secret is untouched, so an app that
 * already scanned the old QR keeps working. Verification accepts SHA1 and
 * legacy SHA256 either way (see Common/Server/Utils/TotpAuth.ts), which is
 * what makes rewriting the label safe rather than a second lockout.
 *
 * Verified rows are deliberately left alone. Their QR code is never shown
 * again — the Verify action only exists for unverified entries — so the stored
 * URL is a record of what the user's authenticator actually holds, and that
 * record should stay accurate.
 */
export class FixTotpOtpUrlAlgorithm1787700000000 implements MigrationInterface {
  public name = "FixTotpOtpUrlAlgorithm1787700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "UserTotpAuth" SET "twoFactorOtpUrl" = REPLACE("twoFactorOtpUrl", 'algorithm=SHA256', 'algorithm=SHA1') WHERE "isVerified" = false AND "twoFactorOtpUrl" LIKE '%algorithm=SHA256%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "UserTotpAuth" SET "twoFactorOtpUrl" = REPLACE("twoFactorOtpUrl", 'algorithm=SHA1', 'algorithm=SHA256') WHERE "isVerified" = false AND "twoFactorOtpUrl" LIKE '%algorithm=SHA1%'`,
    );
  }
}
