import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * An on-call rule can hold its page until working hours: a low-severity
 * alert raised at night pages somebody in the morning instead of straight
 * away (OnCallRuleWhenToPage, OnCallDutyPolicyRunWait). The alert, incident
 * and episode on-call rules each get when they page, their working hours
 * and the time zone those are in; an execution log gets the moment a run
 * that waits starts paging, and why it started early when its record came
 * to match a rule that pages right away (WaitingRunsOnRecordChange).
 *
 * Nothing to backfill: whenToPage starts as Right Away on every rule that
 * exists - how every rule pages today - and a NOT NULL column with a
 * constant default is added without rewriting a row. The other columns are
 * nullable, and empty on every rule and run there is.
 */
export class AddOnCallRuleWorkingHours1805000000000
  implements MigrationInterface
{
  public name: string = "AddOnCallRuleWorkingHours1805000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "pagingStartsAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "pagingStartedEarlyReason" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD "whenToPage" character varying(100) NOT NULL DEFAULT 'Right Away'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD "workingHours" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" ADD "workingHoursTimezone" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD "whenToPage" character varying(100) NOT NULL DEFAULT 'Right Away'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD "workingHours" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" ADD "workingHoursTimezone" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD "whenToPage" character varying(100) NOT NULL DEFAULT 'Right Away'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD "workingHours" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" ADD "workingHoursTimezone" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD "whenToPage" character varying(100) NOT NULL DEFAULT 'Right Away'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD "workingHours" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" ADD "workingHoursTimezone" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP COLUMN "workingHoursTimezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP COLUMN "workingHours"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeOnCallRule" DROP COLUMN "whenToPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP COLUMN "workingHoursTimezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP COLUMN "workingHours"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOnCallRule" DROP COLUMN "whenToPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP COLUMN "workingHoursTimezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP COLUMN "workingHours"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeOnCallRule" DROP COLUMN "whenToPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP COLUMN "workingHoursTimezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP COLUMN "workingHours"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOnCallRule" DROP COLUMN "whenToPage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "pagingStartedEarlyReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "pagingStartsAt"`,
    );
  }
}
