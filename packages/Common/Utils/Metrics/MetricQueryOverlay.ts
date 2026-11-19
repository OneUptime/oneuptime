import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import MetricUnitUtil from "../MetricUnitUtil";
import ValueFormatter from "../ValueFormatter";

/*
 * OVERLAID QUERIES (issue #9961).
 *
 * A query after the first can be drawn on the chart of the query before it
 * (MetricQueryConfigData.overlayWithPreviousQuery, the "Overlay with previous
 * query" switch) instead of on a chart of its own. Consecutive overlaid
 * queries chain onto one chart, which takes its title, its chart type and its
 * value axis from its first query, the chart's lead. A dashboard's Chart
 * widget, the metrics explorer and a metric monitor's form all read the chain
 * and the units here, so the editors and the charts agree on which chart a
 * query is drawn on and how its values read there.
 *
 * Units. A chart has one value axis, written in its lead's unit, so an
 * overlaid query is read in that unit:
 *
 *   - the same unit, no unit known on either side, or two counts ("{requests}"
 *     beside "{errors}", which a chart draws as bare numbers): drawn as it is;
 *   - another unit of the same kind (megabytes on a chart in gigabytes,
 *     seconds on a chart in milliseconds, a 0-1 fraction on a chart in
 *     percent): converted into the chart's unit, so its line, its values and
 *     its warning and critical lines read right on the shared axis;
 *   - a unit of another kind (bytes on a chart in percent): still drawn on
 *     the chart, as the switch says, but the axis cannot say its values, so
 *     the chart and the query's switch say that the units differ.
 *
 * A chart could give such a query an axis of its own only with a second value
 * axis, which no chart here has. Drawing it on a chart of its own instead
 * would make the switch do nothing, and would break the chain for the queries
 * overlaid after it.
 *
 * Pure and React-free, so the suites read it without a browser.
 */

export enum OverlayUnitFit {
  // Read on the chart's axis as it is.
  Same = "Same",
  // Converted into the chart's unit: multiplied by the reading's factor.
  Converted = "Converted",
  // A unit of another kind: the chart's axis cannot say its values.
  Different = "Different",
}

export interface OverlayUnitReading {
  fit: OverlayUnitFit;
  /*
   * What a value of the overlaid query is multiplied by to read in the
   * chart's unit: 1 unless the fit is Converted.
   */
  factor: number;
}

export interface OverlayUnitInput {
  // The chart's unit: its lead's display unit, "" when none is known.
  chartUnit: string | undefined;
  // The lead's metric, which says whether a unit of "1" is a 0-1 fraction.
  chartMetricName?: string | undefined;
  // The overlaid query's display unit, "" when none is known.
  queryUnit: string | undefined;
  queryMetricName?: string | undefined;
}

const AS_IT_IS: OverlayUnitReading = {
  fit: OverlayUnitFit.Same,
  factor: 1,
};

const CANNOT_BE_READ: OverlayUnitReading = {
  fit: OverlayUnitFit.Different,
  factor: 1,
};

// A UCUM annotation alone ("{requests}"): a count, drawn as a bare number.
const ANNOTATION_ONLY_UNIT: RegExp = /^\{[^{}]*\}$/;

/*
 * What kind of quantity a unit says, as the chart reads it:
 *
 *   - unknown: no unit, so nothing to compare;
 *   - count: a number of things, drawn bare ("{requests}", or "1" on a metric
 *     that is no 0-1 fraction);
 *   - family: a unit MetricUnitUtil converts within (bytes, time, percent -
 *     with a 0-1 fraction's "1" - or bits), by the family's base unit;
 *   - other: any other unit, compared as written.
 */
type UnitKind =
  | { kind: "unknown" }
  | { kind: "count" }
  | { kind: "family"; base: string; unit: string }
  | { kind: "other"; unit: string };

