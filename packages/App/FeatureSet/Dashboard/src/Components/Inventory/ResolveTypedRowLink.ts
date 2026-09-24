import EntityType from "Common/Types/Telemetry/EntityType";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import {
  DatabaseEndpoint,
  ParsedHostAndPort,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
  parseDatabaseEndpointString,
  parseHostAndPort,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  getDefaultDatabasePort,
  isSameDatabaseFamily,
  normalizeDatabaseSystem,
} from "Common/Types/DatabaseServer/DatabaseSystem";
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
 * engine (`db.system.name`), host (`server.address`, port stripped) and
 * logical database (`db.namespace`). The Databases product keys the SERVER
 * by its endpoint — host AND port, cluster-qualified when the host is
 * cluster-local — so the node carries less than the stored endpoint and is
 * resolved in steps, most exact first:
 *
 *   1. the exact endpoint: the node's own port when it has one (in its
 *      address, a `server.port` attribute, or a stamped
 *      `oneuptime.database.endpoint`), otherwise the engine's default port
 *      — which is what a span that reports no `server.port` means;
 *   2. for a cluster-local endpoint, its `@cluster`-qualified twins;
 *   3. every stored endpoint on the same HOST, any port or cluster — a
 *      database on a non-default port (PgBouncer on 6432, a managed
 *      Postgres on 25060), and for a Kubernetes short name the expanded
 *      forms the in-cluster callers were recorded with: `postgres` →
 *      `postgres.<namespace>.svc.cluster.local`, `postgres.data` →
 *      `postgres.data.svc.cluster.local` (any cluster), `mongo-0.mongo-hl`
 *      → `mongo-0.mongo-hl.<namespace>.svc.cluster.local`. Rows of another
 *      engine family are ignored; a known port must match exactly.
 *
 * Wherever more than one database is left, the one on the engine's default
 * port is taken when it is the only one there; otherwise no link — opening
 * the wrong database is worse than offering none.
 */
export interface DatabaseEntityEndpoint {
  // Canonical `host:port` (the explicit port, else the engine default).
  endpoint: string;
  // Cluster-local: its stored twin may carry an `@cluster` qualifier.
  isLocal: boolean;
  // Canonical host (Kubernetes DNS expanded), for the same-host fallback.
  host?: string | undefined;
  // Normalized engine of the node, for the engine-family check.
  system?: string | undefined;
  // The port the node itself named, or null when it named none.
  port?: number | null | undefined;
}

export type GetDatabaseEntityEndpointFunction = (
  identifying: JSONObject,
  descriptive?: JSONObject | null | undefined,
) => DatabaseEntityEndpoint | null;

// The attribute a server-side resolver may stamp with the canonical endpoint.
export const DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE: string =
  "oneuptime.database.endpoint";

