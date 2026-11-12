/*
 * Offline fixture for an OpenStack cloud's pages: the production cloud layout
 * (ModelPage, the cloud's side menu) with every page of a cloud under its real RouteMap
 * pattern. Only the data boundary (ModelAPI, AnalyticsModelAPI, API, Realtime) and the
 * signed-in user are replaced, and every read is answered from one estate's rows
 * (Data.js, Answers.js), so a page cannot be right by accident of a canned answer.
 *
 * Scenarios are picked with query parameters, parsed once at load, and kept for a reload:
 *
 *   ?estate=    busy (default) | calm | forced-down | new | multi-region | overflow | ovn-stale | tenants
 *               | parts | links | usage (Data.js)
 *   ?recording= <release>/<scene>: what that real cloud's exporter answered, through
 *               the real snapshot scan (Recordings.js), e.g. gazpacho-ovs/compute-down.
 *               Wins over ?estate=.
 *   ?logs=      <release>: what that real cloud's services wrote, as the cloud's logs and
 *               change events, through the ingest's own stamp (ServiceLogs.js), and the
 *               instance, volume and service it wrote about, on any estate.
 *               "<release>/access/<level>" is what its exporter answered each credential:
 *               reader, monitoring-role or monitoring-admin-get.
 *   ?without=   compute, network, volume...: with a recording, a service this cloud doesn't run
 *   ?also=      <group>/<scene>: with a recording, what a real cloud said of a service a cloud may
 *               not run, on top of what a release's cloud said of the rest
 *   ?traces=    <release>/signed-boot: what OSProfiler's driver really sent for a signed
 *               boot, through the real reader (TraceRecordings.js). With none, a cloud has
 *               no traces, which is how every cloud starts.
 *   ?collector= disconnected: the agent stopped reporting ?quiet= ago (default 3 days)
 *   ?quiet=     how long ago the agent last reported: minutes, e.g. 4320
 *   ?access=    project: the credential is Project view, so it can list no services,
 *               hypervisors or pools, and the APIs still answer up
 *   ?alerts=    none (default) | some | all | denied (the role may not read monitors)
 *   ?open=      0 | 1 (default) | many | regions: unresolved incidents and alerts on the cloud
 *   ?fail=      a comma list of reads that fail, as a server that answers 500 does:
 *               inventory (the summaries and the rows), attention, regions, consumers,
 *               blast, counts, metrics, events
 *   ?collection= Probe: a probe collects the cloud (ProbeCollection.js)
 *   ?probe=     how its last collection went: checking | collecting (default) | partial |
 *               untrusted | plain-http
 *   ?probes=    many: a choice of probes, where a new cloud starts on none
 *   ?tests=     a comma list of what each connection test answers, in turn: ok | project |
 *               untrusted | plain-http | refused | not-found | no-probe
 *   ?checks=    on | failed | refused | sweeping | waiting: what a cloud's check has come to,
 *               with none until someone turns one on (Checks.js)
 *   ?aiAgent=   connected | unreachable: the OneUptime AI agent's state (AiAgent.js); none
 *               has connected by default
 *   ?clouds=    none: the project has no cloud yet, for the clouds list's first run
 *   ?archived=  1: the project also has an archived cloud
 *   ?linked=    1: an incident, an alert and a maintenance event linked to this cloud, and one of
 *               each that is not, and a feed that says what happened to the cloud
 *   ?role=      read: a custom role holding only the OpenStack read permissions; none: one
 *               holding none of them. Every read and write is then held to the model's own lists
 *               of who may, which are what the server's permission checks read
 *   ?lang=      de, fa or ar reads the German, Persian or Arabic locale file (Persian and
 *               Arabic lay the page out right to left)
 *   ?theme=     dark adds html.dark (server.js)
 *   ?region=    is the product's own: which region the pages read
 *
 * Every read is recorded on window.__openStackPagesFixture: listRequests,
 * countRequests, itemRequests, aggregateRequests, apiRequests and unhandled, which holds
 * anything the fixture does not model. The spec keeps `unhandled` empty.
 *
 * To add a page: import it and add a line to PAGES. To add data: Data.js.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import ar from "../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import CloudLayout from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Layout";
import CloudOverview from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Index";
import CloudAiInsights from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AI/Insights";
import CloudAiLogs from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AI/Logs";
import CloudAiAgent from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AI/Agent";
import {
  getAiAccessStatus,
  getAiInsights,
  getAiLogs,
  withAiAccessColumns,
} from "./AiAgent";
import CloudCapacity from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Capacity";
import CloudSpend from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Spend";
import CloudServices from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Services";
import CloudServiceDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ServiceDetail";
import CloudHypervisors from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Hypervisors";
import CloudHypervisorDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/HypervisorDetail";
import CloudInstances from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Instances";
import CloudInstanceDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/InstanceDetail";
import CloudAvailabilityZones from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AvailabilityZones";
import CloudAvailabilityZoneDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AvailabilityZoneDetail";
import CloudAggregates from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Aggregates";
import CloudAggregateDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AggregateDetail";
import CloudFlavors from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Flavors";
import CloudFlavorDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/FlavorDetail";
import CloudNetworks from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Networks";
import CloudNetworkDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/NetworkDetail";
import CloudSubnets from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Subnets";
import CloudSubnetDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/SubnetDetail";
import CloudRouters from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Routers";
import CloudRouterDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/RouterDetail";
import CloudFloatingIps from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/FloatingIps";
import CloudBareMetalNodes from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/BareMetalNodes";
import CloudBareMetalNodeDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/BareMetalNodeDetail";
import CloudFloatingIpDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/FloatingIpDetail";
import CloudNetworkAgents from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/NetworkAgents";
import CloudNetworkAgentDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/NetworkAgentDetail";
import CloudVolumes from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Volumes";
import CloudVolumeDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/VolumeDetail";
import CloudSnapshots from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Snapshots";
import CloudStoragePools from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StoragePools";
import CloudStoragePoolDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StoragePoolDetail";
import CloudImages from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Images";
import CloudImageDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ImageDetail";
import CloudStacks from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Stacks";
import CloudStackDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StackDetail";
import CloudDnsZones from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DnsZones";
import CloudDnsZoneDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DnsZoneDetail";
import CloudObjectContainers from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ObjectContainers";
import CloudObjectContainerDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ObjectContainerDetail";
import CloudDatabaseInstances from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DatabaseInstances";
import CloudDatabaseInstanceDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DatabaseInstanceDetail";
import CloudShares from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Shares";
import CloudShareDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ShareDetail";
import CloudLoadBalancers from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/LoadBalancers";
import CloudLoadBalancerDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/LoadBalancerDetail";
import CloudLoadBalancerPoolDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/LoadBalancerPoolDetail";
import CloudAmphoraDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AmphoraDetail";
import CloudContainerClusters from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ContainerClusters";
import CloudContainerClusterDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ContainerClusterDetail";
import CloudProjects from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Projects";
import CloudProjectDetail from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ProjectDetail";
import CloudDomains from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Domains";
import CloudControlPlane from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ControlPlane";
import CloudControlPlaneDependency from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ControlPlaneDependency";
import CloudTopology from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Topology";
import CloudMetrics from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Metrics";
import CloudLogs from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Logs";
import CloudTraces from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Traces";
import CloudChecks from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Checks";
import CloudIncidents from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Incidents";
import CloudAlerts from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Alerts";
import CloudScheduledMaintenance from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ScheduledMaintenance";
import CloudStatusPages from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StatusPages";
import {
  buildOpenStackProjectPagePlan,
  buildOpenStackStatusPagePlan,
  getOpenStackStatusPagePlanKey,
} from "../../../Common/Types/OpenStack/OpenStackStatusPagePlan";
import { getAllOpenStackAlertTemplates } from "../../../Common/Types/Monitor/OpenStackAlertTemplates";
import { writeOpenStackProjectNotice } from "../../../Common/Utils/OpenStack/OpenStackProjectNoticeText";
import CloudRecommendations from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Recommendations";
import CloudDocumentation from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Documentation";
import CloudSettings from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Settings";
import CloudOwners from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Owners";
import CloudDelete from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Delete";
import CloudFeed from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Feed";
import CloudsList from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Clouds";
import {
  OpenStackPlacementOfHost,
  OpenStackPlacementOfKubernetesCluster,
  OpenStackPlacementOfKubernetesNode,
  OpenStackPlacementOfService,
} from "../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPlacementOfHost";
import CloudsArchived from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Archived";
import OwnerRules from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Settings/OwnerRules";
import LabelRules from "../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Settings/LabelRules";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "Common/Models/DatabaseModels/Project";
import Color from "Common/Types/Color";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import Includes from "Common/Types/BaseDatabase/Includes";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "Common/Utils/ArchivableValues";
import {
  getAttentionRows,
  getBlastRadius,
  getCounts,
  getBareMetalClasses,
  getInventorySummary,
  getRegionSummaries,
  getTopConsumers,
  getDomainSummaries,
  getProjectAttention,
  getProjectIdsOfDomain,
  getProjectOverview,
  getProjectSummaries,
  getTopologyRead,
} from "./Answers";
import {
  CLOUD_ID,
  DAY,
  ESTATE_NAMES,
  GIB,
  MINUTE,
  PROJECT_ID,
  REGION_ONE,
  buildEstate,
  instance,
  novaCompute,
  uuid,
  volume,
} from "./Data";
import {
  addCephStatusToPools,
  answerStoragePoolCeph,
  getHostOfMachine,
  getPlacementOfHost,
  getKubernetesClusterOfMagnumCluster,
  getMagnumClusterOfKubernetesCluster,
  getPlacementOfKubernetesNode,
  getPlacementsOfService,
  getReachOfInstance,
  getReachOfPart,
  getStoragePoolCeph,
  otherProductsOf,
} from "./Links";
import { checkRowOf } from "./Checks";
import {
  PROBES,
  SHARED_PROBES,
  collectionOf,
  connectionTestOutcome,
  getWrittenValues,
  probeCollectedCloud,
  writeCloud,
} from "./ProbeCollection";
import {
  hasRecording,
  rowsFromRecording,
  seriesFromRecording,
} from "./Recordings";
import { answerRows, hasServiceLogs, readServiceLogs } from "./ServiceLogs";
import { buildCapacitySnapshotOf } from "./Capacity";
import { buildSpendOf } from "./Spend";
import { hasTraceRecording, spanRowsFromRecording } from "./TraceRecordings";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */

/*
 * What this tab was asked to be. A link inside the product knows nothing of these, so
 * they're gone from the address after the first click, and a reload has to read what the
 * tab was first given: otherwise it would load another cloud, and a page's way of keeping
 * its place across one could never be tested.
 */
const SCENARIO_STORAGE_KEY = "openstack-pages-fixture-scenario";

function readScenarioParams() {
  const navigation = performance.getEntriesByType("navigation")[0];
  const isSameTabAgain =
    navigation?.type === "reload" || navigation?.type === "back_forward";
  const stored = sessionStorage.getItem(SCENARIO_STORAGE_KEY);
  if (isSameTabAgain && stored !== null) {
    return new URLSearchParams(stored);
  }
  sessionStorage.setItem(SCENARIO_STORAGE_KEY, window.location.search);
  return new URLSearchParams(window.location.search);
}

const params = readScenarioParams();

const ESTATE = ESTATE_NAMES.includes(params.get("estate"))
  ? params.get("estate")
  : "busy";
const RECORDING = hasRecording(params.get("recording"))
  ? params.get("recording")
  : "";
const IS_CONNECTED = params.get("collector") !== "disconnected";
const QUIET_FOR = params.get("quiet")
  ? Number(params.get("quiet")) * MINUTE
  : 3 * DAY;
const ACCESS = params.get("access") === "project" ? "project" : "";
const ALERTS = ["some", "all", "denied"].includes(params.get("alerts"))
  ? params.get("alerts")
  : "none";
const OPEN = ["0", "many", "regions"].includes(params.get("open"))
  ? params.get("open")
  : "1";
const FAILS = new Set((params.get("fail") || "").split(",").filter(Boolean));
const TRACES = hasTraceRecording(params.get("traces"))
  ? params.get("traces")
  : "";
const LANGUAGE = ["de", "fa", "ar"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
/*
 * What the OpenStack read role holds: every read permission of the product's own tables, as
 * Common/Types/Permission.ts lists them, and nothing that writes.
 */
const OPENSTACK_READ_PERMISSIONS = [
  Permission.ReadOpenStackCloud,
  Permission.ReadOpenStackCloudFeed,
  Permission.ReadOpenStackCloudOwnerUser,
  Permission.ReadOpenStackCloudOwnerTeam,
  Permission.ReadOpenStackCloudOwnerRule,
  Permission.ReadOpenStackCloudLabelRule,
];
const ROLE = ["read", "none"].includes(params.get("role"))
  ? params.get("role")
  : "";
const rolePermissions = [
  ...GLOBAL_PERMISSIONS,
  ...(ROLE === "read"
    ? OPENSTACK_READ_PERMISSIONS
    : ROLE === "none"
      ? []
      : [Permission.ProjectOwner]),
];

/*
 * A custom role, as the server holds it to a model's own lists: nothing this role may not read
 * comes back, and nothing it may not write is written. What the real checks make of these same
 * lists has a test of its own (OpenStackCustomRoleGrants.test.ts).
 */
function refuseUnlessRoleMay(modelType, action) {
  if (!ROLE) {
    return;
  }
  const model = new modelType();
  const allowed = {
    read: model.getReadPermissions(),
    create: model.getCreatePermissions(),
    update: model.getUpdatePermissions(),
    delete: model.getDeletePermissions(),
  }[action];
  if (
    !allowed.some((permission) => {
      return rolePermissions.includes(permission);
    })
  ) {
    throw new Error(
      `You do not have permissions to ${action} ${model.singularName || "this"}.`,
    );
  }
}

/*
 * ---------------------------------------------------------------------------
 * The clock, the project and the estate
 * ---------------------------------------------------------------------------
 */
const LOADED_AT = Date.now();
const projectObjectId = new ObjectID(PROJECT_ID);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Cloud",
});

const estate = buildEstate(
  {
    estate: ESTATE,
    recording: RECORDING,
    recordedRows: RECORDING
      ? [
          RECORDING,
          ...(params.get("also") ? [params.get("also")] : []),
        ].flatMap((name) => {
          return rowsFromRecording(name, {
            region: REGION_ONE,
            loadedAt: IS_CONNECTED ? LOADED_AT - MINUTE : LOADED_AT - QUIET_FOR,
            without: params.get("without") || "",
          });
        })
      : null,
    isConnected: IS_CONNECTED,
    quietFor: QUIET_FOR,
    access: ACCESS,
  },
  LOADED_AT,
);

/*
 * What a real cloud's services wrote, and the parts they wrote it about, with the IDs they
 * really had, beside whatever the estate holds.
 */
const serviceLogRows = hasServiceLogs(params.get("logs"))
  ? readServiceLogs(params.get("logs"), {
      cloudId: new ObjectID(CLOUD_ID),
      cloudName: estate.cloud.name,
      loadedAt: LOADED_AT,
    })
  : null;

if (serviceLogRows) {
  const context = {
    loadedAt: LOADED_AT,
    lastSeenAt: LOADED_AT - MINUTE,
    isConnected: true,
  };
  const parts = [
    instance(context, 9001, "ou-log-novalid", REGION_ONE, {
      externalId: serviceLogRows.ids.instance_no_valid_host,
      status: "ERROR",
    }),
    instance(context, 9002, "ou-log-vm", REGION_ONE, {
      externalId: serviceLogRows.ids.instance_ok,
    }),
    instance(context, 9004, "ou-log-broken", REGION_ONE, {
      externalId: serviceLogRows.ids.instance_spawn_failed,
      status: "ERROR",
    }),
    volume(context, 9003, "ou-log-vol", REGION_ONE, {
      externalId: serviceLogRows.ids.volume_attached,
    }),
    novaCompute(context, "devstack-host", REGION_ONE, {
      adminState: "disabled",
    }),
  ];

  parts.forEach((part, index) => {
    if (part.externalId) {
      estate.inventory.push({
        ...part,
        _id: uuid("74000000", index + 1),
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });
    }
  });
}

/*
 * ---------------------------------------------------------------------------
 * Open incidents and alerts on the cloud. A grouped OpenStack monitor writes which part
 * crossed the line in the record's series labels, as openstack-exporter labels it.
 * ---------------------------------------------------------------------------
 */
