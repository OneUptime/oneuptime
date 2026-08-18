import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { JSONObject } from "../../../Types/JSON";
import HostModel from "../../../Models/DatabaseModels/Host";
import DockerHostModel from "../../../Models/DatabaseModels/DockerHost";
import PodmanHostModel from "../../../Models/DatabaseModels/PodmanHost";
import KubernetesClusterModel from "../../../Models/DatabaseModels/KubernetesCluster";
import HostService from "../../Services/HostService";
import DockerHostService from "../../Services/DockerHostService";
import PodmanHostService from "../../Services/PodmanHostService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import {
  keyForHost,
  keyForKubernetesCluster,
} from "../../../Utils/Telemetry/EntityKey";
import {
  ResourceEntityFacetSelections,
  isResourceEntityFacetKey,
  parseResourceEntityFacetSelections,
} from "../../../Types/Telemetry/ResourceEntityFacet";
import Includes from "../../../Types/BaseDatabase/Includes";
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
 *                     still carries the host / cluster key here.
 *  - `attribute*`  -> `attributes['resource.<attr>'] IN (...)`. The
 *                     pre-`entityKeys` fallback, mirroring the entityScope
 *                     contract the resource detail pages already use, so
 *                     rows ingested before the column shipped (no backfill
 *                     by decision) keep matching.
 */
export interface ResourceEntityScope {
  entityIds: Array<string>;
  entityKeys: Array<string>;
  attributeKey?: string | undefined;
  attributeValues?: Array<string> | undefined;
}

interface ResourceFacetDefinition {
  /** Signal attribute the identifying value is stamped under. */
  attributeKey: string;
  /** Read-side entity-key helper, mirroring the ingest-side resolver. */
  entityKeyFor: (projectId: string, identifier: string) => string;
  findIdentifiers: (data: {
    projectId: ObjectID;
    ids: Array<ObjectID>;
  }) => Promise<Array<string>>;
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
 */
const FACET_DEFINITIONS: Record<string, ResourceFacetDefinition> = {
  hostId: {
    attributeKey: "resource.host.name",
    entityKeyFor: keyForHost,
    findIdentifiers: async (data: {
      projectId: ObjectID;
      ids: Array<ObjectID>;
    }): Promise<Array<string>> => {
      const rows: Array<HostModel> = await HostService.findBy({
        query: { projectId: data.projectId, _id: new Includes(data.ids) },
        select: { hostIdentifier: true },
        limit: new PositiveNumber(data.ids.length),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

      return rows.map((row: HostModel): string => {
        return row.hostIdentifier || "";
      });
    },
  },
  dockerHostId: {
    attributeKey: "resource.host.name",
    entityKeyFor: keyForHost,
    findIdentifiers: async (data: {
      projectId: ObjectID;
      ids: Array<ObjectID>;
    }): Promise<Array<string>> => {
      const rows: Array<DockerHostModel> = await DockerHostService.findBy({
        query: { projectId: data.projectId, _id: new Includes(data.ids) },
        select: { hostIdentifier: true },
        limit: new PositiveNumber(data.ids.length),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

      return rows.map((row: DockerHostModel): string => {
        return row.hostIdentifier || "";
      });
    },
  },
  podmanHostId: {
    attributeKey: "resource.host.name",
    entityKeyFor: keyForHost,
    findIdentifiers: async (data: {
      projectId: ObjectID;
      ids: Array<ObjectID>;
    }): Promise<Array<string>> => {
      const rows: Array<PodmanHostModel> = await PodmanHostService.findBy({
        query: { projectId: data.projectId, _id: new Includes(data.ids) },
        select: { hostIdentifier: true },
        limit: new PositiveNumber(data.ids.length),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

      return rows.map((row: PodmanHostModel): string => {
        return row.hostIdentifier || "";
      });
    },
  },
  kubernetesClusterId: {
    attributeKey: "resource.k8s.cluster.name",
    entityKeyFor: keyForKubernetesCluster,
    findIdentifiers: async (data: {
      projectId: ObjectID;
      ids: Array<ObjectID>;
    }): Promise<Array<string>> => {
      const rows: Array<KubernetesClusterModel> =
        await KubernetesClusterService.findBy({
          query: { projectId: data.projectId, _id: new Includes(data.ids) },
          select: { clusterIdentifier: true },
          limit: new PositiveNumber(data.ids.length),
          skip: new PositiveNumber(0),
          props: { isRoot: true },
        });

      return rows.map((row: KubernetesClusterModel): string => {
        return row.clusterIdentifier || "";
      });
    },
  },
};

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
      FACET_DEFINITIONS[data.facetKey];

    if (!definition) {
      return scope;
    }

    let identifiers: Array<string> = [];

    try {
      identifiers = await definition.findIdentifiers({
        projectId: data.projectId,
        ids: data.ids.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
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

    scope.entityKeys = Array.from(
      new Set(
        uniqueIdentifiers.map((identifier: string): string => {
          return definition.entityKeyFor(projectIdString, identifier);
        }),
      ),
    );
    scope.attributeKey = definition.attributeKey;
    scope.attributeValues = uniqueIdentifiers;

    return scope;
  }
}
