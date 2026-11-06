/*
 * WHAT A DATA CHECK MEASURES.
 *
 * Each check reads one number from a table - per segment when it has one -
 * and writes it as the oneuptime.data.check.value metric, so it is charted,
 * baselined and alerted on like every other metric. Only that number leaves
 * the database, unless the project chose to keep a masked sample of failing
 * rows (DataObservabilitySetting).
 */
export enum DataCheckType {
  // Percent of rows whose column is empty (NULL).
  NullPercent = "Null Percent",
  // Percent of non-empty values that repeat another row's.
  DuplicatePercent = "Duplicate Percent",
  // How many different values the column holds.
  DistinctCount = "Distinct Count",
  Minimum = "Minimum",
  Maximum = "Maximum",
  Average = "Average",
  // The column's values added up: a day's revenue, an inventory's units. 0 for no rows.
  Sum = "Sum",
  // Percent of non-empty values outside an accepted list.
  InvalidPercent = "Invalid Percent",
  // Percent of non-empty values that do not match a pattern.
  FormatMismatchPercent = "Format Mismatch Percent",
  // Rows whose value has no match in another table's column.
  OrphanCount = "Orphan Count",
  // Rows in the table: per segment, the volume each tenant or region sends.
  RowCount = "Row Count",
  // The number a read-only query returns.
  CustomSql = "Custom SQL",
  // How many rows a read-only query returns: the rows that should not exist. 0 is healthy.
  FailingRows = "Failing Rows",
  /*
   * A test of the project's dbt models, run by dbt and read from its
   * artifacts (DbtIngest): the rows it found failing. OneUptime never runs it.
   */
  DbtTest = "dbt Test",
}

// The checks a person adds, and OneUptime runs: every type but dbt's.
export const DATA_CHECK_TYPES: ReadonlyArray<DataCheckType> = Object.values(
  DataCheckType,
).filter((type: DataCheckType) => {
  return type !== DataCheckType.DbtTest;
});

// The checks that read one column, and so need one named.
export const COLUMN_CHECK_TYPES: ReadonlyArray<DataCheckType> = [
  DataCheckType.NullPercent,
  DataCheckType.DuplicatePercent,
  DataCheckType.DistinctCount,
  DataCheckType.Minimum,
  DataCheckType.Maximum,
  DataCheckType.Average,
  DataCheckType.Sum,
  DataCheckType.InvalidPercent,
  DataCheckType.FormatMismatchPercent,
  DataCheckType.OrphanCount,
];

export function isColumnCheckType(type: DataCheckType): boolean {
  return COLUMN_CHECK_TYPES.includes(type);
}

// The checks a person writes the query of.
export function isQueryCheckType(type: DataCheckType): boolean {
  return type === DataCheckType.CustomSql || type === DataCheckType.FailingRows;
}

/*
 * The checks a share of the rows answers as well as all of them: what they read
 * is a rate. A count needs them all, and so does finding what repeats.
 */
export const SAMPLEABLE_CHECK_TYPES: ReadonlyArray<DataCheckType> = [
  DataCheckType.NullPercent,
  DataCheckType.Average,
  DataCheckType.InvalidPercent,
  DataCheckType.FormatMismatchPercent,
];

export function isSampleableCheckType(type: DataCheckType): boolean {
  return SAMPLEABLE_CHECK_TYPES.includes(type);
}

// The checks whose failing rows can be named, for a project that keeps a sample of them.
export const FAILING_ROW_CHECK_TYPES: ReadonlyArray<DataCheckType> = [
  DataCheckType.FailingRows,
  DataCheckType.InvalidPercent,
  DataCheckType.FormatMismatchPercent,
  DataCheckType.OrphanCount,
];

// The most failing rows kept of one run, the longest value kept, and the most columns.
export const MAX_FAILING_ROWS: number = 20;
export const MAX_FAILING_ROW_VALUE_LENGTH: number = 200;
export const MAX_FAILING_ROW_COLUMNS: number = 30;

// The most accepted values one check compares against.
export const MAX_ACCEPTED_VALUES: number = 200;

// The most segments one run reports: the largest, by rows.
export const MAX_SEGMENTS_PER_CHECK: number = 100;

// How a check's last run went.
export enum DataCheckRunStatus {
  Ran = "Ran",
  Failed = "Failed",
}

// How often a check may run, in minutes.
export const DATA_CHECK_INTERVALS_IN_MINUTES: ReadonlyArray<number> = [
  15, 60, 360, 1440,
];

export const DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES: number = 60;

// When a check's value alerts: against its own learned baseline, or a threshold.
export enum DataCheckAlertCondition {
  UnusuallyHigh = "Unusually High",
  UnusuallyLow = "Unusually Low",
  Above = "Above",
  Below = "Below",
}

export const DATA_CHECK_ALERT_CONDITIONS: ReadonlyArray<DataCheckAlertCondition> =
  Object.values(DataCheckAlertCondition);

// Whether a condition compares with a threshold, which it then needs.
export function doesAlertConditionNeedThreshold(
  condition: DataCheckAlertCondition,
): boolean {
  return (
    condition === DataCheckAlertCondition.Above ||
    condition === DataCheckAlertCondition.Below
  );
}
