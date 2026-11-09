import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A repository's owner is stored whole, in a column that holds any GitLab
 * group's full path.
 *
 * "CodeRepository"."organizationName" was varchar(100), and so was
 * "AIAgentTaskPullRequest"."repoOrganizationName", which is copied from it.
 * The owner is the host's own name for it - a GitLab group's full path, the
 * path before the name in a Git address - and is part of the repository's
 * address, so a cut one is another group. A longer one could not be kept: the
 * connector skipped a GitLab project in a deeply nested group, and refused a
 * Git address with a long path. Both columns are text now. GitLab nests a
 * group under at most 20 others, and each group's path is at most 255
 * characters, so a full path runs to 5,375 characters, past every varchar
 * width OneUptime has.
 *
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. TypeORM wrote each change as DROP COLUMN +
 * ADD: that drops every owner, and the ADD of "organizationName" - NOT NULL,
 * no default - fails outright on a table holding a row. ALTER COLUMN ... TYPE
 * reaches the same schema and keeps every owner: varchar to text is
 * binary-coercible, so Postgres rewrites no row, and neither column is in an
 * index, so nothing is rebuilt - each table is locked only for its catalog
 * change. Same shape as WidenGitBranchNameColumns1808995180000.
 */
export class WidenCodeRepositoryOwnerColumns1808995240000
  implements MigrationInterface
{
  public name: string = "WidenCodeRepositoryOwnerColumns1808995240000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ALTER COLUMN "organizationName" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "repoOrganizationName" TYPE text`,
    );
  }

  /*
   * Narrowing back to 100 fails on any owner written longer since, and a cut
   * owner is another group. A pull request's copy is emptied first: an empty
   * one reads as unknown, and its readers fall back to the repository's own
   * owner. A repository's owner cannot be emptied - the column is NOT NULL -
   * so narrowing it fails while one is longer than 100: remove or reconnect
   * those repositories first.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "AIAgentTaskPullRequest" SET "repoOrganizationName" = NULL WHERE LENGTH("repoOrganizationName") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "repoOrganizationName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ALTER COLUMN "organizationName" TYPE character varying(100)`,
    );
  }
}
