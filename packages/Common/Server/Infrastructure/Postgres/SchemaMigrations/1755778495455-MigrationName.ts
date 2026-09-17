import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1755778495455 implements MigrationInterface {
  public name = "MigrationName1755778495455";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "microsoftTeamsWorkspaceName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "microsoftTeamsWorkspaceName" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "microsoftTeamsWorkspaceName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ADD "microsoftTeamsWorkspaceName" character varying(100)`,
    );
  }
}
