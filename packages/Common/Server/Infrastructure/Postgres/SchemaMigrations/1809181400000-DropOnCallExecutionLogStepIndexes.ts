import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #8104) after
 * the OnCallDutyPolicyExecutionLog model's bare indexes on
 * "lastExecutedEscalationRuleOrder", "lastEscalationRuleExecutedAt",
 * "executeNextEscalationRuleInMinutes" and
 * "onCallPolicyExecutionRepeatCount" went.
 *
 * Every escalation step writes those columns: the claim that moves a run on
 * (lastEscalationRuleExecutedAt), the level it starts (all of them but the
 * count), a new pass (the count). An update that changes a column any index
 * names cannot be HOT, and writes an entry into every index on the table -
 * thirteen, besides the primary key. Nothing reads by them: the worker and
 * every other reader read a run by its _id, or by its status, and the
 * On-Call Policy Logs list filters and sorts by none of them. Without them
 * a claim and a pass's count change no indexed column, so they can be HOT,
 * and a level's start writes nine indexes besides the key instead of
 * thirteen. On 2,000 runs of a three-level policy that repeats once, the
 * WAL written fell by 48% one run at a time (45% of the updates HOT, none
 * before) and by 27% with a hundred runs stepping together, and the
 * table's indexes took about half the room.
 *
 * "lastExecutedEscalationRuleId" keeps its index: deleting an escalation
 * rule finds the runs that last executed it by it (ON DELETE CASCADE).
 *
 * Online, outside a transaction: the on-call worker writes runs every
 * minute, and a plain DROP INDEX would stop it - and every read of the
 * table - while it waited for its lock. Safe to run again after a stop part
 * way.
 */
export class DropOnCallExecutionLogStepIndexes1809181400000
  implements MigrationInterface
{
  public name: string = "DropOnCallExecutionLogStepIndexes1809181400000";

  // DROP INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_fbb50489ef5eb354f46d479e2a"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_296e2be818e3fba28e43b457fb"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_6ad07641fe00f29edc65716aca"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_a217798f1dbf12d31b498a1020"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the
   * builds are plain ones, as generated.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_a217798f1dbf12d31b498a1020" ON "OnCallDutyPolicyExecutionLog" ("onCallPolicyExecutionRepeatCount") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6ad07641fe00f29edc65716aca" ON "OnCallDutyPolicyExecutionLog" ("executeNextEscalationRuleInMinutes") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_296e2be818e3fba28e43b457fb" ON "OnCallDutyPolicyExecutionLog" ("lastEscalationRuleExecutedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fbb50489ef5eb354f46d479e2a" ON "OnCallDutyPolicyExecutionLog" ("lastExecutedEscalationRuleOrder") `,
    );
  }
}
