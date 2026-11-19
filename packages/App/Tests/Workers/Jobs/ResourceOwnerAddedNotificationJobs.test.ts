import User from "Common/Models/DatabaseModels/User";
import URL from "Common/Types/API/URL";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import { ServerProductOffReason } from "Common/Types/Product/ServerProducts";
import {
  InMemoryOwnerNotificationDeliveries,
  useInMemoryOwnerNotificationDeliveries,
} from "Common/Tests/Helpers/InMemoryOwnerNotificationDeliveries";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE NEW OWNERS OF 23 MORE KINDS OF RECORD ARE TOLD (#9700), AND A
 * NETWORK DEVICE'S AS THE REST OF THE INFRASTRUCTURE'S ARE; AND A MONITOR
 * GROUP'S AND A RUNNER'S, ADDED ON THEIR OWNERS PAGES (#9758).
 *
 * Owner rules of services, RUM applications, databases, queues, hosts,
 * Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware,
 * Ceph, storage arrays, IoT fleets, cloud resources, serverless functions,
 * dashboards, workflows, runbooks, on-call policies and schedules and
 * incoming call policies wrote each owner they added not notified yet when
 * their Notify Owners was on, and an owner added on an Owners page started
 * so too. No job read those rows: Notify Owners promised a message that
 * never came. A job of each now tells them (Workers ResourceOwnersAdded), on
 * the backlog and delivery table every owner-added job runs on;
 * OwnerNotificationJobsSurviveAStop puts them through every crash point,
 * and OwnerAddedProjectMembership through the project's membership. Here,
 * each real job runs with its services standing in for the database:
 *
 *   - a row is told once, through the person's own setting for the job's
 *     event, seeded first, and the next run tells nobody again;
 *   - what each channel says: the email's own template, named by the kind
 *     of record, and literal subject, the text, the call and the push - and
 *     no WhatsApp message, which only an approved template could carry;
 *   - each record's link is its page in the Dashboard - a cloud resource's
 *     in Cloud, a cloud environment's in App Platforms;
 *   - an on-call policy's and an incoming call policy's email says what
 *     owning it means; no other record's does;
 *   - a record that is gone tells nobody;
 *   - while every product of its owner rows is switched off on the server
 *     the job reads and sends nothing, and the rows wait;
 *   - a send that fails is not retried;
 *   - the Workers start every job.
 */

type CronHandler = () => Promise<void>;

// Declared before the hoisted jest.mock below, which may only close over "mock" names.
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// A pre-existing TS5.9 diagnostic in PasswordHash fails any suite that loads it.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: { hash: jest.fn(), verify: jest.fn() },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return { __esModule: true, default: { getDashboardUrl: jest.fn() } };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      sendUserNotification: jest.fn(),
      ensureSettingExistsForUser: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      getUsersInTeams: jest.fn(),
      filterUsersToProjectMembers: jest.fn(),
    },
  };
});

// What is switched off on the server, as each test says.
jest.mock("Common/Server/Utils/ServerProducts/ServerProducts", () => {
  return {
    __esModule: true,
    default: {
      getOffProductOfServerWorkTable: jest.fn(),
      getOffReasonOfServerWork: jest.fn(),
    },
  };
});

