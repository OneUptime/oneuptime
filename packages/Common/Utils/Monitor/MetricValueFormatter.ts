import MetricUnitUtil from "../MetricUnitUtil";
import ValueFormatter from "../ValueFormatter";

/*
 * How a metric sample is written into alert / incident notification text.
 *
 * The dashboard has always scaled metric values before showing them —
 * `ValueFormatter` turns 1073741824 bytes into "1.07 GB" for every chart,
 * gauge and value tile. The notification path never did. The same memory
 * breach that reads "1.07 GB" on the monitor page arrived in the on-call
 * engineer's inbox as the bare digits "1073741824 By", and in the
 * "Affected Resources" tables as a Value column with no unit at all — a
 * column of ten-digit numbers the reader has to divide by 2^30 in their
 * head at 3am to find out whether the pod is anywhere near its limit.
 *
 * This module is the single place that decides how a (value, unit) pair
 * is rendered for a notification, so the breaching-samples table, the
 * "Filter Conditions Met" sentence, the observation summary and the
 * per-platform resource tables cannot drift apart inside one email.
 *
 * WHY IT WRAPS ValueFormatter RATHER THAN BEING A CALL TO IT.
 *
 * Three things differ between a chart axis and an alert body:
 *
 *  1. ABBREVIATION. `ValueFormatter` shortens any number over 1000 to
 *     "1.5K" — right for a tick label, which has no horizontal room, and
 *     wrong for an alert, where "restarted 1.5K times" hides the
 *     difference between 1500 and 1549 that the reader opened the table
 *     to find. Here, only a unit that names an actual SCALE LADDER
 *     (bytes → KB → MB, seconds → min → hours) may rescale a number.
 *     Everything else keeps its digits and simply gets its unit spelled
 *     out: "1234567 cores", not "1.23M cores".
 *
 *  2. PREFIXED UNITS. A user who typed a threshold in "GB" makes every
 *     sample arrive carrying the unit "GB", and ValueFormatter has a
 *     ladder for "bytes" but not for "GB" — so 2500 of them rendered
 *     "2.5K GB" instead of "2.5 TB". Anything in a MetricUnitUtil family
 *     is converted to that family's base before the ladder runs.
 *
 *  3. UNITS WORTH HIDING. OTel's dimensionless "1" and UCUM's
 *     annotation-only units ("{restarts}", "{packets}") are not
 *     dimensions, and printing them produces the "0.06 1" that
 *     CompareCriteria and MonitorCriteriaObservationBuilder each grew
 *     their own guard against. That rule lives here now.
 */
export default class MetricValueFormatter {
  /*
   * UCUM annotation-only units — "{thread}", "{packets}", "{errors}".
   * The braces describe what is being counted; the value is a plain
   * count and the text inside them is not a unit a reader should see.
   */
  private static readonly annotationOnlyUnitPattern: RegExp = /^\{[^{}]*\}$/;

  /*
   * The per-platform metric catalogs (Kubernetes, Ceph, Proxmox, Docker
   * Swarm) were written for humans reading a metric picker, so they spell
   * two dimensionless concepts in English rather than in UCUM. "count"
   * appears on 43 catalog entries and means exactly what UCUM's "1" means
   * on a counter — printing it gives "15 count", which reads as a typo.
   * "ratio" means what UCUM's "1" means on a fraction metric: a value in
   * [0, 1] that a reader wants as a percentage.
   *
   * Rewriting them here rather than in each catalog keeps the catalogs
   * legible to the people who edit them and still gives every consumer of
   * this formatter one vocabulary.
   */
  private static readonly informalUnitAliases: Record<string, string> = {
    count: "",
    counts: "",
    ratio: "1",
    fraction: "1",
  };

  /*
   * Metrics whose unit says "seconds" but whose VALUE is a POINT in time
   * rather than a length of one.
   *
   * Proxmox has three: pve_replication_last_sync_timestamp_seconds,
   * _last_try_ and _next_sync_ — all carrying `unit: "seconds"`, all
   * holding a Unix epoch. Sent through the duration ladder, an epoch of
   * 1750000000 renders "20.25K days", which is not merely unhelpful: it
   * READS as a duration, so a replication job that synced a minute ago
   * looks 55 years stale. The bare number at least cannot be misread as
   * something it is not.
   *
   * Same shape as ValueFormatter's kubeletstats exclusion: a narrow,
   * name-anchored carve-out for a unit the exporter declared wrongly.
   */
  private static readonly absoluteTimestampMetricPattern: RegExp =
    /(^|[._])timestamps?([._]seconds?)?$/i;

