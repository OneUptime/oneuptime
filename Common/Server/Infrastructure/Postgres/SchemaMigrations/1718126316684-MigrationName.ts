import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1718126316684 implements MigrationInterface {
  public name = "MigrationName1718126316684";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceRepository" ADD "enablePullRequests" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceRepository" DROP COLUMN "enablePullRequests"`,
    );
  }
}