import DatabaseConfig from "Common/Server/DatabaseConfig";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import ServerProducts from "Common/Server/Utils/ServerProducts/ServerProducts";
import ServiceOwnerTeamService from "Common/Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "Common/Server/Services/ServiceOwnerUserService";
import ServiceService from "Common/Server/Services/ServiceService";
import DatabaseServerOwnerTeamService from "Common/Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "Common/Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import MessageQueueOwnerTeamService from "Common/Server/Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "Common/Server/Services/MessageQueueOwnerUserService";
import MessageQueueService from "Common/Server/Services/MessageQueueService";
import RumApplicationOwnerTeamService from "Common/Server/Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "Common/Server/Services/RumApplicationOwnerUserService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import HostOwnerTeamService from "Common/Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "Common/Server/Services/HostOwnerUserService";
import HostService from "Common/Server/Services/HostService";
import KubernetesClusterOwnerTeamService from "Common/Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "Common/Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import DockerHostOwnerTeamService from "Common/Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "Common/Server/Services/DockerHostOwnerUserService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerSwarmClusterOwnerTeamService from "Common/Server/Services/DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterOwnerUserService from "Common/Server/Services/DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import PodmanHostOwnerTeamService from "Common/Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "Common/Server/Services/PodmanHostOwnerUserService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import ProxmoxClusterOwnerTeamService from "Common/Server/Services/ProxmoxClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "Common/Server/Services/ProxmoxClusterOwnerUserService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import OpenStackCloudOwnerTeamService from "Common/Server/Services/OpenStackCloudOwnerTeamService";
import OpenStackCloudOwnerUserService from "Common/Server/Services/OpenStackCloudOwnerUserService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import VMwareVCenterOwnerTeamService from "Common/Server/Services/VMwareVCenterOwnerTeamService";
import VMwareVCenterOwnerUserService from "Common/Server/Services/VMwareVCenterOwnerUserService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import CephClusterOwnerTeamService from "Common/Server/Services/CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "Common/Server/Services/CephClusterOwnerUserService";
import CephClusterService from "Common/Server/Services/CephClusterService";
import StorageArrayOwnerTeamService from "Common/Server/Services/StorageArrayOwnerTeamService";
import StorageArrayOwnerUserService from "Common/Server/Services/StorageArrayOwnerUserService";
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import IoTFleetOwnerTeamService from "Common/Server/Services/IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "Common/Server/Services/IoTFleetOwnerUserService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import CloudResourceOwnerTeamService from "Common/Server/Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "Common/Server/Services/CloudResourceOwnerUserService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import ServerlessFunctionOwnerTeamService from "Common/Server/Services/ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "Common/Server/Services/ServerlessFunctionOwnerUserService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import NetworkDeviceOwnerTeamService from "Common/Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import DashboardOwnerTeamService from "Common/Server/Services/DashboardOwnerTeamService";
import DashboardOwnerUserService from "Common/Server/Services/DashboardOwnerUserService";
import DashboardService from "Common/Server/Services/DashboardService";
import WorkflowOwnerTeamService from "Common/Server/Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "Common/Server/Services/WorkflowOwnerUserService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import RunbookOwnerTeamService from "Common/Server/Services/RunbookOwnerTeamService";
import RunbookOwnerUserService from "Common/Server/Services/RunbookOwnerUserService";
import RunbookService from "Common/Server/Services/RunbookService";
import OnCallDutyPolicyOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "Common/Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyScheduleOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleOwnerUserService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerUserService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import IncomingCallPolicyOwnerTeamService from "Common/Server/Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "Common/Server/Services/IncomingCallPolicyOwnerUserService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import MonitorGroupOwnerTeamService from "Common/Server/Services/MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService from "Common/Server/Services/MonitorGroupOwnerUserService";
import MonitorGroupService from "Common/Server/Services/MonitorGroupService";
import RunnerOwnerTeamService from "Common/Server/Services/RunnerOwnerTeamService";
import RunnerOwnerUserService from "Common/Server/Services/RunnerOwnerUserService";
import RunnerService from "Common/Server/Services/RunnerService";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/ServiceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DatabaseServerOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/MessageQueueOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/RumApplicationOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/HostOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/KubernetesClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DockerHostOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DockerSwarmClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/PodmanHostOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ProxmoxClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/OpenStackCloudOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/VMwareVCenterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/CephClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/StorageArrayOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IoTFleetOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/CloudResourceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ServerlessFunctionOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/NetworkDeviceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DashboardOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/WorkflowOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/RunbookOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyScheduleOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncomingCallPolicyOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorGroupOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/RunnerOwners/SendOwnerAddedNotification";

type AnyMock = jest.Mock;

function asMock(fn: unknown): AnyMock {
  return fn as AnyMock;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000d1",
);
const OWNER_ROW_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000e1",
);
const DASHBOARD: string = "https://oneuptime.test/dashboard";

// A name typed by a person, quoting template syntax: it reaches every channel as written.
const TYPED_NAME: string = "checkout_{{ .Values.image.tag }}";

function makeOwner(): User {
  const user: User = new User(
    new ObjectID("11111111-0000-4000-8000-000000000001"),
  );
  user.name = new Name("Ada Owner");
  user.email = new Email("ada@acme.test");
  return user;
}

const OWNER: User = makeOwner();

interface JobCase {
  record: string;
  jobName: string;
  kind: OwnerNotificationKind;
  eventType: NotificationSettingEventType;
  ownerTable: string;
  recordIdColumn: string;
  teamService: unknown;
  userService: unknown;
  recordService: unknown;
  // The record as every channel names it.
  noun: string;
  title: string;
  // Its page in the Dashboard, after the project.
  path: string;
  // What the record is read with besides its name and description.
  fields?: JSONObject | undefined;
  ownershipNote?: string | undefined;
}

