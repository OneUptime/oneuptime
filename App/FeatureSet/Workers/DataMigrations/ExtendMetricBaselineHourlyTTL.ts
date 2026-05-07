import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * Lengthens the `MetricBaselineHourly` rolling-baseline TTL from
 * 28 days to 90 days.
 *
 * The original `AddMetricBaselineHourlyMV` migration set
 * `TTL day + INTERVAL 28 DAY`, which capped the read-time window the
 * anomaly evaluator could ask for at 28 days. That's enough for the
 * default 14-day window with headroom, but customers running
 * monthly-seasonality workloads (think weekly batch jobs, payroll,
 * billing cycles) need to compare against month-prior data — a 28-day
 * window can't see "the same day-of-month last cycle".
 *
 * The MV target tables live in `oneuptime` (the default ClickHouse
 * database). `MODIFY TTL` rewrites the engine-level TTL setting in
 * place — existing rows are not deleted immediately; the next merge
 * decides retention based on the new expression, so older data
 * already past 28 days but inside the new 90-day window survives.
 *
 * Runs after `AddIdAndTimestampsToMVTargetTables`. Idempotent: setting
 * the TTL to the same expression a second time is a no-op.
 */
export default class ExtendMetricBaselineHourlyTTL extends DataMigrationBase {
  public constructor() {
    super("ExtendMetricBaselineHourlyTTL");
  }

  public override async migrate(): Promise<void> {
    await MetricService.execute(
      `ALTER TABLE MetricBaselineHourly MODIFY TTL day + INTERVAL 90 DAY`,
    );
    logger.info("Extended MetricBaselineHourly TTL to day + INTERVAL 90 DAY");
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