  /**
   * Whether `unit` names a real dimension for `metricName` — i.e. whether
   * it is worth attaching to a number at all. False for the empty unit,
   * for the dimensionless "1" on a non-fraction metric, and for
   * annotation-only units.
   */
  public static hasDisplayableUnit(
    unit: string | null | undefined,
    metricName?: string | null | undefined,
  ): boolean {
    const trimmed: string = MetricValueFormatter.canonicalizeUnit(unit);

    if (!trimmed) {
      return false;
    }

    /*
     * "1" is OTel's dimensionless marker. On a `.utilization` / `.ratio`
     * metric it means "this is a [0, 1] fraction", which IS a scale (× 100
     * into a percent) and is why the fraction case is excluded here rather
     * than folded in. On anything else it is noise: "0.06 1" is not just
     * ugly, it reads as 1% when the value is 6%.
     */
    if (trimmed === "1") {
      return ValueFormatter.isFractionMetric(metricName || undefined);
    }

    return !MetricValueFormatter.annotationOnlyUnitPattern.test(trimmed);
  }

  /**
   * Format one metric sample for a notification.
   *
   * Units with a scale ladder are rescaled, exactly as the dashboard does:
   *   format({ value: 1073741824, unit: "By" })            → "1.07 GB"
   *   format({ value: 2500, unit: "GB" })                  → "2.5 TB"
   *   format({ value: 1500, unit: "ms" })                  → "1.5 sec"
   *   format({ value: 3661, unit: "seconds" })             → "1.02 hours"
   *   format({ value: 1500000, unit: "By/s" })             → "1.5 MB/s"
   *   format({ value: 0.2534, unit: "1",
   *            metricName: "system.cpu.utilization" })     → "25.34%"
   *   format({ value: 87.5, unit: "%" })                   → "87.50%"
   *
   * Units without one keep every digit and are merely labelled:
   *   format({ value: 1234567, unit: "cores" })            → "1234567 cores"
   *   format({ value: 95, unit: "Cel" })                   → "95 Celsius"
   *
   * A value with no dimension to report is left bare:
   *   format({ value: 1500 })                              → "1500"
   *   format({ value: 1500, unit: "{restarts}" })          → "1500"
   *   format({ value: 3.14159 })                           → "3.14"
   */
  public static format(input: {
    value: number;
    unit?: string | null | undefined;
    metricName?: string | null | undefined;
  }): string {
    if (!Number.isFinite(input.value)) {
      return String(input.value);
    }

    const unit: string = MetricValueFormatter.canonicalizeUnit(input.unit);
    const metricName: string | undefined = input.metricName || undefined;

    if (!MetricValueFormatter.hasDisplayableUnit(unit, metricName)) {
      return MetricValueFormatter.formatBareNumber(input.value);
    }

    const formatOptions: { metricName?: string } = metricName
      ? { metricName: metricName }
      : {};

    /*
     * Percent first. ValueFormatter renders "%" and the fraction-metric
     * "1" as a two-decimal percentage, and neither is reachable through
     * the ladder path below (there is no percent threshold table, and the
     * percent family's base unit "%" has no ladder either).
     */
    if (
      ValueFormatter.isPercentUnit(unit) ||
      (unit === "1" && ValueFormatter.isFractionMetric(metricName))
    ) {
      return ValueFormatter.formatValue(input.value, unit, formatOptions);
    }

    const scalable: { value: number; unit: string } | null =
      MetricValueFormatter.isAbsoluteTimestampMetric(metricName)
        ? null
        : MetricValueFormatter.toScalableUnit(input.value, unit);

    if (scalable) {
      return ValueFormatter.formatValue(
        scalable.value,
        scalable.unit,
        formatOptions,
      );
    }

    /*
     * No ladder for this unit: label the number, leave its digits alone.
     *
     * The SYMBOL rather than the spelled-out name, because this suffix
     * sits directly against a number, where the ladder path also emits
     * symbols ("1.07 GB", "1.5 sec"). getReadableUnit is for the "Unit:"
     * label line, where a name reads better than a code — and it is
     * actively wrong here for compound units, which it rewrites: "m/s2"
     * becomes "m per s2" and "10*3/uL" becomes "10*3 per uL", both longer
     * and less recognisable than what the exporter wrote. getCompactUnit
     * keeps the slash and still expands what is worth expanding
     * ("Cel" → "°C", "KiBy" → "KiB").
     */
    const unitSymbol: string =
      ValueFormatter.getCompactUnit(unit, formatOptions) || unit;

    return `${MetricValueFormatter.formatBareNumber(input.value)} ${unitSymbol}`;
  }

