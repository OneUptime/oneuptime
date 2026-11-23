import ProductKey from "../../../Types/Product/ProductKey";
import { SWITCHABLE_PRODUCTS } from "../../../Types/Product/ServerProducts";
import { SETUP_ACTIONS_RUN_OUTSIDE_CHAT } from "../../../Types/AI/AISetupActions";
import { getToolProducts } from "../../../Server/Utils/AI/Toolbox/ToolProducts";
import {
  PRODUCT_OF_AI_RESOURCE_TYPE,
  PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE,
} from "../../../Server/Utils/ServerProducts/ProductsOfRequest";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY ROUTE OF THE SERVER THAT IS NOT A GET IS A DECISION, WHILE A
 * PRODUCT IS SWITCHED OFF ON THE SERVER (#7479, #9489).
 *
 * Beside the CRUD API (BaseAPI, which refuses every record of a product
 * that is off), the server registers routes of its own. This walks every
 * file of the server's code that registers one - a POST, PUT, PATCH,
 * DELETE or ALL, read by the TypeScript parser, so a new file cannot be
 * missed - and holds each to one of two decisions:
 *
 *   - a file of products (PRODUCT_ROUTE_FILES), route by route: each route
 *     names the products it acts on with ServerProductRoutes - refused,
 *     with who can switch them on, while one is off - or is listed as left
 *     alone, with why: it only reads (products that stay on show records of
 *     others, and switching a product on again loses nothing), it is a
 *     published page's own (a public status page, form or dashboard keeps
 *     working, as switching a product off promises), something outside
 *     OneUptime calls it (a webhook, a phone call: what already runs keeps
 *     running), or it is refused in its handler once what it acts on is
 *     read, which a suite of its own holds;
 *   - a file decided as a whole (FILES_DECIDED_WHOLE), with why - it is of
 *     no one product (sign-in, billing, the project, how OneUptime reaches
 *     people), the server's own (a probe reporting its checks, telemetry
 *     arriving, an AI agent reporting on its work, a master admin's
 *     setup), or it only reads - and the number of such routes it
 *     registers, so a route added to it is a decision again.
 *
 * A write a route makes with its caller's props is refused again where
 * every write is (ProductWriteRefusal); what the server starts on its own
 * for a product that is off is decided where it starts (AIRunService,
 * RunbookStarter).
 */

const REPOSITORY: string = path.join(__dirname, "../../../../..");

// Where the server's code registers routes, from the repository's root.
const ROUTE_ROOTS: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/App",
  "packages/Probe",
  "packages/Home",
  "packages/TestServer",
  "ee/Server",
].filter((root: string): boolean => {
  // ee/ only where it is checked out: Common Test deletes it before it runs.
  return fs.existsSync(path.join(REPOSITORY, root));
});

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  "node_modules",
  "build",
  "dist",
  "Tests",
]);

/*
 * A file that may register a route - on a router of any name (router,
 * this.router, data.router, apiRouter) or the app: read by the parser only
 * then.
 */
