import EntityType from "Common/Types/Telemetry/EntityType";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
  parseDatabaseEndpointString,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import { normalizeDatabaseSystem } from "Common/Types/DatabaseServer/DatabaseSystem";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Service from "Common/Models/DatabaseModels/Service";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
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
  entity: InventoryItem,
) => Promise<TypedRowLink | null>;

export const OPEN_DATABASE_LABEL: string = "Open database";

/*
 * A Service Map `database` node is keyed by what the calling spans said:
 * engine (`db.system.name`), host (`server.address`) and logical database
 * (`db.namespace`) — no port. The Databases product keys the SERVER by its
 * endpoint, so the node maps to the endpoint `server.address:<engine default
 * port>`, canonicalized exactly as a stored endpoint is (Kubernetes DNS
 * expansion, lowercase host, engine default port via getDefaultDatabasePort).
 *
 * `isLocal` marks an endpoint that only resolves inside one cluster (an
 * unqualified `*.svc.cluster.local` name or a private IP): its stored twin
 * carries an `@cluster` qualifier the span did not, so resolution also
 * accepts exactly one qualified owner.
 */
export interface DatabaseEntityEndpoint {
  endpoint: string;
  isLocal: boolean;
}

export type GetDatabaseEntityEndpointFunction = (
  identifying: JSONObject,
) => DatabaseEntityEndpoint | null;

export const getDatabaseEntityEndpoint: GetDatabaseEntityEndpointFunction = (
  identifying: JSONObject,
): DatabaseEntityEndpoint | null => {
  const address: unknown = identifying["server.address"];
  if (typeof address !== "string" || !address.trim()) {
    return null;
  }

  const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
    address,
    { system: normalizeDatabaseSystem(identifying["db.system.name"]) || "" },
  );
  if (!endpoint) {
    return null;
  }

  return {
    endpoint: formatDatabaseEndpoint(endpoint),
    isLocal: getDatabaseEndpointScope(endpoint) === "local",
  };
};

// Enough rows to tell one qualified owner from several.
const QUALIFIED_ENDPOINT_LOOKUP_LIMIT: number = 10;

export type ResolveDatabaseServerIdFunction = (data: {
  projectId: ObjectID;
  endpoint: DatabaseEntityEndpoint;
}) => Promise<string | null>;

/*
 * The DatabaseServer that owns the endpoint (each endpoint belongs to at
 * most one row per project). For a cluster-local endpoint the owner is
 * taken from its `@cluster`-qualified twins only when they all belong to one
 * database — two clusters' `db.prod.svc.cluster.local` are two servers, and
 * guessing between them would open the wrong one.
 */
export const resolveDatabaseServerIdForEndpoint: ResolveDatabaseServerIdFunction =
  async (data: {
    projectId: ObjectID;
    endpoint: DatabaseEntityEndpoint;
  }): Promise<string | null> => {
    const exact: ListResult<DatabaseServerEndpoint> =
      await ModelAPI.getList<DatabaseServerEndpoint>({
        modelType: DatabaseServerEndpoint,
        query: { projectId: data.projectId, endpoint: data.endpoint.endpoint },
        select: { databaseServerId: true },
        sort: {},
        skip: 0,
        limit: 1,
      });

    const exactOwner: string | undefined =
      exact.data[0]?.databaseServerId?.toString();
    if (exactOwner) {
      return exactOwner;
    }

    if (!data.endpoint.isLocal) {
      return null;
    }

    const prefix: string = `${data.endpoint.endpoint}@`;
    const qualified: ListResult<DatabaseServerEndpoint> =
      await ModelAPI.getList<DatabaseServerEndpoint>({
        modelType: DatabaseServerEndpoint,
        query: {
          projectId: data.projectId,
          endpoint: new StartsWith<string>(prefix),
        },
        select: { databaseServerId: true, endpoint: true },
        sort: {},
        skip: 0,
        limit: QUALIFIED_ENDPOINT_LOOKUP_LIMIT,
      });

    const owners: Set<string> = new Set<string>();
    for (const row of qualified.data) {
      // A LIKE prefix treats `_` as a wildcard; re-check it exactly.
      if (
        typeof row.endpoint !== "string" ||
        !row.endpoint.startsWith(prefix)
      ) {
        continue;
      }
      const owner: string | undefined = row.databaseServerId?.toString();
      if (owner) {
        owners.add(owner);
      }
    }

    return owners.size === 1 ? Array.from(owners)[0]! : null;
  };

/*
 * "Open database" for a Service Map / inventory `database` node, when a
 * DatabaseServer owns the endpoint it names. Best-effort: null on anything
 * it cannot resolve, never a throw.
 */
export const resolveDatabaseServerLink: ResolveTypedRowLinkFunction = async (
  entity: InventoryItem,
): Promise<TypedRowLink | null> => {
  if (entity.entityType !== EntityType.Database) {
    return null;
  }

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId) {
    return null;
  }

  const endpoint: DatabaseEntityEndpoint | null = getDatabaseEntityEndpoint(
    (entity.identifyingAttributes || {}) as JSONObject,
  );
  if (!endpoint) {
    return null;
  }

  try {
    const databaseServerId: string | null =
      await resolveDatabaseServerIdForEndpoint({ projectId, endpoint });

    if (!databaseServerId) {
      return null;
    }

    return {
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATABASE_SERVER_VIEW]!,
        { modelId: new ObjectID(databaseServerId) },
      ),
      label: OPEN_DATABASE_LABEL,
    };
  } catch {
    // Cross-link is best-effort — skip silently when resolution fails.
    return null;
  }
};

export const resolveTypedRowLink: ResolveTypedRowLinkFunction = async (
  entity: InventoryItem,
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

    if (entity.entityType === EntityType.Database) {
      return await resolveDatabaseServerLink(entity);
    }
  } catch {
    // Cross-link is best-effort — skip silently when resolution fails.
  }

  return null;
};
