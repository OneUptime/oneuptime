import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import { formatDatabaseEndpoint } from "../../../Types/DatabaseServer/DatabaseEndpoint";
import DatabaseServerEndpointService from "../../Services/DatabaseServerEndpointService";
import { TableHealthTarget } from "./TableHealthTarget";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import {
  findNewPersonalDataColumns,
  mergeNewPersonalDataColumns,
  NewPersonalDataColumn,
} from "../../../Types/DataObservability/DataColumnSensitivity";
import { applyRowCountTolerance } from "../../../Types/DataObservability/DataAlertFeedback";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import { DataAssetFeedEventType } from "../../../Models/DatabaseModels/DataAssetFeed";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import {
  Green500,
  Red500,
  Yellow500,
  Blue500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DataAssetColumn,
  DataAssetColumnChange,
  DataAssetColumnChangeKind,
  diffDataAssetColumns,
  isBreakingColumnChange,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";
import {
  DataAssetReadState,
  DataAssetReadTracking,
  trackDataAssetReads,
} from "../../../Types/DataObservability/DataAssetReads";
import { doesDataAssetKindHoldRows } from "../../../Types/DataObservability/DataAssetKind";
import {
  DATA_OBSERVABILITY_METRICS,
  DataObservabilityAttribute,
  DataObservabilityMetricName,
  getDataTableKey,
  ROW_COUNT_CHANGE_MIN_ROWS,
} from "../../../Types/DataObservability/DataObservabilityMetric";
import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "../../../Types/DataObservability/DataAssetFreshness";
import { JSONObject } from "../../../Types/JSON";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import DataAssetFeedService from "../../Services/DataAssetFeedService";
import DataAssetService from "../../Services/DataAssetService";
import DataStoreService from "../../Services/DataStoreService";
import MetricService from "../../Services/MetricService";
import logger from "../Logger";
import { isBilledAsWatchedTable } from "../../../Types/DataObservability/DataAssetKind";
import CollectedLineage from "./CollectedLineage";
import WatchedTableLimit from "./WatchedTableLimit";
import DataWarehouseSpendIngest from "./DataWarehouseSpendIngest";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import TelemetryUtil from "../Telemetry/Telemetry";
import {
  FAILED_COLLECTION_RETRY_IN_MINUTES,
  getNextCollectionTime,
  TABLE_HEALTH_COLLECTION_INTERVAL_IN_MINUTES,
} from "./DataObservabilityProbeCollect";
import { CollectedTable, TableHealthSnapshot } from "./TableHealthCollector";

/*
 * WHAT A COLLECTION OF A STORE'S TABLES MEANS, WRITTEN DOWN.
 *
 * A collection (TableHealthCollector, on a worker or a probe) is a list of
 * the store's tables as the engine's catalog describes them now. This
 * compares it with what the last one left behind and writes:
 *
 *  - one DataAsset per table: found ones created, known ones updated only
 *    when something they show moved, missing ones marked dropped - but only
 *    from a complete collection, since a list cut at its limit proves
 *    nothing about the tables past it;
 *  - the table's timeline (DataAssetFeed): found, dropped, restored, and
 *    every column added, removed, renamed, retyped or made nullable;
 *  - one metric row per table and measure (row count, size, seconds since
 *    the last change, schema changes) in ClickHouse, under the store as
 *    primary entity, which the baseline view learns and Data monitors read.
 *
 * WHEN A TABLE LAST CHANGED. MySQL and SQL Server say it ("seconds ago", by
 * the database's own clock). PostgreSQL keeps no such time, only counters
 * of the rows inserted, updated and deleted: when they move between two
 * collections, the table changed in between, and the collection's time is
 * written - late by at most one interval, never early, so a table is never
 * called fresh that is not. A row count that moves says the same where no
 * counter can be read. A counter that goes down (statistics reset, a
 * restart) says nothing, and the next collection compares with it.
 *
 * Each change also teaches the table's usual update interval, a running
 * average, which the table's page shows and a freshness check compares to.
 */

// Most timeline entries one table gets from one collection; the rest are summed up.
export const MAX_COLUMN_FEED_ITEMS_PER_TABLE: number = 20;
// The most metric rows inserted in one statement.
const METRIC_ROWS_PER_INSERT: number = 5_000;
// How much a new interval moves the learned one.
const INTERVAL_LEARNING_RATE: number = 0.3;
// What the store's message and name columns hold.
const MAX_MESSAGE_LENGTH: number = 500;
const MAX_STORE_NAME_LENGTH: number = 100;

export enum TableHealthStatus {
  Collected = "Collected",
  Failed = "Failed",
}

export interface IngestStore {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  kind: string;
}

export interface PreviousAssetState {
  id: ObjectID;
  columns: Array<DataAssetColumn> | null;
  rowCount: number | null;
  sizeInBytes: number | null;
  lastChangedAt: Date | null;
  updateIntervalInSeconds: number | null;
  writeCount: number | null;
  isDropped: boolean;
  // When it was last read, and since when it has had none (DataAssetReads).
  reads?: DataAssetReadState | undefined;
  rowCountChangeTolerancePercent?: number | null | undefined;
}

export interface AssetPlan {
  lastChangedAt: Date | null;
  updateIntervalInSeconds: number | null;
  reads: DataAssetReadState;
  columns: Array<DataAssetColumn> | null;
  columnChanges: Array<DataAssetColumnChange>;
  collectionState: JSONObject;
  isRestored: boolean;
  // Whether anything the asset shows moved, so its row must be written.
  needsWrite: boolean;
}

export interface TableHealthIngestResult {
  created: number;
  updated: number;
  dropped: number;
  restored: number;
  schemaChanges: number;
  metricRows: number;
}

function readStoredCount(
  state: JSONObject | undefined,
  key: "writeCount" | "readCount",
): number | null {
  const value: unknown = state?.[key];

  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function areColumnsKnown(state: JSONObject | undefined): boolean {
  return state?.["columnsKnown"] !== false;
}

export function toPreviousAssetState(asset: DataAsset): PreviousAssetState {
  return {
    id: asset.id!,
    columns: areColumnsKnown(asset.collectionState)
      ? readDataAssetColumns(asset.columns)
      : null,
    rowCount: typeof asset.rowCount === "number" ? asset.rowCount : null,
    rowCountChangeTolerancePercent:
      asset.rowCountChangeTolerancePercent ?? null,
    sizeInBytes:
      typeof asset.sizeInBytes === "number" ? asset.sizeInBytes : null,
    lastChangedAt: asset.lastChangedAt
      ? OneUptimeDate.fromString(asset.lastChangedAt)
      : null,
    updateIntervalInSeconds:
      typeof asset.updateIntervalInSeconds === "number"
        ? asset.updateIntervalInSeconds
        : null,
    writeCount: readStoredCount(asset.collectionState, "writeCount"),
    isDropped: asset.isDropped === true,
    reads: {
      readCount: readStoredCount(asset.collectionState, "readCount"),
      lastReadAt: asset.lastReadAt
        ? OneUptimeDate.fromString(asset.lastReadAt)
        : null,
      unreadSince: asset.unreadSince
        ? OneUptimeDate.fromString(asset.unreadSince)
        : null,
    },
  };
}

/*
 * When the table last changed, as this collection can tell: the engine's
 * own time, else the collection's time when a counter or the row count
 * moved, else unknown.
 */
export function detectChangeTime(
  previous: PreviousAssetState | null,
  table: CollectedTable,
  collectedAt: Date,
): Date | null {
  // The table's own column says when its data changed: not read this time, the last answer stands.
  if (table.isChangeTimeFromData) {
    return table.secondsSinceChange !== null
      ? new Date(collectedAt.getTime() - table.secondsSinceChange * 1000)
      : previous?.lastChangedAt || null;
  }

  const counterMoved: boolean =
    previous !== null &&
    table.writeCount !== null &&
    previous.writeCount !== null &&
    table.writeCount > previous.writeCount;

  if (table.secondsSinceChange !== null) {
    const changeAt: Date = new Date(
      collectedAt.getTime() - table.secondsSinceChange * 1000,
    );

    /*
     * A time that only inserts move (MongoDB's newest ObjectId) misses an
     * update: a write counter that moved while the time stood still says
     * the table changed since the last collection.
     */
    if (
      counterMoved &&
      previous?.lastChangedAt &&
      changeAt.getTime() <= previous.lastChangedAt.getTime()
    ) {
      return collectedAt;
    }

    return changeAt;
  }

  if (!previous) {
    return null;
  }

  if (counterMoved) {
    return collectedAt;
  }

  if (
    table.estimatedRows !== null &&
    previous.rowCount !== null &&
    table.estimatedRows !== previous.rowCount
  ) {
    return collectedAt;
  }

  // An engine with no write counter (Redshift, Snowflake): its bytes moved.
  if (
    table.writeCount === null &&
    table.sizeInBytes !== null &&
    previous.sizeInBytes !== null &&
    table.sizeInBytes !== previous.sizeInBytes
  ) {
    return collectedAt;
  }

  return null;
}

export function learnUpdateInterval(data: {
  previousIntervalInSeconds: number | null;
  previousChangeAt: Date | null;
  changeAt: Date;
}): number | null {
  if (!data.previousChangeAt) {
    return data.previousIntervalInSeconds;
  }

  const seconds: number =
    (data.changeAt.getTime() - data.previousChangeAt.getTime()) / 1000;

  // A clock's jitter, not a change.
  if (seconds < 1) {
    return data.previousIntervalInSeconds;
  }

  if (data.previousIntervalInSeconds === null) {
    return Math.round(seconds);
  }

  return Math.max(
    1,
    Math.round(
      data.previousIntervalInSeconds * (1 - INTERVAL_LEARNING_RATE) +
        seconds * INTERVAL_LEARNING_RATE,
    ),
  );
}

export function planAssetUpdate(
  previous: PreviousAssetState | null,
  table: CollectedTable,
  collectedAt: Date,
  // How long the engine's counters have counted for (TableHealthSnapshot).
  secondsSinceStatsReset?: number | null | undefined,
): AssetPlan {
  const changeAt: Date | null = detectChangeTime(previous, table, collectedAt);
  const previousChangeAt: Date | null = previous?.lastChangedAt || null;

  let lastChangedAt: Date | null = previousChangeAt;
  let updateIntervalInSeconds: number | null =
    previous?.updateIntervalInSeconds ?? null;

  if (changeAt && (!previousChangeAt || changeAt > previousChangeAt)) {
    // A second's difference is the engine rounding the same change, not a new one.
    const isNewChange: boolean =
      !previousChangeAt ||
      changeAt.getTime() - previousChangeAt.getTime() >= 1000;

    if (isNewChange) {
      updateIntervalInSeconds = learnUpdateInterval({
        previousIntervalInSeconds: updateIntervalInSeconds,
        previousChangeAt,
        changeAt,
      });
      lastChangedAt = changeAt;
    }
  }

  const columnChanges: Array<DataAssetColumnChange> =
    previous && previous.columns !== null && table.columns !== null
      ? diffDataAssetColumns(previous.columns, table.columns)
      : [];

  const reads: DataAssetReadTracking = trackDataAssetReads({
    previous: previous?.reads || null,
    readCount: table.readCount,
    secondsSinceRead: table.secondsSinceRead,
    secondsSinceStatsReset,
    collectedAt,
  });

  const collectionState: JSONObject = {
    // A counter that went down was reset: the next collection compares with the new value.
    writeCount: table.writeCount,
    // The read counter as of the last read kept, to the hour (DataAssetReads).
    readCount: reads.state.readCount,
    columnsKnown: table.columns !== null,
  };

  const isRestored: boolean = previous?.isDropped === true;

  const needsWrite: boolean =
    !previous ||
    isRestored ||
    columnChanges.length > 0 ||
    (table.columns !== null && previous.columns === null) ||
    table.estimatedRows !== previous.rowCount ||
    table.sizeInBytes !== previous.sizeInBytes ||
    (lastChangedAt?.getTime() ?? null) !==
      (previousChangeAt?.getTime() ?? null) ||
    updateIntervalInSeconds !== previous.updateIntervalInSeconds ||
    table.writeCount !== previous.writeCount ||
    reads.isChanged;

  return {
    lastChangedAt,
    updateIntervalInSeconds,
    reads: reads.state,
    columns: table.columns,
    columnChanges,
    collectionState,
    isRestored,
    needsWrite,
  };
}

function describeColumnChange(change: DataAssetColumnChange): {
  markdown: string;
  eventType: DataAssetFeedEventType;
  color: Color;
} {
  switch (change.kind) {
    case DataAssetColumnChangeKind.Added:
      return {
        eventType: DataAssetFeedEventType.ColumnAdded,
        color: Green500,
        markdown:
          mdText`Column **${change.column}** (${FeedMarkdown.code(change.dataType || "")}) was added.`.toString(),
      };
    case DataAssetColumnChangeKind.Removed:
      return {
        eventType: DataAssetFeedEventType.ColumnRemoved,
        color: Red500,
        markdown:
          mdText`Column **${change.column}** (${FeedMarkdown.code(change.previousDataType || "")}) was removed.`.toString(),
      };
    case DataAssetColumnChangeKind.Renamed:
      return {
        eventType: DataAssetFeedEventType.ColumnRenamed,
        color: Yellow500,
        markdown:
          mdText`Column **${change.previousName || ""}** was renamed to **${change.column}**.`.toString(),
      };
    case DataAssetColumnChangeKind.TypeChanged:
      return {
        eventType: DataAssetFeedEventType.ColumnTypeChanged,
        color: Yellow500,
        markdown:
          mdText`Column **${change.column}** changed type from ${FeedMarkdown.code(change.previousDataType || "")} to ${FeedMarkdown.code(change.dataType || "")}.`.toString(),
      };
    case DataAssetColumnChangeKind.NullabilityChanged:
    default:
      return {
        eventType: DataAssetFeedEventType.ColumnNullabilityChanged,
        color: change.isNullable ? Yellow500 : Blue500,
        markdown: change.isNullable
          ? mdText`Column **${change.column}** now allows empty values.`.toString()
          : mdText`Column **${change.column}** no longer allows empty values.`.toString(),
      };
  }
}

function buildMetricRow(data: {
  store: IngestStore;
  assetId: ObjectID;
  table: CollectedTable;
  metricName: DataObservabilityMetricName;
  value: number;
  collectedAt: Date;
  retentionDays: number;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.collectedAt);
  const attributes: JSONObject = {
    [DataObservabilityAttribute.DataStoreId]: data.store.id.toString(),
    [DataObservabilityAttribute.DataStoreName]: data.store.name,
    [DataObservabilityAttribute.DataStoreKind]: data.store.kind,
    [DataObservabilityAttribute.TableId]: data.assetId.toString(),
    [DataObservabilityAttribute.TableSchema]: data.table.schema,
    [DataObservabilityAttribute.TableName]: data.table.name,
    [DataObservabilityAttribute.TableKey]: getDataTableKey(
      data.table.schema,
      data.table.name,
    ),
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.store.projectId.toString(),
    primaryEntityId: data.store.id.toString(),
    primaryEntityType: ServiceType.DataStore,
    name: data.metricName,
    aggregationTemporality: null,
    metricPointType: MetricPointType.Gauge,
    time: time,
    startTime: null,
    timeUnixNano: OneUptimeDate.toUnixNano(data.collectedAt).toString(),
    startTimeUnixNano: null,
    attributes: attributes,
    attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
    isMonotonic: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    value: data.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(data.collectedAt, data.retentionDays),
    ),
  } as JSONObject;
}

// The metric values one table's collection gives, absent ones left out.
export function getTableMetricValues(data: {
  table: CollectedTable;
  plan: AssetPlan;
  collectedAt: Date;
  // The row count the collection before saw; null for a table seen for the first time.
  previousRowCount?: number | null | undefined;
  // A change this small counts as none: raised by "not an issue" on such an alert.
  rowCountChangeTolerancePercent?: number | null | undefined;
}): Array<{ name: DataObservabilityMetricName; value: number }> {
  const values: Array<{ name: DataObservabilityMetricName; value: number }> =
    [];
  const holdsRows: boolean = doesDataAssetKindHoldRows(data.table.kind);

  if (holdsRows && data.table.estimatedRows !== null) {
    values.push({
      name: DataObservabilityMetricName.RowCount,
      value: data.table.estimatedRows,
    });
  }

  if (holdsRows && data.table.sizeInBytes !== null) {
    values.push({
      name: DataObservabilityMetricName.Size,
      value: data.table.sizeInBytes,
    });
  }

  if (holdsRows && data.plan.lastChangedAt) {
    values.push({
      name: DataObservabilityMetricName.SecondsSinceChange,
      value: Math.max(
        0,
        Math.round(
          (data.collectedAt.getTime() - data.plan.lastChangedAt.getTime()) /
            1000,
        ),
      ),
    });
  }

  values.push({
    name: DataObservabilityMetricName.SchemaChanges,
    value: data.plan.columnChanges.length,
  });

  values.push({
    name: DataObservabilityMetricName.BreakingSchemaChanges,
    value: data.table.columnsAreInferred
      ? 0
      : data.plan.columnChanges.filter(isBreakingColumnChange).length,
  });

  if (holdsRows) {
    const freshness: DataAssetFreshnessResult = getDataAssetFreshness({
      kind: data.table.kind,
      lastChangedAt: data.plan.lastChangedAt,
      updateIntervalInSeconds: data.plan.updateIntervalInSeconds,
      now: data.collectedAt,
    });

    // Only once the table's rhythm is learned: before that, late is unknown, not 0.
    if (
      freshness.freshness === DataAssetFreshness.Fresh ||
      freshness.freshness === DataAssetFreshness.Late
    ) {
      values.push({
        name: DataObservabilityMetricName.OverdueSeconds,
        value: freshness.overdueBySeconds,
      });
    }
  }

  const previousRowCount: number | null = data.previousRowCount ?? null;

  if (
    holdsRows &&
    data.table.estimatedRows !== null &&
    previousRowCount !== null &&
    previousRowCount >= ROW_COUNT_CHANGE_MIN_ROWS
  ) {
    values.push({
      name: DataObservabilityMetricName.RowCountChangePercent,
      value: applyRowCountTolerance(
        Math.round(
          ((data.table.estimatedRows - previousRowCount) / previousRowCount) *
            10000,
        ) / 100,
        data.rowCountChangeTolerancePercent,
      ),
    });
  }

  return values;
}

export default class TableHealthIngest {
  public static async recordSnapshot(data: {
    store: IngestStore;
    snapshot: TableHealthSnapshot;
  }): Promise<TableHealthIngestResult> {
    const { store, snapshot } = data;
    const collectedAt: Date = OneUptimeDate.fromString(snapshot.collectedAt);
    const result: TableHealthIngestResult = {
      created: 0,
      updated: 0,
      dropped: 0,
      restored: 0,
      schemaChanges: 0,
      metricRows: 0,
    };

    const existing: Array<DataAsset> = await DataAssetService.findAllBy({
      query: { projectId: store.projectId, dataStoreId: store.id },
      select: {
        _id: true,
        assetKey: true,
        columns: true,
        rowCount: true,
        rowCountChangeTolerancePercent: true,
        sizeInBytes: true,
        lastChangedAt: true,
        updateIntervalInSeconds: true,
        collectionState: true,
        isDropped: true,
        lastReadAt: true,
        unreadSince: true,
      },
      props: { isRoot: true },
    });

    const existingByKey: Map<string, DataAsset> = new Map();

    for (const asset of existing) {
      if (asset.assetKey) {
        existingByKey.set(asset.assetKey, asset);
      }
    }

    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    const metricRows: Array<JSONObject> = [];
    const seenKeys: Set<string> = new Set();
    // The store's watched tables after this collection, by key: what lineage resolves against.
    const assetIdByKey: Map<string, ObjectID> = new Map();
    // Columns that appeared whose names say they hold personal data: Data Security's to judge.
    const newPersonalDataColumns: Array<NewPersonalDataColumn> = [];
    // What the project may add, asked only when there is a new table to add.
    let roomForNewTables: number = snapshot.tables.some(
      (table: CollectedTable): boolean => {
        return (
          isBilledAsWatchedTable(table.kind) &&
          !existingByKey.has(getDataTableKey(table.schema, table.name))
        );
      },
    )
      ? await WatchedTableLimit.getRoomForNewTables(store.projectId)
      : Number.POSITIVE_INFINITY;
    let tablesLeftOut: number = 0;

    for (const table of snapshot.tables) {
      const key: string = getDataTableKey(table.schema, table.name);

      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);

      try {
        const known: DataAsset | undefined = existingByKey.get(key);
        const previous: PreviousAssetState | null = known
          ? toPreviousAssetState(known)
          : null;
        const plan: AssetPlan = planAssetUpdate(
          previous,
          table,
          collectedAt,
          snapshot.secondsSinceStatsReset,
        );
        let assetId: ObjectID;

        if (!known || !previous) {
          if (isBilledAsWatchedTable(table.kind)) {
            if (roomForNewTables <= 0) {
              tablesLeftOut++;
              seenKeys.delete(key);
              continue;
            }

            roomForNewTables--;
          }

          assetId = await this.createAsset({ store, table, plan, collectedAt });
          result.created++;

          // A table new to a store we already read. A store's first collection finds nothing new.
          if (existingByKey.size > 0 && !table.columnsAreInferred) {
            newPersonalDataColumns.push(
              ...findNewPersonalDataColumns({
                tableKey: key,
                columnNames: (table.columns || []).map(
                  (column: DataAssetColumn): string => {
                    return column.name;
                  },
                ),
                seenAt: collectedAt,
              }),
            );
          }
        } else {
          assetId = previous.id;

          if (plan.needsWrite) {
            await this.updateAsset({ assetId, table, plan, collectedAt });
            result.updated++;
          }

          if (plan.isRestored) {
            result.restored++;
            await DataAssetFeedService.createDataAssetFeedItem({
              dataAssetId: assetId,
              projectId: store.projectId,
              dataAssetFeedEventType: DataAssetFeedEventType.AssetRestored,
              displayColor: Green500,
              feedInfoInMarkdown:
                mdText`**${key}** is back in ${store.name}.`.toString(),
              postedAt: collectedAt,
            });
          }

          if (plan.columnChanges.length > 0) {
            result.schemaChanges += plan.columnChanges.length;
            await this.writeColumnChanges({
              store,
              assetId,
              changes: plan.columnChanges,
              collectedAt,
            });

            // A column first seen in a sample of documents is not a change to the table.
            if (!table.columnsAreInferred) {
              newPersonalDataColumns.push(
                ...findNewPersonalDataColumns({
                  tableKey: key,
                  columnNames: plan.columnChanges
                    .filter((change: DataAssetColumnChange): boolean => {
                      return change.kind === DataAssetColumnChangeKind.Added;
                    })
                    .map((change: DataAssetColumnChange): string => {
                      return change.column;
                    }),
                  seenAt: collectedAt,
                }),
              );
            }
          }
        }

        assetIdByKey.set(key, assetId);

        for (const metric of getTableMetricValues({
          table,
          plan,
          collectedAt,
          previousRowCount: previous?.rowCount ?? null,
          rowCountChangeTolerancePercent:
            previous?.rowCountChangeTolerancePercent ?? null,
        })) {
          metricRows.push(
            buildMetricRow({
              store,
              assetId,
              table,
              metricName: metric.name,
              value: metric.value,
              collectedAt,
              retentionDays,
            }),
          );
        }
      } catch (error) {
        logger.error(
          `Data Observability: could not record table ${key} of store ${store.id.toString()}`,
        );
        logger.error(error);
      }
    }

    if (snapshot.isComplete) {
      for (const asset of existing) {
        if (
          asset.id &&
          asset.assetKey &&
          !asset.isDropped &&
          !seenKeys.has(asset.assetKey)
        ) {
          await DataAssetService.updateColumnsByIdWithoutHooks({
            id: asset.id,
            data: { isDropped: true, droppedAt: collectedAt },
          });
          await DataAssetFeedService.createDataAssetFeedItem({
            dataAssetId: asset.id,
            projectId: store.projectId,
            dataAssetFeedEventType: DataAssetFeedEventType.AssetDropped,
            displayColor: Red500,
            feedInfoInMarkdown:
              mdText`**${asset.assetKey}** is gone from ${store.name}.`.toString(),
            postedAt: collectedAt,
          });
          result.dropped++;
        }
      }
    }

    if (tablesLeftOut > 0) {
      snapshot.warnings.push(
        `${tablesLeftOut} more tables were left out: this project has used its free tables. Add a payment method under Project Settings > Billing to watch them.`,
      );
    }

    await this.writeMetricRows(store.projectId, metricRows);
    result.metricRows = metricRows.length;

    // A storage path has no lineage: only a database's own catalog does.
    if (snapshot.lineage && snapshot.engine !== "storage") {
      // A cut table list leaves tables out that are still there.
      if (!snapshot.isComplete) {
        for (const asset of existing) {
          if (
            asset.id &&
            asset.assetKey &&
            !asset.isDropped &&
            !assetIdByKey.has(asset.assetKey)
          ) {
            assetIdByKey.set(asset.assetKey, asset.id);
          }
        }
      }

      // Lineage is extra: one that cannot be kept never fails the collection.
      try {
        await CollectedLineage.record({
          projectId: store.projectId,
          engine: snapshot.engine,
          databaseName: snapshot.target?.databaseName || null,
          lineage: snapshot.lineage,
          isViewLineageComplete: snapshot.isViewLineageComplete === true,
          assetIdByKey,
          collectedAt,
        });
      } catch (error) {
        logger.error(
          `Data Observability: could not record the lineage of store ${store.id.toString()}`,
        );
        logger.error(error);
      }
    }

    // Spend is extra too: what cannot be kept never fails the collection.
    if (snapshot.spend) {
      try {
        await DataWarehouseSpendIngest.record({
          projectId: store.projectId,
          dataStoreId: store.id,
          spend: snapshot.spend,
          assetIdByKey,
          collectedAt,
        });
      } catch (error) {
        logger.error(
          `Data Observability: could not record the spend of store ${store.id.toString()}`,
        );
        logger.error(error);
      }
    }

    await this.writeNewPersonalDataColumns({
      store,
      found: newPersonalDataColumns,
      collectedAt,
    });
    await this.linkDatabaseServer(store, snapshot.target);

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: store.id,
      data: {
        tableHealthCollectedAt: collectedAt,
        tableHealthStatus: TableHealthStatus.Collected,
        tableHealthMessage:
          snapshot.warnings.length > 0
            ? snapshot.warnings.join("\n").slice(0, MAX_MESSAGE_LENGTH)
            : null,
        tableHealthAssetCount: seenKeys.size,
        // Kept when a collection could not say, as an older probe's cannot.
        ...(snapshot.target
          ? { tableHealthTarget: snapshot.target as unknown as JSONObject }
          : {}),
        nextTableHealthCollectionAt: getNextCollectionTime(
          OneUptimeDate.getCurrentDate(),
          TABLE_HEALTH_COLLECTION_INTERVAL_IN_MINUTES,
        ),
      } as never,
    });

    return result;
  }

  public static async recordFailure(data: {
    storeId: ObjectID;
    error: string;
  }): Promise<void> {
    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: data.storeId,
      data: {
        tableHealthStatus: TableHealthStatus.Failed,
        tableHealthMessage: data.error.slice(0, MAX_MESSAGE_LENGTH),
        nextTableHealthCollectionAt: OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          FAILED_COLLECTION_RETRY_IN_MINUTES,
        ),
      } as never,
    });
  }

  private static async createAsset(data: {
    store: IngestStore;
    table: CollectedTable;
    plan: AssetPlan;
    collectedAt: Date;
  }): Promise<ObjectID> {
    const { store, table, plan, collectedAt } = data;
    const key: string = getDataTableKey(table.schema, table.name);
    const asset: DataAsset = new DataAsset();

    asset.projectId = store.projectId;
    asset.dataStoreId = store.id;
    asset.dataStoreName = store.name.slice(0, MAX_STORE_NAME_LENGTH);
    asset.dataStoreKind = store.kind;
    asset.assetKey = key;
    asset.schemaName = table.schema;
    asset.name = table.name;
    asset.assetKind = table.kind;
    asset.columns = plan.columns || [];
    asset.columnCount = plan.columns ? plan.columns.length : 0;
    asset.isDropped = false;
    asset.firstSeenAt = collectedAt;
    asset.lastCollectedAt = collectedAt;
    asset.collectionState = plan.collectionState;

    if (table.estimatedRows !== null) {
      asset.rowCount = table.estimatedRows;
    }

    if (table.sizeInBytes !== null) {
      asset.sizeInBytes = table.sizeInBytes;
    }

    if (plan.lastChangedAt) {
      asset.lastChangedAt = plan.lastChangedAt;
    }

    if (plan.reads.lastReadAt) {
      asset.lastReadAt = plan.reads.lastReadAt;
    }

    if (plan.reads.unreadSince) {
      asset.unreadSince = plan.reads.unreadSince;
    }

    const created: DataAsset = await DataAssetService.create({
      data: asset,
      props: { isRoot: true },
    });

    await DataAssetFeedService.createDataAssetFeedItem({
      dataAssetId: created.id!,
      projectId: store.projectId,
      dataAssetFeedEventType: DataAssetFeedEventType.AssetDiscovered,
      displayColor: Blue500,
      feedInfoInMarkdown:
        mdText`Found ${table.kind.toLowerCase()} **${key}** in ${store.name}, with ${String(asset.columnCount)} columns.`.toString(),
      postedAt: collectedAt,
    });

    return created.id!;
  }

  private static async updateAsset(data: {
    assetId: ObjectID;
    table: CollectedTable;
    plan: AssetPlan;
    collectedAt: Date;
  }): Promise<void> {
    const { table, plan, collectedAt } = data;
    const update: Partial<DataAsset> = {
      lastCollectedAt: collectedAt,
      collectionState: plan.collectionState,
      rowCount: table.estimatedRows as number,
      sizeInBytes: table.sizeInBytes as number,
      lastChangedAt: plan.lastChangedAt as Date,
      updateIntervalInSeconds: plan.updateIntervalInSeconds as number,
      lastReadAt: plan.reads.lastReadAt as Date,
      unreadSince: plan.reads.unreadSince as Date,
      assetKind: table.kind,
    };

    if (plan.columns !== null) {
      update.columns = plan.columns;
      update.columnCount = plan.columns.length;
    }

    if (plan.isRestored) {
      update.isDropped = false;
      update.droppedAt = null as unknown as Date;
    }

    await DataAssetService.updateColumnsByIdWithoutHooks({
      id: data.assetId,
      data: update as never,
    });
  }

  /*
   * The Database product's server this store's database runs on, by the address
   * the collection read: a server that is down or overloaded explains its tables,
   * and its page shows how they are. Asked only until it is known. One that fails
   * leaves the collection as it was.
   */
  private static async linkDatabaseServer(
    store: IngestStore,
    target: TableHealthTarget | null | undefined,
  ): Promise<void> {
    if (!target?.host) {
      return;
    }

    try {
      const current: DataStore | null = await DataStoreService.findOneById({
        id: store.id,
        select: { databaseServerId: true },
        props: { isRoot: true },
      });

      if (current?.databaseServerId) {
        return;
      }

      const endpoint: DatabaseServerEndpoint | null =
        await DatabaseServerEndpointService.findOneBy({
          query: {
            projectId: store.projectId,
            endpoint: formatDatabaseEndpoint({
              host: target.host,
              port: target.port,
            }),
          },
          select: { databaseServerId: true },
          props: { isRoot: true },
        });

      if (endpoint?.databaseServerId) {
        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id,
          data: { databaseServerId: endpoint.databaseServerId } as never,
        });
      }
    } catch (error) {
      logger.debug(error);
    }
  }

  // Only when there is something to add: most collections find no new column.
  private static async writeNewPersonalDataColumns(data: {
    store: IngestStore;
    found: Array<NewPersonalDataColumn>;
    collectedAt: Date;
  }): Promise<void> {
    if (data.found.length === 0) {
      return;
    }

    const current: DataStore | null = await DataStoreService.findOneById({
      id: data.store.id,
      select: { newPersonalDataColumns: true },
      props: { isRoot: true },
    });

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: data.store.id,
      data: {
        newPersonalDataColumns: mergeNewPersonalDataColumns({
          previous: current?.newPersonalDataColumns,
          found: data.found,
          now: data.collectedAt,
        }),
      } as never,
    });
  }

  private static async writeColumnChanges(data: {
    store: IngestStore;
    assetId: ObjectID;
    changes: Array<DataAssetColumnChange>;
    collectedAt: Date;
  }): Promise<void> {
    const written: Array<DataAssetColumnChange> = data.changes.slice(
      0,
      MAX_COLUMN_FEED_ITEMS_PER_TABLE,
    );

    for (const change of written) {
      const description: {
        markdown: string;
        eventType: DataAssetFeedEventType;
        color: Color;
      } = describeColumnChange(change);

      await DataAssetFeedService.createDataAssetFeedItem({
        dataAssetId: data.assetId,
        projectId: data.store.projectId,
        dataAssetFeedEventType: description.eventType,
        displayColor: isBreakingColumnChange(change)
          ? Red500
          : description.color,
        feedInfoInMarkdown: description.markdown,
        postedAt: data.collectedAt,
      });
    }

    const rest: number = data.changes.length - written.length;

    if (rest > 0) {
      await DataAssetFeedService.createDataAssetFeedItem({
        dataAssetId: data.assetId,
        projectId: data.store.projectId,
        dataAssetFeedEventType: DataAssetFeedEventType.ColumnTypeChanged,
        displayColor: Yellow500,
        feedInfoInMarkdown:
          mdText`And ${String(rest)} more column changes in the same collection.`.toString(),
        postedAt: data.collectedAt,
      });
    }
  }

  private static async writeMetricRows(
    projectId: ObjectID,
    rows: Array<JSONObject>,
  ): Promise<void> {
    for (
      let start: number = 0;
      start < rows.length;
      start += METRIC_ROWS_PER_INSERT
    ) {
      await MetricService.insertJsonRows(
        rows.slice(start, start + METRIC_ROWS_PER_INSERT),
      );
    }

    if (rows.length === 0) {
      return;
    }

    const metricTypes: Dictionary<MetricType> = {};

    for (const definition of DATA_OBSERVABILITY_METRICS) {
      const metricType: MetricType = new MetricType();
      metricType.name = definition.name;
      metricType.description = definition.description;
      metricType.unit = definition.unit;
      metricTypes[definition.name] = metricType;
    }

    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: metricTypes,
    }).catch((error: Error) => {
      logger.error(error);
    });
  }
}
