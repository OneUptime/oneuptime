import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1720806196274 implements MigrationInterface {
  public name = "MigrationName1720806196274";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_81c04dfb087fe1314f9b0bfbd0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_8e7cd28e052005c1098553f18df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ALTER COLUMN "serviceCatalogId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ALTER COLUMN "serviceRepositoryId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_81c04dfb087fe1314f9b0bfbd0d" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_8e7cd28e052005c1098553f18df" FOREIGN KEY ("serviceRepositoryId") REFERENCES "ServiceCopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_8e7cd28e052005c1098553f18df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP CONSTRAINT "FK_81c04dfb087fe1314f9b0bfbd0d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ALTER COLUMN "serviceRepositoryId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ALTER COLUMN "serviceCatalogId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_8e7cd28e052005c1098553f18df" FOREIGN KEY ("serviceRepositoryId") REFERENCES "ServiceCopilotCodeRepository"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD CONSTRAINT "FK_81c04dfb087fe1314f9b0bfbd0d" FOREIGN KEY ("serviceCatalogId") REFERENCES "ServiceCatalog"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
