import Alert from "../../../Models/DatabaseModels/Alert";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import DataBiConnection from "../../../Models/DatabaseModels/DataBiConnection";
import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ModelAPI from "../ModelAPI/ModelAPI";
import PermissionGate from "../PermissionGate";
import { UNKNOWN_SERVICE_NAME } from "../TelemetryService";

/*
 * Resolve telemetry entity ids to human-readable names.
 *
 * A telemetry row's `primaryEntityId` is polymorphic: `primaryEntityType`
 * (ServiceType) says which Postgres table it points at. Most rows carry a
 * Service id, but a RUM application's telemetry carries the RumApplication
 * id, agent-ingested host telemetry the Host id, and so on (see
 * OtelIngestBaseService.resolveTelemetryResource for the ingest side).
 *
 * Every viewer used to resolve that id against the Service table only, so
 * a scope chip on a RUM application page read "Service: 84858d6c-…". This
 * module is the one place that knows every table an id can live in, what
 * the entity is called, and how to label its type — so chips, table
 * columns and legends can show "RUM Application: checkout-web" instead.
 *
 * Filtering still uses the stable id. This is display only.
 */

export interface ResolvedTelemetryEntity {
  id: string;
  name: string;
  entityType: ServiceType;
  // Human label for the entity's type, e.g. "RUM Application".
  typeLabel: string;
  // The record is archived: a chip naming it says so (#11213).
  isArchived?: boolean | undefined;
}

export type TelemetryEntityNameMap = Record<string, ResolvedTelemetryEntity>;

interface TelemetryEntityTypeConfig {
  label: string;
  // Table the id lives in. Unknown has no table: its id is the projectId.
  modelType?: { new (): BaseModel } | undefined;
  // Columns tried in order for the display name.
  nameFields: Array<string>;
}

export const TELEMETRY_ENTITY_TYPES: Record<
  ServiceType,
  TelemetryEntityTypeConfig
