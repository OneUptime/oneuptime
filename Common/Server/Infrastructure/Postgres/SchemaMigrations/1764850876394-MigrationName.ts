import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1764850876394 implements MigrationInterface {
  public name = "MigrationName1764850876394";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "postmortemPostedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "postmortemPostedAt"`,
    );
  }
}
