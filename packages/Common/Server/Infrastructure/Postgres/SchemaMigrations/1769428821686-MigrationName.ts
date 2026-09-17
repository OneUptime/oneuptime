import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769428821686 implements MigrationInterface {
  public name = "MigrationName1769428821686";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "episodeTitleTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "episodeTitleTemplate" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" DROP COLUMN "titleTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD "titleTemplate" character varying`,
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
      `ALTER TABLE "AlertEpisode" DROP COLUMN "titleTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisode" ADD "titleTemplate" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "episodeTitleTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "episodeTitleTemplate" character varying(100)`,
    );
  }
}
