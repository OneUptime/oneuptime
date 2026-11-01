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
import ServiceLevelObjectiveOwnerTeamService from "../../../Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../Services/ServiceLevelObjectiveOwnerUserService";
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
import DataStoreOwnerTeamService from "../../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Services/DataStoreOwnerUserService";
import RumApplicationOwnerTeamService from "../../../Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "../../../Services/RumApplicationOwnerUserService";
import ProxmoxClusterOwnerTeamService from "../../../Services/ProxmoxClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "../../../Services/ProxmoxClusterOwnerUserService";
import CephClusterOwnerTeamService from "../../../Services/CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "../../../Services/CephClusterOwnerUserService";
import StorageArrayOwnerTeamService from "../../../Services/StorageArrayOwnerTeamService";
import StorageArrayOwnerUserService from "../../../Services/StorageArrayOwnerUserService";
import DockerSwarmClusterOwnerTeamService from "../../../Services/DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterOwnerUserService from "../../../Services/DockerSwarmClusterOwnerUserService";
import VMwareVCenterOwnerTeamService from "../../../Services/VMwareVCenterOwnerTeamService";
import VMwareVCenterOwnerUserService from "../../../Services/VMwareVCenterOwnerUserService";
import DatabaseServerOwnerTeamService from "../../../Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "../../../Services/DatabaseServerOwnerUserService";
import MessageQueueOwnerTeamService from "../../../Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "../../../Services/MessageQueueOwnerUserService";
import IoTFleetOwnerTeamService from "../../../Services/IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "../../../Services/IoTFleetOwnerUserService";
import NetworkDeviceOwnerTeamService from "../../../Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "../../../Services/NetworkDeviceOwnerUserService";
import StatusPageOwnerTeamService from "../../../Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "../../../Services/StatusPageOwnerUserService";
import WorkflowOwnerTeamService from "../../../Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "../../../Services/WorkflowOwnerUserService";
import AlertEpisodeOwnerTeamService from "../../../Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../Services/AlertEpisodeOwnerUserService";
import IncidentEpisodeOwnerTeamService from "../../../Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../Services/IncidentEpisodeOwnerUserService";
import MonitorGroupOwnerTeamService from "../../../Services/MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService from "../../../Services/MonitorGroupOwnerUserService";
import IncomingCallPolicyOwnerTeamService from "../../../Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "../../../Services/IncomingCallPolicyOwnerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "../../../Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleOwnerUserService from "../../../Services/OnCallDutyPolicyScheduleOwnerUserService";
import IncidentTemplateOwnerTeamService from "../../../Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Services/IncidentTemplateOwnerUserService";
import ScheduledMaintenanceTemplateOwnerTeamService from "../../../Services/ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService from "../../../Services/ScheduledMaintenanceTemplateOwnerUserService";
import ProbeOwnerTeamService from "../../../Services/ProbeOwnerTeamService";
import ProbeOwnerUserService from "../../../Services/ProbeOwnerUserService";
import RunnerOwnerTeamService from "../../../Services/RunnerOwnerTeamService";
import RunnerOwnerUserService from "../../../Services/RunnerOwnerUserService";
import AIAgentOwnerTeamService from "../../../Services/AIAgentOwnerTeamService";
import AIAgentOwnerUserService from "../../../Services/AIAgentOwnerUserService";
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
import DataStoreService from "../../../Services/DataStoreService";
import RumApplicationService from "../../../Services/RumApplicationService";
import ProxmoxClusterService from "../../../Services/ProxmoxClusterService";
import CephClusterService from "../../../Services/CephClusterService";
import StorageArrayService from "../../../Services/StorageArrayService";
import DockerSwarmClusterService from "../../../Services/DockerSwarmClusterService";
import VMwareVCenterService from "../../../Services/VMwareVCenterService";
import DatabaseServerService from "../../../Services/DatabaseServerService";
import IoTFleetService from "../../../Services/IoTFleetService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import ServiceLevelObjectiveService from "../../../Services/ServiceLevelObjectiveService";

