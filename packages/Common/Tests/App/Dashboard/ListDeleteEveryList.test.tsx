import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Delete, on every list it was turned on for.
 *
 * The maintainer asked for Delete in each row's ⋯ menu and in Bulk Actions
 * "for resources that you recommend (usually resources that have bulk
 * actions and are deletable)" - some seventy lists. Each one is a few props
 * on a ModelTable, and every way of getting them wrong still renders a list.
 * So each real page is rendered with ModelTable captured, its props are
 * checked (Delete on, and the right sentence after the question), and then
 * the production ModelTable is drawn with those same props over one row and
 * driven the way a person does it: the row's ⋯, Delete, the dialog, Delete -
 * down to the DELETE request for that row of that model.
 *
 * The shared table's own behaviour (permissions, the bulk run, its results)
 * is tested in Common/Tests/UI/Components/ModelTable; the policy over every
 * list in App/Tests/Dashboard/ListDeletePolicy.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

interface CapturedTable {
  modelType: { new (): BaseModel };
  id?: string | undefined;
  isDeleteable: boolean;
  deleteConfirmationWarning?: string | undefined;
  [key: string]: unknown;
}

let capturedTables: Array<CapturedTable> = [];

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may delete every kind of record listed here.
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

/*
 * The page's ModelTable is captured, not drawn: the pages' other parts
 * (facet bars, summary tiles, banners) are not what this suite is about.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      capturedTables.push(props);
      return <div data-testid="captured-model-table" />;
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import FieldType from "../../../UI/Components/Types/FieldType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import Project from "../../../Models/DatabaseModels/Project";
import API from "../../../UI/Utils/API/API";
import { getDeleteConsequence } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import { ARCHIVE_INSTEAD_OF_DELETE } from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Service from "../../../Models/DatabaseModels/Service";
import Host from "../../../Models/DatabaseModels/Host";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Probe from "../../../Models/DatabaseModels/Probe";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Team from "../../../Models/DatabaseModels/Team";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPostmortemTemplate from "../../../Models/DatabaseModels/IncidentPostmortemTemplate";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import AlertNoteTemplate from "../../../Models/DatabaseModels/AlertNoteTemplate";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import LogPipeline from "../../../Models/DatabaseModels/LogPipeline";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import TracePipeline from "../../../Models/DatabaseModels/TracePipeline";
import TraceDropFilter from "../../../Models/DatabaseModels/TraceDropFilter";
import Form from "../../../Models/DatabaseModels/Form";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";

import StatusPagesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";
import StatusPagesArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Archived";
import WorkflowsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Workflows";
import WorkflowsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Archived";
import DashboardsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Dashboards";
import DashboardsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Dashboards/Archived";
import OnCallDutyPoliciesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies";
import OnCallDutyPoliciesArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPoliciesArchived";
import OnCallDutySchedulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules";
import IncomingCallPoliciesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies";
import SlosPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Slos";
import SlosArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Archived";
import ServicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/Services";
import ServicesArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/Archived";
import HostsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";
import HostsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Archived";
import DockerHostsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Hosts";
import DockerHostsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Archived";
import PodmanHostsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Hosts";
import PodmanHostsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Archived";
import KubernetesClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Clusters";
import KubernetesClustersArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Archived";
import DockerSwarmClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Clusters";
import DockerSwarmClustersArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Archived";
import ProxmoxClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Clusters";
import ProxmoxClustersArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Archived";
import VCentersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/VCenters";
import VCentersArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Archived";
import CephClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Clusters";
import CephClustersArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Archived";
import StorageArraysPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/StorageArrays";
import StorageArraysArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Archived";
import IoTFleetsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Fleets";
import IoTFleetsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Archived";
import ServerlessFunctionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/ServerlessFunctions";
import ServerlessFunctionsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Serverless/Archived";
import DatabasesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Databases";
import DatabasesArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Archived";
import MessageQueuesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/MessageQueues";
import MessageQueuesArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Archived";
import CloudResourcesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/CloudResources";
import MonitoredResourcesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/MonitoredResources";
import CloudArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Archived";
import RumApplicationsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/RumApplications";
import RumApplicationsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/Archived";
import NetworkDevicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import NetworkDevicesArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Archived";
import MonitorGroupsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/MonitorGroup/MonitorGroups";
import RunbooksPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runbooks";
import MonitorProbesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbes";
import MonitorsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Monitors";
import ArchivedMonitorsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/ArchivedMonitors";
import IncidentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Incidents";
import AlertsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Alerts";
import ScheduledMaintenanceEventsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents";
import IncidentEpisodesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Episodes";
import AlertEpisodesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Episodes";
import InventoryItemsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Items";
import InventoryArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Archived";
import TeamsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index";
import APIKeysPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/APIKeys";
import TelemetryIngestionKeysPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/TelemetryIngestionKeys";
import AnnouncementsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Announcements";
import IncidentTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplates";
import IncidentNoteTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentNoteTemplates";
import IncidentPostmortemTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentPostmortemTemplates";
import ScheduledMaintenanceTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";
import ScheduledMaintenanceNoteTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates";
import AlertNoteTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertNoteTemplates";
import StatusPageAnnouncementTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageAnnouncementTemplates";
import SubscriberNotificationTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/SubscriberNotificationTemplates";
import MonitorTemplatesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplates";
import LogPipelinesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/Pipelines";
import LogDropFiltersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/DropFilters";
import TracePipelinesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/Pipelines";
import TraceDropFiltersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/DropFilters";
import FormsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/Forms";
import SecurityCasesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Cases";
import { CLOSE_CASE_INSTEAD_OF_DELETE } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCasesTable";
import MonitorGroupMonitorsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/MonitorGroup/View/Monitors";
import MonitorTemplateViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplatesView";

type RealModelTableType = (props: Record<string, unknown>) => ReactElement;

const RealModelTable: RealModelTableType = (
  jest.requireActual("../../../UI/Components/ModelTable/ModelTable") as {
    default: RealModelTableType;
  }
).default;

const ROW_ID: string = "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ROW_NAME: string = "Row One";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

type PageComponent = (props: PageComponentProps) => ReactElement | null;

interface ListCase {
  name: string;
  page: PageComponent;
  modelType: { new (): BaseModel };
  /*
   * The list's own sentence after the question: on a live archivable list,
   * that archiving is the way off it.
   */
  listWarning?: string | undefined;
  // Which of the page's tables, where it has several.
  tableId?: string | undefined;
}

