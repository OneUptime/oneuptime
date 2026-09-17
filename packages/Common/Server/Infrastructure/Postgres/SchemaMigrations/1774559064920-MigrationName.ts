import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774559064920 implements MigrationInterface {
  public name = "MigrationName1774559064920";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" ADD "webhookSecretKey" text`,
    );

    // Set secret key to existing workflow ID so current webhook URLs keep working.
    await queryRunner.query(
      `UPDATE "Workflow" SET "webhookSecretKey" = "_id"::text WHERE "webhookSecretKey" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP COLUMN "webhookSecretKey"`,
    );
  }
}
