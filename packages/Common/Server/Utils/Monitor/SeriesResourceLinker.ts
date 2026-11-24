import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import Service from "../../../Models/DatabaseModels/Service";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import CephClusterService from "../../Services/CephClusterService";
import CloudResourceService from "../../Services/CloudResourceService";
import DatabaseServerEndpointService from "../../Services/DatabaseServerEndpointService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DockerHostService from "../../Services/DockerHostService";
import DockerSwarmClusterService from "../../Services/DockerSwarmClusterService";
import HostService from "../../Services/HostService";
import IoTFleetService from "../../Services/IoTFleetService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import PodmanHostService from "../../Services/PodmanHostService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import ServiceService from "../../Services/ServiceService";
import StorageArrayService from "../../Services/StorageArrayService";
import VMwareVCenterService from "../../Services/VMwareVCenterService";
import QueryHelper from "../../Types/Database/QueryHelper";
import UUIDColumnFilter from "../../Types/Database/UUIDColumnFilter";
import { EventLoopBudget } from "../EventLoop";
import logger from "../Logger";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";

/*
 * How a resource's NAME is matched against its identifier column.
 * Ingest-written series labels match byte for byte; user-typed monitor
 * step identifiers may differ from the agent-stamped name by case.
 */
export type NameMatchMode = "exact" | "caseInsensitive";

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
  openStackClouds?: Array<OpenStackCloud> | undefined;
  vmwareVCenters?: Array<VMwareVCenter> | undefined;
  cephClusters?: Array<CephCluster> | undefined;
  dockerSwarmClusters?: Array<DockerSwarmCluster> | undefined;
  iotFleets?: Array<IoTFleet> | undefined;
  databaseServers?: Array<DatabaseServer> | undefined;
  storageArrays?: Array<StorageArray> | undefined;
  cloudResources?: Array<CloudResource> | undefined;
  networkDevices?: Array<NetworkDevice> | undefined;
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
  openStackCloudIds: Array<string>;
  vmwareVCenterIds: Array<string>;
  cephClusterIds: Array<string>;
  dockerSwarmClusterIds: Array<string>;
  iotFleetIds: Array<string>;
  databaseServerIds: Array<string>;
  storageArrayIds: Array<string>;
  /*
   * Cloud resources carry no series stamp. A monitor names its cloud
   * resource in its Linked Resources (MonitorResourceContext) and - when
   * its query was built on the resource's Metrics page, or by the
   * resource's Recommendations - in its query's event scope
   * (MonitorStepResourceIdentity).
   */
  cloudResourceIds: Array<string>;
  /*
   * The routers, switches and firewalls the monitor reports on: the device
   * a Network Device monitor's step watches, the device a monitor is bound
   * to (its monitoring method is Monitor) and the device a discovery import
   * made the monitor for (MonitorResourceContext).
   */
  networkDeviceIds: Array<string>;
}

/*
 * One resource type as both paths read it: the one series' path
 * (resolveResourceRefs) and the many series' (resolveManySeries). Where
 * its ids land in a resolution, where its ids and names come from in a
 * series' refs, the column its name maps to, and the service that reads
 * its table. One table, so the two paths cannot resolve the same label to
 * different rows.
 */
interface ResourceKind {
  resultKey: keyof SeriesResolvedResourceIds;
  ids: (refs: SeriesResourceRefs) => Array<string>;
  names: (refs: SeriesResourceRefs) => Array<string>;
  nameColumn: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findBy: (args: any) => Promise<Array<{ _id?: string | undefined }>>;
}

// What a lookup reads of a resource row.
interface ResolvedResourceRow {
  _id?: string | undefined;
  createdAt?: Date | undefined;
  [nameColumn: string]: unknown;
}

/*
 * One kind's rows a lookup of the many series' path read, in the order read,
 * and where each identifier's rows are among them.
 */
interface KindRead {
  rows: Array<ResolvedResourceRow>;
  positions: Map<string, Array<number>>;
}

