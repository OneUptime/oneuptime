import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import Service from "Common/Models/DatabaseModels/Service";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { useEffect, useMemo, useState } from "react";
import { RouteUtil } from "../../Utils/RouteMap";
import {
  CreateFromRecordAddress,
  CreateFromRecordCrumb,
  CreateFromRecordKind,
  CreatedRecordKind,
  RecordToCreateFrom,
  getCreateFromRecordTrail,
  readCreateFromRecord,
} from "./CreateFromRecord";
import { useCreatePageBreadcrumbs } from "./CreatePageBreadcrumbs";

/*
 * The record a create page was opened from (see CreateFromRecord): read off
 * the address once, looked up with the viewer's own permissions, and its
 * trail handed to the layout's breadcrumbs.
 */

const MODEL_TYPES: Record<CreateFromRecordKind, { new (): BaseModel }> = {
  [CreateFromRecordKind.Monitor]: Monitor,
  [CreateFromRecordKind.Host]: Host,
  [CreateFromRecordKind.KubernetesCluster]: KubernetesCluster,
  [CreateFromRecordKind.DockerHost]: DockerHost,
  [CreateFromRecordKind.PodmanHost]: PodmanHost,
  [CreateFromRecordKind.ProxmoxCluster]: ProxmoxCluster,
  [CreateFromRecordKind.VMwareVCenter]: VMwareVCenter,
  [CreateFromRecordKind.CephCluster]: CephCluster,
  [CreateFromRecordKind.DockerSwarmCluster]: DockerSwarmCluster,
  [CreateFromRecordKind.IoTFleet]: IoTFleet,
  [CreateFromRecordKind.DatabaseServer]: DatabaseServer,
  [CreateFromRecordKind.NetworkSite]: NetworkSite,
  [CreateFromRecordKind.Service]: Service,
  [CreateFromRecordKind.StatusPage]: StatusPage,
};

export const getCreateFromRecordModelType: (kind: CreateFromRecordKind) => {
  new (): BaseModel;
} = (kind: CreateFromRecordKind): { new (): BaseModel } => {
  return MODEL_TYPES[kind];
};

/*
 * The record, if the viewer can read it in this project; null otherwise. A
 * record that is gone or in another project comes back without an ID, and a
 * refusal (no permission to read it) as an error: neither is picked, and
 * neither is an error worth showing - the form opens as it does from the
 * project's list.
 */
export const fetchRecordToCreateFrom: (
  address: CreateFromRecordAddress,
) => Promise<RecordToCreateFrom | null> = async (
  address: CreateFromRecordAddress,
): Promise<RecordToCreateFrom | null> => {
  try {
    const model: BaseModel | null = await ModelAPI.getItem<BaseModel>({
      modelType: getCreateFromRecordModelType(address.kind),
      id: new ObjectID(address.id.toString()),
      select: { _id: true, name: true } as never,
    });

    const id: string | undefined = model?._id?.toString() || undefined;

    if (!model || !id) {
      return null;
    }

    const name: unknown = (model as unknown as Record<string, unknown>)["name"];

    return {
      kind: address.kind,
      id: id,
      name: typeof name === "string" ? name : "",
    };
  } catch {
    return null;
  }
};

// The trail, as links: Project > Hosts > View Host > Incidents > this page.
export const getCreateFromRecordBreadcrumbLinks: (
  record: CreateFromRecordAddress,
  created: CreatedRecordKind,
) => Array<Link> | null = (
  record: CreateFromRecordAddress,
  created: CreatedRecordKind,
): Array<Link> | null => {
  const trail: Array<CreateFromRecordCrumb> | null = getCreateFromRecordTrail(
    record,
    created,
  );

  if (!trail) {
    return null;
  }

  return trail.map((crumb: CreateFromRecordCrumb): Link => {
    return {
      title: crumb.title,
      to: RouteUtil.getPageRoute(
        crumb.page,
        crumb.modelId ? { modelId: crumb.modelId } : undefined,
      ),
    };
  });
};

export interface RecordToCreateFromState {
  // True while the record is being looked up: the form waits for it.
  isLoading: boolean;
  // The record, once it is known to exist and the viewer can read it.
  record: RecordToCreateFrom | null;
  // The trail back through its tab, while there is a record.
  breadcrumbLinks: Array<Link> | null;
}

/*
 * The create page's half. Without a record in the address it asks nothing
 * and is done at once, so a page opened from the project's list loads as it
 * always has.
 */
const useRecordToCreateFrom: (
  created: CreatedRecordKind,
) => RecordToCreateFromState = (
  created: CreatedRecordKind,
): RecordToCreateFromState => {
  // Read once: the form latches what it starts with.
  const [address] = useState<CreateFromRecordAddress | null>(() => {
    return readCreateFromRecord(created, (name: string): string | null => {
      return Navigation.getQueryStringByName(name);
    });
  });

  const [isLoading, setIsLoading] = useState<boolean>(Boolean(address));

  const [record, setRecord] = useState<RecordToCreateFrom | null>(null);

  useEffect(() => {
    if (!address) {
      return;
    }

    let isCurrent: boolean = true;

    fetchRecordToCreateFrom(address)
      .then((found: RecordToCreateFrom | null): void => {
        if (!isCurrent) {
          return;
        }

        setRecord(found);
        setIsLoading(false);
      })
      .catch((): void => {
        // fetchRecordToCreateFrom answers null rather than throw.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const breadcrumbLinks: Array<Link> | null = useMemo(() => {
    return record ? getCreateFromRecordBreadcrumbLinks(record, created) : null;
  }, [record]);

  useCreatePageBreadcrumbs(breadcrumbLinks);

  return {
    isLoading: isLoading,
    record: record,
    breadcrumbLinks: breadcrumbLinks,
  };
};

export default useRecordToCreateFrom;