const incidentStates = [
  { _id: uuid("50000000", 1), name: "Identified", order: 1 },
  { _id: uuid("50000000", 2), name: "Acknowledged", order: 2 },
  {
    _id: uuid("50000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];
const alertStates = [
  { _id: uuid("51000000", 1), name: "Created", order: 1 },
  { _id: uuid("51000000", 2), name: "Acknowledged", order: 2 },
  {
    _id: uuid("51000000", 3),
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
];
const criticalIncident = {
  _id: uuid("52000000", 1),
  name: "Critical",
  color: new Color("#dc2626"),
};
const warningAlert = {
  _id: uuid("53000000", 1),
  name: "Warning",
  color: new Color("#d97706"),
};

function openIncident(number, title, labels, minutesAgo) {
  return {
    _id: uuid("56000000", number),
    title: title,
    incidentNumber: 40 + number,
    incidentNumberWithPrefix: `INC-${40 + number}`,
    declaredAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    createdAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    seriesLabels: labels,
    incidentSeverity: criticalIncident,
    currentIncidentState: incidentStates[0],
    currentIncidentStateId: incidentStates[0]._id,
    openStackCloudIds: [CLOUD_ID],
  };
}

function openAlert(number, title, labels, minutesAgo) {
  return {
    _id: uuid("57000000", number),
    title: title,
    alertNumber: 110 + number,
    alertNumberWithPrefix: `ALT-${110 + number}`,
    createdAt: new Date(LOADED_AT - minutesAgo * MINUTE),
    seriesLabels: labels,
    alertSeverity: warningAlert,
    currentAlertState: alertStates[0],
    currentAlertStateId: alertStates[0]._id,
    openStackCloudIds: [CLOUD_ID],
  };
}

const incidents = [];
const alerts = [];
const scheduledMaintenances = [];
const LINKED = params.get("linked") === "1";
if (LINKED) {
  incidents.push(openIncident(61, "Nova API errors in RegionOne", [], 45), {
    ...openIncident(62, "A payment provider is slow", [], 30),
    openStackCloudIds: [],
  });
  alerts.push(openAlert(61, "Volume stuck in creating", [], 20), {
    ...openAlert(62, "A certificate expires soon", [], 10),
    openStackCloudIds: [],
  });
  scheduledMaintenances.push(
    {
      _id: uuid("58000000", 1),
      title: "Patch the control plane",
      scheduledMaintenanceNumber: 7,
      scheduledMaintenanceNumberWithPrefix: "SCH-7",
      startsAt: new Date(LOADED_AT + 60 * MINUTE),
      endsAt: new Date(LOADED_AT + 120 * MINUTE),
      createdAt: new Date(LOADED_AT - 60 * MINUTE),
      openStackCloudIds: [CLOUD_ID],
    },
    {
      _id: uuid("58000000", 2),
      title: "Move the office network",
      scheduledMaintenanceNumber: 8,
      scheduledMaintenanceNumberWithPrefix: "SCH-8",
      startsAt: new Date(LOADED_AT + 60 * MINUTE),
      endsAt: new Date(LOADED_AT + 120 * MINUTE),
      createdAt: new Date(LOADED_AT - 60 * MINUTE),
      openStackCloudIds: [],
    },
  );
}
if (OPEN !== "0" && ESTATE === "busy" && !RECORDING) {
  incidents.push(
    openIncident(
      1,
      "[OpenStack] Compute Service Down",
      {
        hostname: "compute-02",
        service: "nova-compute",
        "openstack.region.name": REGION_ONE,
      },
      33,
    ),
  );
  alerts.push(
    openAlert(
      1,
      "[OpenStack] Scheduler or Conductor Down",
      {
        hostname: "ctl-02",
        service: "nova-scheduler",
        "openstack.region.name": REGION_ONE,
      },
      24,
    ),
  );
  if (OPEN === "many") {
    alerts.push(
      openAlert(
        2,
        "[OpenStack] Network Agent Down",
        {
          hostname: "compute-03",
          service: "neutron-openvswitch-agent",
          "openstack.region.name": REGION_ONE,
        },
        14,
      ),
    );
  }
}

// What is open on a cloud of several regions: one in each, and one that names none.
if (OPEN === "regions") {
  incidents.push(
    openIncident(
      1,
      "[OpenStack] Compute API Down in RegionTwo",
      { "openstack.region.name": "RegionTwo" },
      33,
    ),
    openIncident(
      2,
      "[OpenStack] Network Agent Down in RegionOne",
      {
        hostname: "ctl-01",
        service: "neutron-l3-agent",
        "openstack.region.name": "RegionOne",
      },
      30,
    ),
    openIncident(3, "Declared by hand about the whole cloud", null, 20),
  );
  alerts.push(
    openAlert(
      1,
      "[OpenStack] Instances in Error in RegionTwo",
      { "openstack.region.name": "RegionTwo" },
      24,
    ),
    openAlert(
      2,
      "[OpenStack] Volumes in Error in RegionOne",
      { "openstack.region.name": "RegionOne" },
      14,
    ),
  );
}

/*
 * ---------------------------------------------------------------------------
 * Monitors the cloud already has, for the alert cards and Recommendations
 * ---------------------------------------------------------------------------
 */
const openStackRecommendations =
  MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.OpenStack,
  );
const placeholderId = ObjectID.getZeroObjectID();

function monitorFor(recommendationId, number) {
  const recommendation = openStackRecommendations.find((candidate) => {
    return candidate.recommendationId === recommendationId;
  });
  if (!recommendation) {
    return null;
  }
  const step = recommendation.getMonitorStep({
    resourceIdentifier: estate.cloud.name,
    onlineMonitorStatusId: placeholderId,
    offlineMonitorStatusId: placeholderId,
    defaultIncidentSeverityId: placeholderId,
    defaultAlertSeverityId: placeholderId,
    monitorName: estate.cloud.name,
  });
  const steps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: placeholderId,
  };
  return {
    _id: uuid("58000000", number),
    name: `${estate.cloud.name} - ${recommendation.name}`,
    monitorType: recommendation.monitorType || MonitorType.OpenStack,
    monitorSteps: steps,
  };
}

const monitorIds =
  ALERTS === "some"
    ? [
        "OpenStack:openstack-compute-service-down",
        "OpenStack:openstack-compute-api-down",
      ]
    : ALERTS === "all"
      ? openStackRecommendations.map((recommendation) => {
          return recommendation.recommendationId;
        })
      : [];
const monitors = monitorIds
  .map((recommendationId, index) => {
    return monitorFor(recommendationId, index + 1);
  })
  .filter(Boolean);

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: {
    estate: ESTATE,
    recording: RECORDING,
    isConnected: IS_CONNECTED,
    access: ACCESS,
    alerts: ALERTS,
    open: OPEN,
    fails: Array.from(FAILS),
    language: LANGUAGE,
  },
  loadedAt: LOADED_AT,
  listRequests: [],
  countRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  writeRequests: [],
  unhandled: [],
};
window.__openStackPagesFixture = fixture;

// A read that starts failing after the page has loaded: a walk's way of breaking a server.
window.__openStackPagesFail = (read) => {
  FAILS.add(read);
};

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

function plain(value) {
  if (value instanceof ObjectID) {
    return value.toString();
  }
  return value;
}

/*
 * Whether a JSON column holds everything the query asks for, as Postgres' @> does. One key's
 * own operator compares its text, as JSONColumnQuery does, and a key that isn't there
 * passes a negative one.
 */
function holds(value, wanted) {
  const isEmpty = value === undefined || value === null || value === "";
  const text =
    value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : String(value ?? "");
  if (wanted instanceof IsNull) {
    return isEmpty;
  }
  if (wanted instanceof NotNull) {
    return !isEmpty;
  }
  if (wanted instanceof NotEqual) {
    return isEmpty || text !== String(wanted.value);
  }
  if (wanted instanceof Includes) {
    return wanted.values.map(String).includes(text);
  }
  if (wanted instanceof Search) {
    return text.toLowerCase().includes(wanted.toString().toLowerCase());
  }
  if (wanted === null || typeof wanted !== "object") {
    return value === wanted;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.keys(wanted).every((key) => {
    return holds(value[key], wanted[key]);
  });
}

/*
 * A query's plain values, its Includes, its Search and a JSON column's contents must
 * match, as the server would compare them. A relation filter (`openStackClouds:
 * Includes([id])`) reads the record's `<relation>Ids`.
 */
const TRAILING_S = /s$/;

function matches(modelName, record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    // A JSON column is asked key by key, as JSONColumnQuery asks it.
    if (field === "seriesLabels") {
      for (const [key, value] of Object.entries(wanted)) {
        const held = record.seriesLabels?.[key];
        if (
          value instanceof EqualToOrNull
            ? held !== undefined && held !== null && held !== value.value
            : held !== value
        ) {
          return false;
        }
      }
      continue;
    }
    if (wanted instanceof MultiSearch) {
      const value = wanted.value.toLowerCase();
      if (
        !wanted.fields.some((name) => {
          return String(record[name] ?? "")
            .toLowerCase()
            .includes(value);
        })
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof Search) {
      if (
        !String(record[field] ?? "")
          .toLowerCase()
          .includes(wanted.toString().toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof IsNull || wanted instanceof NotNull) {
      const isEmpty = record[field] === undefined || record[field] === null;
      if (isEmpty !== wanted instanceof IsNull) {
        return false;
      }
      continue;
    }
    // SQL's != finds nothing where there is no value at all.
    if (wanted instanceof NotEqual) {
      if (
        record[field] === undefined ||
        record[field] === null ||
        String(record[field]) === String(wanted.value)
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof LessThanOrEqual) {
      if (
        !record[field] ||
        new Date(record[field]).getTime() > new Date(wanted.value).getTime()
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed = new Set(
        wanted.values.map((entry) => {
          return String(plain(entry));
        }),
      );
      const relationIds = record[`${field.replace(TRAILING_S, "")}Ids`];
      if (Array.isArray(relationIds)) {
        if (
          !relationIds.some((id) => {
            return allowed.has(String(id));
          })
        ) {
          return false;
        }
        continue;
      }
      if (!allowed.has(String(plain(record[field])))) {
        return false;
      }
      continue;
    }
    const value = plain(wanted);
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      if (String(record[field] ?? "") !== String(value)) {
        return false;
      }
      continue;
    }
    if (value && value.constructor === Object) {
      if (!holds(record[field], value)) {
        return false;
      }
      continue;
    }
    if (value !== undefined && value !== null) {
      // An operator nothing here compares: a page must not pass by being ignored.
      fixture.unhandled.push({
        kind: "query",
        modelName,
        field,
        operator: value?.constructor?.name,
      });
    }
  }
  return true;
}

const SAM = {
  _id: uuid("80000000", 1),
  name: "Sam Patel",
  email: "sam@acme-cloud.example",
};
const PLATFORM_TEAM = { _id: uuid("81000000", 1), name: "Platform" };
const PRODUCTION_LABEL = {
  _id: uuid("82000000", 1),
  name: "production",
  color: new Color("#2563eb"),
  projectId: PROJECT_ID,
};

const checkRow = checkRowOf(
  params.get("checks"),
  estate.cloud._id,
  PROJECT_ID,
  LOADED_AT,
);

/*
 * What the worker would keep on the cloud, worked out from this estate's rows by the same code
 * (OpenStackCapacitySnapshot). ?capacity=none is a cloud no worker has been through yet.
 */
function withCapacity(cloud) {
  return params.get("capacity") === "none"
    ? cloud
    : {
        ...cloud,
        capacitySnapshot: buildCapacitySnapshotOf(estate.inventory, {
          scenario: params.get("capacity"),
          loadedAt: LOADED_AT,
        }),
      };
}

/*
 * What the worker would keep about the cloud's usage, by the same code (OpenStackSpendSnapshot).
 * ?spend=none is a cloud no worker has been through yet.
 */
const SPEND =
  params.get("spend") === "none"
    ? { priceList: null, snapshot: null, usage: [] }
    : buildSpendOf(estate.inventory, {
        scenario: params.get("spend"),
        waste: params.get("waste"),
        openStackCloudId: estate.cloud._id,
        loadedAt: LOADED_AT,
        observedAt: LOADED_AT,
      });

function withSpend(cloud) {
  return {
    ...cloud,
    spendSnapshot: SPEND.snapshot,
    priceList: SPEND.priceList,
  };
}

const store = {
  OpenStackProjectUsage: SPEND.usage,
  OpenStackBudget: [],
  OpenStackProjectNotice: [],
  OpenStackProjectNoticeDelivery: [],
  OpenStackCloudCheck: checkRow ? [checkRow] : [],
  // Every cloud's row has these, with these defaults, since its migration.
  OpenStackCloud: withAiAccessColumns(
    params.get("clouds") === "none"
      ? []
      : [
          withSpend(
            withCapacity(
              params.get("collection") === "Probe"
                ? probeCollectedCloud(
                    estate.cloud,
                    params.get("probe"),
                    LOADED_AT,
                  )
                : params.get("collection")
                  ? {
                      ...estate.cloud,
                      collectionMethod: params.get("collection"),
                    }
                  : estate.cloud,
            ),
          ),
          ...(params.get("archived") === "1"
            ? [
                {
                  ...estate.cloud,
                  _id: uuid("71000000", 50),
                  name: "old-lab-cloud",
                  isArchived: true,
                },
              ]
            : []),
        ],
  ),
  OpenStackCloudConnectionTest: [],
  RunnerJob: [],
  OpenStackCloudOwnerUser: [],
  OpenStackCloudOwnerTeam: [],
  OpenStackCloudOwnerRule: [],
  OpenStackCloudLabelRule: [],
  OpenStackCloudFeed: LINKED
    ? [
        {
          _id: uuid("83000000", 1),
          openStackCloudId: CLOUD_ID,
          projectId: PROJECT_ID,
          feedInfoInMarkdown:
            "**OpenStack cloud registered** when its first data arrived.",
          openStackCloudFeedEventType: "OpenStackCloudCreated",
          displayColor: new Color("#16a34a"),
          postedAt: new Date(LOADED_AT - 3 * DAY),
          createdAt: new Date(LOADED_AT - 3 * DAY),
        },
      ]
    : [],
  User: [SAM],
  Team: [PLATFORM_TEAM],
  TeamMember: [
    {
      _id: uuid("85000000", 1),
      projectId: PROJECT_ID,
      userId: SAM._id,
      user: SAM,
      teamId: PLATFORM_TEAM._id,
      team: PLATFORM_TEAM,
      hasAcceptedInvitation: true,
    },
  ],
  // What the tables of incidents, alerts and maintenance events read beside their rows.
  TableView: [],
  IncidentCustomField: [],
  IncidentNoteTemplate: [],
  IncidentOwnerUser: [],
  IncidentOwnerTeam: [],
  AlertCustomField: [],
  AlertNoteTemplate: [],
  AlertOwnerUser: [],
  AlertOwnerTeam: [],
  ScheduledMaintenanceCustomField: [],
  ScheduledMaintenanceNoteTemplate: [],
  ScheduledMaintenanceOwnerUser: [],
  ScheduledMaintenanceOwnerTeam: [],
  Probe: params.get("probes") === "many" ? PROBES : PROBES.slice(0, 1),
  OpenStackResource: estate.inventory,
  // The hosts this estate holds: what "host-of-machine" reads, and each host's own page.
  Host: otherProductsOf(estate).hosts,
  IncidentState: incidentStates,
  AlertState: alertStates,
  ScheduledMaintenanceState: [
    { _id: uuid("54000000", 1), name: "Scheduled", order: 1 },
    { _id: uuid("54000000", 2), name: "Ongoing", order: 2 },
    {
      _id: uuid("54000000", 3),
      name: "Completed",
      order: 3,
      isResolvedState: true,
      isEndedState: true,
    },
  ],
  Incident: incidents,
  Alert: alerts,
  // What a project's and a domain's owner and label rules were stored as.
  AlertOwnerRule: [],
  IncidentOwnerRule: [],
  AlertLabelRule: [],
  IncidentLabelRule: [],
  ScheduledMaintenance: scheduledMaintenances,
  Monitor: monitors,
  RecommendationDismissal: [],
  MonitorStatus: [
    {
      _id: uuid("55000000", 1),
      name: "Operational",
      isOperationalState: true,
      isOfflineState: false,
      priority: 1,
    },
    {
      _id: uuid("55000000", 2),
      name: "Offline",
      isOperationalState: false,
      isOfflineState: true,
      priority: 2,
    },
  ],
  IncidentSeverity: [criticalIncident],
  AlertSeverity: [warningAlert],
  OnCallDutyPolicy: [],
  Label: [PRODUCTION_LABEL],
  TelemetryIngestionKey: [
    {
      _id: uuid("59000000", 1),
      name: "OpenStack agent",
      secretKey: uuid("5a000000", 1),
      // A server key: the setup guide lists only those.
      keyType: "Server",
      description: "",
    },
  ],
  Service: [],
  MetricType: [],
  LogSavedView: [],
  // What the traces viewer offers to narrow by, none of which a walk here reads.
  DockerHost: [],
  PodmanHost: [],
  KubernetesCluster: [],
  TraceSavedView: [],
};

/*
 * What the driver sent for a signed boot, as this cloud's. A Service row per name, as the ingest
 * makes them, for the control plane map to name its nodes by.
 */
const serviceIdOfName = new Map();
const spanStore = TRACES
  ? spanRowsFromRecording(TRACES, {
      cloudName: estate.cloud.name,
      loadedAt: LOADED_AT,
      serviceIdOf: (name) => {
        if (!serviceIdOfName.has(name)) {
          const id = uuid("77000000", serviceIdOfName.size + 1);
          serviceIdOfName.set(name, id);
          store.Service.push({ _id: id, name: name, serviceColor: "#6366f1" });
        }
        return serviceIdOfName.get(name);
      },
    })
  : [];

function spansFor(query) {
  const trace = query?.traceId;
  const traces =
    trace && trace.values
      ? trace.values.map(String)
      : trace
        ? [String(trace)]
        : null;

  return spanStore.filter((span) => {
    if (traces && !traces.includes(span.traceId)) {
      return false;
    }
    if (query?.isEntrySpan === true && !span.isEntrySpan) {
      return false;
    }
    for (const [key, wanted] of Object.entries(query?.attributes || {})) {
      if (span.attributes[key] !== wanted) {
        return false;
      }
    }
    return true;
  });
}

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
}

// In the order the server sorts them: by each sort field, in turn.
function sortRecords(records, sort) {
  const fields = Object.entries(sort || {});
  return [...records].sort((left, right) => {
    for (const [field, order] of fields) {
      const a = left[field] ?? "";
      const b = right[field] ?? "";
      if (a !== b) {
        const ascending =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a) < String(b)
              ? -1
              : 1;
        return String(order).toLowerCase().startsWith("desc")
          ? -ascending
          : ascending;
      }
    }
    return 0;
  });
}

function rows(modelType, query, sort) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return sortRecords(
    store[name].filter((record) => {
      return matches(name, record, query);
    }),
    sort,
  ).map((record) => {
    return Object.assign(new modelType(), record);
  });
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(uuid("80000000", 1));
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-cloud.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
};
PermissionUtil.getGlobalPermissions = () => {
  return {
    _type: "UserGlobalAccessPermission",
    projectIds: [projectObjectId],
    globalPermissions: [...GLOBAL_PERMISSIONS],
  };
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectObjectId,
    permissions: rolePermissions
      .filter((permission) => {
        return !GLOBAL_PERMISSIONS.includes(permission);
      })
      .map((permission) => {
        return { _type: "UserPermission", permission, labelIds: [] };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

const SERVER_ERROR = "Something went wrong on the server. Please try again.";

function failsInventory(modelName) {
  return FAILS.has("inventory") && modelName === "OpenStackResource";
}

function failsEvents(modelName) {
  return (
    FAILS.has("events") && (modelName === "Incident" || modelName === "Alert")
  );
}

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    select: serialize(options.select),
    limit: options.limit,
    skip: options.skip,
  });

  // The instance's global probes come from an endpoint of their own.
  if (modelName === "Probe" && options.requestOptions?.overrideRequestUrl) {
    const shared = params.get("probes") === "many" ? SHARED_PROBES : [];
    return {
      data: shared.map((record) => {
        return Object.assign(new options.modelType(), record);
      }),
      count: shared.length,
      skip: 0,
      limit: options.limit || 10,
    };
  }

  if (modelName === "Monitor" && ALERTS === "denied") {
    throw new Error("You do not have permission to read monitors.");
  }
  if (failsInventory(modelName) || failsEvents(modelName)) {
    throw new Error(SERVER_ERROR);
  }
  refuseUnlessRoleMay(options.modelType, "read");

  const data = rows(options.modelType, options.query, options.sort);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  const skip = options.skip || 0;
  const limit = options.limit || 10;
  return {
    data: data.slice(skip, skip + limit),
    count: data.length,
    skip: skip,
    limit: limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (failsEvents(modelName) || failsInventory(modelName)) {
    throw new Error(SERVER_ERROR);
  }
  refuseUnlessRoleMay(options.modelType, "read");

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "count", modelName });
    return 0;
  }
  return data.length;
};

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = plain(options.id);
  fixture.itemRequests.push({
    modelName,
    id,
    select: serialize(options.select),
  });
  refuseUnlessRoleMay(options.modelType, "read");

  // A test is picked up on the first read, and has its answer on the next.
  if (modelName === "OpenStackCloudConnectionTest") {
    const test = store.OpenStackCloudConnectionTest.find((candidate) => {
      return candidate._id === id;
    });

    if (!test) {
      return null;
    }

    test.reads++;

    return Object.assign(
      new options.modelType(),
      test.reads === 1 ? { status: "Running" } : test.answer,
    );
  }

  if (!store[modelName]) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }

  const record = store[modelName].find((candidate) => {
    return candidate._id === id;
  });

  return record ? Object.assign(new options.modelType(), record) : null;
};

