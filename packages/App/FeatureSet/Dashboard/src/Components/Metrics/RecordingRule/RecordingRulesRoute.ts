import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";

/*
 * Where Metrics > Settings > Recording Rules lives, and how a link lands on
 * one rule (#9946): a recording rule has no page of its own, so its link
 * opens the list already filtered to it, by the table's own Output Metric
 * filter in the address (TableFilterUrlState) - the filter shows as
 * applied, Back returns to it, and clearing it shows every rule. A rule's
 * output metric is its own in its project, so it finds that rule.
 */

// The list's table: its test id, its preferences and the key of its state in the address.
export const METRIC_RECORDING_RULES_TABLE_ID: string =
  "metric-recording-rules-table";

// The filter key the list's Output Metric filter reads.
export const METRIC_RECORDING_RULES_OUTPUT_FILTER_KEY: string =
  "outputMetricName";

// The list, or with an output metric, the list of the rule that writes it.
export function getMetricRecordingRulesRoute(outputMetricName?: string): Route {
  const route: Route = new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.METRICS_SETTINGS_RECORDING_RULES] as Route,
    ).toString(),
  );

  if (!outputMetricName) {
    return route;
  }

  return route.addQueryParams(
    TableFilterUrlState.getLinkQueryParams(METRIC_RECORDING_RULES_TABLE_ID, {
      filter: { [METRIC_RECORDING_RULES_OUTPUT_FILTER_KEY]: outputMetricName },
    }),
  );
}
