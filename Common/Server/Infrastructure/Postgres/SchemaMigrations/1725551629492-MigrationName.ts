import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725551629492 implements MigrationInterface {
  public name = "MigrationName1725551629492";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP COLUMN "filePath"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD "filePath" character varying NOT NULL`,
    );
  }
}
