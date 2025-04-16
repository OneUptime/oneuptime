import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1744804990712 implements MigrationInterface {
  public name = "MigrationName1744804990712";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" ADD "postUpdatesToWorkspaceChannels" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicy" DROP COLUMN "postUpdatesToWorkspaceChannels"`,
    );
  }
}
