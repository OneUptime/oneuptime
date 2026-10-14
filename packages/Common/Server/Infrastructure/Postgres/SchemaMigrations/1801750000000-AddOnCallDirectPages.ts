import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Direct pages: people, a team's members or whoever is on call in a
 * schedule, paged with no on-call policy behind the page
 * (Types/OnCallDutyPolicy/OnCallDirectPage). A direct page is kept where an
 * on-call policy's run is - its execution log, the log's timeline, each
 * person's notification log and that log's timeline - so on those four
 * tables the policy, and the escalation rule, may now be empty. Every
 * existing row names both and is unchanged.
 *
 * OnCallDutyPolicyExecutionLog.triggeredByWorkflowId and
 * triggeredByWorkflowName: the workflow whose step started a page, and the
 * name it had then. Empty on every existing row: nothing recorded it before.
 *
 * Generated with `npm run generate-postgres-migration`, then renumbered to
 * the next round slot above the registered migrations
 * (SchemaMigrationsOrdering.test).
 *
 * TypeORM generated each column's foreign key dropped and added again
 * around the change; Postgres does not need that to drop a NOT NULL, and
 * adding the keys again would scan the four tables under a lock. The keys
 * are left as they are: same names, same definitions (the schema drift check
 * agrees). Dropping a NOT NULL and adding a nullable column are changes to
 * the catalog only, so no table is rewritten.
 *
 * Down: a direct page cannot exist in the old schema, so its rows are
 * deleted - the deliveries first, then the logs they belong to - before the
 * columns are required again.
 */
export class AddOnCallDirectPages1801750000000 implements MigrationInterface {
  public name: string = "AddOnCallDirectPages1801750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "triggeredByWorkflowId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "triggeredByWorkflowName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ALTER COLUMN "onCallDutyPolicyId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ALTER COLUMN "onCallDutyPolicyId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ALTER COLUMN "onCallDutyPolicyEscalationRuleId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ALTER COLUMN "onCallDutyPolicyId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ALTER COLUMN "onCallDutyPolicyEscalationRuleId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "onCallDutyPolicyId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "onCallDutyPolicyEscalationRuleId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Destructive, and worth understanding before running down(): what it
     * removes is exactly the rows that could not have existed before this
     * migration - direct pages and their deliveries. To keep the record,
     * copy them out first:
     *
     *   SELECT * FROM "OnCallDutyPolicyExecutionLog" WHERE "onCallDutyPolicyId" IS NULL;
     *
     * Every other row names its policy and its escalation rule, and is
     * untouched.
     */
    await queryRunner.query(
      `DELETE FROM "UserOnCallLogTimeline" WHERE "onCallDutyPolicyId" IS NULL OR "onCallDutyPolicyEscalationRuleId" IS NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "UserOnCallLog" WHERE "onCallDutyPolicyId" IS NULL OR "onCallDutyPolicyEscalationRuleId" IS NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "OnCallDutyPolicyExecutionLogTimeline" WHERE "onCallDutyPolicyId" IS NULL OR "onCallDutyPolicyEscalationRuleId" IS NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "OnCallDutyPolicyExecutionLog" WHERE "onCallDutyPolicyId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "onCallDutyPolicyEscalationRuleId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ALTER COLUMN "onCallDutyPolicyId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ALTER COLUMN "onCallDutyPolicyEscalationRuleId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ALTER COLUMN "onCallDutyPolicyId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ALTER COLUMN "onCallDutyPolicyEscalationRuleId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ALTER COLUMN "onCallDutyPolicyId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ALTER COLUMN "onCallDutyPolicyId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "triggeredByWorkflowName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "triggeredByWorkflowId"`,
    );
  }
}
