import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * WidenAIAgentTaskPullRequestId1802850000000, and moved into a migration of
 * its own: AIAgentTaskPullRequest already exists, so the index on the
 * recreated "pullRequestId" column is built online, without blocking the
 * table's writers. Safe to run again after a stop part way.
 */
export class AddAIAgentTaskPullRequestIdIndex1802900000000
  implements MigrationInterface
{
  public name: string = "AddAIAgentTaskPullRequestIdIndex1802900000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_ab947ccdac955be166aa2c5a27" ON "AIAgentTaskPullRequest" ("pullRequestId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_ab947ccdac955be166aa2c5a27"`,
    );
  }
}
