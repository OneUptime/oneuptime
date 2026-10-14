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
      "Events",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_OVERVIEW, [
      "Project",
      "Security Events",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_CASES, [
      "Project",
      "Security Events",
      "Cases",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_CASE_VIEW, [
      "Project",
      "Security Events",
      "Cases",
      "View Case",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_CORRELATE, [
      "Project",
      "Security Events",
      "Correlate",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_ENTITIES, [
      "Project",
      "Security Events",
      "Entities",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_DETECTION_RULES, [
      "Project",
      "Security Events",
      "Detection Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_RULE_LIBRARY, [
      "Project",
      "Security Events",
      "Rule Library",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_ATTACK_COVERAGE, [
      "Project",
      "Security Events",
      "ATT&CK Coverage",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_MONITORS, [
      "Project",
      "Security Events",
      "Monitors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_CONNECTIONS, [
      "Project",
      "Security Events",
      "Connections",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_THREAT_INTEL, [
      "Project",
      "Security Events",
      "Threat Intel",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_PLAYBOOKS, [
      "Project",
      "Security Events",
      "Playbooks",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_PLAYBOOK_VIEW, [
      "Project",
      "Security Events",
      "Playbooks",
      "View Playbook",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_PLAYBOOK_RUNS, [
      "Project",
      "Security Events",
      "Playbook Runs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SECURITY_EVENTS_DOCUMENTATION, [
      "Project",
      "Security Events",
      "Setup Guide",
    ]),
  };
  return breadcrumpLinksMap[path];
}
