import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1720812937067 implements MigrationInterface {
  public name = "MigrationName1720812937067";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP CONSTRAINT "FK_c21417d854c9330f4cadc2bc2b0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ALTER COLUMN "copilotPullRequestId" DROP NOT NULL`,
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
      `ALTER TABLE "CopilotAction" ALTER COLUMN "copilotPullRequestId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD CONSTRAINT "FK_c21417d854c9330f4cadc2bc2b0" FOREIGN KEY ("copilotPullRequestId") REFERENCES "CopilotPullRequest"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
