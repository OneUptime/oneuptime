import Dictionary from "Common/Types/Dictionary";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricExplorerUrl from "Common/Utils/Metrics/MetricExplorerUrl";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";

/*
 * Deep links into the metric explorer (PageMap.METRIC_VIEW) from embedded
 * metric charts — the same route + query-param schema the metric list's
 * row click uses (MetricsViewer), with the params produced by the shared
 * MetricExplorerUrl serializer so embed links and explorer URLs can never
 * drift apart.
 */
export default class ExplorerLink {
  public static buildExplorerUrl(data: MetricViewData): URL {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.METRIC_VIEW]!,
    );

    const currentUrl: URL = Navigation.getCurrentURL();
    const explorerUrl: URL = new URL(
      currentUrl.protocol,
      currentUrl.hostname,
      route,
    );

    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData(data);

    for (const paramName of Object.keys(params)) {
      explorerUrl.addQueryParam(paramName, params[paramName] as string, true);
    }

    return explorerUrl;
  }

  public static openInExplorer(data: MetricViewData): void {
    Navigation.navigate(ExplorerLink.buildExplorerUrl(data));
  }
}
