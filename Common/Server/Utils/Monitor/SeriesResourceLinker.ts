import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CephClusterService from "../../Services/CephClusterService";
import DockerHostService from "../../Services/DockerHostService";
import DockerSwarmClusterService from "../../Services/DockerSwarmClusterService";
import HostService from "../../Services/HostService";
import IoTFleetService from "../../Services/IoTFleetService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import PodmanHostService from "../../Services/PodmanHostService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import ServiceService from "../../Services/ServiceService";
import { MonitorClusterContext } from "./MonitorClusterContext";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";

/*
 * A grouped monitor opens one alert/incident per breaching series, and
 * each series carries the identity of the resource it came from in its
 * labels. This module turns those labels into real, project-scoped
 * resource rows and attaches them to the alert/incident, so "Affected
 * Resources", the per-resource Activity tabs, the sidebar badge counts
 * and the resource-owner/label inheritance rules all see the host (or
 * cluster, or service) the event is actually about.
 *
 * Alerts and incidents MUST agree here. They used to disagree: the
 * incident path resolved every resource type through the shared
 * SeriesResourceLabels key map while the alert path read two hard-coded
 * label spellings (`resource.host.name` / `host.name`) inline, so an
 * alert grouped by the far more common `oneuptime.host.name` stamp
 * linked nothing at all. Both paths now call this one module.
 */

/*
 * Structurally satisfied by both Alert and Incident — every relation
 * below is declared identically on the two models. Typed with
 * `| undefined` so the models' `public hosts?: Array<Host> = undefined;`
 * shape stays assignable under exactOptionalPropertyTypes.
 */
export interface SeriesLinkableModel {
  hosts?: Array<Host> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  podmanHosts?: Array<PodmanHost> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  services?: Array<Service> | undefined;
  proxmoxClusters?: Array<ProxmoxCluster> | undefined;
  cephClusters?: Array<CephCluster> | undefined;
  dockerSwarmClusters?: Array<DockerSwarmCluster> | undefined;
  iotFleets?: Array<IoTFleet> | undefined;
}

/*
 * Database ids of the resources one series points at, by type. Empty
 * arrays for every type the series says nothing about.
 */
export interface SeriesResolvedResourceIds {
  hostIds: Array<string>;
  dockerHostIds: Array<string>;
  podmanHostIds: Array<string>;
  kubernetesClusterIds: Array<string>;
  serviceIds: Array<string>;
  proxmoxClusterIds: Array<string>;
  cephClusterIds: Array<string>;
  dockerSwarmClusterIds: Array<string>;
  iotFleetIds: Array<string>;
}

/*
 * One resource type's lookup recipe: where its ids and names come from
 * in the extracted refs, which column its name maps to, and which
 * service reads the table.
 */
interface ResourceResolutionSpec {
  ids: Array<string>;
  names: Array<string>;
  nameColumn: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findBy: (args: any) => Promise<Array<{ _id?: string | undefined }>>;
}

export default class SeriesResourceLinker {
  /*
   * Resolve a series' labels to project-scoped database ids, without
   * touching any model. Lookups are ALWAYS project-scoped: `isRoot`
   * bypasses row-level access control, and a stale or hostile
   * `oneuptime.*.id` stamp must never be able to pull a row in from
   * another tenant.
   */
  public static async resolveResourcesFromSeriesLabels(input: {
    seriesLabels: JSONObject;
    projectId: ObjectID;
  }): Promise<SeriesResolvedResourceIds> {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
      input.seriesLabels,
    );

    /*
     * Proxmox / Ceph / Docker Swarm / IoT carry no `oneuptime.*.id`
     * stamp at ingest — they are addressable by name only — so their
     * `ids` lists are empty by construction, not by omission.
     */
    const specs: Array<ResourceResolutionSpec> = [
      {
        ids: refs.hostIds,
        names: refs.hostNames,
        nameColumn: "hostIdentifier",
        findBy: HostService.findBy.bind(HostService),
      },
      {
        ids: refs.dockerHostIds,
        names: refs.dockerHostNames,
        nameColumn: "hostIdentifier",
        findBy: DockerHostService.findBy.bind(DockerHostService),
      },
      {
        ids: refs.podmanHostIds,
        names: refs.podmanHostNames,
        nameColumn: "hostIdentifier",
        findBy: PodmanHostService.findBy.bind(PodmanHostService),
      },
      {
        ids: refs.kubernetesClusterIds,
        names: refs.kubernetesClusterNames,
        nameColumn: "clusterIdentifier",
        findBy: KubernetesClusterService.findBy.bind(KubernetesClusterService),
      },
      {
        ids: refs.serviceIds,
        names: refs.serviceNames,
        nameColumn: "name",
        findBy: ServiceService.findBy.bind(ServiceService),
      },
      {
        ids: [],
        names: refs.proxmoxClusterNames,
        nameColumn: "name",
        findBy: ProxmoxClusterService.findBy.bind(ProxmoxClusterService),
      },
      {
        ids: [],
        names: refs.cephClusterNames,
        nameColumn: "name",
        findBy: CephClusterService.findBy.bind(CephClusterService),
      },
      {
        ids: [],
        names: refs.dockerSwarmClusterNames,
        nameColumn: "name",
        findBy: DockerSwarmClusterService.findBy.bind(
          DockerSwarmClusterService,
        ),
      },
      {
        ids: [],
        names: refs.iotFleetNames,
        nameColumn: "name",
        findBy: IoTFleetService.findBy.bind(IoTFleetService),
      },
    ];

