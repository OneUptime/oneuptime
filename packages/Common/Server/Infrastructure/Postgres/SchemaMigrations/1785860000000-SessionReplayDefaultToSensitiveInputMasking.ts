import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Retune the session replay defaults so a freshly created application
 * produces a recording somebody can debug from.
 *
 *   - masking mode: MaskAllText -> MaskSensitiveInputsOnly. The wireframe
 *     mode is still available and is still the strictest; it is simply no
 *     longer the starting point. Passwords and declared card /
 *     one-time-code fields stay masked in every mode.
 *   - capture user identity: off -> on. Support cannot find "the session
 *     this named customer is complaining about" without it.
 *   - capture country: off -> on. Country only; the end user's IP address
 *     is never stored in either state.
 *
 * The origin allowlist is deliberately NOT touched here: an empty list
 * already means "any origin" in SessionReplayGateCache.isOriginAllowed,
 * so allow-all is already the behaviour for a new application. Only the
 * copy describing it was wrong.
 *
 * On the backfill below. ALTER COLUMN SET DEFAULT only reaches rows
 * inserted afterwards, so without it every application that already
 * exists keeps the strict values and nothing observably changes for the
 * installs that actually have traffic. The UPDATEs are therefore scoped
 * to rows that still hold the PREVIOUS DEFAULT, which is the closest a
 * migration can get to "was never configured" - the schema keeps no
 * record of whether a value was chosen or inherited. An operator who
 * deliberately selected MaskAllText, or deliberately left identity and
 * country capture off, is moved to the new defaults by this and has to
 * set them back.
 *
 * That is a privacy-affecting change applied without asking, so it is
 * called out in the changelog rather than only here. It is acceptable at
 * this point only because these columns are days old and no release has
 * carried them yet; a later migration must not reuse this reasoning.
 */
export class SessionReplayDefaultToSensitiveInputMasking1785860000000
  implements MigrationInterface
{
  public name = "SessionReplayDefaultToSensitiveInputMasking1785860000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayMaskingMode" SET DEFAULT 'MaskSensitiveInputsOnly'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureUserIdentity" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureGeo" SET DEFAULT true`,
    );

    await queryRunner.query(
      `UPDATE "RumApplication" SET "sessionReplayMaskingMode" = 'MaskSensitiveInputsOnly' WHERE "sessionReplayMaskingMode" = 'MaskAllText'`,
    );
    await queryRunner.query(
      `UPDATE "RumApplication" SET "sessionReplayCaptureUserIdentity" = true WHERE "sessionReplayCaptureUserIdentity" = false`,
    );
    await queryRunner.query(
      `UPDATE "RumApplication" SET "sessionReplayCaptureGeo" = true WHERE "sessionReplayCaptureGeo" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Defaults only. The backfill is not reversed: MaskSensitiveInputsOnly
     * rows are indistinguishable from ones an operator chose after this
     * migration ran, and reverting them would mask a recording policy the
     * operator may now be relying on.
     */
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureGeo" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureUserIdentity" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayMaskingMode" SET DEFAULT 'MaskAllText'`,
    );
  }
}
