import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1755778934927 implements MigrationInterface {
  public name = "MigrationName1755778934927";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "microsoftTeamsIncomingWebhookUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "microsoftTeamsIncomingWebhookUrl" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
  }
}
