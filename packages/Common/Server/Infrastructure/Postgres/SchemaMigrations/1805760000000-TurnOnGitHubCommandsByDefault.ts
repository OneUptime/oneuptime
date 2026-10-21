import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "Respond to GitHub Commands" (CodeRepository.isGitHubCommandsEnabled) is
 * on for every repository unless someone turns it off: a repository the
 * GitHub App imports now starts with the column true, as the Dashboard's
 * switch shows it. Setting a column default rewrites no row.
 *
 * Rows that are already there keep what they hold. A null there already
 * meant on (GitHubCommandAuthorizer.areCommandsEnabled reads `!== false`),
 * and TurnOnUnsetGitHubCommands, right after this one, writes it as true so
 * every reader sees what the server does; a repository someone turned off
 * stays off.
 */
export class TurnOnGitHubCommandsByDefault1805760000000
  implements MigrationInterface
{
  public name: string = "TurnOnGitHubCommandsByDefault1805760000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ALTER COLUMN "isGitHubCommandsEnabled" SET DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ALTER COLUMN "isGitHubCommandsEnabled" DROP DEFAULT`,
    );
  }
}
