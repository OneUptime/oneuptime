import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Status page owners can now keep their page out of Google/Bing while it stays
 * reachable by link. Indexing stays on unless it is turned off, so the column
 * defaults to true.
 *
 * ADD COLUMN ... NOT NULL DEFAULT true populates every existing row with true
 * in the same statement, so no backfill is needed and every status page that
 * exists today keeps being indexed exactly as it is now. That matters because
 * the renderers treat "not false" as indexable: a NULL row would read as
 * indexable anyway, but there is no reason to leave that to interpretation.
 */
export class AddEnableSearchEngineIndexingToStatusPage1787500000000
  implements MigrationInterface
{
  public name = "AddEnableSearchEngineIndexingToStatusPage1787500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableSearchEngineIndexing" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableSearchEngineIndexing"`,
    );
  }
}