    const [
      hostIds,
      dockerHostIds,
      podmanHostIds,
      kubernetesClusterIds,
      serviceIds,
      proxmoxClusterIds,
      cephClusterIds,
      dockerSwarmClusterIds,
      iotFleetIds,
    ] = await Promise.all(
      specs.map((spec: ResourceResolutionSpec): Promise<Array<string>> => {
        return this.resolveResourceIds({
          ids: spec.ids,
          names: spec.names,
          nameColumn: spec.nameColumn,
          projectId: input.projectId,
          findBy: spec.findBy,
        });
      }),
    );

    return {
      hostIds: hostIds || [],
      dockerHostIds: dockerHostIds || [],
      podmanHostIds: podmanHostIds || [],
      kubernetesClusterIds: kubernetesClusterIds || [],
      serviceIds: serviceIds || [],
      proxmoxClusterIds: proxmoxClusterIds || [],
      cephClusterIds: cephClusterIds || [],
      dockerSwarmClusterIds: dockerSwarmClusterIds || [],
      iotFleetIds: iotFleetIds || [],
    };
  }

  /*
   * Resolve the series' resources and MERGE them onto the alert/incident.
   * Merging (rather than assigning) matters because attachClusterContext
   * writes the same four cluster relations from the monitor's step
   * config; whichever runs second must not erase the other's work.
   *
   * Relations the series says nothing about are left untouched —
   * `undefined`, not `[]` — so an ungrouped event and an event whose
   * resource has been deleted both stay clean rather than persisting an
   * empty join set.
   *
   * The attached rows are id-only stubs. Every in-memory consumer of a
   * freshly created alert/incident reads ids (the owner-inheritance rule
   * engine); anything that needs a name re-reads the persisted relation.
   */
  public static async linkSeriesResourcesToModel(input: {
    model: SeriesLinkableModel;
    seriesLabels: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const resolved: SeriesResolvedResourceIds =
      await this.resolveResourcesFromSeriesLabels({
        seriesLabels: input.seriesLabels,
        projectId: input.projectId,
      });

    this.mergeResolvedIdsIntoModel({
      model: input.model,
      resolved: resolved,
    });
  }

  /*
   * Attach the cluster ids resolved from the monitor's step config
   * (Proxmox / Ceph / Docker Swarm / IoT), merging with — never
   * overwriting — anything the series-label path already linked. Both
   * paths can resolve the same cluster, so this dedupes by id. Unlike
   * the label path this runs for ungrouped events too: those monitor
   * types get their cluster identity from the step config alone.
   */
  public static attachClusterContext(input: {
    model: SeriesLinkableModel;
    clusterContext: MonitorClusterContext;
  }): void {
    this.mergeResolvedIdsIntoModel({
      model: input.model,
      resolved: {
        hostIds: [],
        dockerHostIds: [],
        podmanHostIds: [],
        kubernetesClusterIds: [],
        serviceIds: [],
        proxmoxClusterIds: input.clusterContext.proxmoxClusterIds,
        cephClusterIds: input.clusterContext.cephClusterIds,
        dockerSwarmClusterIds: input.clusterContext.dockerSwarmClusterIds,
        iotFleetIds: input.clusterContext.iotFleetIds,
      },
    });
  }

  private static mergeResolvedIdsIntoModel(input: {
    model: SeriesLinkableModel;
    resolved: SeriesResolvedResourceIds;
  }): void {
    const model: SeriesLinkableModel = input.model;
    const resolved: SeriesResolvedResourceIds = input.resolved;

    if (resolved.hostIds.length > 0) {
      model.hosts = this.mergeById(model.hosts, resolved.hostIds, (): Host => {
        return new Host();
      });
    }

    if (resolved.dockerHostIds.length > 0) {
      model.dockerHosts = this.mergeById(
        model.dockerHosts,
        resolved.dockerHostIds,
        (): DockerHost => {
          return new DockerHost();
        },
      );
    }

    if (resolved.podmanHostIds.length > 0) {
      model.podmanHosts = this.mergeById(
        model.podmanHosts,
        resolved.podmanHostIds,
        (): PodmanHost => {
          return new PodmanHost();
        },
      );
    }

    if (resolved.kubernetesClusterIds.length > 0) {
      model.kubernetesClusters = this.mergeById(
        model.kubernetesClusters,
        resolved.kubernetesClusterIds,
        (): KubernetesCluster => {
          return new KubernetesCluster();
        },
      );
    }

    if (resolved.serviceIds.length > 0) {
      model.services = this.mergeById(
        model.services,
        resolved.serviceIds,
        (): Service => {
          return new Service();
        },
      );
    }

    if (resolved.proxmoxClusterIds.length > 0) {
      model.proxmoxClusters = this.mergeById(
        model.proxmoxClusters,
        resolved.proxmoxClusterIds,
        (): ProxmoxCluster => {
          return new ProxmoxCluster();
        },
      );
    }

    if (resolved.cephClusterIds.length > 0) {
      model.cephClusters = this.mergeById(
        model.cephClusters,
        resolved.cephClusterIds,
        (): CephCluster => {
          return new CephCluster();
        },
      );
    }

    if (resolved.dockerSwarmClusterIds.length > 0) {
      model.dockerSwarmClusters = this.mergeById(
        model.dockerSwarmClusters,
        resolved.dockerSwarmClusterIds,
        (): DockerSwarmCluster => {
          return new DockerSwarmCluster();
        },
      );
    }

    if (resolved.iotFleetIds.length > 0) {
      model.iotFleets = this.mergeById(
        model.iotFleets,
        resolved.iotFleetIds,
        (): IoTFleet => {
          return new IoTFleet();
        },
      );
    }
  }

  /*
   * Append the ids that aren't attached yet, preserving whatever is
   * already on the relation. A duplicate id in the array would violate
   * the join table's composite primary key on save, so dedupe by the
   * stringified `_id`.
   */
  private static mergeById<T extends { _id?: string | undefined }>(
    existing: Array<T> | undefined,
    incomingIds: Array<string>,
    create: () => T,
  ): Array<T> {
    const merged: Array<T> = [...(existing || [])];
    const seenIds: Set<string> = new Set<string>(
      merged.map((item: T): string => {
        return String(item._id);
      }),
    );

    for (const id of incomingIds) {
      if (seenIds.has(id)) {
        continue;
      }

      seenIds.add(id);

      const item: T = create();
      item._id = id;
      merged.push(item);
    }

    return merged;
  }

  /*
   * Turn one resource type's ids and names into deduped database ids.
   * Costs zero round-trips when the series carries neither, which is the
   * common case for most of the nine types on any given series.
   *
   * Name matching is exact. Every identifier column read here is written
   * by ingest from the same attribute the series label carries — host
   * identifiers are canonicalized on both sides — so exact matching is
   * what keeps a lookup from straying onto a neighbouring row.
   */
  private static async resolveResourceIds(input: {
    ids: Array<string>;
    names: Array<string>;
    nameColumn: string;
    projectId: ObjectID;
    /*
     * Loosely typed because each resource service has its own
     * `Query<TBaseModel>` shape and we deliberately abstract over
     * them. We only need the row's `_id` back, which every model
     * exposes via `DatabaseBaseModel`.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findBy: (args: any) => Promise<Array<{ _id?: string | undefined }>>;
  }): Promise<Array<string>> {
    if (input.ids.length === 0 && input.names.length === 0) {
      return [];
    }

    const resolved: Set<string> = new Set<string>();

    const lookups: Array<Promise<Array<{ _id?: string | undefined }>>> = [];

    if (input.ids.length > 0) {
      lookups.push(
        input.findBy({
          query: {
            projectId: input.projectId,
            _id: new Includes(input.ids),
          },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      );
    }

    if (input.names.length > 0) {
      lookups.push(
        input.findBy({
          query: {
            projectId: input.projectId,
            [input.nameColumn]: new Includes(input.names),
          },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      );
    }

    const buckets: Array<Array<{ _id?: string | undefined }>> =
      await Promise.all(lookups);

    for (const bucket of buckets) {
      for (const row of bucket) {
        if (row._id) {
          resolved.add(String(row._id));
        }
      }
    }

    return Array.from(resolved);
  }
}
