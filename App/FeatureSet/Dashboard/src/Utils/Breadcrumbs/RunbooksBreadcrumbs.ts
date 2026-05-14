import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getRunbooksBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS, ["Project", "Runbooks"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_EXECUTIONS, [
      "Project",
      "Runbooks",
      "Executions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW, [
      "Project",
      "Runbooks",
      "View Runbook",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_STEPS, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Steps",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_EXECUTIONS, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Executions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_EXECUTION, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Executions",
      "Execution",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_SETTINGS, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_DELETE, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Delete Runbook",
    ]),
  };
  return breadcrumpLinksMap[path];
}
