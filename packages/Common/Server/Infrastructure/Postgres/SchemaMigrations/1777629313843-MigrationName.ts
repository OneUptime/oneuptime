import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1777629313843 implements MigrationInterface {
  public name: string = "MigrationName1777629313843";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseUserLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseCurrentUserCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "enterpriseLicenseUserCountUpdatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "userLimit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "currentUserCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" ADD "userCountUpdatedAt" TIMESTAMP WITH TIME ZONE`,
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
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "userCountUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "currentUserCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "EnterpriseLicense" DROP COLUMN "userLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseUserCountUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseCurrentUserCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "enterpriseLicenseUserLimit"`,
    );
  }
}
