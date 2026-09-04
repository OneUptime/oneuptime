import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Record every session by default, not only the ones that broke.
 *
 *   - capture trigger: OnErrorOrFrustration -> Always
 *   - sample percentage: 0 -> 100
 *
 * The two together were the reason a fresh install looked broken. The old
 * pair means the recorder holds a rolling in-memory buffer and uploads
 * NOTHING until an error, an unhandled rejection, a 5xx or a frustration
 * signal fires, so the session list filled up with rows carrying signals
 * and nothing else - and a session with no footage is indistinguishable
 * from a feature that does not work. Replay is also simply useful on the
 * sessions where nothing threw: the checkout nobody completed, the form
 * everybody abandoned, the support call about a page that "looked wrong".
 *
 * On the backfill. ALTER COLUMN SET DEFAULT only reaches rows inserted
 * afterwards, so on its own this would change nothing for any install
 * that already has applications - which is every install that reported
 * the problem. The UPDATE is therefore scoped to rows still holding BOTH
 * previous defaults, which is the closest a migration can get to "was
 * never configured": the schema keeps no record of whether a value was
 * chosen or inherited. Requiring both to match is what protects a
 * deliberate configuration - anyone who set a sample percentage, or who
 * chose Always, keeps exactly what they set.
 *
 * This increases how much end-user data an existing install records and
 * stores, which is not a change to make quietly, so it is called out in
 * the changelog as well as here. The controls that bound it are
 * unchanged and all still apply: the project-wide master switch, the
 * per-application toggle, masking (sensitive inputs are masked in every
 * mode), consent mode, and a 7-day default retention.
 */
export class SessionReplayRecordEverySessionByDefault1791400000000
  implements MigrationInterface
{
  public name = "SessionReplayRecordEverySessionByDefault1791400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureTrigger" SET DEFAULT 'Always'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplaySamplePercentage" SET DEFAULT 100`,
    );

    await queryRunner.query(
      `UPDATE "RumApplication" SET "sessionReplayCaptureTrigger" = 'Always', "sessionReplaySamplePercentage" = 100 WHERE "sessionReplayCaptureTrigger" = 'OnErrorOrFrustration' AND "sessionReplaySamplePercentage" = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Defaults only. The backfilled rows are indistinguishable from ones
     * an operator chose after this migration ran, and moving them back
     * would silently stop recording sessions somebody may now be relying
     * on being able to watch.
     */
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplaySamplePercentage" SET DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayCaptureTrigger" SET DEFAULT 'OnErrorOrFrustration'`,
    );
  }
}
