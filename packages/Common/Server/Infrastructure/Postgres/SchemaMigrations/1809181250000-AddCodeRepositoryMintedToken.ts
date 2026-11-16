import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * The short-lived access tokens OneUptime makes on a repository's host for
 * one AI code fix each (CodeRepositoryMintedToken, issue #8912): a GitLab
 * project access token a Runner pushes the fix's branch with, instead of the
 * connection's own token. A row keeps GitLab's id for the token - never the
 * token - its project and the connection whose token revokes it, so
 * OneUptime revokes it when the fix ends:
 *
 *   - the partial index on ("createdAt") WHERE "revokedAt" IS NULL holds
 *     only the tokens not revoked yet - those of the runs at work - for the
 *     minute's sweep that revokes the ones whose run ended;
 *   - the run, the repository and the connection are SET NULL when they go,
 *     so a row outlives them: a token is still revoked through its
 *     connection after its run or repository is deleted.
 *
 * CodeRepository.mintedTokenRefusedAt is when GitLab last refused to make
 * one for the repository: nullable, with no default, so adding it rewrites
 * no row.
 *
 * A new table, so its indexes and keys are built on an empty table and need
 * no online DDL. Nothing is backfilled: no token was made before this.
 */
export class AddCodeRepositoryMintedToken1809181250000
  implements MigrationInterface
{
  public name: string = "AddCodeRepositoryMintedToken1809181250000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CodeRepositoryMintedToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "aiRunId" uuid, "workerId" uuid NOT NULL, "codeRepositoryId" uuid, "codeRepositoryConnectionId" uuid, "provider" character varying(100) NOT NULL, "hostProjectId" character varying(500) NOT NULL, "hostTokenId" character varying(100) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "revocationAttemptedAt" TIMESTAMP WITH TIME ZONE, "revocationError" character varying(500), CONSTRAINT "PK_ad49a64c0bae21659790dcc69b2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90a2d7e868789275dfc03a546c" ON "CodeRepositoryMintedToken" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f743a5d89c1bf6d77626b3a572" ON "CodeRepositoryMintedToken" ("aiRunId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12cc34d48c11cb548943011193" ON "CodeRepositoryMintedToken" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2a2aab1ab6572fb5330e1cca5a" ON "CodeRepositoryMintedToken" ("codeRepositoryConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31f2d081ab44d54dd530992e2d" ON "CodeRepositoryMintedToken" ("createdAt") WHERE "revokedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "mintedTokenRefusedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" ADD CONSTRAINT "FK_90a2d7e868789275dfc03a546c5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" ADD CONSTRAINT "FK_f743a5d89c1bf6d77626b3a5722" FOREIGN KEY ("aiRunId") REFERENCES "AIRun"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" ADD CONSTRAINT "FK_12cc34d48c11cb548943011193d" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" ADD CONSTRAINT "FK_2a2aab1ab6572fb5330e1cca5a1" FOREIGN KEY ("codeRepositoryConnectionId") REFERENCES "CodeRepositoryConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" DROP CONSTRAINT "FK_2a2aab1ab6572fb5330e1cca5a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" DROP CONSTRAINT "FK_12cc34d48c11cb548943011193d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" DROP CONSTRAINT "FK_f743a5d89c1bf6d77626b3a5722"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepositoryMintedToken" DROP CONSTRAINT "FK_90a2d7e868789275dfc03a546c5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "mintedTokenRefusedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31f2d081ab44d54dd530992e2d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2a2aab1ab6572fb5330e1cca5a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12cc34d48c11cb548943011193"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f743a5d89c1bf6d77626b3a572"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90a2d7e868789275dfc03a546c"`,
    );
    await queryRunner.query(`DROP TABLE "CodeRepositoryMintedToken"`);
  }
}
