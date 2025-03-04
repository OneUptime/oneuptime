import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getIncidentsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENTS, [
      "Project",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.UNRESOLVED_INCIDENTS, [
      "Project",
      "Incidents",
      "Active Incidents",
    ]),

    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
      ["Project", "Incidents", "Workspace Slack Connection"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ["Project", "Incidents", "Workspace Microsoft Teams Connection"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_CREATE, [
      "Project",
      "Incidents",
      "Declare New Incident",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW, [
      "Project",
      "Incidents",
      "View Incident",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_STATE_TIMELINE, [
      "Project",
      "Incidents",
      "View Incident",
      "State Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_REMEDIATION, [
      "Project",
      "Incidents",
      "View Incident",
      "Remediation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_ROOT_CAUSE, [
      "Project",
      "Incidents",
      "View Incident",
      "Root Cause",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_DESCRIPTION, [
      "Project",
      "Incidents",
      "View Incident",
      "Description",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_OWNERS, [
      "Project",
      "Incidents",
      "View Incident",
      "Owners",
    ]),

    ...BuildBreadcrumbLinksByTitles(
      PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
      ["Project", "Incidents", "View Incident", "On Call Executions"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_INTERNAL_NOTE, [
      "Project",
      "Incidents",
      "View Incident",
      "Private Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_PUBLIC_NOTE, [
      "Project",
      "Incidents",
      "View Incident",
      "Public Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Incidents",
      "View Incident",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_DELETE, [
      "Project",
      "Incidents",
      "View Incident",
      "Delete Incident",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.INCIDENT_VIEW_SETTINGS, [
      "Project",
      "Incidents",
      "View Incident",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