const CASES: Array<JobCase> = [
  {
    record: "Service",
    jobName: "ServiceOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ServiceOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "ServiceOwnerUser",
    recordIdColumn: "serviceId",
    teamService: ServiceOwnerTeamService,
    userService: ServiceOwnerUserService,
    recordService: ServiceService,
    noun: "service",
    title: "Service",
    path: "service",
  },
  {
    record: "DatabaseServer",
    jobName: "DatabaseServerOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DatabaseServerOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "DatabaseServerOwnerUser",
    recordIdColumn: "databaseServerId",
    teamService: DatabaseServerOwnerTeamService,
    userService: DatabaseServerOwnerUserService,
    recordService: DatabaseServerService,
    noun: "database",
    title: "Database",
    path: "databases",
  },
  {
    record: "MessageQueue",
    jobName: "MessageQueueOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.MessageQueueOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "MessageQueueOwnerUser",
    recordIdColumn: "messageQueueId",
    teamService: MessageQueueOwnerTeamService,
    userService: MessageQueueOwnerUserService,
    recordService: MessageQueueService,
    noun: "queue",
    title: "Queue",
    path: "queues",
  },
  {
    record: "RumApplication",
    jobName: "RumApplicationOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.RumApplicationOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "RumApplicationOwnerUser",
    recordIdColumn: "rumApplicationId",
    teamService: RumApplicationOwnerTeamService,
    userService: RumApplicationOwnerUserService,
    recordService: RumApplicationService,
    noun: "RUM application",
    title: "RUM Application",
    path: "rum",
  },
  {
    record: "Host",
    jobName: "HostOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.HostOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "HostOwnerUser",
    recordIdColumn: "hostId",
    teamService: HostOwnerTeamService,
    userService: HostOwnerUserService,
    recordService: HostService,
    noun: "host",
    title: "Host",
    path: "host",
  },
  {
    record: "KubernetesCluster",
    jobName: "KubernetesClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.KubernetesClusterOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "KubernetesClusterOwnerUser",
    recordIdColumn: "kubernetesClusterId",
    teamService: KubernetesClusterOwnerTeamService,
    userService: KubernetesClusterOwnerUserService,
    recordService: KubernetesClusterService,
    noun: "Kubernetes cluster",
    title: "Kubernetes Cluster",
    path: "kubernetes",
  },
  {
    record: "DockerHost",
    jobName: "DockerHostOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DockerHostOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "DockerHostOwnerUser",
    recordIdColumn: "dockerHostId",
    teamService: DockerHostOwnerTeamService,
    userService: DockerHostOwnerUserService,
    recordService: DockerHostService,
    noun: "Docker host",
    title: "Docker Host",
    path: "docker",
  },
  {
    record: "DockerSwarmCluster",
    jobName: "DockerSwarmClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DockerSwarmClusterOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "DockerSwarmClusterOwnerUser",
    recordIdColumn: "dockerSwarmClusterId",
    teamService: DockerSwarmClusterOwnerTeamService,
    userService: DockerSwarmClusterOwnerUserService,
    recordService: DockerSwarmClusterService,
    noun: "Docker Swarm cluster",
    title: "Docker Swarm Cluster",
    path: "docker-swarm",
  },
  {
    record: "PodmanHost",
    jobName: "PodmanHostOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.PodmanHostOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "PodmanHostOwnerUser",
    recordIdColumn: "podmanHostId",
    teamService: PodmanHostOwnerTeamService,
    userService: PodmanHostOwnerUserService,
    recordService: PodmanHostService,
    noun: "Podman host",
    title: "Podman Host",
    path: "podman",
  },
  {
    record: "ProxmoxCluster",
    jobName: "ProxmoxClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ProxmoxClusterOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "ProxmoxClusterOwnerUser",
    recordIdColumn: "proxmoxClusterId",
    teamService: ProxmoxClusterOwnerTeamService,
    userService: ProxmoxClusterOwnerUserService,
    recordService: ProxmoxClusterService,
    noun: "Proxmox cluster",
    title: "Proxmox Cluster",
    path: "proxmox",
  },
  {
    record: "OpenStackCloud",
    jobName: "OpenStackCloudOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.OpenStackCloudOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "OpenStackCloudOwnerUser",
    recordIdColumn: "openStackCloudId",
    teamService: OpenStackCloudOwnerTeamService,
    userService: OpenStackCloudOwnerUserService,
    recordService: OpenStackCloudService,
    noun: "OpenStack cloud",
    title: "OpenStack Cloud",
    path: "openstack",
  },
  {
    record: "VMwareVCenter",
    jobName: "VMwareVCenterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.VMwareVCenterOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "VMwareVCenterOwnerUser",
    recordIdColumn: "vmwareVCenterId",
    teamService: VMwareVCenterOwnerTeamService,
    userService: VMwareVCenterOwnerUserService,
    recordService: VMwareVCenterService,
    noun: "VMware vCenter",
    title: "VMware vCenter",
    path: "vmware",
  },
  {
    record: "CephCluster",
    jobName: "CephClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.CephClusterOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "CephClusterOwnerUser",
    recordIdColumn: "cephClusterId",
    teamService: CephClusterOwnerTeamService,
    userService: CephClusterOwnerUserService,
    recordService: CephClusterService,
    noun: "Ceph cluster",
    title: "Ceph Cluster",
    path: "ceph",
  },
  {
    record: "StorageArray",
    jobName: "StorageArrayOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.StorageArrayOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "StorageArrayOwnerUser",
    recordIdColumn: "storageArrayId",
    teamService: StorageArrayOwnerTeamService,
    userService: StorageArrayOwnerUserService,
    recordService: StorageArrayService,
    noun: "storage array",
    title: "Storage Array",
    path: "storage-arrays",
  },
  {
    record: "IoTFleet",
    jobName: "IoTFleetOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.IoTFleetOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "IoTFleetOwnerUser",
    recordIdColumn: "iotFleetId",
    teamService: IoTFleetOwnerTeamService,
    userService: IoTFleetOwnerUserService,
    recordService: IoTFleetService,
    noun: "IoT fleet",
    title: "IoT Fleet",
    path: "iot",
  },
  {
    record: "CloudResource",
    jobName: "CloudResourceOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.CloudResourceOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "CloudResourceOwnerUser",
    recordIdColumn: "cloudResourceId",
    teamService: CloudResourceOwnerTeamService,
    userService: CloudResourceOwnerUserService,
    recordService: CloudResourceService,
    noun: "cloud resource",
    title: "Cloud Resource",
    path: "cloud",
    fields: { cloudResourceKind: CloudResourceKind.Resource },
  },
  {
    record: "ServerlessFunction",
    jobName: "ServerlessFunctionOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ServerlessFunctionOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "ServerlessFunctionOwnerUser",
    recordIdColumn: "serverlessFunctionId",
    teamService: ServerlessFunctionOwnerTeamService,
    userService: ServerlessFunctionOwnerUserService,
    recordService: ServerlessFunctionService,
    noun: "serverless function",
    title: "Serverless Function",
    path: "serverless",
  },
  /*
   * A network device's owners were told under "Added as monitor owner",
   * which no member was given; told now as the rest of the infrastructure's
   * are, by the job's own name.
   */
  {
    record: "NetworkDevice",
    jobName: "NetworkDeviceOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.NetworkDeviceOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "NetworkDeviceOwnerUser",
    recordIdColumn: "networkDeviceId",
    teamService: NetworkDeviceOwnerTeamService,
    userService: NetworkDeviceOwnerUserService,
    recordService: NetworkDeviceService,
    noun: "network device",
    title: "Network Device",
    path: "network-devices",
  },
  {
    record: "Dashboard",
    jobName: "DashboardOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DashboardOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION,
    ownerTable: "DashboardOwnerUser",
    recordIdColumn: "dashboardId",
    teamService: DashboardOwnerTeamService,
    userService: DashboardOwnerUserService,
    recordService: DashboardService,
    noun: "dashboard",
    title: "Dashboard",
    path: "dashboards",
  },
  {
    record: "Workflow",
    jobName: "WorkflowOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.WorkflowOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION,
    ownerTable: "WorkflowOwnerUser",
    recordIdColumn: "workflowId",
    teamService: WorkflowOwnerTeamService,
    userService: WorkflowOwnerUserService,
    recordService: WorkflowService,
    noun: "workflow",
    title: "Workflow",
    path: "workflows",
  },
  {
    record: "Runbook",
    jobName: "RunbookOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.RunbookOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION,
    ownerTable: "RunbookOwnerUser",
    recordIdColumn: "runbookId",
    teamService: RunbookOwnerTeamService,
    userService: RunbookOwnerUserService,
    recordService: RunbookService,
    noun: "runbook",
    title: "Runbook",
    path: "runbooks",
  },
  {
    record: "OnCallDutyPolicy",
    jobName: "OnCallDutyPolicyOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.OnCallDutyPolicyOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_ON_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
    ownerTable: "OnCallDutyPolicyOwnerUser",
    recordIdColumn: "onCallDutyPolicyId",
    teamService: OnCallDutyPolicyOwnerTeamService,
    userService: OnCallDutyPolicyOwnerUserService,
    recordService: OnCallDutyPolicyService,
    noun: "on-call policy",
    title: "On-Call Policy",
    path: "on-call-duty/policies",
    ownershipNote:
      "You are told when a page this on-call policy sends cannot reach someone the way they asked to be reached.",
  },
  {
    record: "OnCallDutyPolicySchedule",
    jobName: "OnCallDutyPolicyScheduleOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.OnCallDutyPolicyScheduleOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_ON_CALL_SCHEDULE_OWNER_ADDED_NOTIFICATION,
    ownerTable: "OnCallDutyPolicyScheduleOwnerUser",
    recordIdColumn: "onCallDutyPolicyScheduleId",
    teamService: OnCallDutyPolicyScheduleOwnerTeamService,
    userService: OnCallDutyPolicyScheduleOwnerUserService,
    recordService: OnCallDutyPolicyScheduleService,
    noun: "on-call schedule",
    title: "On-Call Schedule",
    path: "on-call-duty/schedules",
  },
  {
    record: "IncomingCallPolicy",
    jobName: "IncomingCallPolicyOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.IncomingCallPolicyOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
    ownerTable: "IncomingCallPolicyOwnerUser",
    recordIdColumn: "incomingCallPolicyId",
    teamService: IncomingCallPolicyOwnerTeamService,
    userService: IncomingCallPolicyOwnerUserService,
    recordService: IncomingCallPolicyService,
    noun: "incoming call policy",
    title: "Incoming Call Policy",
    path: "on-call-duty/incoming-call-policies",
    ownershipNote:
      "You are told when a call to this incoming call policy reaches nobody.",
  },
  /*
   * #9758: a monitor group's and a Runner's owners, added on their Owners
   * pages - they have no owner rule - were written not told yet for no job.
   */
  {
    record: "MonitorGroup",
    jobName: "MonitorGroupOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.MonitorGroupOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_MONITOR_GROUP_OWNER_ADDED_NOTIFICATION,
    ownerTable: "MonitorGroupOwnerUser",
    recordIdColumn: "monitorGroupId",
    teamService: MonitorGroupOwnerTeamService,
    userService: MonitorGroupOwnerUserService,
    recordService: MonitorGroupService,
    noun: "monitor group",
    title: "Monitor Group",
    path: "monitor-groups",
  },
  {
    record: "Runner",
    jobName: "RunnerOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.RunnerOwnerAdded,
    eventType:
      NotificationSettingEventType.SEND_RUNNER_OWNER_ADDED_NOTIFICATION,
    ownerTable: "RunnerOwnerUser",
    recordIdColumn: "runnerId",
    teamService: RunnerOwnerTeamService,
    userService: RunnerOwnerUserService,
    recordService: RunnerService,
    noun: "Runner",
    title: "Runner",
    path: "runbooks/runners",
  },
];

