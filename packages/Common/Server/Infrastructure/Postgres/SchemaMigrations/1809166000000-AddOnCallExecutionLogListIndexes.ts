import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration after the
 * OnCallDutyPolicyExecutionLog model indexed ("projectId", "createdAt") and
 * ("onCallDutyPolicyId", "createdAt") in place of bare "projectId" and
 * "onCallDutyPolicyId".
 *
 * The On-Call Policy Logs list (ExecutionLogsTable) reads a project's runs,
 * or a policy's, newest first: with the bare indexes every page read every
 * run of the project or policy and sorted them. The new indexes read a page
 * in order, and serve every read by their leading column alone - a
 * project's or a policy's runs, and the ON DELETE CASCADE of either - so the
 * bare ones go.
 *
 * The list of a policy's runs filters on the project too, and Postgres
 * reads the two filters as unrelated: on 600,000 runs it expected 3 of a
 * policy's 2,000 runs to match both, so it read all 2,000 and sorted them
 * rather than reading ten in index order (596 ms against 0.8 ms). A
 * policy's runs are all in its project, and the functional-dependency
 * statistics below say so, so the planner reads the policy's index in
 * order. TypeORM does not model statistics: they are written by hand here,
 * and pinned by AddOnCallExecutionLogListIndexesMigration.test.ts, as the
 * drift check cannot see them. CREATE STATISTICS and ANALYZE take SHARE
 * UPDATE EXCLUSIVE, which no read or write waits for.
 *
 * Online, outside a transaction: the on-call workers write runs every
 * minute. The new indexes are built before the old ones go, so reads by
 * project or policy always have one. Safe to run again after a stop part
 * way.
 */
export class AddOnCallExecutionLogListIndexes1809166000000
  implements MigrationInterface
{
  public name: string = "AddOnCallExecutionLogListIndexes1809166000000";

  // CREATE / DROP INDEX CONCURRENTLY run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_83efe1d4496704e958af6aeb43" ON "OnCallDutyPolicyExecutionLog" ("projectId", "createdAt") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d9baeb990e2f7076f8b5189b3d" ON "OnCallDutyPolicyExecutionLog" ("onCallDutyPolicyId", "createdAt") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_00e9676d39eeb807de70443051"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e4bb332263960531a4c9e2d425"`,
    );
    await queryRunner.query(
      `CREATE STATISTICS IF NOT EXISTS "OnCallDutyPolicyExecutionLog_policy_project_dependencies" (dependencies) ON "projectId", "onCallDutyPolicyId" FROM "OnCallDutyPolicyExecutionLog"`,
    );
    // Read now, not at the next autovacuum: the list needs them from today.
    await queryRunner.query(`ANALYZE "OnCallDutyPolicyExecutionLog"`);
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the
   * builds are plain ones. The bare indexes come back before the list
   * indexes go.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP STATISTICS IF EXISTS "OnCallDutyPolicyExecutionLog_policy_project_dependencies"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4bb332263960531a4c9e2d425" ON "OnCallDutyPolicyExecutionLog" ("onCallDutyPolicyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00e9676d39eeb807de70443051" ON "OnCallDutyPolicyExecutionLog" ("projectId") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d9baeb990e2f7076f8b5189b3d"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_83efe1d4496704e958af6aeb43"`,
    );
  }
}
