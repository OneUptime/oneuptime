import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getOpenStackBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUDS, [
      "Project",
      "OpenStack",
      "Clouds",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW, [
      "Project",
      "OpenStack",
      "View Cloud",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_TOPOLOGY, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Topology",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_SERVICES, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Services",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Services", "Service Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Hypervisors",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL,
      [
        "Project",
        "OpenStack",
        "View Cloud",
        "Hypervisors",
        "Hypervisor Detail",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Instances",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_INSTANCE_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Instances", "Instance Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Flavors",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Networks",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Networks", "Network Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Routers",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_ROUTER_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Routers", "Router Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Floating IPs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Volumes",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_VOLUME_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Volumes", "Volume Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS,
      ["Project", "OpenStack", "View Cloud", "Storage Pools"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOL_DETAIL,
      [
        "Project",
        "OpenStack",
        "View Cloud",
        "Storage Pools",
        "Storage Pool Detail",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_IMAGES, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Images",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_FLAVOR_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Flavors", "Flavor Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES,
      ["Project", "OpenStack", "View Cloud", "Availability Zones"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONE_DETAIL,
      [
        "Project",
        "OpenStack",
        "View Cloud",
        "Availability Zones",
        "Availability Zone Detail",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATES, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Aggregates",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATE_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Aggregates", "Aggregate Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Subnets",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_SUBNET_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Subnets", "Subnet Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IP_DETAIL,
      [
        "Project",
        "OpenStack",
        "View Cloud",
        "Floating IPs",
        "Floating IP Detail",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS,
      ["Project", "OpenStack", "View Cloud", "Network Agents"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL,
      [
        "Project",
        "OpenStack",
        "View Cloud",
        "Network Agents",
        "Network Agent Detail",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Snapshots and Backups",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_IMAGE_DETAIL, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Images",
      "Image Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE,
      ["Project", "OpenStack", "View Cloud", "What It Stands On"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE_DEPENDENCY,
      ["Project", "OpenStack", "View Cloud", "What It Stands On", "Dependency"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_DOMAINS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Domains",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Projects",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_PROJECT_DETAIL,
      ["Project", "OpenStack", "View Cloud", "Projects", "Project Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_INSIGHTS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS,
      ["Project", "OpenStack", "View Cloud", "Recommendations"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_AI_INSIGHTS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "AI",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_AI_LOGS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_AI_AGENT, [
      "Project",
      "OpenStack",
      "View Cloud",
      "AI",
      "AI agent",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_METRICS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_LOGS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_TRACES, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_ALERTS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "OpenStack", "View Cloud", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_OWNERS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_AUDIT_LOGS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_DELETE, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Delete Cloud",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION,
      ["Project", "OpenStack", "View Cloud", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_DOCUMENTATION, [
      "Project",
      "OpenStack",
      "Documentation",
    ]),

    // OpenStack Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_SETTINGS_OWNER_RULES, [
      "Project",
      "OpenStack",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_SETTINGS_OWNER_RULE_VIEW,
      ["Project", "OpenStack", "Settings", "Owner Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_SETTINGS_LABEL_RULES, [
      "Project",
      "OpenStack",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.OPENSTACK_SETTINGS_LABEL_RULE_VIEW,
      ["Project", "OpenStack", "Settings", "Label Rules", "View Rule"],
    ),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_CLOUD_VIEW_FEED, [
      "Project",
      "OpenStack",
      "View Cloud",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.OPENSTACK_ARCHIVED, [
      "Project",
      "OpenStack",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
