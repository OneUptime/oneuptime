import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import CephClusterService from "../../Services/CephClusterService";
import CloudResourceService from "../../Services/CloudResourceService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DatabaseService from "../../Services/DatabaseService";
import DockerHostService from "../../Services/DockerHostService";
import DockerSwarmClusterService from "../../Services/DockerSwarmClusterService";
import HostService from "../../Services/HostService";
import IoTFleetService from "../../Services/IoTFleetService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import PodmanHostService from "../../Services/PodmanHostService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import RumApplicationService from "../../Services/RumApplicationService";
import ServerlessFunctionService from "../../Services/ServerlessFunctionService";
import ServiceService from "../../Services/ServiceService";
import StorageArrayService from "../../Services/StorageArrayService";
import VMwareVCenterService from "../../Services/VMwareVCenterService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * The names of the resources telemetry usage is counted for.
 *
 * A usage row's primaryEntityId is polymorphic, as on every telemetry row:
 * primaryEntityType says which table it names (the Dashboard's
 * TelemetryEntityNames resolves them the same way, in the browser). Usage is
 * counted only for the kinds below - monitor, alert, incident, SLO and Data
 * Observability telemetry is OneUptime's own and never counted
 * (TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES) - and the unattributed bucket
 * (Unknown, its id the project's) has no row to name it.
 *
 * Each kind is read with the props it is handed: a project member's, so a
 * kind they may not read stays unnamed (its refusal is not the page's), and
 * a label-limited grant names only what it reaches; root for the instance
 * admin, who reads every project.
 */

interface ResourceNameSource {
  service: DatabaseService<BaseModel>;
  // Columns tried in order for the display name.
  nameFields: Array<string>;
}

const asSource: (
  service: unknown,
  nameFields: Array<string>,
) => ResourceNameSource = (
  service: unknown,
  nameFields: Array<string>,
): ResourceNameSource => {
  return {
    service: service as DatabaseService<BaseModel>,
    nameFields: nameFields,
  };
};

export const TELEMETRY_USAGE_RESOURCE_NAME_SOURCES: Partial<
  Record<ServiceType, ResourceNameSource>
> = {
  [ServiceType.OpenTelemetry]: asSource(ServiceService, ["name"]),
  [ServiceType.RealUserMonitor]: asSource(RumApplicationService, [
    "name",
    "appIdentifier",
  ]),
  [ServiceType.Host]: asSource(HostService, ["name", "hostIdentifier"]),
  [ServiceType.DockerHost]: asSource(DockerHostService, [
    "name",
    "hostIdentifier",
  ]),
  [ServiceType.PodmanHost]: asSource(PodmanHostService, [
    "name",
    "hostIdentifier",
  ]),
  [ServiceType.KubernetesCluster]: asSource(KubernetesClusterService, [
    "name",
    "clusterIdentifier",
  ]),
  [ServiceType.ProxmoxCluster]: asSource(ProxmoxClusterService, ["name"]),
  [ServiceType.OpenStackCloud]: asSource(OpenStackCloudService, ["name"]),
  [ServiceType.CephCluster]: asSource(CephClusterService, ["name"]),
  [ServiceType.StorageArray]: asSource(StorageArrayService, ["name"]),
  [ServiceType.DockerSwarmCluster]: asSource(DockerSwarmClusterService, [
    "name",
  ]),
  [ServiceType.VMwareVCenter]: asSource(VMwareVCenterService, ["name"]),
  // An IoTDevice row carries its fleet's id (OtelIngestBaseService).
  [ServiceType.IoTDevice]: asSource(IoTFleetService, ["name"]),
  [ServiceType.ServerlessFunction]: asSource(ServerlessFunctionService, [
    "name",
    "functionIdentifier",
  ]),
  [ServiceType.CloudResource]: asSource(CloudResourceService, [
    "name",
    "resourceIdentifier",
  ]),
  [ServiceType.DatabaseServer]: asSource(DatabaseServerService, ["name"]),
  [ServiceType.NetworkDevice]: asSource(NetworkDeviceService, [
    "name",
    "hostname",
  ]),
};

export interface TelemetryUsageResourceRef {
  primaryEntityId: string;
  primaryEntityType: ServiceType | null;
}

const readName: (
  record: BaseModel,
  nameFields: Array<string>,
) => string | null = (
  record: BaseModel,
  nameFields: Array<string>,
): string | null => {
  const values: JSONObject = record as unknown as JSONObject;

  for (const field of nameFields) {
    const value: unknown = values[field];
    const text: string =
      value === undefined || value === null ? "" : String(value).trim();

    if (text) {
      return text;
    }
  }

  return null;
};

export default class TelemetryUsageResourceNames {
  // The name of each resource that has one the reader may see, by id.
  public static async resolve(data: {
    projectId: ObjectID;
    resources: Array<TelemetryUsageResourceRef>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const idsByType: Map<ServiceType, Set<string>> = new Map();

    for (const resource of data.resources) {
      const type: ServiceType =
        resource.primaryEntityType || ServiceType.OpenTelemetry;

      if (
        !TELEMETRY_USAGE_RESOURCE_NAME_SOURCES[type] ||
        !ObjectID.isValidUUID(resource.primaryEntityId) ||
        resource.primaryEntityId === data.projectId.toString()
      ) {
        continue;
      }

      const ids: Set<string> = idsByType.get(type) || new Set();
      ids.add(resource.primaryEntityId);
      idsByType.set(type, ids);
    }

    const names: Map<string, string> = new Map();

    await Promise.all(
      Array.from(idsByType.entries()).map(
        async ([type, ids]: [ServiceType, Set<string>]): Promise<void> => {
          const source: ResourceNameSource =
            TELEMETRY_USAGE_RESOURCE_NAME_SOURCES[type]!;
          const select: JSONObject = { _id: true };

          for (const field of source.nameFields) {
            select[field] = true;
          }

          try {
            const records: Array<BaseModel> = await source.service.findBy({
              query: {
                _id: QueryHelper.any(Array.from(ids)),
                projectId: data.projectId,
              } as never,
              select: select as never,
              skip: 0,
              limit: LIMIT_MAX,
              props: data.props,
            });

            for (const record of records) {
              const name: string | null = readName(record, source.nameFields);

              if (record.id && name) {
                names.set(record.id.toString(), name);
              }
            }
          } catch (err) {
            /*
             * A kind the reader may not read is left unnamed, and so is one
             * whose read fails: the usage itself is still worth showing.
             */
            logger.debug(
              `Telemetry usage: could not name the ${type} resources of project ${data.projectId.toString()}.`,
            );
            logger.debug(err);
          }
        },
      ),
    );

    return names;
  }
}
