import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765834537501 implements MigrationInterface {
  public name = "MigrationName1765834537501";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "LlmLog" DROP COLUMN "inputTokens"`);
    await queryRunner.query(`ALTER TABLE "LlmLog" DROP COLUMN "outputTokens"`);
    await queryRunner.query(`ALTER TABLE "LlmLog" DROP COLUMN "totalTokens"`);
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD "totalTokens" integer NOT NULL DEFAULT '0'`,
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
    await queryRunner.query(`ALTER TABLE "LlmLog" DROP COLUMN "totalTokens"`);
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD "totalTokens" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD "outputTokens" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmLog" ADD "inputTokens" integer NOT NULL DEFAULT '0'`,
    );
  }
}
