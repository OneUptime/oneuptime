import { MigrationInterface, QueryRunner } from "typeorm";
import { IS_KUBERNETES_AGENT_RUNNER_SQL } from "./1796800000000-FoldAiSwitchesIntoEnableAi";

/*
 * Today's choice of Runner for AI code fixes, carried over to the
 * repositories: a project whose Runner had "Runs AI Code Fixes" on gets that
 * Runner as the Runner of every repository it has, so its AI work stays on
 * the Runner it chose instead of moving to a global Runner.
 *
 * Only a Runner that could take code-fix work counts:
 *
 *   - one of the project's own (not a global Runner) that is not deleted;
 *   - one that has connected at least once (a Runner that never ran took no
 *     work, so its project's fixes ran on a global Runner);
 *   - not an in-cluster Runner the Kubernetes agent chart installed, which
 *     never took code-fix work whatever its switch said: by its name marker
 *     (kubernetes-agent/..., case-insensitively) or an agent posture (an
 *     in-cluster host naming a cluster), read with the predicate an earlier
 *     migration holds to the server's own rule, row by row
 *     (IS_KUBERNETES_AGENT_RUNNER_SQL, RunnerService
 *     .isKubernetesAgentRunnerRow).
 *
 * A project with more than one takes the one that was alive most recently,
 * then the oldest; a repository that already picked a Runner keeps it.
 */
export const CODE_REPOSITORY_RUNNER_BACKFILL: string = `UPDATE "CodeRepository" AS "repository" SET "runnerId" = "chosen"."runnerId" FROM (SELECT DISTINCT ON (runner."projectId") runner."projectId", runner."_id" AS "runnerId" FROM "Runner" runner WHERE runner."canRunCodeFixTasks" = true AND runner."projectId" IS NOT NULL AND runner."isGlobalRunner" = false AND runner."deletedAt" IS NULL AND runner."lastAlive" IS NOT NULL AND NOT ${IS_KUBERNETES_AGENT_RUNNER_SQL} ORDER BY runner."projectId", runner."lastAlive" DESC, runner."createdAt" ASC, runner."_id" ASC) AS "chosen" WHERE "repository"."projectId" = "chosen"."projectId" AND "repository"."runnerId" IS NULL AND "repository"."deletedAt" IS NULL`;

/*
 * `down` puts the switch back on for every Runner a repository picks, so a
 * rollback leaves those Runners taking code-fix work, as they did.
 */
export const CODE_REPOSITORY_RUNNER_RESTORE_SWITCH: string = `UPDATE "Runner" AS "runner" SET "canRunCodeFixTasks" = true WHERE EXISTS (SELECT 1 FROM "CodeRepository" AS "repository" WHERE "repository"."runnerId" = "runner"."_id" AND "repository"."deletedAt" IS NULL)`;

/*
 * Generated with npm run generate-postgres-migration, then the backfill
 * above was put between adding the new column and dropping the old one.
 *
 * Runners: a repository picks the Runner AI works in it on
 * (CodeRepository.runnerId, empty for a global Runner), so a Runner no
 * longer has a "Runs AI Code Fixes" switch (Runner.canRunCodeFixTasks):
 * it takes code-fix work exactly while a repository of its project picks
 * it.
 *
 * The column is nullable, so it is added without a rewrite. Its index and
 * its foreign key to "Runner" are on a table projects already have
 * repositories in, so they are built online, in the migration registered
 * right after this one: AddCodeRepositoryRunnerIndexAndKey1804350000000.
 * The backfill reads each project's Runners once and writes only
 * repositories that pick none.
 */
export class AddCodeRepositoryRunner1804300000000
  implements MigrationInterface
{
  public name: string = "AddCodeRepositoryRunner1804300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CodeRepository" ADD "runnerId" uuid`);

    await queryRunner.query(CODE_REPOSITORY_RUNNER_BACKFILL);

    await queryRunner.query(
      `ALTER TABLE "Runner" DROP COLUMN "canRunCodeFixTasks"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Runner" ADD "canRunCodeFixTasks" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(CODE_REPOSITORY_RUNNER_RESTORE_SWITCH);

    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "runnerId"`,
    );
  }
}
