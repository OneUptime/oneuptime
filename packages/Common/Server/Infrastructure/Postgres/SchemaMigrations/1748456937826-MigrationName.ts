import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1748456937826 implements MigrationInterface {
  public name = "MigrationName1748456937826";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "StatusPage" ADD "ipWhitelist" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "ipWhitelist"`,
    );
  }
}
