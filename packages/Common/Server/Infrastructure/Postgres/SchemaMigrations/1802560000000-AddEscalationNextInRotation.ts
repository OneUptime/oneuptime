import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * An escalation rule can page the next person in an on-call schedule's
 * rotation - the backup after whoever is on call - as well as whoever is on
 * call (Types/OnCallDutyPolicy/NextInRotation):
 *
 *   - "OnCallDutyPolicyEscalationRuleSchedule"."pageNextInRotation": which of
 *     the two a rule's schedule row pages. Every existing row pages whoever
 *     is on call, as it always did, so the column starts false.
 *   - "OnCallDutyPolicyExecutionLogTimeline"."isNextInRotation": a run's step
 *     that paged somebody as the next in the rotation, or found nobody next,
 *     says so. Every existing step paged whoever was on call, if anybody.
 *
 * Both are booleans with a constant default, which Postgres adds without
 * rewriting or scanning the table.
 */
export class AddEscalationNextInRotation1802560000000
  implements MigrationInterface
{
  public name: string = "AddEscalationNextInRotation1802560000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" ADD "pageNextInRotation" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "isNextInRotation" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "isNextInRotation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyEscalationRuleSchedule" DROP COLUMN "pageNextInRotation"`,
    );
  }
}
