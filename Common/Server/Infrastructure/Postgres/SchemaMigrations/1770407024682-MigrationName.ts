import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770407024682 implements MigrationInterface {
  public name = "MigrationName1770407024682";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentNumberPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertNumberPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "scheduledMaintenanceNumberPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentEpisodeNumberPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertEpisodeNumberPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" ADD "episodeNumberWithPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "incidentNumberWithPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD "episodeNumberWithPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "alertNumberWithPrefix" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenance" ADD "scheduledMaintenanceNumberWithPrefix" character varying(100)`,
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
      `ALTER TABLE "ScheduledMaintenance" DROP COLUMN "scheduledMaintenanceNumberWithPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "alertNumberWithPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP COLUMN "episodeNumberWithPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "incidentNumberWithPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisode" DROP COLUMN "episodeNumberWithPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertEpisodeNumberPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentEpisodeNumberPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "scheduledMaintenanceNumberPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertNumberPrefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentNumberPrefix"`,
    );
  }
}