const OFF: ServerProductOffReason = ServerProductOffReason.SwitchedOff;

interface World {
  exists: boolean;
  isTaken: boolean;
  takes: number;
}

let world: World;
let table: InMemoryOwnerNotificationDeliveries;

function serviceOf(service: unknown): Record<string, AnyMock> {
  return service as Record<string, AnyMock>;
}

function recordOf(jobCase: JobCase): JSONObject {
  return {
    _id: RECORD_ID.toString(),
    id: RECORD_ID,
    projectId: PROJECT_ID,
    project: { name: "Acme" },
    name: TYPED_NAME,
    description: "Runs the **checkout**",
    ...(jobCase.fields || {}),
  } as unknown as JSONObject;
}

function linkOf(jobCase: JobCase): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/${jobCase.path}/${RECORD_ID.toString()}`;
}

/*
 * One user row of the record, not notified yet: due until a run takes it.
 * The services are the real ones, their reads and the take standing in for
 * the database, so the links are written by the services' own helpers.
 */
function arrange(jobCase: JobCase): void {
  const ownerRow: JSONObject = {
    _id: OWNER_ROW_ID.toString(),
    id: OWNER_ROW_ID,
    [jobCase.recordIdColumn]: RECORD_ID,
    userId: OWNER.id,
    user: OWNER,
  } as unknown as JSONObject;

  jest
    .spyOn(jobCase.teamService as never, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(jobCase.teamService as never, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true as never);
  jest
    .spyOn(jobCase.userService as never, "findBy")
    .mockImplementation((async () => {
      return world.exists && !world.isTaken ? [ownerRow] : [];
    }) as never);
  jest
    .spyOn(jobCase.userService as never, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async () => {
      if (world.isTaken) {
        return false;
      }

      world.isTaken = true;
      world.takes++;
      return true;
    }) as never);

  jest
    .spyOn(jobCase.recordService as never, "findOneById")
    .mockImplementation((async () => {
      return world.exists ? recordOf(jobCase) : null;
    }) as never);
  jest
    .spyOn(jobCase.recordService as never, "findBy")
    .mockImplementation((async () => {
      return world.exists ? [recordOf(jobCase)] : [];
    }) as never);
}

async function runJob(jobCase: JobCase): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[jobCase.jobName];

  if (!handler) {
    throw new Error(`${jobCase.jobName} registered no cron handler.`);
  }

  await handler();
}

type SendData = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

function sends(): Array<SendData> {
  return asMock(
    UserNotificationSettingService.sendUserNotification,
  ).mock.calls.map((call: Array<unknown>): SendData => {
    return call[0] as SendData;
  });
}

function caseOf(record: string): JobCase {
  return CASES.find((jobCase: JobCase): boolean => {
    return jobCase.record === record;
  })!;
}

beforeEach(() => {
  jest.clearAllMocks();

  table = useInMemoryOwnerNotificationDeliveries();
  world = { exists: true, isTaken: false, takes: 0 };

  asMock(DatabaseConfig.getDashboardUrl).mockResolvedValue(
    URL.fromString(DASHBOARD),
  );
  asMock(ServerProducts.getOffProductOfServerWorkTable).mockResolvedValue(null);
  asMock(ServerProducts.getOffReasonOfServerWork).mockResolvedValue(null);
  asMock(TeamMemberService.getUsersInTeams).mockResolvedValue([]);
  asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
    async (data: { users: Array<User> }): Promise<Array<User>> => {
      return data.users;
    },
  );
  asMock(UserNotificationSettingService.sendUserNotification).mockResolvedValue(
    undefined,
  );
  asMock(
    UserNotificationSettingService.ensureSettingExistsForUser,
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)("the new owner of a $record", (jobCase: JobCase) => {
  test("is told once, through their own setting for the event, seeded first", async () => {
    arrange(jobCase);

    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
    expect(sends()[0]!.userId.toString()).toBe(OWNER.id!.toString());
    expect(sends()[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(sends()[0]!.eventType).toBe(jobCase.eventType);

    // The setting is made sure of before the send, for this event.
    const ensure: AnyMock = asMock(
      UserNotificationSettingService.ensureSettingExistsForUser,
    );
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0]![0]).toEqual({
      userId: OWNER.id,
      projectId: PROJECT_ID,
      eventType: jobCase.eventType,
    });
    expect(ensure.mock.invocationCallOrder[0]!).toBeLessThan(
      asMock(UserNotificationSettingService.sendUserNotification).mock
        .invocationCallOrder[0]!,
    );

    // The row is taken, and the delivery says the owner was told, by its kind.
    expect(world.takes).toBe(1);
    expect(table.statusesOf(OWNER_ROW_ID)).toEqual({
      [OWNER.id!.toString().toLowerCase()]:
        OwnerNotificationDeliveryStatus.Sent,
    });
    expect(table.rows[0]!.kind).toBe(jobCase.kind);
    expect(table.rows[0]!.resourceId).toBe(RECORD_ID.toString().toLowerCase());

    // The next run, a minute on, tells nobody again.
    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
    expect(world.takes).toBe(1);
  });

  test("says who was added to what, the same on every channel, the name as its author wrote it", async () => {
    arrange(jobCase);

    await runJob(jobCase);

    const sent: SendData = sends()[0]!;
    const sentence: string = `You have been added as an owner of the ${jobCase.noun} ${TYPED_NAME}`;

    // The email: the template every one of these records shares, its subject never read as a template.
    const email: EmailEnvelope = sent.emailEnvelope;
    expect(email.templateType).toBe(EmailTemplateType.ResourceOwnerAdded);
    expect(email.isSubjectLiteral).toBe(true);
    expect(email.subject).toBe(sentence);
    expect(email.vars).toEqual(
      expect.objectContaining({
        resourceType: jobCase.title,
        resourceNoun: jobCase.noun,
        resourceName: TYPED_NAME,
        projectName: "Acme",
        resourceViewLink: linkOf(jobCase),
      }),
    );
    // The description, a person's Markdown, goes in as the email's HTML.
    expect(email.vars["resourceDescription"]).toContain("<strong>");

    expect(sent.smsMessage.message).toBe(
      `OneUptime: ${sentence}. Turn off in User Settings > Notification Settings.`,
    );
    expect(sent.callRequestMessage.data[0]).toEqual({
      sayMessage: `This is a message from OneUptime. ${sentence}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
    });
    expect(sent.pushNotificationMessage).toEqual(
      expect.objectContaining({
        title: `Added as ${jobCase.title} Owner`,
        body: `You have been added as an owner of the ${jobCase.noun}: ${TYPED_NAME}. Click to view details.`,
        clickAction: linkOf(jobCase),
        tag: `${jobCase.noun.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-owner-added`,
      }),
    );
    /*
     * No WhatsApp template is approved for these events, and WhatsApp sends
     * only approved ones: none is handed over, so the channel is skipped.
     */
    expect(sent.whatsAppMessage).toBeUndefined();
  });

  test("closes its email with what owning it means, or with nothing to say", async () => {
    arrange(jobCase);

    await runJob(jobCase);

    expect(sends()[0]!.emailEnvelope.vars["ownershipNote"]).toBe(
      jobCase.ownershipNote,
    );
  });

  test("tells nobody of a record that is gone, and takes its rows", async () => {
    arrange(jobCase);
    serviceOf(jobCase.recordService)["findOneById"]!.mockResolvedValue(null);
    serviceOf(jobCase.recordService)["findBy"]!.mockResolvedValue([]);

    await runJob(jobCase);

    expect(sends()).toHaveLength(0);
    expect(world.takes).toBe(1);
  });

  test("reads and sends nothing while every product of its owner rows is switched off, and the rows wait", async () => {
    arrange(jobCase);
    asMock(ServerProducts.getOffProductOfServerWorkTable).mockResolvedValue({
      product: ProductKey.Hosts,
      reason: OFF,
    });

    await runJob(jobCase);

    expect(ServerProducts.getOffProductOfServerWorkTable).toHaveBeenCalledWith(
      jobCase.ownerTable,
    );
    expect(serviceOf(jobCase.userService)["findBy"]).not.toHaveBeenCalled();
    expect(serviceOf(jobCase.teamService)["findBy"]).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(0);
    expect(world.takes).toBe(0);

    // Switched on again: the owner is told.
    asMock(ServerProducts.getOffProductOfServerWorkTable).mockResolvedValue(
      null,
    );

    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
  });

  test("tells a person a failing send leaves untold once, and never again", async () => {
    arrange(jobCase);
    asMock(
      UserNotificationSettingService.sendUserNotification,
    ).mockRejectedValue(new Error("The mail server is down"));

    await runJob(jobCase);
    await runJob(jobCase);

    expect(sends()).toHaveLength(1);
    expect(table.statusesOf(OWNER_ROW_ID)).toEqual({
      [OWNER.id!.toString().toLowerCase()]:
        OwnerNotificationDeliveryStatus.Failed,
    });
  });
});

