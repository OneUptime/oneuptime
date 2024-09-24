import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1727192530019 implements MigrationInterface {
  public name = "MigrationName1727192530019";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "createdAt" TYPE TIMESTAMP`,
    );
  }
}
