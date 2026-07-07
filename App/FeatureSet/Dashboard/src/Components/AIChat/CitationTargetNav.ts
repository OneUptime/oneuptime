import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Maps an AI citation/widget target onto its dashboard route. Shared by the
 * citation chips and the inline widgets so a chart/table can deep-link to the
 * same place its underlying data lives.
 */
export const targetTypeToPageMap: {
  [key in AIChatCitationTargetType]: PageMap;
} = {
  [AIChatCitationTargetType.Logs]: PageMap.LOGS,
  [AIChatCitationTargetType.Traces]: PageMap.TRACES,
  [AIChatCitationTargetType.TraceView]: PageMap.TRACE_VIEW,
  [AIChatCitationTargetType.Metrics]: PageMap.METRICS,
  [AIChatCitationTargetType.Exceptions]: PageMap.EXCEPTIONS,
  [AIChatCitationTargetType.Incidents]: PageMap.INCIDENTS,
  [AIChatCitationTargetType.IncidentView]: PageMap.INCIDENT_VIEW,
  [AIChatCitationTargetType.Alerts]: PageMap.ALERTS,
  [AIChatCitationTargetType.AlertView]: PageMap.ALERT_VIEW,
  [AIChatCitationTargetType.Monitors]: PageMap.MONITORS,
  [AIChatCitationTargetType.MonitorView]: PageMap.MONITOR_VIEW,
};

export const targetTypeToIcon: {
  [key in AIChatCitationTargetType]: IconProp;
} = {
  [AIChatCitationTargetType.Logs]: IconProp.Logs,
  [AIChatCitationTargetType.Traces]: IconProp.Activity,
  [AIChatCitationTargetType.TraceView]: IconProp.Activity,
  [AIChatCitationTargetType.Metrics]: IconProp.ChartBar,
  [AIChatCitationTargetType.Exceptions]: IconProp.Error,
  [AIChatCitationTargetType.Incidents]: IconProp.Alert,
  [AIChatCitationTargetType.IncidentView]: IconProp.Alert,
  [AIChatCitationTargetType.Alerts]: IconProp.Bell,
  [AIChatCitationTargetType.AlertView]: IconProp.Bell,
  [AIChatCitationTargetType.Monitors]: IconProp.Cube,
  [AIChatCitationTargetType.MonitorView]: IconProp.Cube,
};

export function getRouteForCitationTarget(
  target: AIChatCitationTarget | undefined,
): Route | undefined {
  if (!target) {
    return undefined;
  }

  const pageMapKey: PageMap | undefined = targetTypeToPageMap[target.type];
  const route: Route | undefined = pageMapKey
    ? (RouteMap[pageMapKey] as Route)
    : undefined;

  if (!route) {
    return undefined;
  }

  const params: { [key: string]: string } = target.params || {};
  const firstParamValue: string | undefined = Object.values(params)[0];

  return RouteUtil.populateRouteParams(
    route,
    firstParamValue ? { modelId: firstParamValue } : undefined,
  );
}

export function navigateToCitationTarget(
  target: AIChatCitationTarget | undefined,
): void {
  const route: Route | undefined = getRouteForCitationTarget(target);
  if (route) {
    Navigation.navigate(route);
  }
}