> = {
  [ServiceType.OpenTelemetry]: {
    label: "Service",
    modelType: Service,
    nameFields: ["name"],
  },
  [ServiceType.RealUserMonitor]: {
    label: "RUM Application",
    modelType: RumApplication,
    nameFields: ["name", "appIdentifier"],
  },
  [ServiceType.Host]: {
    label: "Host",
    modelType: Host,
    nameFields: ["name", "hostIdentifier"],
  },
  [ServiceType.DockerHost]: {
    label: "Docker Host",
    modelType: DockerHost,
    nameFields: ["name", "hostIdentifier"],
  },
  [ServiceType.PodmanHost]: {
    label: "Podman Host",
    modelType: PodmanHost,
    nameFields: ["name", "hostIdentifier"],
  },
  [ServiceType.KubernetesCluster]: {
    label: "Kubernetes Cluster",
    modelType: KubernetesCluster,
    nameFields: ["name", "clusterIdentifier"],
  },
  [ServiceType.ProxmoxCluster]: {
    label: "Proxmox Cluster",
    modelType: ProxmoxCluster,
    nameFields: ["name"],
  },
  [ServiceType.OpenStackCloud]: {
    label: "OpenStack Cloud",
    modelType: OpenStackCloud,
    nameFields: ["name"],
  },
  [ServiceType.CephCluster]: {
    label: "Ceph Cluster",
    modelType: CephCluster,
    nameFields: ["name"],
  },
  [ServiceType.StorageArray]: {
    label: "Storage Array",
    modelType: StorageArray,
    nameFields: ["name"],
  },
  [ServiceType.DockerSwarmCluster]: {
    label: "Docker Swarm Cluster",
    modelType: DockerSwarmCluster,
    nameFields: ["name"],
  },
  [ServiceType.VMwareVCenter]: {
    label: "vCenter",
    modelType: VMwareVCenter,
    nameFields: ["name"],
  },
  [ServiceType.XcpNgPool]: {
    label: "XCP-ng Pool",
    modelType: XcpNgPool,
    nameFields: ["name"],
  },
  /*
   * ServiceType.IoTDevice rows carry the IoT *fleet* id, not a device id
   * (OtelIngestBaseService stamps data.iotFleetId), so resolve the fleet.
   */
  [ServiceType.IoTDevice]: {
    label: "IoT Fleet",
    modelType: IoTFleet,
    nameFields: ["name"],
  },
  [ServiceType.ServerlessFunction]: {
    label: "Serverless Function",
    modelType: ServerlessFunction,
    nameFields: ["name", "functionIdentifier"],
  },
  [ServiceType.CloudResource]: {
    label: "Cloud Resource",
    modelType: CloudResource,
    nameFields: ["name", "resourceIdentifier"],
  },
  [ServiceType.DatabaseServer]: {
    label: "Database",
    modelType: DatabaseServer,
    nameFields: ["name"],
  },
  // Data Observability's table health rows: the data store whose tables they describe.
  [ServiceType.DataStore]: {
    label: "Data Store",
    modelType: DataStore,
    nameFields: ["name"],
  },
  // Data Observability's pipeline run rows: the pipeline whose runs they describe.
  [ServiceType.DataPipeline]: {
    label: "Data Pipeline",
    modelType: DataPipeline,
    nameFields: ["jobName"],
  },
  // Data Observability's data product rows: the product whose freshness they describe.
  [ServiceType.DataProduct]: {
    label: "Data Product",
    modelType: DataProduct,
    nameFields: ["name"],
  },
  // Data Observability's reconciliation rows: the reconciliation whose comparisons they describe.
  [ServiceType.DataReconciliation]: {
    label: "Data Reconciliation",
    modelType: DataReconciliation,
    nameFields: ["name"],
  },
  // Data Observability's BI tool rows: the Power BI tool whose datasets' refreshes they describe.
  [ServiceType.DataBiConnection]: {
    label: "BI Tool",
    modelType: DataBiConnection,
    nameFields: ["name"],
  },
  // A device management connection's readings: the connection whose devices' check-ins they are.
  [ServiceType.DeviceManagementConnection]: {
    label: "Device Management Connection",
    modelType: DeviceManagementConnection,
    nameFields: ["name"],
  },
  [ServiceType.NetworkDevice]: {
    label: "Network Device",
    modelType: NetworkDevice,
    nameFields: ["name", "hostname"],
  },
  [ServiceType.Monitor]: {
    label: "Monitor",
    modelType: Monitor,
    nameFields: ["name"],
  },
  [ServiceType.Incident]: {
    label: "Incident",
    modelType: Incident,
    nameFields: ["title"],
  },
  [ServiceType.Alert]: {
    label: "Alert",
    modelType: Alert,
    nameFields: ["title"],
  },
  [ServiceType.ScheduledMaintenance]: {
    label: "Scheduled Maintenance",
    modelType: ScheduledMaintenance,
    nameFields: ["title"],
  },
  // The oneuptime.slo.* series carry the SLO id (SloMetricUtil).
  [ServiceType.ServiceLevelObjective]: {
    label: "SLO",
    modelType: ServiceLevelObjective,
    nameFields: ["name"],
  },
  // Unattributed telemetry: the id is the projectId and there is no row.
  [ServiceType.Unknown]: {
    label: "Service",
    modelType: undefined,
    nameFields: [],
  },
};

/*
 * Order ids of unknown type are tried in. Service first — it is by far the
 * most common primary entity, so most lookups finish in one request — then
 * every other table in parallel for whatever is still unresolved.
 */
export const TELEMETRY_ENTITY_RESOLUTION_ORDER: Array<ServiceType> = [
  ServiceType.OpenTelemetry,
  ServiceType.RealUserMonitor,
  ServiceType.Host,
  ServiceType.DockerHost,
  ServiceType.PodmanHost,
  ServiceType.KubernetesCluster,
  ServiceType.ServerlessFunction,
  ServiceType.CloudResource,
  ServiceType.DatabaseServer,
  ServiceType.DataStore,
  ServiceType.DataPipeline,
  ServiceType.DataProduct,
  ServiceType.DataReconciliation,
  ServiceType.DataBiConnection,
  ServiceType.DeviceManagementConnection,
  ServiceType.IoTDevice,
  ServiceType.ProxmoxCluster,
  ServiceType.OpenStackCloud,
  ServiceType.CephCluster,
  ServiceType.StorageArray,
  ServiceType.DockerSwarmCluster,
  ServiceType.VMwareVCenter,
  ServiceType.XcpNgPool,
  ServiceType.NetworkDevice,
  ServiceType.Monitor,
  ServiceType.Incident,
  ServiceType.Alert,
  ServiceType.ScheduledMaintenance,
  ServiceType.ServiceLevelObjective,
];

