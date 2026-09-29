import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeLabelRule from "../../../../Models/DatabaseModels/AlertEpisodeLabelRule";
import AlertEpisodeOwnerRule from "../../../../Models/DatabaseModels/AlertEpisodeOwnerRule";
import AlertEpisodeOwnerTeam from "../../../../Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "../../../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import AlertEpisodePrivacyRule from "../../../../Models/DatabaseModels/AlertEpisodePrivacyRule";
import AlertLabelRule from "../../../../Models/DatabaseModels/AlertLabelRule";
import AlertOwnerRule from "../../../../Models/DatabaseModels/AlertOwnerRule";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import AlertPrivacyRule from "../../../../Models/DatabaseModels/AlertPrivacyRule";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import CephClusterLabelRule from "../../../../Models/DatabaseModels/CephClusterLabelRule";
import CephClusterOwnerRule from "../../../../Models/DatabaseModels/CephClusterOwnerRule";
import CephClusterOwnerTeam from "../../../../Models/DatabaseModels/CephClusterOwnerTeam";
import CephClusterOwnerUser from "../../../../Models/DatabaseModels/CephClusterOwnerUser";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudResourceLabelRule from "../../../../Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "../../../../Models/DatabaseModels/CloudResourceOwnerRule";
import CloudResourceOwnerTeam from "../../../../Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "../../../../Models/DatabaseModels/CloudResourceOwnerUser";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import DashboardLabelRule from "../../../../Models/DatabaseModels/DashboardLabelRule";
import DashboardOwnerRule from "../../../../Models/DatabaseModels/DashboardOwnerRule";
import DashboardOwnerTeam from "../../../../Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "../../../../Models/DatabaseModels/DashboardOwnerUser";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerLabelRule from "../../../../Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerOwnerRule from "../../../../Models/DatabaseModels/DatabaseServerOwnerRule";
import DatabaseServerOwnerTeam from "../../../../Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "../../../../Models/DatabaseModels/DatabaseServerOwnerUser";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerHostLabelRule from "../../../../Models/DatabaseModels/DockerHostLabelRule";
import DockerHostOwnerRule from "../../../../Models/DatabaseModels/DockerHostOwnerRule";
import DockerHostOwnerTeam from "../../../../Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerUser from "../../../../Models/DatabaseModels/DockerHostOwnerUser";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterLabelRule from "../../../../Models/DatabaseModels/DockerSwarmClusterLabelRule";
import DockerSwarmClusterOwnerRule from "../../../../Models/DatabaseModels/DockerSwarmClusterOwnerRule";
import DockerSwarmClusterOwnerTeam from "../../../../Models/DatabaseModels/DockerSwarmClusterOwnerTeam";
import DockerSwarmClusterOwnerUser from "../../../../Models/DatabaseModels/DockerSwarmClusterOwnerUser";
import Host from "../../../../Models/DatabaseModels/Host";
import HostLabelRule from "../../../../Models/DatabaseModels/HostLabelRule";
import HostOwnerRule from "../../../../Models/DatabaseModels/HostOwnerRule";
import HostOwnerTeam from "../../../../Models/DatabaseModels/HostOwnerTeam";
import HostOwnerUser from "../../../../Models/DatabaseModels/HostOwnerUser";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeLabelRule from "../../../../Models/DatabaseModels/IncidentEpisodeLabelRule";
import IncidentEpisodeOwnerRule from "../../../../Models/DatabaseModels/IncidentEpisodeOwnerRule";
import IncidentEpisodeOwnerTeam from "../../../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "../../../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentEpisodePrivacyRule from "../../../../Models/DatabaseModels/IncidentEpisodePrivacyRule";
import IncidentLabelRule from "../../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentOwnerTeam from "../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentPrivacyRule from "../../../../Models/DatabaseModels/IncidentPrivacyRule";
import IncomingCallPolicy from "../../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyLabelRule from "../../../../Models/DatabaseModels/IncomingCallPolicyLabelRule";
import IncomingCallPolicyOwnerRule from "../../../../Models/DatabaseModels/IncomingCallPolicyOwnerRule";
import IncomingCallPolicyOwnerTeam from "../../../../Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "../../../../Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import IoTFleet from "../../../../Models/DatabaseModels/IoTFleet";
import IoTFleetLabelRule from "../../../../Models/DatabaseModels/IoTFleetLabelRule";
import IoTFleetOwnerRule from "../../../../Models/DatabaseModels/IoTFleetOwnerRule";
import IoTFleetOwnerTeam from "../../../../Models/DatabaseModels/IoTFleetOwnerTeam";
import IoTFleetOwnerUser from "../../../../Models/DatabaseModels/IoTFleetOwnerUser";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterLabelRule from "../../../../Models/DatabaseModels/KubernetesClusterLabelRule";
import KubernetesClusterOwnerRule from "../../../../Models/DatabaseModels/KubernetesClusterOwnerRule";
import KubernetesClusterOwnerTeam from "../../../../Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerUser from "../../../../Models/DatabaseModels/KubernetesClusterOwnerUser";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import MonitorOwnerRule from "../../../../Models/DatabaseModels/MonitorOwnerRule";
import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "../../../../Models/DatabaseModels/NetworkDeviceLabelRule";
import NetworkDeviceOwnerRule from "../../../../Models/DatabaseModels/NetworkDeviceOwnerRule";
import NetworkDeviceOwnerTeam from "../../../../Models/DatabaseModels/NetworkDeviceOwnerTeam";
import NetworkDeviceOwnerUser from "../../../../Models/DatabaseModels/NetworkDeviceOwnerUser";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyLabelRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyLabelRule";
import OnCallDutyPolicyOwnerRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerRule";
import OnCallDutyPolicyOwnerTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLabelRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLabelRule";
import OnCallDutyPolicyScheduleOwnerRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerRule";
import OnCallDutyPolicyScheduleOwnerTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import PodmanHostLabelRule from "../../../../Models/DatabaseModels/PodmanHostLabelRule";
import PodmanHostOwnerRule from "../../../../Models/DatabaseModels/PodmanHostOwnerRule";
import PodmanHostOwnerTeam from "../../../../Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerUser from "../../../../Models/DatabaseModels/PodmanHostOwnerUser";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterLabelRule from "../../../../Models/DatabaseModels/ProxmoxClusterLabelRule";
import ProxmoxClusterOwnerRule from "../../../../Models/DatabaseModels/ProxmoxClusterOwnerRule";
import ProxmoxClusterOwnerTeam from "../../../../Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import ProxmoxClusterOwnerUser from "../../../../Models/DatabaseModels/ProxmoxClusterOwnerUser";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import RumApplicationLabelRule from "../../../../Models/DatabaseModels/RumApplicationLabelRule";
import RumApplicationOwnerRule from "../../../../Models/DatabaseModels/RumApplicationOwnerRule";
import RumApplicationOwnerTeam from "../../../../Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerUser from "../../../../Models/DatabaseModels/RumApplicationOwnerUser";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookLabelRule from "../../../../Models/DatabaseModels/RunbookLabelRule";
import RunbookOwnerRule from "../../../../Models/DatabaseModels/RunbookOwnerRule";
import RunbookOwnerTeam from "../../../../Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerUser from "../../../../Models/DatabaseModels/RunbookOwnerUser";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceLabelRule from "../../../../Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import ScheduledMaintenanceOwnerRule from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import ScheduledMaintenanceOwnerTeam from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionLabelRule from "../../../../Models/DatabaseModels/ServerlessFunctionLabelRule";
import ServerlessFunctionOwnerRule from "../../../../Models/DatabaseModels/ServerlessFunctionOwnerRule";
import ServerlessFunctionOwnerTeam from "../../../../Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import ServerlessFunctionOwnerUser from "../../../../Models/DatabaseModels/ServerlessFunctionOwnerUser";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLabelRule from "../../../../Models/DatabaseModels/ServiceLabelRule";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveLabelRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import ServiceLevelObjectiveOwnerRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import ServiceLevelObjectiveOwnerTeam from "../../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import ServiceOwnerRule from "../../../../Models/DatabaseModels/ServiceOwnerRule";
import ServiceOwnerTeam from "../../../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../../../Models/DatabaseModels/ServiceOwnerUser";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageLabelRule from "../../../../Models/DatabaseModels/StatusPageLabelRule";
import StatusPageOwnerRule from "../../../../Models/DatabaseModels/StatusPageOwnerRule";
import StatusPageOwnerTeam from "../../../../Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "../../../../Models/DatabaseModels/StatusPageOwnerUser";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterLabelRule from "../../../../Models/DatabaseModels/VMwareVCenterLabelRule";
import VMwareVCenterOwnerRule from "../../../../Models/DatabaseModels/VMwareVCenterOwnerRule";
import VMwareVCenterOwnerTeam from "../../../../Models/DatabaseModels/VMwareVCenterOwnerTeam";
import VMwareVCenterOwnerUser from "../../../../Models/DatabaseModels/VMwareVCenterOwnerUser";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLabelRule from "../../../../Models/DatabaseModels/WorkflowLabelRule";
import WorkflowOwnerRule from "../../../../Models/DatabaseModels/WorkflowOwnerRule";
import WorkflowOwnerTeam from "../../../../Models/DatabaseModels/WorkflowOwnerTeam";
import WorkflowOwnerUser from "../../../../Models/DatabaseModels/WorkflowOwnerUser";
import { RuleRunType } from "../../../../Types/Rules/RuleRun";
import DatabaseService from "../../../Services/DatabaseService";
import AlertEpisodeLabelRuleEngineService from "../../../Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeLabelRuleService from "../../../Services/AlertEpisodeLabelRuleService";
import AlertEpisodeOwnerRuleEngineService from "../../../Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodeOwnerRuleService from "../../../Services/AlertEpisodeOwnerRuleService";
import AlertEpisodePrivacyRuleEngineService from "../../../Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodePrivacyRuleService from "../../../Services/AlertEpisodePrivacyRuleService";
import AlertEpisodeService from "../../../Services/AlertEpisodeService";
import AlertLabelRuleEngineService from "../../../Services/AlertLabelRuleEngineService";
import AlertLabelRuleService from "../../../Services/AlertLabelRuleService";
import AlertOwnerRuleEngineService from "../../../Services/AlertOwnerRuleEngineService";
import AlertOwnerRuleService from "../../../Services/AlertOwnerRuleService";
import AlertPrivacyRuleEngineService from "../../../Services/AlertPrivacyRuleEngineService";
import AlertPrivacyRuleService from "../../../Services/AlertPrivacyRuleService";
import AlertService from "../../../Services/AlertService";
import CephClusterLabelRuleEngineService from "../../../Services/CephClusterLabelRuleEngineService";
import CephClusterLabelRuleService from "../../../Services/CephClusterLabelRuleService";
import CephClusterOwnerRuleEngineService from "../../../Services/CephClusterOwnerRuleEngineService";
import CephClusterOwnerRuleService from "../../../Services/CephClusterOwnerRuleService";
import CephClusterService from "../../../Services/CephClusterService";
import CloudResourceLabelRuleEngineService from "../../../Services/CloudResourceLabelRuleEngineService";
import CloudResourceLabelRuleService from "../../../Services/CloudResourceLabelRuleService";
import CloudResourceOwnerRuleEngineService from "../../../Services/CloudResourceOwnerRuleEngineService";
import CloudResourceOwnerRuleService from "../../../Services/CloudResourceOwnerRuleService";
import CloudResourceService from "../../../Services/CloudResourceService";
import DashboardLabelRuleEngineService from "../../../Services/DashboardLabelRuleEngineService";
import DashboardLabelRuleService from "../../../Services/DashboardLabelRuleService";
import DashboardOwnerRuleEngineService from "../../../Services/DashboardOwnerRuleEngineService";
import DashboardOwnerRuleService from "../../../Services/DashboardOwnerRuleService";
import DashboardService from "../../../Services/DashboardService";
import DatabaseServerLabelRuleEngineService from "../../../Services/DatabaseServerLabelRuleEngineService";
import DatabaseServerLabelRuleService from "../../../Services/DatabaseServerLabelRuleService";
import DatabaseServerOwnerRuleEngineService from "../../../Services/DatabaseServerOwnerRuleEngineService";
import DatabaseServerOwnerRuleService from "../../../Services/DatabaseServerOwnerRuleService";
import DatabaseServerService from "../../../Services/DatabaseServerService";
import DockerHostLabelRuleEngineService from "../../../Services/DockerHostLabelRuleEngineService";
import DockerHostLabelRuleService from "../../../Services/DockerHostLabelRuleService";
import DockerHostOwnerRuleEngineService from "../../../Services/DockerHostOwnerRuleEngineService";
import DockerHostOwnerRuleService from "../../../Services/DockerHostOwnerRuleService";
import DockerHostService from "../../../Services/DockerHostService";
import DockerSwarmClusterLabelRuleEngineService from "../../../Services/DockerSwarmClusterLabelRuleEngineService";
import DockerSwarmClusterLabelRuleService from "../../../Services/DockerSwarmClusterLabelRuleService";
import DockerSwarmClusterOwnerRuleEngineService from "../../../Services/DockerSwarmClusterOwnerRuleEngineService";
import DockerSwarmClusterOwnerRuleService from "../../../Services/DockerSwarmClusterOwnerRuleService";
import DockerSwarmClusterService from "../../../Services/DockerSwarmClusterService";
import HostLabelRuleEngineService from "../../../Services/HostLabelRuleEngineService";
import HostLabelRuleService from "../../../Services/HostLabelRuleService";
import HostOwnerRuleEngineService from "../../../Services/HostOwnerRuleEngineService";
import HostOwnerRuleService from "../../../Services/HostOwnerRuleService";
import HostService from "../../../Services/HostService";
import IncidentEpisodeLabelRuleEngineService from "../../../Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeLabelRuleService from "../../../Services/IncidentEpisodeLabelRuleService";
import IncidentEpisodeOwnerRuleEngineService from "../../../Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodeOwnerRuleService from "../../../Services/IncidentEpisodeOwnerRuleService";
import IncidentEpisodePrivacyRuleEngineService from "../../../Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodePrivacyRuleService from "../../../Services/IncidentEpisodePrivacyRuleService";
import IncidentEpisodeService from "../../../Services/IncidentEpisodeService";
import IncidentLabelRuleEngineService from "../../../Services/IncidentLabelRuleEngineService";
import IncidentLabelRuleService from "../../../Services/IncidentLabelRuleService";
import IncidentOwnerRuleEngineService from "../../../Services/IncidentOwnerRuleEngineService";
import IncidentOwnerRuleService from "../../../Services/IncidentOwnerRuleService";
import IncidentPrivacyRuleEngineService from "../../../Services/IncidentPrivacyRuleEngineService";
import IncidentPrivacyRuleService from "../../../Services/IncidentPrivacyRuleService";
import IncidentService from "../../../Services/IncidentService";
import IncomingCallPolicyLabelRuleEngineService from "../../../Services/IncomingCallPolicyLabelRuleEngineService";
import IncomingCallPolicyLabelRuleService from "../../../Services/IncomingCallPolicyLabelRuleService";
import IncomingCallPolicyOwnerRuleEngineService from "../../../Services/IncomingCallPolicyOwnerRuleEngineService";
import IncomingCallPolicyOwnerRuleService from "../../../Services/IncomingCallPolicyOwnerRuleService";
import IncomingCallPolicyService from "../../../Services/IncomingCallPolicyService";
import IoTFleetLabelRuleEngineService from "../../../Services/IoTFleetLabelRuleEngineService";
import IoTFleetLabelRuleService from "../../../Services/IoTFleetLabelRuleService";
import IoTFleetOwnerRuleEngineService from "../../../Services/IoTFleetOwnerRuleEngineService";
import IoTFleetOwnerRuleService from "../../../Services/IoTFleetOwnerRuleService";
import IoTFleetService from "../../../Services/IoTFleetService";
import KubernetesClusterLabelRuleEngineService from "../../../Services/KubernetesClusterLabelRuleEngineService";
import KubernetesClusterLabelRuleService from "../../../Services/KubernetesClusterLabelRuleService";
import KubernetesClusterOwnerRuleEngineService from "../../../Services/KubernetesClusterOwnerRuleEngineService";
import KubernetesClusterOwnerRuleService from "../../../Services/KubernetesClusterOwnerRuleService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import MonitorLabelRuleEngineService from "../../../Services/MonitorLabelRuleEngineService";
import MonitorLabelRuleService from "../../../Services/MonitorLabelRuleService";
import MonitorOwnerRuleEngineService from "../../../Services/MonitorOwnerRuleEngineService";
import MonitorOwnerRuleService from "../../../Services/MonitorOwnerRuleService";
import MonitorService from "../../../Services/MonitorService";
import NetworkDeviceLabelRuleEngineService from "../../../Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceLabelRuleService from "../../../Services/NetworkDeviceLabelRuleService";
import NetworkDeviceOwnerRuleEngineService from "../../../Services/NetworkDeviceOwnerRuleEngineService";
import NetworkDeviceOwnerRuleService from "../../../Services/NetworkDeviceOwnerRuleService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import OnCallDutyPolicyLabelRuleEngineService from "../../../Services/OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyLabelRuleService from "../../../Services/OnCallDutyPolicyLabelRuleService";
import OnCallDutyPolicyOwnerRuleEngineService from "../../../Services/OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyOwnerRuleService from "../../../Services/OnCallDutyPolicyOwnerRuleService";
import OnCallDutyPolicyScheduleLabelRuleEngineService from "../../../Services/OnCallDutyPolicyScheduleLabelRuleEngineService";
import OnCallDutyPolicyScheduleLabelRuleService from "../../../Services/OnCallDutyPolicyScheduleLabelRuleService";
import OnCallDutyPolicyScheduleOwnerRuleEngineService from "../../../Services/OnCallDutyPolicyScheduleOwnerRuleEngineService";
import OnCallDutyPolicyScheduleOwnerRuleService from "../../../Services/OnCallDutyPolicyScheduleOwnerRuleService";
import OnCallDutyPolicyScheduleService from "../../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import PodmanHostLabelRuleEngineService from "../../../Services/PodmanHostLabelRuleEngineService";
import PodmanHostLabelRuleService from "../../../Services/PodmanHostLabelRuleService";
import PodmanHostOwnerRuleEngineService from "../../../Services/PodmanHostOwnerRuleEngineService";
import PodmanHostOwnerRuleService from "../../../Services/PodmanHostOwnerRuleService";
import PodmanHostService from "../../../Services/PodmanHostService";
import ProxmoxClusterLabelRuleEngineService from "../../../Services/ProxmoxClusterLabelRuleEngineService";
import ProxmoxClusterLabelRuleService from "../../../Services/ProxmoxClusterLabelRuleService";
import ProxmoxClusterOwnerRuleEngineService from "../../../Services/ProxmoxClusterOwnerRuleEngineService";
import ProxmoxClusterOwnerRuleService from "../../../Services/ProxmoxClusterOwnerRuleService";
import ProxmoxClusterService from "../../../Services/ProxmoxClusterService";
import RumApplicationLabelRuleEngineService from "../../../Services/RumApplicationLabelRuleEngineService";
import RumApplicationLabelRuleService from "../../../Services/RumApplicationLabelRuleService";
import RumApplicationOwnerRuleEngineService from "../../../Services/RumApplicationOwnerRuleEngineService";
import RumApplicationOwnerRuleService from "../../../Services/RumApplicationOwnerRuleService";
import RumApplicationService from "../../../Services/RumApplicationService";
import RunbookLabelRuleEngineService from "../../../Services/RunbookLabelRuleEngineService";
import RunbookLabelRuleService from "../../../Services/RunbookLabelRuleService";
import RunbookOwnerRuleEngineService from "../../../Services/RunbookOwnerRuleEngineService";
import RunbookOwnerRuleService from "../../../Services/RunbookOwnerRuleService";
import RunbookService from "../../../Services/RunbookService";
import ScheduledMaintenanceLabelRuleEngineService from "../../../Services/ScheduledMaintenanceLabelRuleEngineService";
import ScheduledMaintenanceLabelRuleService from "../../../Services/ScheduledMaintenanceLabelRuleService";
import ScheduledMaintenanceOwnerRuleEngineService from "../../../Services/ScheduledMaintenanceOwnerRuleEngineService";
import ScheduledMaintenanceOwnerRuleService from "../../../Services/ScheduledMaintenanceOwnerRuleService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import ServerlessFunctionLabelRuleEngineService from "../../../Services/ServerlessFunctionLabelRuleEngineService";
import ServerlessFunctionLabelRuleService from "../../../Services/ServerlessFunctionLabelRuleService";
import ServerlessFunctionOwnerRuleEngineService from "../../../Services/ServerlessFunctionOwnerRuleEngineService";
import ServerlessFunctionOwnerRuleService from "../../../Services/ServerlessFunctionOwnerRuleService";
import ServerlessFunctionService from "../../../Services/ServerlessFunctionService";
import ServiceLevelObjectiveLabelRuleEngineService from "../../../Services/ServiceLevelObjectiveLabelRuleEngineService";
import ServiceLevelObjectiveLabelRuleService from "../../../Services/ServiceLevelObjectiveLabelRuleService";
import ServiceLevelObjectiveOwnerRuleEngineService from "../../../Services/ServiceLevelObjectiveOwnerRuleEngineService";
import ServiceLevelObjectiveOwnerRuleService from "../../../Services/ServiceLevelObjectiveOwnerRuleService";
import ServiceLevelObjectiveService from "../../../Services/ServiceLevelObjectiveService";
import ServiceLabelRuleEngineService from "../../../Services/ServiceLabelRuleEngineService";
import ServiceLabelRuleService from "../../../Services/ServiceLabelRuleService";
import ServiceOwnerRuleEngineService from "../../../Services/ServiceOwnerRuleEngineService";
import ServiceOwnerRuleService from "../../../Services/ServiceOwnerRuleService";
import ServiceService from "../../../Services/ServiceService";
import StatusPageLabelRuleEngineService from "../../../Services/StatusPageLabelRuleEngineService";
import StatusPageLabelRuleService from "../../../Services/StatusPageLabelRuleService";
import StatusPageOwnerRuleEngineService from "../../../Services/StatusPageOwnerRuleEngineService";
import StatusPageOwnerRuleService from "../../../Services/StatusPageOwnerRuleService";
import StatusPageService from "../../../Services/StatusPageService";
import VMwareVCenterLabelRuleEngineService from "../../../Services/VMwareVCenterLabelRuleEngineService";
import VMwareVCenterLabelRuleService from "../../../Services/VMwareVCenterLabelRuleService";
import VMwareVCenterOwnerRuleEngineService from "../../../Services/VMwareVCenterOwnerRuleEngineService";
import VMwareVCenterOwnerRuleService from "../../../Services/VMwareVCenterOwnerRuleService";
import VMwareVCenterService from "../../../Services/VMwareVCenterService";
import WorkflowLabelRuleEngineService from "../../../Services/WorkflowLabelRuleEngineService";
import WorkflowLabelRuleService from "../../../Services/WorkflowLabelRuleService";
import WorkflowOwnerRuleEngineService from "../../../Services/WorkflowOwnerRuleEngineService";
import WorkflowOwnerRuleService from "../../../Services/WorkflowOwnerRuleService";
import WorkflowService from "../../../Services/WorkflowService";
import { RuleRunEngine } from "./RuleApplication";

