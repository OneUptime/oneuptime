import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getTelemetryBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES, [
      "Project",
      "Telemetry",
      "Services",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_DOCUMENTATION, [
      "Project",
      "Telemetry",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_LOGS, [
      "Project",
      "Telemetry",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_METRICS, [
      "Project",
      "Telemetry",
      "Metrics",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_METRIC_VIEW, [
      "Project",
      "Telemetry",
      "Metrics",
      "Metrics Explorer",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_TRACE_VIEW, [
      "Project",
      "Telemetry",
      "Traces",
      "Trace Explorer",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_TRACES, [
      "Project",
      "Telemetry",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.TELEMETRY_SERVICES_VIEW_DOCUMENTATION,
      ["Project", "Telemetry", "Services", "View Service", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_LOGS, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_METRICS, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Metrics",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_TRACES, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_TRACE, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Traces",
      "View Trace",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_METRIC, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Metrics",
      "View Metric",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_SETTINGS, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TELEMETRY_SERVICES_VIEW_DELETE, [
      "Project",
      "Telemetry",
      "Services",
      "View Service",
      "Delete Service",
    ]),
  };
  return breadcrumpLinksMap[path];
}
