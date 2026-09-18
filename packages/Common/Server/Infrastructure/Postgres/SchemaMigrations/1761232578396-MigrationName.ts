import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1761232578396 implements MigrationInterface {
  public name = "MigrationName1761232578396";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableEmbeddedOverallStatus" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "embeddedOverallStatusToken" character varying(100)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_350d2250fb17e0dc10663de72a" ON "StatusPage" ("embeddedOverallStatusToken") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_350d2250fb17e0dc10663de72a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "embeddedOverallStatusToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableEmbeddedOverallStatus"`,
    );
  }
}
