import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1721159743714 implements MigrationInterface {
  public name = "MigrationName1721159743714";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" ADD "techStack" jsonb`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalog" DROP COLUMN "techStack"`,
    );
  }
}
