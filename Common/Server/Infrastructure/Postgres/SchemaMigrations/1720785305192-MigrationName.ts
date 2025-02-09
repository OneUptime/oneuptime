import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1720785305192 implements MigrationInterface {
  public name = "MigrationName1720785305192";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // delete all data from CopilotAction
    await queryRunner.query(`DELETE FROM "CopilotAction"`);

    await queryRunner.query(
      `ALTER TABLE "CopilotAction" RENAME COLUMN "pullRequestId" TO "copilotPullRequestId"`,
    );
    await queryRunner.query(
      `CREATE TABLE "CopilotPullRequest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "version" integer NOT NULL, "projectId" uuid NOT NULL, "codeRepositoryId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "serviceCatalogId" uuid NOT NULL, "serviceRepositoryId" uuid NOT NULL, "pullRequestId" character varying, "copilotPullRequestStatus" character varying NOT NULL, CONSTRAINT "PK_418ada04b02eeba0c196a3f3457" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da5384640778014e53c7d87f26" ON "CopilotPullRequest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b32d46897397d2cf93df83922a" ON "CopilotPullRequest" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_81c04dfb087fe1314f9b0bfbd0" ON "CopilotPullRequest" ("serviceCatalogId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e7cd28e052005c1098553f18d" ON "CopilotPullRequest" ("serviceRepositoryId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" ADD "lastCopilotRunDateTime" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP COLUMN "copilotPullRequestId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD "copilotPullRequestId" uuid NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c21417d854c9330f4cadc2bc2b" ON "CopilotAction" ("copilotPullRequestId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_da5384640778014e53c7d87f269" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_b32d46897397d2cf93df83922a0" FOREIGN KEY ("codeRepositoryId") REFERENCES "CopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_caa750ea8d9fab8b760d207e62a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_47c9d3ce65ef12e842fc487e54c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_81c04dfb087fe1314f9b0bfbd0d" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_8e7cd28e052005c1098553f18df" FOREIGN KEY ("serviceRepositoryId") REFERENCES "ServiceCopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_c21417d854c9330f4cadc2bc2b0" FOREIGN KEY ("copilotPullRequestId") REFERENCES "CopilotPullRequest"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_c21417d854c9330f4cadc2bc2b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_8e7cd28e052005c1098553f18df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_81c04dfb087fe1314f9b0bfbd0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_47c9d3ce65ef12e842fc487e54c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_caa750ea8d9fab8b760d207e62a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_b32d46897397d2cf93df83922a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_da5384640778014e53c7d87f269"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c21417d854c9330f4cadc2bc2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP COLUMN "copilotPullRequestId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD "copilotPullRequestId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotCodeRepository" DROP COLUMN "lastCopilotRunDateTime"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e7cd28e052005c1098553f18d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_81c04dfb087fe1314f9b0bfbd0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b32d46897397d2cf93df83922a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_da5384640778014e53c7d87f26"`,
    );
    await queryRunner.query(`DROP TABLE "CopilotPullRequest"`);
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" RENAME COLUMN "copilotPullRequestId" TO "pullRequestId"`,
    );
  }
}
