import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Search from "../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import { RESOURCE_FACET_CATALOG_KEYS } from "../../../Types/Telemetry/ResourceFacetCatalog";
import { SERVICE_FACET_KEYS } from "../../../Types/Telemetry/ResourceEntityFacet";
import FindBy from "../../Types/Database/FindBy";
import ServiceService from "../../Services/ServiceService";
import HostService from "../../Services/HostService";
import DockerHostService from "../../Services/DockerHostService";
import PodmanHostService from "../../Services/PodmanHostService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import DockerSwarmClusterService from "../../Services/DockerSwarmClusterService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import VMwareVCenterService from "../../Services/VMwareVCenterService";
import CephClusterService from "../../Services/CephClusterService";
import ServerlessFunctionService from "../../Services/ServerlessFunctionService";
import CloudResourceService from "../../Services/CloudResourceService";
import RumApplicationService from "../../Services/RumApplicationService";
import IoTFleetService from "../../Services/IoTFleetService";
import CaptureSpan from "./CaptureSpan";

/*
 * Facet keys whose values are entity IDs backed by a Postgres source-of-truth
 * table. ClickHouse aggregation only sees IDs that appear in the sampled
 * trace/log window, so low-volume resources never reach the filter sidebar.
 * Resolving the value list from Postgres instead means every project resource
 * shows up regardless of recent telemetry activity, and the sidebar search
 * matches across the full set (not just the loaded subset).
 *
 * The Services facet (`primaryEntityId`, plus `serviceId` — its pre-rename
 * alias, kept so stale clients keep resolving across a deploy) and every
 * resource type in the shared catalog. Derived from the catalog so a new
 * resource type cannot be offered by the explorers yet silently skipped
 * here; the listing table below must carry a row for each key (pinned
 * by ResourceFacetResolver.test).
 */
export const RESOURCE_FACET_KEYS: ReadonlySet<string> = new Set<string>([
  ...SERVICE_FACET_KEYS,
  ...RESOURCE_FACET_CATALOG_KEYS,
]);

/*
 * What a caller asks to list: the facet, an optional partial-match filter
 * typed into that facet's sidebar search, and a page size.
 */
export interface ResourceFacetListSpec {
  facetKey: string;
  searchText?: string | undefined;
  limit?: number | undefined;
}

export interface ResourceFacetSpec extends ResourceFacetListSpec {
  counts: Map<string, number>;
}

// One Postgres row of a resource facet, before any telemetry count is known.
export interface ResourceFacetEntity {
  id: string;
  displayName: string;
}

export interface ResolvedFacetValue {
  value: string;
  count: number;
  displayName: string;
}

/*
 * Only `findBy` is used, and it is always called through the service
 * instance (never a captured method reference), so a test spying on the
 * instance intercepts it.
 */
interface ResourceFacetSourceService {
  findBy: (findBy: FindBy<any>) => Promise<Array<any>>;
}

interface ResourceFacetListing {
  service: ResourceFacetSourceService;
  /*
   * The row's telemetry-facing identifier: searched together with `name`
   * and used as the display name when a row has no name. `null` when the
   * row has no second identifying column worth searching — Services, and
   * the resource types whose `name` IS the ingest join key
   * (`findOrCreateByName`: Proxmox cluster, vCenter, IoT fleet) — which
   * search `name` alone.
   */
  identifierField: string | null;
}

/*
 * facetKey -> where its value list lives. One table instead of one query
 * method per type: every resource type lists the same way (project-scoped,
 * root, first `limit` rows, optional name search), so the only per-type
 * facts are the service and the identifier column.
 *
 * Ceph and Docker Swarm also join on `name`, but carry a stable descriptive
 * id (`fsid` / `swarmId`) an operator may well paste into the search box,
 * so it is searched too.
 *
 * Built on first use rather than at module load: the services pull in much
 * of the server, and a module cycle that reached this file first would
 * otherwise capture an `undefined` service and every lookup would quietly
 * degrade to [].
 */
let resourceFacetListings: ReadonlyMap<string, ResourceFacetListing> | null =
  null;

function getResourceFacetListings(): ReadonlyMap<string, ResourceFacetListing> {
  if (resourceFacetListings) {
    return resourceFacetListings;
  }

  const serviceListing: ResourceFacetListing = {
    service: ServiceService,
    identifierField: null,
  };

  resourceFacetListings = new Map<string, ResourceFacetListing>([
    ["primaryEntityId", serviceListing],
    ["serviceId", serviceListing],
    ["hostId", { service: HostService, identifierField: "hostIdentifier" }],
    [
      "dockerHostId",
      { service: DockerHostService, identifierField: "hostIdentifier" },
    ],
    [
      "podmanHostId",
      { service: PodmanHostService, identifierField: "hostIdentifier" },
    ],
    [
      "kubernetesClusterId",
      {
        service: KubernetesClusterService,
        identifierField: "clusterIdentifier",
      },
    ],
    [
      "dockerSwarmClusterId",
      { service: DockerSwarmClusterService, identifierField: "swarmId" },
    ],
    [
      "proxmoxClusterId",
      { service: ProxmoxClusterService, identifierField: null },
    ],
    [
      "vmwareVCenterId",
      { service: VMwareVCenterService, identifierField: null },
    ],
    ["cephClusterId", { service: CephClusterService, identifierField: "fsid" }],
    [
      "serverlessFunctionId",
      {
        service: ServerlessFunctionService,
        identifierField: "functionIdentifier",
      },
    ],
    [
      "cloudResourceId",
      { service: CloudResourceService, identifierField: "resourceIdentifier" },
    ],
    [
      "rumApplicationId",
      { service: RumApplicationService, identifierField: "appIdentifier" },
    ],
    ["iotFleetId", { service: IoTFleetService, identifierField: null }],
  ]);

  return resourceFacetListings;
}