/*
 * ---------------------------------------------------------------------------
 * What a cloud's forms write. The rules a save is held to have tests of their own against a
 * real database (OpenStackProbeCollectionSqlPostgres), so this keeps only what a page reads
 * back: a secret goes in and never comes out, and new settings mean the probe tries again.
 * ---------------------------------------------------------------------------
 */
const connectionTestsToAnswer = (params.get("tests") || "")
  .split(",")
  .filter(Boolean);
let writeRefusal = "";

// A walk's way of having the server refuse the next save.
window.__openStackPagesRefuseNextWrite = (message) => {
  writeRefusal = message;
};

// A walk's way of having the probe report: every cloud it collects, as that collection went.
window.__openStackPagesCollect = (name) => {
  for (const cloud of store.OpenStackCloud) {
    if (cloud.collectionMethod === "Probe") {
      Object.assign(cloud, collectionOf(name, Date.now()));
    }
  }
};

function refuseWrite() {
  if (writeRefusal) {
    const message = writeRefusal;
    writeRefusal = "";
    throw new Error(message);
  }
}

let writtenRows = 0;

function writeRow(modelName, id, data) {
  if (modelName === "OpenStackCloud") {
    return writeCloud(store.OpenStackCloud, id, data, store.Probe);
  }

  // A row of a table the walks read back: only what a page reads comes back.
  if (WRITABLE_TABLES.has(modelName)) {
    const existing = store[modelName].find((candidate) => {
      return candidate._id === id;
    });
    if (existing) {
      Object.assign(existing, serialize(data));
      return existing;
    }
    writtenRows += 1;
    const created = {
      ...serialize(data),
      _id: id || uuid("84000000", writtenRows),
    };
    store[modelName].push(created);
    return created;
  }

  // A row of another table is a read the walks do not model, and they say so.
  fixture.unhandled.push({ kind: "write", modelName });
  return { _id: id };
}

const WRITABLE_TABLES = new Set([
  "OpenStackBudget",
  "OpenStackProjectNotice",
  "OpenStackCloudCheck",
  "OpenStackCloudOwnerUser",
  "OpenStackCloudOwnerTeam",
  "OpenStackCloudOwnerRule",
  "OpenStackCloudLabelRule",
]);

// What the server does on a delete: the row goes, and a cloud takes its owners with it.
ModelAPI.deleteItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = plain(options.id);
  fixture.writeRequests.push({ kind: "delete", modelName, id });
  refuseUnlessRoleMay(options.modelType, "delete");
  refuseWrite();

  if (!store[modelName]) {
    fixture.unhandled.push({ kind: "delete", modelName });
    return;
  }
  store[modelName] = store[modelName].filter((candidate) => {
    return candidate._id !== id;
  });
};

ModelAPI.create = async (options) => {
  const modelName = tableName(options.modelType);
  const data = getWrittenValues(options.model, options.modelType);
  fixture.writeRequests.push({ kind: "create", modelName, data });
  refuseUnlessRoleMay(options.modelType, "create");
  refuseWrite();

  if (modelName === "OpenStackCloudConnectionTest") {
    const id = uuid("76000000", store.OpenStackCloudConnectionTest.length + 1);
    store.OpenStackCloudConnectionTest.push({
      _id: id,
      reads: 0,
      answer: connectionTestOutcome(connectionTestsToAnswer.shift() || "ok"),
    });
    return { data: { _id: id } };
  }

  return { data: writeRow(modelName, null, data) };
};

