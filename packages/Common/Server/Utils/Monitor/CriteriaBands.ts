import {
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import { MonitorCriteriaInstanceType } from "../../../Types/Monitor/MonitorCriteriaInstance";

/*
 * CRITERIA THAT ARE BANDS OF ONE ANOTHER (issue #11349).
 *
 * On a monitor that judges each series on its own - grouped by an attribute
 * or written in PromQL, or with "*" for every disk, port or table row - every
 * criteria is judged, so several can match one series on one check. The
 * series is a host, a disk, a port, a row, or the whole device for a
 * criteria that names none of them.
 *
 * Two criteria are bands of one another when they check the same things and
 * differ only in the lines they draw: "Disk above 95%" (critical) and "Disk
 * above 80%" (warning). A series in both bands is one problem, so it gets one
 * incident and one alert, from the first of the bands that matches it in the
 * order the criteria are listed (MonitorResource's claim of each series).
 *
 * Criteria that check anything else are separate problems, and each opens
 * its own for the series. A port above 80% (Interface saturated) and a port
 * logging errors (Interface errors) on the same poll are two alerts, and so
 * are a hot CPU and a full memory on one host. They used to be one: the
 * first criteria that matched a series claimed it for itself, whatever it
 * checked, so the second alert opened only once the first stopped matching.
 *
 * Precisely, two criteria are bands of one another when they read the same
 * set of measurements: each filter of either reads a measurement a filter of
 * the other reads too. What a filter reads is
 *
 *   - its Check On;
 *   - the selectors that say what of it it reads: the metric query or
 *     formula (metricAlias), the disk (diskPath), the port (interfaceName),
 *     the OID, the table, its column and its rows (tableKey, tableColumnOid,
 *     tableRow), the transceiver reading, the Fibre Channel counter, the
 *     database series (metricType) and the field of a script's result
 *     (resultValuePath);
 *   - and, for a filter whose value says what it looks for rather than
 *     where a line is - a process's name, a text, a status code, a trap
 *     OID, True or False - that comparison and its value.
 *
 * What draws the line is no part of it: a threshold compared above, below,
 * at least or at most (LINE_FILTER_TYPES), an anomaly or a forecast, a count
 * of minutes, how the values of a time window are combined, the threshold's
 * unit and what happens with no data. Nor is how the filters combine (All
 * or Any), or anything else of the criteria: its name, the status it sets,
 * its incident and alert templates or its recovery filters. The bands of one
 * check have severities and titles of their own, which tell them apart.
 *
 * Being bands of one another is an equivalence: criteria with the same band
 * key (getBandKey) are all bands of one another, and any two with different
 * keys are not.
 */

/*
 * The comparisons whose value is a line drawn on what the filter reads, so a
 * band moves it: a threshold above or below, an anomaly or a forecast (whose
 * value, if any, is a threshold too), and the minutes within which something
 * was or was not received. Any other comparison's value is what the filter
 * looks for, and is part of what it reads.
 */
const LINE_FILTER_TYPES: ReadonlySet<FilterType> = new Set<FilterType>([
  FilterType.GreaterThan,
  FilterType.LessThan,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThanOrEqualTo,
  FilterType.AnomalouslyHigh,
  FilterType.AnomalouslyLow,
  FilterType.Anomalous,
  FilterType.ForecastAbove,
  FilterType.ForecastBelow,
  FilterType.NotRecievedInMinutes,
  FilterType.RecievedInMinutes,
]);

// A selector or a value as it is compared: its text, trimmed. Empty is none.
const toText: (value: unknown) => string = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
};

export default class CriteriaBands {
  // Whether a filter's value is a line drawn on what it reads (LINE_FILTER_TYPES).
  public static isLineFilterType(filterType: FilterType | undefined): boolean {
    return Boolean(filterType) && LINE_FILTER_TYPES.has(filterType!);
  }

  /*
   * What one filter reads, as text: its Check On, its selectors and - when
   * its value is not a line - its comparison and value. Two filters that
   * read the same thing read as the same text, whatever their lines.
   */
  public static getMeasurement(filter: CriteriaFilter): string {
    const measurement: Array<[string, string]> = [
      ["checkOn", toText(filter.checkOn)],
    ];

    const selectors: Array<[string, unknown]> = [
      ["metricAlias", filter.metricMonitorOptions?.metricAlias],
      ["diskPath", filter.serverMonitorOptions?.diskPath],
      ["oid", filter.snmpMonitorOptions?.oid],
      ["interfaceName", filter.snmpMonitorOptions?.interfaceName],
      ["tableKey", filter.snmpMonitorOptions?.tableKey],
      ["tableColumnOid", filter.snmpMonitorOptions?.tableColumnOid],
      ["tableRow", filter.snmpMonitorOptions?.tableRow],
      ["transceiverReading", filter.snmpMonitorOptions?.transceiverReading],
      ["fibreChannelCounter", filter.snmpMonitorOptions?.fibreChannelCounter],
      ["databaseMetricType", filter.databaseMonitorOptions?.metricType],
      ["resultValuePath", filter.customCodeMonitorOptions?.resultValuePath],
    ];

    for (const [name, value] of selectors) {
      const text: string = toText(value);

      if (text) {
        measurement.push([name, text]);
      }
    }

    if (!CriteriaBands.isLineFilterType(filter.filterType)) {
      measurement.push(["filterType", toText(filter.filterType)]);

      const value: string = toText(filter.value);

      if (value) {
        measurement.push(["value", value]);
      }
    }

    return JSON.stringify(measurement);
  }

  /*
   * The criteria's band key: the set of measurements its filters read, in
   * one order. Criteria with the same key are bands of one another.
   */
  public static getBandKey(
    criteria: Pick<MonitorCriteriaInstanceType, "filters"> | undefined,
  ): string {
    const measurements: Array<string> = Array.from(
      new Set<string>(
        (criteria?.filters || []).map((filter: CriteriaFilter): string => {
          return CriteriaBands.getMeasurement(filter);
        }),
      ),
    ).sort();

    return JSON.stringify(measurements);
  }

  public static areBandsOfOneAnother(
    first: Pick<MonitorCriteriaInstanceType, "filters"> | undefined,
    second: Pick<MonitorCriteriaInstanceType, "filters"> | undefined,
  ): boolean {
    return CriteriaBands.getBandKey(first) === CriteriaBands.getBandKey(second);
  }
}
