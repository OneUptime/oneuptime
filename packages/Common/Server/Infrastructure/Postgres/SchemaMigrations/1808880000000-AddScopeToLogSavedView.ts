import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A saved log view is listed only on the page it was saved on (issue #5549):
 * the Logs page, or one resource's Logs tab - a Kubernetes cluster's, a
 * host's. The page is named in this column.
 *
 * Nullable, with no default and no row written: every view saved before the
 * column has no page of its own and stays on the Logs page, which is what an
 * empty scope means. Adding it is a catalogue change, not a rewrite.
 */
export class AddScopeToLogSavedView1808880000000 implements MigrationInterface {
  public name = "AddScopeToLogSavedView1808880000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD "scope" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "LogSavedView" DROP COLUMN "scope"`);
  }
}
