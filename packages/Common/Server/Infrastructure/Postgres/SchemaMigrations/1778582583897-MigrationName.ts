import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778582583897 implements MigrationInterface {
  public name = "MigrationName1778582583897";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "lastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Service" DROP COLUMN "lastSeenAt"`);
  }
}