const live: (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
) => ListCase = (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
): ListCase => {
  return {
    name,
    page: page as PageComponent,
    modelType,
    listWarning: ARCHIVE_INSTEAD_OF_DELETE,
  };
};

// A list whose dialogs end with a sentence of its own.
const saying: (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
  listWarning: string,
) => ListCase = (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
  listWarning: string,
): ListCase => {
  return {
    name,
    page: page as PageComponent,
    modelType,
    listWarning,
  };
};

const plain: (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
  tableId?: string | undefined,
) => ListCase = (
  name: string,
  page: unknown,
  modelType: { new (): BaseModel },
  tableId?: string | undefined,
): ListCase => {
  return {
    name,
    page: page as PageComponent,
    modelType,
    tableId,
  };
};

const LISTS: Array<ListCase> = [
  live("Status Pages", StatusPagesPage, StatusPage),
  plain("Archived Status Pages", StatusPagesArchived, StatusPage),
  live("Workflows", WorkflowsPage, Workflow),
  plain("Archived Workflows", WorkflowsArchived, Workflow),
  live("Dashboards", DashboardsPage, Dashboard),
  plain("Archived Dashboards", DashboardsArchived, Dashboard),
  live("On-Call Policies", OnCallDutyPoliciesPage, OnCallDutyPolicy),
  plain(
    "Archived On-Call Policies",
    OnCallDutyPoliciesArchived,
    OnCallDutyPolicy,
  ),
  plain("On-Call Schedules", OnCallDutySchedulesPage, OnCallDutyPolicySchedule),
  plain("Incoming Call Policies", IncomingCallPoliciesPage, IncomingCallPolicy),
  live("SLOs", SlosPage, ServiceLevelObjective),
  plain("Archived SLOs", SlosArchived, ServiceLevelObjective),
  live("Services", ServicesPage, Service),
  plain("Archived Services", ServicesArchived, Service),
  live("Hosts", HostsPage, Host),
  plain("Archived Hosts", HostsArchived, Host),
  live("Docker Hosts", DockerHostsPage, DockerHost),
  plain("Archived Docker Hosts", DockerHostsArchived, DockerHost),
  live("Podman Hosts", PodmanHostsPage, PodmanHost),
  plain("Archived Podman Hosts", PodmanHostsArchived, PodmanHost),
  live("Kubernetes Clusters", KubernetesClustersPage, KubernetesCluster),
  plain(
    "Archived Kubernetes Clusters",
    KubernetesClustersArchived,
    KubernetesCluster,
  ),
  live("Docker Swarm Clusters", DockerSwarmClustersPage, DockerSwarmCluster),
  plain(
    "Archived Docker Swarm Clusters",
    DockerSwarmClustersArchived,
    DockerSwarmCluster,
  ),
  live("Proxmox Clusters", ProxmoxClustersPage, ProxmoxCluster),
  plain("Archived Proxmox Clusters", ProxmoxClustersArchived, ProxmoxCluster),
  live("vCenters", VCentersPage, VMwareVCenter),
  plain("Archived vCenters", VCentersArchived, VMwareVCenter),
  live("Ceph Clusters", CephClustersPage, CephCluster),
  plain("Archived Ceph Clusters", CephClustersArchived, CephCluster),
  live("Storage Arrays", StorageArraysPage, StorageArray),
  plain("Archived Storage Arrays", StorageArraysArchived, StorageArray),
  live("IoT Fleets", IoTFleetsPage, IoTFleet),
  plain("Archived IoT Fleets", IoTFleetsArchived, IoTFleet),
  live("Serverless Functions", ServerlessFunctionsPage, ServerlessFunction),
  plain(
    "Archived Serverless Functions",
    ServerlessFunctionsArchived,
    ServerlessFunction,
  ),
  live("Databases", DatabasesPage, DatabaseServer),
  plain("Archived Databases", DatabasesArchived, DatabaseServer),
  live("Queues", MessageQueuesPage, MessageQueue),
  plain("Archived Queues", MessageQueuesArchived, MessageQueue),
  live("Cloud Environments", CloudResourcesPage, CloudResource),
  live("Cloud Resources", MonitoredResourcesPage, CloudResource),
  plain("Archived Cloud Resources", CloudArchived, CloudResource),
  live("RUM Applications", RumApplicationsPage, RumApplication),
  plain("Archived RUM Applications", RumApplicationsArchived, RumApplication),
  live("Network Devices", NetworkDevicesPage, NetworkDevice),
  plain("Archived Network Devices", NetworkDevicesArchived, NetworkDevice),
  live("Monitors", MonitorsPage, Monitor),
  plain("Archived Monitors", ArchivedMonitorsPage, Monitor),
  live("Inventory", InventoryItemsPage, InventoryItem),
  plain("Archived Inventory", InventoryArchived, InventoryItem),
  plain("Monitor Groups", MonitorGroupsPage, MonitorGroup),
  plain("Runbooks", RunbooksPage, Runbook),
  plain("Custom Probes", MonitorProbesPage, Probe, "probes-table"),
  plain("Incidents", IncidentsPage, Incident),
  plain("Alerts", AlertsPage, Alert),
  plain(
    "Scheduled Maintenance",
    ScheduledMaintenanceEventsPage,
    ScheduledMaintenance,
  ),
  plain("Incident Episodes", IncidentEpisodesPage, IncidentEpisode),
  plain("Alert Episodes", AlertEpisodesPage, AlertEpisode),
  plain("Teams", TeamsPage, Team),
  plain("API Keys", APIKeysPage, ApiKey),
  plain(
    "Telemetry Ingestion Keys",
    TelemetryIngestionKeysPage,
    TelemetryIngestionKey,
  ),
  plain("Announcements", AnnouncementsPage, StatusPageAnnouncement),
  plain("Incident Templates", IncidentTemplatesPage, IncidentTemplate),
  plain(
    "Incident Note Templates",
    IncidentNoteTemplatesPage,
    IncidentNoteTemplate,
  ),
  plain(
    "Postmortem Templates",
    IncidentPostmortemTemplatesPage,
    IncidentPostmortemTemplate,
  ),
  plain(
    "Scheduled Maintenance Templates",
    ScheduledMaintenanceTemplatesPage,
    ScheduledMaintenanceTemplate,
  ),
  plain(
    "Scheduled Maintenance Note Templates",
    ScheduledMaintenanceNoteTemplatesPage,
    ScheduledMaintenanceNoteTemplate,
  ),
  plain("Alert Note Templates", AlertNoteTemplatesPage, AlertNoteTemplate),
  plain(
    "Announcement Templates",
    StatusPageAnnouncementTemplatesPage,
    StatusPageAnnouncementTemplate,
  ),
  plain(
    "Subscriber Notification Templates",
    SubscriberNotificationTemplatesPage,
    StatusPageSubscriberNotificationTemplate,
  ),
  plain("Monitor Templates", MonitorTemplatesPage, MonitorTemplate),
  plain("Log Pipelines", LogPipelinesPage, LogPipeline),
  plain("Log Drop Filters", LogDropFiltersPage, LogDropFilter),
  plain("Trace Pipelines", TracePipelinesPage, TracePipeline),
  plain("Trace Drop Filters", TraceDropFiltersPage, TraceDropFilter),
  plain("Forms", FormsPage, Form),
  saying(
    "Security Cases",
    SecurityCasesPage,
    SecurityCase,
    CLOSE_CASE_INSTEAD_OF_DELETE,
  ),
];

