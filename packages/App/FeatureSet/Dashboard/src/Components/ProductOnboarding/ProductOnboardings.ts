import Route from "Common/Types/API/Route";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import {
  OnboardedProductKey,
  ProductKey,
  ProductOnboarding,
} from "./ProductOnboarding";
import {
  ALERTS_SHOWCASE,
  INCIDENTS_SHOWCASE,
  MONITORS_SHOWCASE,
  ON_CALL_SHOWCASE,
  SCHEDULED_MAINTENANCE_SHOWCASE,
  SLOS_SHOWCASE,
  STATUS_PAGES_SHOWCASE,
} from "./Showcases/EssentialsShowcases";
import {
  DATA_OBSERVABILITY_SHOWCASE,
  EXCEPTIONS_SHOWCASE,
  LLM_SHOWCASE,
  LOGS_SHOWCASE,
  METRICS_SHOWCASE,
  PROFILES_SHOWCASE,
  SERVICES_SHOWCASE,
  TOPOLOGY_SHOWCASE,
  TRACES_SHOWCASE,
} from "./Showcases/ObservabilityShowcases";
import {
  AI_INSIGHTS_SHOWCASE,
  CODE_SHOWCASE,
  DATA_SECURITY_SHOWCASE,
  SECURITY_EVENTS_SHOWCASE,
} from "./Showcases/SecurityAiCodeShowcases";
import {
  DASHBOARDS_SHOWCASE,
  FORMS_SHOWCASE,
  INVENTORY_SHOWCASE,
  NETWORK_SHOWCASE,
  RUNBOOKS_SHOWCASE,
  WORKFLOWS_SHOWCASE,
} from "./Showcases/InventoryAutomationShowcases";
import CEPH_CLUSTER_SHOWCASE from "../Ceph/CephClusterShowcase";
import CLOUD_ENVIRONMENT_SHOWCASE from "../Cloud/CloudEnvironmentShowcase";
import CLOUD_SHOWCASE from "../Cloud/CloudShowcase";
import DATABASE_SHOWCASE from "../DatabaseServer/DatabaseShowcase";
import DOCKER_HOST_SHOWCASE from "../Docker/DockerHostShowcase";
import DOCKER_SWARM_CLUSTER_SHOWCASE from "../DockerSwarm/DockerSwarmClusterShowcase";
import HOST_SHOWCASE from "../Host/HostShowcase";
import IOT_FLEET_SHOWCASE from "../IoT/IoTFleetShowcase";
import KUBERNETES_CLUSTER_SHOWCASE from "../Kubernetes/KubernetesClusterShowcase";
import MESSAGE_QUEUE_SHOWCASE from "../MessageQueue/MessageQueueShowcase";
import OPENSTACK_CLOUD_SHOWCASE from "../OpenStack/OpenStackCloudShowcase";
import PODMAN_HOST_SHOWCASE from "../Podman/PodmanHostShowcase";
import PROXMOX_CLUSTER_SHOWCASE from "../Proxmox/ProxmoxClusterShowcase";
import RUM_APPLICATION_SHOWCASE from "../Rum/RumApplicationShowcase";
import SERVERLESS_FUNCTION_SHOWCASE from "../Serverless/ServerlessFunctionShowcase";
import STORAGE_ARRAY_SHOWCASE from "../StorageArray/StorageArrayShowcase";
import VMWARE_VCENTER_SHOWCASE from "../VMware/VMwareVCenterShowcase";

/*
 * Every product's explanation (ProductOnboarding.ts): the page the products
 * menu opens for it, its name, its showcase and its documentation. The
 * resources keep the showcases their empty lists already draw.
 */

const docs: (path: string) => Route = (path: string): Route => {
  return new Route(`/docs/${path}`);
};

export const PRODUCT_ONBOARDINGS: Record<
  OnboardedProductKey,
  ProductOnboarding
