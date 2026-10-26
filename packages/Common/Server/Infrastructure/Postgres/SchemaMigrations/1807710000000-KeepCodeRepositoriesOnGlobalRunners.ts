import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A code repository that picks no Runner follows its project's default
 * Runner from AddCodeRepositoryGlobalRunnerPick on. Before it, such a
 * repository ran on a global Runner whatever the project's default was, so
 * in a project that already has a default Runner every repository that
 * picks none would move onto that Runner at the upgrade - and on a Runner
 * of the project's own AI runs build and test commands, which a global
 * Runner never does.
 *
 * None of them moves: each is written as having picked the Global Runner
 * itself ("isGlobalRunnerPicked" = true), which is where its work runs
 * today. Its Runner card reads Global Runner, and picking the project's
 * default there makes it follow the default from then on. A project's
 * default Runner is read as the server reads it
 * (Types/Runner/ProjectDefaultRunner): marked the default, not deleted, not
 * a global Runner, running runbooks, and not the in-cluster Runner the
 * Kubernetes agent chart installed (its server-owned name).
 *
 * Repositories in a project with no default Runner are left unset: they run
 * on a global Runner as they do today, and follow a default once the
 * project makes one - the Runner's "Set as Project Default" says so.
 *
 * Hand-written: it changes data, not the schema, so the entity-diff
 * generator (npm run generate-postgres-migration) produces nothing for it,
 * and the schema-drift check is unaffected.
 */
export class KeepCodeRepositoriesOnGlobalRunners1807710000000
  implements MigrationInterface
{
  public name: string = "KeepCodeRepositoriesOnGlobalRunners1807710000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "CodeRepository" AS "codeRepository" SET "isGlobalRunnerPicked" = true WHERE "codeRepository"."runnerId" IS NULL AND "codeRepository"."isGlobalRunnerPicked" IS NULL AND EXISTS (SELECT 1 FROM "Runner" AS "defaultRunner" WHERE "defaultRunner"."projectId" = "codeRepository"."projectId" AND "defaultRunner"."isProjectDefault" = true AND "defaultRunner"."deletedAt" IS NULL AND "defaultRunner"."isGlobalRunner" IS NOT TRUE AND "defaultRunner"."canRunRunbooks" IS NOT FALSE AND COALESCE(lower(btrim("defaultRunner"."name")), '') NOT LIKE 'kubernetes-agent/%')`,
    );
  }

  public async down(): Promise<void> {
    /*
     * Nothing to undo: the repositories it wrote run where they ran before
     * it, and the column it wrote goes with the migration before it.
     */
  }
}
