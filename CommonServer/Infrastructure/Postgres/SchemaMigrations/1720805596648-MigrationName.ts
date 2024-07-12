import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1720805596648 implements MigrationInterface {
  public name = "MigrationName1720805596648";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" ADD "isSetupPullRequest" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotPullRequest" DROP COLUMN "isSetupPullRequest"`,
    );
  }
}
