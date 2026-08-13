import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Schema for the on-call notification fallback: a page routed to a responder who
 * has no notification rule matching the event's rule type and severity now goes
 * out on whatever verified method they do have, instead of dead-ending with an
 * Error status nobody reads.
 *
 * Hand-written rather than emitted by `npm run generate-postgres-migration`. The
 * generator diffs the entire entity set against the live database, and several
 * models in this worktree are being changed in parallel, so a generated file
 * would have swept up unrelated in-flight columns. The statements below are
 * exactly what the generator produces for these column definitions — compare
 * `enableWhatsAppNotifications` (1759943124812) and `enableTelegramNotifications`
 * (1776761171349) for the Project booleans, and `isFeatureFlagMonitorGroupsEnabled`
 * in the InitialMigration for the nullable-with-default shape.
 *
 * UserNotificationRule.isOptOut is nullable because a rule that predates this
 * column is simply not an opt-out; the DEFAULT covers rows written afterwards and
 * the backfill for existing rows is the default itself. The two Project columns
 * are NOT NULL like every other project boolean, so existing projects land on
 * false: the fallback on, and no owner notification recorded as sent yet.
 *
 * UserOnCallLogTimeline.userNotificationRuleId is dropped to NULL-able because
 * the fallback delivers through a UserNotificationRule constructed in memory and
 * never saved — there is deliberately no stored rule behind a fallback page, so
 * there is no id to record. It has been NOT NULL since the InitialMigration
 * (1717605043663), which means that without this statement every fallback insert
 * fails its required-field check and the feature cannot deliver anything at all.
 * The foreign key on the column stays as it is: Postgres does not check a FK when
 * the referencing column is NULL, so a NULL row is legal against the existing
 * constraint and no index or constraint needs rebuilding.
 */
export class AddOnCallNotificationFallbackColumns1786800000000
  implements MigrationInterface
{
  public name: string = "AddOnCallNotificationFallbackColumns1786800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "isOptOut" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "disableOnCallNotificationFallback" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "onCallFallbackUsedNotificationSentToOwners" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "userNotificationRuleId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Restoring NOT NULL is only possible once nothing violates it, and after the
     * fallback has run there will be timeline rows with a NULL rule id — one per
     * fallback page delivered. A bare `SET NOT NULL` would abort the whole
     * rollback on the first such row, so the rows are deleted first.
     *
     * This deletion is destructive and worth understanding before running down().
     * What it removes is exactly the set of rows that could not have existed
     * before this migration: fallback delivery records. Their history is real —
     * they describe pages that were genuinely sent — but there is no way to
     * express them in the pre-migration schema, so reverting the schema means
     * giving them up. An operator who wants to keep the record should copy them
     * out first:
     *
     *   SELECT * FROM "UserOnCallLogTimeline" WHERE "userNotificationRuleId" IS NULL;
     *
     * Ordinary rows are untouched: before this migration the column was NOT NULL,
     * so nothing predating it can match.
     */
    await queryRunner.query(
      `DELETE FROM "UserOnCallLogTimeline" WHERE "userNotificationRuleId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "userNotificationRuleId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "onCallFallbackUsedNotificationSentToOwners"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "disableOnCallNotificationFallback"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "isOptOut"`,
    );
  }
}