/*
 * EVERY KIND OF RECORD WITH OWNERS OF ITS OWN: a model name ("Monitor") to
 * the two services that hold its owner rows (people and teams) and the key
 * column those rows name the record by. The `Owned` permission scope reads
 * them to work out which records a member may act on, so a kind with owner
 * tables that is missing here is not narrowed by the scope at all - not its
 * reads, changes or deletes, nor the adding and removing of its owners.
 * Tests/Server/Types/Database/Permissions/OwnedScopeEveryKindWithOwners holds
 * every model with owner tables to an entry here.
 *
 * Nested models (those decorated with @OwnedThrough) resolve ownership
 * through their parent, so this registry only needs entries for the kinds
 * that keep owner rows of their own.
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
   * types (they all carry labels), and for a kind whose own analytics rows
   * name it (an SLO's history).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelService?: any;
  /*
   * True for a kind other records are set up with: the probe a monitor runs
   * on, the runner a runbook step runs on, an AI agent, the template an
   * incident or a maintenance event is declared from, the on-call schedule
   * an escalation rule pages. Picking one is reading it, and so is seeing
   * who is on call, so the Owned scope leaves reads of the kind alone:
   * whoever may read it reads every one of its records - and the records
   * that take their owners from it (@OwnedThrough: a schedule's layers) -
   * whatever the scope of their grant, as labels and blocks allow. A grant
   * scoped to Owned still changes and deletes only the records its holder
   * or their teams own, and adds and removes owners only on those
   * (OwnedScopePermission.isLimitedToOwnedRecords). Every other kind is
   * narrowed on reads as well.
   */
  ownedScopeLeavesReads?: boolean;
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
    /*
     * Burn-rate rules are @OwnedThrough their SLO, so this entry is what
     * lets an Owned-scoped user reach both the SLO and its rules. A missing
     * entry resolves to "owns nothing" silently (see OwnedScopePermission).
     */
    "ServiceLevelObjective",
    {
      ownerUserService: ServiceLevelObjectiveOwnerUserService,
      ownerTeamService: ServiceLevelObjectiveOwnerTeamService,
      fkColumn: "serviceLevelObjectiveId",
      /*
       * No canOwnTelemetry: no telemetry row names an SLO. Its history rows
       * do (SloHistory.sloId), and an analytics read of them is scoped by
       * the SLOs the caller may read - its labels through this service.
       */
      modelService: ServiceLevelObjectiveService,
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
    "DataStore",
    {
      ownerUserService: DataStoreOwnerUserService,
      ownerTeamService: DataStoreOwnerTeamService,
      fkColumn: "dataStoreId",
      // A store is what scans read, not a source of telemetry of its own.
      canOwnTelemetry: false,
      modelService: DataStoreService,
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
    "ProxmoxCluster",
    {
      ownerUserService: ProxmoxClusterOwnerUserService,
      ownerTeamService: ProxmoxClusterOwnerTeamService,
      fkColumn: "proxmoxClusterId",
      canOwnTelemetry: true,
      modelService: ProxmoxClusterService,
    },
  ],
  [
    "CephCluster",
    {
      ownerUserService: CephClusterOwnerUserService,
      ownerTeamService: CephClusterOwnerTeamService,
      fkColumn: "cephClusterId",
      canOwnTelemetry: true,
      modelService: CephClusterService,
    },
  ],
  [
    "StorageArray",
    {
      ownerUserService: StorageArrayOwnerUserService,
      ownerTeamService: StorageArrayOwnerTeamService,
      fkColumn: "storageArrayId",
      canOwnTelemetry: true,
      modelService: StorageArrayService,
    },
  ],
  [
    "DockerSwarmCluster",
    {
      ownerUserService: DockerSwarmClusterOwnerUserService,
      ownerTeamService: DockerSwarmClusterOwnerTeamService,
      fkColumn: "dockerSwarmClusterId",
      canOwnTelemetry: true,
      modelService: DockerSwarmClusterService,
    },
  ],
  [
    "VMwareVCenter",
    {
      ownerUserService: VMwareVCenterOwnerUserService,
      ownerTeamService: VMwareVCenterOwnerTeamService,
      fkColumn: "vmwareVCenterId",
      canOwnTelemetry: true,
      modelService: VMwareVCenterService,
    },
  ],
  [
    /*
     * Receiver batches (the collector / Database Agent) stamp the database
     * server's id as the telemetry row's serviceId (serviceType
     * DatabaseServer), so owning a database grants its telemetry.
     */
    "DatabaseServer",
    {
      ownerUserService: DatabaseServerOwnerUserService,
      ownerTeamService: DatabaseServerOwnerTeamService,
      fkColumn: "databaseServerId",
      canOwnTelemetry: true,
      modelService: DatabaseServerService,
    },
  ],
  [
    /*
     * No canOwnTelemetry: a queue owns no telemetry row. Messaging spans and
     * client metrics belong to the producing or consuming service, and a
     * queue's telemetry is selected by its entity key (keyForMessageQueue),
     * never by primaryEntityId - owning a queue grants the queue row alone.
     */
    "MessageQueue",
    {
      ownerUserService: MessageQueueOwnerUserService,
      ownerTeamService: MessageQueueOwnerTeamService,
      fkColumn: "messageQueueId",
    },
  ],
  [
    /*
     * IoT telemetry carries the fleet ID in primaryEntityId even though its
     * primaryEntityType discriminator is IoTDevice. Ownership is fleet-wide.
     */
    "IoTFleet",
    {
      ownerUserService: IoTFleetOwnerUserService,
      ownerTeamService: IoTFleetOwnerTeamService,
      fkColumn: "iotFleetId",
      canOwnTelemetry: true,
      modelService: IoTFleetService,
    },
  ],
  [
    "NetworkDevice",
    {
      ownerUserService: NetworkDeviceOwnerUserService,
      ownerTeamService: NetworkDeviceOwnerTeamService,
      fkColumn: "networkDeviceId",
      canOwnTelemetry: true,
      modelService: NetworkDeviceService,
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
  [
    // An episode is held to its owners as the alerts it groups are to theirs.
    "AlertEpisode",
    {
      ownerUserService: AlertEpisodeOwnerUserService,
      ownerTeamService: AlertEpisodeOwnerTeamService,
      fkColumn: "alertEpisodeId",
    },
  ],
  [
    // An episode is held to its owners as the incidents it groups are.
    "IncidentEpisode",
    {
      ownerUserService: IncidentEpisodeOwnerUserService,
      ownerTeamService: IncidentEpisodeOwnerTeamService,
      fkColumn: "incidentEpisodeId",
    },
  ],
  [
    /*
     * Held to its owners as the monitors it groups are: a status page's
     * monitor group picker lists what its picker of monitors does.
     */
    "MonitorGroup",
    {
      ownerUserService: MonitorGroupOwnerUserService,
      ownerTeamService: MonitorGroupOwnerTeamService,
      fkColumn: "monitorGroupId",
    },
  ],
  [
    "IncomingCallPolicy",
    {
      ownerUserService: IncomingCallPolicyOwnerUserService,
      ownerTeamService: IncomingCallPolicyOwnerTeamService,
      fkColumn: "incomingCallPolicyId",
    },
  ],
  [
    /*
     * An escalation rule of any policy pages a schedule, the way it pages a
     * person or a team, and the people on a schedule see their turns on it
     * whoever owns it: read by every reader of schedules
     * (ownedScopeLeavesReads), changed only by its owners.
     */
    "OnCallDutyPolicySchedule",
    {
      ownerUserService: OnCallDutyPolicyScheduleOwnerUserService,
      ownerTeamService: OnCallDutyPolicyScheduleOwnerTeamService,
      fkColumn: "onCallDutyPolicyScheduleId",
      ownedScopeLeavesReads: true,
    },
  ],
  [
    /*
     * Anyone who declares incidents picks from the project's templates. Its
     * owners also become the owners of every incident declared from it, so
     * only they change it - or add and remove its owners.
     */
    "IncidentTemplate",
    {
      ownerUserService: IncidentTemplateOwnerUserService,
      ownerTeamService: IncidentTemplateOwnerTeamService,
      fkColumn: "incidentTemplateId",
      ownedScopeLeavesReads: true,
    },
  ],
  [
    // The same for the events scheduled from a maintenance template.
    "ScheduledMaintenanceTemplate",
    {
      ownerUserService: ScheduledMaintenanceTemplateOwnerUserService,
      ownerTeamService: ScheduledMaintenanceTemplateOwnerTeamService,
      fkColumn: "scheduledMaintenanceTemplateId",
      ownedScopeLeavesReads: true,
    },
  ],
  [
    /*
     * A monitor's probe picker lists the project's probes to everyone who
     * may pick one (Probe's PROBE_PICKER_READERS); OneUptime's global probes
     * are listed by a route of their own (ProbeAPI).
     */
    "Probe",
    {
      ownerUserService: ProbeOwnerUserService,
      ownerTeamService: ProbeOwnerTeamService,
      fkColumn: "probeId",
      ownedScopeLeavesReads: true,
    },
  ],
  [
    /*
     * A runbook's steps, a cluster's AI and a code repository's AI work run
     * on a runner picked here.
     */
    "Runner",
    {
      ownerUserService: RunnerOwnerUserService,
      ownerTeamService: RunnerOwnerTeamService,
      fkColumn: "runnerId",
      ownedScopeLeavesReads: true,
    },
  ],
  [
    // Like a probe, an agent the project's AI work runs on.
    "AIAgent",
    {
      ownerUserService: AIAgentOwnerUserService,
      ownerTeamService: AIAgentOwnerTeamService,
      fkColumn: "aiAgentId",
      ownedScopeLeavesReads: true,
    },
  ],
]);

export default ownerTableRegistry;
