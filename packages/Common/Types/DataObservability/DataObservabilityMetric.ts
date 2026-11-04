/*
 * THE METRICS AUTOMATIC TABLE HEALTH WRITES, ONE ROW PER TABLE PER COLLECTION.
 *
 * Every collection of a data store writes these for each of its tables into
 * the same ClickHouse metric table as every other metric, with the table's
 * store, schema and name as attributes. That is all it takes for the rest
 * of OneUptime to work on them unchanged: the hourly baseline view learns
 * each table's usual values by hour of the week, the Data monitor's
 * anomaly filters compare against it, and the metrics explorer and
 * dashboards chart them.
 *
 * A value an engine cannot give is not written. Absent is never zero: a
 * table whose last change is unknown is not a table that changed just now.
 */

export enum DataObservabilityMetricName {
  RowCount = "oneuptime.data.table.row_count",
  Size = "oneuptime.data.table.size",
  SecondsSinceChange = "oneuptime.data.table.seconds_since_change",
  SchemaChanges = "oneuptime.data.table.schema_changes",
  /*
   * The changes among them that can break what reads the table: a column
   * removed, renamed or retyped, or newly allowed to be empty. What
   * "Schema Changed" alerts on; an added column stays on the timeline.
   */
  BreakingSchemaChanges = "oneuptime.data.table.breaking_schema_changes",
  /*
   * How far past its usual time the table is, by the rule the catalog's
   * Late pill uses (DataAssetFreshness); 0 while it is on time. Written once
   * the table's rhythm is learned, so a monitor can alert on "late" from a
   * table's first few changes, with no baseline to wait for.
   */
  OverdueSeconds = "oneuptime.data.table.overdue_seconds",
  /*
   * How much the row count moved since the collection before, in percent:
   * -50 is half the rows gone, 100 is twice as many. The monitor path has
   * no rate or delta, so the change is worked out here, at collection.
   */
  RowCountChangePercent = "oneuptime.data.table.row_count_change_percent",
}

// The attributes every row carries, so a query can be scoped to a store or a table.
export const DataObservabilityAttribute: {
  readonly DataStoreId: string;
  readonly DataStoreName: string;
  readonly DataStoreKind: string;
  readonly TableId: string;
  readonly TableSchema: string;
  readonly TableName: string;
  readonly TableKey: string;
} = {
  DataStoreId: "oneuptime.data.store.id",
  DataStoreName: "oneuptime.data.store.name",
  DataStoreKind: "oneuptime.data.store.kind",
  TableId: "oneuptime.data.table.id",
  TableSchema: "oneuptime.data.table.schema",
  TableName: "oneuptime.data.table.name",
  // "schema.table": what a Data monitor groups by, one series per table.
  TableKey: "oneuptime.data.table.key",
};

export interface DataObservabilityMetricDefinition {
  name: DataObservabilityMetricName;
  title: string;
  description: string;
  unit: string;
}

export const DATA_OBSERVABILITY_METRICS: ReadonlyArray<DataObservabilityMetricDefinition> =
  [
    {
      name: DataObservabilityMetricName.RowCount,
      title: "Row Count",
      description:
        "How many rows the table holds, from the engine's own statistics.",
      unit: "",
    },
    {
      name: DataObservabilityMetricName.Size,
      title: "Size",
      description: "How much space the table and its indexes take.",
      unit: "bytes",
    },
    {
      name: DataObservabilityMetricName.SecondsSinceChange,
      title: "Time Since Last Change",
      description:
        "How long since a row of the table was last inserted, updated or deleted.",
      unit: "s",
    },
    {
      name: DataObservabilityMetricName.SchemaChanges,
      title: "Schema Changes",
      description:
        "How many columns were added, removed, renamed or changed since the collection before.",
      unit: "",
    },
    {
      name: DataObservabilityMetricName.BreakingSchemaChanges,
      title: "Breaking Schema Changes",
      description:
        "How many columns were removed, renamed or retyped since the collection before, or newly allowed to be empty.",
      unit: "",
    },
    {
      name: DataObservabilityMetricName.OverdueSeconds,
      title: "Time Overdue",
      description:
        "How long the table is past the time it usually changes by. 0 while it is on time.",
      unit: "s",
    },
    {
      name: DataObservabilityMetricName.RowCountChangePercent,
      title: "Row Count Change",
      description:
        "How much the row count moved since the collection before, in percent.",
      unit: "%",
    },
  ];

/*
 * The least rows a table held at the collection before for its change in
 * rows to be written. Below it a percentage is noise - 2 rows to 1 is -50%.
 */
export const ROW_COUNT_CHANGE_MIN_ROWS: number = 1000;

export function getDataObservabilityMetric(
  name: string,
): DataObservabilityMetricDefinition | undefined {
  return DATA_OBSERVABILITY_METRICS.find(
    (metric: DataObservabilityMetricDefinition) => {
      return metric.name === name;
    },
  );
}

export function getDataTableKey(schema: string, name: string): string {
  return schema ? `${schema}.${name}` : name;
}