  /**
   * The spelled-out name of a unit, for the "Unit:" line of a root cause —
   * "Bytes" rather than the UCUM "By" the exporter wrote. Returns null when
   * the unit names no dimension, so the caller can drop the line entirely
   * instead of printing the noise "Unit: 1".
   */
  public static getReadableUnit(
    unit: string | null | undefined,
    metricName?: string | null | undefined,
  ): string | null {
    if (!MetricValueFormatter.hasDisplayableUnit(unit, metricName)) {
      return null;
    }

    const readable: string = ValueFormatter.getReadableUnit(
      MetricValueFormatter.canonicalizeUnit(unit),
      metricName ? { metricName: metricName } : {},
    );

    return readable.trim() ? readable : null;
  }

  /*
   * Trim the unit and rewrite the catalogs' English spellings of "no
   * dimension" into the UCUM ones the rest of the pipeline understands.
   * Anything else is returned untouched — including its casing, which
   * matters because an unrecognised unit is echoed verbatim next to the
   * value ("5 widgets", not "5 Widgets").
   */
  private static canonicalizeUnit(unit: string | null | undefined): string {
    const trimmed: string = (unit || "").trim();

    if (!trimmed) {
      return "";
    }

    const alias: string | undefined =
      MetricValueFormatter.informalUnitAliases[trimmed.toLowerCase()];

    return alias === undefined ? trimmed : alias;
  }

  /**
   * Whether this metric's value is a point in time rather than a quantity,
   * and so must never be run through a scale ladder. See
   * absoluteTimestampMetricPattern.
   */
  public static isAbsoluteTimestampMetric(
    metricName: string | null | undefined,
  ): boolean {
    if (!metricName) {
      return false;
    }

    return MetricValueFormatter.absoluteTimestampMetricPattern.test(
      metricName.trim(),
    );
  }

  /*
   * Restate (value, unit) in a unit ValueFormatter has a scale ladder for,
   * or return null when no ladder can apply.
   *
   * Three ways a unit gets there:
   *   - it already has one ("bytes", "ms", "s", "ns");
   *   - it is a rate whose NUMERATOR does ("By/s" → scale the bytes, keep
   *     the "/s"), which is how 1500000 By/s reads "1.5 MB/s";
   *   - it is a prefixed member of a MetricUnitUtil family ("GB", "hours"),
   *     in which case the value is converted into that family's base first.
   */
  private static toScalableUnit(
    value: number,
    unit: string,
  ): { value: number; unit: string } | null {
    if (!unit) {
      return null;
    }

    if (ValueFormatter.isScalableUnit(unit)) {
      return { value: value, unit: unit };
    }

    if (unit.includes("/")) {
      const [numerator, ...denominatorParts] = unit.split("/");
      const denominator: string = denominatorParts.join("/").trim();

      if (!numerator || !numerator.trim() || !denominator) {
        return null;
      }

      const scaledNumerator: { value: number; unit: string } | null =
        MetricValueFormatter.toScalableUnit(value, numerator.trim());

      if (!scaledNumerator) {
        return null;
      }

      return {
        value: scaledNumerator.value,
        unit: `${scaledNumerator.unit}/${denominator}`,
      };
    }

    const baseUnit: string | null = MetricUnitUtil.getFamilyBaseUnit(unit);

    if (!baseUnit || !ValueFormatter.isScalableUnit(baseUnit)) {
      return null;
    }

    return {
      value: MetricUnitUtil.convertToMetricUnit({
        value: value,
        fromUnit: unit,
        metricUnit: baseUnit,
      }),
      unit: baseUnit,
    };
  }

  /*
   * The unscaled rendering: integers verbatim, everything else rounded to
   * two decimals with trailing zeros dropped (1.50 → "1.5"). This is the
   * behaviour the root-cause tables had before units arrived, and every
   * value without a scale ladder keeps it exactly, so a counter's digits
   * survive the trip to the inbox.
   */
  private static formatBareNumber(value: number): string {
    if (Number.isInteger(value)) {
      return value.toString();
    }

    return Number(value.toFixed(2)).toString();
  }
}
