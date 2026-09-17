import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1749133333893 implements MigrationInterface {
  public name = "MigrationName1749133333893";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "slackWorkspaceName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "slackWorkspaceName"`,
    );
  }
}
