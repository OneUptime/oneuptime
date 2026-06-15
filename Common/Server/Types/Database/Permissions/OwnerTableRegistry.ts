import AlertOwnerTeamService from "../../../Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Services/AlertOwnerUserService";
import DashboardOwnerTeamService from "../../../Services/DashboardOwnerTeamService";
import DashboardOwnerUserService from "../../../Services/DashboardOwnerUserService";
import IncidentOwnerTeamService from "../../../Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Services/IncidentOwnerUserService";
import MonitorOwnerTeamService from "../../../Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Services/MonitorOwnerUserService";
import OnCallDutyPolicyOwnerTeamService from "../../../Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Services/OnCallDutyPolicyOwnerUserService";
import RunbookOwnerTeamService from "../../../Services/RunbookOwnerTeamService";
import RunbookOwnerUserService from "../../../Services/RunbookOwnerUserService";
import ScheduledMaintenanceOwnerTeamService from "../../../Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../../Services/ScheduledMaintenanceOwnerUserService";
import ServiceOwnerTeamService from "../../../Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../Services/ServiceOwnerUserService";
import HostOwnerTeamService from "../../../Services/HostOwnerTeamService";
import HostOwnerUserService from "../../../Services/HostOwnerUserService";
import DockerHostOwnerTeamService from "../../../Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "../../../Services/DockerHostOwnerUserService";
import PodmanHostOwnerTeamService from "../../../Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "../../../Services/PodmanHostOwnerUserService";
import KubernetesClusterOwnerTeamService from "../../../Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "../../../Services/KubernetesClusterOwnerUserService";
import ServerlessFunctionOwnerTeamService from "../../../Services/ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "../../../Services/ServerlessFunctionOwnerUserService";
import CloudResourceOwnerTeamService from "../../../Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "../../../Services/CloudResourceOwnerUserService";
import RumApplicationOwnerTeamService from "../../../Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "../../../Services/RumApplicationOwnerUserService";
import StatusPageOwnerTeamService from "../../../Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "../../../Services/StatusPageOwnerUserService";
import WorkflowOwnerTeamService from "../../../Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "../../../Services/WorkflowOwnerUserService";
/*
 * The resources whose ids can appear in a telemetry row's polymorphic
 * serviceId also expose their own service (for label-scope resolution).
 * Imported here so the registry is the single source of truth for the
 * telemetry serviceId polymorphism — see canOwnTelemetry / modelService.
 */
import ServiceService from "../../../Services/ServiceService";
import MonitorService from "../../../Services/MonitorService";
import HostService from "../../../Services/HostService";
import DockerHostService from "../../../Services/DockerHostService";
import PodmanHostService from "../../../Services/PodmanHostService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import ServerlessFunctionService from "../../../Services/ServerlessFunctionService";
import CloudResourceService from "../../../Services/CloudResourceService";
import RumApplicationService from "../../../Services/RumApplicationService";

/*
 * Maps an operational model name (e.g. "Monitor") to the two services that
 * hold its ownership rows plus the FK column those services use to point at
 * the parent resource. The `Owned` permission scope reads from these to
 * compute which resource IDs the requesting user can act on.
 *
 * Nested models (those decorated with @OwnedThrough) resolve ownership
 * through their parent, so this registry only needs entries for the
 * canonical operational roots.
 */
