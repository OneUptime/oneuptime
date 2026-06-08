import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Search from "../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import ServiceModel from "../../../Models/DatabaseModels/Service";
import HostModel from "../../../Models/DatabaseModels/Host";
import DockerHostModel from "../../../Models/DatabaseModels/DockerHost";
import KubernetesClusterModel from "../../../Models/DatabaseModels/KubernetesCluster";
import ServerlessFunctionModel from "../../../Models/DatabaseModels/ServerlessFunction";
import CloudResourceModel from "../../../Models/DatabaseModels/CloudResource";
import RumApplicationModel from "../../../Models/DatabaseModels/RumApplication";
import ServiceService from "../../Services/ServiceService";
import HostService from "../../Services/HostService";
import DockerHostService from "../../Services/DockerHostService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import ServerlessFunctionService from "../../Services/ServerlessFunctionService";
import CloudResourceService from "../../Services/CloudResourceService";
import RumApplicationService from "../../Services/RumApplicationService";
import CaptureSpan from "./CaptureSpan";

/*
 * Facet keys whose values are entity IDs backed by a Postgres source-of-truth
 * table. ClickHouse aggregation only sees IDs that appear in the sampled
 * trace/log window, so low-volume resources never reach the filter sidebar.
 * Resolving the value list from Postgres instead means every project resource
 * shows up regardless of recent telemetry activity, and the sidebar search
 * matches across the full set (not just the loaded subset).
 */
export const RESOURCE_FACET_KEYS: ReadonlySet<string> = new Set([
  "serviceId",
  "hostId",
  "dockerHostId",
  "kubernetesClusterId",
  "serverlessFunctionId",
  "cloudResourceId",
  "rumApplicationId",
]);

export interface ResourceFacetSpec {
  facetKey: string;
  counts: Map<string, number>;
  searchText?: string | undefined;
  limit?: number | undefined;
}

export interface ResolvedFacetValue {
  value: string;
  count: number;
  displayName: string;
}

export default class ResourceFacetResolver {
  private static readonly DEFAULT_LIMIT: number = 500;

  public static isResourceFacet(facetKey: string): boolean {
    return RESOURCE_FACET_KEYS.has(facetKey);
  }

  @CaptureSpan()
  public static async resolve(
    projectId: ObjectID,
    specs: Array<ResourceFacetSpec>,
  ): Promise<Record<string, Array<ResolvedFacetValue>>> {
    const results: Array<readonly [string, Array<ResolvedFacetValue>]> =
      await Promise.all(
        specs.map(
          async (
            spec: ResourceFacetSpec,
          ): Promise<readonly [string, Array<ResolvedFacetValue>]> => {
            try {
              const values: Array<ResolvedFacetValue> =
                await ResourceFacetResolver.resolveOne(projectId, spec);
              return [spec.facetKey, values] as const;
            } catch {
              return [spec.facetKey, []] as const;
            }
          },
        ),
      );

    return Object.fromEntries(results);
  }

  private static async resolveOne(
    projectId: ObjectID,
    spec: ResourceFacetSpec,
  ): Promise<Array<ResolvedFacetValue>> {
    const limit: number = spec.limit ?? ResourceFacetResolver.DEFAULT_LIMIT;
    const searchText: string | undefined =
      spec.searchText && spec.searchText.trim().length > 0
        ? spec.searchText.trim()
        : undefined;

    switch (spec.facetKey) {
      case "serviceId":
        return ResourceFacetResolver.queryServices(
          projectId,
          spec.counts,
          searchText,
          limit,
        );
      case "hostId":
        return ResourceFacetResolver.queryHosts(
          projectId,
          spec.counts,
          searchText,
          limit,
        );
      case "dockerHostId":
        return ResourceFacetResolver.queryDockerHosts(
          projectId,
          spec.counts,
          searchText,
          limit,
        );
      case "kubernetesClusterId":
        return ResourceFacetResolver.queryKubernetesClusters(
          projectId,
          spec.counts,
          searchText,
          limit,
        );
      case "serverlessFunctionId":
        return ResourceFacetResolver.queryServerlessFunctions(
          projectId,
          spec.counts,
          searchText,
          limit,
        );
      case "cloudResourceId":
        return ResourceFacetResolver.queryCloudResources(
          projectId,
          spec.counts,
          searchText,
          limit,
        );
      case "rumApplicationId":
        return ResourceFacetResolver.queryRumApplications(
          projectId,
          spec.counts,
          searchText,
          limit,
        );
      default:
        return [];
    }
  }

