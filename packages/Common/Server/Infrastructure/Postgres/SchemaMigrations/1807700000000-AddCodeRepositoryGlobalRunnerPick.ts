import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A code repository that picks no Runner follows its project's default
 * Runner now, as a runbook step that picks none does
 * (Types/Runner/CodeRepositoryRunner) - it used to copy the default once,
 * when it was imported, and a later default did not move it. A repository
 * that wants a global Runner while the project has a default picks the
 * Global Runner itself: "CodeRepository"."isGlobalRunnerPicked", read only
 * for a repository that picks no Runner of its own. Nullable with no
 * default, so no row is rewritten; KeepCodeRepositoriesOnGlobalRunners
 * (next) sets it where a repository was already on a global Runner beside
 * a default.
 */
export class AddCodeRepositoryGlobalRunnerPick1807700000000
  implements MigrationInterface
{
  public name: string = "AddCodeRepositoryGlobalRunnerPick1807700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "isGlobalRunnerPicked" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "isGlobalRunnerPicked"`,
    );
  }
}
