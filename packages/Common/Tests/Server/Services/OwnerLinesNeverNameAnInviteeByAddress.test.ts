import AlertEpisodeOwnerUser from "../../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import CephClusterOwnerUser from "../../../Models/DatabaseModels/CephClusterOwnerUser";
import CloudResourceOwnerUser from "../../../Models/DatabaseModels/CloudResourceOwnerUser";
import DataAssetOwnerUser from "../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataStoreOwnerUser from "../../../Models/DatabaseModels/DataStoreOwnerUser";
import DatabaseServerOwnerUser from "../../../Models/DatabaseModels/DatabaseServerOwnerUser";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHostOwnerUser from "../../../Models/DatabaseModels/DockerHostOwnerUser";
import DockerSwarmClusterOwnerUser from "../../../Models/DatabaseModels/DockerSwarmClusterOwnerUser";
import HostOwnerUser from "../../../Models/DatabaseModels/HostOwnerUser";
import IncidentEpisodeOwnerUser from "../../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import KubernetesClusterOwnerUser from "../../../Models/DatabaseModels/KubernetesClusterOwnerUser";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import OnCallDutyPolicyOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OpenStackCloudOwnerUser from "../../../Models/DatabaseModels/OpenStackCloudOwnerUser";
import PodmanHostOwnerUser from "../../../Models/DatabaseModels/PodmanHostOwnerUser";
import ProxmoxClusterOwnerUser from "../../../Models/DatabaseModels/ProxmoxClusterOwnerUser";
import ScheduledMaintenanceOwnerUser from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import ServiceOwnerUser from "../../../Models/DatabaseModels/ServiceOwnerUser";
import StorageArrayOwnerUser from "../../../Models/DatabaseModels/StorageArrayOwnerUser";
import User from "../../../Models/DatabaseModels/User";
import VMwareVCenterOwnerUser from "../../../Models/DatabaseModels/VMwareVCenterOwnerUser";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import CephClusterFeedService from "../../../Server/Services/CephClusterFeedService";
import CephClusterOwnerUserService from "../../../Server/Services/CephClusterOwnerUserService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import CloudResourceFeedService from "../../../Server/Services/CloudResourceFeedService";
import CloudResourceOwnerUserService from "../../../Server/Services/CloudResourceOwnerUserService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DataAssetFeedService from "../../../Server/Services/DataAssetFeedService";
import DataAssetOwnerUserService from "../../../Server/Services/DataAssetOwnerUserService";
import DataAssetService from "../../../Server/Services/DataAssetService";
import DataSecurityAiProposalService from "../../../Server/Services/DataSecurityAiProposalService";
import DataStoreFeedService from "../../../Server/Services/DataStoreFeedService";
import DataStoreOwnerUserService from "../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerOwnerUserService from "../../../Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostOwnerUserService from "../../../Server/Services/DockerHostOwnerUserService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterFeedService from "../../../Server/Services/DockerSwarmClusterFeedService";
import DockerSwarmClusterOwnerUserService from "../../../Server/Services/DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostFeedService from "../../../Server/Services/HostFeedService";
import HostOwnerUserService from "../../../Server/Services/HostOwnerUserService";
import HostService from "../../../Server/Services/HostService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterOwnerUserService from "../../../Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OpenStackCloudFeedService from "../../../Server/Services/OpenStackCloudFeedService";
import OpenStackCloudOwnerUserService from "../../../Server/Services/OpenStackCloudOwnerUserService";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import PodmanHostFeedService from "../../../Server/Services/PodmanHostFeedService";
import PodmanHostOwnerUserService from "../../../Server/Services/PodmanHostOwnerUserService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterFeedService from "../../../Server/Services/ProxmoxClusterFeedService";
import ProxmoxClusterOwnerUserService from "../../../Server/Services/ProxmoxClusterOwnerUserService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceOwnerUserService from "../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ServiceFeedService from "../../../Server/Services/ServiceFeedService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveOwnerUserService from "../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import ServiceOwnerUserService from "../../../Server/Services/ServiceOwnerUserService";
import ServiceService from "../../../Server/Services/ServiceService";
import StorageArrayFeedService from "../../../Server/Services/StorageArrayFeedService";
import StorageArrayOwnerUserService from "../../../Server/Services/StorageArrayOwnerUserService";
import StorageArrayService from "../../../Server/Services/StorageArrayService";
import UserService from "../../../Server/Services/UserService";
import VMwareVCenterFeedService from "../../../Server/Services/VMwareVCenterFeedService";
import VMwareVCenterOwnerUserService from "../../../Server/Services/VMwareVCenterOwnerUserService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import AlertOnCallRulesOnOwnerChange from "../../../Server/Utils/Alert/AlertOnCallRulesOnOwnerChange";
import {
  FEED_INVITEE_UNNAMED,
  FEED_NOBODY_NAMED,
} from "../../../Server/Utils/Feed/FeedPersonName";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * NO OWNER LINE NAMES ANYBODY BY THEIR EMAIL ADDRESS, ON ANY KIND OF RECORD
 * (#10668, #10669).
 *
 * Adding or removing an owner writes an entry in the record's feed, and the
 * entries of incidents, alerts, episodes, monitors, scheduled maintenance
 * and on-call policies are their channels' lines too: Slack, Microsoft
 * Teams and Mattermost channels, which people outside the project can read.
 * So can a feed, through workflows and the API. An owner can be someone
 * invited who has not joined the project yet (ProjectScopedReferenceValidator
 * accepts a pending membership, and the people pickers offer invitees).
 *
 * The added entry named an invitee with no name typed by the address they
 * were invited at (UserService.getUserMarkdownString), and the removed entry
 * printed every owner's address after their name ("Removed **Ivy**
 * (ivy@acme.test)"), and said nothing at all of a member with no name. Now
 * every one names the owner through FeedPersonName, linked to their page
 * as the added entry always was:
 *
 *   - someone only invited, by the name typed with their invitation, as
 *     text; with none typed, only spaces, or an address typed as the name,
 *     as "someone who hasn't joined the project yet" - never by their
 *     account's own name (#9823) or any address;
 *   - a member, by their name; with none, or one holding an address, by the
 *     part of their address before the "@".
 *
 * The real owner services' hooks run with the real naming; only the reads
 * of the database and the record's own names and links are answered here.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";

const PROJECT_ID: ObjectID = new ObjectID(
  "a1066800-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "a1066800-0000-4000-8000-000000000002",
);
const ROW_ID: ObjectID = new ObjectID("a1066800-0000-4000-8000-000000000003");
// Who adds and removes the owner: a member of the project.
const VALERIA_ID: ObjectID = new ObjectID(
  "a1066800-0000-4000-8000-000000000004",
);
// The owner.
const OWNER_ID: ObjectID = new ObjectID("a1066800-0000-4000-8000-000000000005");

const OWNER_PAGE: string = `${DASHBOARD}/${PROJECT_ID.toString()}/users/${OWNER_ID.toString()}`;

// Every address that may be in play: none of them is ever in a line.
const ADDRESSES: Array<string> = [
  "ivy@acme.test",
  "ivy.invited@acme.test",
  "ana.lee@acme.test",
];

// An owner service's two hooks, as the tests drive them.
type Hooked = {
  onCreateSuccess: (
    onCreate: OnCreate<BaseModel>,
    created: BaseModel,
  ) => Promise<BaseModel>;
  onDeleteSuccess: (
    onDelete: OnDelete<BaseModel>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<BaseModel>>;
};

// A method a hook asks of another service, and what it is answered.
type Stub = [service: unknown, method: string, answer: unknown];

interface OwnerKind {
  label: string;
  service: unknown;
  model: { new (): BaseModel };
  recordIdColumn: string;
  feedService: unknown;
  feedMethod: string;
  stubs: Array<Stub>;
  // Its entries are its channels' lines too.
  isPostedToChannels: boolean;
  /*
   * An owner whose account is gone is said as "Somebody" (an on-call line,
   * #10616), not left out of the feed.
   */
  namesGoneAsSomebody?: boolean | undefined;
}

const LINK: URL = URL.fromString(
  `${DASHBOARD}/${PROJECT_ID.toString()}/records/1`,
);

// What a record's own markdown link reads: "[web-1](...)".
const RECORD_MARKDOWN: unknown = mdText`[web-1](${LINK.toString()})`;

const NUMBER: unknown = { number: 18, numberWithPrefix: "X-18" };

// An infrastructure or catalog record: its feed, its markdown link.
function resourceKind(data: {
  label: string;
  service: unknown;
  model: { new (): BaseModel };
  recordIdColumn: string;
  feedService: unknown;
  feedMethod: string;
  recordService: unknown;
  linkMethod: string;
  extraStubs?: Array<Stub> | undefined;
}): OwnerKind {
  return {
    label: data.label,
    service: data.service,
    model: data.model,
    recordIdColumn: data.recordIdColumn,
    feedService: data.feedService,
    feedMethod: data.feedMethod,
    stubs: [
      [data.recordService, data.linkMethod, RECORD_MARKDOWN],
      ...(data.extraStubs || []),
    ],
    isPostedToChannels: false,
  };
}

const OWNER_KINDS: Array<OwnerKind> = [
  {
    label: "an incident",
    service: IncidentOwnerUserService,
    model: IncidentOwnerUser,
    recordIdColumn: "incidentId",
    feedService: IncidentFeedService,
    feedMethod: "createIncidentFeedItem",
    stubs: [
      [IncidentService, "getIncidentNumber", NUMBER],
      [IncidentService, "getIncidentLinkInDashboard", LINK],
      [IncidentService, "getWorkspaceChannelForIncident", []],
    ],
    isPostedToChannels: true,
  },
  {
    label: "an alert",
    service: AlertOwnerUserService,
    model: AlertOwnerUser,
    recordIdColumn: "alertId",
    feedService: AlertFeedService,
    feedMethod: "createAlertFeedItem",
    stubs: [
      [AlertService, "getAlertNumber", NUMBER],
      [AlertService, "getAlertLinkInDashboard", LINK],
      [AlertService, "getWorkspaceChannelForAlert", []],
      [AlertOnCallRulesOnOwnerChange, "onOwnersChanged", undefined],
    ],
    isPostedToChannels: true,
  },
  {
    label: "an incident episode",
    service: IncidentEpisodeOwnerUserService,
    model: IncidentEpisodeOwnerUser,
    recordIdColumn: "incidentEpisodeId",
    feedService: IncidentEpisodeFeedService,
    feedMethod: "createIncidentEpisodeFeedItem",
    stubs: [
      [IncidentEpisodeService, "getEpisodeNumber", NUMBER],
      [IncidentEpisodeService, "getEpisodeLinkInDashboard", LINK],
      [IncidentEpisodeService, "findOneById", null],
    ],
    isPostedToChannels: true,
  },
  {
    label: "an alert episode",
    service: AlertEpisodeOwnerUserService,
    model: AlertEpisodeOwnerUser,
    recordIdColumn: "alertEpisodeId",
    feedService: AlertEpisodeFeedService,
    feedMethod: "createAlertEpisodeFeedItem",
    stubs: [
      [AlertEpisodeService, "getEpisodeNumber", NUMBER],
      [AlertEpisodeService, "getEpisodeLinkInDashboard", LINK],
      [AlertEpisodeService, "findOneById", null],
    ],
    isPostedToChannels: true,
  },
  {
    label: "a monitor",
    service: MonitorOwnerUserService,
    model: MonitorOwnerUser,
    recordIdColumn: "monitorId",
    feedService: MonitorFeedService,
    feedMethod: "createMonitorFeedItem",
    stubs: [
      [MonitorService, "getMonitorName", "Checkout"],
      [MonitorService, "getMonitorLinkInDashboard", LINK],
      [MonitorService, "getWorkspaceChannelForMonitor", []],
    ],
    isPostedToChannels: true,
  },
  {
    label: "a scheduled maintenance event",
    service: ScheduledMaintenanceOwnerUserService,
    model: ScheduledMaintenanceOwnerUser,
    recordIdColumn: "scheduledMaintenanceId",
    feedService: ScheduledMaintenanceFeedService,
    feedMethod: "createScheduledMaintenanceFeedItem",
    stubs: [
      [
        ScheduledMaintenanceService,
        "getWorkspaceChannelForScheduledMaintenance",
        [],
      ],
    ],
    // Its owner entries stay in its feed.
    isPostedToChannels: false,
  },
  {
    label: "an on-call policy",
    service: OnCallDutyPolicyOwnerUserService,
    model: OnCallDutyPolicyOwnerUser,
    recordIdColumn: "onCallDutyPolicyId",
    feedService: OnCallDutyPolicyFeedService,
    feedMethod: "createOnCallDutyPolicyFeedItem",
    stubs: [
      [OnCallDutyPolicyService, "getOnCallDutyPolicyName", "Payments"],
      [OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard", LINK],
      [OnCallDutyPolicyService, "getWorkspaceChannelForOnCallDutyPolicy", []],
    ],
    isPostedToChannels: true,
    namesGoneAsSomebody: true,
  },
  {
    label: "an SLO",
    service: ServiceLevelObjectiveOwnerUserService,
    model: ServiceLevelObjectiveOwnerUser,
    recordIdColumn: "serviceLevelObjectiveId",
    feedService: ServiceLevelObjectiveFeedService,
    feedMethod: "createServiceLevelObjectiveFeedItem",
    stubs: [
      [ServiceLevelObjectiveService, "getSloMarkdownLink", RECORD_MARKDOWN],
    ],
    isPostedToChannels: false,
  },
  resourceKind({
    label: "a service",
    service: ServiceOwnerUserService,
    model: ServiceOwnerUser,
    recordIdColumn: "serviceId",
    feedService: ServiceFeedService,
    feedMethod: "createServiceFeedItem",
    recordService: ServiceService,
    linkMethod: "getServiceMarkdownLink",
  }),
  resourceKind({
    label: "a host",
    service: HostOwnerUserService,
    model: HostOwnerUser,
    recordIdColumn: "hostId",
    feedService: HostFeedService,
    feedMethod: "createHostFeedItem",
    recordService: HostService,
    linkMethod: "getHostMarkdownLink",
  }),
  resourceKind({
    label: "a Docker host",
    service: DockerHostOwnerUserService,
    model: DockerHostOwnerUser,
    recordIdColumn: "dockerHostId",
    feedService: DockerHostFeedService,
    feedMethod: "createDockerHostFeedItem",
    recordService: DockerHostService,
    linkMethod: "getDockerHostMarkdownLink",
  }),
  resourceKind({
    label: "a Docker Swarm cluster",
    service: DockerSwarmClusterOwnerUserService,
    model: DockerSwarmClusterOwnerUser,
    recordIdColumn: "dockerSwarmClusterId",
    feedService: DockerSwarmClusterFeedService,
    feedMethod: "createDockerSwarmClusterFeedItem",
    recordService: DockerSwarmClusterService,
    linkMethod: "getDockerSwarmClusterMarkdownLink",
  }),
  resourceKind({
    label: "a Kubernetes cluster",
    service: KubernetesClusterOwnerUserService,
    model: KubernetesClusterOwnerUser,
    recordIdColumn: "kubernetesClusterId",
    feedService: KubernetesClusterFeedService,
    feedMethod: "createKubernetesClusterFeedItem",
    recordService: KubernetesClusterService,
    linkMethod: "getKubernetesClusterMarkdownLink",
  }),
  resourceKind({
    label: "a Podman host",
    service: PodmanHostOwnerUserService,
    model: PodmanHostOwnerUser,
    recordIdColumn: "podmanHostId",
    feedService: PodmanHostFeedService,
    feedMethod: "createPodmanHostFeedItem",
    recordService: PodmanHostService,
    linkMethod: "getPodmanHostMarkdownLink",
  }),
  resourceKind({
    label: "a Proxmox cluster",
    service: ProxmoxClusterOwnerUserService,
    model: ProxmoxClusterOwnerUser,
    recordIdColumn: "proxmoxClusterId",
    feedService: ProxmoxClusterFeedService,
    feedMethod: "createProxmoxClusterFeedItem",
    recordService: ProxmoxClusterService,
    linkMethod: "getProxmoxClusterMarkdownLink",
  }),
  resourceKind({
    label: "a VMware vCenter",
    service: VMwareVCenterOwnerUserService,
    model: VMwareVCenterOwnerUser,
    recordIdColumn: "vmwareVCenterId",
    feedService: VMwareVCenterFeedService,
    feedMethod: "createVMwareVCenterFeedItem",
    recordService: VMwareVCenterService,
    linkMethod: "getVMwareVCenterMarkdownLink",
  }),
  resourceKind({
    label: "an OpenStack cloud",
    service: OpenStackCloudOwnerUserService,
    model: OpenStackCloudOwnerUser,
    recordIdColumn: "openStackCloudId",
    feedService: OpenStackCloudFeedService,
    feedMethod: "createOpenStackCloudFeedItem",
    recordService: OpenStackCloudService,
    linkMethod: "getOpenStackCloudMarkdownLink",
  }),
  resourceKind({
    label: "a Ceph cluster",
    service: CephClusterOwnerUserService,
    model: CephClusterOwnerUser,
    recordIdColumn: "cephClusterId",
    feedService: CephClusterFeedService,
    feedMethod: "createCephClusterFeedItem",
    recordService: CephClusterService,
    linkMethod: "getCephClusterMarkdownLink",
  }),
  resourceKind({
    label: "a storage array",
    service: StorageArrayOwnerUserService,
    model: StorageArrayOwnerUser,
    recordIdColumn: "storageArrayId",
    feedService: StorageArrayFeedService,
    feedMethod: "createStorageArrayFeedItem",
    recordService: StorageArrayService,
    linkMethod: "getStorageArrayMarkdownLink",
  }),
  resourceKind({
    label: "a database server",
    service: DatabaseServerOwnerUserService,
    model: DatabaseServerOwnerUser,
    recordIdColumn: "databaseServerId",
    feedService: DatabaseServerFeedService,
    feedMethod: "createDatabaseServerFeedItem",
    recordService: DatabaseServerService,
    linkMethod: "getDatabaseServerMarkdownLink",
    extraStubs: [
      [DatabaseServerService, "forgetAutomaticAssignments", undefined],
    ],
  }),
  resourceKind({
    label: "a data store",
    service: DataStoreOwnerUserService,
    model: DataStoreOwnerUser,
    recordIdColumn: "dataStoreId",
    feedService: DataStoreFeedService,
    feedMethod: "createDataStoreFeedItem",
    recordService: DataStoreService,
    linkMethod: "getDataStoreMarkdownLink",
    extraStubs: [
      [DataSecurityAiProposalService, "expireWaitingOwnersForStore", undefined],
    ],
  }),
  resourceKind({
    label: "a data asset",
    service: DataAssetOwnerUserService,
    model: DataAssetOwnerUser,
    recordIdColumn: "dataAssetId",
    feedService: DataAssetFeedService,
    feedMethod: "createDataAssetFeedItem",
    recordService: DataAssetService,
    linkMethod: "getDataAssetMarkdownLink",
  }),
  resourceKind({
    label: "a cloud resource",
    service: CloudResourceOwnerUserService,
    model: CloudResourceOwnerUser,
    recordIdColumn: "cloudResourceId",
    feedService: CloudResourceFeedService,
    feedMethod: "createCloudResourceFeedItem",
    recordService: CloudResourceService,
    linkMethod: "getCloudResourceMarkdownLink",
  }),
];

// Who the owner is: their account, and their invitation if they have one.
interface OwnerCase {
  label: string;
  account: { name?: string | undefined; email: string };
  // Set: only invited to the project, with what the invitation kept.
  invitation?: WithheldProfile | undefined;
  // How every line names them.
  named: string;
  // As a link to their page (a member), or as text (someone only invited).
  isLinked: boolean;
}

const OWNER_CASES: Array<OwnerCase> = [
  {
    label: "someone only invited, with a name typed",
    account: { name: "Ivy Account", email: "ivy@acme.test" },
    invitation: {
      inviteeName: "Ivy from Payments",
      inviteeEmail: "ivy.invited@acme.test",
    },
    named: "Ivy from Payments",
    isLinked: false,
  },
  {
    label: "someone only invited, with no name typed",
    account: { name: "Ivy Account", email: "ivy@acme.test" },
    invitation: { inviteeName: null, inviteeEmail: "ivy.invited@acme.test" },
    named: FEED_INVITEE_UNNAMED,
    isLinked: false,
  },
  {
    label: "someone only invited, with spaces typed as the name",
    account: { name: "Ivy Account", email: "ivy@acme.test" },
    invitation: { inviteeName: "   ", inviteeEmail: "ivy.invited@acme.test" },
    named: FEED_INVITEE_UNNAMED,
    isLinked: false,
  },
  {
    label: "someone only invited, with an address typed as the name",
    account: { name: "Ivy Account", email: "ivy@acme.test" },
    invitation: {
      inviteeName: "ivy.invited@acme.test",
      inviteeEmail: "ivy.invited@acme.test",
    },
    named: FEED_INVITEE_UNNAMED,
    isLinked: false,
  },
  {
    label: "someone only invited, with no address kept by the invitation",
    account: { name: "Ivy Account", email: "ivy@acme.test" },
    invitation: { inviteeName: null },
    named: FEED_INVITEE_UNNAMED,
    isLinked: false,
  },
  {
    label: "a member",
    account: { name: "Ana Lee", email: "ana.lee@acme.test" },
    named: "Ana Lee",
    isLinked: true,
  },
  {
    label: "a member with no name",
    account: { email: "ana.lee@acme.test" },
    named: "ana.lee",
    isLinked: true,
  },
  {
    label: "a member whose name is their address",
    account: { name: "ana.lee@acme.test", email: "ana.lee@acme.test" },
    named: "ana.lee",
    isLinked: true,
  },
];

const memberProps: (userId: ObjectID) => DatabaseCommonInteractionProps = (
  userId: ObjectID,
): DatabaseCommonInteractionProps => {
  return { tenantId: PROJECT_ID, userId: userId };
};

let owner: User | null = null;
let feedCalls: Array<Record<string, unknown>> = [];

// The owner's account, as OneUptime reads it.
const accountOf: (person: OwnerCase["account"]) => User = (
  person: OwnerCase["account"],
): User => {
  const user: User = new User();
  user._id = OWNER_ID.toString();

  if (person.name !== undefined) {
    user.name = new Name(person.name);
  }

  user.email = new Email(person.email);
  return user;
};

const answerUsersBy: (id: unknown) => User | null = (
  id: unknown,
): User | null => {
  return id && String(id).toLowerCase() === OWNER_ID.toString()
    ? owner
    : null;
};

beforeEach(() => {
  feedCalls = [];
  owner = null;

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));
  jest.spyOn(UserService, "findOneBy").mockImplementation((async (findBy: {
    query: { _id?: unknown };
  }) => {
    return answerUsersBy(findBy.query._id);
  }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (findBy: {
    id: unknown;
  }) => {
    return answerUsersBy(findBy.id);
  }) as never);

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteOwnersIsTrue",
    )
    .mockResolvedValue([]);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The kind's writes: the feed entry it asks for, and what its hooks read.
const spyOwnerWrites: (kind: OwnerKind) => void = (kind: OwnerKind): void => {
  jest
    .spyOn(
      kind.feedService as Record<string, () => Promise<void>>,
      kind.feedMethod,
    )
    .mockImplementation((async (data: Record<string, unknown>) => {
      feedCalls.push(data);
    }) as never);

  for (const [service, method, answer] of kind.stubs) {
    jest
      .spyOn(service as Record<string, () => unknown>, method)
      .mockResolvedValue(answer as never);
  }
};

// Who of the people asked about is only invited, as the case says.
const inviteAs: (invitation: WithheldProfile | undefined) => void = (
  invitation: WithheldProfile | undefined,
): void => {
  jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation(
      async (data: {
        userIds: Array<string>;
      }): Promise<Map<string, WithheldProfile>> => {
        const withheld: Map<string, WithheldProfile> = new Map<
          string,
          WithheldProfile
        >();

        for (const userId of data.userIds) {
          if (invitation && userId.toLowerCase() === OWNER_ID.toString()) {
            withheld.set(userId.toLowerCase(), invitation);
          }
        }

        return withheld;
      },
    );
};

const ownerRow: (kind: OwnerKind) => BaseModel = (
  kind: OwnerKind,
): BaseModel => {
  const row: BaseModel = new kind.model();
  row._id = ROW_ID.toString();
  row.setColumnValue("projectId", PROJECT_ID);
  row.setColumnValue("userId", OWNER_ID);
  row.setColumnValue(kind.recordIdColumn, RECORD_ID);
  return row;
};

// Valeria adds the owner, then takes them off: the two entries written.
const addAndRemove: (
  kind: OwnerKind,
) => Promise<{ added: string; removed: string }> = async (
  kind: OwnerKind,
): Promise<{ added: string; removed: string }> => {
  const hooks: Hooked = kind.service as unknown as Hooked;

  const added: BaseModel = ownerRow(kind);
  added.setColumnValue("createdByUserId", VALERIA_ID);

  await hooks.onCreateSuccess(
    {
      createBy: { data: added, props: memberProps(VALERIA_ID) },
      carryForward: null,
    } as OnCreate<BaseModel>,
    added,
  );

  await hooks.onDeleteSuccess(
    {
      deleteBy: {
        query: {},
        limit: 1,
        skip: 0,
        props: memberProps(VALERIA_ID),
      },
      carryForward: { itemsToDelete: [ownerRow(kind)] },
    } as OnDelete<BaseModel>,
    [ROW_ID],
  );

  expect(feedCalls).toHaveLength(2);

  return {
    added: String(feedCalls[0]!["feedInfoInMarkdown"]),
    removed: String(feedCalls[1]!["feedInfoInMarkdown"]),
  };
};

describe.each(OWNER_KINDS)("the owner lines of $label", (kind: OwnerKind) => {
  beforeEach(() => {
    spyOwnerWrites(kind);
  });

  test.each(OWNER_CASES)(
    "$label: named the same when added and when removed, and never by an address",
    async (person: OwnerCase) => {
      owner = accountOf(person.account);
      inviteAs(person.invitation);

      const { added, removed } = await addAndRemove(kind);

      // A link to their page for a member; text for someone only invited.
      const name: string = person.isLinked
        ? `**[${person.named}](${OWNER_PAGE})**`
        : `**${person.named}**`;

      expect(added).toContain(`Added ${name}`);
      expect(removed).toContain(`Removed ${name}`);

      for (const entry of [added, removed]) {
        for (const address of ADDRESSES) {
          expect({ entry, address, isIn: entry.includes(address) }).toEqual({
            entry,
            address,
            isIn: false,
          });
        }

        // Someone pending is never named by their account's own name (#9823).
        expect(entry).not.toContain("Ivy Account");
        // Nor linked: a name an inviter typed links to nobody's page.
        if (!person.isLinked) {
          expect(entry).not.toContain(OWNER_PAGE);
        }
      }
    },
  );

  test("whether the owner is only invited cannot be read: they are Somebody, never something that could be their address", async () => {
    owner = accountOf({ name: "Ivy Account", email: "ivy@acme.test" });

    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockRejectedValue(new Error("the database is away"));

    const { added, removed } = await addAndRemove(kind);

    expect(added).toContain(`Added **${FEED_NOBODY_NAMED}**`);
    expect(removed).toContain(`Removed **${FEED_NOBODY_NAMED}**`);

    for (const entry of [added, removed]) {
      expect(entry).not.toContain("ivy@acme.test");
      expect(entry).not.toContain("Ivy Account");
    }
  });

  test("an owner who no longer exists is never named by what is left of them", async () => {
    owner = null;
    inviteAs(undefined);

    const hooks: Hooked = kind.service as unknown as Hooked;

    await hooks.onDeleteSuccess(
      {
        deleteBy: {
          query: {},
          limit: 1,
          skip: 0,
          props: memberProps(VALERIA_ID),
        },
        carryForward: { itemsToDelete: [ownerRow(kind)] },
      } as OnDelete<BaseModel>,
      [ROW_ID],
    );

    if (kind.namesGoneAsSomebody) {
      expect(feedCalls).toHaveLength(1);
      expect(String(feedCalls[0]!["feedInfoInMarkdown"])).toContain(
        `Removed **${FEED_NOBODY_NAMED}**`,
      );
    } else {
      expect(feedCalls).toHaveLength(0);
    }
  });

  if (kind.isPostedToChannels) {
    test("the entry is the channels' line: it is posted, opening with whoever made the change", async () => {
      owner = accountOf({ email: "ana.lee@acme.test" });
      inviteAs(undefined);

      await addAndRemove(kind);

      for (const call of feedCalls) {
        expect(call["workspaceNotification"]).toMatchObject({
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        });
        expect(String(call["userId"])).toBe(VALERIA_ID.toString());
      }
    });
  }
});

describe("every kind of record whose owner lines are written is here", () => {
  test("twenty-three kinds, each once", () => {
    const labels: Array<string> = OWNER_KINDS.map(
      (kind: OwnerKind): string => {
        return kind.label;
      },
    );

    expect(new Set<string>(labels).size).toBe(23);
  });
});
