import { JSONObject } from "../../Types/JSON";
import { copyOwnValues } from "../LookupTable";
import { PROMQL_METRIC_NAME_LABEL } from "./PromQLAst";
import { PromQLLabels, promQLLabelsKey } from "./PromQLLabels";

/*
 * HOW A METRICS MONITOR WRITTEN IN PROMQL NAMES THE SERIES IT JUDGES
 * (issues #7712, #10227).
 *
 * Every series the expression returns is judged on its own and opens its
 * own incident or alert, named by its labels without `__name__`, as
 * Prometheus names an alert: `up == 0` keeps the name `up`, which says
 * nothing about which target is down. Two series of one check that only
 * their names tell apart keep them, so neither is lost.
 *
 * The worker names the series it judges here (PromQLMetricMonitor), and an
 * incident or alert keeps the labels of the one that opened it
 * (`seriesLabels`). Its chart charts that series alone, found again by the
 * same names (isSeriesNamed), so the series the person paged sees is the
 * one that breached.
 */

// A series' labels without its metric's name: a copy, own keys only.
export const withoutPromQLMetricName: (labels: PromQLLabels) => PromQLLabels = (
  labels: PromQLLabels,
): PromQLLabels => {
  const copy: PromQLLabels = copyOwnValues(labels);
  delete copy[PROMQL_METRIC_NAME_LABEL];
  return copy;
};

/*
 * The name each series of one check goes by, in order: its labels without
 * `__name__`, or with it where another series of the check has the same
 * labels without it.
 */
export const getPromQLMonitorSeriesNames: (
  series: Array<PromQLLabels>,
) => Array<PromQLLabels> = (
  series: Array<PromQLLabels>,
): Array<PromQLLabels> => {
  const namesNeeded: Map<string, number> = new Map<string, number>();

  for (const labels of series) {
    const key: string = promQLLabelsKey(withoutPromQLMetricName(labels));
    namesNeeded.set(key, (namesNeeded.get(key) || 0) + 1);
  }

  return series.map((labels: PromQLLabels): PromQLLabels => {
    const unnamed: PromQLLabels = withoutPromQLMetricName(labels);

    return (namesNeeded.get(promQLLabelsKey(unnamed)) || 0) > 1
      ? copyOwnValues(labels)
      : unnamed;
  });
};

// Whether two label sets hold the same labels, each with the same value.
const isSameLabels: (a: PromQLLabels, b: JSONObject) => boolean = (
  a: PromQLLabels,
  b: JSONObject,
): boolean => {
  const aNames: Array<string> = Object.keys(a);
  const bNames: Array<string> = Object.keys(b);

  if (aNames.length !== bNames.length) {
    return false;
  }

  return aNames.every((name: string): boolean => {
    return (
      Object.prototype.hasOwnProperty.call(b, name) &&
      String(b[name]) === a[name]
    );
  });
};

/*
 * Whether a series is the one an incident or alert keeps the labels of:
 * the same labels, without `__name__` - or with it, where the check named
 * the series by its name too.
 */
export const isSeriesNamed: (data: {
  labels: PromQLLabels;
  seriesLabels: JSONObject;
}) => boolean = (data: {
  labels: PromQLLabels;
  seriesLabels: JSONObject;
}): boolean => {
  return (
    isSameLabels(withoutPromQLMetricName(data.labels), data.seriesLabels) ||
    isSameLabels(data.labels, data.seriesLabels)
  );
};
