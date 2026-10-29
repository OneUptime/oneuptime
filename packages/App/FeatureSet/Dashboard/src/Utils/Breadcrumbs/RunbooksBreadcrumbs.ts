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
    /*
     * A runbook's pages are named by their own titles, never by the side
     * menu section that holds them (Executions is under Logs, Triggers and
     * Settings under Settings), as on every record's page in the product.
     */
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
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_TRIGGERS, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Triggers",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_SETTINGS, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_VARIABLES, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Variables",
    ]),
    // Every page of a runbook's menu has its trail, these two included.
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_OWNERS, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_AUDIT_LOGS, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOK_VIEW_DELETE, [
      "Project",
      "Runbooks",
      "View Runbook",
      "Delete Runbook",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_VARIABLES, [
      "Project",
      "Runbooks",
      "Global Variables",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_RUNNERS, [
      "Project",
      "Runbooks",
      "Runners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_RUNNER_VIEW, [
      "Project",
      "Runbooks",
      "Runners",
      "View Runner",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_SETTINGS_OWNER_RULES, [
      "Project",
      "Runbooks",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_SETTINGS_OWNER_RULE_VIEW, [
      "Project",
      "Runbooks",
      "Settings",
      "Owner Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_SETTINGS_LABEL_RULES, [
      "Project",
      "Runbooks",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.RUNBOOKS_SETTINGS_LABEL_RULE_VIEW, [
      "Project",
      "Runbooks",
      "Settings",
      "Label Rules",
      "View Rule",
    ]),
  };
  return breadcrumpLinksMap[path];
}