/*
 * Which service, model and engine each runnable rule uses. Declarative on
 * purpose: everything a run DOES lives in the engine, so an entry here is only
 * ever wiring, and a rule type without an entry is a compile error rather than
 * a Run Now button that answers "this rule cannot be run".
 */

export interface RuleRunDefinition {
  ruleModelType: DatabaseBaseModelType;
  resourceModelType: DatabaseBaseModelType;
  ruleService: DatabaseService<BaseModel>;
  resourceService: DatabaseService<BaseModel>;
  engine: RuleRunEngine<BaseModel, BaseModel>;
  /*
   * Owner rules only: the owner rows a run creates. Running the rule creates
   * them, so the caller must be allowed to.
   */
  ownerModelTypes?: Array<DatabaseBaseModelType> | undefined;
}

interface TypedRuleRunDefinition<
  TResource extends BaseModel,
  TRule extends BaseModel,
> {
  ruleModelType: { new (): TRule };
  resourceModelType: { new (): TResource };
  ruleService: DatabaseService<TRule>;
  resourceService: DatabaseService<TResource>;
  engine: RuleRunEngine<TResource, TRule>;
  ownerModelTypes?: Array<DatabaseBaseModelType> | undefined;
}

/*
 * Checks one entry's pieces against each other - the engine, both services and
 * both models have to agree on the resource and rule types - then erases the
 * types so entries for different resources fit in one table.
 */