let deleteRequests: Array<{ tableName: string; id: string }> = [];

type RowOfFunction = (modelType: { new (): BaseModel }) => BaseModel;

// One row of the list's model, named so whichever column names it reads it.
const rowOf: RowOfFunction = (modelType: { new (): BaseModel }): BaseModel => {
  const row: BaseModel = new modelType();
  const values: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  row._id = ROW_ID;
  for (const column of ["name", "title", "templateName", "displayName"]) {
    if (row.hasColumn(column)) {
      values[column] = ROW_NAME;
    }
  }
  if (row.hasColumn("isTeamDeleteable")) {
    values["isTeamDeleteable"] = true;
  }
  return row;
};

let listedModel: { new (): BaseModel } | null = null;

beforeEach(() => {
  capturedTables = [];
  deleteRequests = [];
  listedModel = null;
  goTo(`/dashboard/${PROJECT_ID}/home`);
  window.localStorage.clear();

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const data: Array<BaseModel> =
          listedModel && options.modelType === listedModel
            ? [rowOf(options.modelType)]
            : [];

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
  jest
    .spyOn(ModelAPI, "deleteItem")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        id: ObjectID;
      }): Promise<void> => {
        deleteRequests.push({
          tableName: new options.modelType().tableName || "",
          id: options.id.toString(),
        });
      },
    );
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

