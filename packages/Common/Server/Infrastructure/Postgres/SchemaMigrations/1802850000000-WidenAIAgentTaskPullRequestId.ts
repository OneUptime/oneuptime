import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its index is rebuilt online, in
 * AddAIAgentTaskPullRequestIdIndex1802900000000.
 *
 * "AIAgentTaskPullRequest"."pullRequestId" holds the hosting platform's ID of
 * a pull request the agent opened. It was an integer, and GitHub's pull
 * request IDs passed 2^31 long ago (4885508095 is a real one), so recording
 * every pull request the agent opened failed and the run reported "Failed to
 * record pull request" for work it had done. Those inserts never landed, so
 * no row holds a GitHub ID to lose when the column is recreated as a bigint.
 */
export class WidenAIAgentTaskPullRequestId1802850000000
  implements MigrationInterface
{
  public name: string = "WidenAIAgentTaskPullRequestId1802850000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab947ccdac955be166aa2c5a27"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "pullRequestId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "pullRequestId" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "pullRequestId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "pullRequestId" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab947ccdac955be166aa2c5a27" ON "AIAgentTaskPullRequest" ("pullRequestId") `,
    );
  }
}