// Chip key used for a primaryEntityId chip whose entity is not resolved yet.
export const DEFAULT_TELEMETRY_ENTITY_LABEL: string = "Service";

const isServiceType: (value: string) => value is ServiceType = (
  value: string,
): value is ServiceType => {
  return Object.prototype.hasOwnProperty.call(TELEMETRY_ENTITY_TYPES, value);
};

export const getTelemetryEntityTypeLabel: (
  entityType: ServiceType | string | null | undefined,
) => string = (entityType: ServiceType | string | null | undefined): string => {
  if (!entityType) {
    return DEFAULT_TELEMETRY_ENTITY_LABEL;
  }
  const key: string = entityType.toString();
  if (!isServiceType(key)) {
    return DEFAULT_TELEMETRY_ENTITY_LABEL;
  }
  return TELEMETRY_ENTITY_TYPES[key].label;
};

/*
 * Display for a chip / label that names a telemetry entity by id. `key` is
 * the entity's type label once resolved ("RUM Application"), else the
 * caller's fallback (the facet title, normally "Service"). `value` is the
 * entity name once resolved, else the fallback display value, else the id.
 */
export const getTelemetryEntityDisplay: (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
  fallbackKey?: string | undefined;
  fallbackValue?: string | undefined;
}) => { key: string; value: string } = (data: {
  id: string;
  nameMap: TelemetryEntityNameMap | undefined;
  fallbackKey?: string | undefined;
  fallbackValue?: string | undefined;
}): { key: string; value: string } => {
  const resolved: ResolvedTelemetryEntity | undefined = data.nameMap?.[data.id];
  const fallbackKey: string =
    data.fallbackKey || DEFAULT_TELEMETRY_ENTITY_LABEL;
  if (!resolved) {
    return {
      key: fallbackKey,
      value: data.fallbackValue || data.id,
    };
  }
  return {
    key: resolved.typeLabel || fallbackKey,
    value: resolved.name,
  };
};

/*
 * A CHIP THAT NAMES AN ENTITY GONE, OR ARCHIVED (#11213).
 *
 * A chip a link or a saved view brought holds an id, and once the record
 * behind it is deleted - or out of the reader's reach - nothing names it,
 * so the chip read as the raw id. What the chip is drawn as, beside its
 * name: NotFound once every table it was looked up in has answered without
 * it (TelemetryEntityLookupResult.notFound) and nothing else named it, so
 * the chip reads "No longer available" (getActiveFilterValueText); never
 * while a read is in flight, never after one failed. Archived when the
 * record it names is: "{{name}} (archived)". The chip keeps its id, so it
 * still filters as saved, and is taken out like any other.
 */
export interface TelemetryEntityChipMarks {
  isNotFound?: true | undefined;
  isArchived?: true | undefined;
}

export const getTelemetryEntityChipMarks: (data: {
  id: string;
  // A name for it from somewhere else: a loaded service, a facet's server name.
  knownName?: string | undefined;
  // Whether that somewhere else says it is archived.
  isKnownArchived?: boolean | undefined;
  names?: TelemetryEntityNameMap | undefined;
  // The ids the lookup settled as naming nothing.
  notFound?: ReadonlySet<string> | undefined;
}) => TelemetryEntityChipMarks = (data: {
  id: string;
  knownName?: string | undefined;
  isKnownArchived?: boolean | undefined;
  names?: TelemetryEntityNameMap | undefined;
  notFound?: ReadonlySet<string> | undefined;
}): TelemetryEntityChipMarks => {
  const id: string = (data.id || "").trim();

  if ((data.knownName || "").trim()) {
    return data.isKnownArchived ? { isArchived: true } : {};
  }

  const resolved: ResolvedTelemetryEntity | undefined = data.names?.[id];

  if (resolved) {
    return resolved.isArchived ? { isArchived: true } : {};
  }

  return id && data.notFound?.has(id) ? { isNotFound: true } : {};
};

