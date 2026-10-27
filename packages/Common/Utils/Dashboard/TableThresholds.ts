import {
  TableColumnThresholds,
  TableThresholdDirection,
  TableThresholdLevel,
  TableThresholdStyle,
} from "../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import ValueFormatter from "../ValueFormatter";

/*
 * A metric table's threshold colors (issue #5231): each value column may
 * have a warning and a critical threshold, and a value at or past one is
 * drawn amber or red. React-free, so the widget, its settings and the tests
 * all read one copy of the rules:
 *
 *   - What is stored is read leniently (readTableColumnThresholds): a
 *     dashboard's config is JSON that the API, Terraform or a hand edit
 *     may have written, so "80" is 80, and a threshold that is not a number
 *     is no threshold.
 *   - A value is compared as the cell shows it (getTableColumnDisplay,
 *     roundTableValue): a usage metric OpenTelemetry sends as a fraction
 *     of 1 - system.cpu.utilization at 0.93 - shows as 93% and is compared
 *     against 93, rounded to the column's decimals, so thresholds are typed
 *     as the table reads and a cell that says 80% is at a warning of 80.
 *   - A threshold is reached AT its value, as the Value and Gauge widgets'
 *     are: 90 is critical for "critical at 90", and 80 is a warning for
 *     "warning at 80". Lower-is-worse columns reach theirs at or below.
 *   - A value that is missing is never colored: the cell says "-".
 */

// The thresholds a percent column starts with when they are turned on.
export const TABLE_THRESHOLD_PERCENT_PRESET: Readonly<{
  warning: number;
  critical: number;
}> = {
  warning: 80,
  critical: 90,
};

/*
 * A stored threshold as a number: a finite number, or text that is one
 * (" 90.5 "). Anything else - empty text, a word, NaN, Infinity - is no
 * threshold at all.
 */
export const readTableThresholdNumber: (
  value: unknown,
) => number | undefined = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const trimmed: string = value.trim();

    if (trimmed === "") {
      return undefined;
    }

    const parsed: number = Number(trimmed);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

// A stored direction: lower is worse only when it says so.
export const readTableThresholdDirection: (
  value: unknown,
) => TableThresholdDirection = (value: unknown): TableThresholdDirection => {
  return value === TableThresholdDirection.LowerIsWorse
    ? TableThresholdDirection.LowerIsWorse
    : TableThresholdDirection.HigherIsWorse;
};

/*
 * A column's stored thresholds, or null when it has none in force: not an
 * object, or neither threshold a number. The direction is always set on
 * what comes back.
 */
export const readTableColumnThresholds: (
  value: unknown,
) => TableColumnThresholds | null = (
  value: unknown,
): TableColumnThresholds | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const stored: Record<string, unknown> = value as Record<string, unknown>;
  const warning: number | undefined = readTableThresholdNumber(
    stored["warning"],
  );
  const critical: number | undefined = readTableThresholdNumber(
    stored["critical"],
  );

  if (warning === undefined && critical === undefined) {
    return null;
  }

  const thresholds: TableColumnThresholds = {
    direction: readTableThresholdDirection(stored["direction"]),
  };

  if (warning !== undefined) {
    thresholds.warning = warning;
  }

  if (critical !== undefined) {
    thresholds.critical = critical;
  }

  return thresholds;
};

// How the table colors a value past a threshold: its number, unless it says the cell.
export const readTableThresholdStyle: (
  value: unknown,
) => TableThresholdStyle = (value: unknown): TableThresholdStyle => {
  return value === TableThresholdStyle.Background
    ? TableThresholdStyle.Background
    : TableThresholdStyle.Text;
};

/*
 * Whether `value` has reached `threshold`, the way the column's values go
 * bad: at or above it when higher is worse, at or below it when lower is.
 */
