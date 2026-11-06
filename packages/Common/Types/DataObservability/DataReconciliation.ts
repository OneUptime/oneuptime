import { DataCheckType } from "./DataCheckType";

/*
 * WHETHER TWO COPIES OF THE SAME DATA STILL AGREE.
 *
 * Copies drift: the warehouse has fewer orders than the application's
 * database, or a migration lost rows. A reconciliation compares one measure
 * of two tables - their rows, the sum of a column, its distinct values, or a
 * number a query of the team's own returns - in the same database or in two
 * different ones, and says they have drifted once the difference is beyond
 * a tolerance: an absolute amount, or a percentage of the source's value.
 *
 * Each side is read by a data check of its own, with its store's collection,
 * by OneUptime or the store's probe, so the two are read at different
 * moments. Two values are compared only when they were read close enough
 * together to be about the same data (PAIRING_WINDOW_IN_MINUTES); until
 * then, the reconciliation waits.
 */

export enum DataReconciliationMeasure {
  RowCount = "Row Count",
  Sum = "Sum",
  DistinctCount = "Distinct Count",
  CustomSql = "Custom SQL",
}

export const DATA_RECONCILIATION_MEASURES: ReadonlyArray<DataReconciliationMeasure> =
  Object.values(DataReconciliationMeasure);

// The data check that reads a side, by its measure.
export function getMeasureCheckType(
  measure: DataReconciliationMeasure,
): DataCheckType {
  switch (measure) {
    case DataReconciliationMeasure.Sum:
      return DataCheckType.Sum;
    case DataReconciliationMeasure.DistinctCount:
      return DataCheckType.DistinctCount;
    case DataReconciliationMeasure.CustomSql:
      return DataCheckType.CustomSql;
    default:
      return DataCheckType.RowCount;
  }
}

// Whether a measure reads one column, which it then needs.
export function doesMeasureNeedColumn(
  measure: DataReconciliationMeasure,
): boolean {
  return (
    measure === DataReconciliationMeasure.Sum ||
    measure === DataReconciliationMeasure.DistinctCount
  );
}

export enum DataReconciliationToleranceType {
  // The difference may be at most this many.
  Absolute = "Absolute",
  // The difference may be at most this percentage of the source's value.
  Percent = "Percent",
}

export enum DataReconciliationStatus {
  InStep = "In Step",
  Drifted = "Drifted",
  // A side has not been read yet, or the two were read too far apart.
  Waiting = "Waiting",
  // A side's check could not run: its error says why.
  Failed = "Failed",
}

// How close together two values must be read to be compared.
export const PAIRING_WINDOW_IN_MINUTES: number = 15;

export interface DataReconciliationSide {
  value: number | null;
  readAt: Date | null;
  // The side's check's last run: Ran, or Failed with a message.
  failed: boolean;
  message: string | null;
}

export interface DataReconciliationComparison {
  // The target's value less the source's.
  difference: number;
  // The difference as a percentage of the source's value: 0 when both are 0.
  differencePercent: number;
  isDrifted: boolean;
}

export function compareReconciliationValues(data: {
  sourceValue: number;
  targetValue: number;
  toleranceType: DataReconciliationToleranceType;
  tolerance: number;
}): DataReconciliationComparison {
  const difference: number = data.targetValue - data.sourceValue;
  const distance: number = Math.abs(difference);
  const differencePercent: number =
    data.sourceValue === 0
      ? distance === 0
        ? 0
        : 100
      : (distance / Math.abs(data.sourceValue)) * 100;
  const tolerance: number = Math.max(0, data.tolerance);

  return {
    difference,
    differencePercent,
    isDrifted:
      data.toleranceType === DataReconciliationToleranceType.Percent
        ? differencePercent > tolerance
        : distance > tolerance,
  };
}

export type DataReconciliationOutcome =
  | {
      status:
        | DataReconciliationStatus.Failed
        | DataReconciliationStatus.Waiting;
      message: string;
    }
  | {
      status:
        | DataReconciliationStatus.InStep
        | DataReconciliationStatus.Drifted;
      message: null;
      comparison: DataReconciliationComparison;
      // When the later of the two values was read: what the comparison is as of.
      comparedAt: Date;
    };

export type DataReconciliationComparedOutcome = Extract<
  DataReconciliationOutcome,
  { comparedAt: Date }
>;

// Whether the two sides were compared, rather than waited for or failed.
export function isComparedOutcome(
  outcome: DataReconciliationOutcome,
): outcome is DataReconciliationComparedOutcome {
  return (
    outcome.status === DataReconciliationStatus.InStep ||
    outcome.status === DataReconciliationStatus.Drifted
  );
}

/*
 * What two sides say: a failed side fails the reconciliation, a side not
 * read yet or read too far from the other makes it wait, and two values read
 * together are compared.
 */
