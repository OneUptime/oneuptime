import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1766923324521 implements MigrationInterface {
  public name = "MigrationName1766923324521";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIAgentTaskLog" DROP COLUMN "logs"`);
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" ADD "severity" character varying(50) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" ADD "message" text NOT NULL`,
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
      `ALTER TABLE "AIAgentTaskLog" DROP COLUMN "message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskLog" DROP COLUMN "severity"`,
    );
    await queryRunner.query(`ALTER TABLE "AIAgentTaskLog" ADD "logs" jsonb`);
  }
}
