import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * GHSA-xx95-gmcf-7q86 — data-side remediation.
 *
 * The code fix closes every way to write an installation ID that a project
 * does not own, and re-derives the binding from Project.gitHubAppInstallationId
 * before minting a token. Neither reaches rows that are ALREADY in the
 * database. Before the fix a caller could put any installation ID on a
 * CodeRepository row in a project they owned, and several code paths (the AI
 * chat read/write tools, the pull-request sync worker) mint from that column
 * directly. So any such row left in place stays a live cross-tenant token.
 *
 * This migration NULLs the installation ID on every repository row that
 * contradicts its own project. That is decidable and safe: the project's own
 * binding is the authority, so a row disagreeing with it was either poisoned
 * or is stale after a reinstall. Nothing is deleted — the repository row keeps
 * its name, commands and history, and reconnecting the GitHub App repopulates
 * the ID through the verified callback.
 *
 * Hand-written on purpose: this changes no schema, so the entity-diff
 * generator (npm run generate-postgres-migration) produces nothing for it, and
 * the schema-drift check is unaffected.
 *
 * WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
 *
 * It does not clear Project.gitHubAppInstallationId. Every one of those was
 * written by the old, unverified callback, but they are overwhelmingly
 * legitimate and nulling them would disconnect every existing GitHub
 * integration. There is also no way in SQL to tell a forged binding from a
 * real one.
 *
 * Operators who want to audit for the callback-forgery path should look for
 * one installation bound to several projects, which is the fingerprint (it is
 * legal — an org can connect one installation to several projects — so review
 * the results, do not delete them):
 *
 *   SELECT "gitHubAppInstallationId", count(*), array_agg("_id")
 *   FROM "Project"
 *   WHERE "gitHubAppInstallationId" IS NOT NULL AND "deletedAt" IS NULL
 *   GROUP BY "gitHubAppInstallationId" HAVING count(*) > 1;
 */
export class QuarantineUnboundGitHubInstallations1786300000000
  implements MigrationInterface
{
  public name = "QuarantineUnboundGitHubInstallations1786300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "CodeRepository" AS cr
      SET "gitHubAppInstallationId" = NULL
      FROM "Project" AS p
      WHERE cr."projectId" = p."_id"
        AND cr."gitHubAppInstallationId" IS NOT NULL
        AND (
          p."gitHubAppInstallationId" IS NULL
          OR p."gitHubAppInstallationId" <> cr."gitHubAppInstallationId"
        )
    `);
  }

  public async down(): Promise<void> {
    /*
     * Not reversible, and must not be. The quarantined values are exactly the
     * bindings that could not be justified; restoring them would restore the
     * vulnerability, and the rows carry no record of what was cleared.
     */
  }
}
