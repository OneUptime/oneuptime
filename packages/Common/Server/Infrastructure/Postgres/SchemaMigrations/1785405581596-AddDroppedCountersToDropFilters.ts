import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Adds the drop-visibility counters to both drop-filter tables.
 *
 * A drop filter used to discard telemetry with no record anywhere — no log
 * line, no metric, no counter — so a customer reporting missing logs could
 * not be told whether their own filter was responsible. These columns are
 * the customer-visible half of that fix; they are written by the ingest
 * path via a throttled atomic UPDATE (see
 * App/FeatureSet/Telemetry/Utils/DropFilterDropRecorder.ts) and surfaced on
 * the Drop Filters list and view pages.
 *
 * `droppedCount` is bigint: a sample filter on a high-volume project can
 * pass 2^31 well within a year, and silently wrapping a diagnostic counter
 * would be worse than not having one. NOT NULL DEFAULT 0 so existing rows
 * start at a meaningful zero rather than a null the UI has to special-case.
 */
export class AddDroppedCountersToDropFilters1785405581596
  implements MigrationInterface
{
  public name = "AddDroppedCountersToDropFilters1785405581596";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" ADD "droppedCount" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" ADD "lastDroppedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" ADD "droppedCount" bigint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" ADD "lastDroppedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" DROP COLUMN "lastDroppedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TraceDropFilter" DROP COLUMN "droppedCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" DROP COLUMN "lastDroppedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogDropFilter" DROP COLUMN "droppedCount"`,
    );
  }
}