ModelAPI.createOrUpdate = async (options) => {
  const modelName = tableName(options.modelType);
  const data = getWrittenValues(options.model, options.modelType);
  const id = data._id || null;
  fixture.writeRequests.push({
    kind: id ? "update" : "create",
    modelName,
    id,
    data,
  });
  refuseUnlessRoleMay(options.modelType, id ? "update" : "create");
  refuseWrite();

  return { data: writeRow(modelName, id, data), miscData: {} };
};

ModelAPI.updateById = async (options) => {
  const modelName = tableName(options.modelType);
  const id = plain(options.id);
  fixture.writeRequests.push({
    kind: "updateById",
    modelName,
    id,
    data: serialize(options.data),
  });
  refuseUnlessRoleMay(options.modelType, "update");
  refuseWrite();

  writeRow(modelName, id, options.data);
  return { data: {} };
};

/*
 * ---------------------------------------------------------------------------
 * Metrics, as the agent's scrape lands in ClickHouse: one series per label set, around
 * what the inventory says now, read from the rows so a chart cannot disagree with its
 * page. A worker that is down has been down since its state changed.
 *
 * A metric nothing here knows returns null and lands in `unhandled`: add a `case`.
 * ---------------------------------------------------------------------------
 */
function wantedRegion(attributes) {
  const region =
    attributes["openstack.region.name"] ||
    attributes["resource.openstack.region.name"];
  return typeof region === "string" && region ? region : null;
}

/*
 * Counts only the metric store holds. On a recording, what that cloud's exporter answered,
 * so one it never sent (ports are off by default) is not there. Made up, a few of each.
 */
const MADE_UP_COUNTS = {
  openstack_cinder_snapshots: 12,
  openstack_neutron_security_groups: 31,
};

function countSeries(metricName) {
  if (RECORDING) {
    return seriesFromRecording(RECORDING, metricName, REGION_ONE).map(
      (series) => {
        return {
          labels: series.labels,
          read: () => {
            return series.value;
          },
        };
      },
    );
  }
  const count = MADE_UP_COUNTS[metricName];
  return count === undefined
    ? []
    : [
        {
          labels: { "openstack.region.name": REGION_ONE },
          read: () => {
            return count;
          },
        },
      ];
}

/*
 * A number a part's row holds now, over time. `growsPerDay` is the estate's word for one
 * that has been climbing, and the rest have held still, which a forecast reads as such.
 */
function seriesFromRow(labels, value, growsPerDay = 0) {
  return {
    labels,
    read: (time) => {
      return value - ((LOADED_AT - time) / DAY) * growsPerDay;
    },
  };
}

/*
 * What libvirt's or Ceilometer's exporter says, as the scan writes it. A row that has no such
 * thing has no series, which is how a cloud with neither reads. Only `?estate=usage` has any.
 */
const INSTANCE_USAGE_FIELDS = {
  "openstack.instance.cpu.usage": "cpuCores",
  "openstack.instance.cpu.utilization": "cpuPercent",
  "openstack.instance.cpu.contention": "contentionPercent",
  "openstack.instance.memory.usage": "memoryUsageBytes",
  "openstack.instance.memory.resident": "memoryResidentBytes",
};
const INSTANCE_DISK_FIELDS = {
  "openstack.instance.disk.read.rate": "read",
  "openstack.instance.disk.write.rate": "write",
  "openstack.instance.disk.read.latency": "readMs",
  "openstack.instance.disk.write.latency": "writeMs",
};
const INSTANCE_INTERFACE_FIELDS = {
  "openstack.instance.network.receive.rate": "receive",
  "openstack.instance.network.transmit.rate": "transmit",
};
const HYPERVISOR_USAGE_FIELDS = {
  "openstack.hypervisor.instances.cpu.usage": "cpuCores",
  "openstack.hypervisor.instances.cpu.utilization": "cpuPercent",
  "openstack.hypervisor.instances.memory.resident": "memoryResidentBytes",
  "openstack.hypervisor.instances.memory.utilization": "memoryPercent",
  "openstack.hypervisor.instances.reporting": "reporting",
};

function usageSeries(metricName, attributes) {
  const hostname = attributes["hostname"];
  const instanceId = attributes["openstack.instance.id"];
  if (metricName.startsWith("openstack.hypervisor.instances.")) {
    return estate.inventory
      .filter((row) => {
        return (
          row.kind === "Hypervisor" &&
          row.hypervisorUsage &&
          (!hostname || row.name === hostname)
        );
      })
      .map((row) => {
        return seriesFromRow(
          {
            hostname: row.name,
            "openstack.instance.source": "libvirt",
            ...regionLabelOf(row),
          },
          row.hypervisorUsage[HYPERVISOR_USAGE_FIELDS[metricName]],
        );
      });
  }
  const out = [];
  for (const row of estate.inventory) {
    if (
      row.kind !== "Instance" ||
      !row.usage ||
      (hostname && row.hypervisorName !== hostname) ||
      (instanceId && row.externalId !== instanceId)
    ) {
      continue;
    }
    const labels = {
      "openstack.instance.id": row.externalId,
      "openstack.instance.source": "libvirt",
      hostname: row.hypervisorName,
      ...regionLabelOf(row),
    };
    const field = INSTANCE_USAGE_FIELDS[metricName];
    if (field && row.usage[field] !== undefined) {
      out.push(seriesFromRow(labels, row.usage[field]));
    }
    const devices = INSTANCE_DISK_FIELDS[metricName]
      ? [row.usage.disks, INSTANCE_DISK_FIELDS[metricName]]
      : INSTANCE_INTERFACE_FIELDS[metricName]
        ? [row.usage.interfaces, INSTANCE_INTERFACE_FIELDS[metricName]]
        : null;
    if (devices) {
      for (const [device, readings] of Object.entries(devices[0])) {
        if (readings[devices[1]] !== undefined) {
          out.push(seriesFromRow({ ...labels, device }, readings[devices[1]]));
        }
      }
    }
  }
  return out;
}

function regionLabelOf(row) {
  return { "openstack.region.name": row.regionName };
}

function seriesOf(metricName, attributes) {
  if (
    metricName.startsWith("openstack.instance.") ||
    metricName.startsWith("openstack.hypervisor.instances.")
  ) {
    return usageSeries(metricName, attributes);
  }
  const region = wantedRegion(attributes);
  const service = attributes["service"];
  const host = attributes["hostname"];
  const rowsOf = (kind, where) => {
    return estate.inventory.filter((row) => {
      return (
        row.kind === kind &&
        (!region || row.regionName === region) &&
        where(row)
      );
    });
  };
  const regionLabel = (row) => {
    return { "openstack.region.name": row.regionName };
  };
  const apiOf = (type) => {
    return estate.inventory.filter((row) => {
      return (
        row.kind === "Api" &&
        row.name === type &&
        (!region || row.regionName === region)
      );
    });
  };

  switch (metricName) {
    case "openstack_identity_up":
    case "openstack_nova_up":
    case "openstack_placement_up":
    case "openstack_neutron_up":
    case "openstack_cinder_up":
    case "openstack_glance_up": {
      const type = {
        openstack_identity_up: "identity",
        openstack_nova_up: "compute",
        openstack_placement_up: "placement",
        openstack_neutron_up: "network",
        openstack_cinder_up: "volume",
        openstack_glance_up: "image",
      }[metricName];
      return apiOf(type).map((row) => {
        return {
          labels: { "openstack.region.name": row.regionName },
          read: (time) => {
            return time >= new Date(row.stateChangedAt).getTime() &&
              row.status === "down"
              ? 0
              : 1;
          },
        };
      });
    }
    case "scrape_duration_seconds":
      return apiOf(attributes["openstack_service"]).map((row) => {
        return {
          labels: {
            "openstack.region.name": row.regionName,
            openstack_service: row.name,
          },
          read: (time) => {
            const base = row.facts?.collectionSeconds || 0.2;
            return base * (1 + 0.15 * Math.sin(time / (9 * MINUTE)));
          },
        };
      });
    case "openstack_nova_agent_state":
    case "openstack_neutron_agent_state":
    case "openstack_cinder_agent_state": {
      const family = {
        openstack_nova_agent_state: "compute",
        openstack_neutron_agent_state: "network",
        openstack_cinder_agent_state: "volume",
      }[metricName];
      return estate.inventory
        .filter((row) => {
          return (
            row.kind === "Service" &&
            row.facts?.family === family &&
            (!service || row.name === service) &&
            (!host || row.facts?.host === host) &&
            (!region || row.regionName === region)
          );
        })
        .map((row) => {
          return {
            labels: {
              hostname: row.facts.host,
              service: row.name,
              "openstack.region.name": row.regionName,
            },
            read: (time) => {
              return time >= new Date(row.stateChangedAt).getTime() &&
                row.status === "down"
                ? 0
                : 1;
            },
          };
        });
    }
    case "openstack_placement_resource_usage": {
      const units = {
        VCPU: (row) => {
          return row.vcpuAllocated;
        },
        MEMORY_MB: (row) => {
          return row.memoryAllocatedBytes / (1024 * 1024);
        },
        DISK_GB: (row) => {
          return row.diskAllocatedBytes / GIB;
        },
      };
      const type = attributes["resourcetype"];
      return rowsOf("Hypervisor", (row) => {
        return !host || row.name === host;
      }).flatMap((row) => {
        return Object.keys(units)
          .filter((unit) => {
            return !type || unit === type;
          })
          .map((unit) => {
            return seriesFromRow(
              { ...regionLabel(row), hostname: row.name, resourcetype: unit },
              units[unit](row) || 0,
            );
          });
      });
    }
    case "openstack_nova_running_vms":
      return rowsOf("Hypervisor", (row) => {
        return !host || row.name === host;
      }).map((row) => {
        return seriesFromRow(
          { ...regionLabel(row), hostname: row.name },
          row.instanceCount || 0,
        );
      });
    case "openstack_neutron_network_ip_availabilities_used":
      return rowsOf("Network", (row) => {
        return (
          !attributes["network_id"] ||
          row.externalId === attributes["network_id"]
        );
      }).flatMap((row) => {
        return Object.keys(row.facts?.ipsBySubnet || {})
          .filter((name) => {
            return (
              !attributes["cidr"] ||
              row.facts.ipsBySubnet[name].cidr === attributes["cidr"]
            );
          })
          .map((name) => {
            const subnet = row.facts.ipsBySubnet[name];
            return seriesFromRow(
              {
                ...regionLabel(row),
                network_id: row.externalId,
                network_name: row.name,
                subnet_name: name,
                cidr: subnet.cidr,
              },
              subnet.used,
              row.growsPerDay,
            );
          });
      });
    case "openstack_neutron_l3_agent_of_router":
      return rowsOf("Router", (row) => {
        return (
          !attributes["router_id"] || row.externalId === attributes["router_id"]
        );
      }).flatMap((row) => {
        const agents = row.facts?.l3Agents || {};
        return Object.keys(agents).map((agentId) => {
          return seriesFromRow(
            {
              ...regionLabel(row),
              router_id: row.externalId,
              agent_host: agents[agentId].host,
            },
            agents[agentId].isAlive ? 1 : 0,
          );
        });
      });
    case "openstack_cinder_pool_capacity_free_gb":
    case "openstack_cinder_pool_capacity_total_gb":
      return rowsOf("StoragePool", (row) => {
        return !attributes["name"] || row.name === attributes["name"];
      }).map((row) => {
        const total = (row.diskCapacityBytes || 0) / GIB;
        return metricName === "openstack_cinder_pool_capacity_total_gb"
          ? seriesFromRow({ ...regionLabel(row), name: row.name }, total)
          : seriesFromRow(
              { ...regionLabel(row), name: row.name },
              total - (row.diskAllocatedBytes || 0) / GIB,
              -(row.growsPerDay || 0),
            );
      });
    case "openstack_cinder_volume_gb":
      return rowsOf("Volume", (row) => {
        return !attributes["id"] || row.externalId === attributes["id"];
      }).map((row) => {
        return seriesFromRow(
          { ...regionLabel(row), id: row.externalId },
          (row.diskCapacityBytes || 0) / GIB,
        );
      });
    case "openstack_cinder_snapshots":
    case "openstack_neutron_security_groups":
    case "openstack_neutron_quota_security_group":
    case "openstack_neutron_ports":
      return countSeries(metricName);
    // The Host product's two, for what a hypervisor's own agent says it is doing.
    case "system.cpu.utilization":
      return [
        seriesFromRow(
          { state: attributes["state"] },
          attributes["state"] === "user" ? 0.31 : 0.09,
        ),
      ];
    case "system.memory.utilization":
      return [seriesFromRow({ state: attributes["state"] }, 0.62)];
    // The same agent's byte counters, which only ever climb.
    case "system.disk.io":
      return [
        seriesFromRow(
          { device: "sda", direction: "read" },
          5e12,
          5 * 1024 * 1024 * 86400,
        ),
        seriesFromRow(
          { device: "sda", direction: "write" },
          5e12,
          12 * 1024 * 1024 * 86400,
        ),
      ];
    case "system.network.io":
      return [
        seriesFromRow(
          { device: "eth0", direction: "receive" },
          5e12,
          30 * 1024 * 1024 * 86400,
        ),
        seriesFromRow(
          { device: "eth0", direction: "transmit" },
          5e12,
          20 * 1024 * 1024 * 86400,
        ),
      ];
    default:
      /*
       * What libvirt's or Ceilometer's exporter says about an instance. These estates name
       * neither, as most clouds don't, so a page asks and hears there are none. What a cloud
       * stands on is drawn from its rows, so those charts have nothing to add yet either.
       */
      return metricName?.startsWith("openstack.instance.") ||
        metricName?.startsWith("openstack.hypervisor.instances.") ||
        metricName?.startsWith("rabbitmq_") ||
        metricName?.startsWith("mysql_")
        ? []
        : null;
  }
}

