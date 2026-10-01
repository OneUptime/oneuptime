import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed MESSAGE_QUEUE* page needs a trail here, the Archived list and
 * the rule view pages included: a page without one renders with no
 * breadcrumbs at all, silently. App/Tests/Dashboard/
 * MessageQueueProductWiring.test.ts enumerates the routed keys and fails by
 * name when one is missing.
 */
export function getMessageQueueBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUES, [
      "Project",
      "Queues",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUES_ARCHIVED, [
      "Project",
      "Queues",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUES_DOCUMENTATION, [
      "Project",
      "Queues",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES,
      ["Project", "Queues", "Label Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW,
      ["Project", "Queues", "Label Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES,
      ["Project", "Queues", "Owner Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW,
      ["Project", "Queues", "Owner Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUE_VIEW, [
      "Project",
      "Queues",
      "View Queue",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUE_VIEW_TRACES, [
      "Project",
      "Queues",
      "View Queue",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUE_VIEW_METRICS, [
      "Project",
      "Queues",
      "View Queue",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUE_VIEW_OWNERS, [
      "Project",
      "Queues",
      "View Queue",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUE_VIEW_SETTINGS, [
      "Project",
      "Queues",
      "View Queue",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION, [
      "Project",
      "Queues",
      "View Queue",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.MESSAGE_QUEUE_VIEW_DELETE, [
      "Project",
      "Queues",
      "View Queue",
      "Delete Queue",
    ]),
  };
  return breadcrumpLinksMap[path];
}