/*
 * The most identifiers one read of the many series' path names, and so the
 * most rows it can answer with: each name column is unique in a project
 * (Host's and the clusters' unique indexes), as an id is, so a read never
 * comes back cut at its limit. A kind with more is read in as many reads
 * as it takes, whatever the number of series.
 */
const MAX_IDENTIFIERS_PER_READ: number = LIMIT_PER_PROJECT;

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
    /*
     * Optional, and only consulted to disambiguate `host.name`. Left
     * undefined by callers that have no monitor in hand.
     */
    monitorType?: MonitorType | undefined;
  }): Promise<SeriesResolvedResourceIds> {
    /*
     * Series labels are ingest-written, so they match the resource
     * rows' identifier columns byte for byte. See resolveResourceIds
     * for why that rules out case-insensitive matching here.
     */
    return this.resolveResourceRefs({
      refs: this.seriesRefsOf(input.seriesLabels, input.monitorType),
      projectId: input.projectId,
      nameMatch: "exact",
    });
  }

  /*
   * The identifiers a series' labels name, as both series paths read them.
   */
  private static seriesRefsOf(
    seriesLabels: JSONObject,
    monitorType: MonitorType | undefined,
  ): SeriesResourceRefs {
    const refs: SeriesResourceRefs =
      SeriesResourceLabels.extractResourceRefs(seriesLabels);

    /*
     * On a Docker or Podman monitor, `resource.host.name` names the
     * DockerHost / PodmanHost the containers run on — the agent stamps
     * the container runtime's host under the generic key. The label key
     * map hands that key to Host, which would attach an unrelated Host
     * row and surface the event on that host's Activity tab. The
     * step-config path links the right model instead
     * (MonitorStepResourceIdentity), so drop the host refs here rather
     * than linking a resource the event is not about.
     */
    if (
      monitorType === MonitorType.Docker ||
      monitorType === MonitorType.Podman
    ) {
      refs.hostIds = [];
      refs.hostNames = [];
    }

    return refs;
  }

  /*
   * THE SERIES OF ONE EVALUATION, RESOLVED TOGETHER (issue #10315).
   *
   * Each record a grouped monitor opens is about one series, and was linked
   * by reading that series' resources on its own: an evaluation that opened
   * alerts for 700 series of a fleet read the Host table 700 times, one
   * after another. This reads every series' identifiers at once - one read
   * per resource kind by id and one by name, all kinds side by side, as one
   * series' reads are - and hands each series its part of the answer: the
   * same database ids, in the same order, as resolveResourcesFromSeriesLabels
   * gives that series alone.
   *
   *   - The same rows. Each lookup reads what one series' lookup reads: the
   *     project's rows whose id is one of the ids, or whose name column
   *     equals one of the names (exactly, as Postgres compares them), with
   *     the same root read and the same order (createdAt, newest first).
   *     An id is matched in the form Postgres reads it in (a uuid in any
   *     case, braced or not), a name as the client sends it (UTF-8, a lone
   *     surrogate as U+FFFD).
   *   - The same order. A series' rows are its id rows as they were read,
   *     then its name rows, each repeated id once.
   *   - The same failures. A series with an identifier one read of all of
   *     them would fail on - an id that is no uuid, a name with a NUL,
   *     which Postgres refuses - is left out, so its record is linked by
   *     its own read and fails on its own, as before, and the rest are not
   *     held back by it. So is one that names a database by its endpoint,
   *     which no series label does.
   *
   * The map holds the series it resolved, by their labels' object. Every
   * other series is resolved by itself when its record is linked
   * (SeriesResourcesOfEvaluation). Hands the event loop back between
   * series once the budget is spent, as the create pass around it does.
   */
  public static async resolveManySeries(input: {
    seriesLabels: ReadonlyArray<JSONObject>;
    projectId: ObjectID;
    monitorType?: MonitorType | undefined;
    budget?: EventLoopBudget | undefined;
  }): Promise<Map<JSONObject, SeriesResolvedResourceIds>> {
    const budget: EventLoopBudget = input.budget || new EventLoopBudget();
    const kinds: Array<ResourceKind> = this.resourceKinds();
    const entries: Array<{ labels: JSONObject; refs: SeriesResourceRefs }> = [];
    const seen: Set<JSONObject> = new Set<JSONObject>();

    // Every kind's identifiers over the series, each once, as they are matched.
    const idsByKind: Array<Set<string>> = kinds.map((): Set<string> => {
      return new Set<string>();
    });
    const namesByKind: Array<Set<string>> = kinds.map((): Set<string> => {
      return new Set<string>();
    });

    for (const labels of input.seriesLabels) {
      if (budget.isSpent()) {
        await budget.handBack();
      }

      if (!labels || typeof labels !== "object" || seen.has(labels)) {
        continue;
      }

      seen.add(labels);

      const refs: SeriesResourceRefs = this.seriesRefsOf(
        labels,
        input.monitorType,
      );

      if (!this.isReadTogether(refs, kinds)) {
        continue;
      }

      entries.push({ labels: labels, refs: refs });

      kinds.forEach((kind: ResourceKind, index: number): void => {
        for (const id of kind.ids(refs)) {
          idsByKind[index]!.add(this.toIdKey(id));
        }

        for (const name of kind.names(refs)) {
          namesByKind[index]!.add(this.toNameKey(name));
        }
      });
    }

    const resolutions: Map<JSONObject, SeriesResolvedResourceIds> = new Map<
      JSONObject,
      SeriesResolvedResourceIds
    >();

    if (entries.length === 0) {
      return resolutions;
    }

    const reads: Array<{ byId: KindRead; byName: KindRead }> =
      await Promise.all(
        kinds.map(
          async (
            kind: ResourceKind,
            index: number,
          ): Promise<{ byId: KindRead; byName: KindRead }> => {
            const [byId, byName] = await Promise.all([
              this.readKind({
                kind: kind,
                column: "_id",
                values: idsByKind[index]!,
                projectId: input.projectId,
              }),
              this.readKind({
                kind: kind,
                column: kind.nameColumn,
                values: namesByKind[index]!,
                projectId: input.projectId,
              }),
            ]);

            return { byId: byId, byName: byName };
          },
        ),
      );

    for (const entry of entries) {
      if (budget.isSpent()) {
        await budget.handBack();
      }

      const resolved: SeriesResolvedResourceIds =
        SeriesResourceLinker.emptyResolution();

      kinds.forEach((kind: ResourceKind, index: number): void => {
        const read: { byId: KindRead; byName: KindRead } = reads[index]!;
        const found: Set<string> = new Set<string>();

        for (const row of this.rowsOf(
          read.byId,
          kind.ids(entry.refs).map((id: string): string => {
            return this.toIdKey(id);
          }),
        )) {
          if (row._id) {
            found.add(String(row._id));
          }
        }

        for (const row of this.rowsOf(
          read.byName,
          kind.names(entry.refs).map((name: string): string => {
            return this.toNameKey(name);
          }),
        )) {
          if (row._id) {
            found.add(String(row._id));
          }
        }

        resolved[kind.resultKey] = Array.from(found);
      });

      resolutions.set(entry.labels, resolved);
    }

    return resolutions;
  }

  /*
   * Whether a series' identifiers can be read with every other series':
   * each id one Postgres reads as a uuid (UUIDColumnFilter, which refuses
   * any other before it is sent), no name with a NUL (which Postgres
   * refuses in text), and no database endpoint.
   */
  private static isReadTogether(
    refs: SeriesResourceRefs,
    kinds: Array<ResourceKind>,
  ): boolean {
    if ((refs.databaseServerEndpoints || []).length > 0) {
      return false;
    }

    for (const kind of kinds) {
      for (const id of kind.ids(refs)) {
        if (!UUIDColumnFilter.isUUIDText(id)) {
          return false;
        }
      }

      for (const name of kind.names(refs)) {
        if (name.includes("\u0000")) {
          return false;
        }
      }
    }

    return true;
  }

  /*
   * An id as Postgres reads a uuid and writes it back: 32 hex digits in
   * lower case, hyphenated 8-4-4-4-12, whatever case, braces and hyphens it
   * was written with. Only ever handed text UUIDColumnFilter reads as one.
   */
  private static toIdKey(id: string): string {
    const unbraced: string =
      id.startsWith("{") && id.endsWith("}") ? id.slice(1, -1) : id;
    const hex: string = unbraced.split("-").join("").toLowerCase();

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /*
   * A name as Postgres compares it: the client sends text as UTF-8, a lone
   * surrogate as U+FFFD, and a name column equals it byte for byte.
   */
  private static toNameKey(name: string): string {
    return Buffer.from(name, "utf8").toString("utf8");
  }

  /*
   * One kind's rows whose `column` holds one of `values`, read as one
   * series' lookup reads them, MAX_IDENTIFIERS_PER_READ values a read.
   * Kept in the order they were read: newest first, the service's own
   * order, across reads too.
   */
  private static async readKind(input: {
    kind: ResourceKind;
    column: string;
    values: Set<string>;
    projectId: ObjectID;
  }): Promise<KindRead> {
    const values: Array<string> = Array.from(input.values);
    const positions: Map<string, Array<number>> = new Map<
      string,
      Array<number>
    >();

    if (values.length === 0) {
      return { rows: [], positions: positions };
    }

    const parts: Array<Array<string>> = [];

    for (
      let start: number = 0;
      start < values.length;
      start += MAX_IDENTIFIERS_PER_READ
    ) {
      parts.push(values.slice(start, start + MAX_IDENTIFIERS_PER_READ));
    }

    const answers: Array<Array<ResolvedResourceRow>> = await Promise.all(
      parts.map(
        async (part: Array<string>): Promise<Array<ResolvedResourceRow>> => {
          return (await input.kind.findBy({
            query: {
              projectId: input.projectId,
              [input.column]: new Includes(part),
            },
            select: {
              _id: true,
              createdAt: true,
              ...(input.column === "_id" ? {} : { [input.column]: true }),
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          })) as Array<ResolvedResourceRow>;
        },
      ),
    );

    let rows: Array<ResolvedResourceRow> = answers.flat();

    if (answers.length > 1) {
      // Each read is newest first; so is the whole, ties kept in read order.
      rows = rows
        .map((row: ResolvedResourceRow, index: number) => {
          return { row: row, index: index };
        })
        .sort(
          (
            a: { row: ResolvedResourceRow; index: number },
            b: { row: ResolvedResourceRow; index: number },
          ): number => {
            return (
              this.toTime(b.row.createdAt) - this.toTime(a.row.createdAt) ||
              a.index - b.index
            );
          },
        )
        .map((entry: { row: ResolvedResourceRow }): ResolvedResourceRow => {
          return entry.row;
        });
    }

    rows.forEach((row: ResolvedResourceRow, index: number): void => {
      const value: unknown =
        input.column === "_id" ? row._id : row[input.column];

      if (value === undefined || value === null) {
        return;
      }

      const key: string = String(value);
      const at: Array<number> = positions.get(key) || [];
      at.push(index);
      positions.set(key, at);
    });

    return { rows: rows, positions: positions };
  }

  private static toTime(value: unknown): number {
    const time: number =
      value instanceof Date
        ? value.getTime()
        : new Date(String(value)).getTime();

    return Number.isFinite(time) ? time : 0;
  }

  // The rows of a kind's read that one series names, in the order read.
  private static rowsOf(
    read: KindRead,
    keys: Array<string>,
  ): Array<ResolvedResourceRow> {
    const at: Set<number> = new Set<number>();

    for (const key of keys) {
      for (const position of read.positions.get(key) || []) {
        at.add(position);
      }
    }

    return Array.from(at)
      .sort((a: number, b: number): number => {
        return a - b;
      })
      .map((position: number): ResolvedResourceRow => {
        return read.rows[position]!;
      });
  }

  // A resolution that names nothing, its lists in their usual order.
  private static emptyResolution(): SeriesResolvedResourceIds {
    return {
      hostIds: [],
      dockerHostIds: [],
      podmanHostIds: [],
      kubernetesClusterIds: [],
      serviceIds: [],
      proxmoxClusterIds: [],
      openStackCloudIds: [],
      vmwareVCenterIds: [],
      cephClusterIds: [],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
      databaseServerIds: [],
      storageArrayIds: [],
      cloudResourceIds: [],
      networkDeviceIds: [],
    };
  }

  /*
   * The one place that turns identifiers into database ids, shared by
   * the series-label path and the monitor-step-config path
   * (MonitorStepResourceIdentity). Keeping the ten-way lookup table,
   * the project scoping and the `Includes` batching in a single
   * function is what stops the two paths from resolving the same
   * identifier to different rows.
   */
  public static async resolveResourceRefs(input: {
    refs: SeriesResourceRefs;
    projectId: ObjectID;
    nameMatch: NameMatchMode;
  }): Promise<SeriesResolvedResourceIds> {
    const refs: SeriesResourceRefs = input.refs;
    const kinds: Array<ResourceKind> = this.resourceKinds();

    const [resolvedByKind, databaseServerIdsByEndpoint] = await Promise.all([
      Promise.all(
        kinds.map((kind: ResourceKind): Promise<Array<string>> => {
          return this.resolveResourceIds({
            ids: kind.ids(refs),
            names: kind.names(refs),
            nameColumn: kind.nameColumn,
            projectId: input.projectId,
            nameMatch: input.nameMatch,
            findBy: kind.findBy,
          });
        }),
      ),
      this.resolveDatabaseServerIdsByEndpoint({
        endpoints: refs.databaseServerEndpoints || [],
        projectId: input.projectId,
      }),
    ]);

    const resolved: SeriesResolvedResourceIds =
      SeriesResourceLinker.emptyResolution();

    kinds.forEach((kind: ResourceKind, index: number): void => {
      resolved[kind.resultKey] = resolvedByKind[index] || [];
    });

    /*
     * A database can be named twice — by its id stamp and by an endpoint it
     * owns — so the two answers are unioned, not concatenated.
     */
    resolved.databaseServerIds = Array.from(
      new Set<string>([
        ...resolved.databaseServerIds,
        ...databaseServerIdsByEndpoint,
      ]),
    );

    return resolved;
  }

  /*
   * Every resource type a series or a monitor's config names, in the order
   * its lookups are sent. Each service's findBy is looked up when this is
   * called, so a stand-in a test puts on it is the one read.
   *
   * Proxmox / VMware / Ceph / Docker Swarm / IoT / storage arrays carry no
   * `oneuptime.*.id` stamp at ingest — they are addressable by name only —
   * so they have no ids, by construction, not by omission. Databases are
   * the reverse: never addressable by name (see DatabaseServerIdLabelKeys),
   * so they have no names — they resolve by the
   * `oneuptime.database.server.id` stamp here, and by an endpoint they own
   * through the DatabaseServerEndpoint table
   * (resolveDatabaseServerIdsByEndpoint: the endpoint lives on a separate
   * table, so it cannot be a kind).
   */
  private static resourceKinds(): Array<ResourceKind> {
    const none: () => Array<string> = (): Array<string> => {
      return [];
    };

    return [
      {
        resultKey: "hostIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.hostIds;
        },
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.hostNames;
        },
        nameColumn: "hostIdentifier",
        findBy: HostService.findBy.bind(HostService),
      },
      {
        resultKey: "dockerHostIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.dockerHostIds;
        },
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.dockerHostNames;
        },
        nameColumn: "hostIdentifier",
        findBy: DockerHostService.findBy.bind(DockerHostService),
      },
      {
        resultKey: "podmanHostIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.podmanHostIds;
        },
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.podmanHostNames;
        },
        nameColumn: "hostIdentifier",
        findBy: PodmanHostService.findBy.bind(PodmanHostService),
      },
      {
        resultKey: "kubernetesClusterIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.kubernetesClusterIds;
        },
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.kubernetesClusterNames;
        },
        nameColumn: "clusterIdentifier",
        findBy: KubernetesClusterService.findBy.bind(KubernetesClusterService),
      },
      {
        resultKey: "serviceIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.serviceIds;
        },
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.serviceNames;
        },
        nameColumn: "name",
        findBy: ServiceService.findBy.bind(ServiceService),
      },
      {
        resultKey: "proxmoxClusterIds",
        ids: none,
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.proxmoxClusterNames;
        },
        nameColumn: "name",
        findBy: ProxmoxClusterService.findBy.bind(ProxmoxClusterService),
      },
      {
        resultKey: "openStackCloudIds",
        ids: none,
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.openStackCloudNames;
        },
        nameColumn: "name",
        findBy: OpenStackCloudService.findBy.bind(OpenStackCloudService),
      },
      {
        resultKey: "vmwareVCenterIds",
        ids: none,
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.vmwareVCenterNames;
        },
        nameColumn: "name",
        findBy: VMwareVCenterService.findBy.bind(VMwareVCenterService),
      },
      {
        resultKey: "cephClusterIds",
        ids: none,
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.cephClusterNames;
        },
        nameColumn: "name",
        findBy: CephClusterService.findBy.bind(CephClusterService),
      },
      {
        resultKey: "dockerSwarmClusterIds",
        ids: none,
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.dockerSwarmClusterNames;
        },
        nameColumn: "name",
        findBy: DockerSwarmClusterService.findBy.bind(
          DockerSwarmClusterService,
        ),
      },
      {
        resultKey: "iotFleetIds",
        ids: none,
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.iotFleetNames;
        },
        nameColumn: "name",
        findBy: IoTFleetService.findBy.bind(IoTFleetService),
      },
      {
        resultKey: "databaseServerIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.databaseServerIds;
        },
        names: none,
        nameColumn: "name",
        findBy: DatabaseServerService.findBy.bind(DatabaseServerService),
      },
      {
        resultKey: "storageArrayIds",
        ids: none,
        names: (refs: SeriesResourceRefs): Array<string> => {
          return refs.storageArrayNames;
        },
        nameColumn: "name",
        findBy: StorageArrayService.findBy.bind(StorageArrayService),
      },
      /*
       * Id-only: a Network Device monitor names its device by the picker's
       * primary key, never by a name.
       */
      {
        resultKey: "networkDeviceIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.networkDeviceIds || [];
        },
        names: none,
        nameColumn: "name",
        findBy: NetworkDeviceService.findBy.bind(NetworkDeviceService),
      },
      /*
       * Id-only: a query's event scope names its cloud resource by its
       * primary key (SeriesResourceRefs.cloudResourceIds).
       */
      {
        resultKey: "cloudResourceIds",
        ids: (refs: SeriesResourceRefs): Array<string> => {
          return refs.cloudResourceIds || [];
        },
        names: none,
        nameColumn: "name",
        findBy: CloudResourceService.findBy.bind(CloudResourceService),
      },
    ];
  }

  /*
   * The databases that own these canonical endpoints in this project.
   *
   * An exact match on DatabaseServerEndpoint.endpoint, which is stored in the
   * same canonical form the refs were built in (formatDatabaseEndpoint) —
   * the (projectId, endpoint) unique index guarantees at most one owner per
   * endpoint, so an endpoint can never link two databases. Project-scoped
   * like every other lookup here; costs zero round-trips when the monitor
   * names no endpoint, which is every monitor that is not about a database.
   */
  private static async resolveDatabaseServerIdsByEndpoint(input: {
    endpoints: Array<string>;
    projectId: ObjectID;
  }): Promise<Array<string>> {
    const endpoints: Array<string> = Array.from(
      new Set<string>(
        input.endpoints.filter((endpoint: string): boolean => {
          return typeof endpoint === "string" && endpoint.length > 0;
        }),
      ),
    );

    if (endpoints.length === 0) {
      return [];
    }

    const rows: Array<DatabaseServerEndpoint> =
      await DatabaseServerEndpointService.findBy({
        query: {
          projectId: input.projectId,
          endpoint: new Includes(endpoints),
        },
        select: { _id: true, databaseServerId: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const databaseServerIds: Set<string> = new Set<string>();

    for (const row of rows) {
      if (row.databaseServerId) {
        databaseServerIds.add(row.databaseServerId.toString());
      }
    }

    return Array.from(databaseServerIds);
  }

  /*
   * Resolve the series' resources and MERGE them onto the alert/incident.
   * Merging (rather than assigning) matters because
   * attachResolvedResources writes the same relations from the
   * monitor's step config; whichever runs second must not erase the
   * other's work.
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
    /*
     * Optional, and only consulted to disambiguate `host.name`. Left
     * undefined by callers that have no monitor in hand.
     */
    monitorType?: MonitorType | undefined;
  }): Promise<void> {
    const resolved: SeriesResolvedResourceIds =
      await this.resolveResourcesFromSeriesLabels({
        seriesLabels: input.seriesLabels,
        projectId: input.projectId,
        monitorType: input.monitorType,
      });

    this.mergeResolvedIdsIntoModel({
      model: input.model,
      resolved: resolved,
    });
  }

  /*
   * Attach the resources resolved from the monitor's own step config
   * (MonitorResourceContext), merging with — never overwriting —
   * anything the series-label path already linked. Both paths can
   * resolve the same resource, so this dedupes by id.
   *
   * Unlike the label path this runs for ungrouped events too, and that
   * is the whole point: an ungrouped monitor has no series labels, so
   * before this existed it linked nothing at all.
   */
  public static attachResolvedResources(input: {
    model: SeriesLinkableModel;
    resolved: SeriesResolvedResourceIds;
  }): void {
    this.mergeResolvedIdsIntoModel({
      model: input.model,
      resolved: input.resolved,
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

    if (resolved.openStackCloudIds.length > 0) {
      model.openStackClouds = this.mergeById(
        model.openStackClouds,
        resolved.openStackCloudIds,
        (): OpenStackCloud => {
          return new OpenStackCloud();
        },
      );
    }

    if (resolved.vmwareVCenterIds.length > 0) {
      model.vmwareVCenters = this.mergeById(
        model.vmwareVCenters,
        resolved.vmwareVCenterIds,
        (): VMwareVCenter => {
          return new VMwareVCenter();
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

    if (resolved.databaseServerIds.length > 0) {
      model.databaseServers = this.mergeById(
        model.databaseServers,
        resolved.databaseServerIds,
        (): DatabaseServer => {
          return new DatabaseServer();
        },
      );
    }

    if (resolved.storageArrayIds.length > 0) {
      model.storageArrays = this.mergeById(
        model.storageArrays,
        resolved.storageArrayIds,
        (): StorageArray => {
          return new StorageArray();
        },
      );
    }

    if (resolved.cloudResourceIds.length > 0) {
      model.cloudResources = this.mergeById(
        model.cloudResources,
        resolved.cloudResourceIds,
        (): CloudResource => {
          return new CloudResource();
        },
      );
    }

    if (resolved.networkDeviceIds.length > 0) {
      model.networkDevices = this.mergeById(
        model.networkDevices,
        resolved.networkDeviceIds,
        (): NetworkDevice => {
          return new NetworkDevice();
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
   * common case for most of the ten types on any given series.
   *
   * `nameMatch: "exact"` is for series labels. Every identifier column
   * read here is written by ingest from the same attribute the series
   * label carries — host identifiers are canonicalized on both sides —
   * so exact matching is what keeps a lookup from straying onto a
   * neighbouring row.
   *
   * `nameMatch: "caseInsensitive"` is for monitor step configs, where
   * the identifier was typed by a user and the row's name was stamped
   * by an agent; the two legitimately differ by case. This mirrors what
   * ingest discovery itself does when it keys a row by name.
   */
  private static async resolveResourceIds(input: {
    ids: Array<string>;
    names: Array<string>;
    nameColumn: string;
    projectId: ObjectID;
    nameMatch: NameMatchMode;
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
            [input.nameColumn]:
              input.nameMatch === "caseInsensitive"
                ? QueryHelper.findWithSameTextAnyOf(input.names)
                : new Includes(input.names),
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

/*
 * THE SERIES RESOURCES OF ONE EVALUATION (issue #10315).
 *
 * Before a create pass, the incident or alert creator hands this every
 * series it will open a record for (resolve), and they are resolved
 * together, one read per resource kind (SeriesResourceLinker
 * .resolveManySeries). Each record is then linked from that answer
 * (linkSeriesResourcesToModel). The answers are kept for the evaluation, so
 * its incidents and its alerts for the same series read them once
 * (MonitorRecordResources hands the same to both creators).
 *
 * A series it has not resolved is linked by its own read, exactly as
 * before: one the pass did not hand it, one whose identifiers are read
 * alone, or every series of a resolve whose read failed - linking is
 * best-effort context, and a failed read must not take every record of the
 * evaluation with it.
 */
export class SeriesResourcesOfEvaluation {
  private readonly projectId: ObjectID | undefined;
  private readonly monitorType: MonitorType | undefined;

  // The series resolved so far, by their labels' object.
  private readonly resolved: Map<JSONObject, SeriesResolvedResourceIds> =
    new Map<JSONObject, SeriesResolvedResourceIds>();

  public constructor(input: {
    projectId: ObjectID | undefined;
    monitorType?: MonitorType | undefined;
  }) {
    this.projectId = input.projectId;
    this.monitorType = input.monitorType;
  }

  // Resolves, together, every series of these not resolved yet.
  public async resolve(seriesLabels: ReadonlyArray<JSONObject>): Promise<void> {
    if (!this.projectId) {
      return;
    }

    const unresolved: Array<JSONObject> = seriesLabels.filter(
      (labels: JSONObject): boolean => {
        return Boolean(labels) && !this.resolved.has(labels);
      },
    );

    if (unresolved.length === 0) {
      return;
    }

    try {
      const resolutions: Map<JSONObject, SeriesResolvedResourceIds> =
        await SeriesResourceLinker.resolveManySeries({
          seriesLabels: unresolved,
          projectId: this.projectId,
          monitorType: this.monitorType,
        });

      for (const [labels, resolved] of resolutions) {
        this.resolved.set(labels, resolved);
      }
    } catch (error) {
      logger.error(
        `Could not read the resources of ${unresolved.length} series together; each is read on its own as its record is created.`,
        { projectId: this.projectId.toString() },
      );
      logger.error(error, { projectId: this.projectId.toString() });
    }
  }

  // Whether a series' resources are known without a read of its own.
  public isResolved(seriesLabels: JSONObject): boolean {
    return this.resolved.has(seriesLabels);
  }

  /*
   * SeriesResourceLinker.linkSeriesResourcesToModel, from the answer of a
   * resolve when the series had one, else from a read of its own.
   */
  public async linkSeriesResourcesToModel(input: {
    model: SeriesLinkableModel;
    seriesLabels: JSONObject;
  }): Promise<void> {
    const resolved: SeriesResolvedResourceIds | undefined = this.resolved.get(
      input.seriesLabels,
    );

    if (resolved) {
      SeriesResourceLinker.attachResolvedResources({
        model: input.model,
        resolved: resolved,
      });
      return;
    }

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: input.model,
      seriesLabels: input.seriesLabels,
      projectId: this.projectId!,
      monitorType: this.monitorType,
    });
  }
}