describe("a record with no name", () => {
  test("is named by what it is", async () => {
    const hostCase: JobCase = caseOf("Host");

    arrange(hostCase);
    serviceOf(hostCase.recordService)["findBy"]!.mockResolvedValue([
      { ...recordOf(hostCase), name: undefined },
    ]);

    await runJob(hostCase);

    expect(sends()[0]!.emailEnvelope.subject).toBe(
      "You have been added as an owner of the host host",
    );
  });
});

describe("a cloud resource", () => {
  const cloudCase: JobCase = caseOf("CloudResource");

  test("is Cloud's: named a cloud resource, its link in Cloud", async () => {
    arrange(cloudCase);

    await runJob(cloudCase);

    const sent: SendData = sends()[0]!;

    expect(sent.emailEnvelope.vars["resourceType"]).toBe("Cloud Resource");
    expect(sent.emailEnvelope.vars["resourceViewLink"]).toBe(
      `${DASHBOARD}/${PROJECT_ID.toString()}/cloud/${RECORD_ID.toString()}`,
    );
  });

  test("that is an environment is App Platforms': named a cloud environment, its link there", async () => {
    const environmentCase: JobCase = {
      ...cloudCase,
      noun: "cloud environment",
      title: "Cloud Environment",
      path: "app-platforms",
      fields: { cloudResourceKind: CloudResourceKind.Environment },
    };

    arrange(environmentCase);

    await runJob(environmentCase);

    const sent: SendData = sends()[0]!;
    const link: string = linkOf(environmentCase);

    expect(sent.emailEnvelope.subject).toBe(
      `You have been added as an owner of the cloud environment ${TYPED_NAME}`,
    );
    expect(sent.emailEnvelope.vars["resourceType"]).toBe("Cloud Environment");
    expect(sent.emailEnvelope.vars["resourceViewLink"]).toBe(link);
    expect(sent.pushNotificationMessage.clickAction).toBe(link);
    expect(sent.pushNotificationMessage.tag).toBe(
      "cloud-environment-owner-added",
    );
  });

  test("is read with its kind", async () => {
    arrange(cloudCase);

    await runJob(cloudCase);

    const findBy: AnyMock = serviceOf(cloudCase.recordService)["findBy"]!;

    expect(findBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({
          cloudResourceKind: true,
          name: true,
          description: true,
        }),
      }),
    );
  });
});

