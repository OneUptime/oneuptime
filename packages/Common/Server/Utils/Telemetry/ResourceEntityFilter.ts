import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { JSONObject } from "../../../Types/JSON";
import HostService from "../../Services/HostService";
import DockerHostService from "../../Services/DockerHostService";
import PodmanHostService from "../../Services/PodmanHostService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import DockerSwarmClusterService from "../../Services/DockerSwarmClusterService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import VMwareVCenterService from "../../Services/VMwareVCenterService";
import CephClusterService from "../../Services/CephClusterService";
import ServerlessFunctionService from "../../Services/ServerlessFunctionService";
import IoTFleetService from "../../Services/IoTFleetService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DatabaseServerEndpointService from "../../Services/DatabaseServerEndpointService";
import FindBy from "../../Types/Database/FindBy";
import {
  keyForCephCluster,
  keyForDockerSwarmCluster,
  keyForHost,
  keyForKubernetesCluster,
  keyForProxmoxCluster,
  keyForVMwareVCenter,
} from "../../../Utils/Telemetry/EntityKey";
import { getDatabaseServerSignalEntityKeys } from "../../../Utils/Telemetry/DatabaseServerEntityKeys";
import {
  ResourceEntityFacetSelections,
  isResourceEntityFacetKey,
  parseResourceEntityFacetSelections,
} from "../../../Types/Telemetry/ResourceEntityFacet";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import CaptureSpan from "./CaptureSpan";

/**
 * One resource facet's selection, compiled into the three ways a signal row
 * can prove membership of that resource. The three are OR-ed together; a
 * row matching any of them belongs to the selected resource.
 *
 *  - `entityIds`   -> `primaryEntityId IN (...)`. Agent-ingested telemetry
 *                     has the resource as its primary entity, so its id is
 *                     literally in the column. Also the only thing that
 *                     matches rows written before `entityKeys` existed.
 *  - `entityKeys`  -> `hasAny(entityKeys, [...])`. The general membership
 *                     read: OTLP telemetry primary-keyed on its Service
 *                     still carries the host / cluster key here. Empty for
 *                     resource types no OTLP resource declares as an
 *                     entity (Serverless function, IoT fleet).
 *  - `attribute*`  -> `attributes['resource.<attr>'] IN (...)`. The
 *                     pre-`entityKeys` fallback, mirroring the entityScope
 *                     contract the resource detail pages already use, so
 *                     rows ingested before the column shipped (no backfill
 *                     by decision) keep matching. Absent for resource types
 *                     that have no single identifying attribute (Database).
 */
export interface ResourceEntityScope {
  entityIds: Array<string>;
  entityKeys: Array<string>;
  attributeKey?: string | undefined;
  attributeValues?: Array<string> | undefined;
}

interface ResourceFacetDefinition {
  /**
   * Signal attribute the identifying value is stamped under. Absent for a
   * type whose selection is its entity keys alone (see `resolveEntityKeys`)
   * — the scope then has no attribute branch.
   */
  attributeKey?: string | undefined;
  /**
   * Read-side entity-key helper, mirroring the ingest-side resolver. Absent
   * for resource types that never reach a signal's `entityKeys` — the scope
   * then matches on the id and the attribute only.
   */
  entityKeyFor?:
    | ((projectId: string, identifier: string) => string)
    | undefined;
  findIdentifiers?:
    | ((data: {
        projectId: ObjectID;
        ids: Array<ObjectID>;
      }) => Promise<Array<string>>)
    | undefined;
  /**
   * The selected rows' complete entity-key set, for a type whose telemetry
   * is not named by one identifier per row (a Database owns several
   * endpoints plus the pods / containers it runs as). Takes precedence over
   * `findIdentifiers`; the scope is then `id OR entity keys`.
   */
  resolveEntityKeys?:
    | ((data: {
        projectId: ObjectID;
        ids: Array<ObjectID>;
      }) => Promise<Array<string>>)
    | undefined;
}

/*
 * Only `findBy` is used, called through the service instance at lookup
 * time so a mocked or spied service is honoured.
 */
interface IdentifierLookupService {
  findBy: (findBy: FindBy<any>) => Promise<Array<any>>;
}

/*
 * The project-scoped `id -> identifying column` lookup every definition
 * shares. Scoping by `projectId` is load-bearing: an id from another tenant
 * must resolve to nothing, never to that tenant's identifier.
 */
