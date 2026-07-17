import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * OpenTelemetry stamps isMonotonic / aggregationTemporality on every
 * ClickHouse metric row at ingest, but the browser only ever reads the
 * Postgres MetricType catalog (name/description/unit). Denormalize both
 * counter-semantics fields onto the catalog so the metric explorer can
 * auto-suggest a rate view for cumulative monotonic counters.
 *
 * Both columns are nullable: NULL means "not reported yet" (rows created
 * before this migration, or metrics whose instrument type carries no
 * monotonicity — e.g. gauges). The ingest upsert only writes the fields
 * when OTel actually reported them, so NULLs are never clobbered with
 * fabricated values.
 */
export class AddCounterSemanticsToMetricType1784191414522
  implements MigrationInterface
{
  public name = "AddCounterSemanticsToMetricType1784191414522";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricType" ADD "isMonotonic" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" ADD "aggregationTemporality" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MetricType" DROP COLUMN "aggregationTemporality"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricType" DROP COLUMN "isMonotonic"`,
    );
  }
}