describe("the events the owners are told through", () => {
  test("one for every service and piece of infrastructure, and one each for the rest", () => {
    const byEvent: Record<string, Array<string>> = {};

    for (const jobCase of CASES) {
      byEvent[jobCase.eventType] = [
        ...(byEvent[jobCase.eventType] || []),
        jobCase.record,
      ];
    }

    expect(byEvent).toEqual({
      [NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION]:
        [
          "Service",
          "DatabaseServer",
          "MessageQueue",
          "RumApplication",
          "Host",
          "KubernetesCluster",
          "DockerHost",
          "DockerSwarmCluster",
          "PodmanHost",
          "ProxmoxCluster",
          "OpenStackCloud",
          "VMwareVCenter",
          "CephCluster",
          "StorageArray",
          "IoTFleet",
          "CloudResource",
          "ServerlessFunction",
          "NetworkDevice",
        ],
      [NotificationSettingEventType.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION]: [
        "Dashboard",
      ],
      [NotificationSettingEventType.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION]: [
        "Workflow",
      ],
      [NotificationSettingEventType.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION]: [
        "Runbook",
      ],
      [NotificationSettingEventType.SEND_ON_CALL_POLICY_OWNER_ADDED_NOTIFICATION]:
        ["OnCallDutyPolicy"],
      [NotificationSettingEventType.SEND_ON_CALL_SCHEDULE_OWNER_ADDED_NOTIFICATION]:
        ["OnCallDutyPolicySchedule"],
      [NotificationSettingEventType.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION]:
        ["IncomingCallPolicy"],
      [NotificationSettingEventType.SEND_MONITOR_GROUP_OWNER_ADDED_NOTIFICATION]:
        ["MonitorGroup"],
      [NotificationSettingEventType.SEND_RUNNER_OWNER_ADDED_NOTIFICATION]: [
        "Runner",
      ],
    });
  });
});

