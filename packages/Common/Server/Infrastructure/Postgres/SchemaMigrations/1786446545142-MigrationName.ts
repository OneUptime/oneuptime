import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1786446545142 implements MigrationInterface {
  public name = "MigrationName1786446545142";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * "File"."isPublic" backs a `boolean` field but was created as varchar,
     * so every row holds the STRING 'true'/'false' and every server-side
     * `!file.isPublic` gate was inert — 'false' is truthy in JS.
     *
     * Convert in place. TypeORM generates a DROP COLUMN + ADD COLUMN for
     * this change, which would discard every stored value and re-default
     * the whole table to public — the exact opposite of the fix.
     */
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" TYPE boolean USING (lower("isPublic") IN ('true', 't', 'yes', 'y', '1'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" SET DEFAULT true`,
    );

    /*
     * Probe and AI agent icons are the only consumers of the id-based
     * image route, which serves public files only. Both upload through the
     * file picker, which marks uploads private, so every icon attached
     * before this migration would 404 once the gate starts working.
     * ProbeService/AIAgentService now flip the icon public on attach; this
     * backfills the rows attached before that hook existed.
     */
    await queryRunner.query(
      `UPDATE "File" SET "isPublic" = true WHERE "_id" IN (SELECT "iconFileId" FROM "Probe" WHERE "iconFileId" IS NOT NULL UNION SELECT "iconFileId" FROM "AIAgent" WHERE "iconFileId" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" TYPE character varying(100) USING (CASE WHEN "isPublic" THEN 'true' ELSE 'false' END)`,
    );
    await queryRunner.query(
      `ALTER TABLE "File" ALTER COLUMN "isPublic" SET DEFAULT true`,
    );
  }
}
