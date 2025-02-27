import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1740598793630 implements MigrationInterface {
  public name = "MigrationName1740598793630";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "workspaceThreadIds" TO "workspaceSendMessageResponse"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" RENAME COLUMN "workspaceSendMessageResponse" TO "workspaceThreadIds"`,
    );
  }
}