const hasReached: (
  value: number,
  threshold: number | undefined,
  direction: TableThresholdDirection,
) => boolean = (
  value: number,
  threshold: number | undefined,
  direction: TableThresholdDirection,
): boolean => {
  if (threshold === undefined) {
    return false;
  }

  return direction === TableThresholdDirection.LowerIsWorse
    ? value <= threshold
    : value >= threshold;
};

/*
 * The level a value has reached - Critical before Warning, so a critical
 * threshold always wins - or null when it has reached neither, when the
 * column has no thresholds, or when there is no value to compare.
 * `value` is in the scale the cell shows (getTableColumnDisplay).
 */
export const getTableThresholdLevel: (data: {
  value: number | null | undefined;
  thresholds: TableColumnThresholds | null | undefined;
}) => TableThresholdLevel | null = (data: {
  value: number | null | undefined;
  thresholds: TableColumnThresholds | null | undefined;
}): TableThresholdLevel | null => {
  const value: number | null | undefined = data.value;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const thresholds: TableColumnThresholds | null = readTableColumnThresholds(
    data.thresholds,
  );

  if (!thresholds) {
    return null;
  }

  const direction: TableThresholdDirection = readTableThresholdDirection(
    thresholds.direction,
  );

  if (hasReached(value, thresholds.critical, direction)) {
    return TableThresholdLevel.Critical;
  }

  if (hasReached(value, thresholds.warning, direction)) {
    return TableThresholdLevel.Warning;
  }

  return null;
};

/*
 * True when both thresholds are set and critical comes before warning - a
 * critical of 80 under a warning of 90 when higher is worse. The values are
 * still colored (critical wins from 80 up, so nothing is ever a warning);
 * the settings say how to put them right.
 */
export const isTableThresholdOrderReversed: (
  thresholds: TableColumnThresholds | null | undefined,
) => boolean = (
  thresholds: TableColumnThresholds | null | undefined,
): boolean => {
  const read: TableColumnThresholds | null =
    readTableColumnThresholds(thresholds);

  if (
    !read ||
    read.warning === undefined ||
    read.critical === undefined ||
    read.warning === read.critical
  ) {
    return false;
  }

  return readTableThresholdDirection(read.direction) ===
    TableThresholdDirection.LowerIsWorse
    ? read.critical > read.warning
    : read.critical < read.warning;
};

/*
 * How a column shows its values: the unit after each number, and what the
 * stored value is multiplied by first.
 */
export interface TableColumnDisplay {
  // The unit written after each value; undefined for none.
  unit: string | undefined;
  // 100 for a fraction shown as a percent, else 1.
  factor: number;
}

/*
 * How a column shows its values, from what its Unit setting says (blank is
 * Auto) and the metric it reads:
 *
 *   - a usage metric sent as a fraction of 1 - unit "1" and a name such as
 *     system.cpu.utilization (ValueFormatter.isFractionMetric) - is shown
 *     as a percent, x100, when the Unit is Auto or a percent: 0.93 reads
 *     93.00%, as the Value, Gauge and Chart widgets show it;
 *   - any other unit "1" means a plain number, and is not written;
 *   - otherwise the Unit as typed, or the metric's own unit when Auto.
 *
 * A formula column has no metric of its own: it shows its Unit as typed.
 */
export const getTableColumnDisplay: (data: {
  columnUnit?: string | undefined;
  metricUnit?: string | undefined;
  metricName?: string | undefined;
}) => TableColumnDisplay = (data: {
  columnUnit?: string | undefined;
  metricUnit?: string | undefined;
  metricName?: string | undefined;
}): TableColumnDisplay => {
  const columnUnit: string = (data.columnUnit || "").trim();
  const metricUnit: string = (data.metricUnit || "").trim();

  const isFraction: boolean =
    metricUnit === "1" && ValueFormatter.isFractionMetric(data.metricName);

  if (isFraction && columnUnit === "") {
    return { unit: "%", factor: 100 };
  }

  if (isFraction && ValueFormatter.isPercentUnit(columnUnit)) {
    return { unit: columnUnit, factor: 100 };
  }

  if (columnUnit !== "") {
    return { unit: columnUnit, factor: 1 };
  }

  if (metricUnit === "" || metricUnit === "1") {
    return { unit: undefined, factor: 1 };
  }

  return { unit: metricUnit, factor: 1 };
};

