import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getRumBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.RUM_APPLICATIONS, [
      "Project",
      "Real User Monitoring",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUM_APPLICATION_VIEW, [
      "Project",
      "Real User Monitoring",
      "View Application",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.RUM_APPLICATION_VIEW_RECOMMENDATIONS,
      [
        "Project",
        "Real User Monitoring",
        "View Application",
        "Recommendations",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUM_APPLICATION_VIEW_METRICS, [
      "Project",
      "Real User Monitoring",
      "View Application",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUM_APPLICATION_VIEW_LOGS, [
      "Project",
      "Real User Monitoring",
      "View Application",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUM_APPLICATION_VIEW_TRACES, [
      "Project",
      "Real User Monitoring",
      "View Application",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY,
      ["Project", "Real User Monitoring", "View Application", "Session Replay"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW,
      [
        "Project",
        "Real User Monitoring",
        "View Application",
        "Session Replay",
        "Watch Session",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT,
      [
        "Project",
        "Real User Monitoring",
        "View Application",
        "Replay Access Log",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION,
      ["Project", "Real User Monitoring", "View Application", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUM_APPLICATION_VIEW_DELETE, [
      "Project",
      "Real User Monitoring",
      "View Application",
      "Delete Application",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUM_SETTINGS_SESSION_REPLAY, [
      "Project",
      "Real User Monitoring",
      "Session Replay Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
