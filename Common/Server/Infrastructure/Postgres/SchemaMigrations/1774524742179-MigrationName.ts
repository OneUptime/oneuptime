import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774524742179 implements MigrationInterface {
  public name = "MigrationName1774524742179";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "pageTitle" character varying(100)`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "pageDescription" text`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "logoFileId" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD "faviconFileId" uuid`,
    );

    // Add foreign key constraints for file relations
    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_Dashboard_logoFileId" FOREIGN KEY ("logoFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" ADD CONSTRAINT "FK_Dashboard_faviconFileId" FOREIGN KEY ("faviconFileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_Dashboard_faviconFileId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP CONSTRAINT "FK_Dashboard_logoFileId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "faviconFileId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "logoFileId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "pageDescription"`,
    );

    await queryRunner.query(
      `ALTER TABLE "Dashboard" DROP COLUMN "pageTitle"`,
    );
  }
}
