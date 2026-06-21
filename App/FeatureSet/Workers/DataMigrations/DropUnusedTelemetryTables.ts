import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/**
 * Drops every ClickHouse table left behind by a previous telemetry storage
 * generation. Each generation was cut to new table names (the old names
 * could not be altered in place), and the superseded tables were left to
 * drain via their retention TTL — but a TTL only deletes rows, never the
 * table itself, and tables whose models predate `retentionDate` never
 * drain at all. This reclaims the disk immediately.
 *
 * The V3 cut (MigrateTelemetryToV3PrimaryEntityId, ordered before this
 * migration) originally retained the `…V2` tables as the source for the
 * optional manual history copy. With this migration the copy source must
 * be preserved BEFORE upgrading instead — operators rename the tables to
 * `…_backup` names, which this migration does not touch. See
 * App/FeatureSet/Docs/Content/en/installation/upgrading.md
 * ('Upgrading from OneUptime 10 → 11').
 *
 * Every statement is `DROP TABLE IF EXISTS`, so this no-ops per table on
 * installs where a generation never existed (e.g. fresh V3 installs).
 * Failures are logged and skipped — a lingering table is harmless and
 * most still drain via TTL.
 */
export default class DropUnusedTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("DropUnusedTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    const unusedTables: Array<string> = [
      /*
       * 2023 originals. The plain Log/Metric/Span names were already
       * dropped by DeleteOldTelemetryTable, but that migration swallowed
       * errors — re-listed here so a silent failure back then still gets
       * cleaned up now.
       */
      "Logs",
      "Log",
      "Metric",
      "Span",

      /*
       * 2023 per-type metric tables, replaced by the unified Metric
       * table (models removed 2024-05).
       */
      "MetricGauge",
      "MetricHistogram",
      "MetricSum",

      // Mid-2024 `…Telemetry` generation.
      "LogTelemetry",
      "MetricTelemetry",
      "SpanTelemetry",
      "ExceptionTelemetry",
      "ExceptionInstanceTelemetry",

      /*
       * Monitor-metrics-by-minute feature, replaced by monitor metrics in
       * the regular Metric table (model removed 2024-11).
       */
      "MonitorMetricsByMinute",
      "MonitorMetrics",

      /*
       * Telemetry attribute side table — attributes now live directly on
       * the signal tables (model removed, DeleteAllTelemetryAttributes
       * never dropped the table).
       */
      "TelemetryAttribute",

      // 2025 `…Item` generation (plus the first-generation MonitorLog).
      "LogItem",
      "MetricItem",
      "SpanItem",
      "ExceptionItem",
      "MonitorLog",

      // Pre-V3 generation, superseded by MigrateTelemetryToV3PrimaryEntityId.
      "LogItemV2",
      "MetricItemV2",
      "SpanItemV2",
      "ExceptionItemV2",
      "ProfileItemV2",
      "ProfileSampleItemV2",
      "MonitorLogV2",
      "AuditLogV1",

      /*
       * Pre-rekey per-host metric rollup (superseded by
       * MetricItemAggMV1mByHostV2; its `_mv` trigger view was already
       * dropped by the V3 cut).
       */
      "MetricItemAggMV1mByHost",

      /*
       * Progress tracker of the removed pre-release V2 -> V3 backfill
       * engine — only exists on installs that ran a 2026-06-10/11
       * pre-release build.
       */
      "TelemetryV3CopyProgress",
    ];

    for (const table of unusedTables) {
      try {
        /*
         * max_table_size_to_drop = 0 lifts the server's 50 GB drop
         * protection (query-level since ClickHouse 23.12) — the pre-V3
         * signal tables routinely exceed it on real deployments.
         */
        await MetricService.execute(
          `DROP TABLE IF EXISTS ${table} SETTINGS max_table_size_to_drop = 0`,
        );
        logger.info(
          `DropUnusedTelemetryTables: dropped ${table} (if it existed)`,
        );
      } catch (err) {
        logger.error(`DropUnusedTelemetryTables: failed to drop ${table}:`);
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