export function reconcileSides(data: {
  source: DataReconciliationSide;
  target: DataReconciliationSide;
  toleranceType: DataReconciliationToleranceType;
  tolerance: number;
}): DataReconciliationOutcome {
  for (const [name, side] of [
    ["source", data.source],
    ["target", data.target],
  ] as Array<[string, DataReconciliationSide]>) {
    if (side.failed) {
      return {
        status: DataReconciliationStatus.Failed,
        message: `The ${name}'s check could not run: ${side.message || "no reason given"}`,
      };
    }
  }

  if (
    data.source.value === null ||
    data.target.value === null ||
    !data.source.readAt ||
    !data.target.readAt
  ) {
    return {
      status: DataReconciliationStatus.Waiting,
      message: "Waiting for both sides to be read.",
    };
  }

  const apartInMs: number = Math.abs(
    data.source.readAt.getTime() - data.target.readAt.getTime(),
  );

  if (apartInMs > PAIRING_WINDOW_IN_MINUTES * 60 * 1000) {
    return {
      status: DataReconciliationStatus.Waiting,
      message: `The sides were last read ${Math.round(apartInMs / 60_000)} minutes apart: waiting for both to be read together.`,
    };
  }

  const comparison: DataReconciliationComparison = compareReconciliationValues({
    sourceValue: data.source.value,
    targetValue: data.target.value,
    toleranceType: data.toleranceType,
    tolerance: data.tolerance,
  });

  return {
    status: comparison.isDrifted
      ? DataReconciliationStatus.Drifted
      : DataReconciliationStatus.InStep,
    message: null,
    comparison,
    comparedAt:
      data.source.readAt > data.target.readAt
        ? data.source.readAt
        : data.target.readAt,
  };
}

// Why a reconciliation cannot be saved as it is, or null when it can.
export function getDataReconciliationError(data: {
  toleranceType?: unknown;
  tolerance?: unknown;
  sourceMeasure?: unknown;
  sourceColumnName?: unknown;
  sourceCustomSql?: unknown;
  targetMeasure?: unknown;
  targetColumnName?: unknown;
  targetCustomSql?: unknown;
}): string | null {
  if (
    !Object.values(DataReconciliationToleranceType).includes(
      data.toleranceType as DataReconciliationToleranceType,
    )
  ) {
    return "A reconciliation's tolerance is Absolute or Percent.";
  }

  const tolerance: number = Number(data.tolerance);

  if (
    data.tolerance === null ||
    data.tolerance === undefined ||
    data.tolerance === "" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    return "A reconciliation's tolerance is a number, 0 or more: 0 means the two must agree exactly.";
  }

  for (const [name, measure, column, sql] of [
    ["source", data.sourceMeasure, data.sourceColumnName, data.sourceCustomSql],
    ["target", data.targetMeasure, data.targetColumnName, data.targetCustomSql],
  ] as Array<[string, unknown, unknown, unknown]>) {
    if (
      !DATA_RECONCILIATION_MEASURES.includes(
        measure as DataReconciliationMeasure,
      )
    ) {
      return `The ${name}'s measure is Row Count, Sum, Distinct Count or Custom SQL.`;
    }

    if (
      doesMeasureNeedColumn(measure as DataReconciliationMeasure) &&
      (typeof column !== "string" || column.trim().length === 0)
    ) {
      return `The ${name}'s ${String(measure)} needs a column.`;
    }

    if (
      measure === DataReconciliationMeasure.CustomSql &&
      (typeof sql !== "string" || sql.trim().length === 0)
    ) {
      return `The ${name}'s Custom SQL needs a query.`;
    }
  }

  return null;
}

/*
 * THE METRICS A RECONCILIATION WRITES, at each comparison: whether the two
 * have drifted (what its monitor reads), and by how much. Each row is
 * tagged with its reconciliation, so a monitor scoped by it watches it alone.
 */
export enum DataReconciliationMetricName {
  // 1 when the two have drifted beyond the tolerance, 0 when they agree.
  Drifted = "oneuptime.data.reconciliation.drifted",
  // The target's value less the source's.
  Difference = "oneuptime.data.reconciliation.difference",
  // The difference as a percentage of the source's value.
  DifferencePercent = "oneuptime.data.reconciliation.difference_percent",
}

export const DataReconciliationAttribute: {
  readonly ReconciliationId: string;
  readonly ReconciliationName: string;
} = {
  ReconciliationId: "oneuptime.data.reconciliation.id",
  ReconciliationName: "oneuptime.data.reconciliation.name",
};

export interface DataReconciliationMetricDefinition {
  name: DataReconciliationMetricName;
  description: string;
  unit: string;
}

export const DATA_RECONCILIATION_METRICS: ReadonlyArray<DataReconciliationMetricDefinition> =
  [
    {
      name: DataReconciliationMetricName.Drifted,
      description:
        "1 when a reconciliation's two tables have drifted beyond its tolerance, 0 when they agree.",
      unit: "",
    },
    {
      name: DataReconciliationMetricName.Difference,
      description:
        "A reconciliation's target value less its source value, at its latest comparison.",
      unit: "",
    },
    {
      name: DataReconciliationMetricName.DifferencePercent,
      description:
        "A reconciliation's difference as a percentage of its source value: 0 when both are 0.",
      unit: "%",
    },
  ];