/*
 * A chip with its marks set as `marks` says, and none it no longer has:
 * a chip named since it was marked gone is gone no more.
 */
export const withTelemetryEntityChipMarks: <
  T extends {
    isNotFound?: boolean | undefined;
    isArchived?: boolean | undefined;
  },
>(
  chip: T,
  marks: TelemetryEntityChipMarks,
) => T = <
  T extends {
    isNotFound?: boolean | undefined;
    isArchived?: boolean | undefined;
  },
>(
  chip: T,
  marks: TelemetryEntityChipMarks,
): T => {
  // Nothing to say, and nothing said before: the chip as it came.
  if (
    !marks.isNotFound &&
    !marks.isArchived &&
    chip.isNotFound === undefined &&
    chip.isArchived === undefined
  ) {
    return chip;
  }

  const marked: T = { ...chip };

  delete marked.isNotFound;
  delete marked.isArchived;

  if (marks.isNotFound) {
    marked.isNotFound = true;
  }

  if (marks.isArchived) {
    marked.isArchived = true;
  }

  return marked;
};

const readNameFromModel: (
  model: BaseModel,
  nameFields: Array<string>,
) => string | undefined = (
  model: BaseModel,
  nameFields: Array<string>,
): string | undefined => {
  const record: JSONObject = model as unknown as JSONObject;
  for (const field of nameFields) {
    const value: unknown = record[field];
    const text: string =
      value === undefined || value === null ? "" : `${value}`;
    if (text.trim()) {
      return text.trim();
    }
  }
  return undefined;
};

const ARCHIVED_COLUMN: string = "isArchived";

/*
 * Whether a table's records are read with their archive switch: when they
 * can be archived, and the reader may read it. The server refuses a whole
 * read that selects a column its reader may not read, and then not one of
 * the table's records would be named (as the scope picker's reads,
 * TelemetryResourceScope, #10921).
 */
const readsArchiveSwitch: (modelType: {
  new (): BaseModel;
}) => boolean = (modelType: { new (): BaseModel }): boolean => {
  const model: BaseModel = new modelType();

  return (
    Boolean(model.getTableColumnMetadata(ARCHIVED_COLUMN)) &&
    PermissionGate.canReadColumn(model, ARCHIVED_COLUMN)
  );
};

const CACHE_TTL_IN_MS: number = 60 * 1000;
export const MISS_CACHE_TTL_IN_MS: number = 20 * 1000;

interface CacheEntry {
  entity: ResolvedTelemetryEntity;
  expiresAt: number;
}

/*
 * An id looked up and not found: until when the miss is kept, and whether
 * every table it was looked up in answered (settled) - one whose table
 * failed (a role that may not read hosts) may still be in that table, so
 * it is never said to be gone.
 */
interface MissEntry {
  expiresAt: number;
  isSettled: boolean;
}

// What a lookup found: the names, and the ids that name nothing it may read.
export interface TelemetryEntityLookupResult {
  names: TelemetryEntityNameMap;
  /*
   * The ids every table they were looked up in answered without - deleted,
   * or out of the reader's reach (#11213). An id a failed read left
   * unanswered is in neither list.
   */
  notFound: Array<string>;
}

/*
 * One table's answer: the entities it named, the ids of every row it held
 * (one with no name is there all the same), and whether it failed.
 */
interface TableAnswer {
  entities: Array<ResolvedTelemetryEntity>;
  presentIds: Array<string>;
  isFailed: boolean;
}

export default class TelemetryEntityNameResolver {
  /*
   * Hits, keyed by project + id. Ids are globally unique UUIDs, so a hit is
   * valid whichever types the next caller asks about (it is still filtered
   * by the requested types). An expired hit is kept around so its refresh
   * can go straight to the table it was found in.
   */
  private static cache: Record<string, CacheEntry> = {};
  /*
   * Misses, keyed by project + id + the tables that were searched, with a
   * short TTL. Without it, an id that resolves nowhere (a deleted service
   * still in retention, a table the role cannot read) would be searched
   * across every table again each time a live view's id set changes. The
   * TTL is short so a resource created a moment ago still shows up soon.
   */
  private static missCache: Record<string, MissEntry> = {};
  private static inFlight: Record<
    string,
    Promise<TelemetryEntityLookupResult>
  > = {};