  private static async queryServices(
    projectId: ObjectID,
    counts: Map<string, number>,
    searchText: string | undefined,
    limit: number,
  ): Promise<Array<ResolvedFacetValue>> {
    const query: Record<string, unknown> = { projectId };
    if (searchText) {
      query["name"] = new Search<string>(searchText);
    }

    const services: Array<ServiceModel> = await ServiceService.findBy({
      query: query as any,
      select: {
        _id: true,
        name: true,
      },
      limit: new PositiveNumber(limit),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

    return ResourceFacetResolver.mergeCounts(
      services.map((s: ServiceModel): { id: string; displayName: string } => {
        return {
          id: s._id ? s._id.toString() : "",
          displayName: s.name || "Unknown",
        };
      }),
      counts,
    );
  }

  private static async queryHosts(
    projectId: ObjectID,
    counts: Map<string, number>,
    searchText: string | undefined,
    limit: number,
  ): Promise<Array<ResolvedFacetValue>> {
    const query: Record<string, unknown> = { projectId };
    if (searchText) {
      query["name"] = new MultiSearch({
        fields: ["name", "hostIdentifier"],
        value: searchText,
      });
    }

    const hosts: Array<HostModel> = await HostService.findBy({
      query: query as any,
      select: {
        _id: true,
        name: true,
        hostIdentifier: true,
      },
      limit: new PositiveNumber(limit),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

    return ResourceFacetResolver.mergeCounts(
      hosts.map((h: HostModel): { id: string; displayName: string } => {
        return {
          id: h._id ? h._id.toString() : "",
          displayName: h.name || h.hostIdentifier || "Unknown",
        };
      }),
      counts,
    );
  }

  private static async queryDockerHosts(
    projectId: ObjectID,
    counts: Map<string, number>,
    searchText: string | undefined,
    limit: number,
  ): Promise<Array<ResolvedFacetValue>> {
    const query: Record<string, unknown> = { projectId };
    if (searchText) {
      query["name"] = new MultiSearch({
        fields: ["name", "hostIdentifier"],
        value: searchText,
      });
    }

    const dockerHosts: Array<DockerHostModel> = await DockerHostService.findBy({
      query: query as any,
      select: {
        _id: true,
        name: true,
        hostIdentifier: true,
      },
      limit: new PositiveNumber(limit),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

    return ResourceFacetResolver.mergeCounts(
      dockerHosts.map(
        (d: DockerHostModel): { id: string; displayName: string } => {
          return {
            id: d._id ? d._id.toString() : "",
            displayName: d.name || d.hostIdentifier || "Unknown",
          };
        },
      ),
      counts,
    );
  }

  private static async queryKubernetesClusters(
    projectId: ObjectID,
    counts: Map<string, number>,
    searchText: string | undefined,
    limit: number,
  ): Promise<Array<ResolvedFacetValue>> {
    const query: Record<string, unknown> = { projectId };
    if (searchText) {
      query["name"] = new MultiSearch({
        fields: ["name", "clusterIdentifier"],
        value: searchText,
      });
    }

    const clusters: Array<KubernetesClusterModel> =
      await KubernetesClusterService.findBy({
        query: query as any,
        select: {
          _id: true,
          name: true,
          clusterIdentifier: true,
        },
        limit: new PositiveNumber(limit),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

    return ResourceFacetResolver.mergeCounts(
      clusters.map(
        (c: KubernetesClusterModel): { id: string; displayName: string } => {
          return {
            id: c._id ? c._id.toString() : "",
            displayName: c.name || c.clusterIdentifier || "Unknown",
          };
        },
      ),
      counts,
    );
  }

  private static async queryServerlessFunctions(
    projectId: ObjectID,
    counts: Map<string, number>,
    searchText: string | undefined,
    limit: number,
  ): Promise<Array<ResolvedFacetValue>> {
    const query: Record<string, unknown> = { projectId };
    if (searchText) {
      query["name"] = new MultiSearch({
        fields: ["name", "functionIdentifier"],
        value: searchText,
      });
    }

    const functions: Array<ServerlessFunctionModel> =
      await ServerlessFunctionService.findBy({
        query: query as any,
        select: {
          _id: true,
          name: true,
          functionIdentifier: true,
        },
        limit: new PositiveNumber(limit),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

    return ResourceFacetResolver.mergeCounts(
      functions.map(
        (f: ServerlessFunctionModel): { id: string; displayName: string } => {
          return {
            id: f._id ? f._id.toString() : "",
            displayName: f.name || f.functionIdentifier || "Unknown",
          };
        },
      ),
      counts,
    );
  }

  private static async queryCloudResources(
    projectId: ObjectID,
    counts: Map<string, number>,
    searchText: string | undefined,
    limit: number,
  ): Promise<Array<ResolvedFacetValue>> {
    const query: Record<string, unknown> = { projectId };
    if (searchText) {
      query["name"] = new MultiSearch({
        fields: ["name", "resourceIdentifier"],
        value: searchText,
      });
    }

    const resources: Array<CloudResourceModel> =
      await CloudResourceService.findBy({
        query: query as any,
        select: {
          _id: true,
          name: true,
          resourceIdentifier: true,
        },
        limit: new PositiveNumber(limit),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

    return ResourceFacetResolver.mergeCounts(
      resources.map(
        (r: CloudResourceModel): { id: string; displayName: string } => {
          return {
            id: r._id ? r._id.toString() : "",
            displayName: r.name || r.resourceIdentifier || "Unknown",
          };
        },
      ),
      counts,
    );
  }

  private static async queryRumApplications(
    projectId: ObjectID,
    counts: Map<string, number>,
    searchText: string | undefined,
    limit: number,
  ): Promise<Array<ResolvedFacetValue>> {
    const query: Record<string, unknown> = { projectId };
    if (searchText) {
      query["name"] = new MultiSearch({
        fields: ["name", "appIdentifier"],
        value: searchText,
      });
    }

    const apps: Array<RumApplicationModel> =
      await RumApplicationService.findBy({
        query: query as any,
        select: {
          _id: true,
          name: true,
          appIdentifier: true,
        },
        limit: new PositiveNumber(limit),
        skip: new PositiveNumber(0),
        props: { isRoot: true },
      });

    return ResourceFacetResolver.mergeCounts(
      apps.map(
        (a: RumApplicationModel): { id: string; displayName: string } => {
          return {
            id: a._id ? a._id.toString() : "",
            displayName: a.name || a.appIdentifier || "Unknown",
          };
        },
      ),
      counts,
    );
  }

  /*
   * Combine Postgres-sourced entities with counts from the ClickHouse sample.
   * Entities without a count default to 0 (they exist in the project but
   * had no telemetry in the active window). Sorts active-first so the
   * highest-traffic resources surface at the top of the sidebar.
   */
  private static mergeCounts(
    entities: Array<{ id: string; displayName: string }>,
    counts: Map<string, number>,
  ): Array<ResolvedFacetValue> {
    const out: Array<ResolvedFacetValue> = entities
      .filter((e: { id: string }): boolean => {
        return e.id.length > 0;
      })
      .map((e: { id: string; displayName: string }): ResolvedFacetValue => {
        return {
          value: e.id,
          count: counts.get(e.id) || 0,
          displayName: e.displayName,
        };
      });

    out.sort((a: ResolvedFacetValue, b: ResolvedFacetValue): number => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    return out;
  }
}
