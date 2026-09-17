import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The Runbook Agent and the AI Agent became one "Runner". The product,
 * dashboard, docs and container were renamed at the time; the tables were not,
 * which left the persistence layer describing a thing that no longer exists.
 * This finishes it.
 *
 * The load-bearing part is not the ALTER TABLEs — it is the TeamPermission
 * backfill at the end. Permissions are stored as literal strings, so renaming
 * `CreateRunbookAgent` to `CreateRunner` in the enum silently revokes the
 * grant from every team that holds it unless the rows move too. The
 * ServiceCatalog → Service rename (1767966850199) renamed its permissions
 * without migrating the rows; do not repeat that.
 *
 * Table and column renames preserve data and constraints — Postgres carries
 * indexes, foreign keys and their names across a RENAME, so the old constraint
 * names survive pointing at the new tables. That is cosmetically untidy and
 * deliberately left alone: renaming a constraint is churn with no behavioural
 * effect, and every extra statement here is another thing to get wrong against
 * a live database.
 */
export class RenameRunbookAgentToRunner1785810000000
  implements MigrationInterface
{
  public name = "RenameRunbookAgentToRunner1785810000000";

  /*
   * Permission strings that live in TeamPermission rows. Every entry is a
   * grant somebody configured deliberately; losing one silently removes
   * access that a person chose to give.
   */
  private static readonly PERMISSION_MAP: ReadonlyArray<[string, string]> = [
    ["CreateRunbookAgent", "CreateRunner"],
    ["DeleteRunbookAgent", "DeleteRunner"],
    ["EditRunbookAgent", "EditRunner"],
    ["ReadRunbookAgent", "ReadRunner"],
    ["CreateRunbookAgentOwnerTeam", "CreateRunnerOwnerTeam"],
    ["DeleteRunbookAgentOwnerTeam", "DeleteRunnerOwnerTeam"],
    ["EditRunbookAgentOwnerTeam", "EditRunnerOwnerTeam"],
    ["ReadRunbookAgentOwnerTeam", "ReadRunnerOwnerTeam"],
    ["CreateRunbookAgentOwnerUser", "CreateRunnerOwnerUser"],
    ["DeleteRunbookAgentOwnerUser", "DeleteRunnerOwnerUser"],
    ["EditRunbookAgentOwnerUser", "EditRunnerOwnerUser"],
    ["ReadRunbookAgentOwnerUser", "ReadRunnerOwnerUser"],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Columns first, while the tables still have the names their columns were
     * described against — the same order the ServiceCatalog rename used.
     */
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" RENAME COLUMN "runbookAgentId" TO "runnerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" RENAME COLUMN "runbookAgentId" TO "runnerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentLabel" RENAME COLUMN "runbookAgentId" TO "runnerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunbookAgent" RENAME COLUMN "runbookAgentId" TO "runnerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunbookAgent" RENAME COLUMN "runbookAgentId" TO "runnerId"`,
    );

    // Then the tables.
    await queryRunner.query(`ALTER TABLE "RunbookAgent" RENAME TO "Runner"`);
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" RENAME TO "RunnerJob"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" RENAME TO "RunnerOwnerTeam"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" RENAME TO "RunnerOwnerUser"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentLabel" RENAME TO "RunnerLabel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunbookAgent" RENAME TO "RunbookSecretRunner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunbookAgent" RENAME TO "RunbookCredentialRunner"`,
    );

    /*
     * And the grants. Without this every team holding a Runbook Agent
     * permission loses it the moment the new code reads the enum.
     */
    for (const [
      legacy,
      replacement,
    ] of RenameRunbookAgentToRunner1785810000000.PERMISSION_MAP) {
      await queryRunner.query(
        `UPDATE "TeamPermission" SET "permission" = $1 WHERE "permission" = $2`,
        [replacement, legacy],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [
      legacy,
      replacement,
    ] of RenameRunbookAgentToRunner1785810000000.PERMISSION_MAP) {
      await queryRunner.query(
        `UPDATE "TeamPermission" SET "permission" = $1 WHERE "permission" = $2`,
        [legacy, replacement],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunner" RENAME TO "RunbookCredentialRunbookAgent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunner" RENAME TO "RunbookSecretRunbookAgent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerLabel" RENAME TO "RunbookAgentLabel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerUser" RENAME TO "RunbookAgentOwnerUser"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerOwnerTeam" RENAME TO "RunbookAgentOwnerTeam"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" RENAME TO "RunbookAgentJob"`,
    );
    await queryRunner.query(`ALTER TABLE "Runner" RENAME TO "RunbookAgent"`);

    await queryRunner.query(
      `ALTER TABLE "RunbookCredentialRunbookAgent" RENAME COLUMN "runnerId" TO "runbookAgentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunbookAgent" RENAME COLUMN "runnerId" TO "runbookAgentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentLabel" RENAME COLUMN "runnerId" TO "runbookAgentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerUser" RENAME COLUMN "runnerId" TO "runbookAgentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentOwnerTeam" RENAME COLUMN "runnerId" TO "runbookAgentId"`,
    );
  }
}