  public static clearCache(): void {
    TelemetryEntityNameResolver.cache = {};
    TelemetryEntityNameResolver.missCache = {};
    TelemetryEntityNameResolver.inFlight = {};
  }

  /*
   * Resolve `ids` to names.
   *
   * - `typeHints` (id -> ServiceType) sends an id straight to its table,
   *   e.g. a RUM page knows its scope id is a RumApplication. A hinted id
   *   that does not resolve there falls through to the general pass.
   * - `entityTypes` restricts which tables are consulted at all. Pass
   *   [ServiceType.OpenTelemetry] when only real service names are wanted.
   * - An id equal to the projectId is the "Unknown Service" bucket.
   *
   * Each table is queried independently and a failure (e.g. the user's
   * role cannot read Hosts) only leaves that table's ids unresolved.
   */
  public static async resolve(data: {
    ids: Array<ObjectID | string | null | undefined>;
    projectId: ObjectID | string | null | undefined;
    typeHints?: Record<string, ServiceType | undefined> | undefined;
    entityTypes?: Array<ServiceType> | undefined;
  }): Promise<TelemetryEntityNameMap> {
    return (await TelemetryEntityNameResolver.lookup(data)).names;
  }

  /*
   * resolve(), and the ids it settled as naming nothing (#11213): every
   * table each was looked up in answered, and none named it.
   */
  public static async lookup(data: {
    ids: Array<ObjectID | string | null | undefined>;
    projectId: ObjectID | string | null | undefined;
    typeHints?: Record<string, ServiceType | undefined> | undefined;
    entityTypes?: Array<ServiceType> | undefined;
  }): Promise<TelemetryEntityLookupResult> {
    const projectId: string = data.projectId ? data.projectId.toString() : "";
    if (!projectId) {
      return { names: {}, notFound: [] };
    }

    const uniqueIds: Array<string> = Array.from(
      new Set(
        data.ids
          .map((id: ObjectID | string | null | undefined): string => {
            return id ? id.toString().trim() : "";
          })
          .filter((id: string): boolean => {
            /*
             * Only UUIDs can name a row. Postgres rejects a malformed value
             * in `_id IN (...)`, which would fail the whole batch and leave
             * every valid id beside it unresolved.
             */
            return (
              id.length > 0 && (id === projectId || ObjectID.isValidUUID(id))
            );
          }),
      ),
    ).sort();

    if (uniqueIds.length === 0) {
      return { names: {}, notFound: [] };
    }

    const allowedTypes: Array<ServiceType> = (
      data.entityTypes && data.entityTypes.length > 0
        ? TELEMETRY_ENTITY_RESOLUTION_ORDER.filter((type: ServiceType) => {
            return data.entityTypes!.includes(type);
          })
        : TELEMETRY_ENTITY_RESOLUTION_ORDER
    ).slice();

    const allowUnknown: boolean =
      !data.entityTypes ||
      data.entityTypes.length === 0 ||
      data.entityTypes.includes(ServiceType.Unknown) ||
      data.entityTypes.includes(ServiceType.OpenTelemetry);

    const hints: Record<string, ServiceType> = {};
    for (const id of uniqueIds) {
      const hint: ServiceType | undefined = data.typeHints?.[id];
      if (hint && allowedTypes.includes(hint)) {
        hints[id] = hint;
      }
    }

    const requestKey: string = JSON.stringify({
      projectId,
      ids: uniqueIds,
      types: allowedTypes,
      allowUnknown,
      hints,
    });

    const pending: Promise<TelemetryEntityLookupResult> | undefined =
      TelemetryEntityNameResolver.inFlight[requestKey];
    if (pending) {
      return pending;
    }

    const promise: Promise<TelemetryEntityLookupResult> =
      TelemetryEntityNameResolver.resolveUncached({
        projectId,
        ids: uniqueIds,
        allowedTypes,
        allowUnknown,
        hints,
      }).finally(() => {
        /*
         * Only clear our own entry: a clearCache() while this was pending
         * may have let a newer identical request take the slot.
         */
        if (TelemetryEntityNameResolver.inFlight[requestKey] === promise) {
          delete TelemetryEntityNameResolver.inFlight[requestKey];
        }
      });

    TelemetryEntityNameResolver.inFlight[requestKey] = promise;
    return promise;
  }