type CaptureFunction = (listCase: ListCase) => Promise<CapturedTable>;

// The page's table of the list's model, as the page configures it.
const capture: CaptureFunction = async (
  listCase: ListCase,
): Promise<CapturedTable> => {
  const Page: PageComponent = listCase.page;

  await act(async () => {
    render(
      <MemoryRouter>
        <Page {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });

  const tables: Array<CapturedTable> = capturedTables.filter(
    (table: CapturedTable): boolean => {
      return (
        table.modelType === listCase.modelType &&
        (!listCase.tableId || table.id === listCase.tableId)
      );
    },
  );

  if (tables.length === 0) {
    throw new Error(`${listCase.name} rendered no table of its model.`);
  }

  const table: CapturedTable = tables[tables.length - 1]!;

  cleanup();

  return table;
};

describe.each(LISTS)("$name", (listCase: ListCase) => {
  test("offers Delete, with the right sentence after the question", async () => {
    const table: CapturedTable = await capture(listCase);

    expect(table.isDeleteable).toBe(true);
    expect(table.deleteConfirmationWarning).toBe(listCase.listWarning);
  });

  test("deletes a row through its ⋯ menu and the dialog, by its id", async () => {
    const table: CapturedTable = await capture(listCase);

    listedModel = listCase.modelType;

    render(
      <MemoryRouter>
        <RealModelTable
          {...table}
          // The page's own cells and chrome are not what is tested here.
          columns={[
            { field: { _id: true }, title: "ID", type: FieldType.Text },
          ]}
          filters={[]}
          topContent={undefined}
          query={{}}
          customFieldsModelType={undefined}
          saveFilterProps={undefined}
          disableUrlState={true}
          cardProps={{ title: listCase.name, description: "" }}
        />
      </MemoryRouter>,
    );

    const menuButton: HTMLElement = await screen.findByTestId(
      "row-actions-more-button",
    );

    fireEvent.click(menuButton);

    const deleteItem: HTMLElement = await waitFor(() => {
      const item: HTMLElement | undefined = screen
        .getAllByRole("menuitem")
        .find((candidate: HTMLElement): boolean => {
          return (candidate.textContent || "").trim() === "Delete";
        });

      expect(item).toBeDefined();
      return item!;
    });

    expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(deleteItem);

    const message: HTMLElement = await screen.findByTestId(
      "delete-confirmation-message",
    );

    expect(message).toHaveTextContent(
      `Are you sure you want to delete ${ROW_NAME}?`,
    );

    // What goes with it, then the list's own sentence.
    const expected: string = [
      getDeleteConsequence(new listCase.modelType().tableName),
      listCase.listWarning || "",
    ]
      .filter(Boolean)
      .join(" ");

    if (expected) {
      expect(
        screen.getByTestId("delete-confirmation-consequence"),
      ).toHaveTextContent(expected);
    } else {
      expect(
        screen.queryByTestId("delete-confirmation-consequence"),
      ).toBeNull();
    }

    expect(deleteRequests).toEqual([]);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(deleteRequests).toEqual([
        {
          tableName: new listCase.modelType().tableName,
          id: ROW_ID,
        },
      ]);
    });
  });
});

