import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed XCP_NG* page has a trail here, the Archived list included.
 * App/Tests/Dashboard/XcpNgProductWiring.test.ts enumerates the keys and
 * fails by name when one is missing, and
 * Common/Tests/App/Dashboard/EveryPageHasATrail does for every product.
 *
 * The product is "XCP-ng", its list "XCP-ng Pools" (the list's own title),
 * one pool "View Pool", and a pool's parts are named as its side menu names
 * them: Hosts, VMs and Storage (its storage repositories), and each row's
 * page in its list's word - Host Detail, VM Detail, Storage Detail - so no
 * language names one thing in two words.
 * Never the bare "Pools" or "Pool": those keys are Ceph's storage pools,
 * worded so in every language (存储池), while an XCP-ng pool is a pool of
 * hosts (资源池).
 */
export function getXcpNgBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOLS, [
      "Project",
      "XCP-ng",
      "XCP-ng Pools",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW, [
      "Project",
      "XCP-ng",
      "View Pool",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_HOSTS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Hosts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Hosts",
      "Host Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_VMS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "VMs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_VM_DETAIL, [
      "Project",
      "XCP-ng",
      "View Pool",
      "VMs",
      "VM Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_STORAGE, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Storage",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Storage",
      "Storage Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_TOPOLOGY, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Topology",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_INSIGHTS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Resource Usage",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_RECOMMENDATIONS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Recommendations",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_METRICS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_LOGS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_INCIDENTS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_ALERTS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "XCP-ng", "View Pool", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_FEED, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_OWNERS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_SETTINGS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_AUDIT_LOGS, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOL_VIEW_DELETE, [
      "Project",
      "XCP-ng",
      "View Pool",
      "Delete Pool",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_DOCUMENTATION, [
      "Project",
      "XCP-ng",
      "Documentation",
    ]),

    // XCP-ng Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_SETTINGS_OWNER_RULES, [
      "Project",
      "XCP-ng",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_SETTINGS_OWNER_RULE_VIEW, [
      "Project",
      "XCP-ng",
      "Settings",
      "Owner Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_SETTINGS_LABEL_RULES, [
      "Project",
      "XCP-ng",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_SETTINGS_LABEL_RULE_VIEW, [
      "Project",
      "XCP-ng",
      "Settings",
      "Label Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_SETTINGS_RULES_AUDIT_LOGS, [
      "Project",
      "XCP-ng",
      "Settings",
      "Rule Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.XCP_NG_POOLS_ARCHIVED, [
      "Project",
      "XCP-ng",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
