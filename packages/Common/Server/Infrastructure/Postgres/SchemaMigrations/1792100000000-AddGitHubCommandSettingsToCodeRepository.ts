import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Per-repository settings for the interactive GitHub App: whether it answers
 * commands in this repository's issues and pull requests, and which issue
 * label hands it work.
 *
 * DDL taken verbatim from `npm run generate-postgres-migration`; only the
 * class name and this comment are hand-written.
 *
 * Both columns are NULLABLE with no default, and both nulls are meaningful:
 *
 *   - A null `isGitHubCommandsEnabled` means ENABLED. Backfilling every
 *     existing row to `true` would say the same thing at the cost of a table
 *     rewrite, and defaulting to `false` would mean the feature does nothing
 *     anywhere until each repository is visited by hand. Nothing happens in a
 *     repository until somebody deliberately mentions the app, so the safe
 *     default and the useful one are the same. The reader is
 *     GitHubCommandAuthorizer.areCommandsEnabled, which spells it as
 *     `!== false`.
 *
 *   - A null `gitHubTriggerLabel` means the default label, the literal
 *     "oneuptime" (DEFAULT_GITHUB_TRIGGER_LABEL in GitHubWebhookEvents).
 */
export class AddGitHubCommandSettingsToCodeRepository1792100000000
  implements MigrationInterface
{
  public name = "AddGitHubCommandSettingsToCodeRepository1792100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "isGitHubCommandsEnabled" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "gitHubTriggerLabel" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "gitHubTriggerLabel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "isGitHubCommandsEnabled"`,
    );
  }
}
