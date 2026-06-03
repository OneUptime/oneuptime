import DataMigrationBase from "./DataMigrationBase";
import logger from "Common/Server/Utils/Logger";

/*
 * Superseded — kept as a no-op.
 *
 * This migration originally created `MetricItemAggMV1m` plus the
 * materialized view `MetricItemAggMV1m_mv` sourcing the pre-v2
 * `MetricItem` table. Metric data later moved to `MetricItemV2`, which
 * left the rollup empty (see RebuildMetricMinuteAggregateMaterializedView)
 * — and on a fresh install the `FROM MetricItem` view can no longer be
 * created at all because that table no longer exists.
 *
 * MV creation now lives with the model
 * (`MetricItemAggMV1m.materializedViews`) and is applied idempotently by
 * `AnalyticsTableManagement.createMaterializedViews()` on every boot; the
 * target table is created by the analytics schema-sync
 * (`AnalyticsServices`). This entry is retained only so its recorded
 * execution on existing installs stays consistent — it must never
 * recreate the broken view.
 */
export default class AddMetricMinuteAggregateMaterializedView extends DataMigrationBase {
  public constructor() {
    super("AddMetricMinuteAggregateMaterializedView");
  }

  public override async migrate(): Promise<void> {
    logger.info(
      "AddMetricMinuteAggregateMaterializedView is a no-op - superseded by the model-declared MV + analytics schema-sync.",
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
