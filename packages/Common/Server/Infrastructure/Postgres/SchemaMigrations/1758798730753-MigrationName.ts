import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1758798730753 implements MigrationInterface {
  public name = "MigrationName1758798730753";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD "enablePushGroups" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP COLUMN "enablePushGroups"`,
    );
  }
}