function generateRows(aggregateBy) {
  const query = aggregateBy.query || {};
  const start = new Date(aggregateBy.startTimestamp || LOADED_AT - 30 * MINUTE);
  const end = new Date(aggregateBy.endTimestamp || LOADED_AT);
  const series = seriesOf(query.name, query.attributes || {});
  if (!series) {
    return null;
  }
  const spanMinutes = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / MINUTE),
  );
  const stepMinutes = Math.max(1, Math.ceil(spanMinutes / 60));
  const steps = Math.floor(spanMinutes / stepMinutes);
  const lastSeen = new Date(estate.cloud.lastSeenAt || 0).getTime();
  // No buckets: the server answers one row a series for the whole of the window.
  const isTotal = aggregateBy.aggregationInterval === AggregationInterval.Total;
  const out = [];
  for (const one of series) {
    const points = [];
    for (let index = 0; index <= steps; index++) {
      const time = start.getTime() + index * stepMinutes * MINUTE;
      // A quiet cloud has reported nothing since it stopped.
      if (time > lastSeen + MINUTE) {
        continue;
      }
      points.push({
        timestamp: new Date(time).toISOString(),
        value: one.read(time),
        attributes: one.labels,
      });
    }
    out.push(...(isTotal ? points.slice(-1) : points));
  }
  return out;
}

AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy;
  fixture.aggregateRequests.push({
    modelName,
    name: aggregateBy.query?.name,
    attributes: serialize(aggregateBy.query?.attributes),
    aggregationType: aggregateBy.aggregationType,
    groupBy: serialize(aggregateBy.groupBy),
  });

  if (FAILS.has("metrics")) {
    throw new Error(SERVER_ERROR);
  }

  const data = modelName.startsWith("Metric")
    ? generateRows(aggregateBy)
    : null;

  if (!data) {
    fixture.unhandled.push({
      kind: "aggregate",
      modelName,
      name: aggregateBy.query?.name,
    });
    return { data: [] };
  }

  return { data };
};

AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({ modelName, query: serialize(options.query) });

  if (serviceLogRows && modelName.startsWith("Log")) {
    return answerRows(serviceLogRows.logs, options);
  }
  if (serviceLogRows && modelName.startsWith("ChangeEvent")) {
    return answerRows(serviceLogRows.changes, options);
  }

  if (modelName.startsWith("Span")) {
    const data = spansFor(options.query).map((record) => {
      return Object.assign(new options.modelType(), record);
    });
    return {
      data: data.slice(0, options.limit || 10),
      count: data.length,
      skip: 0,
      limit: options.limit || 10,
    };
  }

  if (
    modelName.startsWith("Log") ||
    modelName.startsWith("ChangeEvent") ||
    modelName.startsWith("Metric") ||
    modelName.startsWith("SecurityEvent")
  ) {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  fixture.unhandled.push({ kind: "analytics.getList", modelName });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

AnalyticsModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  if (serviceLogRows && modelName.startsWith("Log")) {
    return answerRows(serviceLogRows.logs, options).count;
  }
  if (modelName.startsWith("Log")) {
    return 0;
  }

  fixture.unhandled.push({ kind: "analytics.count", modelName });
  return 0;
};

function ok(data) {
  return new HTTPResponse(200, data, {});
}

function statusPagePlanOf() {
  const regions = new Map();
  for (const row of estate.inventory) {
    if (row.kind === "Api") {
      const key = row.regionName || "";
      regions.set(key, {
        regionName: row.regionName || null,
        apiNames: [...(regions.get(key)?.apiNames || []), row.name],
      });
    }
  }
  const templateNames = {};
  for (const template of getAllOpenStackAlertTemplates()) {
    templateNames[template.id] = template.name;
  }
  return buildOpenStackStatusPagePlan({
    cloudName: store.OpenStackCloud[0]?.name || "cloud",
    regions: Array.from(regions.values()),
    existingMonitors: [],
    templateNames,
    isTemplateOffered: (id) => {
      return !id.endsWith("-failing") && !id.endsWith("-unreachable");
    },
  });
}

function projectRowOf(id) {
  return estate.inventory.find((row) => {
    return row.kind === "Project" && row.externalId === id;
  });
}

function answerProjectNotice(pathname, body) {
  const noticeOf = () => {
    const id = pathname.split("/").pop();
    return store.OpenStackProjectNotice.find((row) => {
      return row._id === id;
    });
  };

  if (pathname.includes("/status-page-plan/")) {
    const plan = statusPagePlanOf();
    return ok({ plan, planKey: getOpenStackStatusPagePlanKey(plan) });
  }
  if (pathname.includes("/make-status-page/")) {
    return ok({
      statusPageId: "72000000-0000-4000-8000-000000000001",
      monitorsMade: statusPagePlanOf().monitorsToMake,
    });
  }
  if (pathname.includes("/make-objectives/")) {
    return ok({ objectivesMade: 5, objectivesLeft: 0, monitorsMade: 0 });
  }
  if (pathname.includes("/project-page-plan/")) {
    const counts = new Map();
    for (const row of estate.inventory) {
      if (row.openStackProjectId === body.openStackProjectId) {
        const key = `${row.kind}|${row.regionName || ""}`;
        counts.set(key, {
          kind: row.kind,
          regionName: row.regionName || null,
          count: (counts.get(key)?.count || 0) + 1,
        });
      }
    }
    const project = projectRowOf(body.openStackProjectId);
    return ok({
      ...buildOpenStackProjectPagePlan({
        projectName: project?.name || null,
        projectId: body.openStackProjectId,
        holdings: Array.from(counts.values()),
      }),
      isProjectInCloud: Boolean(project),
    });
  }
  if (pathname.includes("/make-project-page/")) {
    return ok({
      statusPageId: "72000000-0000-4000-8000-000000000002",
      monitorsMade: 1,
    });
  }
  if (pathname.includes("/preview/")) {
    const notice = noticeOf();
    const project = projectRowOf(notice?.openStackProjectId);
    const message = writeOpenStackProjectNotice({
      event: "Incident Opened",
      projectId: notice?.openStackProjectId || "",
      projectName: project?.name || null,
      partKind: "Hypervisor",
      partWords: "A compute host",
      regionName: null,
      holdings: { instanceCount: 3 },
      occurredAt: new Date(LOADED_AT).toISOString(),
    });
    return ok({
      previewToken: "the-token-its-preview-gave",
      channel: notice?.webhookUrl ? "Webhook" : "Email",
      address: plain(notice?.email) || plain(notice?.webhookUrl) || "",
      projectId: notice?.openStackProjectId || "",
      projectName: project?.name || null,
      isProjectInCloud: Boolean(project),
      instanceCount: 3,
      example: { subject: message.subject, markdown: message.markdown },
    });
  }
  if (pathname.includes("/turn-on/")) {
    if (body.previewToken !== "the-token-its-preview-gave") {
      return new HTTPErrorResponse(
        400,
        { message: "See who this tells first" },
        {},
      );
    }
    Object.assign(noticeOf(), { isEnabled: true });
    return ok({});
  }
  if (pathname.includes("/turn-off/")) {
    Object.assign(noticeOf(), { isEnabled: false });
    return ok({});
  }
  if (pathname.includes("/who-would-be-told/")) {
    const armed = store.OpenStackProjectNotice.filter((row) => {
      return row.isEnabled;
    });
    return ok({
      summary: "3 instances in 2 projects",
      isReachKnown: true,
      ofNoProject: {},
      told: armed.map((row) => {
        return {
          projectId: row.openStackProjectId,
          name: projectRowOf(row.openStackProjectId)?.name || null,
          channel: row.webhookUrl ? "Webhook" : "Email",
          address: plain(row.email) || plain(row.webhookUrl) || "",
          instanceCount: 3,
          volumeCount: 0,
          routerCount: 0,
          floatingIpCount: 0,
        };
      }),
      notTold: [],
    });
  }
  if (pathname.includes("/maintenance-covering/")) {
    return ok({
      events:
        params.get("maintenance") === "on"
          ? [
              {
                id: "73000000-0000-4000-8000-000000000001",
                title: "Kernel upgrade",
              },
            ]
          : [],
    });
  }
  fixture.unhandled.push({ kind: "post", url: pathname });
  return ok({});
}

