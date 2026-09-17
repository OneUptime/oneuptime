import { MigrationInterface, QueryRunner } from "typeorm";

export class EnableSessionReplayByDefault1785491583874
  implements MigrationInterface
{
  public name = "EnableSessionReplayByDefault1785491583874";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "isSessionReplayAllowed" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "isSessionReplayEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayConsentMode" SET DEFAULT 'NotRequired'`,
    );

    /*
     * Backfill existing rows, not just the defaults for new ones.
     *
     * ALTER COLUMN SET DEFAULT only affects rows inserted afterwards, so
     * without this every project and RUM application that already exists
     * would keep the old `false` and session replay would stay off for
     * exactly the installs that already have traffic.
     *
     * Safe to apply unconditionally because these three columns were
     * introduced in the same unreleased change as this migration: no
     * stored value can represent a deliberate user choice yet, so there is
     * nothing to preserve. Any migration added AFTER this one must not
     * assume the same and should leave existing values alone.
     */
    await queryRunner.query(
      `UPDATE "Project" SET "isSessionReplayAllowed" = true WHERE "isSessionReplayAllowed" = false`,
    );
    await queryRunner.query(
      `UPDATE "RumApplication" SET "isSessionReplayEnabled" = true WHERE "isSessionReplayEnabled" = false`,
    );
    await queryRunner.query(
      `UPDATE "RumApplication" SET "sessionReplayConsentMode" = 'NotRequired' WHERE "sessionReplayConsentMode" = 'RequireExplicit'`,
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
      `ALTER TABLE "RumApplication" ALTER COLUMN "sessionReplayConsentMode" SET DEFAULT 'RequireExplicit'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ALTER COLUMN "isSessionReplayEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "isSessionReplayAllowed" SET DEFAULT false`,
    );
  }
}
