import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1779882573463 implements MigrationInterface {
  public name = "MigrationName1779882573463";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "viewMode" character varying DEFAULT 'List'`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "rowAxisLabel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "columnAxisLabel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "rowAxisValues" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" ADD "columnAxisValues" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD "rowAxisValue" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" ADD "columnAxisValue" character varying(100)`,
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
      `ALTER TABLE "StatusPageResource" DROP COLUMN "columnAxisValue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageResource" DROP COLUMN "rowAxisValue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "columnAxisValues"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "rowAxisValues"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "columnAxisLabel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "rowAxisLabel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageGroup" DROP COLUMN "viewMode"`,
    );
  }
}