function defineRuleRun<TResource extends BaseModel, TRule extends BaseModel>(
  definition: TypedRuleRunDefinition<TResource, TRule>,
): RuleRunDefinition {
  return definition as unknown as RuleRunDefinition;
}

/*
 * Status page and SLO monitor rules re-sync one status page or SLO instead of
 * walking resources, so they have no entry here - see RuleRunner.
 */
export type SyncRuleRunType =
  | RuleRunType.StatusPageMonitorRule
  | RuleRunType.ServiceLevelObjectiveMonitorRule;

export type ResourceRuleRunType = Exclude<RuleRunType, SyncRuleRunType>;

const RULE_RUN_DEFINITIONS: Record<ResourceRuleRunType, RuleRunDefinition> = {
  [RuleRunType.AlertEpisodeLabelRule]: defineRuleRun({
    ruleModelType: AlertEpisodeLabelRule,
    resourceModelType: AlertEpisode,
    ruleService: AlertEpisodeLabelRuleService,
    resourceService: AlertEpisodeService,
    engine: AlertEpisodeLabelRuleEngineService,
  }),
  [RuleRunType.AlertEpisodeOwnerRule]: defineRuleRun({
    ruleModelType: AlertEpisodeOwnerRule,
    resourceModelType: AlertEpisode,
    ruleService: AlertEpisodeOwnerRuleService,
    resourceService: AlertEpisodeService,
    engine: AlertEpisodeOwnerRuleEngineService,
    ownerModelTypes: [AlertEpisodeOwnerUser, AlertEpisodeOwnerTeam],
  }),
  [RuleRunType.AlertEpisodePrivacyRule]: defineRuleRun({
    ruleModelType: AlertEpisodePrivacyRule,
    resourceModelType: AlertEpisode,
    ruleService: AlertEpisodePrivacyRuleService,
    resourceService: AlertEpisodeService,
    engine: AlertEpisodePrivacyRuleEngineService,
  }),
  [RuleRunType.AlertLabelRule]: defineRuleRun({
    ruleModelType: AlertLabelRule,
    resourceModelType: Alert,
    ruleService: AlertLabelRuleService,
    resourceService: AlertService,
    engine: AlertLabelRuleEngineService,
  }),
  [RuleRunType.AlertOwnerRule]: defineRuleRun({
    ruleModelType: AlertOwnerRule,
    resourceModelType: Alert,
    ruleService: AlertOwnerRuleService,
    resourceService: AlertService,
    engine: AlertOwnerRuleEngineService,
    ownerModelTypes: [AlertOwnerUser, AlertOwnerTeam],
  }),
  [RuleRunType.AlertPrivacyRule]: defineRuleRun({
    ruleModelType: AlertPrivacyRule,
    resourceModelType: Alert,
    ruleService: AlertPrivacyRuleService,
    resourceService: AlertService,
    engine: AlertPrivacyRuleEngineService,
  }),
  [RuleRunType.CephClusterLabelRule]: defineRuleRun({
    ruleModelType: CephClusterLabelRule,
    resourceModelType: CephCluster,
    ruleService: CephClusterLabelRuleService,
    resourceService: CephClusterService,
    engine: CephClusterLabelRuleEngineService,
  }),
  [RuleRunType.CephClusterOwnerRule]: defineRuleRun({
    ruleModelType: CephClusterOwnerRule,
    resourceModelType: CephCluster,
    ruleService: CephClusterOwnerRuleService,
    resourceService: CephClusterService,
    engine: CephClusterOwnerRuleEngineService,
    ownerModelTypes: [CephClusterOwnerUser, CephClusterOwnerTeam],
  }),
  [RuleRunType.CloudResourceLabelRule]: defineRuleRun({
    ruleModelType: CloudResourceLabelRule,
    resourceModelType: CloudResource,
    ruleService: CloudResourceLabelRuleService,
    resourceService: CloudResourceService,
    engine: CloudResourceLabelRuleEngineService,
  }),
  [RuleRunType.CloudResourceOwnerRule]: defineRuleRun({
    ruleModelType: CloudResourceOwnerRule,
    resourceModelType: CloudResource,
    ruleService: CloudResourceOwnerRuleService,
    resourceService: CloudResourceService,
    engine: CloudResourceOwnerRuleEngineService,
    ownerModelTypes: [CloudResourceOwnerUser, CloudResourceOwnerTeam],
  }),
  [RuleRunType.DashboardLabelRule]: defineRuleRun({
    ruleModelType: DashboardLabelRule,
    resourceModelType: Dashboard,
    ruleService: DashboardLabelRuleService,
    resourceService: DashboardService,
    engine: DashboardLabelRuleEngineService,
  }),
  [RuleRunType.DashboardOwnerRule]: defineRuleRun({
    ruleModelType: DashboardOwnerRule,
    resourceModelType: Dashboard,
    ruleService: DashboardOwnerRuleService,
    resourceService: DashboardService,
    engine: DashboardOwnerRuleEngineService,
    ownerModelTypes: [DashboardOwnerUser, DashboardOwnerTeam],
  }),
  [RuleRunType.DatabaseServerLabelRule]: defineRuleRun({
    ruleModelType: DatabaseServerLabelRule,
    resourceModelType: DatabaseServer,
    ruleService: DatabaseServerLabelRuleService,
    resourceService: DatabaseServerService,
    engine: DatabaseServerLabelRuleEngineService,
  }),
  [RuleRunType.DatabaseServerOwnerRule]: defineRuleRun({
    ruleModelType: DatabaseServerOwnerRule,
    resourceModelType: DatabaseServer,
    ruleService: DatabaseServerOwnerRuleService,
    resourceService: DatabaseServerService,
    engine: DatabaseServerOwnerRuleEngineService,
    ownerModelTypes: [DatabaseServerOwnerUser, DatabaseServerOwnerTeam],
  }),
  [RuleRunType.DockerHostLabelRule]: defineRuleRun({
    ruleModelType: DockerHostLabelRule,
    resourceModelType: DockerHost,
    ruleService: DockerHostLabelRuleService,
    resourceService: DockerHostService,
    engine: DockerHostLabelRuleEngineService,
  }),
  [RuleRunType.DockerHostOwnerRule]: defineRuleRun({
    ruleModelType: DockerHostOwnerRule,
    resourceModelType: DockerHost,
    ruleService: DockerHostOwnerRuleService,
    resourceService: DockerHostService,
    engine: DockerHostOwnerRuleEngineService,
    ownerModelTypes: [DockerHostOwnerUser, DockerHostOwnerTeam],
  }),
  [RuleRunType.DockerSwarmClusterLabelRule]: defineRuleRun({
    ruleModelType: DockerSwarmClusterLabelRule,
    resourceModelType: DockerSwarmCluster,
    ruleService: DockerSwarmClusterLabelRuleService,
    resourceService: DockerSwarmClusterService,
    engine: DockerSwarmClusterLabelRuleEngineService,
  }),
  [RuleRunType.DockerSwarmClusterOwnerRule]: defineRuleRun({
    ruleModelType: DockerSwarmClusterOwnerRule,
    resourceModelType: DockerSwarmCluster,
    ruleService: DockerSwarmClusterOwnerRuleService,
    resourceService: DockerSwarmClusterService,
    engine: DockerSwarmClusterOwnerRuleEngineService,
    ownerModelTypes: [DockerSwarmClusterOwnerUser, DockerSwarmClusterOwnerTeam],
  }),
  [RuleRunType.HostLabelRule]: defineRuleRun({
    ruleModelType: HostLabelRule,
    resourceModelType: Host,
    ruleService: HostLabelRuleService,
    resourceService: HostService,
    engine: HostLabelRuleEngineService,
  }),
  [RuleRunType.HostOwnerRule]: defineRuleRun({
    ruleModelType: HostOwnerRule,
    resourceModelType: Host,
    ruleService: HostOwnerRuleService,
    resourceService: HostService,
    engine: HostOwnerRuleEngineService,
    ownerModelTypes: [HostOwnerUser, HostOwnerTeam],
  }),
  [RuleRunType.IncidentEpisodeLabelRule]: defineRuleRun({
    ruleModelType: IncidentEpisodeLabelRule,
    resourceModelType: IncidentEpisode,
    ruleService: IncidentEpisodeLabelRuleService,
    resourceService: IncidentEpisodeService,
    engine: IncidentEpisodeLabelRuleEngineService,
  }),
  [RuleRunType.IncidentEpisodeOwnerRule]: defineRuleRun({
    ruleModelType: IncidentEpisodeOwnerRule,
    resourceModelType: IncidentEpisode,
    ruleService: IncidentEpisodeOwnerRuleService,
    resourceService: IncidentEpisodeService,
    engine: IncidentEpisodeOwnerRuleEngineService,
    ownerModelTypes: [IncidentEpisodeOwnerUser, IncidentEpisodeOwnerTeam],
  }),
  [RuleRunType.IncidentEpisodePrivacyRule]: defineRuleRun({
    ruleModelType: IncidentEpisodePrivacyRule,
    resourceModelType: IncidentEpisode,
    ruleService: IncidentEpisodePrivacyRuleService,
    resourceService: IncidentEpisodeService,
    engine: IncidentEpisodePrivacyRuleEngineService,
  }),
  [RuleRunType.IncidentLabelRule]: defineRuleRun({
    ruleModelType: IncidentLabelRule,
    resourceModelType: Incident,
    ruleService: IncidentLabelRuleService,
    resourceService: IncidentService,
    engine: IncidentLabelRuleEngineService,
  }),
  [RuleRunType.IncidentOwnerRule]: defineRuleRun({
    ruleModelType: IncidentOwnerRule,
    resourceModelType: Incident,
    ruleService: IncidentOwnerRuleService,
    resourceService: IncidentService,
    engine: IncidentOwnerRuleEngineService,
    ownerModelTypes: [IncidentOwnerUser, IncidentOwnerTeam],
  }),
  [RuleRunType.IncidentPrivacyRule]: defineRuleRun({
    ruleModelType: IncidentPrivacyRule,
    resourceModelType: Incident,
    ruleService: IncidentPrivacyRuleService,
    resourceService: IncidentService,
    engine: IncidentPrivacyRuleEngineService,
  }),
  [RuleRunType.IncomingCallPolicyLabelRule]: defineRuleRun({
    ruleModelType: IncomingCallPolicyLabelRule,
    resourceModelType: IncomingCallPolicy,
    ruleService: IncomingCallPolicyLabelRuleService,
    resourceService: IncomingCallPolicyService,
    engine: IncomingCallPolicyLabelRuleEngineService,
  }),
  [RuleRunType.IncomingCallPolicyOwnerRule]: defineRuleRun({
    ruleModelType: IncomingCallPolicyOwnerRule,
    resourceModelType: IncomingCallPolicy,
    ruleService: IncomingCallPolicyOwnerRuleService,
    resourceService: IncomingCallPolicyService,
    engine: IncomingCallPolicyOwnerRuleEngineService,
    ownerModelTypes: [IncomingCallPolicyOwnerUser, IncomingCallPolicyOwnerTeam],
  }),
  [RuleRunType.IoTFleetLabelRule]: defineRuleRun({
    ruleModelType: IoTFleetLabelRule,
    resourceModelType: IoTFleet,
    ruleService: IoTFleetLabelRuleService,
    resourceService: IoTFleetService,
    engine: IoTFleetLabelRuleEngineService,
  }),
  [RuleRunType.IoTFleetOwnerRule]: defineRuleRun({
    ruleModelType: IoTFleetOwnerRule,
    resourceModelType: IoTFleet,
    ruleService: IoTFleetOwnerRuleService,
    resourceService: IoTFleetService,
    engine: IoTFleetOwnerRuleEngineService,
    ownerModelTypes: [IoTFleetOwnerUser, IoTFleetOwnerTeam],
  }),
  [RuleRunType.KubernetesClusterLabelRule]: defineRuleRun({
    ruleModelType: KubernetesClusterLabelRule,
    resourceModelType: KubernetesCluster,
    ruleService: KubernetesClusterLabelRuleService,
    resourceService: KubernetesClusterService,
    engine: KubernetesClusterLabelRuleEngineService,
  }),
  [RuleRunType.KubernetesClusterOwnerRule]: defineRuleRun({
    ruleModelType: KubernetesClusterOwnerRule,
    resourceModelType: KubernetesCluster,
    ruleService: KubernetesClusterOwnerRuleService,
    resourceService: KubernetesClusterService,
    engine: KubernetesClusterOwnerRuleEngineService,
    ownerModelTypes: [KubernetesClusterOwnerUser, KubernetesClusterOwnerTeam],
  }),
  [RuleRunType.MonitorLabelRule]: defineRuleRun({
    ruleModelType: MonitorLabelRule,
    resourceModelType: Monitor,
    ruleService: MonitorLabelRuleService,
    resourceService: MonitorService,
    engine: MonitorLabelRuleEngineService,
  }),
  [RuleRunType.MonitorOwnerRule]: defineRuleRun({
    ruleModelType: MonitorOwnerRule,
    resourceModelType: Monitor,
    ruleService: MonitorOwnerRuleService,
    resourceService: MonitorService,
    engine: MonitorOwnerRuleEngineService,
    ownerModelTypes: [MonitorOwnerUser, MonitorOwnerTeam],
  }),
  [RuleRunType.NetworkDeviceLabelRule]: defineRuleRun({
    ruleModelType: NetworkDeviceLabelRule,
    resourceModelType: NetworkDevice,
    ruleService: NetworkDeviceLabelRuleService,
    resourceService: NetworkDeviceService,
    engine: NetworkDeviceLabelRuleEngineService,
  }),
  [RuleRunType.NetworkDeviceOwnerRule]: defineRuleRun({
    ruleModelType: NetworkDeviceOwnerRule,
    resourceModelType: NetworkDevice,
    ruleService: NetworkDeviceOwnerRuleService,
    resourceService: NetworkDeviceService,
    engine: NetworkDeviceOwnerRuleEngineService,
    ownerModelTypes: [NetworkDeviceOwnerUser, NetworkDeviceOwnerTeam],
  }),
  [RuleRunType.OnCallDutyPolicyLabelRule]: defineRuleRun({
    ruleModelType: OnCallDutyPolicyLabelRule,
    resourceModelType: OnCallDutyPolicy,
    ruleService: OnCallDutyPolicyLabelRuleService,
    resourceService: OnCallDutyPolicyService,
    engine: OnCallDutyPolicyLabelRuleEngineService,
  }),
  [RuleRunType.OnCallDutyPolicyOwnerRule]: defineRuleRun({
    ruleModelType: OnCallDutyPolicyOwnerRule,
    resourceModelType: OnCallDutyPolicy,
    ruleService: OnCallDutyPolicyOwnerRuleService,
    resourceService: OnCallDutyPolicyService,
    engine: OnCallDutyPolicyOwnerRuleEngineService,
    ownerModelTypes: [OnCallDutyPolicyOwnerUser, OnCallDutyPolicyOwnerTeam],
  }),
  [RuleRunType.OnCallDutyPolicyScheduleLabelRule]: defineRuleRun({
    ruleModelType: OnCallDutyPolicyScheduleLabelRule,
    resourceModelType: OnCallDutyPolicySchedule,
    ruleService: OnCallDutyPolicyScheduleLabelRuleService,
    resourceService: OnCallDutyPolicyScheduleService,
    engine: OnCallDutyPolicyScheduleLabelRuleEngineService,
  }),
  [RuleRunType.OnCallDutyPolicyScheduleOwnerRule]: defineRuleRun({
    ruleModelType: OnCallDutyPolicyScheduleOwnerRule,
    resourceModelType: OnCallDutyPolicySchedule,
    ruleService: OnCallDutyPolicyScheduleOwnerRuleService,
    resourceService: OnCallDutyPolicyScheduleService,
    engine: OnCallDutyPolicyScheduleOwnerRuleEngineService,
    ownerModelTypes: [
      OnCallDutyPolicyScheduleOwnerUser,
      OnCallDutyPolicyScheduleOwnerTeam,
    ],
  }),
  [RuleRunType.PodmanHostLabelRule]: defineRuleRun({
    ruleModelType: PodmanHostLabelRule,
    resourceModelType: PodmanHost,
    ruleService: PodmanHostLabelRuleService,
    resourceService: PodmanHostService,
    engine: PodmanHostLabelRuleEngineService,
  }),
  [RuleRunType.PodmanHostOwnerRule]: defineRuleRun({
    ruleModelType: PodmanHostOwnerRule,
    resourceModelType: PodmanHost,
    ruleService: PodmanHostOwnerRuleService,
    resourceService: PodmanHostService,
    engine: PodmanHostOwnerRuleEngineService,
    ownerModelTypes: [PodmanHostOwnerUser, PodmanHostOwnerTeam],
  }),
  [RuleRunType.ProxmoxClusterLabelRule]: defineRuleRun({
    ruleModelType: ProxmoxClusterLabelRule,
    resourceModelType: ProxmoxCluster,
    ruleService: ProxmoxClusterLabelRuleService,
    resourceService: ProxmoxClusterService,
    engine: ProxmoxClusterLabelRuleEngineService,
  }),
  [RuleRunType.ProxmoxClusterOwnerRule]: defineRuleRun({
    ruleModelType: ProxmoxClusterOwnerRule,
    resourceModelType: ProxmoxCluster,
    ruleService: ProxmoxClusterOwnerRuleService,
    resourceService: ProxmoxClusterService,
    engine: ProxmoxClusterOwnerRuleEngineService,
    ownerModelTypes: [ProxmoxClusterOwnerUser, ProxmoxClusterOwnerTeam],
  }),
  [RuleRunType.RumApplicationLabelRule]: defineRuleRun({
    ruleModelType: RumApplicationLabelRule,
    resourceModelType: RumApplication,
    ruleService: RumApplicationLabelRuleService,
    resourceService: RumApplicationService,
    engine: RumApplicationLabelRuleEngineService,
  }),
  [RuleRunType.RumApplicationOwnerRule]: defineRuleRun({
    ruleModelType: RumApplicationOwnerRule,
    resourceModelType: RumApplication,
    ruleService: RumApplicationOwnerRuleService,
    resourceService: RumApplicationService,
    engine: RumApplicationOwnerRuleEngineService,
    ownerModelTypes: [RumApplicationOwnerUser, RumApplicationOwnerTeam],
  }),
  [RuleRunType.RunbookLabelRule]: defineRuleRun({
    ruleModelType: RunbookLabelRule,
    resourceModelType: Runbook,
    ruleService: RunbookLabelRuleService,
    resourceService: RunbookService,
    engine: RunbookLabelRuleEngineService,
  }),
  [RuleRunType.RunbookOwnerRule]: defineRuleRun({
    ruleModelType: RunbookOwnerRule,
    resourceModelType: Runbook,
    ruleService: RunbookOwnerRuleService,
    resourceService: RunbookService,
    engine: RunbookOwnerRuleEngineService,
    ownerModelTypes: [RunbookOwnerUser, RunbookOwnerTeam],
  }),
  [RuleRunType.ScheduledMaintenanceLabelRule]: defineRuleRun({
    ruleModelType: ScheduledMaintenanceLabelRule,
    resourceModelType: ScheduledMaintenance,
    ruleService: ScheduledMaintenanceLabelRuleService,
    resourceService: ScheduledMaintenanceService,
    engine: ScheduledMaintenanceLabelRuleEngineService,
  }),
  [RuleRunType.ScheduledMaintenanceOwnerRule]: defineRuleRun({
    ruleModelType: ScheduledMaintenanceOwnerRule,
    resourceModelType: ScheduledMaintenance,
    ruleService: ScheduledMaintenanceOwnerRuleService,
    resourceService: ScheduledMaintenanceService,
    engine: ScheduledMaintenanceOwnerRuleEngineService,
    ownerModelTypes: [
      ScheduledMaintenanceOwnerUser,
      ScheduledMaintenanceOwnerTeam,
    ],
  }),
  [RuleRunType.ServerlessFunctionLabelRule]: defineRuleRun({
    ruleModelType: ServerlessFunctionLabelRule,
    resourceModelType: ServerlessFunction,
    ruleService: ServerlessFunctionLabelRuleService,
    resourceService: ServerlessFunctionService,
    engine: ServerlessFunctionLabelRuleEngineService,
  }),
  [RuleRunType.ServerlessFunctionOwnerRule]: defineRuleRun({
    ruleModelType: ServerlessFunctionOwnerRule,
    resourceModelType: ServerlessFunction,
    ruleService: ServerlessFunctionOwnerRuleService,
    resourceService: ServerlessFunctionService,
    engine: ServerlessFunctionOwnerRuleEngineService,
    ownerModelTypes: [ServerlessFunctionOwnerUser, ServerlessFunctionOwnerTeam],
  }),
  [RuleRunType.ServiceLabelRule]: defineRuleRun({
    ruleModelType: ServiceLabelRule,
    resourceModelType: Service,
    ruleService: ServiceLabelRuleService,
    resourceService: ServiceService,
    engine: ServiceLabelRuleEngineService,
  }),
  [RuleRunType.ServiceLevelObjectiveLabelRule]: defineRuleRun({
    ruleModelType: ServiceLevelObjectiveLabelRule,
    resourceModelType: ServiceLevelObjective,
    ruleService: ServiceLevelObjectiveLabelRuleService,
    resourceService: ServiceLevelObjectiveService,
    engine: ServiceLevelObjectiveLabelRuleEngineService,
  }),
  [RuleRunType.ServiceLevelObjectiveOwnerRule]: defineRuleRun({
    ruleModelType: ServiceLevelObjectiveOwnerRule,
    resourceModelType: ServiceLevelObjective,
    ruleService: ServiceLevelObjectiveOwnerRuleService,
    resourceService: ServiceLevelObjectiveService,
    engine: ServiceLevelObjectiveOwnerRuleEngineService,
    ownerModelTypes: [
      ServiceLevelObjectiveOwnerUser,
      ServiceLevelObjectiveOwnerTeam,
    ],
  }),
  [RuleRunType.ServiceOwnerRule]: defineRuleRun({
    ruleModelType: ServiceOwnerRule,
    resourceModelType: Service,
    ruleService: ServiceOwnerRuleService,
    resourceService: ServiceService,
    engine: ServiceOwnerRuleEngineService,
    ownerModelTypes: [ServiceOwnerUser, ServiceOwnerTeam],
  }),
  [RuleRunType.StatusPageLabelRule]: defineRuleRun({
    ruleModelType: StatusPageLabelRule,
    resourceModelType: StatusPage,
    ruleService: StatusPageLabelRuleService,
    resourceService: StatusPageService,
    engine: StatusPageLabelRuleEngineService,
  }),
  [RuleRunType.StatusPageOwnerRule]: defineRuleRun({
    ruleModelType: StatusPageOwnerRule,
    resourceModelType: StatusPage,
    ruleService: StatusPageOwnerRuleService,
    resourceService: StatusPageService,
    engine: StatusPageOwnerRuleEngineService,
    ownerModelTypes: [StatusPageOwnerUser, StatusPageOwnerTeam],
  }),
  [RuleRunType.VMwareVCenterLabelRule]: defineRuleRun({
    ruleModelType: VMwareVCenterLabelRule,
    resourceModelType: VMwareVCenter,
    ruleService: VMwareVCenterLabelRuleService,
    resourceService: VMwareVCenterService,
    engine: VMwareVCenterLabelRuleEngineService,
  }),
  [RuleRunType.VMwareVCenterOwnerRule]: defineRuleRun({
    ruleModelType: VMwareVCenterOwnerRule,
    resourceModelType: VMwareVCenter,
    ruleService: VMwareVCenterOwnerRuleService,
    resourceService: VMwareVCenterService,
    engine: VMwareVCenterOwnerRuleEngineService,
    ownerModelTypes: [VMwareVCenterOwnerUser, VMwareVCenterOwnerTeam],
  }),
  [RuleRunType.WorkflowLabelRule]: defineRuleRun({
    ruleModelType: WorkflowLabelRule,
    resourceModelType: Workflow,
    ruleService: WorkflowLabelRuleService,
    resourceService: WorkflowService,
    engine: WorkflowLabelRuleEngineService,
  }),
  [RuleRunType.WorkflowOwnerRule]: defineRuleRun({
    ruleModelType: WorkflowOwnerRule,
    resourceModelType: Workflow,
    ruleService: WorkflowOwnerRuleService,
    resourceService: WorkflowService,
    engine: WorkflowOwnerRuleEngineService,
    ownerModelTypes: [WorkflowOwnerUser, WorkflowOwnerTeam],
  }),
};

export default class RuleRunRegistry {
  public static getDefinition(ruleType: RuleRunType): RuleRunDefinition | null {
    if (RuleRunRegistry.isSyncRuleRunType(ruleType)) {
      return null;
    }

    return RULE_RUN_DEFINITIONS[ruleType] || null;
  }

  // A monitor rule that re-syncs one status page or SLO when it runs.
  public static isSyncRuleRunType(
    ruleType: RuleRunType,
  ): ruleType is SyncRuleRunType {
    return (
      ruleType === RuleRunType.StatusPageMonitorRule ||
      ruleType === RuleRunType.ServiceLevelObjectiveMonitorRule
    );
  }
}
