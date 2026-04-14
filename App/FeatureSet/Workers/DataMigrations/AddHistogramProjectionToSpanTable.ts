import DataMigrationBase from "./DataMigrationBase";
import SpanService from "Common/Server/Services/SpanService";
import logger from "Common/Server/Utils/Logger";

/**
 * Adds proj_hist_by_minute projection to SpanItemV2 to make
 * histogram queries scan tiny pre-aggregated rows instead of the
 * full span table. The materialization runs asynchronously
 * (mutations_sync=0) so the migration won't time out on large tables.
 *
 * Depends on isRootSpan column existing — run AddIsRootSpanToSpanTable first.
 */
export default class AddHistogramProjectionToSpanTable extends DataMigrationBase {
  public constructor() {
    super("AddHistogramProjectionToSpanTable");
  }

  public override async migrate(): Promise<void> {
    // Step 1: Add the projection (IF NOT EXISTS makes it safe to re-run)
    await SpanService.execute(
      `ALTER TABLE SpanItemV2 ADD PROJECTION IF NOT EXISTS proj_hist_by_minute (
        SELECT projectId, toStartOfMinute(startTime) AS minute, serviceId, statusCode, isRootSpan, count() AS cnt
        GROUP BY projectId, minute, serviceId, statusCode, isRootSpan
      )`,
    );
    logger.info(
      "Added projection proj_hist_by_minute on SpanItemV2 (definition only)",
      { service: "workers" },
    );

    /*
     * Step 2: Materialize the projection for existing parts.
     * mutations_sync=0 returns immediately and runs in background — required
     * because materializing on a 1.8B+ row table can take hours.
     */
    await SpanService.execute(
      `ALTER TABLE SpanItemV2 MATERIALIZE PROJECTION proj_hist_by_minute SETTINGS mutations_sync=0`,
    );
    logger.info(
      "Started async materialization of proj_hist_by_minute on SpanItemV2",
      { service: "workers" },
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
