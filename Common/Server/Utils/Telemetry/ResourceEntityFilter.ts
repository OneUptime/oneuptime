import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import HostModel from "../../../Models/DatabaseModels/Host";
import KubernetesClusterModel from "../../../Models/DatabaseModels/KubernetesCluster";
import HostService from "../../Services/HostService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import {
  keyForHost,
  keyForKubernetesCluster,
} from "../../../Utils/Telemetry/EntityKey";

export interface SplitResourceFilters {
  serviceIds: Array<ObjectID>;
  entityKeys: Array<string>;
}

/**
 * The log explorer coalesces every resource facet — service, host, docker host,
 * podman host, kubernetes cluster — into one `serviceIds` list, which the
 * aggregation services turn into `primaryEntityId IN (...)`.
 *
 * That predicate only matches telemetry whose *primary* entity is the resource
 * itself, which is true for resource-scoped ingestion but not for OTLP.
 * OpenTelemetry telemetry is primary-keyed on its Service and carries the
 * resource relationship in `entityKeys` / the scalar `*EntityKey` columns, so
 * filtering by a Kubernetes cluster alone matched nothing at all, while
 * selecting a cluster *and* a service appeared to work only because both ids
 * landed in the same `IN (...)` list and the service half matched.
 *
 * Split the ids by what they actually name: ids that resolve to a resource
 * entity become entity keys, which the aggregation services already match with
 * `hasAny(entityKeys, ...)`; anything else is left as a service id. Cross-facet
 * selections then intersect instead of being OR-ed together.
 */
export default class ResourceEntityFilter {
  public static async splitResourceFilterIds(data: {
    projectId: ObjectID;
    ids: Array<ObjectID>;
  }): Promise<SplitResourceFilters> {
    const { projectId, ids } = data;

    if (!ids || ids.length === 0) {
      return { serviceIds: [], entityKeys: [] };
    }

    const idStrings: Array<string> = ids.map((id: ObjectID): string => {
      return id.toString();
    });

    const entityKeys: Array<string> = [];
    const resolvedResourceIds: Set<string> = new Set<string>();

    const clusters: Array<KubernetesClusterModel> =
      await KubernetesClusterService.findBy({
        query: { projectId, _id: idStrings } as any,
        select: { _id: true, clusterIdentifier: true },
        limit: new PositiveNumber(idStrings.length),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

    for (const cluster of clusters) {
      const identifier: string | undefined = cluster.clusterIdentifier;

      // Cluster identity is name-keyed; without it there is no key to match.
      if (!cluster._id || !identifier) {
        continue;
      }

      entityKeys.push(
        keyForKubernetesCluster(projectId.toString(), identifier),
      );
      resolvedResourceIds.add(cluster._id.toString());
    }

    const hosts: Array<HostModel> = await HostService.findBy({
      query: { projectId, _id: idStrings } as any,
      select: { _id: true, hostIdentifier: true },
      limit: new PositiveNumber(idStrings.length),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

    for (const host of hosts) {
      const identifier: string | undefined = host.hostIdentifier;

      if (!host._id || !identifier) {
        continue;
      }

      entityKeys.push(keyForHost(projectId.toString(), identifier));
      resolvedResourceIds.add(host._id.toString());
    }

    const serviceIds: Array<ObjectID> = ids.filter((id: ObjectID): boolean => {
      return !resolvedResourceIds.has(id.toString());
    });

    return { serviceIds, entityKeys };
  }
}
