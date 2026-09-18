import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1776940714709 implements MigrationInterface {
  public name = "MigrationName1776940714709";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "seriesFingerprint" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "Incident" ADD "seriesLabels" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "seriesFingerprint" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "Alert" ADD "seriesLabels" jsonb`);
    await queryRunner.query(
      `CREATE INDEX "IDX_865fc7905f35947b294ca36b83" ON "Incident" ("seriesFingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5705362784705d225735b1a844" ON "Alert" ("seriesFingerprint") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5705362784705d225735b1a844"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_865fc7905f35947b294ca36b83"`,
    );
    await queryRunner.query(`ALTER TABLE "Alert" DROP COLUMN "seriesLabels"`);
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "seriesFingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "seriesLabels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "seriesFingerprint"`,
    );
  }
}