function findIdentifierColumn(
  service: IdentifierLookupService,
  column: string,
): ResourceFacetDefinition["findIdentifiers"] {
  return async (data: {
    projectId: ObjectID;
    ids: Array<ObjectID>;
  }): Promise<Array<string>> => {
    const rows: Array<Record<string, unknown>> = await service.findBy({
      query: { projectId: data.projectId, _id: new Includes(data.ids) },
      select: { [column]: true },
      limit: new PositiveNumber(data.ids.length),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

    return rows.map((row: Record<string, unknown>): string => {
      const value: unknown = row[column];
      return typeof value === "string" ? value : "";
    });
  };
}

/*
 * A Database's telemetry is every row carrying one of its entity keys: its
 * row key (stamped on every batch that resolved to the row — by its
 * `oneuptime.database.server.id` link or by an endpoint it owns — whether or
 * not the row is the batch's primary entity), the `database.server` key of
 * each endpoint it owns (DatabaseServerEndpoint rows — stamped on
 * application CLIENT spans, `db.client.*` datapoints and receiver batches
 * that name it) and its member keys (the pods / containers it runs as).
 * Computed by getDatabaseServerSignalEntityKeys — the same helper, over the
 * same inputs, the Database page scopes its Logs / Traces / Metrics tabs
 * with — so the explorer facet and the page select the same rows. Endpoints
 * are read in the page's order (primary first, then oldest) so the helper's
 * per-row cap keeps the same keys on both sides.
 *
 * The `primaryEntityId` branch the scope always keeps covers the receiver
 * batches that are primary-keyed on the row itself, including those
 * ingested before the row key existed.
 */
async function resolveDatabaseServerEntityKeys(data: {
  projectId: ObjectID;
  ids: Array<ObjectID>;
}): Promise<Array<string>> {
  const databaseServerService: IdentifierLookupService = DatabaseServerService;
  const endpointService: IdentifierLookupService =
    DatabaseServerEndpointService;

  const rows: Array<Record<string, unknown>> =
    await databaseServerService.findBy({
      query: { projectId: data.projectId, _id: new Includes(data.ids) },
      select: { _id: true, dbSystem: true, memberEntityKeys: true },
      limit: new PositiveNumber(data.ids.length),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

  const rowIds: Array<string> = rows
    .map((row: Record<string, unknown>): string => {
      const id: unknown = row["_id"];
      return id ? String(id) : "";
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });

  if (rowIds.length === 0) {
    return [];
  }

  const endpointRows: Array<Record<string, unknown>> =
    await endpointService.findBy({
      query: {
        projectId: data.projectId,
        databaseServerId: new Includes(rowIds),
      },
      select: { databaseServerId: true, endpoint: true },
      sort: { isPrimary: SortOrder.Descending, createdAt: SortOrder.Ascending },
      limit: new PositiveNumber(LIMIT_MAX),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

  const endpointsByRow: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const endpointRow of endpointRows) {
    const owner: unknown = endpointRow["databaseServerId"];
    const endpoint: unknown = endpointRow["endpoint"];
    if (!owner || typeof endpoint !== "string" || !endpoint) {
      continue;
    }
    const ownerId: string = String(owner);
    const endpoints: Array<string> = endpointsByRow.get(ownerId) || [];
    endpoints.push(endpoint);
    endpointsByRow.set(ownerId, endpoints);
  }

  const projectIdString: string = data.projectId.toString();
  const keys: Set<string> = new Set<string>();

  for (const row of rows) {
    const rowId: string = row["_id"] ? String(row["_id"]) : "";
    if (!rowId) {
      continue;
    }
    const dbSystem: unknown = row["dbSystem"];

    for (const key of getDatabaseServerSignalEntityKeys({
      projectId: projectIdString,
      databaseServerId: rowId,
      endpoints: endpointsByRow.get(rowId) || [],
      dbSystem: typeof dbSystem === "string" ? dbSystem : undefined,
      memberEntityKeys: row["memberEntityKeys"],
    })) {
      keys.add(key);
    }
  }

  return Array.from(keys);
}

/*
 * `Host` / `DockerHost` / `PodmanHost` all key on the canonicalized
 * `host.name` (see `HostService.findOrCreateByHostIdentifier` and its
 * Docker / Podman siblings), which is exactly the Host entity's identity —
 * so all three resolve through `keyForHost`. A Kubernetes cluster keys on
 * `k8s.cluster.name` (`InventoryItem.k8sClusterIdentity`).
 *
 * The Docker / Podman facets need this as much as the Kubernetes one does:
 * `getServiceNameFromAttributes` synthesises a per-container service name
 * for agent-collected container telemetry, so those rows are primary-keyed
 * on a Service too and an id-only predicate finds almost nothing.
 *
 * Resolving them to the Host entity means "Docker Host web-1" also matches
 * non-container telemetry from web-1 when the Infrastructure agent runs
 * alongside. That is the machine the facet names, so the wider match is the
 * honest reading — and it is the only identity an OTLP resource carries;
 * DockerHost / PodmanHost are inventory-mirrored types that no resource
 * ever declares (see EntityType).
 *
 * Docker Swarm / Proxmox / vCenter / Ceph clusters are root entities whose
 * identity is their name alone (`<type>.name`, see the root identities in
 * Utils/Telemetry/TelemetryEntity.ts), and
 * that name is the Postgres row's `name` — the join key ingest writes with
 * `findOrCreateByName`. Keys canonicalize (trim + lowercase) on both sides,
 * so a row whose casing differs from the stamped attribute still matches
 * through `entityKeys`; the attribute branch is an exact match. Docker
 * Swarm leans on the entity-key branch most: a swarm cluster is rarely the
 * primary entity (a container's synthesized service, or the Docker host,
 * wins first).
 *
 * Serverless functions and IoT fleets have a resource attribute but no
 * signal entity key (inventory-mirrored / no entity type at all), so they
 * get the id + attribute branches only — the same `resource.faas.name` /
 * `resource.iot.fleet.name` scope their detail pages use. The function
 * identifier is `faas.name` (or `service.name` on a FaaS platform without
 * one, which the attribute branch then simply does not match).
 *
 * Databases resolve straight to their entity-key set (see
 * resolveDatabaseServerEntityKeys above): no attribute branch, because no
 * single resource attribute names every row a database's telemetry lives
 * on — its application spans carry the CALLER's resource.
 *
 * Cloud resources and RUM applications intentionally have NO definition,
 * so their selection stays `primaryEntityId IN (...)`:
 *   - RUM telemetry is always primary-keyed on its application
 *     (`getServiceNameFromAttributes` returns no service for RUM clients),
 *     so the id already selects every row.
 *   - A cloud resource's telemetry scope is a multi-attribute match
 *     (platform + account + region, see CloudResourceTelemetryScope) that
 *     the single-attribute branch cannot express; a partial match would
 *     select other resources' rows.
 * Id-only also keeps those selections consistent with their facet counts,
 * which are `primaryEntityId`-based.
 *
 * Built on first use rather than at module load: the services pull in much
 * of the server, and a module cycle that reached this file first would
 * otherwise hand the table an `undefined` service — which the best-effort
 * lookup below would silently turn into an id-only filter.
 */
let facetDefinitions: Record<string, ResourceFacetDefinition> | null = null;

function getFacetDefinitions(): Record<string, ResourceFacetDefinition> {
  if (facetDefinitions) {
    return facetDefinitions;
  }

  facetDefinitions = {
    hostId: {
      attributeKey: "resource.host.name",
      entityKeyFor: keyForHost,
      findIdentifiers: findIdentifierColumn(HostService, "hostIdentifier"),
    },
    dockerHostId: {
      attributeKey: "resource.host.name",
      entityKeyFor: keyForHost,
      findIdentifiers: findIdentifierColumn(
        DockerHostService,
        "hostIdentifier",
      ),
    },
    podmanHostId: {
      attributeKey: "resource.host.name",
      entityKeyFor: keyForHost,
      findIdentifiers: findIdentifierColumn(
        PodmanHostService,
        "hostIdentifier",
      ),
    },
    kubernetesClusterId: {
      attributeKey: "resource.k8s.cluster.name",
      entityKeyFor: keyForKubernetesCluster,
      findIdentifiers: findIdentifierColumn(
        KubernetesClusterService,
        "clusterIdentifier",
      ),
    },
    dockerSwarmClusterId: {
      attributeKey: "resource.docker.swarm.cluster.name",
      entityKeyFor: keyForDockerSwarmCluster,
      findIdentifiers: findIdentifierColumn(DockerSwarmClusterService, "name"),
    },
    proxmoxClusterId: {
      attributeKey: "resource.proxmox.cluster.name",
      entityKeyFor: keyForProxmoxCluster,
      findIdentifiers: findIdentifierColumn(ProxmoxClusterService, "name"),
    },
    vmwareVCenterId: {
      attributeKey: "resource.vmware.vcenter.name",
      entityKeyFor: keyForVMwareVCenter,
      findIdentifiers: findIdentifierColumn(VMwareVCenterService, "name"),
    },
    cephClusterId: {
      attributeKey: "resource.ceph.cluster.name",
      entityKeyFor: keyForCephCluster,
      findIdentifiers: findIdentifierColumn(CephClusterService, "name"),
    },
    serverlessFunctionId: {
      attributeKey: "resource.faas.name",
      findIdentifiers: findIdentifierColumn(
        ServerlessFunctionService,
        "functionIdentifier",
      ),
    },
    iotFleetId: {
      attributeKey: "resource.iot.fleet.name",
      findIdentifiers: findIdentifierColumn(IoTFleetService, "name"),
    },
    databaseServerId: {
      resolveEntityKeys: resolveDatabaseServerEntityKeys,
    },
  };

  return facetDefinitions;
}

/**
 * Append the resolved resource scopes to a hand-written aggregation
 * statement (the Log / Trace histogram, facet and analytics queries, which
 * build SQL directly rather than through StatementGenerator).
 *
 * Emits one `AND ( ... OR ... )` group per scope, mirroring exactly what
 * StatementGenerator compiles for the list query — the chart and the list
 * must agree on which rows a facet selects, or the histogram tells a
 * different story than the rows underneath it.
 *
 * A scope with no usable branch appends nothing rather than an empty
 * `IN ()`: an unresolvable filter must not silently match zero rows.
 */
export function appendResourceScopeFilters(
  statement: Statement,
  scopes: Array<ResourceEntityScope> | undefined,
): void {
  if (!scopes || scopes.length === 0) {
    return;
  }

  for (const scope of scopes) {
    if (!scope) {
      continue;
    }

    const branches: Array<Statement> = [];

    const entityIds: Array<string> = (scope.entityIds || []).filter(
      (id: string): boolean => {
        return typeof id === "string" && id.length > 0;
      },
    );

    if (entityIds.length > 0) {
      branches.push(
        SQL`primaryEntityId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(entityIds),
        }})`,
      );
    }

    const entityKeys: Array<string> = (scope.entityKeys || []).filter(
      (entityKey: string): boolean => {
        return typeof entityKey === "string" && entityKey.length > 0;
      },
    );

    if (entityKeys.length > 0) {
      branches.push(
        SQL`hasAny(entityKeys, ${{
          type: TableColumnType.ArrayText,
          value: entityKeys,
        }})`,
      );
    }

    const attributeValues: Array<string> = (scope.attributeValues || []).filter(
      (attributeValue: string): boolean => {
        return typeof attributeValue === "string" && attributeValue.length > 0;
      },
    );

    if (scope.attributeKey && attributeValues.length > 0) {
      branches.push(
        SQL`attributes[${{
          type: TableColumnType.Text,
          value: scope.attributeKey,
        }}] IN (${{
          type: TableColumnType.Text,
          value: new Includes(attributeValues),
        }})`,
      );
    }

    if (branches.length === 0) {
      continue;
    }

    statement.append(SQL` AND (`);

    for (const [index, branch] of branches.entries()) {
      if (index > 0) {
        statement.append(SQL` OR `);
      }
      statement.append(branch);
    }

    statement.append(SQL`)`);
  }
}

export default class ResourceEntityFilter {
  /**
   * Read the `resourceFilters` field off a request body (or an analytics
   * query record) into the canonical selection shape. Delegates to the
   * isomorphic parser so the browser and the server agree on exactly which
   * selections are well-formed.
   */
  public static parseSelections(
    source: JSONObject | undefined | null,
  ): ResourceEntityFacetSelections {
    return parseResourceEntityFacetSelections(source);
  }

  /**
   * Compile each facet's selected ids into a scope. One scope per facet, so
   * the caller ANDs them: selecting a cluster and a host means "in that
   * cluster AND on that host", which is what a reader expects of two
   * independent filter groups.
   *
   * The identifier lookup is best-effort: if Postgres is unreachable or an
   * id no longer resolves, the scope keeps its `entityIds` branch and
   * simply loses the entity-key one. That degrades to today's behavior
   * rather than dropping the constraint (which would silently widen the
   * result set).
   */
  @CaptureSpan()
  public static async resolveScopes(data: {
    projectId: ObjectID;
    selections: ResourceEntityFacetSelections;
  }): Promise<Array<ResourceEntityScope>> {
    const facetKeys: Array<string> = Object.keys(data.selections).filter(
      (key: string): boolean => {
        return (
          isResourceEntityFacetKey(key) &&
          (data.selections[key] || []).length > 0
        );
      },
    );

    if (facetKeys.length === 0) {
      return [];
    }

    return Promise.all(
      facetKeys.map(async (facetKey: string): Promise<ResourceEntityScope> => {
        return ResourceEntityFilter.resolveOne({
          projectId: data.projectId,
          facetKey,
          ids: data.selections[facetKey] || [],
        });
      }),
    );
  }

  /**
   * Query key the client puts the raw selected ids under, and the key the
   * compiled scopes are written to. Kept together so the rewrite below is
   * the only thing that has to know the pair.
   */
  public static readonly QUERY_FILTER_KEY: string = "resourceFilters";
  public static readonly QUERY_SCOPE_KEY: string = "resourceEntityScopes";

  /**
   * Rewrite an analytics list query in place: consume the client-sent
   * `resourceFilters` ids and replace them with the resolved
   * `resourceEntityScopes` that StatementGenerator compiles.
   *
   * The compiled key is always rebuilt from scratch — a client cannot
   * hand-craft one, so the only way a scope reaches the SQL is through this
   * resolver. (It could only ever narrow rows, but leaving one authoritative
   * writer keeps the predicate auditable.)
   *
   * Without a tenant the identifier lookup cannot be project-scoped, so the
   * scope keeps its id branch and drops the entity-key one: narrower than
   * the request asked for, never wider.
   */
  @CaptureSpan()
  public static async rewriteAnalyticsQuery(data: {
    query: Record<string, unknown> | undefined;
    projectId?: ObjectID | undefined;
  }): Promise<void> {
    const query: Record<string, unknown> | undefined = data.query;

    if (!query || typeof query !== "object") {
      return;
    }

    const raw: unknown = query[ResourceEntityFilter.QUERY_FILTER_KEY];

    delete query[ResourceEntityFilter.QUERY_FILTER_KEY];
    delete query[ResourceEntityFilter.QUERY_SCOPE_KEY];

    if (raw === undefined || raw === null) {
      return;
    }

    const selections: ResourceEntityFacetSelections =
      ResourceEntityFilter.parseSelections(raw as JSONObject);

    if (Object.keys(selections).length === 0) {
      return;
    }

    if (!data.projectId) {
      query[ResourceEntityFilter.QUERY_SCOPE_KEY] = Object.keys(selections).map(
        (facetKey: string): ResourceEntityScope => {
          return { entityIds: selections[facetKey] || [], entityKeys: [] };
        },
      );
      return;
    }

    const scopes: Array<ResourceEntityScope> =
      await ResourceEntityFilter.resolveScopes({
        projectId: data.projectId,
        selections,
      });

    if (scopes.length > 0) {
      query[ResourceEntityFilter.QUERY_SCOPE_KEY] = scopes;
    }
  }

  private static async resolveOne(data: {
    projectId: ObjectID;
    facetKey: string;
    ids: Array<string>;
  }): Promise<ResourceEntityScope> {
    const scope: ResourceEntityScope = {
      entityIds: data.ids,
      entityKeys: [],
    };

    const definition: ResourceFacetDefinition | undefined =
      getFacetDefinitions()[data.facetKey];

    if (!definition) {
      return scope;
    }

    const ids: Array<ObjectID> = data.ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    });

    if (definition.resolveEntityKeys) {
      try {
        const entityKeys: Array<string> = await definition.resolveEntityKeys({
          projectId: data.projectId,
          ids,
        });
        scope.entityKeys = Array.from(
          new Set(
            entityKeys.filter((entityKey: string): boolean => {
              return typeof entityKey === "string" && entityKey.length > 0;
            }),
          ),
        );
      } catch (err: unknown) {
        logger.warn(
          `Could not resolve ${data.facetKey} entity keys for the entity-key filter; falling back to primaryEntityId only: ${err}`,
        );
      }
      return scope;
    }

    if (!definition.findIdentifiers) {
      return scope;
    }

    let identifiers: Array<string> = [];

    try {
      identifiers = await definition.findIdentifiers({
        projectId: data.projectId,
        ids,
      });
    } catch (err: unknown) {
      logger.warn(
        `Could not resolve ${data.facetKey} identifiers for the entity-key filter; falling back to primaryEntityId only: ${err}`,
      );
      return scope;
    }

    const uniqueIdentifiers: Array<string> = Array.from(
      new Set(
        identifiers.filter((identifier: string): boolean => {
          return identifier.trim().length > 0;
        }),
      ),
    );

    if (uniqueIdentifiers.length === 0) {
      return scope;
    }

    const projectIdString: string = data.projectId.toString();
    const entityKeyFor:
      | ((projectId: string, identifier: string) => string)
      | undefined = definition.entityKeyFor;

    if (entityKeyFor) {
      scope.entityKeys = Array.from(
        new Set(
          uniqueIdentifiers.map((identifier: string): string => {
            return entityKeyFor(projectIdString, identifier);
          }),
        ),
      );
    }

    if (definition.attributeKey) {
      scope.attributeKey = definition.attributeKey;
      scope.attributeValues = uniqueIdentifiers;
    }

    return scope;
  }
}
