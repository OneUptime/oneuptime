import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInvestigationVerdictAndGrade1783965945957
  implements MigrationInterface
{
  public name = "AddInvestigationVerdictAndGrade1783965945957";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "humanVerdict" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "humanVerdictAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "humanVerdictByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "autoGrade" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "autoGradeAt" TIMESTAMP WITH TIME ZONE`,
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
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "autoGradeAt"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "autoGrade"`);
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "humanVerdictByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "humanVerdictAt"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "humanVerdict"`);
  }
}