describe("a monitor group's monitors", () => {
  /*
   * The group's members: the row's action is Remove (it was Unassign), and
   * deleting a monitor from here would delete it everywhere - so Delete is
   * off, in the rows and in Bulk Actions.
   */
  test("offer Remove, not Delete", async () => {
    goTo(`/dashboard/${PROJECT_ID}/monitor-groups/${ROW_ID}/monitors`);

    await act(async () => {
      render(
        <MemoryRouter>
          <MonitorGroupMonitorsPage {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });

    const monitors: Array<CapturedTable> = capturedTables.filter(
      (table: CapturedTable): boolean => {
        return table.modelType === Monitor;
      },
    );

    expect(monitors.length).toBeGreaterThan(0);

    const table: CapturedTable = monitors[monitors.length - 1]!;

    expect(table.isDeleteable).toBe(false);
    /*
     * Remove, between the monitors list's own Enable or Disable (one of
     * the two, by the row) and Archive - never Delete.
     */
    expect(
      (table["actionButtons"] as Array<{ title: string }>).map(
        (action: { title: string }): string => {
          return action.title;
        },
      ),
    ).toEqual(["Enable", "Disable", "Remove", "Archive"]);
  });
});

describe("a monitor template's linked monitors", () => {
  /*
   * The template's members: a row leaves the list with Unlink from
   * Template, and Open in Monitors List takes the same rows to the list
   * where monitors are deleted. Deleting one from here would delete it
   * everywhere, not unlink it - so Delete is off, in the rows and in Bulk
   * Actions.
   */
  beforeEach(() => {
    // The template page reads the project its custom fields belong to.
    const project: Project = new Project();
    project.id = new ObjectID(PROJECT_ID);

    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  test("offer Sync and Unlink, not Delete", async () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors/settings/templates/${ROW_ID}`);

    await act(async () => {
      render(
        <MemoryRouter>
          <MonitorTemplateViewPage {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });

    const monitors: Array<CapturedTable> = capturedTables.filter(
      (table: CapturedTable): boolean => {
        return table.modelType === Monitor;
      },
    );

    expect(monitors.length).toBeGreaterThan(0);

    const table: CapturedTable = monitors[monitors.length - 1]!;

    expect(table.isDeleteable).toBe(false);
    // Between the monitors list's own Enable or Disable and Archive.
    expect(
      (table["actionButtons"] as Array<{ title: string }>).map(
        (action: { title: string }): string => {
          return action.title;
        },
      ),
    ).toEqual([
      "Enable",
      "Disable",
      "Sync from Template",
      "Unlink from Template",
      "Archive",
    ]);
  });

  /*
   * And the production table, given those props, draws neither Delete: not
   * in the row's ⋯ menu, not in Bulk Actions.
   */
  test("draw no Delete in a row's ⋯ menu or in Bulk Actions", async () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors/settings/templates/${ROW_ID}`);

    await act(async () => {
      render(
        <MemoryRouter>
          <MonitorTemplateViewPage {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });

    const monitors: Array<CapturedTable> = capturedTables.filter(
      (table: CapturedTable): boolean => {
        return table.modelType === Monitor;
      },
    );
    const table: CapturedTable = monitors[monitors.length - 1]!;

    cleanup();
    listedModel = Monitor;

    render(
      <MemoryRouter>
        <RealModelTable
          {...table}
          columns={[
            { field: { _id: true }, title: "ID", type: FieldType.Text },
          ]}
          filters={[]}
          topContent={undefined}
          query={{}}
          customFieldsModelType={undefined}
          saveFilterProps={undefined}
          disableUrlState={true}
          cardProps={{ title: "Linked Monitors", description: "" }}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId("row-actions-more-button"));

    const titles: Array<string> = await waitFor(() => {
      const items: Array<HTMLElement> = screen.getAllByRole("menuitem");

      expect(items.length).toBeGreaterThan(0);

      return items.map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });
    });

    expect(titles).toContain("Unlink from Template");
    expect(titles).not.toContain("Delete");

    fireEvent.keyDown(document.activeElement || document.body, {
      key: "Escape",
    });

    /*
     * The monitors table's own bulk actions (labels, owners, archive) keep
     * the row selectable: select the row, then open Bulk Actions.
     */
    const checkbox: HTMLInputElement | null = document.querySelector(
      'tbody input[type="checkbox"]',
    );

    expect(checkbox).not.toBeNull();

    fireEvent.click(checkbox!);

    fireEvent.click(await screen.findByText("Bulk Actions"));

    const bulkTitles: Array<string> = await waitFor(() => {
      const items: Array<HTMLElement> = screen.getAllByRole("menuitem");

      expect(items.length).toBeGreaterThan(0);

      return items.map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });
    });

    expect(bulkTitles).toContain("Archive");
    expect(bulkTitles).not.toContain("Delete");

    expect(deleteRequests).toEqual([]);
  });
});
