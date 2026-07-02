import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { KubernetesResource } from "./KubernetesResourceUtils";

/*
 * Deep-link builders that pivot from Kubernetes resource views to the
 * global telemetry explorers, pre-filtered on ClickHouse resource
 * attributes (resource.k8s.cluster.name, resource.k8s.pod.name, ...).
 *
 * NOTE: the two explorers parse the `filters` query param differently —
 * the logs explorer (Components/Logs/LogsViewer.tsx readInitialUrlState)
 * expects [facetKey, string[]] TUPLES while the metrics explorer
 * (Components/Metrics/MetricsViewer.tsx readInitialUrlState) expects
 * [facetKey, value] PAIRS with a single value. Both route attribute
 * facets through the `attributes.` key prefix. Route.addQueryParams does
 * NOT encode values, so JSON payloads are encodeURIComponent-wrapped
 * manually (same idiom as TracesViewer's recording-rule prefill link).
 */

type BuildExplorerRouteFunction = (attributes: Record<string, string>) => Route;

export const buildLogsExplorerRoute: BuildExplorerRouteFunction = (
  attributes: Record<string, string>,
): Route => {
  const filters: Array<[string, Array<string>]> = Object.entries(attributes)
    .filter(([, value]: [string, string]) => {
      return Boolean(value);
    })
    .map(([key, value]: [string, string]): [string, Array<string>] => {
      return [`attributes.${key}`, [value]];
    });

  const route: Route = new Route(
    RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route).toString(),
  );

  if (filters.length > 0) {
    route.addQueryParams({
      filters: encodeURIComponent(JSON.stringify(filters)),
    });
  }

  return route;
};

export const buildMetricsExplorerRoute: BuildExplorerRouteFunction = (
  attributes: Record<string, string>,
): Route => {
  const filters: Array<[string, string]> = Object.entries(attributes)
    .filter(([, value]: [string, string]) => {
      return Boolean(value);
    })
    .map(([key, value]: [string, string]): [string, string] => {
      return [`attributes.${key}`, value];
    });

  const route: Route = new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.METRICS] as Route,
    ).toString(),
  );

  if (filters.length > 0) {
    route.addQueryParams({
      filters: encodeURIComponent(JSON.stringify(filters)),
    });
  }

  return route;
};

/*
 * Row actions for the Kubernetes resource list tables: "Logs" and
 * "Metrics" pivots that deep-link into the explorers pre-filtered on the
 * row's telemetry attributes. Rendered after the built-in View action.
 */
export function buildTelemetryPivotActionButtons(
  getAttributes: (resource: KubernetesResource) => Record<string, string>,
): Array<ActionButtonSchema<KubernetesResource>> {
  return [
    {
      title: "Logs",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (
        resource: KubernetesResource,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          Navigation.navigate(buildLogsExplorerRoute(getAttributes(resource)));
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    },
    {
      title: "Metrics",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (
        resource: KubernetesResource,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          Navigation.navigate(
            buildMetricsExplorerRoute(getAttributes(resource)),
          );
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    },
  ];
}
