import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754671483948 implements MigrationInterface {
  public name =
    "RenameSubscriberNotificationFailedReasonToStatusMessage1754484441976";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "isStatusPageSubscribersNotifiedOnIncidentCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "isStatusPageSubscribersNotifiedOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "isStatusPageSubscribersNotified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "isStatusPageSubscribersNotifiedOnEventScheduled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "isStatusPageSubscribersNotifiedOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "isStatusPageSubscribersNotified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "isStatusPageSubscribersNotified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "subscriberNotificationStatusOnIncidentCreated" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "subscriberNotificationStatusOnNoteCreated" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "subscriberNotificationStatus" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "subscriberNotificationStatusOnEventScheduled" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "subscriberNotificationStatusOnNoteCreated" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "subscriberNotificationStatus" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "subscriberNotificationStatus" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "subscriberNotificationStatusMessage" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" DROP COLUMN "subscriberNotificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" DROP COLUMN "subscriberNotificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "subscriberNotificationStatusOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "subscriberNotificationStatusOnEventScheduled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" DROP COLUMN "subscriberNotificationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "subscriberNotificationStatusOnNoteCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationStatusOnIncidentCreated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ADD "isStatusPageSubscribersNotified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceStateTimeline" ADD "isStatusPageSubscribersNotified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "isStatusPageSubscribersNotifiedOnNoteCreated" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "isStatusPageSubscribersNotifiedOnEventScheduled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentStateTimeline" ADD "isStatusPageSubscribersNotified" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "isStatusPageSubscribersNotifiedOnNoteCreated" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "isStatusPageSubscribersNotifiedOnIncidentCreated" boolean NOT NULL DEFAULT false`,
    );
  }
}
