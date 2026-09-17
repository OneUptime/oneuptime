import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsDatabaseService, {
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import MetricItemAggMV1mService from "Common/Server/Services/MetricItemAggMV1mService";
import MetricItemAggMV1mByHostV2Service from "Common/Server/Services/MetricItemAggMV1mByHostV2Service";
import MetricItemAggMV1mByServiceService from "Common/Server/Services/MetricItemAggMV1mByServiceService";
import MetricItemAggMV1mByK8sClusterService from "Common/Server/Services/MetricItemAggMV1mByK8sClusterService";
import MetricItemAggMV1mByContainerService from "Common/Server/Services/MetricItemAggMV1mByContainerService";
import MetricBaselineService from "Common/Server/Services/MetricBaselineService";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import {
  applyClusterToMaterializedViewQuery,
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

export type MetricAggregateTarget = {
  service: AnalyticsDatabaseService<AnalyticsBaseModel>;
  hasRetentionDate: boolean;
};

const LEGACY_DIMENSION_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  /*
   * AnalyticsBaseModel stopped adding updatedAt before this migration, but
   * older targets can still carry it when an interrupted upgrade skipped
   * DropUpdatedAtFromTelemetryTables.
   */
  "updatedAt",
];

const RETENTION_DATE_TYPE: string = "SimpleAggregateFunction(max, DateTime)";
const DIMENSION_COMPATIBILITY_SETTING: string =
  "allow_dimensions_outside_sorting_key";

const DEFAULT_TARGETS: ReadonlyArray<MetricAggregateTarget> = [
  { service: MetricItemAggMV1mService, hasRetentionDate: true },
  { service: MetricItemAggMV1mByHostV2Service, hasRetentionDate: true },
  { service: MetricItemAggMV1mByServiceService, hasRetentionDate: true },
  {
    service: MetricItemAggMV1mByK8sClusterService,
    hasRetentionDate: true,
  },
  { service: MetricItemAggMV1mByContainerService, hasRetentionDate: true },
  { service: MetricBaselineService, hasRetentionDate: false },
];

/**
 * Converges every live AggregatingMergeTree metric target to ClickHouse's
 * strict schema invariant:
 *
 *   - every scalar dimension is part of ORDER BY;
 *   - every off-key value is an AggregateFunction or
 *     SimpleAggregateFunction measure.
 *
 * `_id`, `createdAt`, and the historical `updatedAt` are meaningless on a
 * merged aggregate row, so they are removed. `retentionDate` is meaningful,
 * but a plain DateTime lets an AggregatingMergeTree keep an arbitrary value
 * while merging partial rows. It is converted in place to
 * SimpleAggregateFunction(max, DateTime), matching maxSimpleState() in the
 * model-declared materialized views.
 *
 * The DateTime -> SimpleAggregateFunction(max, DateTime) conversion is
 * representation-compatible in ClickHouse: the stored value is still one
 * DateTime per row. This ALTER therefore preserves all AggregateFunction
 * state columns and existing rollup history; a table rebuild/backfill is not
 * necessary.
 *
 * The materialized-view trigger is detached while its target schema changes,
 * then the Distributed wrapper and trigger are recreated from the canonical
 * models. Finally the temporary ClickHouse 26.7 compatibility setting is
 * removed from the table. Every operation is idempotent so an interrupted
 * migration safely resumes on the next run.
 */
export default class MigrateMetricAggregatesToStrictSchema extends DataMigrationBase {
  private readonly targets: ReadonlyArray<MetricAggregateTarget>;

  public constructor(
    targets: ReadonlyArray<MetricAggregateTarget> = DEFAULT_TARGETS,
  ) {
    super("MigrateMetricAggregatesToStrictSchema");
    this.targets = targets;
  }

  public override async migrate(): Promise<void> {
    for (const target of this.targets) {
      await this.migrateTarget(target);
    }
  }

  private async migrateTarget(target: MetricAggregateTarget): Promise<void> {
    const service: AnalyticsDatabaseService<AnalyticsBaseModel> =
      target.service;
    const tableName: string = service.model.tableName;
    const localTableName: string = getStorageTableName(tableName);

    if (!(await ClickHouseMigrationUtil.tableExists(localTableName))) {
      logger.info(
        `${this.name}: ${localTableName} does not exist — skipping; boot schema-sync will create the strict schema.`,
      );
      return;
    }

    const legacyColumns: Array<string> = [];
    for (const column of LEGACY_DIMENSION_COLUMNS) {
      if (await service.doesColumnExist(column)) {
        legacyColumns.push(column);
      }
    }

    const createQuery: string | null =
      await ClickHouseMigrationUtil.getCreateQuery(localTableName);
    if (!createQuery) {
      throw new Error(
        `${this.name}: could not read the CREATE statement for ${localTableName}; refusing to alter a schema that could not be inspected.`,
      );
    }
    const hasCompatibilitySetting: boolean = createQuery.includes(
      DIMENSION_COMPATIBILITY_SETTING,
    );
    const retentionDateType: string = target.hasRetentionDate
      ? await service.getColumnDatabaseType("retentionDate")
      : "";

    if (
      target.hasRetentionDate &&
      this.normalizeType(retentionDateType) !==
        this.normalizeType(RETENTION_DATE_TYPE) &&
      this.normalizeType(retentionDateType) !== this.normalizeType("DateTime")
    ) {
      throw new Error(
        `${this.name}: ${localTableName}.retentionDate has unexpected type "${retentionDateType}". Expected DateTime or ${RETENTION_DATE_TYPE}; refusing a potentially destructive conversion.`,
      );
    }

    const retentionDateNeedsMigration: boolean =
      target.hasRetentionDate &&
      this.normalizeType(retentionDateType) !==
        this.normalizeType(RETENTION_DATE_TYPE);

    if (
      legacyColumns.length === 0 &&
      !retentionDateNeedsMigration &&
      !hasCompatibilitySetting
    ) {
      logger.info(`${this.name}: ${localTableName} is already strict.`);
      return;
    }

    for (const materializedView of service.model.materializedViews) {
      await service.execute(
        `DROP VIEW IF EXISTS ${materializedView.name}${onClusterClause()} SYNC`,
        MigrationExecuteOptions,
      );
    }

    const alterActions: Array<string> = legacyColumns.map(
      (column: string): string => {
        return `DROP COLUMN IF EXISTS ${column}`;
      },
    );

    if (retentionDateNeedsMigration) {
      alterActions.push(`MODIFY COLUMN retentionDate ${RETENTION_DATE_TYPE}`);
    }

    if (hasCompatibilitySetting) {
      alterActions.push(`RESET SETTING ${DIMENSION_COMPATIBILITY_SETTING}`);
    }

    await service.execute(
      `ALTER TABLE ${localTableName}${onClusterClause()} ${alterActions.join(
        ", ",
      )}`,
      MigrationExecuteOptions,
    );

    /*
     * CREATE OR REPLACE is safe here: the Distributed table stores no data.
     * Rebuilding it immediately exposes the local table's new column layout
     * instead of waiting for the next boot-time reconciliation.
     */
    await service.execute(
      service.statementGenerator.toDistributedTableCreateStatement(),
      MigrationExecuteOptions,
    );

    for (const materializedView of service.model.materializedViews) {
      await this.createMaterializedView(service, materializedView);
    }

    await this.verifyTarget(target);
    logger.info(
      `${this.name}: migrated ${localTableName} without rebuilding aggregate data.`,
    );
  }

  private async createMaterializedView(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    materializedView: MaterializedView,
  ): Promise<void> {
    await service.execute(
      applyClusterToMaterializedViewQuery(materializedView.query),
      MigrationExecuteOptions,
    );
  }

  private async verifyTarget(target: MetricAggregateTarget): Promise<void> {
    const service: AnalyticsDatabaseService<AnalyticsBaseModel> =
      target.service;
    const localTableName: string = getStorageTableName(service.model.tableName);

    for (const column of LEGACY_DIMENSION_COLUMNS) {
      if (await service.doesColumnExist(column)) {
        throw new Error(
          `${this.name}: verification failed; ${localTableName}.${column} still exists.`,
        );
      }
    }

    if (target.hasRetentionDate) {
      const retentionDateType: string =
        await service.getColumnDatabaseType("retentionDate");
      if (
        this.normalizeType(retentionDateType) !==
        this.normalizeType(RETENTION_DATE_TYPE)
      ) {
        throw new Error(
          `${this.name}: verification failed; ${localTableName}.retentionDate is "${retentionDateType}", expected ${RETENTION_DATE_TYPE}.`,
        );
      }
    }

    const createQuery: string | null =
      await ClickHouseMigrationUtil.getCreateQuery(localTableName);
    if (!createQuery) {
      throw new Error(
        `${this.name}: verification failed; could not read the CREATE statement for ${localTableName}.`,
      );
    }
    if (createQuery.includes(DIMENSION_COMPATIBILITY_SETTING)) {
      throw new Error(
        `${this.name}: verification failed; ${localTableName} still uses ${DIMENSION_COMPATIBILITY_SETTING}.`,
      );
    }
  }

  private normalizeType(type: string): string {
    return type.toLowerCase().replace(/\s+/g, "");
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
