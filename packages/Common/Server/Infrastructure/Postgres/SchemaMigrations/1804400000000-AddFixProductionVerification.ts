import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Fix verified in production: what an AI fix pull request records once it
 * merges (the commit GitHub merged it as, and when), and whether it fixed its
 * exception in production (FixProductionVerifier): its status and when it
 * changed, the deploy that shipped it (when, its version and its commit),
 * and a summary.
 *
 * Eight nullable columns on an existing table: no index, no foreign key, no
 * rewrite.
 */
export class AddFixProductionVerification1804400000000
  implements MigrationInterface
{
  public name: string = "AddFixProductionVerification1804400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "mergeCommitSha" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "mergedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "productionStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "productionStatusAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "deployedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "deployedVersion" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "deployedCommitSha" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ADD "productionSummary" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "productionSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "deployedCommitSha"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "deployedVersion"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "deployedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "productionStatusAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "productionStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "mergedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" DROP COLUMN "mergeCommitSha"`,
    );
  }
}