  private static async resolveUncached(data: {
    projectId: string;
    ids: Array<string>;
    allowedTypes: Array<ServiceType>;
    allowUnknown: boolean;
    hints: Record<string, ServiceType>;
  }): Promise<TelemetryEntityLookupResult> {
    const result: TelemetryEntityNameMap = {};
    const now: number = Date.now();
    let unresolved: Array<string> = [];
    // Local copy: expired hits add implicit hints below.
    const hints: Record<string, ServiceType> = { ...data.hints };
    const missKeyFor: (id: string) => string = (id: string): string => {
      return `${data.projectId}:${id}:${data.allowedTypes.join("|")}`;
    };
    // Ids a recent lookup settled as naming nothing: gone, still.
    const knownMissing: Array<string> = [];
    // Ids a table that failed to answer was asked about.
    const unanswered: Set<string> = new Set<string>();

    for (const id of data.ids) {
      if (data.allowUnknown && id === data.projectId) {
        result[id] = {
          id,
          name: UNKNOWN_SERVICE_NAME,
          entityType: ServiceType.Unknown,
          typeLabel: TELEMETRY_ENTITY_TYPES[ServiceType.Unknown].label,
        };
        continue;
      }

      const cached: CacheEntry | undefined =
        TelemetryEntityNameResolver.cache[`${data.projectId}:${id}`];
      if (cached && data.allowedTypes.includes(cached.entity.entityType)) {
        if (cached.expiresAt > now) {
          result[id] = cached.entity;
          continue;
        }
        /*
         * Expired: refresh it from the table it was found in (one request)
         * rather than probing Services and then every other table.
         */
        if (!hints[id]) {
          hints[id] = cached.entity.entityType;
        }
      }

      const miss: MissEntry | undefined =
        TelemetryEntityNameResolver.missCache[missKeyFor(id)];
      if (miss !== undefined && miss.expiresAt > now) {
        if (miss.isSettled) {
          knownMissing.push(id);
        }
        continue;
      }

      unresolved.push(id);
    }

    // Ids a table answered with a row that has no name: there, unnamed.
    const present: Set<string> = new Set<string>();

    const queryType: (
      entityType: ServiceType,
      ids: Array<string>,
    ) => Promise<Array<ResolvedTelemetryEntity>> = async (
      entityType: ServiceType,
      ids: Array<string>,
    ): Promise<Array<ResolvedTelemetryEntity>> => {
      const answer: TableAnswer = await TelemetryEntityNameResolver.queryType({
        entityType,
        ids,
        projectId: data.projectId,
      });

      if (answer.isFailed) {
        for (const id of ids) {
          unanswered.add(id);
        }
      }

      for (const id of answer.presentIds) {
        present.add(id);
      }

      return answer.entities;
    };

    // What the lookup settled: every id asked that no table named or failed on.
    const settle: () => TelemetryEntityLookupResult =
      (): TelemetryEntityLookupResult => {
        const expiresAt: number = Date.now() + MISS_CACHE_TTL_IN_MS;
        const notFound: Array<string> = [...knownMissing];
        // A lookup that asked no table settles nothing.
        const asksATable: boolean = data.allowedTypes.length > 0;

        for (const id of unresolved) {
          const isSettled: boolean =
            asksATable && !unanswered.has(id) && !present.has(id);

          TelemetryEntityNameResolver.missCache[missKeyFor(id)] = {
            expiresAt,
            isSettled,
          };

          if (isSettled) {
            notFound.push(id);
          }
        }

        return { names: result, notFound: notFound.sort() };
      };

    const absorb: (entities: Array<ResolvedTelemetryEntity>) => void = (
      entities: Array<ResolvedTelemetryEntity>,
    ): void => {
      for (const entity of entities) {
        result[entity.id] = entity;
        TelemetryEntityNameResolver.cache[`${data.projectId}:${entity.id}`] = {
          entity,
          expiresAt: Date.now() + CACHE_TTL_IN_MS,
        };
        delete TelemetryEntityNameResolver.missCache[missKeyFor(entity.id)];
      }
      unresolved = unresolved.filter((id: string): boolean => {
        return !result[id];
      });
    };

    // 1. Hinted ids go straight to their own table.
    const hintedByType: Map<ServiceType, Array<string>> = new Map();
    for (const id of unresolved) {
      const hint: ServiceType | undefined = hints[id];
      if (!hint) {
        continue;
      }
      hintedByType.set(hint, [...(hintedByType.get(hint) || []), id]);
    }
    if (hintedByType.size > 0) {
      const hinted: Array<Array<ResolvedTelemetryEntity>> = await Promise.all(
        Array.from(hintedByType.entries()).map(
          ([entityType, ids]: [ServiceType, Array<string>]) => {
            return queryType(entityType, ids);
          },
        ),
      );
      absorb(hinted.flat());
    }

    if (unresolved.length === 0) {
      return settle();
    }

    if (data.allowedTypes.length === 0) {
      return settle();
    }

    /*
     * A hinted id that missed has already been looked up in its hinted
     * table; don't ask that table about it again.
     */
    const idsNotHintedTo: (entityType: ServiceType) => Array<string> = (
      entityType: ServiceType,
    ): Array<string> => {
      return unresolved.filter((id: string): boolean => {
        return hints[id] !== entityType;
      });
    };

    // 2. Service first — the common case resolves in a single request.
    const [firstType, ...otherTypes] = data.allowedTypes;
    if (firstType) {
      absorb(await queryType(firstType, idsNotHintedTo(firstType)));
    }

    if (unresolved.length === 0) {
      return settle();
    }

    if (otherTypes.length === 0) {
      return settle();
    }

    // 3. Everything else in parallel for what is still unresolved.
    const rest: Array<Array<ResolvedTelemetryEntity>> = await Promise.all(
      otherTypes.map((entityType: ServiceType) => {
        return queryType(entityType, idsNotHintedTo(entityType));
      }),
    );
    absorb(rest.flat());

    return settle();
  }

