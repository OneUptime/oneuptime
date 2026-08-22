import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getSecurityEventsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS, [
      "Project",
      "Security Events",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_CORRELATE, [
      "Project",
      "Security Events",
      "Correlate",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_DETECTION_RULES, [
      "Project",
      "Security Events",
      "Detection Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_MONITORS, [
      "Project",
      "Security Events",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_DOCUMENTATION, [
      "Project",
      "Security Events",
      "Setup Guide",
    ]),
  };
  return breadcrumpLinksMap[path];
}
