import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import {
  DeveloperDocsPageType,
  getDeveloperDocsPageKey,
} from "../Components/DeveloperDocs/DeveloperDocsPages";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";

/*
 * Where a CloudResource row's pages are.
 *
 * The table holds two kinds of row (CloudResourceKind), and since Cloud and
 * App Platforms became two products each kind has its pages in its own:
 *
 *   - an environment - where an app runs on a managed app or container
 *     platform, such as ECS, Cloud Run or App Service - in App Platforms
 *     (…/app-platforms/:id/…);
 *   - a resource - a virtual machine, a bucket, a managed database or any
 *     other resource in a cloud account - in Cloud (…/cloud/:id/…).
 *
 * Every link to a row goes through here, so it opens in the right product.
 * A link written before the split, or one that cannot know the row's kind
 * (a feed entry stored long ago, a chip whose relation did not read it),
 * still arrives: each product's page reads the row's kind first and
 * forwards to the same tab in the other product when the row is not its
 * own (getCloudResourceViewTabOfPath).
 */

// The tabs of a row's page; not every kind has every tab.
export enum CloudResourceViewTab {
  Overview = "overview",
  Apps = "apps",
  Metrics = "metrics",
  Logs = "logs",
  Traces = "traces",
  Instances = "instances",
  Feed = "feed",
  Incidents = "incidents",
  Alerts = "alerts",
  Changes = "changes",
  Documentation = "documentation",
  Settings = "settings",
  Owners = "owners",
  Delete = "delete",
  DeveloperTerraform = "developer-terraform",
  DeveloperApi = "developer-api",
  DeveloperCli = "developer-cli",
  DeveloperAiAssistants = "developer-ai-assistants",
}

/*
 * What follows the row's id in a tab's address, in both products: the
 * environment's logs are …/app-platforms/:id/logs, a resource's metrics
 * …/cloud/:id/metrics.
 */
export const CLOUD_RESOURCE_VIEW_TAB_PATHS: Readonly<
  Record<CloudResourceViewTab, string>
> = {
  [CloudResourceViewTab.Overview]: "",
  [CloudResourceViewTab.Apps]: "apps",
  [CloudResourceViewTab.Metrics]: "metrics",
  [CloudResourceViewTab.Logs]: "logs",
  [CloudResourceViewTab.Traces]: "traces",
  [CloudResourceViewTab.Instances]: "instances",
  [CloudResourceViewTab.Feed]: "feed",
  [CloudResourceViewTab.Incidents]: "incidents",
  [CloudResourceViewTab.Alerts]: "alerts",
  [CloudResourceViewTab.Changes]: "changes",
  [CloudResourceViewTab.Documentation]: "documentation",
  [CloudResourceViewTab.Settings]: "settings",
  [CloudResourceViewTab.Owners]: "owners",
  [CloudResourceViewTab.Delete]: "delete",
  [CloudResourceViewTab.DeveloperTerraform]: "developer/terraform",
  [CloudResourceViewTab.DeveloperApi]: "developer/api",
  [CloudResourceViewTab.DeveloperCli]: "developer/cli",
  [CloudResourceViewTab.DeveloperAiAssistants]: "developer/ai-assistants",
};

/*
 * An environment's pages, in App Platforms. It has the apps that run in it,
 * the telemetry they send - logs, traces and the running instances - and no
 * Changes: those are what a cloud account's activity log records about its
 * resources.
 */
export const ENVIRONMENT_VIEW_PAGES: Readonly<
  Partial<Record<CloudResourceViewTab, string>>
> = {
  [CloudResourceViewTab.Overview]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
  [CloudResourceViewTab.Apps]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APPS,
  [CloudResourceViewTab.Metrics]:
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_METRICS,
  [CloudResourceViewTab.Logs]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_LOGS,
  [CloudResourceViewTab.Traces]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_TRACES,
  [CloudResourceViewTab.Instances]:
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INSTANCES,
  [CloudResourceViewTab.Feed]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_FEED,
  [CloudResourceViewTab.Incidents]:
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INCIDENTS,
  [CloudResourceViewTab.Alerts]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_ALERTS,
  [CloudResourceViewTab.Documentation]:
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DOCUMENTATION,
  [CloudResourceViewTab.Settings]:
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SETTINGS,
  [CloudResourceViewTab.Owners]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_OWNERS,
  [CloudResourceViewTab.Delete]: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DELETE,
  [CloudResourceViewTab.DeveloperTerraform]: getDeveloperDocsPageKey(
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
    DeveloperDocsPageType.Terraform,
  ),
  [CloudResourceViewTab.DeveloperApi]: getDeveloperDocsPageKey(
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
    DeveloperDocsPageType.Api,
  ),
  [CloudResourceViewTab.DeveloperCli]: getDeveloperDocsPageKey(
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
    DeveloperDocsPageType.Cli,
  ),
  [CloudResourceViewTab.DeveloperAiAssistants]: getDeveloperDocsPageKey(
    PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
    DeveloperDocsPageType.AiAssistants,
  ),
};

/*
 * A resource's pages, in Cloud. Its metrics are what its provider publishes
 * about it, so it has no traces or instances of its own; it has the Changes
 * its account's activity log records, and the logs an AWS connection's
 * stream delivers from the log group AWS names after it (CloudLogGroups) -
 * its side menu shows Logs only for a kind of resource a log group names.
 */
export const RESOURCE_VIEW_PAGES: Readonly<
  Partial<Record<CloudResourceViewTab, string>>
