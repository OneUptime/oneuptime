import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Repositories whose "Respond to GitHub Commands" was never set hold a null
 * in CodeRepository.isGitHubCommandsEnabled, which the server has always
 * read as on (GitHubCommandAuthorizer.areCommandsEnabled: `!== false`). The
 * Dashboard's settings drew that null as a switch turned off, and saving the
 * old Repository Settings dialog without touching it wrote false, turning
 * commands off by accident.
 *
 * This writes those nulls as true: what the server already did, now what
 * every reader sees - the Dashboard, the API and Terraform. It changes no
 * repository's behaviour. A repository someone turned off (false) keeps its
 * choice.
 *
 * Hand-written: it changes data, not the schema, so the entity-diff
 * generator (npm run generate-postgres-migration) produces nothing for it,
 * and the schema-drift check is unaffected.
 */
export class TurnOnUnsetGitHubCommands1805770000000
  implements MigrationInterface
{
  public name: string = "TurnOnUnsetGitHubCommands1805770000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "CodeRepository" SET "isGitHubCommandsEnabled" = true WHERE "isGitHubCommandsEnabled" IS NULL`,
    );
  }

  public async down(): Promise<void> {
    /*
     * Nothing to undo: true is what those nulls meant, and the rows carry no
     * record of which were null.
     */
  }
}