describe("the Workers", () => {
  test("start every job, each under a name of its own", () => {
    const workers: string = fs.readFileSync(
      path.resolve(__dirname, "../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    for (const jobCase of CASES) {
      expect(workers).toContain(
        `import "./Jobs/${jobCase.record}Owners/SendOwnerAddedNotification";`,
      );
    }

    expect(Object.keys(mockCapturedJobs).sort()).toEqual(
      CASES.map((jobCase: JobCase): string => {
        return jobCase.jobName;
      }).sort(),
    );
    expect(
      new Set(
        CASES.map((jobCase: JobCase) => {
          return jobCase.kind;
        }),
      ).size,
    ).toBe(26);
  });
});

/*
 * A network device's owners used to be told under "Added as monitor
 * owner" - a setting no member is given, so most never were - with a
 * WhatsApp template written for monitors. They are infrastructure's.
 */
describe("a network device's new owner", () => {
  test("is told through the one setting for services and infrastructure, never a monitor's", async () => {
    const deviceCase: JobCase = caseOf("NetworkDevice");

    arrange(deviceCase);

    await runJob(deviceCase);

    expect(sends()[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
    );
    expect(sends()[0]!.eventType).not.toBe(
      NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
    );
    expect(sends()[0]!.whatsAppMessage).toBeUndefined();
    expect(
      asMock(UserNotificationSettingService.ensureSettingExistsForUser),
    ).toHaveBeenCalledTimes(1);
  });
});
