import { MigrationInterface, QueryRunner } from "typeorm";

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
 *     in-cluster host naming a cluster) - read as loosely as the server
 *     reads it, so a doubtful row is left out (RunnerService
 *     .isKubernetesAgentRunnerRow).
 *
 * A project with more than one takes the one that was alive most recently,
 * then the oldest; a repository that already picked a Runner keeps it.
 */
export const CODE_REPOSITORY_RUNNER_BACKFILL: string = `UPDATE "CodeRepository" AS "repository" SET "runnerId" = "chosen"."runnerId" FROM (SELECT DISTINCT ON ("runner"."projectId") "runner"."projectId", "runner"."_id" AS "runnerId" FROM "Runner" AS "runner" WHERE "runner"."canRunCodeFixTasks" = true AND "runner"."projectId" IS NOT NULL AND "runner"."isGlobalRunner" = false AND "runner"."deletedAt" IS NULL AND "runner"."lastAlive" IS NOT NULL AND lower(btrim("runner"."name")) NOT LIKE 'kubernetes-agent/%' AND NOT (COALESCE("runner"."hostInfo" -> 'kubernetes' ->> 'inCluster', '') = 'true' AND COALESCE(btrim("runner"."hostInfo" -> 'kubernetes' ->> 'clusterIdentifier'), '') <> '') ORDER BY "runner"."projectId", "runner"."lastAlive" DESC, "runner"."createdAt" ASC, "runner"."_id" ASC) AS "chosen" WHERE "repository"."projectId" = "chosen"."projectId" AND "repository"."runnerId" IS NULL AND "repository"."deletedAt" IS NULL`;

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
 * "CodeRepository" is a small table: the column is nullable (added without
 * a rewrite) and its index is built in place. The backfill reads each
 * project's Runners once and writes only repositories that pick none.
 */
export class AddCodeRepositoryRunner1804300000000
  implements MigrationInterface
{
  public name: string = "AddCodeRepositoryRunner1804300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CodeRepository" ADD "runnerId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_119124a9f13918c61c08e91ec9" ON "CodeRepository" ("runnerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD CONSTRAINT "FK_119124a9f13918c61c08e91ec96" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

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
      `ALTER TABLE "CodeRepository" DROP CONSTRAINT "FK_119124a9f13918c61c08e91ec96"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_119124a9f13918c61c08e91ec9"`,
    );
    await queryRunner.query(`ALTER TABLE "CodeRepository" DROP COLUMN "runnerId"`);
  }
}
