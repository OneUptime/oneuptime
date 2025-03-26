import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1743006662678 implements MigrationInterface {
  public name = "MigrationName1743006662678";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "internalNote" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "internalNote"`,
    );
  }
}