function readPort(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const port: number = Number(String(value).trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export const getDatabaseEntityEndpoint: GetDatabaseEntityEndpointFunction = (
  identifying: JSONObject,
  descriptive?: JSONObject | null | undefined,
): DatabaseEntityEndpoint | null => {
  const system: string =
    normalizeDatabaseSystem(identifying["db.system.name"]) ||
    normalizeDatabaseSystem(descriptive?.["db.system.name"]) ||
    "";

  // A canonical endpoint stamped by the server wins: it has the real port.
  const stamped: unknown =
    descriptive?.[DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE];
  if (typeof stamped === "string" && stamped.trim()) {
    const stampedEndpoint: DatabaseEndpoint | null =
      parseDatabaseEndpointString(stamped, { system });
    if (stampedEndpoint) {
      return {
        endpoint: formatDatabaseEndpoint(stampedEndpoint),
        isLocal: getDatabaseEndpointScope(stampedEndpoint) === "local",
        host: stampedEndpoint.host,
        system: system,
        port: stampedEndpoint.port,
      };
    }
  }

  const address: unknown = identifying["server.address"];
  if (typeof address !== "string" || !address.trim()) {
    return null;
  }

  const parsed: ParsedHostAndPort | null = parseHostAndPort(address);
  const explicitPort: number | null =
    parsed?.port ??
    readPort(identifying["server.port"]) ??
    readPort(descriptive?.["server.port"]);

  const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
    explicitPort !== null && parsed && parsed.port === null
      ? formatDatabaseEndpoint({ host: parsed.host, port: explicitPort })
      : address,
    { system },
  );
  if (!endpoint) {
    return null;
  }

  return {
    endpoint: formatDatabaseEndpoint(endpoint),
    isLocal: getDatabaseEndpointScope(endpoint) === "local",
    host: endpoint.host,
    system: system,
    port: explicitPort,
  };
};

// Enough rows to tell one qualified owner from several.
const QUALIFIED_ENDPOINT_LOOKUP_LIMIT: number = 10;

// Every endpoint one host could reasonably have, across ports and clusters.
const SAME_HOST_ENDPOINT_LOOKUP_LIMIT: number = 50;

const DNS_LABEL_PATTERN: RegExp = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const ALL_DIGITS_PATTERN: RegExp = /^\d+$/;

// A StatefulSet pod's name: `<statefulset>-<ordinal>` (`mongo-0`).
const POD_ORDINAL_PATTERN: RegExp = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?-\d+$/;

const KUBERNETES_SERVICE_SUFFIX: string = ".svc.cluster.local";

/*
 * Second labels that make a two-label name a private DNS zone, never a
 * Kubernetes `<service>.<namespace>` (the ingest identity rules read
 * `db.internal` the same way).
 */
const NON_NAMESPACE_TOP_LABELS: ReadonlySet<string> = new Set<string>([
  "local",
  "internal",
  "localdomain",
]);

function isSingleLabelHost(host: string): boolean {
  return DNS_LABEL_PATTERN.test(host) && !ALL_DIGITS_PATTERN.test(host);
}

/*
 * `<a>.<b>`: the short name a pod reaches a Service in another namespace by
 * (`postgres.data`), or a StatefulSet member in its own
 * (`mongo-0.mongo-headless`). A node carries it as the raw server.address,
 * with no caller context, so it reads as a domain; the endpoints stored for
 * it are the Service FQDN the in-cluster callers were keyed with.
 */
function isTwoLabelKubernetesHost(host: string): boolean {
  const labels: Array<string> = host.split(".");
  return (
    labels.length === 2 &&
    DNS_LABEL_PATTERN.test(labels[0]!) &&
    DNS_LABEL_PATTERN.test(labels[1]!) &&
    !ALL_DIGITS_PATTERN.test(labels[1]!) &&
    !NON_NAMESPACE_TOP_LABELS.has(labels[1]!)
  );
}

// `<nodeHost>.<namespace>.svc.cluster.local`, any one namespace label.
function isServiceInAnyNamespace(
  nodeHost: string,
  storedHost: string,
): boolean {
  const prefix: string = `${nodeHost}.`;
  if (
    !storedHost.startsWith(prefix) ||
    !storedHost.endsWith(KUBERNETES_SERVICE_SUFFIX)
  ) {
    return false;
  }
  const namespace: string = storedHost.substring(
    prefix.length,
    storedHost.length - KUBERNETES_SERVICE_SUFFIX.length,
  );
  return DNS_LABEL_PATTERN.test(namespace);
}

/*
 * True when a stored endpoint host is the node's host: the same canonical
 * host, or a Kubernetes short name's expanded forms —
 *
 *   - a single label as a Service in any namespace (`postgres` →
 *     `postgres.<ns>.svc.cluster.local`);
 *   - two labels as the Service in THAT namespace (`postgres.data` →
 *     `postgres.data.svc.cluster.local`, qualified with any cluster — the
 *     qualifier is not part of the host);
 *   - a StatefulSet member behind its headless Service, in any namespace
 *     (`mongo-0.mongo-headless` →
 *     `mongo-0.mongo-headless.<ns>.svc.cluster.local`).
 */
function isSameHost(nodeHost: string, storedHost: string): boolean {
  if (storedHost === nodeHost) {
    return true;
  }
  if (isSingleLabelHost(nodeHost)) {
    return isServiceInAnyNamespace(nodeHost, storedHost);
  }
  if (!isTwoLabelKubernetesHost(nodeHost)) {
    return false;
  }
  if (storedHost === `${nodeHost}${KUBERNETES_SERVICE_SUFFIX}`) {
    return true;
  }
  return (
    POD_ORDINAL_PATTERN.test(nodeHost.split(".")[0]!) &&
    isServiceInAnyNamespace(nodeHost, storedHost)
  );
}

interface SameHostCandidate {
  owner: string;
  port: number | null;
}

/*
 * Step 3 — every endpoint stored for the node's host, filtered to the ones
 * that can be this node's database. Null when nothing matches, and when
 * several databases remain with no way to tell which one the node means.
 */
async function resolveDatabaseServerIdForHost(data: {
  projectId: ObjectID;
  endpoint: DatabaseEntityEndpoint;
}): Promise<string | null> {
  const host: string = (data.endpoint.host || "").trim().toLowerCase();
  if (!host) {
    return null;
  }

  const hostPart: string = host.includes(":") ? `[${host}]` : host;
  const prefixes: Array<string> = [`${hostPart}:`];
  // A Kubernetes short name is stored in its expanded `<host>.….svc.…` forms.
  if (isSingleLabelHost(host) || isTwoLabelKubernetesHost(host)) {
    prefixes.push(`${host}.`);
  }

  const results: Array<ListResult<DatabaseServerEndpoint>> = await Promise.all(
    prefixes.map(
      (prefix: string): Promise<ListResult<DatabaseServerEndpoint>> => {
        return ModelAPI.getList<DatabaseServerEndpoint>({
          modelType: DatabaseServerEndpoint,
          query: {
            projectId: data.projectId,
            endpoint: new StartsWith<string>(prefix),
          },
          select: {
            databaseServerId: true,
            endpoint: true,
            databaseServer: { dbSystem: true },
          },
          sort: {},
          skip: 0,
          limit: SAME_HOST_ENDPOINT_LOOKUP_LIMIT,
        });
      },
    ),
  );

  const system: string = data.endpoint.system || "";
  const explicitPort: number | null = data.endpoint.port ?? null;
  const candidates: Array<SameHostCandidate> = [];

  for (const result of results) {
    for (const row of result.data || []) {
      const owner: string | undefined = row.databaseServerId?.toString();
      if (!owner || typeof row.endpoint !== "string") {
        continue;
      }
      // Re-parse: a LIKE prefix treats `_` as a wildcard.
      const stored: DatabaseEndpoint | null = parseDatabaseEndpointString(
        row.endpoint,
        { system },
      );
      if (!stored || !isSameHost(host, stored.host)) {
        continue;
      }
      if (explicitPort !== null && stored.port !== explicitPort) {
        continue;
      }
      const ownerSystem: unknown = row.databaseServer?.dbSystem;
      if (
        system &&
        typeof ownerSystem === "string" &&
        ownerSystem.trim() &&
        !isSameDatabaseFamily(system, ownerSystem)
      ) {
        continue;
      }
      candidates.push({ owner, port: stored.port });
    }
  }

  return pickSingleOwner(candidates, getDefaultDatabasePort(system));
}

/*
 * One database from the candidates: the only owner, or — when several
 * remain — the only owner on the engine's default port. Otherwise null.
 */
function pickSingleOwner(
  candidates: ReadonlyArray<SameHostCandidate>,
  defaultPort: number | null,
): string | null {
  const owners: Set<string> = new Set<string>(
    candidates.map((candidate: SameHostCandidate): string => {
      return candidate.owner;
    }),
  );
  if (owners.size === 1) {
    return Array.from(owners)[0]!;
  }
  if (owners.size === 0 || defaultPort === null) {
    return null;
  }
  const onDefaultPort: Set<string> = new Set<string>(
    candidates
      .filter((candidate: SameHostCandidate): boolean => {
        return candidate.port === defaultPort;
      })
      .map((candidate: SameHostCandidate): string => {
        return candidate.owner;
      }),
  );
  return onDefaultPort.size === 1 ? Array.from(onDefaultPort)[0]! : null;
}

export type ResolveDatabaseServerIdFunction = (data: {
  projectId: ObjectID;
  endpoint: DatabaseEntityEndpoint;
}) => Promise<string | null>;

/*
 * The DatabaseServer that owns the endpoint (each endpoint belongs to at
 * most one row per project) — see DatabaseEntityEndpoint for the steps. For
 * a cluster-local endpoint the owner is taken from its `@cluster`-qualified
 * twins only when they all belong to one database: two clusters'
 * `db.prod.svc.cluster.local` are two servers, and guessing between them
 * would open the wrong one.
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

    if (data.endpoint.isLocal) {
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

      if (owners.size === 1) {
        return Array.from(owners)[0]!;
      }
      if (owners.size > 1) {
        // Two clusters' databases of this name: never guessed between.
        return null;
      }
    }

    return resolveDatabaseServerIdForHost(data);
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
    (entity.descriptiveAttributes || {}) as JSONObject,
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
