import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * MetricSavedView historically served only the metric LIST page. The
 * metrics EXPLORER page now mounts its own saved-views control on the
 * same table, so each row needs to say which surface it belongs to —
 * otherwise the two controls would cross-list each other's views.
 *
 * The column is nullable on purpose: every pre-existing row was created
 * by the list page, and readers treat NULL as "list". No backfill needed.
 */
export class AddViewTypeToMetricSavedView1784191414600
  implements MigrationInterface
{
  public name = "AddViewTypeToMetricSavedView1784191414600";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" ADD "viewType" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricSavedView" DROP COLUMN "viewType"`,
    );
  }
}
