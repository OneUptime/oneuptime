import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1742305668133 implements MigrationInterface {
  public name = "MigrationName1742305668133";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "postUpdatesToWorkspaceChannels" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
  }
}