function getUnitKind(
  unit: string | undefined,
  metricName: string | undefined,
): UnitKind {
  const written: string = (unit || "").trim();

  if (!written) {
    return { kind: "unknown" };
  }

  /*
   * "1" is a 0-1 fraction on a metric named as one (system.cpu.utilization),
   * which a chart draws in percent, and a bare count on any other.
   */
  if (written === "1") {
    return ValueFormatter.isFractionMetric(metricName)
      ? { kind: "family", base: "%", unit: "1" }
      : { kind: "count" };
  }

  if (ANNOTATION_ONLY_UNIT.test(written)) {
    return { kind: "count" };
  }

  // "percent", "pct" and "percentage" are the percent the family knows as "%".
  const familyUnit: string = ValueFormatter.isPercentUnit(written)
    ? "%"
    : written;
  const base: string | null = MetricUnitUtil.getFamilyBaseUnit(familyUnit);

  if (base) {
    return { kind: "family", base: base, unit: familyUnit };
  }

  return { kind: "other", unit: written.toLowerCase() };
}

export default class MetricQueryOverlay {
  /*
   * Whether a query is drawn on the chart of the query before it: it asks to
   * be, and there is a query before it. The first query always has a chart
   * of its own.
   */
  public static isOverlaid(
    queryConfig: MetricQueryConfigData | undefined,
    index: number,
  ): boolean {
    return index > 0 && queryConfig?.overlayWithPreviousQuery === true;
  }

  /*
   * The index of the lead of the chart a query joins when it overlays the
   * query before it: that query, or, when that one overlays too, the first
   * query of their chain. Null for the first query, which overlays nothing,
   * and for an index the list does not have.
   */
  public static getChartLeadIndex(
    queryConfigs: Array<MetricQueryConfigData>,
    index: number,
  ): number | null {
    if (
      !Number.isInteger(index) ||
      index <= 0 ||
      index >= queryConfigs.length
    ) {
      return null;
    }

    let leadIndex: number = index - 1;

    while (MetricQueryOverlay.isOverlaid(queryConfigs[leadIndex], leadIndex)) {
      leadIndex--;
    }

    return leadIndex;
  }

  // The lead of the chart a query joins when it overlays (getChartLeadIndex).
  public static getChartLead(
    queryConfigs: Array<MetricQueryConfigData>,
    index: number,
  ): MetricQueryConfigData | undefined {
    const leadIndex: number | null = MetricQueryOverlay.getChartLeadIndex(
      queryConfigs,
      index,
    );

    return leadIndex === null ? undefined : queryConfigs[leadIndex];
  }

  /*
   * How many charts a view's queries and formulas draw: a chart per query
   * that is not overlaid, and one per formula.
   */
  public static getChartCount(
    queryConfigs: Array<MetricQueryConfigData>,
    formulaCount: number,
  ): number {
    const queryCharts: number = queryConfigs.filter(
      (queryConfig: MetricQueryConfigData, index: number): boolean => {
        return !MetricQueryOverlay.isOverlaid(queryConfig, index);
      },
    ).length;

    return queryCharts + Math.max(0, formulaCount);
  }

  // How an overlaid query's values read on the axis of the chart it joins.
  public static readUnit(input: OverlayUnitInput): OverlayUnitReading {
    const chart: UnitKind = getUnitKind(input.chartUnit, input.chartMetricName);
    const query: UnitKind = getUnitKind(input.queryUnit, input.queryMetricName);

    if (chart.kind === "unknown" || query.kind === "unknown") {
      return AS_IT_IS;
    }

    if (chart.kind === "count" && query.kind === "count") {
      return AS_IT_IS;
    }

    if (chart.kind === "other" && query.kind === "other") {
      return chart.unit === query.unit ? AS_IT_IS : CANNOT_BE_READ;
    }

    if (
      chart.kind === "family" &&
      query.kind === "family" &&
      chart.base === query.base
    ) {
      const factor: number = MetricUnitUtil.convertToMetricUnit({
        value: 1,
        fromUnit: query.unit,
        metricUnit: chart.unit,
      });

      if (!Number.isFinite(factor) || factor <= 0) {
        return CANNOT_BE_READ;
      }

      return factor === 1
        ? AS_IT_IS
        : { fit: OverlayUnitFit.Converted, factor: factor };
    }

    return CANNOT_BE_READ;
  }

  /*
   * A query's value in the chart's unit: as it is unless the reading
   * converts it.
   */
  public static toChartUnit(
    value: number,
    reading: OverlayUnitReading,
  ): number {
    return reading.fit === OverlayUnitFit.Converted
      ? value * reading.factor
      : value;
  }
}
