import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A branch name is stored whole, in a column that holds any branch GitHub
 * takes.
 *
 * "CodeRepository"."mainBranchName" and "AIAgentTaskPullRequest"."headRefName"
 * and "baseRefName" were varchar(100), and each is copied in as its host
 * names it. A longer branch failed DatabaseService.checkMaxLengthOfFields: a
 * base branch a person picked for a code task (up to 255 characters) made
 * /ai-agent-data/record-pull-request fail, the Completed report's fallback
 * only logged that, and the pull request was never recorded - the open-PR
 * cap never counted it and the PR state sync never tracked it. A repository
 * whose default branch is longer could not be connected. A branch name cut
 * to fit is another branch, so the columns are LongText now, varchar(500):
 * GitHub takes a ref of at most 255 bytes, and a name never has more
 * characters than bytes.
 *
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. TypeORM wrote each change as DROP COLUMN +
 * ADD, which drops every recorded branch and puts every repository back on
 * "main", the column's default. ALTER COLUMN ... TYPE reaches the same
 * schema and keeps every name: widening a varchar is binary-coercible, so
 * Postgres rewrites no row, and none of these columns is in an index, so
 * nothing is rebuilt - each table is locked only for its catalog change.
 * Same shape as WidenThingNameColumns1808992530000.
 */
export class WidenGitBranchNameColumns1808995180000
  implements MigrationInterface
{
  public name: string = "WidenGitBranchNameColumns1808995180000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ALTER COLUMN "mainBranchName" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "headRefName" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "baseRefName" TYPE character varying(500)`,
    );
  }

  /*
   * Narrowing back to 100 fails on any branch written longer since. Such a
   * branch is emptied first, not cut: a cut name is another branch, and an
   * empty one reads as unknown - a pull request without its head branch is
   * synced without its checks, and a repository without a main branch
   * starts from main.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "AIAgentTaskPullRequest" SET "baseRefName" = NULL WHERE LENGTH("baseRefName") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "baseRefName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "AIAgentTaskPullRequest" SET "headRefName" = NULL WHERE LENGTH("headRefName") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "headRefName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "CodeRepository" SET "mainBranchName" = NULL WHERE LENGTH("mainBranchName") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ALTER COLUMN "mainBranchName" TYPE character varying(100)`,
    );
  }
}
