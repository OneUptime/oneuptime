import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameSubscriberNotificationFailedReasonToStatusMessage1754484441976
  implements MigrationInterface
{
  public name =
    "RenameSubscriberNotificationFailedReasonToStatusMessage1754484441976";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "subscriberNotificationFailedReason" TO "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" RENAME COLUMN "subscriberNotificationFailedReason" TO "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" RENAME COLUMN "subscriberNotificationFailedReason" TO "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "subscriberNotificationFailedReason" TO "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" RENAME COLUMN "subscriberNotificationFailedReason" TO "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" RENAME COLUMN "subscriberNotificationFailedReason" TO "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" RENAME COLUMN "subscriberNotificationFailedReason" TO "subscriberNotificationStatusMessage"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" RENAME COLUMN "subscriberNotificationStatusMessage" TO "subscriberNotificationFailedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" RENAME COLUMN "subscriberNotificationStatusMessage" TO "subscriberNotificationFailedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" RENAME COLUMN "subscriberNotificationStatusMessage" TO "subscriberNotificationFailedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "subscriberNotificationStatusMessage" TO "subscriberNotificationFailedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" RENAME COLUMN "subscriberNotificationStatusMessage" TO "subscriberNotificationFailedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" RENAME COLUMN "subscriberNotificationStatusMessage" TO "subscriberNotificationFailedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "subscriberNotificationStatusMessage" TO "subscriberNotificationFailedReason"`,
    );
  }
}