const MAY_REGISTER: RegExp =
  /(?:router|\bapp)\s*\??\.\s*(?:post|put|delete|patch|all)\s*\(/i;

// What a route is registered on: a router of any name, or the app.
const ROUTER: RegExp = /(^|\.)(\w*router|app)$/i;

// A suite's own file: never the server's.
const TEST_FILE: RegExp = /\.(test|spec)\.ts$/;

const VERBS: ReadonlySet<string> = new Set([
  "post",
  "put",
  "delete",
  "patch",
  "all",
]);

// Why a route is left alone, in the words of the decisions above.
const READ: string = "It only reads.";
const PUBLIC_PAGE: string =
  "The published page's own: it stays up while the product is off.";
const OUTSIDE: string =
  "Something outside OneUptime calls it: what already runs keeps running.";
const READ_HELPER: string =
  "A helper that registers reads for its callers: each call is listed in readHelpers, with why.";
const FEED_FALLBACK: string =
  "It answers a write to a calendar feed's address with 405: a feed only reads.";
const BLOCKLIST_FEED_FALLBACK: string =
  "It answers a write to a blocklist feed's address with 405: a firewall only reads a feed.";
const PAGE_LINK: string =
  "A page's own link or key press: the person paged answers it. What already runs keeps running, and refusing the answer would page everyone up the policy.";
const IN_FIX: string =
  "Refused in RemediationApproval once the fix is read (RemediationFixProducts): its incident's or alert's product, Runbooks for a fix that starts a runbook, Cloud for a dry run - a Slack or Microsoft Teams press too.";

interface ProductRouteFile {
  /*
   * The products its routes act on. Every product a refusal of it may
   * name is one of these.
   */
  products: ReadonlyArray<ProductKey>;
  // Path text of a route left alone, as the file writes it -> why.
  leftAlone: Record<string, string>;
  /*
   * A helper of the file that registers reads for its callers: its name ->
   * each call's first argument, as the file writes it -> why.
   */
  readHelpers?: Record<string, Record<string, string>>;
  /*
   * A refusal whose product its caller hands it (data.product) -> the
   * products it may be.
   */
  handedProducts?: Record<string, ReadonlyArray<ProductKey>>;
}

// A refusal the file may hold whatever its product: a rule's table names it.
const ANY_PRODUCT: ReadonlyArray<ProductKey> = SWITCHABLE_PRODUCTS;

/*
 * The products of every setup action the API runs outside Ask AI's chat
 * (#7241): since #10041, Monitors (a website's and a service's monitors,
 * who is told), Services (a service's recommended monitors), On-Call
 * (paging, people added to a policy) and Status Pages. Inviting people and
 * How to Reach Me are of no one product, so they name none and run while
 * any product is off ("what the decisions stand on" holds the list).
 */
const SETUP_ACTION_PRODUCTS: ReadonlyArray<ProductKey> = Array.from(
  new Set<ProductKey>(
    SETUP_ACTIONS_RUN_OUTSIDE_CHAT.flatMap(
      (action: string): ReadonlyArray<ProductKey> => {
        return getToolProducts(action);
      },
    ),
  ),
);

const PRODUCT_ROUTE_FILES: Record<string, ProductRouteFile> = {
  "packages/Common/Server/API/StatusPageAPI.ts": {
    products: [ProductKey.StatusPages],
    leftAlone: {
      unsubscribeApiPath: PUBLIC_PAGE,
      "`${new this.entityType().getCrudApiPath()?.toString()}/listing-monitors`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/domain`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/master-page/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/master-password/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType().getCrudApiPath()?.toString()}/sso/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType().getCrudApiPath()?.toString()}/oidc/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/resources/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/uptime/:statusPageId`":
        PUBLIC_PAGE,
      overviewApiPath: PUBLIC_PAGE,
      summaryApiPath: PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/update-subscription/:statusPageId/:subscriberId/:token`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/get-subscription/:statusPageId/:subscriberId/:token`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/subscribe/:statusPageId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/manage-subscription/:statusPageId`":
        PUBLIC_PAGE,
      incidentsListApiPath: PUBLIC_PAGE,
      scheduledMaintenanceEventsListApiPath: PUBLIC_PAGE,
      announcementsListApiPath: PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/incidents/:statusPageIdOrDomain/:incidentId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/scheduled-maintenance-events/:statusPageIdOrDomain/:scheduledMaintenanceId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/announcements/:statusPageIdOrDomain/:announcementId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/episodes/:statusPageIdOrDomain`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/episodes/:statusPageIdOrDomain/:episodeId`":
        PUBLIC_PAGE,
    },
  },
  /*
   * Its own routes read, but for Import Alerts' Convert with OneUptime AI
   * (#7697), which writes nothing and is refused while Monitors is off: an
   * import's monitors are created through the CRUD API, refused with it.
   */
  "packages/Common/Server/API/MonitorAPI.ts": {
    products: [ProductKey.Monitors],
    leftAlone: {},
  },
  "packages/Common/Server/API/MonitorGroupAPI.ts": {
    products: [ProductKey.Monitors],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/current-status/:monitorGroupId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/timeline/:monitorGroupId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/monitoring-summary/:monitorGroupId`":
        READ,
    },
  },
  "packages/Common/Server/API/MonitorTemplateAPI.ts": {
    products: [ProductKey.Monitors],
    leftAlone: {},
  },
  "packages/Common/Server/API/IncidentAPI.ts": {
    products: [ProductKey.Incidents],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/subscriber-audience`":
        READ,
    },
  },
  "packages/Common/Server/API/IncidentEpisodeAPI.ts": {
    products: [ProductKey.Incidents],
    leftAlone: {},
  },
  "packages/Common/Server/API/IncidentEpisodeMemberAPI.ts": {
    products: [ProductKey.Incidents],
    leftAlone: {},
  },
  "packages/Common/Server/API/IncidentPostmortemActionItemAPI.ts": {
    products: [ProductKey.Incidents],
    leftAlone: {},
  },
  "packages/Common/Server/API/IncidentVideoCallAPI.ts": {
    products: [ProductKey.Incidents],
    leftAlone: {},
  },
  "packages/Common/Server/API/AlertAPI.ts": {
    products: [ProductKey.Alerts],
    leftAlone: {},
  },
  "packages/Common/Server/API/AlertEpisodeMemberAPI.ts": {
    products: [ProductKey.Alerts],
    leftAlone: {},
  },
  "packages/Common/Server/API/OnCallCalendarAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {
      PERSONAL_FEED_FALLBACK_ROUTE: FEED_FALLBACK,
      SCHEDULE_FEED_FALLBACK_ROUTE: FEED_FALLBACK,
      PROJECT_FEED_FALLBACK_ROUTE: FEED_FALLBACK,
    },
  },
  "packages/Common/Server/API/OnCallDutyPolicyScheduleAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {},
  },
  "packages/Common/Server/API/OnCallDutyPolicyUserOverrideAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {},
  },
  "packages/Common/Server/API/OnCallReadinessAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {},
  },
  "packages/Common/Server/API/OnCallTestPageAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {
      "`${ON_CALL_TEST_PAGE_API_PATH}/preview`": READ,
      "`${ON_CALL_TEST_PAGE_API_PATH}/fire-drill/preview`": READ,
    },
  },
  // Passing a page on, acknowledging it again, an observer's page seen.
  "packages/Common/Server/API/OnCallPagePassOnAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {},
  },
  "packages/Common/Server/API/UserOnCallLogTimelineAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/call/gather-input/:itemId`":
        PAGE_LINK,
      "`${new this.entityType().getCrudApiPath()?.toString()}/pass-on/:itemId`":
        PAGE_LINK,
      // The acknowledge page's button: a form, which posts the page's token (#10025).
      "`${new this.entityType().getCrudApiPath()?.toString()}/acknowledge/:itemId`":
        PAGE_LINK,
    },
  },
  // On-call user groups in Slack and Microsoft Teams.
  "packages/Common/Server/API/WorkspaceUserGroupAPI.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {},
  },
  "packages/App/FeatureSet/Notification/API/PhoneNumber.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {
      '"/search"': READ,
      '"/list-owned"': READ,
      '"/internal/release"':
        "The server's own, with its cluster key: a number is released when its policy, or the call provider settings it was bought with, are deleted - and those settings are every product's.",
    },
  },
  "packages/App/FeatureSet/Notification/API/IncomingCall.ts": {
    products: [ProductKey.OnCall],
    leftAlone: {
      '"/voice"':
        "The call provider calls it, for a call to a policy's number: what already runs keeps running.",
      '"/dial-status/:callLogId/:callLogItemId"':
        "The call provider calls it, with how a call put through went: what already runs keeps running.",
    },
  },
  "packages/Common/Server/API/AiFirstResponderAPI.ts": {
    products: [ProductKey.OnCall, ProductKey.Incidents, ProductKey.Alerts],
    leftAlone: {},
  },
  "packages/Common/Server/API/ScheduledMaintenanceAPI.ts": {
    products: [ProductKey.ScheduledMaintenance],
    leftAlone: {},
  },
  "packages/Common/Server/API/ScheduledMaintenanceCalendarAPI.ts": {
    products: [ProductKey.ScheduledMaintenance],
    leftAlone: {
      TEAM_FEED_FALLBACK_ROUTE: FEED_FALLBACK,
    },
  },
  "packages/Common/Server/API/ScheduledMaintenanceExternalCalendarAPI.ts": {
    products: [ProductKey.ScheduledMaintenance],
    leftAlone: {},
  },
  "packages/Common/Server/API/ServiceLevelObjectiveAPI.ts": {
    products: [ProductKey.Slos],
    leftAlone: {
      releaseCheckPath:
        "It only reads: whether an SLO's error budget lets a release go out.",
    },
  },
  "packages/Common/Server/API/ServiceLevelObjectiveBurnRateRuleAPI.ts": {
    products: [ProductKey.Slos],
    leftAlone: {
      "`${basePath}${SLO_RECOMMENDED_BURN_RATE_RULES_ROUTE}`": READ,
      "`${basePath}${SLO_BULK_RECOMMENDED_BURN_RATE_RULES_ROUTE}`": READ,
    },
  },
  /*
   * Use the recommended policy, for one SLO and for many (#6358): what each
   * SLO would get only reads; adding the tiers is refused while SLOs are off.
   */
  "packages/Common/Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI.ts":
    {
      products: [ProductKey.Slos],
      leftAlone: {
        "`${basePath}${SLO_RECOMMENDED_POLICY_ROUTE}`": READ,
        "`${basePath}${SLO_BULK_RECOMMENDED_POLICY_ROUTE}`": READ,
      },
    },
  "packages/Common/Server/API/TelemetryExceptionAPI.ts": {
    products: [ProductKey.Exceptions],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/similar/:telemetryExceptionId`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/list-stats`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/by-fingerprints`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/group-fingerprints`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/dashboard-summary`":
        READ,
    },
  },
  "packages/Common/Server/API/LlmObservabilityConnectionAPI.ts": {
    products: [ProductKey.Llm],
    leftAlone: {},
  },
  "packages/Common/Server/API/DataObservabilityAPI.ts": {
    products: [ProductKey.DataObservability],
    leftAlone: {},
  },
  /*
   * And Code, for Fix with AI on an issue: it starts a task in Code, refused
   * while Code is off as every route that asks OneUptime AI for a code
   * change is (#10362).
   */
  "packages/Common/Server/API/DataSecurityAPI.ts": {
    products: [ProductKey.DataSecurity, ProductKey.Code],
    leftAlone: {},
  },
  "packages/Common/Server/API/CloudConnectionAPI.ts": {
    products: [ProductKey.Cloud],
    leftAlone: {},
  },
  "packages/Common/Server/API/NetworkControllerConnectionAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {},
  },
  "packages/Common/Server/API/DeviceManagementConnectionAPI.ts": {
    products: [ProductKey.Inventory],
    leftAlone: {},
  },
  "packages/Common/Server/API/NetworkDeviceDiscoveryImportAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {},
  },
  // Run Again on a discovery scan (#10334): it queues a sweep, a write.
  "packages/Common/Server/API/NetworkDeviceDiscoveryScanRunAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {},
  },
  "packages/Common/Server/API/NetworkDeviceNamingAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      '"/network-device-naming/preview-scan"': READ,
      '"/network-device-naming/preview-discovered-devices"': READ,
      '"/network-device-naming/plan"': READ,
    },
  },
  "packages/Common/Server/API/NetworkDiscoveredDeviceAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      '"/network-discovered-device/list"': READ,
      '"/network-discovered-device/ids"': READ,
    },
  },
  "packages/Common/Server/API/NetworkDeviceRefreshAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {},
  },
  "packages/Common/Server/API/NetworkEmptySitesAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      EMPTY_SITES_PATH: READ,
    },
  },
  "packages/Common/Server/API/NetworkDeviceWatchingMonitorsAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      WATCHING_MONITORS_PATH: READ,
    },
  },
  "packages/Common/Server/API/NetworkDeviceUntiedMonitorsAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      UNTIED_MONITORS_PATH: READ,
    },
  },
  "packages/Common/Server/API/PacketCaptureAPI.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      "`${path}/:packetCaptureId/download`": READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/NetworkRuleRun.ts": {
    products: [ProductKey.Network],
    leftAlone: {},
  },
  "packages/App/FeatureSet/BaseAPI/API/NetworkTraffic.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      '"/network-traffic/summary"': READ,
      '"/network-traffic/find-address"': READ,
      '"/network-traffic/usage-summary"': READ,
      '"/network-traffic/usage-list"': READ,
      '"/network-traffic/usage-appliances"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/NetworkDeviceTopology.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      '"/network-device/topology"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/NetworkLatencyMatrix.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      '"/network-device/latency-matrix"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/NetworkSiteHierarchy.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      '"/network-site/children"': READ,
      '"/network-site/map"': READ,
      '"/network-site/search"': READ,
      '"/network-site/maintenance-windows"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/NetworkSummary.ts": {
    products: [ProductKey.Network],
    leftAlone: {
      '"/network-device/summary"': READ,
      '"/network-site/summary"': READ,
      '"/network-site/device-counts"': READ,
      '"/network-device/overview"': READ,
    },
  },
  "packages/Common/Server/API/ProxmoxResourceAPI.ts": {
    products: [ProductKey.Proxmox],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:clusterId`":
        READ,
    },
  },
  "packages/Common/Server/API/CephResourceAPI.ts": {
    products: [ProductKey.Ceph],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:clusterId`":
        READ,
    },
  },
  "packages/Common/Server/API/DockerSwarmResourceAPI.ts": {
    products: [ProductKey.DockerSwarm],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:clusterId`":
        READ,
    },
  },
  "packages/Common/Server/API/IoTDeviceAPI.ts": {
    products: [ProductKey.IoT],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:fleetId`":
        READ,
    },
  },
  "packages/Common/Server/API/StorageArrayResourceAPI.ts": {
    products: [ProductKey.StorageArrays],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:storageArrayId`":
        READ,
    },
  },
  "packages/Common/Server/API/VMwareResourceAPI.ts": {
    products: [ProductKey.VMware],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:vcenterId`":
        READ,
    },
  },
  "packages/Common/Server/API/HostAPI.ts": {
    products: [ProductKey.Hosts],
    leftAlone: {
      "`${new this.entityType().getCrudApiPath()?.toString()}/needs-attention`":
        READ,
    },
  },
  "packages/Common/Server/API/KubernetesResourceAPI.ts": {
    products: [ProductKey.Kubernetes],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:clusterId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/needs-attention/:clusterId`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/part/:clusterId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/latest-pod-metrics-by-namespace/:clusterId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/latest-pod-metrics-by-owner/:clusterId/:ownerKind`":
        READ,
    },
  },
  // Testing a cluster's AI access and resetting its agent change it.
  "packages/Common/Server/API/KubernetesClusterAiAccessAPI.ts": {
    products: [ProductKey.Kubernetes],
    leftAlone: {
      '"/kubernetes-cluster/ai-access/status"': READ,
      KUBERNETES_CLUSTER_AI_ACCESS_LOGS_PATH: READ,
      KUBERNETES_CLUSTER_AI_ACCESS_INSIGHTS_PATH: READ,
    },
  },
  // A resource's AI agent: each resource type's product (ProductsOfRequest.aiResource).
  "packages/Common/Server/API/ResourceAiAccessAPI.ts": {
    products: Object.values(PRODUCT_OF_AI_RESOURCE_TYPE),
    leftAlone: {
      RESOURCE_AI_ACCESS_STATUS_PATH: READ,
      RESOURCE_AI_ACCESS_ORGANIZATION_PATH: READ,
      RESOURCE_AI_ACCESS_LOGS_PATH: READ,
      RESOURCE_AI_ACCESS_INSIGHTS_PATH: READ,
    },
  },
  "packages/Common/Server/API/OpenStackProjectNoticeAPI.ts": {
    products: [ProductKey.OpenStack],
    leftAlone: {
      route: READ_HELPER,
    },
    readHelpers: {
      registerRead: {
        "`${path}/preview/:noticeId`":
          "It only reads: who a notice tells and the words it would send.",
        "`${path}/who-would-be-told/:cloudId`": READ,
        "`${path}/status-page-plan/:cloudId`": READ,
        "`${path}/project-page-plan/:cloudId`": READ,
        "`${path}/maintenance-covering/:cloudId`": READ,
      },
    },
  },
  "packages/Common/Server/API/OpenStackResourceAPI.ts": {
    products: [ProductKey.OpenStack],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/inventory-summary/:cloudId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/bare-metal-classes/:cloudId`":
        READ,
      // A class's failed nodes, which its "Failed: N" opens (#9751).
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/bare-metal-failed-nodes/:cloudId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/needs-attention/:cloudId`":
        READ,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/blast-radius/:cloudId`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/services/:cloudId`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/rows/:cloudId`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/counts/:cloudId`":
        READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/${path}/:resourceId`":
        READ_HELPER,
      "`${new this.entityType().getCrudApiPath()?.toString()}/${path}/:cloudId`":
        READ_HELPER,
    },
    readHelpers: {
      registerCloudRead: {
        '"region-summaries"': READ,
        '"top-consumers"': READ,
        '"project-summaries"': READ,
        '"project-overview"': READ,
        '"domain-summaries"': READ,
        '"domain-projects"': READ,
        '"topology"': READ,
        '"reach-of-instance"': READ,
        '"storage-pool-ceph"':
          "It only reads: the Ceph cluster a pool is likely on. Keeping the answer is registerCloudChange's.",
        '"host-of-machine"': READ,
        '"kubernetes-cluster-of-magnum-cluster"': READ,
      },
      registerPlacementRead: {
        '"magnum-cluster-of-kubernetes-cluster"': READ,
        '"placement-of-host"': READ,
        '"placement-of-service"': READ,
        '"placement-of-kubernetes-node"': READ,
      },
    },
  },
  "packages/Common/Server/API/SecurityCaseAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {
      "`${basePath}/overview`": READ,
      "`${basePath}/entity-activity`": READ,
      "`${basePath}/connections`": READ,
      "`${basePath}/connections/telemetry`": READ,
      "`${basePath}/resource-security`": READ,
      "`${basePath}/resource-security-scope`": READ,
      "`${basePath}/incident-security`": READ,
      "`${basePath}/setup/status`": READ,
      "`${basePath}/:caseId/ai-triage`": READ,
      "`${basePath}/:caseId/ai-triage/evidence`": READ,
    },
  },
  "packages/Common/Server/API/SecurityCaseContextAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {
      SECURITY_CASE_STORY_API_PATH: READ,
      SECURITY_CASE_IMPACT_API_PATH: READ,
      SECURITY_CASE_MATCHES_API_PATH: READ,
    },
  },
  "packages/Common/Server/API/SecurityAttackCampaignAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {
      '"/security-event/attack-campaigns"': READ,
    },
  },
  "packages/Common/Server/API/SecurityCaseEvidenceAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  "packages/Common/Server/API/SecurityEventConnectionAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  "packages/Common/Server/API/SecurityEventDestinationAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  "packages/Common/Server/API/SecurityPlaybookRunAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  "packages/Common/Server/API/SecurityWatchlistAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  // The blocklist (#10338): checking a block, and where blocks are enforced.
  "packages/Common/Server/API/SecurityBlockAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  // The addresses and entities a block may never cover (#10338).
  "packages/Common/Server/API/SecurityProtectedEntityAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  // The cloud WAFs the blocklist is enforced in: candidates, Check Again and Remove (#10344).
  "packages/Common/Server/API/SecurityBlockCloudWafAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  /*
   * Blocklist feeds (#10345): Rotate Secret and Revoke Secret name the
   * product; what a firewall fetches is a read, and a write to a feed's
   * address is answered 405.
   */
  "packages/Common/Server/API/SecurityBlocklistFeedAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {
      BLOCKLIST_FEED_FALLBACK_ROUTE: BLOCKLIST_FEED_FALLBACK,
    },
  },
  "packages/Common/Server/API/DetectionRuleAPI.ts": {
    products: [ProductKey.SecurityEvents],
    leftAlone: {},
  },
  "packages/Common/Server/API/AIInsightAPI.ts": {
    products: [ProductKey.AIInsights],
    leftAlone: {
      AI_INSIGHT_HIGHLIGHTS_PATH: READ,
    },
  },
  "packages/Common/Server/API/AIChatAPI.ts": {
    products: [ProductKey.AIChat],
    leftAlone: {
      '"/ai-chat/send-message"':
        "Refused in its handler, once the caller is known to be a member (ServerProducts.assertProductIsOn).",
      '"/ai-chat/providers"': READ,
    },
  },
  /*
   * Ask AI's setup actions, one call each, for the MCP server (#7241): the
   * products of the action the body names, as Ask AI's tool names them
   * (ProductsOfRequest.setupAction).
   */
  "packages/Common/Server/API/SetupActionAPI.ts": {
    products: SETUP_ACTION_PRODUCTS,
    leftAlone: {},
  },
  /*
   * OneUptime AI on an incident or an alert: the record's product
   * (ProductsOfRequest.incidentOrAlert), and Code for the pull request a
   * fix task opens.
   */
  "packages/Common/Server/API/AIInvestigationAPI.ts": {
    products: [ProductKey.Incidents, ProductKey.Alerts, ProductKey.Code],
    leftAlone: {
      '"/ai-investigation/incident"': READ,
      '"/ai-investigation/alert"': READ,
      '"/ai-investigation/evidence"':
        "It only reads: a report's citation, its read-only query run again as the person reading.",
      '"/ai-investigation/code-fix-suggestion"': READ,
      '"/ai-investigation/performance-fix-suggestion"': READ,
      '"/ai-investigation/profile-fix-suggestion"': READ,
      '"/ai-investigation/telemetry-improvement-suggestion"': READ,
    },
  },
  // The investigation box's conversation: AI Chat's, about the record.
  "packages/Common/Server/API/AIInvestigationConversationAPI.ts": {
    products: [ProductKey.Incidents, ProductKey.Alerts, ProductKey.AIChat],
    leftAlone: {
      '"/ai-investigation/conversation"': READ,
    },
  },
  "packages/Common/Server/API/AutoRemediationAPI.ts": {
    products: [
      ProductKey.Incidents,
      ProductKey.Alerts,
      ProductKey.Runbooks,
      ProductKey.Code,
    ],
    leftAlone: {
      '"/auto-remediation/approve"': IN_FIX,
      '"/auto-remediation/dry-run"': IN_FIX,
      '"/auto-remediation/dismiss"': IN_FIX,
      REMEDIATION_ROUND_PATH: READ,
      REMEDIATION_ROUND_TRY_AGAIN_PATH:
        "Refused in RemediationRound once the round is read (RemediationFixProducts): its incident's or alert's product, and Runbooks for a round that picks a runbook.",
      DECLARED_CODE_OWNER_PATH: READ,
      DECLARED_CODE_CHANGES_PATH: READ,
    },
  },
  "packages/Common/Server/API/IncidentAlertAiActivityAPI.ts": {
    products: [ProductKey.Incidents, ProductKey.Alerts],
    leftAlone: {
      "INCIDENT_ALERT_AI_LOGS_PATHS[subjectKind]": READ,
      "INCIDENT_ALERT_AI_INSIGHTS_PATHS[subjectKind]": READ,
      AI_OUTCOMES_PATH: READ,
      // The records one of AI Results' numbers counts (#7768).
      AI_OUTCOMES_RECORDS_PATH: READ,
    },
  },
  "packages/Common/Server/API/TelemetryAiAPI.ts": {
    products: [ProductKey.Code],
    leftAlone: {
      TELEMETRY_AI_READINESS_PATH: READ,
      TELEMETRY_AI_LOGS_PATH: READ,
      TELEMETRY_AI_FIX_SUGGESTION_PATH: READ,
    },
  },
  "packages/Common/Server/API/CodeTaskAPI.ts": {
    products: [ProductKey.Code],
    leftAlone: {
      path: READ_HELPER,
    },
    readHelpers: {
      read: {
        '"/code-task/repositories"': READ,
        '"/code-task/repository/:repositoryId"': READ,
        '"/code-task/list"': READ,
        '"/code-task/branches/:repositoryId"': READ,
        '"/code-task/get/:taskId"': READ,
        '"/code-task/turns/:taskId"': READ,
        '"/code-task/progress/:taskId"': READ,
        '"/code-task/summaries"': READ,
        '"/code-task/source-links"': READ,
      },
    },
  },
  "packages/Common/Server/API/CodeRepositoryConnectionAPI.ts": {
    products: [ProductKey.Code],
    leftAlone: {
      "`${CODE_REPOSITORY_CONNECTION_API_PATH}${path}`": READ_HELPER,
    },
    readHelpers: {
      read: {
        '"/repositories"':
          "It only reads: the repositories a token reaches on its Git server, a page at a time.",
        '"/list"': READ,
      },
    },
  },
  "packages/Common/Server/API/CodeFixRunAPI.ts": {
    products: [ProductKey.Code],
    leftAlone: {
      '"/code-fix-run/get/:runId"': READ,
      '"/code-fix-run/logs/:runId"': READ,
    },
  },
  "packages/Common/Server/API/GitHubAPI.ts": {
    products: [ProductKey.Code],
    leftAlone: {
      '"/github/webhook"':
        "GitHub calls it, with its App's events: what already runs keeps running. A review or a fix an event asks for is refused where every AI run starts, while Code is off (AIRunService).",
    },
  },
  // A rule's table is its product's: any product's rule can be run.
  "packages/App/FeatureSet/BaseAPI/API/RuleRun.ts": {
    products: ANY_PRODUCT,
    leftAlone: {},
  },
  // A record's own channel: the record type's product.
  "packages/Common/Server/API/WorkspaceChannelMembersAPI.ts": {
    products: Object.values(PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE),
    leftAlone: {},
  },
  "packages/Common/Server/API/DashboardAPI.ts": {
    products: [ProductKey.Dashboards],
    leftAlone: {
      overviewApiPath: READ,
      "`${new this.entityType().getCrudApiPath()?.toString()}/domain`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/metadata/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/view-config/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/attribute-values/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/metric-types/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/metrics-aggregate/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/resource-list/:dashboardId/:resourceType`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/slo-history-aggregate/:dashboardId`":
        PUBLIC_PAGE,
      // A public dashboard's PromQL widgets: their stored queries only (#10226).
      "`${new this.entityType() .getCrudApiPath() ?.toString()}${PUBLIC_DASHBOARD_PROMQL_QUERY_PATH}/:dashboardId`":
        PUBLIC_PAGE,
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/master-password/:dashboardId`":
        PUBLIC_PAGE,
    },
  },
  "packages/Common/Server/API/DataSourceAPI.ts": {
    products: [ProductKey.Dashboards],
    leftAlone: {
      "`${new this.entityType().getCrudApiPath()?.toString()}/query`": READ,
    },
  },
  "packages/Common/Server/API/FormAPI.ts": {
    products: [ProductKey.Forms],
    leftAlone: {
      "`${new this.entityType() .getCrudApiPath() ?.toString()}/public/:shareKey/submit`":
        PUBLIC_PAGE,
      "`${crudApiPath}${FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE}`": PUBLIC_PAGE,
    },
  },
  "packages/App/FeatureSet/Notification/API/SubscriberNotificationPreview.ts": {
    products: [ProductKey.StatusPages],
    leftAlone: {
      "SubscriberNotificationPreview.previewPath":
        "It only reads: the email a status page's subscribers would get, sent to nobody.",
    },
  },
  "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts": {
    products: [ProductKey.StatusPages],
    leftAlone: {
      '"/logout/:statuspageid"': PUBLIC_PAGE,
      '"/exchange-login-code/:statuspageid"': PUBLIC_PAGE,
      '"/refresh-token/:statuspageid"': PUBLIC_PAGE,
      '"/forgot-password"': PUBLIC_PAGE,
      '"/reset-password"': PUBLIC_PAGE,
      '"/send-magic-link"': PUBLIC_PAGE,
      '"/login-with-magic-link/:statuspageid"': PUBLIC_PAGE,
      '"/login"': PUBLIC_PAGE,
    },
  },
  "packages/App/FeatureSet/Identity/API/StatusPageSSO.ts": {
    products: [ProductKey.StatusPages],
    leftAlone: {
      '"/status-page-idp-login/:statusPageId/:statusPageSsoId"': PUBLIC_PAGE,
    },
  },
  // A dashboard's sign-in page on its public link (#10250), as a status page's.
  "packages/App/FeatureSet/Identity/API/DashboardPrivateUserAuthentication.ts":
    {
      products: [ProductKey.Dashboards],
      leftAlone: {
        "`${DashboardPrivateUserApiRoutes.login}/:dashboardId`": PUBLIC_PAGE,
        "`${DashboardPrivateUserApiRoutes.logout}/:dashboardId`": PUBLIC_PAGE,
        "`${DashboardPrivateUserApiRoutes.refreshToken}/:dashboardId`":
          PUBLIC_PAGE,
        "`${DashboardPrivateUserApiRoutes.forgotPassword}/:dashboardId`":
          PUBLIC_PAGE,
        "`${DashboardPrivateUserApiRoutes.resetPassword}/:dashboardId`":
          PUBLIC_PAGE,
        "`${DashboardPrivateUserApiRoutes.exchangeLoginCode}/:dashboardId`":
          PUBLIC_PAGE,
        "`${DashboardPrivateUserApiRoutes.signInMethods}/:dashboardId`": READ,
      },
    },
  "packages/App/FeatureSet/Identity/API/DashboardSSO.ts": {
    products: [ProductKey.Dashboards],
    leftAlone: {
      '"/dashboard-idp-login/:dashboardId/:dashboardSsoId"': PUBLIC_PAGE,
    },
  },
  // A form's sign-in on its public link (#10249), as a dashboard's.
  "packages/App/FeatureSet/Identity/API/FormPrivateUserAuthentication.ts": {
    products: [ProductKey.Forms],
    leftAlone: {
      "`${FormPrivateUserApiRoutes.login}/:formId`": PUBLIC_PAGE,
      "`${FormPrivateUserApiRoutes.logout}/:formId`": PUBLIC_PAGE,
      "`${FormPrivateUserApiRoutes.refreshToken}/:formId`": PUBLIC_PAGE,
      "`${FormPrivateUserApiRoutes.forgotPassword}/:formId`": PUBLIC_PAGE,
      "`${FormPrivateUserApiRoutes.resetPassword}/:formId`": PUBLIC_PAGE,
      "`${FormPrivateUserApiRoutes.exchangeLoginCode}/:formId`": PUBLIC_PAGE,
      "`${FormPrivateUserApiRoutes.signInMethods}/:formId`": READ,
    },
  },
  "packages/App/FeatureSet/Identity/API/FormSSO.ts": {
    products: [ProductKey.Forms],
    leftAlone: {
      '"/form-idp-login/:formId/:formSsoId"': PUBLIC_PAGE,
    },
  },
  "packages/Common/Server/API/WorkflowVariableAPI.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {},
  },
  "packages/App/FeatureSet/Workflow/API/Manual.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {},
  },
  "packages/App/FeatureSet/Workflow/API/RunStep.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {},
  },
  "packages/App/FeatureSet/Workflow/API/RunRecords.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {},
  },
  "packages/App/FeatureSet/Workflow/API/StepSamples.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {
      "`/step-samples/:workflowId`":
        "It only reads: the samples a workflow's builder picks from.",
    },
  },
  "packages/App/FeatureSet/Workflow/API/Workflow.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {
      "`/update/:workflowId`":
        "The server's own, with its cluster key: it follows a workflow saved or deleted - which is refused while Workflows is off - and keeps its schedule in step.",
    },
  },
  "packages/App/FeatureSet/Workflow/API/HuntressLegacyWebhook.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {
      "`${HUNTRESS_WEBHOOK_ROUTE}/:secretkey`": OUTSIDE,
    },
  },
  // A workflow's triggers: what already runs keeps running (#7479).
  "packages/Common/Server/Types/Workflow/Components/Webhook.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {
      "`/trigger/:secretkey`": OUTSIDE,
    },
  },
  "packages/Common/Server/Types/Workflow/Components/Huntress.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {
      "`${HUNTRESS_TRIGGER_PATH}/:secretkey`": OUTSIDE,
    },
  },
  "packages/Common/Server/Types/Workflow/Components/IncomingEmail.ts": {
    products: [ProductKey.Workflows],
    leftAlone: {
      INCOMING_EMAIL_TRIGGER_DELIVERY_PATH:
        "An email delivered to a workflow's address: what already runs keeps running.",
    },
  },
  "packages/Common/Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel.ts":
    {
      products: [ProductKey.Workflows],
      leftAlone: {
        "`/model/:projectId/${this.modelId}/${this.type}`":
          "The server's own, with its cluster key: a record's event starts the workflows that wait for it, as what already runs keeps running - and their steps change no record of a product that is off (ProductWriteRefusal).",
      },
    },
  "packages/App/FeatureSet/Runbook/API/Runbook.ts": {
    products: [ProductKey.Runbooks],
    leftAlone: {},
  },
  "packages/App/FeatureSet/Runbook/API/RunbookWebhook.ts": {
    products: [ProductKey.Runbooks],
    leftAlone: {
      WEBHOOK_ROUTE: OUTSIDE,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/InventoryOverview.ts": {
    products: [ProductKey.Inventory],
    leftAlone: {
      '"/inventory-item/overview"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/MessageQueueTopology.ts": {
    products: [ProductKey.Queues],
    leftAlone: {
      '"/telemetry/message-queues/topology"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/ServiceDependencyTimeseries.ts": {
    products: [ProductKey.Services],
    leftAlone: {
      '"/telemetry/service-dependency-timeseries"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/ServiceOperationalStatus.ts": {
    products: [ProductKey.Services],
    leftAlone: {
      '"/telemetry/service-operational-status"': READ,
    },
  },
  "packages/App/FeatureSet/BaseAPI/API/Topology.ts": {
    products: [ProductKey.Topology],
    leftAlone: Object.fromEntries(
      [
        "TopologyApiPath.ServiceMap",
        "TopologyApiPath.Infrastructure",
        "TopologyApiPath.InfrastructureCollection",
        "TopologyApiPath.InfrastructureCollectionSearch",
        "TopologyApiPath.Entity",
        "TopologyApiPath.EntityConnections",
        "TopologyApiPath.EntityAllTime",
        "TopologyApiPath.EntityAllTimeConnections",
      ].map((route: string): [string, string] => {
        return [route, READ];
      }),
    ),
  },
  /*
   * A public note's approval routes are registered by one helper for each
   * kind of note: its writes name the notes' product, which each kind's API
   * hands it (see below).
   */
  "packages/Common/Server/API/PublicNoteApprovalRoutes.ts": {
    products: [ProductKey.Incidents, ProductKey.ScheduledMaintenance],
    handedProducts: {
      "data.product": [ProductKey.Incidents, ProductKey.ScheduledMaintenance],
    },
    leftAlone: {
      "`${data.basePath}/approval/notes`": READ,
      "`${data.basePath}/approval/policy`": READ,
    },
  },
};

interface WholeFileDecision {
  why: string;
  // How many routes that are not a GET it registers.
  routes: number;
}

const decided: (
  why: string,
  files: Record<string, number>,
) => Array<[string, WholeFileDecision]> = (
  why: string,
  files: Record<string, number>,
): Array<[string, WholeFileDecision]> => {
  return Object.entries(files).map(
    ([file, routes]: [string, number]): [string, WholeFileDecision] => {
      return [file, { why, routes }];
    },
  );
};

const CORE_FILES_DECIDED_WHOLE: Record<string, WholeFileDecision> =
  Object.fromEntries([
    ...decided(
      "Signing in, and keeping a session, which every product needs: what a person proves to get in is of no one product.",
      {
        /*
         * #9764: a security key set up at sign-in - its options, and the
         * key's answer. #9822: a security key's sign-in options, asked for
         * with the password again rather than by an address alone. #9817:
         * the phone's browser reads a mobile app's passkey options once,
         * by the one-time hand-off the app was given at sign-in. #9898: the
         * sign-up page an invitation opens says its link is the person's,
         * as they pick the project's single sign-on. #10178: so does the
         * project's SSO page an invitation opens for someone who has
         * signed up.
         */
        "packages/App/FeatureSet/Identity/API/Authentication.ts": 24,
        "packages/App/FeatureSet/Identity/API/FirstAccount.ts": 1,
        // #9603: a SAML provider's Single Logout URL takes a posted sign-out.
        "packages/App/FeatureSet/Identity/API/GlobalSSO.ts": 2,
        // #9989: the mobile app redeems an SSO sign-in's one-time code with its PKCE verifier.
        "packages/App/FeatureSet/Identity/API/MobileSsoExchange.ts": 1,
        "packages/App/FeatureSet/Identity/API/ProjectSsoSignInConfirmation.ts": 1,
        "packages/App/FeatureSet/Identity/API/Reseller.ts": 1,
        "packages/App/FeatureSet/Identity/API/SSO.ts": 2,
        // #9987: "Sign in with SSO" emails an address its organizations' SSO sign-in links.
        "packages/App/FeatureSet/Identity/API/SsoSignInLinks.ts": 1,
        "packages/App/FeatureSet/MCP/OAuth/OAuthRoutes.ts": 7,
        "packages/Common/Server/API/UserTotpAuthAPI.ts": 1,
        "packages/Common/Server/API/UserTwoFactorBackupCodeAPI.ts": 1,
        // #9822: the anonymous authentication options are gone.
        "packages/Common/Server/API/UserWebAuthnAPI.ts": 2,
      },
    ),
    ...decided(
      "How to reach a person - their notification methods, rules and paging ladder - which incidents, alerts and on-call all use: of no one product.",
      {
        "packages/Common/Server/API/UserCallAPI.ts": 1,
        "packages/Common/Server/API/UserEmailAPI.ts": 1,
        "packages/Common/Server/API/UserIncomingCallNumberAPI.ts": 1,
        "packages/Common/Server/API/UserMattermostAPI.ts": 1,
        "packages/Common/Server/API/UserMicrosoftTeamsAPI.ts": 1,
        "packages/Common/Server/API/UserSlackAPI.ts": 1,
        "packages/Common/Server/API/UserSmsAPI.ts": 1,
        "packages/Common/Server/API/UserTelegramAPI.ts": 2,
        "packages/Common/Server/API/UserWebhookAPI.ts": 1,
        "packages/Common/Server/API/UserWhatsAppAPI.ts": 1,
        "packages/Common/Server/API/UserPushAPI.ts": 8,
        "packages/Common/Server/API/UserNotificationMethodAdminAPI.ts": 3,
        "packages/Common/Server/API/UserNotificationSettingAPI.ts": 1,
        "packages/Common/Server/API/ChannelVerificationResendRoute.ts": 1,
        "packages/Common/Server/API/ChannelVerificationStatusRoute.ts": 1,
        "packages/Common/Server/API/PagingLadderAPI.ts": 2,
      },
    ),
    ...decided(
      "A custom notification channel: a master admin's setup and a person's test, of no one product - and a page's own action from the company's app, which the person paged answers, as what already runs keeps running.",
      {
        "packages/Common/Server/API/CustomNotificationChannelAPI.ts": 4,
      },
    ),
    ...decided(
      "The project, its people and its settings - Users, Teams and Project Settings, which are always on.",
      {
        "packages/Common/Server/API/ApiKeyAPI.ts": 1,
        /*
         * #9820: a project's owners counting and clearing the sign-in
         * settings its people saved before it managed sign-in with SSO.
         * #9993: and, from the project's Users list, which of the people
         * it shows still have some (a POST that only reads, for the ids
         * it names), and the clear of one of them - of no one product, as
         * Users is always on.
         */
        "packages/Common/Server/API/ProjectAPI.ts": 11,
        "packages/Common/Server/API/ProjectOIDC.ts": 1,
        "packages/Common/Server/API/ProjectSSO.ts": 1,
        "packages/Common/Server/API/ProjectProductsAPI.ts": 2,
        /*
         * Its invite suggestions read only (#9701), and so do the Admin
         * Dashboard's, in the project the path names (#9826);
         * is-user-registered is gone (#9745).
         */
        "packages/Common/Server/API/TeamMemberAPI.ts": 11,
        /*
         * #9762: a master admin clearing one person's sign-in settings.
         * #10155: a person confirming it's them before they change how
         * they sign in, and the security key or passkey options for it.
         */
        "packages/Common/Server/API/UserAPI.ts": 10,
        "packages/Common/Server/API/WelcomeChecklistAPI.ts": 4,
      },
    ),
    ...decided(
      "A person's own progress through a guided setup (#7253), which spans products: it keeps only where they are, and every record a step makes goes through its own product's routes.",
      {
        "packages/Common/Server/API/GuidedSetupRunAPI.ts": 2,
      },
    ),
    ...decided(
      "Asking people how OneUptime went - an answer, the words after it, may OneUptime ask - and a master admin deleting an answer (#7366): of no one product. Feedback has its own switch on the server (Admin Dashboard > Feedback), and its routes refuse an answer while it is off.",
      {
        "packages/Common/Server/API/ProductFeedbackAPI.ts": 4,
      },
    ),
    ...decided(
      "Project Settings > Import from another tool: an import creates each record as the person who started it, so a record of a product switched off is refused where every write is (ProductWriteRefusal), and its report says so.",
      {
        "packages/Common/Server/API/ToolImportAPI.ts": 4,
      },
    ),
    ...decided(
      "Billing, which the project pays for every product with, and the marketplaces that bill it.",
      {
        "packages/Common/Server/API/BillingAPI.ts": 1,
        "packages/Common/Server/API/BillingInvoiceAPI.ts": 1,
        "packages/Common/Server/API/BillingPaymentMethodAPI.ts": 2,
        "packages/Common/Server/API/AIBillingAPI.ts": 1,
        "packages/Common/Server/API/NotificationAPI.ts": 1,
        "packages/Common/Server/API/ResellerPlanAPI.ts": 1,
      },
    ),
    ...decided(
      "The server's own setup, which a master admin changes or the server reads - switching a product on again among it.",
      {
        // #9762: clearing the sign-in settings of everyone the server's SSO requirement covers.
        "packages/Common/Server/API/GlobalConfigAPI.ts": 7,
        "packages/Common/Server/API/ProbeAPI.ts": 1,
        "packages/Common/Server/API/RunnerAPI.ts": 1,
        "packages/Common/Server/API/OpenSourceDeploymentAPI.ts": 2,
        "packages/App/API/AdminHealth.ts": 3,
        "packages/App/FeatureSet/Notification/API/BroadcastEmail.ts": 2,
        /*
         * #7380: Notification/API/ServerAwsIdentity.ts, beside it, registers
         * one GET - which AWS identity the server's own Amazon SES signs in
         * as, for a master admin - so it reads, and is no decision here.
         */
        "packages/App/FeatureSet/Notification/API/ServerTestSend.ts": 4,
        "packages/App/FeatureSet/Notification/API/CallAndSmsGateway.ts": 1,
      },
    ),
    ...decided(
      "OneUptime AI's own setup - its LLM providers and MCP servers, a test of one - which every product's AI uses: Project Settings.",
      {
        "packages/Common/Server/API/LlmProviderAPI.ts": 2,
        "packages/Common/Server/API/ExternalMcpServerAPI.ts": 1,
      },
    ),
    ...decided(
      "How OneUptime sends a message - a call, a text, an email, a push, a chat - for every product, and what the provider says of how it went.",
      {
        /*
         * #6594: Twilio's answering machine callback - who answered an
         * on-call call, a person or voicemail - beside its status callback.
         * Twilio calls it for a call already placed, as it calls an incoming
         * call policy's routes: what already runs keeps running while On-Call
         * is switched off.
         */
        "packages/App/FeatureSet/Notification/API/Call.ts": 4,
        "packages/App/FeatureSet/Notification/API/SMS.ts": 3,
        "packages/App/FeatureSet/Notification/API/Mail.ts": 1,
        "packages/App/FeatureSet/Notification/API/Webhook.ts": 1,
        "packages/App/FeatureSet/Notification/API/WhatsApp.ts": 3,
        "packages/App/FeatureSet/Notification/API/Telegram.ts": 3,
        "packages/App/FeatureSet/Notification/API/PushRelay.ts": 2,
        /*
         * #7378: SMTPConfig.ts also registers GET /aws-role-setup - what a
         * project's Amazon SES config makes its IAM role with (the
         * principal to trust, the project's email external id, a trust
         * policy) - so it reads, and is no decision here. Its POST /test
         * checks a role config's role afresh before it sends, as every
         * test send of how OneUptime reaches people does.
         */
        "packages/App/FeatureSet/Notification/API/SMTPConfig.ts": 1,
      },
    ),
    ...decided(
      "A chat or video app's own endpoint, and the project's connection to it: of no one product. A button or a command of a product that is off is answered where it is handled, and nothing is changed (WorkspaceProductRefusal).",
      {
        "packages/Common/Server/API/SlackAPI.ts": 7,
        "packages/Common/Server/API/MicrosoftTeamsAPI.ts": 5,
        "packages/Common/Server/API/MattermostAPI.ts": 7,
        "packages/Common/Server/API/WorkspaceAskToConnectAPI.ts": 1,
        "packages/Common/Server/API/WorkspaceNotificationRuleAPI.ts": 1,
        "packages/Common/Server/API/WorkspaceNotificationSummaryAPI.ts": 1,
        "packages/Common/Server/API/VideoCallConnectionAPI.ts": 1,
        "packages/Common/Server/API/VideoCallOAuthAPI.ts": 1,
      },
    ),
    ...decided(
      "An AI agent's or a Runner's own, with its key: it reports on the work OneUptime handed it. OneUptime AI starts no work on a record of a product switched off, nor hands a code fix out while Code is (AIRunService), and no runbook starts from inside OneUptime while Runbooks is (RunbookStarter).",
      {
        "packages/Common/Server/API/AIAgentAPI.ts": 1,
        "packages/Common/Server/API/AIAgentCodeTaskAPI.ts": 1,
        "packages/Common/Server/API/AIAgentDataAPI.ts": 7,
        "packages/Common/Server/API/AIAgentGitHubAPI.ts": 2,
        "packages/Common/Server/API/AIAgentTaskAPI.ts": 3,
        "packages/Common/Server/API/AIAgentTaskLogAPI.ts": 1,
        "packages/Common/Server/API/AIAgentTelemetryAPI.ts": 2,
        "packages/App/FeatureSet/Runbook/API/RunnerIngress.ts": 6,
        "packages/App/FeatureSet/Runbook/API/KubernetesAiAgentIngress.ts": 6,
        "packages/App/FeatureSet/Runbook/API/ResourceAiAgentIngress.ts": 6,
      },
    ),
    ...decided(
      "An MCP client's tools: each tool of a product that is off is left out (Toolbox), and every write they make, as the person, is refused where every write is (ProductWriteRefusal).",
      {
        "packages/App/FeatureSet/MCP/Handlers/RouteHandler.ts": 2,
      },
    ),
    ...decided(
      "A probe's own, with its key: it takes the work it checks and reports what it found. Monitors keep checking while their product is switched off, as switching it off promises, and a probe is the server's infrastructure, never a person's write.",
      {
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/DataObservability.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/DataSecurity.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/IncomingEmail.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Monitor.ts": 3,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/NetworkDeviceDiagnostic.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/NetworkDevicePoll.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/NetworkFlow.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/OpenStackChecks.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection.ts": 3,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/PacketCapture.ts": 3,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Probe.ts": 6,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Register.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Syslog.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/VMwareCollection.ts": 3,
        "packages/Probe/API/IncomingRequestIngress.ts": 2,
      },
    ),
    ...decided(
      "A monitor's check arriving - an incoming request, a server's agent, an email: monitors keep checking while their product is switched off, as switching it off promises.",
      {
        "packages/App/FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/ServerMonitorIngest/ServerMonitor.ts": 1,
      },
    ),
    ...decided(
      "Telemetry arriving, by its ingestion key: it keeps arriving while its product is switched off, unless the server stops ingestion (DISABLE_TELEMETRY_INGESTION), as switching a product off promises.",
      {
        "packages/App/FeatureSet/Telemetry/API/AndroidAgentLogSessions.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/AwsFirehose.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/ChangeEventsIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/Datadog.ts": 16,
        "packages/App/FeatureSet/Telemetry/API/DbtArtifactsIngest.ts": 1,
        // #9922: an iOS app's dSYMs, uploaded as its source maps are.
        "packages/App/FeatureSet/Telemetry/API/DsymIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/Fluent.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/GcpPubSub.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/HostCollectorOpAmp.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/KubernetesCostIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/Loki.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/OTelIngest.ts": 4,
        "packages/App/FeatureSet/Telemetry/API/OpenLineageIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/ProductAnalyticsEventIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/PrometheusRemoteWrite.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/Pyroscope.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/SecurityEventsIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/Sentry.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/SessionReplayIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/SourceMapIngest.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/SplunkHec.ts": 4,
        "packages/App/FeatureSet/Telemetry/API/SyncWebhooksIngest.ts": 2,
        "packages/App/FeatureSet/Telemetry/API/Syslog.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/TelemetryWriter.ts": 1,
        "packages/App/FeatureSet/Telemetry/API/VercelLogDrain.ts": 1,
      },
    ),
    ...decided(
      "Telemetry's queries, as POSTs for their bodies - attributes, histograms, facets, analytics, session counts, an export, a flame graph, a replay's manifest and chunks, and which addresses a log, trace or exception search matched by the token an IP Address rule hashed them to (#10418), which reads the project's scrub rules and no record: they only read. A replay's heartbeat is the audit of a person watching it, which a read keeps, as the server.",
      {
        "packages/Common/Server/API/TelemetryAPI.ts": 75,
      },
    ),
    ...decided(
      "The Prometheus- and Loki-compatible query APIs (#6796, #7700) Grafana reads OneUptime through, each query also as a POST for a long one, as Prometheus and Loki serve them: they only read a project's metrics and logs.",
      {
        "packages/Common/Server/API/LokiAPI.ts": 4,
        "packages/Common/Server/API/PrometheusAPI.ts": 5,
      },
    ),
    ...decided(
      "Every table's CRUD API, and the move of an ordered list's row (issues #9573, #9609): a write or a move refuses a record of a product that is off before any hook runs (assertProductIsOn, see below), and a write again where every write is (ProductWriteRefusal). Its other routes read.",
      {
        "packages/Common/Server/API/BaseAPI.ts": 9,
        "packages/Common/Server/API/BaseAnalyticsAPI.ts": 7,
      },
    ),
    ...decided(
      "It only reads, for any product's records: how many use a value, what an owner rule would add, where a record is used, who a monitor not saved yet would tell, the resources a record could affect, a custom field's options in use, what OneUptime AI may do, today's AI usage, whether a public note posted now is on a status page and notifies anyone, whether an announcement, a maintenance event or a maintenance template on the status pages picked shows and notifies anyone, and which monitors, dashboards, saved views, recording rules and SLOs read what a scrub rule being written would hide, and what Security Events would lose (#10433) - as a POST for the rule it describes, which is never saved.",
      {
        "packages/Common/Server/API/PickedStatusPagesReachRoute.ts": 1,
        "packages/Common/Server/API/ScrubRuleReadersAPI.ts": 1,
        "packages/Common/Server/API/ArchivableValueAPI.ts": 2,
        "packages/Common/Server/API/CustomFieldDefinitionAPI.ts": 1,
        "packages/Common/Server/API/OwnerRulePreviewRoute.ts": 1,
        "packages/Common/Server/API/PublicNoteReachRoute.ts": 1,
        "packages/Common/Server/API/UsedByAPI.ts": 1,
        "packages/Common/Server/API/WhoIsToldAPI.ts": 1,
        "packages/Common/Server/API/AffectedResourceSearchAPI.ts": 1,
        "packages/Common/Server/API/AIReadinessAPI.ts": 1,
        "packages/Common/Server/API/AIDailyUsageAPI.ts": 1,
        "packages/App/FeatureSet/BaseAPI/API/ReceivingGaps.ts": 1,
      },
    ),
    ...decided(
      "The server's own answers to a route that is not there: 410 Gone for a retired resource, 404 for anything else. Nothing is written.",
      {
        "packages/Common/Server/API/RetiredApiRoute.ts": 2,
        "packages/Common/Server/Utils/StartServer.ts": 3,
      },
    ),
    ...decided(
      "The docs site's own: a reader's answer to Was this page helpful?, sent on to product analytics where it is set up and kept for the server's admins where they switched that on, and a docs search that found nothing, sent on to product analytics where it is set up.",
      {
        "packages/App/FeatureSet/Docs/Index.ts": 2,
      },
    ),
    ...decided(
      "Not the OneUptime server: the website's reseller form, and the server a test runs against.",
      {
        "packages/Home/API/ResellerInquiryAPI.ts": 1,
        "packages/TestServer/API/Main.ts": 1,
        "packages/TestServer/API/Settings.ts": 1,
      },
    ),
  ]);

/*
 * ee/ decides its own route files (ee/Tests/Server/ProductRouteDecisions.ts),
 * read only where ee/ is checked out - the Enterprise Edition Test job runs
 * this guard so. Core runs without ee/, and names none of its files.
 */
const ENTERPRISE_DECISIONS_FILE: string = path.join(
  REPOSITORY,
  "ee/Tests/Server/ProductRouteDecisions.ts",
);

interface EnterpriseDecisions {
  ENTERPRISE_PRODUCT_ROUTE_FILES: Record<string, ProductRouteFile>;
  ENTERPRISE_FILES_DECIDED_WHOLE: Record<string, WholeFileDecision>;
  ENTERPRISE_ROUTE_FILE_THE_WALK_FINDS: string;
}

const ENTERPRISE_DECISIONS: EnterpriseDecisions | null = fs.existsSync(
  ENTERPRISE_DECISIONS_FILE,
)
  ? (jest.requireActual(ENTERPRISE_DECISIONS_FILE) as EnterpriseDecisions)
  : null;

Object.assign(
  PRODUCT_ROUTE_FILES,
  ENTERPRISE_DECISIONS?.ENTERPRISE_PRODUCT_ROUTE_FILES || {},
);

const FILES_DECIDED_WHOLE: Record<string, WholeFileDecision> = {
  ...CORE_FILES_DECIDED_WHOLE,
  ...(ENTERPRISE_DECISIONS?.ENTERPRISE_FILES_DECIDED_WHOLE || {}),
};

interface Registration {
  method: string;
  // Its path, as the file writes it, its whitespace squashed.
  path: string;
  // Each refusal among its middlewares: what it calls, and with what.
  refusals: Array<{ kind: string; argument: string }>;
}

const squash: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ").trim();
};

const REFUSAL: RegExp =
  /ServerProductRoutes\s*\.\s*(refuseWhileOff|refuseWhileOffFor|refuseWhileRecordTableIsOff)\s*\(([^)]*)\)/g;

// A file of the repository's, by its path from the repository's root.
const readText: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(REPOSITORY, file), "utf8");
};

// A file's text, parsed: the file's own, or a fixture's.
const parseText: (file: string, text: string) => ts.SourceFile = (
  file: string,
  text: string,
): ts.SourceFile => {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
};

const parse: (file: string) => ts.SourceFile = (
  file: string,
): ts.SourceFile => {
  return parseText(file, readText(file));
};

/*
 * Every route a file registers that is not a GET - router.post(...),
 * this.router.put(...), app.delete(...), router.all(...) - with the
 * refusals among its middlewares. A handler's body is never read for one.
 * The file's own text, or a fixture's.
 */
const readRegistrations: (
  file: string,
  text?: string,
) => Array<Registration> = (
  file: string,
  text: string = readText(file),
): Array<Registration> => {
  const source: ts.SourceFile = parseText(file, text);
  const registrations: Array<Registration> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      VERBS.has(node.expression.name.text)
    ) {
      const target: string = node.expression.expression.getText(source);

      if (ROUTER.test(target)) {
        const [first, ...rest] = Array.from(node.arguments);
        const refusals: Array<{ kind: string; argument: string }> = [];

        for (const argument of rest) {
          if (
            ts.isArrowFunction(argument) ||
            ts.isFunctionExpression(argument)
          ) {
            continue;
          }

          for (const match of argument.getText(source).matchAll(REFUSAL)) {
            refusals.push({
              kind: match[1]!,
              argument: squash(match[2]!).replace(/,$/, "").trim(),
            });
          }
        }

        registrations.push({
          method: node.expression.name.text.toUpperCase(),
          path: first ? squash(first.getText(source)) : "",
          refusals,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return registrations;
};

// Each call of this.<helper>(...) in a file: its first argument, squashed.
const readHelperCalls: (file: string, helper: string) => Array<string> = (
  file: string,
  helper: string,
): Array<string> => {
  const source: ts.SourceFile = parse(file);
  const calls: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.expression.name.text === helper &&
      node.arguments[0]
    ) {
      calls.push(squash(node.arguments[0].getText(source)));
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
};

// Every file of the server's code, relative to the repository's root.
const listServerFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];

  const walk: (folder: string) => void = (folder: string): void => {
    for (const entry of fs.readdirSync(path.join(REPOSITORY, folder), {
      withFileTypes: true,
    })) {
      const relative: string = path.posix.join(folder, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          walk(relative);
        }
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts") &&
        !TEST_FILE.test(entry.name)
      ) {
        files.push(relative);
      }
    }
  };

  for (const root of ROUTE_ROOTS) {
    walk(root);
  }

  return files.sort();
};

/*
 * A route registered through a computed method - router[method](...) - is
 * one the walk cannot read the verb of, so a POST could hide in it, as the
 * Prometheus API's did before #7700 and Vercel Marketplace's provider API's
 * did before #10230. Each such call among the files given, read with
 * readFile, as "file: call(...)": none may be, in ee/'s files as in core's.
 * ee/ decides its own route files (ProductRouteDecisions.ts), but a route
 * the walk cannot read is one nobody decided.
 */
const MAY_REGISTER_COMPUTED: RegExp = /(?:router|\bapp)\s*\??\.?\s*\[/i;

const findComputedRegistrations: (
  files: ReadonlyArray<string>,
  readFile: (file: string) => string,
) => Array<string> = (
  files: ReadonlyArray<string>,
  readFile: (file: string) => string,
): Array<string> => {
  return files.flatMap((file: string): Array<string> => {
    const text: string = readFile(file);

    if (!MAY_REGISTER_COMPUTED.test(text)) {
      return [];
    }

    const source: ts.SourceFile = parseText(file, text);
    const calls: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isElementAccessExpression(node.expression) &&
        ROUTER.test(node.expression.expression.getText(source))
      ) {
        calls.push(`${file}: ${squash(node.expression.getText(source))}(...)`);
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    return calls;
  });
};

const FILES_WITH_ROUTES: Array<string> = listServerFiles().filter(
  (file: string): boolean => {
    return (
      MAY_REGISTER.test(fs.readFileSync(path.join(REPOSITORY, file), "utf8")) &&
      readRegistrations(file).length > 0
    );
  },
);

// The products a refusal of a file may name, or null when this cannot tell.
const productsOfRefusal: (
  refusal: { kind: string; argument: string },
  decision: ProductRouteFile,
) => ReadonlyArray<ProductKey> | null = (
  refusal: { kind: string; argument: string },
  decision: ProductRouteFile,
): ReadonlyArray<ProductKey> | null => {
  const handed: Record<
    string,
    ReadonlyArray<ProductKey>
  > = decision.handedProducts || {};

  if (refusal.kind === "refuseWhileRecordTableIsOff") {
    return refusal.argument === "ProductsOfRequest.ruleTable"
      ? ANY_PRODUCT
      : null;
  }

  if (refusal.kind === "refuseWhileOffFor") {
    const resolvers: Record<string, ReadonlyArray<ProductKey>> = {
      "ProductsOfRequest.incidentOrAlert": [
        ProductKey.Incidents,
        ProductKey.Alerts,
      ],
      "ProductsOfRequest.workspaceChannelRecord": Object.values(
        PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE,
      ),
      "ProductsOfRequest.aiResource": Object.values(
        PRODUCT_OF_AI_RESOURCE_TYPE,
      ),
      "ProductsOfRequest.setupAction": SETUP_ACTION_PRODUCTS,
    };

    return resolvers[refusal.argument] || handed[refusal.argument] || null;
  }

  const products: Array<ProductKey> = [];

  for (const argument of refusal.argument.split(",")) {
    const text: string = argument.trim();
    const key: RegExpMatchArray | null = text.match(
      /^ProductKey\.([A-Za-z]+)$/,
    );

    if (key) {
      const product: string | undefined = (
        ProductKey as unknown as Record<string, string>
      )[key[1]!];

      if (!product) {
        return null;
      }

      products.push(product as ProductKey);
    } else if (handed[text]) {
      products.push(...handed[text]!);
    } else {
      return null;
    }
  }

  return products.length > 0 ? products : null;
};

describe("every route file of the server is held to a decision", () => {
  test("the walk finds the server's routes, and only theirs", () => {
    // Enough of them that a walk that found none is never a pass.
    expect(FILES_WITH_ROUTES.length).toBeGreaterThan(200);
    expect(FILES_WITH_ROUTES).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/API/StatusPageAPI.ts",
        "packages/App/FeatureSet/Workflow/API/Manual.ts",
        "packages/App/FeatureSet/Telemetry/API/ProbeIngest/Monitor.ts",
        // And one of ee/'s, where ee/ is checked out.
        ...(ENTERPRISE_DECISIONS
          ? [ENTERPRISE_DECISIONS.ENTERPRISE_ROUTE_FILE_THE_WALK_FINDS]
          : []),
      ]),
    );
    // A code sample in a guide's text, and a comment, are no route.
    expect(FILES_WITH_ROUTES).not.toContain(
      "packages/Home/Utils/Integrations/OpenTelemetry/Guides/Koa.ts",
    );
    expect(FILES_WITH_ROUTES).not.toContain(
      "packages/Common/Server/Utils/ServerProducts/ServerProductRoutes.ts",
    );
  });

  // Every file of the server's: ee/'s too, where it is checked out (#10230).
  test("no route is registered through a computed method, which the walk cannot read", () => {
    expect(findComputedRegistrations(listServerFiles(), readText)).toEqual([]);
  });

  test("every file that registers a route is decided, once", () => {
    const undecided: Array<string> = FILES_WITH_ROUTES.filter(
      (file: string): boolean => {
        return !PRODUCT_ROUTE_FILES[file] && !FILES_DECIDED_WHOLE[file];
      },
    );
    const twice: Array<string> = Object.keys(PRODUCT_ROUTE_FILES).filter(
      (file: string): boolean => {
        return Boolean(FILES_DECIDED_WHOLE[file]);
      },
    );

    expect({ undecided, twice }).toEqual({ undecided: [], twice: [] });
  });

  test("every file decided is there, and one decided as a whole still registers routes", () => {
    const missing: Array<string> = [
      ...Object.keys(PRODUCT_ROUTE_FILES),
      ...Object.keys(FILES_DECIDED_WHOLE),
    ].filter((file: string): boolean => {
      return !fs.existsSync(path.join(REPOSITORY, file));
    });
    const withoutRoutes: Array<string> = Object.keys(
      FILES_DECIDED_WHOLE,
    ).filter((file: string): boolean => {
      return !FILES_WITH_ROUTES.includes(file);
    });

    expect({ missing, withoutRoutes }).toEqual({
      missing: [],
      withoutRoutes: [],
    });
  });

  for (const [file, decision] of Object.entries(FILES_DECIDED_WHOLE)) {
    test(`${file}: ${decision.routes} routes, decided as a whole - a route added is a decision again`, () => {
      expect(decision.why.length).toBeGreaterThan(20);
      expect({ file, routes: readRegistrations(file).length }).toEqual({
        file,
        routes: decision.routes,
      });
    });
  }

  for (const [file, decision] of Object.entries(PRODUCT_ROUTE_FILES)) {
    test(`${file}: every route but those left alone names its products`, () => {
      const registrations: Array<Registration> = readRegistrations(file);
      const unaccounted: Array<string> = [];
      const wrongProduct: Array<string> = [];
      const unreadable: Array<string> = [];

      for (const registration of registrations) {
        const route: string = `${registration.method} ${registration.path}`;

        if (registration.refusals.length === 0) {
          if (
            !Object.prototype.hasOwnProperty.call(
              decision.leftAlone,
              registration.path,
            )
          ) {
            unaccounted.push(route);
          }

          continue;
        }

        for (const refusal of registration.refusals) {
          const products: ReadonlyArray<ProductKey> | null = productsOfRefusal(
            refusal,
            decision,
          );

          if (!products) {
            unreadable.push(`${route}: ${refusal.kind}(${refusal.argument})`);
          } else if (
            products.some((product: ProductKey): boolean => {
              return !decision.products.includes(product);
            })
          ) {
            wrongProduct.push(`${route}: ${refusal.argument}`);
          }
        }
      }

      expect({ file, unaccounted, wrongProduct, unreadable }).toEqual({
        file,
        unaccounted: [],
        wrongProduct: [],
        unreadable: [],
      });

      // Nothing listed as left alone that is not one of its routes any more.
      const paths: Set<string> = new Set(
        registrations.map((registration: Registration): string => {
          return registration.path;
        }),
      );
      const stale: Array<string> = Object.keys(decision.leftAlone).filter(
        (routePath: string): boolean => {
          return !paths.has(routePath);
        },
      );

      expect({ file, stale }).toEqual({ file, stale: [] });
    });

    for (const [helper, calls] of Object.entries(decision.readHelpers || {})) {
      test(`${file}: every call of its read helper ${helper} is decided`, () => {
        const found: Array<string> = readHelperCalls(file, helper);

        expect({ file, helper, calls: [...found].sort() }).toEqual({
          file,
          helper,
          calls: Object.keys(calls).sort(),
        });
        expect(found.length).toBeGreaterThan(0);
      });
    }
  }

  test("every reason written down is a sentence", () => {
    for (const decision of Object.values(PRODUCT_ROUTE_FILES)) {
      for (const why of [
        ...Object.values(decision.leftAlone),
        ...Object.values(decision.readHelpers || {}).flatMap(
          (calls: Record<string, string>): Array<string> => {
            return Object.values(calls);
          },
        ),
      ]) {
        expect(why).toMatch(/^[A-Z].+[.)]$/);
      }
    }

    for (const decision of Object.values(FILES_DECIDED_WHOLE)) {
      expect(decision.why).toMatch(/^[A-Z].+[.)]$/);
    }
  });

  test("the routes named in the issues are among them", () => {
    // #7479: MonitorAPI's and StatusPageAPI's own routes, and /workflow/... runs.
    expect(Object.keys(PRODUCT_ROUTE_FILES)).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/API/MonitorAPI.ts",
        "packages/Common/Server/API/StatusPageAPI.ts",
        "packages/App/FeatureSet/Workflow/API/Manual.ts",
        "packages/App/FeatureSet/Workflow/API/RunStep.ts",
        // #9489: OneUptime AI on a record of a product that is off.
        "packages/Common/Server/API/AIInvestigationAPI.ts",
        "packages/Common/Server/API/AIInvestigationConversationAPI.ts",
        "packages/Common/Server/API/AutoRemediationAPI.ts",
        "packages/Common/Server/API/IncidentAlertAiActivityAPI.ts",
        "packages/Common/Server/API/CodeFixRunAPI.ts",
      ]),
    );
  });
});

describe("what the decisions stand on", () => {
  /*
   * POST /api/setup-actions/run names the products of the action its body
   * names (#7241, #10041): a new action, or one that changes its products,
   * changes what the route refuses while a product is off, so it is a
   * decision written here.
   */
  test("the setup actions' route names Monitors, Services, On-Call and Status Pages, and its people and How to Reach Me no product", () => {
    expect([...SETUP_ACTION_PRODUCTS].sort()).toEqual(
      [
        ProductKey.Monitors,
        ProductKey.Services,
        ProductKey.OnCall,
        ProductKey.StatusPages,
      ].sort(),
    );

    for (const action of ["invite_people", "set_how_to_reach_me"]) {
      expect(SETUP_ACTIONS_RUN_OUTSIDE_CHAT).toContain(action);
      expect([action, getToolProducts(action)]).toEqual([action, []]);
    }
  });

  test.each([
    ["packages/Common/Server/API/DataObservabilityAPI.ts", "DataObservability"],
    ["packages/Common/Server/API/DataSecurityAPI.ts", "DataSecurity"],
  ])(
    "%s: every route its helper registers but the reads names %s",
    (file: string, product: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY, file),
        "utf8",
      );
      const helper: string = source.slice(source.indexOf("  private post("));

      expect(helper).toContain("permissions === READ_PERMISSIONS");
      expect(helper).toContain(
        `ServerProductRoutes.refuseWhileOff(ProductKey.${product})`,
      );
    },
  );

  /*
   * Data Observability's routes are decided by its helper (above): its reads
   * keep working while it is switched off, as every read does, and
   * everything else is refused. The count beside Overview (#6552) and the
   * Issues page's list (#6549) only read - counted and listed from what
   * each record keeps - so they are registered with READ_PERMISSIONS, and
   * left working; the pages that ask for them are gone while the product is
   * off (ServerProductGate), so nothing asks.
   */
  /*
   * So do the lineage routes: the Lineage Map now starting from a database
   * or a search of the whole project (#6547), and a pipeline's lineage with
   * the columns its runs moved (#6854), each answering only about what its
   * caller may read (#9526) - reads all the same, left working.
   */
  /*
   * And a pipeline's circuit breaker (#6548): a pipeline step outside
   * OneUptime asks it before it runs - what already runs keeps running -
   * and it decides from what is known, so it is a read. While the product
   * is off it answers go and keeps nothing (DataCircuitBreaker), so
   * switching Data Observability off never stops a pipeline. How a
   * pipeline's breaker stands, for its page, only reads.
   */
  test.each([
    ["attentionCount"],
    ["issues"],
    ["lineageMap"],
    ["pipelineLineage"],
    ["tableLineage"],
    ["lineageExpand"],
    ["tableLineageAnswer"],
    ["circuitBreaker"],
    ['pipelineCircuitBreaker(":id")'],
  ])(
    "packages/Common/Server/API/DataObservabilityAPI.ts: %s is a read, left working while the product is off",
    (route: string) => {
      const source: string = fs.readFileSync(
        path.join(
          REPOSITORY,
          "packages/Common/Server/API/DataObservabilityAPI.ts",
        ),
        "utf8",
      );
      const registration: number = source.indexOf(
        `DATA_OBSERVABILITY_API_ROUTES.${route},`,
      );

      expect(registration).toBeGreaterThan(-1);
      expect(
        source.slice(registration, registration + 120).replace(/\s+/g, " "),
      ).toContain(`DATA_OBSERVABILITY_API_ROUTES.${route}, READ_PERMISSIONS,`);
    },
  );

  /*
   * A public note's approval routes are registered by one helper for each
   * kind of note: a decision, sending a note again and withdrawing an edit
   * name the notes' product, which each kind's API hands it. Where each
   * note stands and who approves are reads.
   */
  test("a public note's approval: its writes name the product each kind of note hands the helper", () => {
    const registrations: Array<Registration> = readRegistrations(
      "packages/Common/Server/API/PublicNoteApprovalRoutes.ts",
    );

    expect(
      registrations
        .filter((registration: Registration): boolean => {
          return registration.refusals.some(
            (refusal: { kind: string; argument: string }): boolean => {
              return refusal.argument === "data.product";
            },
          );
        })
        .map((registration: Registration): string => {
          return registration.path;
        })
        .sort(),
    ).toEqual(
      [
        "`${data.basePath}/:noteId/${decision.route}`",
        "`${data.basePath}/:noteId/resubmit`",
        "`${data.basePath}/:noteId/discard-edit`",
      ].sort(),
    );

    for (const [file, product] of [
      ["packages/Common/Server/API/IncidentPublicNoteAPI.ts", "Incidents"],
      [
        "packages/Common/Server/API/IncidentEpisodePublicNoteAPI.ts",
        "Incidents",
      ],
      [
        "packages/Common/Server/API/ScheduledMaintenancePublicNoteAPI.ts",
        "ScheduledMaintenance",
      ],
    ] as Array<[string, string]>) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY, file),
        "utf8",
      );

      expect({
        file,
        names: source.includes(`product: ProductKey.${product},`),
      }).toEqual({
        file,
        names: true,
      });
    }
  });

  /*
   * BaseAPI and BaseAnalyticsAPI are decided as a whole because their
   * writes refuse in the method each write route calls: the first thing
   * createItem, updateItem and deleteItem do.
   */
  test.each([
    ["packages/Common/Server/API/BaseAPI.ts"],
    ["packages/Common/Server/API/BaseAnalyticsAPI.ts"],
  ])(
    "%s: every write refuses a record of a product that is off before anything else",
    (file: string) => {
      const source: ts.SourceFile = parse(file);
      const firstStatements: Record<string, string> = {};

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isMethodDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          ["createItem", "updateItem", "deleteItem"].includes(node.name.text) &&
          node.body
        ) {
          firstStatements[node.name.text] = squash(
            node.body.statements[0]?.getText(source) || "",
          );
        }

        ts.forEachChild(node, visit);
      };

      visit(source);

      expect(firstStatements).toEqual({
        createItem: "await this.assertProductIsOn();",
        updateItem: "await this.assertProductIsOn();",
        deleteItem: "await this.assertProductIsOn();",
      });
    },
  );

  /*
   * The move of an ordered list's row (issues #9573, #9609), the one write
   * BaseAPI answers beside the CRUD routes, refuses first thing in moveItem
   * for the same reason.
   */
  test("packages/Common/Server/API/BaseAPI.ts: a move refuses a record of a product that is off before anything else", () => {
    const source: ts.SourceFile = parse(
      "packages/Common/Server/API/BaseAPI.ts",
    );
    const firstStatements: Record<string, string> = {};

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "moveItem" &&
        node.body
      ) {
        firstStatements[node.name.text] = squash(
          node.body.statements[0]?.getText(source) || "",
        );
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    expect(firstStatements).toEqual({
      moveItem: "await this.assertProductIsOn();",
    });
  });

  /*
   * The routes of a fix that name only the fix are refused once it is
   * read: approving, dry-running and dismissing it in RemediationApproval,
   * a round's Try again in RemediationRound, a pull request of a step in
   * DeclaredCodeChanges (RemediationFixWhileProductIsOff holds what each
   * refuses).
   */
  test.each([
    ["packages/Common/Server/Utils/AutoRemediation/RemediationApproval.ts", 3],
    ["packages/Common/Server/Utils/AutoRemediation/RemediationRound.ts", 1],
    ["packages/Common/Server/Utils/AutoRemediation/DeclaredCodeChanges.ts", 1],
  ])(
    "%s asks RemediationFixProducts before it acts on a fix",
    (file: string, times: number) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY, file),
        "utf8",
      );

      expect(
        source.split("RemediationFixProducts.assertMayActOn(").length - 1,
      ).toBe(times);
    },
  );
});

describe("the walk reads the shapes it is meant to", () => {
  // Vercel Marketplace's provider API registered its routes so before #10230.
  const THROUGH_A_HELPER: string = `
    export default class FixtureAPI {
      public constructor() {
        this.route("put", installation, async (req, caller) => {
          return { status: 204 };
        });
        this.route("post", resources, async (req, caller) => {
          return { status: 200 };
        });
      }

      private route(method: "put" | "post", path: string, handler: ProviderHandler): void {
        this.router[method](path, async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
          await handler(req, res);
        });
      }
    }
  `;

  // And registers them so since: one by one, by their verb.
  const ONE_BY_ONE: string = `
    export default class FixtureAPI {
      public constructor() {
        // Never this.router[method](...): the walk cannot read its verb.
        this.router.put(installation, this.providerCall(async (req, caller) => {
          return { status: 204 };
        }));
        this.router.get(installation, this.providerCall(async (req, caller) => {
          return { status: 200 };
        }));
        this.router.post(webhook, async (req: ExpressRequest, res: ExpressResponse) => {
          await handleWebhook(req, res);
        });
      }

      private providerCall(handler: ProviderHandler): ProviderRoute {
        return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
          await answers[req.method](req, res);
        };
      }
    }
  `;

  const fixture: (text: string) => (file: string) => string = (
    text: string,
  ): ((file: string) => string) => {
    return (): string => {
      return text;
    };
  };

  test("the walk reads each route registered by its verb, and none registered through a helper's router[method]", () => {
    expect(
      readRegistrations(
        "ee/Server/Fixture/API/FixtureAPI.ts",
        THROUGH_A_HELPER,
      ),
    ).toEqual([]);
    expect(
      readRegistrations("ee/Server/Fixture/API/FixtureAPI.ts", ONE_BY_ONE).map(
        (registration: Registration): string => {
          return `${registration.method} ${registration.path}`;
        },
      ),
    ).toEqual(["PUT installation", "POST webhook"]);
  });

  // #10230: ee/ decides its own route files, but not a route nobody can read.
  test.each([
    ["ee/Server/Fixture/API/FixtureAPI.ts"],
    ["packages/Common/Server/API/FixtureAPI.ts"],
  ])(
    "%s: a route registered through a computed method is refused",
    (file: string) => {
      expect(
        findComputedRegistrations([file], fixture(THROUGH_A_HELPER)),
      ).toEqual([`${file}: this.router[method](...)`]);
    },
  );

  test("every computed shape is refused: a loop over the verbs, a verb in quotes, an optional call", () => {
    const file: string = "ee/Server/Fixture/API/FixtureAPI.ts";

    expect(
      findComputedRegistrations(
        [file],
        fixture(`
          for (const method of ["get", "post"] as const) {
            router[method]("/prometheus/api/v1/query", ...requireMetricReadAccess, instantQuery);
          }
          this.router["delete"]("/items/:id", handler);
          app?.[verb]("/status", handler);
        `),
      ),
    ).toEqual([
      `${file}: router[method](...)`,
      `${file}: this.router["delete"](...)`,
      `${file}: app?.[verb](...)`,
    ]);
  });

  test("a route registered by its verb, a computed call of something else and a comment are not refused", () => {
    expect(
      findComputedRegistrations(
        ["ee/Server/Fixture/API/FixtureAPI.ts"],
        fixture(ONE_BY_ONE),
      ),
    ).toEqual([]);
  });
});
