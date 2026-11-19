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
 * Units. A chart's first value axis, on its left, is written in its lead's
 * unit, and an overlaid query is read against it (readUnit):
 *
 *   - the same unit, no unit known on either side, or two counts ("{requests}"
 *     beside "{errors}", which a chart draws as bare numbers): drawn as it is;
 *   - another unit of the same kind (megabytes on a chart in gigabytes,
 *     seconds on a chart in milliseconds, a 0-1 fraction on a chart in
 *     percent): converted into the chart's unit, so its line, its values and
 *     its warning and critical lines read right on the shared axis;
 *   - a unit of another kind (bytes on a chart in percent): the first axis
 *     cannot say its values.
 *
 * The first query in a unit of another kind gives the chart a second value
 * axis, on its right, written in its unit (issue #10042), and every later
 * query in that kind of unit is read against that axis the same way: drawn as
 * it is, or converted into the second axis's unit (readChartAxes). Only a
 * third kind of unit fits neither axis: it is still drawn, against the first,
 * as the switch says, and the chart and the query's switch say so. Drawing it
 * on a chart of its own instead would make the switch do nothing, and would
 * break the chain for the queries overlaid after it.
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

/*
 * The value axis a query of a chart is drawn against (issue #10042).
 */
export enum OverlayAxis {
  // On the chart's left, in its lead's unit.
  First = "First",
  /*
   * On the chart's right, in the unit of the chart's first query whose unit
   * is of a kind the first axis cannot say.
   */
  Second = "Second",
}

/*
 * How a query of a chart reads on the axis it is drawn against: its fit and
 * factor are against that axis's unit. A query that fits neither axis (a
 * third kind of unit) is drawn against the first, as it is, and its fit
 * says Different.
 */
export interface OverlayAxisReading extends OverlayUnitReading {
  axis: OverlayAxis;
}

// A query of a chart, by the unit it is drawn in.
export interface OverlayChartQueryUnit {
  // Its display unit, "" when none is known.
  unit: string | undefined;
  // Its metric, which says whether a unit of "1" is a 0-1 fraction.
  metricName?: string | undefined;
}

export interface OverlayChartAxes {
  // Each query's reading, in the chart's order, its lead's first.
  readings: Array<OverlayAxisReading>;
  /*
   * The position, among the chart's queries, of the one whose unit the
   * second axis is written in; null while the chart has one axis.
   */
  secondAxisLeadIndex: number | null;
}

const ON_FIRST_AXIS_AS_IT_IS: OverlayAxisReading = {
  axis: OverlayAxis.First,
  fit: OverlayUnitFit.Same,
  factor: 1,
};

const ON_SECOND_AXIS_AS_IT_IS: OverlayAxisReading = {
  axis: OverlayAxis.Second,
  fit: OverlayUnitFit.Same,
  factor: 1,
};

const ON_NEITHER_AXIS: OverlayAxisReading = {
  axis: OverlayAxis.First,
  fit: OverlayUnitFit.Different,
  factor: 1,
};

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
   * The queries of the chart a query joins when it overlays the query before
   * it, in the chart's order: its lead, then each query overlaid on it before
   * this one. Empty for the first query, which overlays nothing.
   */
  public static getChartQueriesBefore(
    queryConfigs: Array<MetricQueryConfigData>,
    index: number,
  ): Array<MetricQueryConfigData> {
    const leadIndex: number | null = MetricQueryOverlay.getChartLeadIndex(
      queryConfigs,
      index,
    );

    return leadIndex === null ? [] : queryConfigs.slice(leadIndex, index);
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
   * The axis each query of one chart is drawn against, and how its values
   * read there (issue #10042). The lead's are its own, on the first axis.
   * Every later query is read against the first axis (readUnit); the first
   * one whose unit is of another kind gives the chart its second axis, in its
   * unit, and every one after it that the first axis cannot read either is
   * read against the second the same way. A query neither axis can read is
   * drawn against the first, as it is.
   */
  public static readChartAxes(
    queries: Array<OverlayChartQueryUnit>,
  ): OverlayChartAxes {
    const readings: Array<OverlayAxisReading> = [];
    const lead: OverlayChartQueryUnit | undefined = queries[0];
    let secondAxisLeadIndex: number | null = null;

    queries.forEach((query: OverlayChartQueryUnit, index: number): void => {
      if (index === 0 || !lead) {
        readings.push(ON_FIRST_AXIS_AS_IT_IS);
        return;
      }

      const onFirstAxis: OverlayUnitReading = MetricQueryOverlay.readUnit({
        chartUnit: lead.unit,
        chartMetricName: lead.metricName,
        queryUnit: query.unit,
        queryMetricName: query.metricName,
      });

      if (onFirstAxis.fit !== OverlayUnitFit.Different) {
        readings.push({ ...onFirstAxis, axis: OverlayAxis.First });
        return;
      }

      if (secondAxisLeadIndex === null) {
        secondAxisLeadIndex = index;
        readings.push(ON_SECOND_AXIS_AS_IT_IS);
        return;
      }

      const secondAxisLead: OverlayChartQueryUnit = queries[
        secondAxisLeadIndex
      ] as OverlayChartQueryUnit;
      const onSecondAxis: OverlayUnitReading = MetricQueryOverlay.readUnit({
        chartUnit: secondAxisLead.unit,
        chartMetricName: secondAxisLead.metricName,
        queryUnit: query.unit,
        queryMetricName: query.metricName,
      });

      readings.push(
        onSecondAxis.fit === OverlayUnitFit.Different
          ? ON_NEITHER_AXIS
          : { ...onSecondAxis, axis: OverlayAxis.Second },
      );
    });

    return {
      readings: readings,
      secondAxisLeadIndex: secondAxisLeadIndex,
    };
  }

  /*
   * A query's value in the unit of the axis it is read against: as it is
   * unless the reading converts it.
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
