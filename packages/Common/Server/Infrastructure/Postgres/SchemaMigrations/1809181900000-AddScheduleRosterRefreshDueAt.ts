import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #7813) after
 * OnCallDutyPolicySchedule gained rosterRefreshDueAt: when a change made to
 * the schedule's layers through the API - Terraform, the CLI, a script, an
 * AI client - is told, once it has been quiet for half a minute. Who is on
 * call is then worked out once, and the people it reaches hear about the
 * whole change once, where each row written used to send its own round of
 * messages.
 *
 * Nullable, with no default: adding it rewrites nothing, and no schedule
 * has a change waiting. Its index is on a table every install already has
 * rows in, so it is built online, in the migration registered right after
 * this one: AddScheduleRosterRefreshDueAtIndex1809181910000.
 */
export class AddScheduleRosterRefreshDueAt1809181900000
  implements MigrationInterface
{
  public name: string = "AddScheduleRosterRefreshDueAt1809181900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "rosterRefreshDueAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "rosterRefreshDueAt"`,
    );
  }
}