  private static async queryType(data: {
    entityType: ServiceType;
    ids: Array<string>;
    projectId: string;
  }): Promise<TableAnswer> {
    const config: TelemetryEntityTypeConfig =
      TELEMETRY_ENTITY_TYPES[data.entityType];
    if (!config.modelType || data.ids.length === 0) {
      return { entities: [], presentIds: [], isFailed: false };
    }

    const select: Record<string, true> = { _id: true };
    for (const field of config.nameFields) {
      select[field] = true;
    }

    // An archived record's chip says so (#11213), to a reader who may know.
    const readsArchived: boolean = readsArchiveSwitch(config.modelType);

    if (readsArchived) {
      select[ARCHIVED_COLUMN] = true;
    }

    try {
      const list: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
        modelType: config.modelType,
        query: {
          projectId: new ObjectID(data.projectId),
          _id: new Includes(data.ids),
        } as Query<BaseModel>,
        limit: data.ids.length,
        skip: 0,
        select: select as Select<BaseModel>,
        sort: {},
      });

      const requested: Set<string> = new Set(data.ids);
      const entities: Array<ResolvedTelemetryEntity> = [];
      const presentIds: Array<string> = [];
      for (const model of list.data || []) {
        const id: string | undefined = model.id?.toString();
        if (!id || !requested.has(id)) {
          continue;
        }
        presentIds.push(id);
        const name: string | undefined = readNameFromModel(
          model,
          config.nameFields,
        );
        if (!name) {
          continue;
        }
        entities.push({
          id,
          name,
          entityType: data.entityType,
          typeLabel: config.label,
          ...(readsArchived &&
          (model as unknown as Record<string, unknown>)[ARCHIVED_COLUMN] ===
            true
            ? { isArchived: true }
            : {}),
        });
      }
      return { entities, presentIds, isFailed: false };
    } catch {
      // Non-critical: e.g. no read permission on this table.
      return { entities: [], presentIds: [], isFailed: true };
    }
  }
}
