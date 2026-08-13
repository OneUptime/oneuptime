import EntityType from "Common/Types/Telemetry/EntityType";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { JSONObject } from "Common/Types/JSON";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";

/*
 * Cross-link from an inventory item to the rich, purpose-built page for the
 * same thing, when OneUptime has one.
 *
 * A service is both an inventory item and a Service with its own dashboard;
 * the inventory row is the catalog entry, not a replacement for that page.
 * Service rows carry the registry's `(resourceType, resourceId)` pointer,
 * stamped at reconcile time, which is used directly when present. Everything
 * else — and service rows written before the pointer existed — resolves by
 * natural identity: the same identity the entity key was hashed from.
 *
 * Best-effort throughout. A missing link is a missing button; it must never
 * be an error on the page.
 */

export interface TypedRowLink {
  route: Route;
  label: string;
}

export type ResolveTypedRowLinkFunction = (
  entity: TelemetryEntity,
) => Promise<TypedRowLink | null>;

export const resolveTypedRowLink: ResolveTypedRowLinkFunction = async (
  entity: TelemetryEntity,
): Promise<TypedRowLink | null> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return null;
  }

  const identifying: JSONObject = (entity.identifyingAttributes ||
    {}) as JSONObject;

  try {
    if (entity.resourceType === "Service" && entity.resourceId) {
      return {
        route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICE_VIEW]!, {
          modelId: new ObjectID(entity.resourceId.toString()),
        }),
        label: "Open service dashboard",
      };
    }

    if (entity.entityType === EntityType.Service) {
      const name: string | undefined =
        (identifying["service.name"] as string | undefined) ||
        entity.displayName;

      if (!name) {
        return null;
      }

      const result: ListResult<Service> = await ModelAPI.getList<Service>({
        modelType: Service,
        query: { projectId, name },
        select: { _id: true },
        sort: {},
        skip: 0,
        limit: 1,
      });

      const id: string | undefined = result.data[0]?._id;

      if (!id) {
        return null;
      }

      return {
        route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICE_VIEW]!, {
          modelId: new ObjectID(id),
        }),
        label: "Open service dashboard",
      };
    }

    if (entity.entityType === EntityType.Host) {
      const hostIdentifier: string | undefined =
        (identifying["host.name"] as string | undefined) || entity.displayName;

      if (!hostIdentifier) {
        return null;
      }

      const result: ListResult<Host> = await ModelAPI.getList<Host>({
        modelType: Host,
        query: { projectId, hostIdentifier },
        select: { _id: true },
        sort: {},
        skip: 0,
        limit: 1,
      });

      const id: string | undefined = result.data[0]?._id;

      if (!id) {
        return null;
      }

      return {
        route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOST_VIEW]!, {
          modelId: new ObjectID(id),
        }),
        label: "Open host dashboard",
      };
    }

    if (entity.entityType === EntityType.KubernetesCluster) {
      const clusterIdentifier: string | undefined =
        (identifying["k8s.cluster.name"] as string | undefined) ||
        entity.displayName;

      if (!clusterIdentifier) {
        return null;
      }

      const result: ListResult<KubernetesCluster> =
        await ModelAPI.getList<KubernetesCluster>({
          modelType: KubernetesCluster,
          query: { projectId, clusterIdentifier },
          select: { _id: true },
          sort: {},
          skip: 0,
          limit: 1,
        });

      const id: string | undefined = result.data[0]?._id;

      if (!id) {
        return null;
      }

      return {
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW]!,
          { modelId: new ObjectID(id) },
        ),
        label: "Open cluster dashboard",
      };
    }
  } catch {
    // Cross-link is best-effort — skip silently when resolution fails.
  }

  return null;
};
