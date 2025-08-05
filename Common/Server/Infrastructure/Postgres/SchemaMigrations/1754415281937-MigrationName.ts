import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754415281937 implements MigrationInterface {
    name = 'MigrationName1754415281937'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Incident" RENAME COLUMN "notificationFailureReasonOnIncidentCreated" TO "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "IncidentPublicNote" RENAME COLUMN "notificationFailureReasonOnNoteCreated" TO "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "IncidentStateTimeline" RENAME COLUMN "notificationFailureReason" TO "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "notificationFailureReasonOnEventScheduled" TO "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNote" RENAME COLUMN "notificationFailureReasonOnNoteCreated" TO "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceStateTimeline" RENAME COLUMN "notificationFailureReason" TO "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "StatusPageAnnouncement" RENAME COLUMN "notificationFailureReason" TO "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "Incident" ADD "subscriberNotificationFailedReason" text`);
        await queryRunner.query(`ALTER TABLE "IncidentPublicNote" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "IncidentPublicNote" ADD "subscriberNotificationFailedReason" text`);
        await queryRunner.query(`ALTER TABLE "IncidentStateTimeline" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "IncidentStateTimeline" ADD "subscriberNotificationFailedReason" text`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" ADD "subscriberNotificationFailedReason" text`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNote" ADD "subscriberNotificationFailedReason" text`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "subscriberNotificationFailedReason" text`);
        await queryRunner.query(`ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "StatusPageAnnouncement" ADD "subscriberNotificationFailedReason" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "StatusPageAnnouncement" ADD "subscriberNotificationFailedReason" character varying`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "subscriberNotificationFailedReason" character varying`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNote" ADD "subscriberNotificationFailedReason" character varying`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" ADD "subscriberNotificationFailedReason" character varying`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`);
        await queryRunner.query(`ALTER TABLE "IncidentStateTimeline" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "IncidentStateTimeline" ADD "subscriberNotificationFailedReason" character varying`);
        await queryRunner.query(`ALTER TABLE "IncidentPublicNote" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "IncidentPublicNote" ADD "subscriberNotificationFailedReason" character varying`);
        await queryRunner.query(`ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationFailedReason"`);
        await queryRunner.query(`ALTER TABLE "Incident" ADD "subscriberNotificationFailedReason" character varying`);
        await queryRunner.query(`ALTER TABLE "StatusPageAnnouncement" RENAME COLUMN "subscriberNotificationFailedReason" TO "notificationFailureReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenanceStateTimeline" RENAME COLUMN "subscriberNotificationFailedReason" TO "notificationFailureReason"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenancePublicNote" RENAME COLUMN "subscriberNotificationFailedReason" TO "notificationFailureReasonOnNoteCreated"`);
        await queryRunner.query(`ALTER TABLE "ScheduledMaintenance" RENAME COLUMN "subscriberNotificationFailedReason" TO "notificationFailureReasonOnEventScheduled"`);
        await queryRunner.query(`ALTER TABLE "IncidentStateTimeline" RENAME COLUMN "subscriberNotificationFailedReason" TO "notificationFailureReason"`);
        await queryRunner.query(`ALTER TABLE "IncidentPublicNote" RENAME COLUMN "subscriberNotificationFailedReason" TO "notificationFailureReasonOnNoteCreated"`);
        await queryRunner.query(`ALTER TABLE "Incident" RENAME COLUMN "subscriberNotificationFailedReason" TO "notificationFailureReasonOnIncidentCreated"`);
    }

}
