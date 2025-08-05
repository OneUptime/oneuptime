import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateSubscriberNotificationStatusToEnum1754500000000
  implements MigrationInterface
{
  public name = "UpdateSubscriberNotificationStatusToEnum1754500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // StatusPageAnnouncement changes
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "subscriberNotificationStatus" character varying DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "notificationFailureReason" text`,
    );
    // Set Success status for existing records where notification was sent (backward compatibility)
    await queryRunner.query(
      `UPDATE "StatusPageAnnouncement" SET "subscriberNotificationStatus" = 'Success' WHERE "isStatusPageSubscribersNotified" = true`,
    );
    // Set Skipped status for records where notification should not be sent
    await queryRunner.query(
      `UPDATE "StatusPageAnnouncement" SET "subscriberNotificationStatus" = 'Skipped' WHERE "shouldStatusPageSubscribersBeNotified" = false`,
    );
    // Drop old boolean column
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "isStatusPageSubscribersNotified"`,
    );

    // Incident changes
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "subscriberNotificationStatusOnIncidentCreated" character varying DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "notificationFailureReasonOnIncidentCreated" text`,
    );
    // Set Success status for existing records where notification was sent
    await queryRunner.query(
      `UPDATE "Incident" SET "subscriberNotificationStatusOnIncidentCreated" = 'Success' WHERE "isStatusPageSubscribersNotifiedOnIncidentCreated" = true`,
    );
    // Set Skipped status for records where notification should not be sent
    await queryRunner.query(
      `UPDATE "Incident" SET "subscriberNotificationStatusOnIncidentCreated" = 'Skipped' WHERE "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated" = false`,
    );
    // Drop old boolean column
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "isStatusPageSubscribersNotifiedOnIncidentCreated"`,
    );

    // IncidentStateTimeline changes
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "subscriberNotificationStatus" character varying DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "notificationFailureReason" text`,
    );
    // Set Success status for existing records where notification was sent
    await queryRunner.query(
      `UPDATE "IncidentStateTimeline" SET "subscriberNotificationStatus" = 'Success' WHERE "isStatusPageSubscribersNotified" = true`,
    );
    // Set Skipped status for records where notification should not be sent
    await queryRunner.query(
      `UPDATE "IncidentStateTimeline" SET "subscriberNotificationStatus" = 'Skipped' WHERE "shouldStatusPageSubscribersBeNotified" = false`,
    );
    // Drop old boolean column
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "isStatusPageSubscribersNotified"`,
    );

    // IncidentPublicNote changes
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "subscriberNotificationStatusOnNoteCreated" character varying DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "notificationFailureReasonOnNoteCreated" text`,
    );
    // Set Success status for existing records where notification was sent
    await queryRunner.query(
      `UPDATE "IncidentPublicNote" SET "subscriberNotificationStatusOnNoteCreated" = 'Success' WHERE "isStatusPageSubscribersNotifiedOnNoteCreated" = true`,
    );
    // Set Skipped status for records where notification should not be sent
    await queryRunner.query(
      `UPDATE "IncidentPublicNote" SET "subscriberNotificationStatusOnNoteCreated" = 'Skipped' WHERE "shouldStatusPageSubscribersBeNotifiedOnNoteCreated" = false`,
    );
    // Drop old boolean column
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "isStatusPageSubscribersNotifiedOnNoteCreated"`,
    );

    // ScheduledMaintenance changes
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "subscriberNotificationStatusOnEventScheduled" character varying DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "notificationFailureReasonOnEventScheduled" text`,
    );
    // Set Success status for existing records where notification was sent
    await queryRunner.query(
      `UPDATE "ScheduledMaintenance" SET "subscriberNotificationStatusOnEventScheduled" = 'Success' WHERE "isStatusPageSubscribersNotifiedOnEventScheduled" = true`,
    );
    // Set Skipped status for records where notification should not be sent
    await queryRunner.query(
      `UPDATE "ScheduledMaintenance" SET "subscriberNotificationStatusOnEventScheduled" = 'Skipped' WHERE "shouldStatusPageSubscribersBeNotifiedOnEventCreated" = false`,
    );
    // Drop old boolean column
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "isStatusPageSubscribersNotifiedOnEventScheduled"`,
    );

    // ScheduledMaintenanceStateTimeline changes
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "subscriberNotificationStatus" character varying DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "notificationFailureReason" text`,
    );
    // Set Success status for existing records where notification was sent
    await queryRunner.query(
      `UPDATE "ScheduledMaintenanceStateTimeline" SET "subscriberNotificationStatus" = 'Success' WHERE "isStatusPageSubscribersNotified" = true`,
    );
    // Set Skipped status for records where notification should not be sent
    await queryRunner.query(
      `UPDATE "ScheduledMaintenanceStateTimeline" SET "subscriberNotificationStatus" = 'Skipped' WHERE "shouldStatusPageSubscribersBeNotified" = false`,
    );
    // Drop old boolean column
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "isStatusPageSubscribersNotified"`,
    );

    // ScheduledMaintenancePublicNote changes
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "subscriberNotificationStatusOnNoteCreated" character varying DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "notificationFailureReasonOnNoteCreated" text`,
    );
    // Set Success status for existing records where notification was sent
    await queryRunner.query(
      `UPDATE "ScheduledMaintenancePublicNote" SET "subscriberNotificationStatusOnNoteCreated" = 'Success' WHERE "isStatusPageSubscribersNotifiedOnNoteCreated" = true`,
    );
    // Set Skipped status for records where notification should not be sent
    await queryRunner.query(
      `UPDATE "ScheduledMaintenancePublicNote" SET "subscriberNotificationStatusOnNoteCreated" = 'Skipped' WHERE "shouldStatusPageSubscribersBeNotifiedOnNoteCreated" = false`,
    );
    // Drop old boolean column
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "isStatusPageSubscribersNotifiedOnNoteCreated"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback StatusPageAnnouncement changes
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "isStatusPageSubscribersNotified" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "StatusPageAnnouncement" SET "isStatusPageSubscribersNotified" = true WHERE "subscriberNotificationStatus" = 'Success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "subscriberNotificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "notificationFailureReason"`,
    );

    // Rollback Incident changes
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "isStatusPageSubscribersNotifiedOnIncidentCreated" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "Incident" SET "isStatusPageSubscribersNotifiedOnIncidentCreated" = true WHERE "subscriberNotificationStatusOnIncidentCreated" = 'Success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationStatusOnIncidentCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "notificationFailureReasonOnIncidentCreated"`,
    );

    // Rollback IncidentStateTimeline changes
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "isStatusPageSubscribersNotified" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "IncidentStateTimeline" SET "isStatusPageSubscribersNotified" = true WHERE "subscriberNotificationStatus" = 'Success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "subscriberNotificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "notificationFailureReason"`,
    );

    // Rollback IncidentPublicNote changes
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "isStatusPageSubscribersNotifiedOnNoteCreated" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "IncidentPublicNote" SET "isStatusPageSubscribersNotifiedOnNoteCreated" = true WHERE "subscriberNotificationStatusOnNoteCreated" = 'Success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "subscriberNotificationStatusOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "notificationFailureReasonOnNoteCreated"`,
    );

    // Rollback ScheduledMaintenance changes
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "isStatusPageSubscribersNotifiedOnEventScheduled" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "ScheduledMaintenance" SET "isStatusPageSubscribersNotifiedOnEventScheduled" = true WHERE "subscriberNotificationStatusOnEventScheduled" = 'Success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "subscriberNotificationStatusOnEventScheduled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "notificationFailureReasonOnEventScheduled"`,
    );

    // Rollback ScheduledMaintenanceStateTimeline changes
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "isStatusPageSubscribersNotified" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "ScheduledMaintenanceStateTimeline" SET "isStatusPageSubscribersNotified" = true WHERE "subscriberNotificationStatus" = 'Success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "subscriberNotificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "notificationFailureReason"`,
    );

    // Rollback ScheduledMaintenancePublicNote changes
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "isStatusPageSubscribersNotifiedOnNoteCreated" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "ScheduledMaintenancePublicNote" SET "isStatusPageSubscribersNotifiedOnNoteCreated" = true WHERE "subscriberNotificationStatusOnNoteCreated" = 'Success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "subscriberNotificationStatusOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "notificationFailureReasonOnNoteCreated"`,
    );
  }
}
