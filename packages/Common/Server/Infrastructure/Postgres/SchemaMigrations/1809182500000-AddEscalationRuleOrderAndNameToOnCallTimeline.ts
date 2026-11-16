import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #9036) after
 * OnCallDutyPolicyExecutionLogTimeline gained escalationRuleOrder and
 * escalationRuleName: the level a line of a run's timeline is about - its
 * place in the policy and its name - as they were when the line was
 * written. Deleting an escalation rule now keeps the lines it paged and
 * clears their reference to it (KeepOnCallHistoryWhenItsSettingsAreDeleted
 * 1809182510000, registered right after this one); these say which level
 * they were.
 *
 * Nullable, with no default: adding them rewrites nothing. Lines written
 * before them have neither, and read "Deleted escalation rule" once their
 * rule is gone.
 */
export class AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000
  implements MigrationInterface
{
  public name: string =
    "AddEscalationRuleOrderAndNameToOnCallTimeline1809182500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "escalationRuleOrder" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "escalationRuleName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "escalationRuleName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "escalationRuleOrder"`,
    );
  }
}
