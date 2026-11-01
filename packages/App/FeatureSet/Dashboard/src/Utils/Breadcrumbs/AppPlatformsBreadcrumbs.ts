import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Every routed APP_PLATFORMS_* page needs a trail here: a page without one
 * renders with no breadcrumbs at all, silently. Each crumb is one segment of
 * the address - …/app-platforms/:id/logs is Project > App Platforms > View
 * Environment > Logs - so each one links to the page above it, as Cloud's
 * do. App/Tests/Dashboard/AppPlatformsProductWiring.test.ts enumerates the
 * routed keys and fails by name when one is missing.
 */

export function getAppPlatformsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.APP_PLATFORMS_OVERVIEW, [
      "Project",
      "App Platforms",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.APP_PLATFORMS_ENVIRONMENTS, [
      "Project",
      "App Platforms",
      "Environments",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.APP_PLATFORMS_ARCHIVED, [
      "Project",
      "App Platforms",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULES,
      ["Project", "App Platforms", "Label Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_SETTINGS_LABEL_RULE_VIEW,
      ["Project", "App Platforms", "Label Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULES,
      ["Project", "App Platforms", "Owner Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULE_VIEW,
      ["Project", "App Platforms", "Owner Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW, [
      "Project",
      "App Platforms",
      "View Environment",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_METRICS,
      ["Project", "App Platforms", "View Environment", "Metrics"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_LOGS,
      ["Project", "App Platforms", "View Environment", "Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_TRACES,
      ["Project", "App Platforms", "View Environment", "Traces"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INSTANCES,
      ["Project", "App Platforms", "View Environment", "Instances"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_FEED,
      ["Project", "App Platforms", "View Environment", "Feed"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INCIDENTS,
      ["Project", "App Platforms", "View Environment", "Incidents"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_ALERTS,
      ["Project", "App Platforms", "View Environment", "Alerts"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DOCUMENTATION,
      ["Project", "App Platforms", "View Environment", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SETTINGS,
      ["Project", "App Platforms", "View Environment", "Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_OWNERS,
      ["Project", "App Platforms", "View Environment", "Owners"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DELETE,
      ["Project", "App Platforms", "View Environment", "Delete Environment"],
    ),
  };
  return breadcrumpLinksMap[path];
}