export interface OwnerTablePair {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ownerUserService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ownerTeamService: any;
  fkColumn: string;
  /*
   * True when a telemetry row's serviceId (polymorphic, discriminated by
   * serviceType) can reference this resource type. The analytics
   * owned/labels scope resolution iterates the entries flagged here, so
   * the telemetry serviceId polymorphism lives only in this registry —
   * adding a new telemetry-owning resource needs just an entry here, with
   * no edits in ModelPermission.
   */
  canOwnTelemetry?: boolean;
  /*
   * The resource's own service, used by labels-scope resolution to find
   * resources whose labels match the user's. Set for canOwnTelemetry
   * types (they all carry labels).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelService?: any;
}

const ownerTableRegistry: Map<string, OwnerTablePair> = new Map<
  string,
  OwnerTablePair
>([
  [
    "Monitor",
    {
      ownerUserService: MonitorOwnerUserService,
      ownerTeamService: MonitorOwnerTeamService,
      fkColumn: "monitorId",
      canOwnTelemetry: true,
      modelService: MonitorService,
    },
  ],
  [
    "Incident",
    {
      ownerUserService: IncidentOwnerUserService,
      ownerTeamService: IncidentOwnerTeamService,
      fkColumn: "incidentId",
    },
  ],
  [
    "Alert",
    {
      ownerUserService: AlertOwnerUserService,
      ownerTeamService: AlertOwnerTeamService,
      fkColumn: "alertId",
    },
  ],
  [
    "StatusPage",
    {
      ownerUserService: StatusPageOwnerUserService,
      ownerTeamService: StatusPageOwnerTeamService,
      fkColumn: "statusPageId",
    },
  ],
  [
    "Dashboard",
    {
      ownerUserService: DashboardOwnerUserService,
      ownerTeamService: DashboardOwnerTeamService,
      fkColumn: "dashboardId",
    },
  ],
  [
    "OnCallDutyPolicy",
    {
      ownerUserService: OnCallDutyPolicyOwnerUserService,
      ownerTeamService: OnCallDutyPolicyOwnerTeamService,
      fkColumn: "onCallDutyPolicyId",
    },
  ],
  [
    "Runbook",
    {
      ownerUserService: RunbookOwnerUserService,
      ownerTeamService: RunbookOwnerTeamService,
      fkColumn: "runbookId",
    },
  ],
  [
    "ScheduledMaintenance",
    {
      ownerUserService: ScheduledMaintenanceOwnerUserService,
      ownerTeamService: ScheduledMaintenanceOwnerTeamService,
      fkColumn: "scheduledMaintenanceId",
    },
  ],
  [
    "Service",
    {
      ownerUserService: ServiceOwnerUserService,
      ownerTeamService: ServiceOwnerTeamService,
      // FK column on the Postgres ServiceOwnerUser/Team tables, not the ClickHouse telemetry column.
      fkColumn: "serviceId",
      canOwnTelemetry: true,
      modelService: ServiceService,
    },
  ],
  [
    "Host",
    {
      ownerUserService: HostOwnerUserService,
      ownerTeamService: HostOwnerTeamService,
      fkColumn: "hostId",
      canOwnTelemetry: true,
      modelService: HostService,
    },
  ],
  [
    "DockerHost",
    {
      ownerUserService: DockerHostOwnerUserService,
      ownerTeamService: DockerHostOwnerTeamService,
      fkColumn: "dockerHostId",
      canOwnTelemetry: true,
      modelService: DockerHostService,
    },
  ],
  [
    "PodmanHost",
    {
      ownerUserService: PodmanHostOwnerUserService,
      ownerTeamService: PodmanHostOwnerTeamService,
      fkColumn: "podmanHostId",
      canOwnTelemetry: true,
      modelService: PodmanHostService,
    },
  ],
  [
    "KubernetesCluster",
    {
      ownerUserService: KubernetesClusterOwnerUserService,
      ownerTeamService: KubernetesClusterOwnerTeamService,
      fkColumn: "kubernetesClusterId",
      canOwnTelemetry: true,
      modelService: KubernetesClusterService,
    },
  ],
  [
    "ServerlessFunction",
    {
      ownerUserService: ServerlessFunctionOwnerUserService,
      ownerTeamService: ServerlessFunctionOwnerTeamService,
      fkColumn: "serverlessFunctionId",
      canOwnTelemetry: true,
      modelService: ServerlessFunctionService,
    },
  ],
  [
    "CloudResource",
    {
      ownerUserService: CloudResourceOwnerUserService,
      ownerTeamService: CloudResourceOwnerTeamService,
      fkColumn: "cloudResourceId",
      canOwnTelemetry: true,
      modelService: CloudResourceService,
    },
  ],
  [
    "RumApplication",
    {
      ownerUserService: RumApplicationOwnerUserService,
      ownerTeamService: RumApplicationOwnerTeamService,
      fkColumn: "rumApplicationId",
      canOwnTelemetry: true,
      modelService: RumApplicationService,
    },
  ],
  [
    "Workflow",
    {
      ownerUserService: WorkflowOwnerUserService,
      ownerTeamService: WorkflowOwnerTeamService,
      fkColumn: "workflowId",
    },
  ],
]);

export default ownerTableRegistry;
