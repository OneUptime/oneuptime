import {
  getEntitySearchSpecs,
  PaletteEntitySearchSpec,
} from "./DashboardCommandPaletteHelpers";
import { getRecordPageSearchKinds } from "./RecordPageSearchIndex";
import PageMap from "../../Utils/PageMap";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import Alert from "Common/Models/DatabaseModels/Alert";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Form from "Common/Models/DatabaseModels/Form";
import Host from "Common/Models/DatabaseModels/Host";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Service from "Common/Models/DatabaseModels/Service";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import Team from "Common/Models/DatabaseModels/Team";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  getRecordNumberColumns,
  RecordNumberColumns,
} from "Common/Utils/Project/RecordNumber";

/*
 * How Search looks up the records of each kind in RecordPageSearchIndex.ts,
 * to offer their pages (#9204): the model, the column that names a row and
 * the columns searched, as the record search and the kinds' own lists do.
 *
 * A kind left out is still searched on its records' own pages, by its
 * pages' names, and RECORD_KINDS_NOT_LOOKED_UP says why it is not looked up.
 */

export interface RecordPageSearchModel {
  modelType: { new (): DatabaseBaseModel };
  spec: PaletteEntitySearchSpec;
}

/*
 * Kinds whose records Search does not look up, and why. Their pages are
 * still found by name on the records' own pages.
 */
export const RECORD_KINDS_NOT_LOOKED_UP: Readonly<Record<string, string>> = {
  users: "a project's people are its team members, not rows with a name",
  exceptions: "an exception is named by its message, found in Exceptions",
  "data-observability-stores":
    "read through Data Observability's own API, not a model",
  "data-observability-tables":
    "read through Data Observability's own API, not a model",
  "data-pipelines": "a pipeline is named by the job it runs, not a name",
};

interface KindModel {
  modelType: { new (): DatabaseBaseModel };
  titleField?: string | undefined;
  // Rows of the model the kind's product shows, where two products share it.
  filter?: JSONObject | undefined;
}

// The kinds the record search does not cover, by kind id.
const KIND_MODELS: Readonly<Record<string, KindModel>> = {
  monitors: { modelType: Monitor },
  incidents: { modelType: Incident },
  alerts: { modelType: Alert },
  "status-pages": { modelType: StatusPage },
  "on-call-policies": { modelType: OnCallDutyPolicy },
  services: { modelType: Service },
  hosts: { modelType: Host },
  "on-call-schedules": { modelType: OnCallDutyPolicySchedule },
  "scheduled-maintenance": { modelType: ScheduledMaintenance },
  dashboards: { modelType: Dashboard },
  workflows: { modelType: Workflow },
  runbooks: { modelType: Runbook },
  teams: { modelType: Team },
  "incoming-call-policies": { modelType: IncomingCallPolicy },
  "incident-episodes": { modelType: IncidentEpisode, titleField: "title" },
  "alert-episodes": { modelType: AlertEpisode, titleField: "title" },
  announcements: { modelType: StatusPageAnnouncement, titleField: "title" },
  "monitor-groups": { modelType: MonitorGroup },
  slos: { modelType: ServiceLevelObjective },
  "security-cases": { modelType: SecurityCase, titleField: "title" },
  "code-repositories": { modelType: CodeRepository },
  "inventory-items": { modelType: InventoryItem, titleField: "displayName" },
  "database-servers": { modelType: DatabaseServer },
  "message-queues": { modelType: MessageQueue },
  "rum-applications": { modelType: RumApplication },
  "kubernetes-clusters": { modelType: KubernetesCluster },
  "docker-hosts": { modelType: DockerHost },
  "docker-swarm-clusters": { modelType: DockerSwarmCluster },
  "podman-hosts": { modelType: PodmanHost },
  "serverless-functions": { modelType: ServerlessFunction },
  "app-platform-environments": {
    modelType: CloudResource,
    filter: { cloudResourceKind: CloudResourceKind.Environment },
  },
  "cloud-accounts": { modelType: CloudAccount },
  "cloud-resources": {
    modelType: CloudResource,
    filter: { cloudResourceKind: CloudResourceKind.Resource },
  },
  "proxmox-clusters": { modelType: ProxmoxCluster },
  "openstack-clouds": { modelType: OpenStackCloud },
  "vmware-vcenters": { modelType: VMwareVCenter },
  "ceph-clusters": { modelType: CephCluster },
  "storage-arrays": { modelType: StorageArray },
  "network-devices": { modelType: NetworkDevice },
  "network-sites": { modelType: NetworkSite },
  "iot-fleets": { modelType: IoTFleet },
  "data-products": { modelType: DataProduct },
  "data-security-stores": { modelType: DataStore },
  "data-security-issues": { modelType: DataSecurityIssue, titleField: "title" },
  forms: { modelType: Form },
};

let modelsByKind: Map<string, RecordPageSearchModel> | null = null;

/**
 * Each looked-up kind's model and search spec, by kind id: the record
 * search's spec where it has one, so a record is found here as it is there.
 */
export const getRecordPageSearchModels: () => Map<
  string,
  RecordPageSearchModel
> = (): Map<string, RecordPageSearchModel> => {
  if (modelsByKind) {
    return modelsByKind;
  }

  const entitySpecs: Array<PaletteEntitySearchSpec> = getEntitySearchSpecs();
  modelsByKind = new Map<string, RecordPageSearchModel>();

  for (const kind of getRecordPageSearchKinds()) {
    const kindModel: KindModel | undefined = KIND_MODELS[kind.id];

    if (!kindModel) {
      continue;
    }

    const entitySpec: PaletteEntitySearchSpec | undefined = entitySpecs.find(
      (spec: PaletteEntitySearchSpec): boolean => {
        return spec.id === kind.id;
      },
    );

    const titleField: string = kindModel.titleField || "name";
    const numberFields: RecordNumberColumns | null = getRecordNumberColumns(
      new kindModel.modelType(),
    );

    const spec: PaletteEntitySearchSpec = entitySpec || {
      id: kind.id,
      titleField,
      searchFields: [
        titleField,
        ...(numberFields ? [numberFields.numberWithPrefixColumn] : []),
      ],
      viewPageMap: kind.pages[0]!.page as PageMap,
      numberFields: numberFields || undefined,
      icon: IconProp.Search,
      iconColor: "slate",
    };

    modelsByKind.set(kind.id, {
      modelType: kindModel.modelType,
      spec: kindModel.filter ? { ...spec, filter: kindModel.filter } : spec,
    });
  }

  return modelsByKind;
};