export default class ResourceFacetResolver {
  private static readonly DEFAULT_LIMIT: number = 500;

  public static isResourceFacet(facetKey: string): boolean {
    return RESOURCE_FACET_KEYS.has(facetKey);
  }

  /*
   * One-shot form: list every spec's entities and merge the counts the
   * caller already has. Callers that want to skip counting a facet with
   * nothing to count (see ResourceFacetPlanner) use listEntities and
   * mergeCounts separately.
   */
  @CaptureSpan()
  public static async resolve(
    projectId: ObjectID,
    specs: Array<ResourceFacetSpec>,
  ): Promise<Record<string, Array<ResolvedFacetValue>>> {
    const entities: Record<
      string,
      Array<ResourceFacetEntity>
    > = await ResourceFacetResolver.listEntities(projectId, specs);

    return Object.fromEntries(
      specs.map(
        (
          spec: ResourceFacetSpec,
        ): readonly [string, Array<ResolvedFacetValue>] => {
          return [
            spec.facetKey,
            ResourceFacetResolver.mergeCounts(
              entities[spec.facetKey] || [],
              spec.counts,
            ),
          ] as const;
        },
      ),
    );
  }

  /*
   * Phase one: the Postgres rows behind each facet, keyed by facet. Runs the
   * lookups in parallel; a failing lookup degrades to [] for that facet
   * only, and a key that is not a resource facet lists [] without a query.
   * Rows without an id are dropped here, so an empty list reliably means
   * "nothing to count".
   */
  @CaptureSpan()
  public static async listEntities(
    projectId: ObjectID,
    specs: Array<ResourceFacetListSpec>,
  ): Promise<Record<string, Array<ResourceFacetEntity>>> {
    const results: Array<readonly [string, Array<ResourceFacetEntity>]> =
      await Promise.all(
        specs.map(
          async (
            spec: ResourceFacetListSpec,
          ): Promise<readonly [string, Array<ResourceFacetEntity>]> => {
            try {
              const entities: Array<ResourceFacetEntity> =
                await ResourceFacetResolver.listOne(projectId, spec);
              return [spec.facetKey, entities] as const;
            } catch {
              return [spec.facetKey, []] as const;
            }
          },
        ),
      );

    return Object.fromEntries(results);
  }

  /*
   * Phase two: combine Postgres-sourced entities with counts from ClickHouse.
   * Entities without a count default to 0 (they exist in the project but
   * had no telemetry in the active window); counts for ids that are not
   * listed are never invented. Sorts active-first so the highest-traffic
   * resources surface at the top of the sidebar.
   */
  public static mergeCounts(
    entities: Array<ResourceFacetEntity>,
    counts: Map<string, number>,
  ): Array<ResolvedFacetValue> {
    const out: Array<ResolvedFacetValue> = entities
      .filter((e: ResourceFacetEntity): boolean => {
        return e.id.length > 0;
      })
      .map((e: ResourceFacetEntity): ResolvedFacetValue => {
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

  private static async listOne(
    projectId: ObjectID,
    spec: ResourceFacetListSpec,
  ): Promise<Array<ResourceFacetEntity>> {
    const listing: ResourceFacetListing | undefined =
      getResourceFacetListings().get(spec.facetKey);

    if (!listing) {
      return [];
    }

    const limit: number = spec.limit ?? ResourceFacetResolver.DEFAULT_LIMIT;
    const searchText: string | undefined =
      spec.searchText && spec.searchText.trim().length > 0
        ? spec.searchText.trim()
        : undefined;
    const identifierField: string | null = listing.identifierField;

    const query: Record<string, unknown> = { projectId };
    const select: Record<string, boolean> = { _id: true, name: true };

    if (identifierField) {
      select[identifierField] = true;
    }

    if (searchText) {
      query["name"] = identifierField
        ? new MultiSearch({
            fields: ["name", identifierField],
            value: searchText,
          })
        : new Search<string>(searchText);
    }

    const rows: Array<Record<string, unknown>> = await listing.service.findBy({
      query: query as any,
      select: select as any,
      limit: new PositiveNumber(limit),
      skip: new PositiveNumber(0),
      props: { isRoot: true },
    });

    return rows
      .map((row: Record<string, unknown>): ResourceFacetEntity => {
        const id: unknown = row["_id"];
        const name: unknown = row["name"];
        const identifier: unknown = identifierField
          ? row[identifierField]
          : undefined;

        return {
          id: id ? String(id) : "",
          displayName:
            (typeof name === "string" && name) ||
            (typeof identifier === "string" && identifier) ||
            "Unknown",
        };
      })
      .filter((entity: ResourceFacetEntity): boolean => {
        return entity.id.length > 0;
      });
  }
}
