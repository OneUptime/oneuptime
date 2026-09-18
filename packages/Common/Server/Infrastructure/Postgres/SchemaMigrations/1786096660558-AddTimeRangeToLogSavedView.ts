import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A saved log view used to carry its time selection only inside the serialized
 * `query`, where it had already been resolved to an absolute InBetween window.
 * That froze "Past 1 Hour" into the hour it happened to be when the view was
 * saved. The selection itself now lives here — the rolling range token, or the
 * absolute window when the range is Custom — and is re-resolved on every apply.
 *
 * Nullable on purpose: rows created before this column still carry their
 * absolute window in `query`, and readers fall back to it as a Custom range.
 */
export class AddTimeRangeToLogSavedView1786096660558
  implements MigrationInterface
{
  public name = "AddTimeRangeToLogSavedView1786096660558";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "LogSavedView" ADD "timeRange" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP COLUMN "timeRange"`,
    );
  }
}