> = {
  [ProductKey.Monitors]: {
    page: PageMap.MONITORS,
    name: translationKey("Monitors"),
    showcase: MONITORS_SHOWCASE,
    docsRoute: docs("monitor/create-monitor"),
    guideRoute: docs("guides/website-down"),
  },
  [ProductKey.Incidents]: {
    page: PageMap.INCIDENTS,
    name: translationKey("Incidents"),
    showcase: INCIDENTS_SHOWCASE,
    docsRoute: docs("incidents/index"),
  },
  [ProductKey.Alerts]: {
    page: PageMap.ALERTS,
    name: translationKey("Alerts"),
    showcase: ALERTS_SHOWCASE,
    docsRoute: docs("alerts/index"),
  },
  [ProductKey.OnCall]: {
    page: PageMap.ON_CALL_DUTY,
    name: translationKey("On-Call"),
    showcase: ON_CALL_SHOWCASE,
    docsRoute: docs("on-call/index"),
    guideRoute: docs("guides/paging"),
  },
  [ProductKey.StatusPages]: {
    page: PageMap.STATUS_PAGES,
    name: translationKey("Status Pages"),
    showcase: STATUS_PAGES_SHOWCASE,
    docsRoute: docs("status-pages/index"),
    guideRoute: docs("guides/status-page"),
  },
  [ProductKey.ScheduledMaintenance]: {
    page: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
    name: translationKey("Scheduled Maintenance"),
    showcase: SCHEDULED_MAINTENANCE_SHOWCASE,
    docsRoute: docs("scheduled-maintenance/index"),
  },
  [ProductKey.Slos]: {
    page: PageMap.SLOS,
    name: translationKey("SLOs"),
    showcase: SLOS_SHOWCASE,
    docsRoute: docs("slo/introduction"),
  },
  [ProductKey.Logs]: {
    page: PageMap.LOGS,
    name: translationKey("Logs"),
    showcase: LOGS_SHOWCASE,
    docsRoute: docs("telemetry/logs-explorer"),
  },
  [ProductKey.Metrics]: {
    page: PageMap.METRICS,
    name: translationKey("Metrics"),
    showcase: METRICS_SHOWCASE,
    docsRoute: docs("telemetry/metrics-explorer"),
  },
  [ProductKey.Traces]: {
    page: PageMap.TRACES,
    name: translationKey("Traces"),
    showcase: TRACES_SHOWCASE,
    docsRoute: docs("telemetry/traces-explorer"),
  },
  [ProductKey.Profiles]: {
    page: PageMap.PROFILES,
    name: translationKey("Profiles"),
    showcase: PROFILES_SHOWCASE,
    docsRoute: docs("telemetry/profiles"),
  },
  [ProductKey.Exceptions]: {
    page: PageMap.EXCEPTIONS,
    name: translationKey("Exceptions"),
    showcase: EXCEPTIONS_SHOWCASE,
    docsRoute: docs("telemetry/exceptions"),
  },
  [ProductKey.Llm]: {
    page: PageMap.LLM,
    name: translationKey("AI / LLM"),
    showcase: LLM_SHOWCASE,
    docsRoute: docs("telemetry/ai-llm-observability"),
  },
  [ProductKey.DataObservability]: {
    page: PageMap.DATA_OBSERVABILITY_OVERVIEW,
    name: translationKey("Data Observability"),
    showcase: DATA_OBSERVABILITY_SHOWCASE,
    docsRoute: docs("data-observability/index"),
  },
  [ProductKey.Topology]: {
    page: PageMap.TOPOLOGY,
    name: translationKey("Topology"),
    showcase: TOPOLOGY_SHOWCASE,
    docsRoute: docs("telemetry/topology"),
  },
  [ProductKey.SecurityEvents]: {
    page: PageMap.SECURITY_EVENTS_OVERVIEW,
    name: translationKey("Security Events"),
    showcase: SECURITY_EVENTS_SHOWCASE,
    docsRoute: docs("telemetry/security-getting-started"),
  },
  [ProductKey.DataSecurity]: {
    page: PageMap.DATA_SECURITY_OVERVIEW,
    name: translationKey("Data Security"),
    showcase: DATA_SECURITY_SHOWCASE,
    docsRoute: docs("data-security/index"),
  },
  [ProductKey.AIInsights]: {
    page: PageMap.AI_INSIGHTS,
    name: translationKey("Insights"),
    showcase: AI_INSIGHTS_SHOWCASE,
    docsRoute: docs("ai/ai-sre"),
  },
  [ProductKey.Code]: {
    page: PageMap.CODE,
    name: translationKey("Code"),
    showcase: CODE_SHOWCASE,
    docsRoute: docs("ai/github-app"),
  },
  [ProductKey.Inventory]: {
    page: PageMap.INVENTORY,
    name: translationKey("Inventory"),
    showcase: INVENTORY_SHOWCASE,
    docsRoute: docs("inventory/overview"),
  },
  [ProductKey.Services]: {
    page: PageMap.SERVICES,
    name: translationKey("Services"),
    showcase: SERVICES_SHOWCASE,
    docsRoute: docs("telemetry/services"),
  },
  [ProductKey.Databases]: {
    page: PageMap.DATABASE_SERVERS,
    name: translationKey("Databases"),
    showcase: DATABASE_SHOWCASE,
    docsRoute: docs("telemetry/databases"),
  },
  [ProductKey.Queues]: {
    page: PageMap.MESSAGE_QUEUES,
    name: translationKey("Queues"),
    showcase: MESSAGE_QUEUE_SHOWCASE,
    docsRoute: docs("telemetry/queues"),
  },
  [ProductKey.Rum]: {
    page: PageMap.RUM_APPLICATIONS,
    name: translationKey("Real User Monitoring"),
    showcase: RUM_APPLICATION_SHOWCASE,
    docsRoute: docs("rum/index"),
  },
  [ProductKey.Hosts]: {
    page: PageMap.HOSTS,
    name: translationKey("Hosts"),
    showcase: HOST_SHOWCASE,
    docsRoute: docs("telemetry/hosts"),
  },
  [ProductKey.Kubernetes]: {
    page: PageMap.KUBERNETES_CLUSTERS,
    name: translationKey("Kubernetes"),
    showcase: KUBERNETES_CLUSTER_SHOWCASE,
    docsRoute: docs("telemetry/kubernetes-agent"),
  },
  [ProductKey.Docker]: {
    page: PageMap.DOCKER_HOSTS,
    name: translationKey("Docker"),
    showcase: DOCKER_HOST_SHOWCASE,
    docsRoute: docs("telemetry/docker-host"),
  },
  [ProductKey.DockerSwarm]: {
    page: PageMap.DOCKER_SWARM_CLUSTERS,
    name: translationKey("Docker Swarm"),
    showcase: DOCKER_SWARM_CLUSTER_SHOWCASE,
    docsRoute: docs("telemetry/docker-swarm"),
  },
  [ProductKey.Podman]: {
    page: PageMap.PODMAN_HOSTS,
    name: translationKey("Podman"),
    showcase: PODMAN_HOST_SHOWCASE,
    docsRoute: docs("telemetry/podman-host"),
  },
  [ProductKey.Proxmox]: {
    page: PageMap.PROXMOX_CLUSTERS,
    name: translationKey("Proxmox"),
    showcase: PROXMOX_CLUSTER_SHOWCASE,
    docsRoute: docs("telemetry/proxmox"),
  },
  [ProductKey.OpenStack]: {
    page: PageMap.OPENSTACK_CLOUDS,
    name: translationKey("OpenStack"),
    showcase: OPENSTACK_CLOUD_SHOWCASE,
    docsRoute: docs("telemetry/openstack"),
  },
  [ProductKey.VMware]: {
    page: PageMap.VMWARE_VCENTERS,
    name: translationKey("VMware"),
    showcase: VMWARE_VCENTER_SHOWCASE,
    docsRoute: docs("telemetry/vmware"),
  },
  [ProductKey.Ceph]: {
    page: PageMap.CEPH_CLUSTERS,
    name: translationKey("Ceph"),
    showcase: CEPH_CLUSTER_SHOWCASE,
    docsRoute: docs("telemetry/ceph"),
  },
  [ProductKey.StorageArrays]: {
    page: PageMap.STORAGE_ARRAYS,
    name: translationKey("Storage Arrays"),
    showcase: STORAGE_ARRAY_SHOWCASE,
    docsRoute: docs("telemetry/storage-arrays"),
  },
  [ProductKey.Network]: {
    page: PageMap.NETWORK_OVERVIEW,
    name: translationKey("Network"),
    showcase: NETWORK_SHOWCASE,
    docsRoute: docs("monitor/network-device-monitor"),
  },
  [ProductKey.IoT]: {
    page: PageMap.IOT_FLEETS,
    name: translationKey("IoT"),
    showcase: IOT_FLEET_SHOWCASE,
    docsRoute: docs("telemetry/iot-devices"),
  },
  [ProductKey.Cloud]: {
    page: PageMap.CLOUD_OVERVIEW,
    name: translationKey("Cloud"),
    showcase: CLOUD_SHOWCASE,
    docsRoute: docs("telemetry/cloud-accounts"),
  },
  [ProductKey.AppPlatforms]: {
    page: PageMap.APP_PLATFORMS_OVERVIEW,
    name: translationKey("App Platforms"),
    showcase: CLOUD_ENVIRONMENT_SHOWCASE,
    docsRoute: docs("telemetry/cloud-environments"),
  },
  [ProductKey.Serverless]: {
    page: PageMap.SERVERLESS_FUNCTIONS,
    name: translationKey("Serverless"),
    showcase: SERVERLESS_FUNCTION_SHOWCASE,
    docsRoute: docs("telemetry/serverless-functions"),
  },
  [ProductKey.Dashboards]: {
    page: PageMap.DASHBOARDS,
    name: translationKey("Dashboards"),
    showcase: DASHBOARDS_SHOWCASE,
    docsRoute: docs("dashboards/index"),
  },
  [ProductKey.Workflows]: {
    page: PageMap.WORKFLOWS,
    name: translationKey("Workflows"),
    showcase: WORKFLOWS_SHOWCASE,
    docsRoute: docs("workflows/index"),
  },
  [ProductKey.Runbooks]: {
    page: PageMap.RUNBOOKS,
    name: translationKey("Runbooks"),
    showcase: RUNBOOKS_SHOWCASE,
    docsRoute: docs("runbooks/index"),
  },
  [ProductKey.Forms]: {
    page: PageMap.FORMS,
    name: translationKey("Forms"),
    showcase: FORMS_SHOWCASE,
    docsRoute: docs("forms/index"),
  },
};

export function getProductOnboarding(
  product: OnboardedProductKey,
): ProductOnboarding {
  return PRODUCT_ONBOARDINGS[product];
}
