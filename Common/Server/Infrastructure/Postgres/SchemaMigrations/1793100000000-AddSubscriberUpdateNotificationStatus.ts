import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Editing an announcement or a public note can now notify status page
 * subscribers, when the editor asks for it on that edit.
 *
 * Each of the four tables gets a status and a status message for that
 * "updated" notification, next to the existing columns for the "posted" one.
 * Both are nullable with no default: NULL means no update notification was
 * ever requested, so existing rows are left exactly as they are and the
 * update worker job, which looks for Pending, has nothing to pick up until
 * someone ticks the box. The status column is indexed because that worker
 * queries it every minute.
 */
export class AddSubscriberUpdateNotificationStatus1793100000000
  implements MigrationInterface
{
  public name: string = "AddSubscriberUpdateNotificationStatus1793100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "subscriberNotificationStatusOnAnnouncementUpdated" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "subscriberNotificationStatusMessageOnAnnouncementUpdated" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "subscriberNotificationStatusOnNoteUpdated" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "subscriberNotificationStatusMessageOnNoteUpdated" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "subscriberNotificationStatusOnNoteUpdated" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "subscriberNotificationStatusMessageOnNoteUpdated" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD "subscriberNotificationStatusOnNoteUpdated" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD "subscriberNotificationStatusMessageOnNoteUpdated" text`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac760d54ad86abaafa4a769202" ON "StatusPageAnnouncement" ("subscriberNotificationStatusOnAnnouncementUpdated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_acdb49bff6ba0ee97b9ec8af8e" ON "IncidentPublicNote" ("subscriberNotificationStatusOnNoteUpdated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1231db6437c9f95d72e39d3959" ON "ScheduledMaintenancePublicNote" ("subscriberNotificationStatusOnNoteUpdated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c3106e0a112edc5068df21d40f" ON "IncidentEpisodePublicNote" ("subscriberNotificationStatusOnNoteUpdated") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c3106e0a112edc5068df21d40f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1231db6437c9f95d72e39d3959"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_acdb49bff6ba0ee97b9ec8af8e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac760d54ad86abaafa4a769202"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP COLUMN "subscriberNotificationStatusMessageOnNoteUpdated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP COLUMN "subscriberNotificationStatusOnNoteUpdated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "subscriberNotificationStatusMessageOnNoteUpdated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "subscriberNotificationStatusOnNoteUpdated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "subscriberNotificationStatusMessageOnNoteUpdated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "subscriberNotificationStatusOnNoteUpdated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "subscriberNotificationStatusMessageOnAnnouncementUpdated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "subscriberNotificationStatusOnAnnouncementUpdated"`,
    );
  }
}
