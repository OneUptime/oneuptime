import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as npm run generate-postgres-migration writes it alongside
 * AddAIAgentTaskPullRequestSecurityCase1809187421500, and moved into a
 * migration of its own: "AIAgentTaskPullRequest" already holds every pull
 * request OneUptime AI opened, and the pull request sync writes it, so the
 * index a case reads its fixes by ("securityCaseId") is built online,
 * without blocking those writes. Safe to run again after a stop part way:
 * an index that is already there is left as it is.
 */
export class AddAIAgentTaskPullRequestSecurityCaseIndex1809187421510
  implements MigrationInterface
{
  public name: string =
    "AddAIAgentTaskPullRequestSecurityCaseIndex1809187421510";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_36aa96d76154de8d529861b7c1" ON "AIAgentTaskPullRequest" ("securityCaseId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_36aa96d76154de8d529861b7c1"`,
    );
  }
}
