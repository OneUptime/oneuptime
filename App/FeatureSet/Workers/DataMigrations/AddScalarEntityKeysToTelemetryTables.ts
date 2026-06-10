import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";
import logger from "Common/Server/Utils/Logger";

/**
 * Adds the six scalar per-entity-type key columns (contract C3 of the
 * OpenTelemetry-entities work — Internal/Docs/OpenTelemetryEntities.md):
 *
 *   serviceEntityKey, hostEntityKey, k8sPodEntityKey,
 *   k8sNodeEntityKey, k8sClusterEntityKey, containerEntityKey
 *
 * on every signal table (Log / Metric / Span / ExceptionInstance /
 * Profile / ProfileSample). Each is a non-Nullable `String CODEC(ZSTD(1))`
 * whose type default '' doubles as "this resource carries no entity of
 * that type" — old rows read '' without any backfill. The high-traffic
 * keys (service / host / k8s.pod) also get a `bloom_filter(0.01)
 * GRANULARITY 1` skip index, mirroring `idx_entity_keys`.
 *
 * Unlike the `entityKeys` array, a scalar equality predicate can feed an
 * MV/sort key — `MetricItemAggMV1mByHostV2_mv` (created by the later
 * RekeyMetricHostRollupToEntityKey migration) groups by `hostEntityKey`,
 * so THIS migration must run first.
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS + ADD INDEX
 * IF NOT EXISTS, no part rewrite, sort keys untouched. Mirrors
 * AddEntityKeysToTelemetryTables. Per-table failures are collected and
 * re-thrown at the end so a partial run is retried on the next boot.
 */
export default class AddScalarEntityKeysToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddScalarEntityKeysToTelemetryTables");
  }

  private static readonly scalarKeyColumns: ReadonlyArray<string> = [
    "serviceEntityKey",
    "hostEntityKey",
    "k8sPodEntityKey",
    "k8sNodeEntityKey",
    "k8sClusterEntityKey",
    "containerEntityKey",
  ];

  public override async migrate(): Promise<void> {
    const errors: Array<string> = [];

    await this.addScalarKeyColumns(new Log(), LogService, errors);
    await this.addScalarKeyColumns(new Metric(), MetricService, errors);
    await this.addScalarKeyColumns(new Span(), SpanService, errors);
    await this.addScalarKeyColumns(
      new ExceptionInstance(),
      ExceptionInstanceService,
      errors,
    );
    await this.addScalarKeyColumns(new Profile(), ProfileService, errors);
    await this.addScalarKeyColumns(
      new ProfileSample(),
      ProfileSampleService,
      errors,
    );

    if (errors.length > 0) {
      throw new Error(
        `AddScalarEntityKeysToTelemetryTables: ${errors.length} failure(s): ${errors.join("; ")}`,
      );
    }
  }

  private async addScalarKeyColumns<TModel extends AnalyticsBaseModel>(
    model: TModel,
    service: AnalyticsDatabaseService<TModel>,
    errors: Array<string>,
  ): Promise<void> {
    for (const columnKey of AddScalarEntityKeysToTelemetryTables.scalarKeyColumns) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === columnKey;
        },
      );

      if (!column) {
        errors.push(`${model.tableName}.${columnKey}: not declared on model`);
        continue;
      }

      try {
        // Idempotent: ADD COLUMN IF NOT EXISTS + ADD INDEX IF NOT EXISTS.
        await service.addColumnInDatabase(column);
      } catch (err) {
        logger.error(
          `AddScalarEntityKeysToTelemetryTables: failed on ${model.tableName}.${columnKey}:`,
        );
        logger.error(err as Error);
        errors.push(
          `${model.tableName}.${columnKey}: ${(err as Error).message}`,
        );
      }
    }

    logger.info(
      `AddScalarEntityKeysToTelemetryTables: ensured scalar entity-key columns on ${model.tableName}`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
