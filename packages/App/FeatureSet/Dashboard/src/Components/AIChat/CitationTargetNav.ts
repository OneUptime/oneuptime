import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { isAIResourceType } from "Common/Types/AI/AIResourceContext";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourcePageContextUtil from "./ResourcePageContext";
import {
  ProfilesUrlState,
  buildProfilesRoute,
  parseProfilesUrlState,
} from "../../Utils/ProfilesUrlState";

/*
 * Maps an AI citation/widget target onto its dashboard route. Shared by the
 * citation chips and the inline widgets so a chart/table can deep-link to the
 * same place its underlying data lives.
 */
export const targetTypeToPageMap: {
  [key in AIChatCitationTargetType]: PageMap | undefined;
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
  [AIChatCitationTargetType.ScheduledMaintenanceEvents]:
    PageMap.SCHEDULED_MAINTENANCE_EVENTS,
  [AIChatCitationTargetType.ScheduledMaintenanceView]:
    PageMap.SCHEDULED_MAINTENANCE_VIEW,
  [AIChatCitationTargetType.OnCallPolicies]: PageMap.ON_CALL_DUTY_POLICIES,
  [AIChatCitationTargetType.OnCallPolicyView]: PageMap.ON_CALL_DUTY_POLICY_VIEW,
  [AIChatCitationTargetType.StatusPages]: PageMap.STATUS_PAGES,
  [AIChatCitationTargetType.StatusPageView]: PageMap.STATUS_PAGE_VIEW,
  [AIChatCitationTargetType.Slos]: PageMap.SLOS,
  [AIChatCitationTargetType.SloView]: PageMap.SLO_VIEW,
  [AIChatCitationTargetType.Runbooks]: PageMap.RUNBOOKS,
  [AIChatCitationTargetType.RunbookView]: PageMap.RUNBOOK_VIEW,
  [AIChatCitationTargetType.Workflows]: PageMap.WORKFLOWS,
  [AIChatCitationTargetType.WorkflowView]: PageMap.WORKFLOW_VIEW,
  [AIChatCitationTargetType.Probes]: PageMap.MONITORS_SETTINGS_PROBES,
  [AIChatCitationTargetType.Teams]: PageMap.TEAMS,
  [AIChatCitationTargetType.SecurityEvents]: PageMap.SECURITY_EVENTS,
  [AIChatCitationTargetType.SecurityCases]: PageMap.SECURITY_CASES,
  [AIChatCitationTargetType.SecurityCaseView]: PageMap.SECURITY_CASE_VIEW,
  [AIChatCitationTargetType.ThreatIntel]: PageMap.SECURITY_EVENTS_THREAT_INTEL,
  [AIChatCitationTargetType.SecurityPlaybooks]: PageMap.SECURITY_PLAYBOOKS,
  [AIChatCitationTargetType.RumApplications]: PageMap.RUM_APPLICATIONS,
  [AIChatCitationTargetType.RumApplicationView]: PageMap.RUM_APPLICATION_VIEW,
  [AIChatCitationTargetType.TelemetryResources]: undefined,
  [AIChatCitationTargetType.TelemetryResourceView]: undefined,
  [AIChatCitationTargetType.ServiceView]: PageMap.SERVICE_VIEW,
  [AIChatCitationTargetType.Profiles]: PageMap.PROFILES,
  [AIChatCitationTargetType.DataStores]: PageMap.DATA_SECURITY_STORES,
  [AIChatCitationTargetType.DataStoreView]: PageMap.DATA_SECURITY_STORE_VIEW,
  [AIChatCitationTargetType.DataSecurityIssues]: PageMap.DATA_SECURITY_ISSUES,
  [AIChatCitationTargetType.DataSecurityIssueView]:
    PageMap.DATA_SECURITY_ISSUE_VIEW,
  [AIChatCitationTargetType.DataSecurityAccess]: PageMap.DATA_SECURITY_ACCESS,
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
  [AIChatCitationTargetType.ScheduledMaintenanceEvents]: IconProp.Clock,
  [AIChatCitationTargetType.ScheduledMaintenanceView]: IconProp.Clock,
  [AIChatCitationTargetType.OnCallPolicies]: IconProp.Call,
  [AIChatCitationTargetType.OnCallPolicyView]: IconProp.Call,
  [AIChatCitationTargetType.StatusPages]: IconProp.CheckCircle,
  [AIChatCitationTargetType.StatusPageView]: IconProp.CheckCircle,
  [AIChatCitationTargetType.Slos]: IconProp.ArrowTrendingUp,
  [AIChatCitationTargetType.SloView]: IconProp.ArrowTrendingUp,
  [AIChatCitationTargetType.Runbooks]: IconProp.Book,
  [AIChatCitationTargetType.RunbookView]: IconProp.Book,
  [AIChatCitationTargetType.Workflows]: IconProp.Workflow,
  [AIChatCitationTargetType.WorkflowView]: IconProp.Workflow,
  [AIChatCitationTargetType.Probes]: IconProp.Signal,
  [AIChatCitationTargetType.Teams]: IconProp.Team,
  [AIChatCitationTargetType.SecurityEvents]: IconProp.ShieldExclamation,
  [AIChatCitationTargetType.SecurityCases]: IconProp.ShieldExclamation,
  [AIChatCitationTargetType.SecurityCaseView]: IconProp.ShieldExclamation,
  [AIChatCitationTargetType.ThreatIntel]: IconProp.Bug,
  [AIChatCitationTargetType.SecurityPlaybooks]: IconProp.Bolt,
  [AIChatCitationTargetType.RumApplications]: IconProp.AltGlobe,
  [AIChatCitationTargetType.RumApplicationView]: IconProp.AltGlobe,
  [AIChatCitationTargetType.TelemetryResources]: IconProp.Server,
  [AIChatCitationTargetType.TelemetryResourceView]: IconProp.Server,
  [AIChatCitationTargetType.ServiceView]: IconProp.Cube,
  [AIChatCitationTargetType.Profiles]: IconProp.Fire,
  [AIChatCitationTargetType.DataStores]: IconProp.Database,
  [AIChatCitationTargetType.DataStoreView]: IconProp.Database,
  [AIChatCitationTargetType.DataSecurityIssues]: IconProp.ShieldExclamation,
  [AIChatCitationTargetType.DataSecurityIssueView]: IconProp.ShieldExclamation,
  [AIChatCitationTargetType.DataSecurityAccess]: IconProp.Key,
};