> = {
  [CloudResourceViewTab.Overview]: PageMap.CLOUD_RESOURCE_VIEW,
  [CloudResourceViewTab.Metrics]: PageMap.CLOUD_RESOURCE_VIEW_METRICS,
  [CloudResourceViewTab.Logs]: PageMap.CLOUD_RESOURCE_VIEW_LOGS,
  [CloudResourceViewTab.Feed]: PageMap.CLOUD_RESOURCE_VIEW_FEED,
  [CloudResourceViewTab.Incidents]: PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS,
  [CloudResourceViewTab.Alerts]: PageMap.CLOUD_RESOURCE_VIEW_ALERTS,
  [CloudResourceViewTab.Changes]: PageMap.CLOUD_RESOURCE_VIEW_CHANGES,
  [CloudResourceViewTab.Documentation]:
    PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION,
  [CloudResourceViewTab.Settings]: PageMap.CLOUD_RESOURCE_VIEW_SETTINGS,
  [CloudResourceViewTab.Owners]: PageMap.CLOUD_RESOURCE_VIEW_OWNERS,
  [CloudResourceViewTab.Delete]: PageMap.CLOUD_RESOURCE_VIEW_DELETE,
  [CloudResourceViewTab.DeveloperTerraform]: getDeveloperDocsPageKey(
    PageMap.CLOUD_RESOURCE_VIEW,
    DeveloperDocsPageType.Terraform,
  ),
  [CloudResourceViewTab.DeveloperApi]: getDeveloperDocsPageKey(
    PageMap.CLOUD_RESOURCE_VIEW,
    DeveloperDocsPageType.Api,
  ),
  [CloudResourceViewTab.DeveloperCli]: getDeveloperDocsPageKey(
    PageMap.CLOUD_RESOURCE_VIEW,
    DeveloperDocsPageType.Cli,
  ),
  [CloudResourceViewTab.DeveloperAiAssistants]: getDeveloperDocsPageKey(
    PageMap.CLOUD_RESOURCE_VIEW,
    DeveloperDocsPageType.AiAssistants,
  ),
};

/*
 * The pages of a row of this kind. A row whose kind was not read (a
 * relation that did not select it) is sent to Cloud's pages, which forward
 * an environment to App Platforms; a row that names neither kind is an
 * environment, as every row was before resources existed.
 */
function getViewPages(
  cloudResourceKind: string | null | undefined,
): Readonly<Partial<Record<CloudResourceViewTab, string>>> {
  if (cloudResourceKind === undefined) {
    return RESOURCE_VIEW_PAGES;
  }

  return isCloudResourceKindResource(cloudResourceKind)
    ? RESOURCE_VIEW_PAGES
    : ENVIRONMENT_VIEW_PAGES;
}

/*
 * The page key of a row's tab in its own product, or of its Overview when
 * its kind has no such tab (an environment's Changes, a resource's Traces).
 */
export function getCloudResourceViewPageKey(
  cloudResourceKind: string | null | undefined,
  tab: CloudResourceViewTab = CloudResourceViewTab.Overview,
): string {
  const pages: Readonly<Partial<Record<CloudResourceViewTab, string>>> =
    getViewPages(cloudResourceKind);

  return (pages[tab] || pages[CloudResourceViewTab.Overview]) as string;
}

// A row's tab, in the current project, in the product the row belongs to.
export function getCloudResourceViewRoute(data: {
  // Undefined when the link could not read it: see getViewPages.
  cloudResourceKind: string | null | undefined;
  modelId: ObjectID | string;
  tab?: CloudResourceViewTab | undefined;
}): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      getCloudResourceViewPageKey(data.cloudResourceKind, data.tab)
    ] as Route,
    { modelId: data.modelId.toString() },
  );
}

/*
 * Which tab an address of a row's page is on: what follows the row's id in
 * the path. An address that names no tab this file knows - or that does not
 * hold the id at all - is on the Overview, so a forward never lands on a
 * blank page.
 */
export function getCloudResourceViewTabOfPath(data: {
  pathname: string;
  modelId: string;
}): CloudResourceViewTab {
  const marker: string = `/${data.modelId}`;
  const at: number = data.pathname.indexOf(marker);

  if (!data.modelId || at < 0) {
    return CloudResourceViewTab.Overview;
  }

  const rest: string = data.pathname
    .slice(at + marker.length)
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    })
    .join("/");

  const tabs: Array<CloudResourceViewTab> = Object.values(
    CloudResourceViewTab,
  ) as Array<CloudResourceViewTab>;

  return (
    tabs.find((tab: CloudResourceViewTab): boolean => {
      return CLOUD_RESOURCE_VIEW_TAB_PATHS[tab] === rest;
    }) || CloudResourceViewTab.Overview
  );
}

/*
 * Where a row's page in the wrong product forwards to: the same tab, in the
 * product the row belongs to, keeping the address's query and hash. The
 * pages call it once they have read the row's kind.
 */
export function getCloudResourceForwardRoute(data: {
  cloudResourceKind: string | null | undefined;
  modelId: string;
  pathname: string;
  search?: string | undefined;
  hash?: string | undefined;
}): string {
  const tab: CloudResourceViewTab = getCloudResourceViewTabOfPath({
    pathname: data.pathname,
    modelId: data.modelId,
  });

  return `${getCloudResourceViewRoute({
    cloudResourceKind: data.cloudResourceKind || null,
    modelId: data.modelId,
    tab,
  }).toString()}${data.search || ""}${data.hash || ""}`;
}
