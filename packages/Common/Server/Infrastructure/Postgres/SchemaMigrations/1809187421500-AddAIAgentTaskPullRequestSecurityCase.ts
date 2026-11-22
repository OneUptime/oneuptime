import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as npm run generate-postgres-migration writes it, then numbered
 * after the last registered migration.
 *
 * A security case finds the fixes OneUptime AI opened for it (#10347):
 * "AIAgentTaskPullRequest" gains "securityCaseId", the case Fix With AI
 * opened the pull request from, so the case's Fix step's check reads
 * whether a fix shipped. Empty on every existing pull request. Its index
 * is built online, in AddAIAgentTaskPullRequestSecurityCaseIndex
 * 1809187421510: the table already holds every pull request OneUptime AI
 * opened.
 */
export class AddAIAgentTaskPullRequestSecurityCase1809187421500
  implements MigrationInterface
{
  public name: string = "AddAIAgentTaskPullRequestSecurityCase1809187421500";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "securityCaseId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "securityCaseId"`,
    );
  }
}