/*
 * A Profiles citation opens the Profiler on the profiles its evidence was
 * read from: the service, the kind and the window, each checked as the
 * Profiler checks its own address (an id that is not one, or a window
 * that does not hold up, is left out). Nothing else in the target reaches
 * the address.
 */
function getProfilesCitationRoute(params: { [key: string]: string }): Route {
  const state: ProfilesUrlState = parseProfilesUrlState(
    (name: string): string | null => {
      if (
        name !== "serviceId" &&
        name !== "profileType" &&
        name !== "startTime" &&
        name !== "endTime"
      ) {
        return null;
      }

      return typeof params[name] === "string" ? params[name]! : null;
    },
  );

  return buildProfilesRoute(state);
}

export function getRouteForCitationTarget(
  target: AIChatCitationTarget | undefined,
): Route | undefined {
  if (!target) {
    return undefined;
  }

  if (
    target.type === AIChatCitationTargetType.TelemetryResources ||
    target.type === AIChatCitationTargetType.TelemetryResourceView
  ) {
    const resourceType: string | undefined = target.params?.["resourceType"];
    if (!isAIResourceType(resourceType)) {
      return undefined;
    }
    const resourceId: string | undefined = target.params?.["resourceId"];
    if (target.type === AIChatCitationTargetType.TelemetryResourceView) {
      if (!resourceId || !ObjectID.isValidUUID(resourceId)) {
        return undefined;
      }
      return ResourcePageContextUtil.getRoute(resourceType, resourceId);
    }
    return ResourcePageContextUtil.getRoute(resourceType);
  }

  if (target.type === AIChatCitationTargetType.Profiles) {
    return getProfilesCitationRoute(target.params || {});
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
