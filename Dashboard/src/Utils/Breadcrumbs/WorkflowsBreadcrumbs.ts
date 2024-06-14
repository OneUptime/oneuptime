import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getWorkflowsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOWS, [
      "Project",
      "Workflows",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOWS_VARIABLES, [
      "Project",
      "Workflows",
      "Variables",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOWS_LOGS, [
      "Project",
      "Workflows",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOW_VIEW, [
      "Project",
      "Workflows",
      "View Workflow",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOW_BUILDER, [
      "Project",
      "Workflows",
      "View Workflow",
      "Builder",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOW_VARIABLES, [
      "Project",
      "Workflows",
      "View Workflow",
      "Variables",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOW_LOGS, [
      "Project",
      "Workflows",
      "View Workflow",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOW_VIEW_SETTINGS, [
      "Project",
      "Workflows",
      "View Workflow",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.WORKFLOW_DELETE, [
      "Project",
      "Workflows",
      "View Workflow",
      "Delete Workflow",
    ]),
  };
  return breadcrumpLinksMap[path];
}
