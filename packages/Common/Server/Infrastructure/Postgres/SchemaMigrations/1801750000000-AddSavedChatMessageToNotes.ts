import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A note saved from a Slack or Microsoft Teams message - pinned, or given a
 * note emoji - records who wrote the message, in which chat and when
 * (savedFromChatMessage, on every kind of note and on the timeline entry
 * written for it), and a private note is filed at the time the message was
 * posted: the internal notes get the postedAt the public ones already have.
 *
 * Every internal note written before this has its postedAt set to when it
 * was created, which is the time it has always shown, so the notes pages
 * can order every note by postedAt. Nothing else changes for existing
 * notes: savedFromChatMessage stays empty on them. Adding nullable columns
 * with no default changes no row; the backfill rewrites each internal note
 * once.
 */
export class AddSavedChatMessageToNotes1801750000000
  implements MigrationInterface
{
  public name: string = "AddSavedChatMessageToNotes1801750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeInternalNote" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeInternalNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeFeed" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD "savedFromChatMessage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD "savedFromChatMessage" jsonb`,
    );

    // Existing internal notes: filed at the time they were written.
    for (const table of [
      "IncidentInternalNote",
      "ScheduledMaintenanceInternalNote",
      "AlertInternalNote",
      "AlertEpisodeInternalNote",
      "IncidentEpisodeInternalNote",
    ]) {
      await queryRunner.query(
        `UPDATE "${table}" SET "postedAt" = "createdAt" WHERE "postedAt" IS NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeFeed" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeInternalNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeInternalNote" DROP COLUMN "postedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeFeed" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeInternalNote" DROP COLUMN "postedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertInternalNote" DROP COLUMN "postedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceInternalNote" DROP COLUMN "postedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" DROP COLUMN "savedFromChatMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentInternalNote" DROP COLUMN "postedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP COLUMN "savedFromChatMessage"`,
    );
  }
}
