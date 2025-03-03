import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1740597525803 implements MigrationInterface {
  public name = "MigrationName1740597525803";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "workspaceThreadIds" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "workspaceThreadIds"`,
    );
  }
}
