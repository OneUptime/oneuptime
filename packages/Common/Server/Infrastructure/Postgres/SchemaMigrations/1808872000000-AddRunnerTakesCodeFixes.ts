import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Runner.takesCodeFixes: whether the Runner takes OneUptime AI's code fixes,
 * as it says on every heartbeat - false while its host turns them off
 * (ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false) - so a repository is never told
 * a Runner is there to take its fixes when it is not
 * (Types/Runner/RunnerCodeFixes).
 *
 * Nullable with no default: an existing row says nothing until its Runner's
 * next heartbeat, and NULL is how a Runner of a release that does not say is
 * read - by that release.
 */
export class AddRunnerTakesCodeFixes1808872000000
  implements MigrationInterface
{
  public name: string = "AddRunnerTakesCodeFixes1808872000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD "takesCodeFixes" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runner" DROP COLUMN "takesCodeFixes"`,
    );
  }
}