function failed() {
  return new HTTPErrorResponse(500, { message: SERVER_ERROR }, {});
}

function regionOfBody(body) {
  return typeof body.regionName === "string" && body.regionName
    ? body.regionName
    : null;
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  if (method === "POST") {
    if (parsed.pathname.endsWith("/resource-ai-access/status")) {
      return ok(
        getAiAccessStatus({
          aiAgent: params.get("aiAgent"),
          cloudId: body.resourceId,
          cloudName: store.OpenStackCloud[0]?.name || "",
          now: new Date(LOADED_AT).toISOString(),
        }),
      );
    }
    if (parsed.pathname.endsWith("/resource-ai-access/logs")) {
      return ok(getAiLogs());
    }
    if (parsed.pathname.endsWith("/resource-ai-access/insights")) {
      return ok(getAiInsights());
    }
    // Who is told, and what a status page would make: the real rules, over this estate.
    if (parsed.pathname.includes("/openstack-project-notice/")) {
      return answerProjectNotice(parsed.pathname, body);
    }
    if (parsed.pathname.includes("/openstack-resource/inventory-summary/")) {
      return FAILS.has("inventory")
        ? failed()
        : ok(getInventorySummary(estate.inventory, regionOfBody(body)));
    }
    if (parsed.pathname.includes("/openstack-resource/bare-metal-classes/")) {
      return FAILS.has("inventory")
        ? failed()
        : ok({
            classes: getBareMetalClasses(estate.inventory, regionOfBody(body)),
          });
    }
    if (parsed.pathname.includes("/openstack-resource/needs-attention/")) {
      if (FAILS.has("inventory") || FAILS.has("attention")) {
        return failed();
      }
      const attention = getAttentionRows(
        estate.inventory,
        regionOfBody(body),
        new Date(LOADED_AT),
      );
      addCephStatusToPools(attention.rows, otherProductsOf(estate));
      return ok(attention);
    }
    if (parsed.pathname.includes("/openstack-resource/region-summaries/")) {
      return FAILS.has("inventory") || FAILS.has("regions")
        ? failed()
        : ok({ regions: getRegionSummaries(estate.inventory) });
    }
    if (parsed.pathname.includes("/openstack-resource/top-consumers/")) {
      return FAILS.has("inventory") || FAILS.has("consumers")
        ? failed()
        : ok(getTopConsumers(estate.inventory, regionOfBody(body)));
    }
    if (parsed.pathname.includes("/openstack-resource/project-summaries/")) {
      return FAILS.has("inventory") || FAILS.has("projects")
        ? failed()
        : ok({
            summaries: getProjectSummaries(estate.inventory, body.projectIds),
            attention: getProjectAttention(
              estate.inventory,
              body.projectIds,
              new Date(LOADED_AT),
            ),
          });
    }
    if (parsed.pathname.includes("/openstack-resource/project-overview/")) {
      return FAILS.has("inventory") || FAILS.has("projects")
        ? failed()
        : ok(
            getProjectOverview(
              estate.inventory,
              body.projectId,
              new Date(LOADED_AT),
            ),
          );
    }
    if (parsed.pathname.includes("/openstack-resource/domain-summaries/")) {
      return ok({ summaries: getDomainSummaries(estate.inventory) });
    }
    if (parsed.pathname.includes("/openstack-resource/domain-projects/")) {
      return ok(getProjectIdsOfDomain(estate.inventory, body.domainId));
    }
    if (parsed.pathname.includes("/openstack-resource/topology/")) {
      return FAILS.has("inventory") || FAILS.has("topology")
        ? failed()
        : ok(getTopologyRead(estate.inventory, body.regionName));
    }
    if (parsed.pathname.includes("/openstack-resource/counts/")) {
      return FAILS.has("inventory") || FAILS.has("counts")
        ? failed()
        : ok({ rows: getCounts(estate.inventory, body.kind, body.by) });
    }
    if (parsed.pathname.includes("/openstack-resource/blast-radius/")) {
      if (FAILS.has("inventory") || FAILS.has("blast")) {
        return failed();
      }
      const part = estate.inventory.find((row) => {
        return row.kind === body.kind && row.externalId === body.externalId;
      });
      if (!part) {
        return new HTTPErrorResponse(
          404,
          { message: "That part is not in this cloud's inventory" },
          {},
        );
      }
      const radius = getBlastRadius(estate.inventory, part);
      const reach = getReachOfPart(
        estate.inventory,
        otherProductsOf(estate),
        part,
      );
      return ok(reach ? { ...radius, acrossProducts: reach } : radius);
    }
    // What the rest of OneUptime is, and where it runs: the real rules, over this estate.
    if (parsed.pathname.includes("/openstack-resource/host-of-machine/")) {
      return ok({
        host: getHostOfMachine(
          estate.inventory,
          otherProductsOf(estate),
          body.machineName,
        ),
      });
    }
    if (parsed.pathname.includes("/openstack-resource/reach-of-instance/")) {
      return ok(
        getReachOfInstance(
          estate.inventory,
          otherProductsOf(estate),
          body.instanceId,
        ),
      );
    }
    if (parsed.pathname.includes("/openstack-resource/placement-of-host/")) {
      return ok({
        placement: getPlacementOfHost(
          estate.inventory,
          otherProductsOf(estate),
          estate.cloud,
          parsed.pathname.split("/").pop(),
        ),
      });
    }
    if (
      parsed.pathname.includes(
        "/openstack-resource/placement-of-kubernetes-node/",
      )
    ) {
      return ok({
        placement: getPlacementOfKubernetesNode(
          estate.inventory,
          otherProductsOf(estate),
          estate.cloud,
          parsed.pathname.split("/").pop(),
          body.nodeName,
        ),
      });
    }
    if (
      parsed.pathname.includes(
        "/openstack-resource/magnum-cluster-of-kubernetes-cluster/",
      )
    ) {
      return ok({
        link: getMagnumClusterOfKubernetesCluster(
          estate.inventory,
          otherProductsOf(estate),
          estate.cloud,
          parsed.pathname.split("/").pop(),
        ),
      });
    }
    if (
      parsed.pathname.includes(
        "/openstack-resource/kubernetes-cluster-of-magnum-cluster/",
      )
    ) {
      return ok({
        link: getKubernetesClusterOfMagnumCluster(
          estate.inventory,
          otherProductsOf(estate),
          estate.cloud,
          body.externalId,
        ),
      });
    }
    if (parsed.pathname.includes("/openstack-resource/placement-of-service/")) {
      return ok({
        placements: getPlacementsOfService(
          estate.inventory,
          otherProductsOf(estate),
          estate.cloud,
          parsed.pathname.split("/").pop(),
        ),
      });
    }
    if (
      parsed.pathname.includes("/openstack-resource/storage-pool-ceph-confirm/")
    ) {
      fixture.writeRequests.push({
        kind: "storage-pool-ceph-confirm",
        data: serialize(body),
      });
      return answerStoragePoolCeph(
        estate.inventory,
        body.externalId,
        body,
        LOADED_AT,
      )
        ? ok({})
        : new HTTPErrorResponse(
            404,
            {
              message: "That pool or that Ceph cluster is not in this project",
            },
            {},
          );
    }
    if (parsed.pathname.includes("/openstack-resource/storage-pool-ceph/")) {
      const answer = getStoragePoolCeph(
        estate.inventory,
        otherProductsOf(estate),
        body.externalId,
      );
      return answer
        ? ok(answer)
        : new HTTPErrorResponse(
            404,
            { message: "That pool is not in this cloud's inventory" },
            {},
          );
    }
    // The Hosts product's row for a machine, under its short name as the agent reports it.
    if (parsed.pathname.includes("/openstack-resource/host-of-machine/")) {
      const shortName = String(body.machineName || "").split(".")[0];
      return ok({
        host:
          store.Host.find((host) => {
            return host.hostIdentifier === shortName;
          }) || null,
      });
    }
    // Nothing of another product's is on these estates' instances.
    if (parsed.pathname.includes("/openstack-resource/reach-of-instance/")) {
      return ok({});
    }
    // A project with no Ceph cluster, so there is nothing to link a pool to.
    if (parsed.pathname.includes("/openstack-resource/storage-pool-ceph/")) {
      return ok({
        link: {
          state: "no-clusters",
          clusterId: null,
          clusterName: null,
          cephPoolName: null,
        },
        clusters: [],
        health: null,
        capacityUsedPercent: null,
      });
    }
    // A project that does not use Security Events: the card draws nothing.
    if (parsed.pathname.endsWith("/security-case/resource-security")) {
      return ok({
        kind: body.kind,
        id: body.id,
        name: estate.cloud.name,
        isInUse: false,
        windowDays: 7,
        values: [],
      });
    }
    // A cloud's Traces: what the viewer offers, none of which a walk here narrows by.
    if (parsed.pathname.endsWith("/telemetry/traces/get-attributes")) {
      return ok({ attributes: ["resource.openstack.cloud.name"] });
    }
    if (parsed.pathname.endsWith("/telemetry/traces/histogram")) {
      return ok({ buckets: [] });
    }
    if (parsed.pathname.endsWith("/telemetry/traces/facets")) {
      return ok({ facets: {} });
    }
    // A part's Metrics: the metric catalog it reads.
    // The fixture holds no logs, and what it is asked for is what a walk reads.
    if (parsed.pathname.endsWith("/telemetry/logs/histogram")) {
      return ok({ buckets: [] });
    }
    if (parsed.pathname.endsWith("/telemetry/logs/facets")) {
      return ok({ facets: {} });
    }
    if (parsed.pathname.endsWith("/telemetry/logs/get-attributes")) {
      return ok({ attributes: [] });
    }
    if (parsed.pathname.endsWith("/telemetry/metrics/get-attributes")) {
      return ok({
        attributes: [
          "resource.openstack.cloud.name",
          "openstack.region.name",
          "hostname",
          "service",
        ],
      });
    }
  }

  fixture.unhandled.push({ kind: "api", method, url: parsed.pathname });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

function subscribe() {
  return () => {};
}
Realtime.listenToAnalyticsModelEvent = subscribe;
Realtime.listenToModelEvent = subscribe;

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
    fa: { translation: fa },
    ar: { translation: ar },
  },
  interpolation: { escapeValue: false },
});
followLanguageForDates(i18next);
// <html lang> and <html dir> follow the language, as the Dashboard's do.
followLanguageForPage(i18next);

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: RouteMap[pageKey],
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function withNavigation(Component, pageKey) {
  return function NavigatedPage() {
    useNavigationHooks();
    return <Component {...pageProps(pageKey)} />;
  };
}