// Whether a column shows percents: its thresholds then start at 80 and 90.
export const isTableColumnPercent: (display: TableColumnDisplay) => boolean = (
  display: TableColumnDisplay,
): boolean => {
  return ValueFormatter.isPercentUnit(display.unit);
};

/*
 * The thresholds a column starts with when they are turned on: 80 and 90,
 * higher is worse, for a percent column - CPU, memory and disk in use, what
 * the High CPU Utilization alert template watches at 80 - and none yet for
 * any other unit, whose scale only the person setting them knows.
 */
export const getTableThresholdPreset: (
  display: TableColumnDisplay,
) => TableColumnThresholds = (
  display: TableColumnDisplay,
): TableColumnThresholds => {
  if (isTableColumnPercent(display)) {
    return {
      warning: TABLE_THRESHOLD_PERCENT_PRESET.warning,
      critical: TABLE_THRESHOLD_PERCENT_PRESET.critical,
      direction: TableThresholdDirection.HigherIsWorse,
    };
  }

  return { direction: TableThresholdDirection.HigherIsWorse };
};

/*
 * A number with its unit, as the table writes them: "93.00%", "12.5 ms".
 * A percent, a degree or a per-mille sign follows the number with no space.
 */
export const joinTableValueAndUnit: (
  formatted: string,
  unit: string | undefined,
) => string = (formatted: string, unit: string | undefined): string => {
  if (!unit) {
    return formatted;
  }

  const noSpace: boolean = unit === "%" || unit === "°" || unit === "‰";

  return noSpace ? `${formatted}${unit}` : `${formatted} ${unit}`;
};

// A column's decimals as the table can write them: 0 to 20, whole.
const getSafeDecimals: (decimals: number) => number = (
  decimals: number,
): number => {
  if (!Number.isFinite(decimals)) {
    return 0;
  }

  return Math.max(0, Math.min(20, Math.floor(decimals)));
};

/*
 * A value rounded to the decimals its cell shows: what the cell writes, and
 * what its thresholds are compared against. A threshold reads the number on
 * screen - "80%" for 79.6 at no decimals is a warning at 80 - and a fraction
 * shown as a percent loses the float noise of its x100 (0.29 x 100 is
 * 28.999999999999996, shown and compared as 29).
 */
export const roundTableValue: (value: number, decimals: number) => number = (
  value: number,
  decimals: number,
): number => {
  const factor: number = Math.pow(10, getSafeDecimals(decimals));

  return Math.round(value * factor) / factor;
};

/*
 * A cell's value as the table writes it: rounded to its decimals (never
 * fewer than 0), grouped the browser's way, with its unit.
 */
export const formatTableValue: (data: {
  value: number;
  decimals: number;
  unit: string | undefined;
}) => string = (data: {
  value: number;
  decimals: number;
  unit: string | undefined;
}): string => {
  const safeDecimals: number = getSafeDecimals(data.decimals);
  const rounded: number = roundTableValue(data.value, safeDecimals);
  const formatted: string = rounded.toLocaleString(undefined, {
    minimumFractionDigits: safeDecimals,
    maximumFractionDigits: safeDecimals,
  });

  return joinTableValueAndUnit(formatted, data.unit);
};

/*
 * A threshold as the table writes it, in the column's unit: as typed, with
 * no trailing zeros ("80%", "0.5 s", "99.95%"), grouped like the cells.
 */
export const formatTableThreshold: (data: {
  threshold: number;
  unit: string | undefined;
}) => string = (data: {
  threshold: number;
  unit: string | undefined;
}): string => {
  return joinTableValueAndUnit(
    data.threshold.toLocaleString(undefined, { maximumFractionDigits: 6 }),
    data.unit,
  );
};
