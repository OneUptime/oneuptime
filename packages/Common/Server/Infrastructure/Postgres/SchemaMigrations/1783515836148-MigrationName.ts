import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1783515836148 implements MigrationInterface {
  public name = "MigrationName1783515836148";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // HIGH-5: schedule timezone (nullable => existing schedules keep legacy server-local behavior).
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "timezone" character varying(100)`,
    );
    // M-5: bounded retry counter for escalation rules that momentarily resolve to no on-call user.
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "scheduleGapRetryCount" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "scheduleGapRetryCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "timezone"`,
    );
  }
}
