import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAttemptCountToAIRun1783721121260 implements MigrationInterface {
  public name = "AddAttemptCountToAIRun1783721121260";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "attemptCount" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "attemptCount"`);
  }
}