const PAGES = [
  [PageMap.OPENSTACK_CLOUD_VIEW, CloudOverview],
  [PageMap.OPENSTACK_CLOUD_VIEW_AI_INSIGHTS, CloudAiInsights],
  [PageMap.OPENSTACK_CLOUD_VIEW_AI_LOGS, CloudAiLogs],
  [PageMap.OPENSTACK_CLOUD_VIEW_AI_AGENT, CloudAiAgent],
  [PageMap.OPENSTACK_CLOUD_VIEW_CAPACITY, CloudCapacity],
  [PageMap.OPENSTACK_CLOUD_VIEW_SPEND, CloudSpend],
  [PageMap.OPENSTACK_CLOUD_VIEW_STATUS_PAGES, CloudStatusPages],
  [PageMap.OPENSTACK_CLOUD_VIEW_SERVICES, CloudServices],
  [PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL, CloudServiceDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS, CloudHypervisors],
  [PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL, CloudHypervisorDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES, CloudInstances],
  [PageMap.OPENSTACK_CLOUD_VIEW_INSTANCE_DETAIL, CloudInstanceDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES, CloudAvailabilityZones],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONE_DETAIL,
    CloudAvailabilityZoneDetail,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATES, CloudAggregates],
  [PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATE_DETAIL, CloudAggregateDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS, CloudFlavors],
  [PageMap.OPENSTACK_CLOUD_VIEW_FLAVOR_DETAIL, CloudFlavorDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS, CloudNetworks],
  [PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_DETAIL, CloudNetworkDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS, CloudSubnets],
  [PageMap.OPENSTACK_CLOUD_VIEW_SUBNET_DETAIL, CloudSubnetDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS, CloudRouters],
  [PageMap.OPENSTACK_CLOUD_VIEW_ROUTER_DETAIL, CloudRouterDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS, CloudFloatingIps],
  [PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODES, CloudBareMetalNodes],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODE_DETAIL,
    CloudBareMetalNodeDetail,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IP_DETAIL, CloudFloatingIpDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS, CloudNetworkAgents],
  [PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL, CloudNetworkAgentDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES, CloudVolumes],
  [PageMap.OPENSTACK_CLOUD_VIEW_VOLUME_DETAIL, CloudVolumeDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS, CloudSnapshots],
  [PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS, CloudStoragePools],
  [PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOL_DETAIL, CloudStoragePoolDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_IMAGES, CloudImages],
  [PageMap.OPENSTACK_CLOUD_VIEW_IMAGE_DETAIL, CloudImageDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_DNS_ZONES, CloudDnsZones],
  [PageMap.OPENSTACK_CLOUD_VIEW_DNS_ZONE_DETAIL, CloudDnsZoneDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_OBJECT_CONTAINERS, CloudObjectContainers],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_OBJECT_CONTAINER_DETAIL,
    CloudObjectContainerDetail,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_DATABASE_INSTANCES, CloudDatabaseInstances],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_DATABASE_INSTANCE_DETAIL,
    CloudDatabaseInstanceDetail,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_SHARES, CloudShares],
  [PageMap.OPENSTACK_CLOUD_VIEW_SHARE_DETAIL, CloudShareDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_LOAD_BALANCERS, CloudLoadBalancers],
  [PageMap.OPENSTACK_CLOUD_VIEW_LOAD_BALANCER_DETAIL, CloudLoadBalancerDetail],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_LOAD_BALANCER_POOL_DETAIL,
    CloudLoadBalancerPoolDetail,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_AMPHORA_DETAIL, CloudAmphoraDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_STACKS, CloudStacks],
  [PageMap.OPENSTACK_CLOUD_VIEW_STACK_DETAIL, CloudStackDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTERS, CloudContainerClusters],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTER_DETAIL,
    CloudContainerClusterDetail,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS, CloudProjects],
  [PageMap.OPENSTACK_CLOUD_VIEW_PROJECT_DETAIL, CloudProjectDetail],
  [PageMap.OPENSTACK_CLOUD_VIEW_DOMAINS, CloudDomains],
  [PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE, CloudControlPlane],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE_DEPENDENCY,
    CloudControlPlaneDependency,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_TOPOLOGY, CloudTopology],
  [PageMap.OPENSTACK_CLOUD_VIEW_METRICS, CloudMetrics],
  [PageMap.OPENSTACK_CLOUD_VIEW_LOGS, CloudLogs],
  [PageMap.OPENSTACK_CLOUD_VIEW_TRACES, CloudTraces],
  [PageMap.OPENSTACK_CLOUD_VIEW_CHECKS, CloudChecks],
  [PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS, CloudIncidents],
  [PageMap.OPENSTACK_CLOUD_VIEW_ALERTS, CloudAlerts],
  [
    PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE,
    CloudScheduledMaintenance,
  ],
  [PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS, CloudRecommendations],
  [PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION, CloudDocumentation],
  [PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS, CloudSettings],
  [PageMap.OPENSTACK_CLOUD_VIEW_OWNERS, CloudOwners],
  [PageMap.OPENSTACK_CLOUD_VIEW_DELETE, CloudDelete],
  [PageMap.OPENSTACK_CLOUD_VIEW_FEED, CloudFeed],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const FixtureLayout = withNavigation(CloudLayout, PageMap.OPENSTACK_CLOUD_VIEW);
const FixtureCloudsList = withNavigation(CloudsList, PageMap.OPENSTACK_CLOUDS);
const FixtureArchived = withNavigation(
  CloudsArchived,
  PageMap.OPENSTACK_ARCHIVED,
);
const FixtureOwnerRules = withNavigation(
  OwnerRules,
  PageMap.OPENSTACK_SETTINGS_OWNER_RULES,
);
const FixtureLabelRules = withNavigation(
  LabelRules,
  PageMap.OPENSTACK_SETTINGS_LABEL_RULES,
);

/*
 * The places another product's page draws a cloud's card: the real card, on a page that is
 * otherwise not modelled here. Those pages' own fixtures hold that each really mounts it
 * (HostPages, KubernetesPages, ResourceOverviews).
 */
function otherProductPage(testId, drawCard) {
  return function OtherProductPage() {
    useNavigationHooks();
    const location = useLocation();
    return (
      <main className="mx-auto max-w-3xl px-4 py-8" data-testid={testId}>
        <p
          data-testid="stub-page"
          className="mb-6 break-all font-mono text-sm text-gray-600"
        >
          {location.pathname}
        </p>
        {drawCard(location.pathname.split("/"))}
      </main>
    );
  };
}

const OTHER_PRODUCT_PAGES = [
  [
    PageMap.HOST_VIEW,
    otherProductPage("other-product-host", (path) => {
      return (
        <OpenStackPlacementOfHost
          hostId={new ObjectID(path[path.length - 1])}
        />
      );
    }),
  ],
  [
    PageMap.SERVICE_VIEW,
    otherProductPage("other-product-service", (path) => {
      return (
        <OpenStackPlacementOfService
          serviceId={new ObjectID(path[path.length - 1])}
        />
      );
    }),
  ],
  [
    PageMap.KUBERNETES_CLUSTER_VIEW,
    otherProductPage("other-product-kubernetes-cluster", (path) => {
      return (
        <OpenStackPlacementOfKubernetesCluster
          clusterId={new ObjectID(path[path.length - 1])}
        />
      );
    }),
  ],
  [
    PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
    otherProductPage("other-product-kubernetes-node", (path) => {
      return (
        <OpenStackPlacementOfKubernetesNode
          clusterId={new ObjectID(path[path.length - 3])}
          nodeName={path[path.length - 1]}
        />
      );
    }),
  ],
].map(([pageKey, Page]) => {
  return { path: RouteMap[pageKey].toString(), Page };
});

// A page the views link to that is not modelled: says where it is.
function StubPage() {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Cloud</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route
          path={RouteMap[PageMap.OPENSTACK_CLOUDS].toString()}
          element={<FixtureCloudsList />}
        />
        <Route
          path={RouteMap[PageMap.OPENSTACK_ARCHIVED].toString()}
          element={<FixtureArchived />}
        />
        <Route
          path={RouteMap[PageMap.OPENSTACK_SETTINGS_OWNER_RULES].toString()}
          element={<FixtureOwnerRules />}
        />
        <Route
          path={RouteMap[PageMap.OPENSTACK_SETTINGS_LABEL_RULES].toString()}
          element={<FixtureLabelRules />}
        />
        <Route element={<FixtureLayout />}>
          {PAGES.map((page) => {
            return (
              <Route key={page.path} path={page.path} element={<page.Page />} />
            );
          })}
        </Route>
        {OTHER_PRODUCT_PAGES.map((page) => {
          return (
            <Route key={page.path} path={page.path} element={<page.Page />} />
          );
        })}
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
