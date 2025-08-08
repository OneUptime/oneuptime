import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754412708044 implements MigrationInterface {
  public name = "MigrationName1754412708044";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "notificationFailureReasonOnIncidentCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "notificationFailureReasonOnIncidentCreated" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ALTER COLUMN "subscriberNotificationStatusOnNoteCreated" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "notificationFailureReasonOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "notificationFailureReasonOnNoteCreated" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ALTER COLUMN "subscriberNotificationStatus" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "notificationFailureReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "notificationFailureReason" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ALTER COLUMN "subscriberNotificationStatusOnEventScheduled" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "notificationFailureReasonOnEventScheduled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "notificationFailureReasonOnEventScheduled" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ALTER COLUMN "subscriberNotificationStatusOnNoteCreated" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "notificationFailureReasonOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "notificationFailureReasonOnNoteCreated" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ALTER COLUMN "subscriberNotificationStatus" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "notificationFailureReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "notificationFailureReason" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ALTER COLUMN "subscriberNotificationStatus" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "notificationFailureReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "notificationFailureReason" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "notificationFailureReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "notificationFailureReason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ALTER COLUMN "subscriberNotificationStatus" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "notificationFailureReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "notificationFailureReason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ALTER COLUMN "subscriberNotificationStatus" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "notificationFailureReasonOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "notificationFailureReasonOnNoteCreated" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ALTER COLUMN "subscriberNotificationStatusOnNoteCreated" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "notificationFailureReasonOnEventScheduled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "notificationFailureReasonOnEventScheduled" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ALTER COLUMN "subscriberNotificationStatusOnEventScheduled" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "notificationFailureReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "notificationFailureReason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ALTER COLUMN "subscriberNotificationStatus" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "notificationFailureReasonOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "notificationFailureReasonOnNoteCreated" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ALTER COLUMN "subscriberNotificationStatusOnNoteCreated" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "notificationFailureReasonOnIncidentCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "notificationFailureReasonOnIncidentCreated" text`,
    );
  }
}
