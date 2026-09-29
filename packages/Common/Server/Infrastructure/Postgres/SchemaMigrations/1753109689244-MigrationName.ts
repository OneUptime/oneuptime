import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1753109689244 implements MigrationInterface {
  public name = "MigrationName1753109689244";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userPushId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3e187a7828a990cdf6429a692" ON "UserOnCallLogTimeline" ("userPushId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d3e187a7828a990cdf6429a692f" FOREIGN KEY ("userPushId") REFERENCES "UserPush"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_d3e187a7828a990cdf6429a692f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3e187a7828a990cdf6429a692"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userPushId"`,
    );
  }
}
