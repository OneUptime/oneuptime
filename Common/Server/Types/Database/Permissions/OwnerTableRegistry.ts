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
import KubernetesClusterOwnerTeamService from "../../../Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "../../../Services/KubernetesClusterOwnerUserService";
import StatusPageOwnerTeamService from "../../../Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "../../../Services/StatusPageOwnerUserService";
import WorkflowOwnerTeamService from "../../../Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "../../../Services/WorkflowOwnerUserService";

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
      fkColumn: "serviceId",
    },
  ],
  [
    "Host",
    {
      ownerUserService: HostOwnerUserService,
      ownerTeamService: HostOwnerTeamService,
      fkColumn: "hostId",
    },
  ],
  [
    "DockerHost",
    {
      ownerUserService: DockerHostOwnerUserService,
      ownerTeamService: DockerHostOwnerTeamService,
      fkColumn: "dockerHostId",
    },
  ],
  [
    "KubernetesCluster",
    {
      ownerUserService: KubernetesClusterOwnerUserService,
      ownerTeamService: KubernetesClusterOwnerTeamService,
      fkColumn: "kubernetesClusterId",
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
