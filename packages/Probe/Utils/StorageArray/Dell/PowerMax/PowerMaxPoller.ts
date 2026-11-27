import {
  ClassifiedStorageArrayError,
  StorageArrayCollectionError,
  classifyStorageArrayError,
} from "../../StorageArrayCollectionErrors";
import StorageArrayOtlpResource from "../../StorageArrayOtlp";
import { StorageArrayPoller } from "../../StorageArrayPoller";
import {
  DEFAULT_STORAGE_ARRAY_POLLER_DEPENDENCIES,
  StorageArrayPollerDependencies,
  StorageArrayTransportHandle,
} from "../../StorageArrayTransport";
import PowerMaxOtlpBuilder from "./PowerMaxOtlpBuilder";
import {
  PowerMaxAlert,
  PowerMaxArrayReading,
  PowerMaxDirector,
  PowerMaxPort,
  PowerMaxSrdfGroup,
  PowerMaxSrp,
  PowerMaxStorageGroup,
  PowerMaxVolume,
  deriveSrdfGroupsFromStorageGroups,
  getSrdfGroupPortIds,
  getSrdfStatesByGroup,
  readAlert,
  readCapacity,
  readDirector,
  readHealthScores,
  readPort,
  readRegistration,
  readSrdfGroup,
  readSrp,
  readStorageGroup,
  readVolume,
} from "./PowerMaxReading";
import UnisphereClient, {
  UnispherePage,
  UnispherePerformanceInstance,
  UnisphereHttpError,
  UnisphereNotRestApiError,
  UnisphereTimedPoint,
  UnisphereVersion,
  readApiVersionNumber,
  toText,
} from "./UnisphereClient";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import StorageArrayCollectionErrorCode from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import {
  STORAGE_ARRAY_COLLECTION_MAX_PAYLOAD_BYTES,
  StorageArrayCollectionArraySummary,
  StorageArrayCollectionJob,
  StorageArrayCollectionReport,
  StorageArrayCollectionSummary,
  StorageArrayConnectionTestJob,
  StorageArrayConnectionTestReport,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import POWERMAX_PROBE_COLLECTOR from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxProbeCollector";
import {
  POWERMAX_ENDPOINTS,
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_METRIC_PREFIX,
  POWERMAX_PERFORMANCE_CATEGORIES,
  PowerMaxKind,
} from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayConnectionAddress, {
  StorageArrayAddress,
  StorageArrayAddressResult,
} from "Common/Utils/StorageArray/StorageArrayConnectionAddress";

/*
 * DELL POWERMAX FROM UNISPHERE FOR POWERMAX (#11004): the probe's poller.
 *
 * A test logs in, checks Unisphere is 10.1 or later, and says what the
 * account can see on each array - its storage groups and volumes, and
 * whether Unisphere collects its performance - so "Test connection" names
 * what is wrong in each case: unreachable, the certificate, a wrong user or
 * password, a role missing, performance collection off.
 *
 * A collection reads every array Unisphere manages itself (its local
 * arrays: the remote ones it sees through SRDF are their own Unisphere's),
 * every five minutes, and writes each as one OTLP resource of the
 * platform's series (PowerMaxOtlpBuilder). One part failing - a role
 * missing for performance, an endpoint an older Unisphere lacks - leaves
 * that part out with a warning; only what stops every array (the server
 * unreachable, the login refused) fails the collection.
 */

// Unisphere 10.1 added the bulk endpoints a collection reads.
export const MIN_UNISPHERE_API_VERSION: number = 101;
// Unisphere 10.3 added directors, ports and SRDF groups to them, and paging.
export const UNISPHERE_API_VERSION_WITH_HARDWARE: number = 103;

// What one collection reads at most of one array, to stay a good guest.
export const MAX_STORAGE_GROUPS_PER_ARRAY: number = 5000;
export const MAX_VOLUMES_PER_ARRAY: number = 10000;
export const MAX_NEW_ALERT_DETAILS_PER_ARRAY: number = 200;
export const MAX_REALTIME_STORAGE_GROUPS: number = 100;
export const ENHANCED_PAGE_SIZE: number = 1000;

export const MAX_COLLECTION_TIME_IN_MS: number = 8 * 60_000;
export const TEST_TIME_IN_MS: number = 90_000;

const ALERT_SEVERITIES: ReadonlyArray<string> = [
  "FATAL",
  "CRITICAL",
  "WARNING",
  "MINOR",
];

const PERFORMANCE_CATEGORIES: ReadonlyArray<string> = Object.values(
  POWERMAX_PERFORMANCE_CATEGORIES,
);

const SG_SELECT: Array<string> = [
  "id",
  "type",
  "srp",
  "service_level",
  "num_of_volumes",
  "cap_gb",
  "effective_used_capacity_gb",
  "data_reduction_ratio_to_one",
  "num_of_rdf_infos",
];
const SG_MINIMAL_SELECT: Array<string> = ["id", "num_of_volumes", "cap_gb"];
const SG_RDF_SELECT: Array<string> = [
  "id",
  "rdf_infos.states",
  "rdf_infos.modes",
  "rdf_infos.local_rdf_group",
];
const VOLUME_SELECT: Array<string> = [
  "id",
  "identifier",
  "type",
  "status",
  "emulation",
  "cap_gb",
  "effective_used_capacity_gb",
  "storage_groups",
];
const VOLUME_MINIMAL_SELECT: Array<string> = ["id", "cap_gb"];
// Volumes hosts can see: in a storage group (gatekeepers and spares are not).
const VOLUME_FILTER: Array<string> = ["num_of_storage_groups gt 0"];
const DIRECTOR_SELECT: Array<string> = [
  "id",
  "type",
  "status",
  "director_number",
  "engine_number",
  "slot_number",
];
const PORT_SELECT: Array<string> = [
  "id",
  "port_number",
  "director",
  "type",
  "protocol",
  "port_status",
  "max_speed",
  "negotiated_speed",
  "rx_power_level_mw",
  "tx_power_level_mw",
  "iscsi_endpoint",
  "nvmetcp_endpoint",
  "num_of_port_groups",
  "num_of_masking_views",
];
const SRDF_SELECT: Array<string> = [
  "id",
  "label",
  "type",
  "modes",
  "offline",
  "async",
  "metro",
  "cap_gb",
  "num_of_volumes",
  "remote_rdf_group",
  "witness_degraded",
  "rdfa_properties",
  "ports",
];
/*
 * What a collection asks of a real-time storage group: those of these the
 * array's StorageGroups category has (listRealtimeMetrics), since a query
 * naming one it lacks is refused whole. The reads and writes weigh the
 * read and write response times into one where the category has no
 * ResponseTime of its own.
 */
export const REALTIME_STORAGE_GROUP_METRICS: ReadonlyArray<string> = [
  "HostIOs",
  "HostMBs",
  "ResponseTime",
  "ReadResponseTime",
  "WriteResponseTime",
  "HostReads",
  "HostWrites",
];
// The ones every array's real-time categories have, when it cannot be asked.
export const REALTIME_STORAGE_GROUP_FALLBACK_METRICS: ReadonlyArray<string> = [
  "HostIOs",
  "HostMBs",
  "ReadResponseTime",
  "WriteResponseTime",
];
export const REALTIME_STORAGE_GROUP_CATEGORY: string = "StorageGroups";
/*
 * Volume metrics, as /performance/Volume/metrics names them (Dell's
 * OpenAPI enumerates them: IoRate, not HostIOs, is a volume's IOPS).
 */
export const VOLUME_METRICS: ReadonlyArray<string> = [
  "IoRate",
  "HostMBs",
  "ResponseTime",
  "ReadResponseTime",
  "WriteResponseTime",
];

/*
 * Alert details never change but their state; a probe keeps the ones it
 * read, so each collection reads only the alerts raised since. Bounded,
 * oldest out first; keyed by the server, since an alert id is Unisphere's.
 */
const MAX_CACHED_ALERTS: number = 5000;
const alertCache: Map<string, JSONObject> = new Map();

function cacheAlert(key: string, alert: JSONObject): void {
  if (alertCache.has(key)) {
    alertCache.delete(key);
  }
  alertCache.set(key, alert);
  while (alertCache.size > MAX_CACHED_ALERTS) {
    const oldest: string | undefined = alertCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    alertCache.delete(oldest);
  }
}

// Exported for tests.
export function clearPowerMaxAlertCache(): void {
  alertCache.clear();
}

function isHttpStatus(error: unknown, ...statuses: Array<number>): boolean {
  return error instanceof UnisphereHttpError && statuses.includes(error.status);
}

function describe(error: unknown): string {
  if (error instanceof UnisphereHttpError) {
    return error.serverMessage || `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

interface PollContext {
  client: UnisphereClient;
  address: StorageArrayAddress;
  username: string;
  version: UnisphereVersion;
  apiVersion: number;
  dependencies: StorageArrayPollerDependencies;
}

export class PowerMaxPoller implements StorageArrayPoller {
  public readonly storageSystem: string =
    POWERMAX_PROBE_COLLECTOR.storageSystem;

  private readonly dependencies: StorageArrayPollerDependencies;
  private readonly collectionTimeoutInMs: number;
  private readonly testTimeoutInMs: number;
  private readonly maxPayloadBytes: number;

  public constructor(options?: {
    dependencies?: Partial<StorageArrayPollerDependencies> | undefined;
    collectionTimeoutInMs?: number | undefined;
    testTimeoutInMs?: number | undefined;
    maxPayloadBytes?: number | undefined;
  }) {
    this.dependencies = {
      ...DEFAULT_STORAGE_ARRAY_POLLER_DEPENDENCIES,
      ...(options?.dependencies || {}),
    };
    this.collectionTimeoutInMs =
      options?.collectionTimeoutInMs ?? MAX_COLLECTION_TIME_IN_MS;
    this.testTimeoutInMs = options?.testTimeoutInMs ?? TEST_TIME_IN_MS;
    this.maxPayloadBytes =
      options?.maxPayloadBytes ?? STORAGE_ARRAY_COLLECTION_MAX_PAYLOAD_BYTES;
  }

  // ---------------- Test ----------------

  public async test(
    job: StorageArrayConnectionTestJob,
  ): Promise<StorageArrayConnectionTestReport> {
    const started: number = this.dependencies.now().getTime();
    try {
      const summary: StorageArrayCollectionSummary = await this.withTimeout(
        this.testTimeoutInMs,
        "The test",
        (context: PollContext): Promise<StorageArrayCollectionSummary> => {
          return this.runTest(context);
        },
        job,
      );
      return {
        storageArrayConnectionTestId: job.storageArrayConnectionTestId,
        status: "Succeeded",
        summary: summary,
        durationInMs: this.dependencies.now().getTime() - started,
      };
    } catch (error) {
      const classified: ClassifiedStorageArrayError = this.classify(error, job);
      return {
        storageArrayConnectionTestId: job.storageArrayConnectionTestId,
        status: "Failed",
        errorCode: classified.code,
        errorMessage: classified.message,
        presentedCertificate: classified.presentedCertificate,
        durationInMs: this.dependencies.now().getTime() - started,
      };
    }
  }

  private async runTest(
    context: PollContext,
  ): Promise<StorageArrayCollectionSummary> {
    const arrays: Array<StorageArrayCollectionArraySummary> = [];
    const forbidden: Map<string, StorageArrayCollectionError> = new Map();
    const warnings: Array<string> = [];

    for (const symmetrixId of await this.listArrays(context)) {
      const details: JSONObject | null = await this.readArrayDetailsOrSkip(
        context,
        symmetrixId,
        arrays,
        forbidden,
      );
      if (!details) {
        continue;
      }
      const entry: StorageArrayCollectionArraySummary = this.arraySummary(
        symmetrixId,
        details,
      );
      arrays.push(entry);
      if (!entry.isLocal) {
        continue;
      }

      const registration: PowerMaxArrayReading["registration"] =
        await this.readRegistrationOrWarn(context, symmetrixId, entry.warnings);
      entry.isPerformanceCollected = registration.diagnostic;
      entry.isRealtimeCollected = registration.realtime;
      entry.realtimeObjects = registration.realtimeStorageGroups.slice(
        0,
        MAX_REALTIME_STORAGE_GROUPS,
      );

      // How much the account can see: a count, reading ids alone.
      for (const [kind, objectType, filter] of [
        [PowerMaxKind.StorageGroup, "storage-groups", undefined],
        [StorageArrayResourceKind.Volume, "volumes", VOLUME_FILTER],
      ] as Array<
        [string, "storage-groups" | "volumes", Array<string> | undefined]
      >) {
        try {
          const page: UnispherePage = await context.client.listEnhanced({
            symmetrixId,
            objectType,
            select: ["id"],
            filter,
            pageSize: 1,
            // Paged (10.3+): one id and the total. Else every id, counted.
            maxItems:
              context.apiVersion >= UNISPHERE_API_VERSION_WITH_HARDWARE
                ? 1
                : Number.MAX_SAFE_INTEGER,
          });
          entry.counts[kind] = page.total;
        } catch (error) {
          this.rethrowFatal(error);
          entry.warnings.push(
            `The account could not count the ${kind === PowerMaxKind.StorageGroup ? "storage groups" : "volumes"} of ${symmetrixId}: ${describe(error)}`,
          );
        }
      }

      // Performance needs the PerfMonitor role: try what a collection reads.
      if (registration.diagnostic) {
        try {
          await context.client.listPerformanceCategories(symmetrixId);
        } catch (error) {
          this.rethrowFatal(error);
          if (isHttpStatus(error, 403)) {
            entry.warnings.push(
              `The account may not read the performance of ${symmetrixId}. Give the Unisphere user the PerfMonitor role, as well as Monitor.`,
            );
          } else {
            entry.warnings.push(
              `Unisphere did not answer the performance of ${symmetrixId}: ${describe(error)}`,
            );
          }
        }
      } else if (registration.diagnostic === false) {
        entry.warnings.push(
          `Performance collection is off for ${symmetrixId}: turn it on in Unisphere at Settings > Performance > System Registrations (Diagnostic). Until then, its inventory and alerts are collected, its performance is not.`,
        );
      }
    }

    this.assertSomeLocalArray(arrays, forbidden);

    if (context.apiVersion < UNISPHERE_API_VERSION_WITH_HARDWARE) {
      warnings.push(
        `Unisphere ${context.version.version} lists no ports or SRDF groups for a read-only account. Upgrade to Unisphere for PowerMax 10.3 or later to see them; directors, storage groups, volumes and performance are read either way.`,
      );
    }

    return {
      serverProductName: POWERMAX_PROBE_COLLECTOR.serverProductName,
      serverVersion: context.version.version,
      apiVersion: String(context.apiVersion),
      arrays: arrays,
      warnings: warnings,
    };
  }

  // ---------------- Collection ----------------

  public async collect(
    job: StorageArrayCollectionJob,
  ): Promise<StorageArrayCollectionReport> {
    const startedAt: Date = this.dependencies.now();
    try {
      const result: {
        resourceMetrics: JSONArray;
        summary: StorageArrayCollectionSummary;
      } = await this.withTimeout(
        this.collectionTimeoutInMs,
        "The collection",
        (context: PollContext) => {
          return this.runCollection(context, startedAt);
        },
        job,
      );
      return {
        storageArrayConnectionId: job.storageArrayConnectionId,
        settingsVersion: job.settingsVersion,
        collectedAt: startedAt.toISOString(),
        status: "Succeeded",
        summary: result.summary,
        resourceMetrics: result.resourceMetrics,
        durationInMs: this.dependencies.now().getTime() - startedAt.getTime(),
      };
    } catch (error) {
      const classified: ClassifiedStorageArrayError = this.classify(error, job);
      return {
        storageArrayConnectionId: job.storageArrayConnectionId,
        settingsVersion: job.settingsVersion,
        collectedAt: startedAt.toISOString(),
        status: "Failed",
        errorCode: classified.code,
        errorMessage: classified.message,
        presentedCertificate: classified.presentedCertificate,
        durationInMs: this.dependencies.now().getTime() - startedAt.getTime(),
      };
    }
  }

  private async runCollection(
    context: PollContext,
    startedAt: Date,
  ): Promise<{
    resourceMetrics: JSONArray;
    summary: StorageArrayCollectionSummary;
  }> {
    const arrays: Array<StorageArrayCollectionArraySummary> = [];
    const forbidden: Map<string, StorageArrayCollectionError> = new Map();
    const resources: Array<{
      summary: StorageArrayCollectionArraySummary;
      resource: StorageArrayOtlpResource;
    }> = [];
    const warnings: Array<string> = [];

    for (const symmetrixId of await this.listArrays(context)) {
      const details: JSONObject | null = await this.readArrayDetailsOrSkip(
        context,
        symmetrixId,
        arrays,
        forbidden,
      );
      if (!details) {
        continue;
      }
      const entry: StorageArrayCollectionArraySummary = this.arraySummary(
        symmetrixId,
        details,
      );
      arrays.push(entry);
      if (!entry.isLocal) {
        continue;
      }

      const reading: PowerMaxArrayReading = await this.readArray(
        context,
        symmetrixId,
        details,
      );

      entry.isPerformanceCollected = reading.registration.diagnostic;
      entry.isRealtimeCollected = reading.registration.realtime;
      entry.realtimeObjects = reading.registration.realtimeStorageGroups.slice(
        0,
        MAX_REALTIME_STORAGE_GROUPS,
      );
      entry.counts = PowerMaxOtlpBuilder.getCounts(reading);
      entry.warnings.push(...reading.warnings);
      entry.isCollected = true;

      resources.push({
        summary: entry,
        resource: PowerMaxOtlpBuilder.build({
          reading: reading,
          unisphereVersion: context.version.version,
          timeMs: startedAt.getTime(),
        }),
      });
    }

    this.assertSomeLocalArray(arrays, forbidden);

    if (context.apiVersion < UNISPHERE_API_VERSION_WITH_HARDWARE) {
      warnings.push(
        `Unisphere ${context.version.version} lists no ports or SRDF groups for a read-only account. Upgrade to Unisphere for PowerMax 10.3 or later to see them.`,
      );
    }

    const resourceMetrics: JSONArray = this.fitIntoOneUpload(
      resources,
      warnings,
    );

    let datapointCount: number = 0;
    for (const { resource } of resources) {
      datapointCount += resource.getDatapointCount();
    }

    return {
      resourceMetrics,
      summary: {
        serverProductName: POWERMAX_PROBE_COLLECTOR.serverProductName,
        serverVersion: context.version.version,
        apiVersion: String(context.apiVersion),
        arrays: arrays,
        resourceCount: resourceMetrics.length,
        datapointCount: datapointCount,
        warnings: warnings,
      },
    };
  }

  /*
   * One upload is at most maxPayloadBytes of JSON. Past it, the arrays'
   * volume series go first (each array keeps its own figures and its
   * storage groups'), largest array first; past that, the collection is
   * too large for a probe.
   */
  private fitIntoOneUpload(
    resources: Array<{
      summary: StorageArrayCollectionArraySummary;
      resource: StorageArrayOtlpResource;
    }>,
    warnings: Array<string>,
  ): JSONArray {
    const build: () => JSONArray = (): JSONArray => {
      return resources.map(
        (entry: {
          summary: StorageArrayCollectionArraySummary;
          resource: StorageArrayOtlpResource;
        }) => {
          return entry.resource.build(this.dependencies.scopeVersion);
        },
      );
    };

    let resourceMetrics: JSONArray = build();
    let size: number = Buffer.byteLength(JSON.stringify(resourceMetrics));
    if (size <= this.maxPayloadBytes) {
      return resourceMetrics;
    }

    const bySize: Array<{
      summary: StorageArrayCollectionArraySummary;
      resource: StorageArrayOtlpResource;
    }> = [...resources].sort(
      (
        a: { resource: StorageArrayOtlpResource },
        b: { resource: StorageArrayOtlpResource },
      ): number => {
        return b.resource.getDatapointCount() - a.resource.getDatapointCount();
      },
    );

    for (const entry of bySize) {
      const dropped: number = entry.resource.dropMetrics(
        `${POWERMAX_METRIC_PREFIX}volume_`,
      );
      if (dropped > 0) {
        /*
         * Its volume list is no longer complete in this upload: without
         * the mark the server keeps the volumes it has, instead of reading
         * an empty list as every volume deleted.
         */
        entry.resource.dropDatapoints(
          POWERMAX_METRICS.inventoryListed,
          POWERMAX_LABELS.scrapeEndpoint,
          POWERMAX_ENDPOINTS.volumes,
        );
        const warning: string = `The volumes of ${entry.summary.id} were left out of this collection: all of it is larger than one probe upload may be. Read this Unisphere less often, or connect its arrays through more than one Unisphere.`;
        entry.summary.warnings.push(warning);
        warnings.push(warning);
      }
      resourceMetrics = build();
      size = Buffer.byteLength(JSON.stringify(resourceMetrics));
      if (size <= this.maxPayloadBytes) {
        return resourceMetrics;
      }
    }

    throw new StorageArrayCollectionError(
      StorageArrayCollectionErrorCode.PayloadTooLarge,
      `The collection is ${Math.round(size / (1024 * 1024))} MiB of metrics, more than one probe upload may be (${Math.round(this.maxPayloadBytes / (1024 * 1024))} MiB), even without its volumes.`,
    );
  }

  // ---------------- One array ----------------

  public async readArray(
    context: PollContext,
    symmetrixId: string,
    details: JSONObject,
  ): Promise<PowerMaxArrayReading> {
    const client: UnisphereClient = context.client;
    const warnings: Array<string> = [];
    const totals: Record<string, number> = {};

    const reading: PowerMaxArrayReading = {
      symmetrixId,
      model: toText(details["model"]),
      microcode: toText(details["microcode"]) || toText(details["ucode"]),
      isLocal: true,
      capacity: null,
      healthScores: [],
      registration: {
        diagnostic: null,
        realtime: null,
        realtimeStorageGroups: [],
      },
      performance: new Map(),
      storageGroups: null,
      volumes: null,
      srps: null,
      directors: null,
      ports: null,
      srdfGroups: null,
      alerts: null,
      realtimeStorageGroups: new Map(),
      volumePerformance: new Map(),
      totals: totals,
      warnings: warnings,
    };

    // Storage resource pools, before capacity: an array may report it per pool.
    reading.srps = await this.part(
      warnings,
      "storage resource pools",
      symmetrixId,
      async () => {
        const srps: Array<PowerMaxSrp> = [];
        for (const srpId of await client.listSrpIds(symmetrixId)) {
          const srp: PowerMaxSrp | null = readSrp(
            await client.getSrp(symmetrixId, srpId),
          );
          if (srp) {
            srps.push(srp);
          }
        }
        return srps;
      },
    );

    const provisioning: JSONObject | null = await this.part(
      warnings,
      "capacity",
      symmetrixId,
      () => {
        return client.getProvisioningArray(symmetrixId);
      },
    );
    reading.capacity = readCapacity(provisioning, reading.srps);

    const health: JSONObject | null = await this.part(
      warnings,
      "health scores",
      symmetrixId,
      () => {
        return client.getHealth(symmetrixId);
      },
      { quietWhenMissing: true },
    );
    reading.healthScores = readHealthScores(health);

    reading.registration = await this.readRegistrationOrWarn(
      context,
      symmetrixId,
      warnings,
    );
    const realtimeGroups: Set<string> = new Set(
      reading.registration.realtimeStorageGroups,
    );

    // Storage groups, then the SRDF states of the ones SRDF protects.
    const groupsPage: UnispherePage | null = await this.part(
      warnings,
      "storage groups",
      symmetrixId,
      () => {
        return this.listWithFallback(context, {
          symmetrixId,
          objectType: "storage-groups",
          select: SG_SELECT,
          minimalSelect: SG_MINIMAL_SELECT,
          maxItems: MAX_STORAGE_GROUPS_PER_ARRAY,
        });
      },
    );
    if (groupsPage) {
      const groups: Array<PowerMaxStorageGroup> = [];
      for (const item of groupsPage.items) {
        const group: PowerMaxStorageGroup | null = readStorageGroup(
          item,
          realtimeGroups,
        );
        if (group) {
          groups.push(group);
        }
      }
      if (groupsPage.isTruncated) {
        totals[PowerMaxKind.StorageGroup] = groupsPage.total;
        warnings.push(
          `Only the first ${groups.length} of ${groupsPage.total} storage groups of ${symmetrixId} are listed.`,
        );
      }
      const replicated: Array<PowerMaxStorageGroup> = groups.filter(
        (group: PowerMaxStorageGroup): boolean => {
          const item: JSONObject | undefined = groupsPage.items.find(
            (entry: JSONObject): boolean => {
              return entry["id"] === group.id;
            },
          );
          return Number(item?.["num_of_rdf_infos"] ?? 0) > 0;
        },
      );
      if (replicated.length > 0) {
        const rdfPage: UnispherePage | null = await this.part(
          warnings,
          "the SRDF states of its storage groups",
          symmetrixId,
          () => {
            return client.listEnhanced({
              symmetrixId,
              objectType: "storage-groups",
              select: SG_RDF_SELECT,
              filter: ["num_of_rdf_infos gt 0"],
              pageSize: ENHANCED_PAGE_SIZE,
              maxItems: MAX_STORAGE_GROUPS_PER_ARRAY,
            });
          },
        );
        for (const item of rdfPage?.items || []) {
          const withStates: PowerMaxStorageGroup | null = readStorageGroup(
            item,
            realtimeGroups,
          );
          const group: PowerMaxStorageGroup | undefined = groups.find(
            (entry: PowerMaxStorageGroup): boolean => {
              return entry.id === withStates?.id;
            },
          );
          if (group && withStates) {
            group.srdfStates = withStates.srdfStates;
            group.srdfModes = withStates.srdfModes;
            group.srdfGroups = withStates.srdfGroups;
          }
        }
      }
      reading.storageGroups = groups;
    }

    const volumesPage: UnispherePage | null = await this.part(
      warnings,
      "volumes",
      symmetrixId,
      () => {
        return this.listWithFallback(context, {
          symmetrixId,
          objectType: "volumes",
          select: VOLUME_SELECT,
          minimalSelect: VOLUME_MINIMAL_SELECT,
          filter: VOLUME_FILTER,
          maxItems: MAX_VOLUMES_PER_ARRAY,
        });
      },
    );
    if (volumesPage) {
      reading.volumes = volumesPage.items
        .map((item: JSONObject): PowerMaxVolume | null => {
          return readVolume(item);
        })
        .filter((volume: PowerMaxVolume | null): volume is PowerMaxVolume => {
          return volume !== null;
        });
      if (volumesPage.isTruncated) {
        totals[StorageArrayResourceKind.Volume] = volumesPage.total;
        warnings.push(
          `Only the first ${reading.volumes.length} of ${volumesPage.total} volumes of ${symmetrixId} are listed. Their storage groups' figures cover every volume.`,
        );
      }
    }

    // Directors, ports and SRDF groups: the bulk endpoints from 10.3.
    let srdfPortIds: Set<string> = new Set();
    if (context.apiVersion >= UNISPHERE_API_VERSION_WITH_HARDWARE) {
      const statesByGroup: Map<string, Array<string>> = getSrdfStatesByGroup(
        reading.storageGroups || [],
      );
      const srdfPage: UnispherePage | null = await this.part(
        warnings,
        "SRDF groups",
        symmetrixId,
        () => {
          return client.listEnhanced({
            symmetrixId,
            objectType: "rdf-groups",
            select: SRDF_SELECT,
            pageSize: ENHANCED_PAGE_SIZE,
            maxItems: 10_000,
          });
        },
      );
      if (srdfPage) {
        const groups: Array<PowerMaxSrdfGroup> = [];
        for (const item of srdfPage.items) {
          const group: PowerMaxSrdfGroup | null = readSrdfGroup(
            item,
            statesByGroup,
          );
          if (group) {
            groups.push(group);
            for (const id of getSrdfGroupPortIds(item)) {
              srdfPortIds.add(id);
            }
          }
        }
        reading.srdfGroups = groups;
      }

      const directorsPage: UnispherePage | null = await this.part(
        warnings,
        "directors",
        symmetrixId,
        () => {
          return client.listEnhanced({
            symmetrixId,
            objectType: "directors",
            select: DIRECTOR_SELECT,
            pageSize: ENHANCED_PAGE_SIZE,
            maxItems: 10_000,
          });
        },
      );
      if (directorsPage) {
        reading.directors = directorsPage.items
          .map((item: JSONObject): PowerMaxDirector | null => {
            return readDirector(item);
          })
          .filter(
            (
              director: PowerMaxDirector | null,
            ): director is PowerMaxDirector => {
              return director !== null;
            },
          );
      }

      const portsPage: UnispherePage | null = await this.part(
        warnings,
        "ports",
        symmetrixId,
        () => {
          return client.listEnhanced({
            symmetrixId,
            objectType: "ports",
            select: PORT_SELECT,
            pageSize: ENHANCED_PAGE_SIZE,
            maxItems: 10_000,
          });
        },
      );
      if (portsPage) {
        reading.ports = portsPage.items
          .map((item: JSONObject): PowerMaxPort | null => {
            return readPort(item, srdfPortIds);
          })
          .filter((port: PowerMaxPort | null): port is PowerMaxPort => {
            return port !== null;
          });
      }
    } else {
      srdfPortIds = new Set();
      // Older Unisphere: directors one by one; SRDF groups from the storage groups.
      reading.directors = await this.part(
        warnings,
        "directors",
        symmetrixId,
        async () => {
          const directors: Array<PowerMaxDirector> = [];
          for (const directorId of await client.listDirectorIds(symmetrixId)) {
            const director: PowerMaxDirector | null = readDirector(
              await client.getDirector(symmetrixId, directorId),
            );
            if (director) {
              directors.push(director);
            }
          }
          return directors;
        },
      );
      if (reading.storageGroups) {
        reading.srdfGroups = deriveSrdfGroupsFromStorageGroups(
          reading.storageGroups,
        );
      }
    }

    reading.alerts = await this.part(warnings, "alerts", symmetrixId, () => {
      return this.readAlerts(context, symmetrixId, warnings);
    });

    // Performance: the 5-minute KPIs of each category, while it is collected.
    if (reading.registration.diagnostic !== false) {
      await this.readPerformance(context, reading);
    }

    // Real time, for the storage groups registered for it.
    if (
      reading.registration.realtime &&
      reading.registration.realtimeStorageGroups.length > 0
    ) {
      await this.readRealtime(context, reading);
    }

    return reading;
  }

  private async readPerformance(
    context: PollContext,
    reading: PowerMaxArrayReading,
  ): Promise<void> {
    const symmetrixId: string = reading.symmetrixId;
    let available: Array<string> | null = null;
    try {
      available = await context.client.listPerformanceCategories(symmetrixId);
    } catch (error) {
      this.rethrowFatal(error);
      reading.warnings.push(
        isHttpStatus(error, 403)
          ? `The account may not read the performance of ${symmetrixId}: give the Unisphere user the PerfMonitor role.`
          : `Unisphere did not answer the performance of ${symmetrixId}: ${describe(error)}`,
      );
      return;
    }

    for (const category of PERFORMANCE_CATEGORIES) {
      if (available.length > 0 && !available.includes(category)) {
        continue;
      }
      try {
        const instances: Array<UnispherePerformanceInstance> =
          await context.client.getPerformanceCategory(symmetrixId, category);
        reading.performance.set(category, instances);
      } catch (error) {
        this.rethrowFatal(error);
        // A category the array has nothing in (no SRDF/A) answers an error.
        if (!isHttpStatus(error, 400, 404)) {
          reading.warnings.push(
            `Unisphere did not answer the ${category} performance of ${symmetrixId}: ${describe(error)}`,
          );
        }
      }
    }
  }

  private async readRealtime(
    context: PollContext,
    reading: PowerMaxArrayReading,
  ): Promise<void> {
    const symmetrixId: string = reading.symmetrixId;
    const endMs: number = this.dependencies.now().getTime();
    const groups: Array<string> =
      reading.registration.realtimeStorageGroups.slice(
        0,
        MAX_REALTIME_STORAGE_GROUPS,
      );

    let metrics: Array<string> = [...REALTIME_STORAGE_GROUP_FALLBACK_METRICS];
    try {
      const available: Array<string> = await context.client.listRealtimeMetrics(
        symmetrixId,
        REALTIME_STORAGE_GROUP_CATEGORY,
      );
      const wanted: Array<string> = REALTIME_STORAGE_GROUP_METRICS.filter(
        (metric: string): boolean => {
          return available.includes(metric);
        },
      );
      if (wanted.length > 0) {
        metrics = wanted;
      }
    } catch (error) {
      this.rethrowFatal(error);
      // An older Unisphere's help: the metrics every array's category has.
    }

    // Each group's 5-second samples since the last collection.
    for (const groupId of groups) {
      try {
        const points: Array<UnisphereTimedPoint> =
          await context.client.getRealtimeStorageGroupMetrics({
            symmetrixId,
            storageGroupId: groupId,
            startMs: endMs - 5 * 60_000,
            endMs: endMs,
            metrics: metrics,
          });
        if (points.length > 0) {
          reading.realtimeStorageGroups.set(groupId, points);
        }
      } catch (error) {
        this.rethrowFatal(error);
        reading.warnings.push(
          `Unisphere did not answer the real-time figures of storage group ${groupId} on ${symmetrixId}: ${describe(error)}`,
        );
      }
    }

    // The volumes of those groups, each one's newest 5-minute sample.
    try {
      const volumes: Array<{
        volumeId: string;
        points: Array<UnisphereTimedPoint>;
      }> = await context.client.getVolumeMetrics({
        symmetrixId,
        storageGroupIds: groups,
        startMs: endMs - 15 * 60_000,
        endMs: endMs,
        metrics: [...VOLUME_METRICS],
      });
      for (const volume of volumes) {
        const newest: UnisphereTimedPoint | undefined =
          volume.points[volume.points.length - 1];
        if (newest) {
          reading.volumePerformance.set(volume.volumeId, newest);
        }
      }
    } catch (error) {
      this.rethrowFatal(error);
      reading.warnings.push(
        `Unisphere did not answer the volume figures of the real-time storage groups on ${symmetrixId}: ${describe(error)}`,
      );
    }
  }

  private async readAlerts(
    context: PollContext,
    symmetrixId: string,
    warnings: Array<string>,
  ): Promise<Array<PowerMaxAlert>> {
    const ids: Array<string> = [];
    for (const severity of ALERT_SEVERITIES) {
      for (const id of await context.client.listOpenAlertIds(
        symmetrixId,
        severity,
      )) {
        if (!ids.includes(id)) {
          ids.push(id);
        }
      }
    }

    const alerts: Array<PowerMaxAlert> = [];
    let read: number = 0;
    let unread: number = 0;
    for (const id of ids) {
      const key: string = `${context.address.host}:${context.address.port}|${id}`;
      let detail: JSONObject | undefined = alertCache.get(key);
      if (!detail) {
        if (read >= MAX_NEW_ALERT_DETAILS_PER_ARRAY) {
          unread++;
          continue;
        }
        read++;
        try {
          detail = await context.client.getAlert(symmetrixId, id);
        } catch (error) {
          this.rethrowFatal(error);
          // Deleted between the list and the read: not open any more.
          if (isHttpStatus(error, 404)) {
            continue;
          }
          throw error;
        }
        cacheAlert(key, detail);
      }
      const alert: PowerMaxAlert | null = readAlert(detail);
      if (alert) {
        alerts.push(alert);
      }
    }
    if (unread > 0) {
      warnings.push(
        `${unread} more open alerts of ${symmetrixId} are read in the next collections.`,
      );
    }
    return alerts;
  }

  // ---------------- What every call shares ----------------

  /*
   * One part of an array: its answer, or null with a warning when the
   * account may not read it or the server has no such part. What stops
   * every array (the login refused, the server gone) is not caught.
   */
  private async part<T>(
    warnings: Array<string>,
    what: string,
    symmetrixId: string,
    read: () => Promise<T>,
    options?: { quietWhenMissing?: boolean | undefined },
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.rethrowFatal(error);
      if (isHttpStatus(error, 404) && options?.quietWhenMissing) {
        return null;
      }
      if (isHttpStatus(error, 403)) {
        warnings.push(
          `The account may not read the ${what} of ${symmetrixId}: give the Unisphere user the Monitor role.`,
        );
      } else {
        warnings.push(
          `Unisphere did not answer the ${what} of ${symmetrixId}: ${describe(error)}`,
        );
      }
      return null;
    }
  }

  /*
   * An enhanced list, and the same list with only the attributes every
   * Unisphere 10.1 has when the server refuses one asked for (an unknown
   * attribute is answered with HTTP 400).
   */
  private async listWithFallback(
    context: PollContext,
    data: {
      symmetrixId: string;
      objectType: "storage-groups" | "volumes";
      select: Array<string>;
      minimalSelect: Array<string>;
      filter?: Array<string> | undefined;
      maxItems: number;
    },
  ): Promise<UnispherePage> {
    try {
      return await context.client.listEnhanced({
        symmetrixId: data.symmetrixId,
        objectType: data.objectType,
        select: data.select,
        filter: data.filter,
        pageSize: ENHANCED_PAGE_SIZE,
        maxItems: data.maxItems,
      });
    } catch (error) {
      if (!isHttpStatus(error, 400)) {
        throw error;
      }
      return await context.client.listEnhanced({
        symmetrixId: data.symmetrixId,
        objectType: data.objectType,
        select: data.minimalSelect,
        filter: data.filter,
        pageSize: ENHANCED_PAGE_SIZE,
        maxItems: data.maxItems,
      });
    }
  }

  private async readRegistrationOrWarn(
    context: PollContext,
    symmetrixId: string,
    warnings: Array<string>,
  ): Promise<PowerMaxArrayReading["registration"]> {
    try {
      return readRegistration(
        await context.client.getRegistrationDetails(symmetrixId),
      );
    } catch (error) {
      this.rethrowFatal(error);
      warnings.push(
        isHttpStatus(error, 403)
          ? `The account may not read whether Unisphere collects the performance of ${symmetrixId}: give the Unisphere user the PerfMonitor role.`
          : `Unisphere did not say whether it collects the performance of ${symmetrixId}: ${describe(error)}`,
      );
      return readRegistration(null);
    }
  }

  private async listArrays(context: PollContext): Promise<Array<string>> {
    try {
      return await context.client.listArrayIds();
    } catch (error) {
      if (isHttpStatus(error, 403)) {
        throw new StorageArrayCollectionError(
          StorageArrayCollectionErrorCode.MissingRole,
          `${context.username} logged in to Unisphere at ${context.address.host}:${context.address.port} but may not list its arrays. Give the user the Monitor role (and PerfMonitor for performance) on every array it should read.`,
        );
      }
      throw error;
    }
  }

  private async readArrayDetails(
    context: PollContext,
    symmetrixId: string,
  ): Promise<JSONObject> {
    try {
      return await context.client.getSystemArray(symmetrixId);
    } catch (error) {
      if (isHttpStatus(error, 403)) {
        throw new StorageArrayCollectionError(
          StorageArrayCollectionErrorCode.MissingRole,
          `${context.username} may not read array ${symmetrixId} in Unisphere. Give the user the Monitor role on it (and PerfMonitor for performance).`,
        );
      }
      throw error;
    }
  }

  /*
   * One array's details, or null when the account may not read that array:
   * Unisphere gives roles per array, so an array out of reach is listed
   * with why, and the others are read. Only when it may read none does the
   * collection fail (assertSomeLocalArray).
   */
  private async readArrayDetailsOrSkip(
    context: PollContext,
    symmetrixId: string,
    arrays: Array<StorageArrayCollectionArraySummary>,
    forbidden: Map<string, StorageArrayCollectionError>,
  ): Promise<JSONObject | null> {
    try {
      return await this.readArrayDetails(context, symmetrixId);
    } catch (error) {
      if (
        error instanceof StorageArrayCollectionError &&
        error.code === StorageArrayCollectionErrorCode.MissingRole
      ) {
        forbidden.set(symmetrixId, error);
        arrays.push({
          id: symmetrixId,
          isLocal: true,
          isCollected: false,
          counts: {},
          warnings: [error.message],
        });
        return null;
      }
      throw error;
    }
  }

  private arraySummary(
    symmetrixId: string,
    details: JSONObject,
  ): StorageArrayCollectionArraySummary {
    const isLocal: boolean = details["local"] !== false;
    return {
      id: symmetrixId,
      model: toText(details["model"]) || undefined,
      osVersion:
        toText(details["microcode"]) || toText(details["ucode"]) || undefined,
      isLocal: isLocal,
      isCollected: false,
      counts: {},
      warnings: isLocal
        ? []
        : [
            `${symmetrixId} is a remote array this Unisphere sees through SRDF. Connect the Unisphere at its own site to collect it.`,
          ],
    };
  }

  private assertSomeLocalArray(
    arrays: Array<StorageArrayCollectionArraySummary>,
    forbidden: Map<string, StorageArrayCollectionError>,
  ): void {
    const isReadableLocal: (
      entry: StorageArrayCollectionArraySummary,
    ) => boolean = (entry: StorageArrayCollectionArraySummary): boolean => {
      return entry.isLocal && !forbidden.has(entry.id);
    };
    if (!arrays.some(isReadableLocal)) {
      // Every array it manages is out of the account's reach: its role.
      const first: StorageArrayCollectionError | undefined = forbidden
        .values()
        .next().value;
      if (first) {
        throw first;
      }
      throw new StorageArrayCollectionError(
        StorageArrayCollectionErrorCode.NoArrays,
        arrays.length === 0
          ? "Unisphere manages no array the account can see. Check that this Unisphere manages PowerMax arrays, and that the user has the Monitor role on them."
          : `Unisphere sees ${arrays.length === 1 ? "one array" : `${arrays.length} arrays`}, all remote (through SRDF). Connect the Unisphere that manages them locally.`,
      );
    }
  }

  // A refused login or a vanished server stops every array: never a warning.
  private rethrowFatal(error: unknown): void {
    if (isHttpStatus(error, 401)) {
      throw error;
    }
    if (
      !(error instanceof UnisphereHttpError) &&
      !(error instanceof UnisphereNotRestApiError)
    ) {
      throw error;
    }
  }

  /*
   * Connects, checks the server is Unisphere 10.1 or later, runs `body`,
   * and closes - within a time budget. The password goes to the transport
   * alone.
   */
  private async withTimeout<T>(
    timeoutInMs: number,
    what: string,
    body: (context: PollContext) => Promise<T>,
    job: {
      address: string;
      username: string;
      password: string;
      trustedCertificateFingerprint?: string | undefined;
    },
  ): Promise<T> {
    const parsed: StorageArrayAddressResult =
      StorageArrayConnectionAddress.normalize(
        job.address,
        POWERMAX_PROBE_COLLECTOR,
      );
    if (!parsed.address) {
      throw new StorageArrayCollectionError(
        StorageArrayCollectionErrorCode.InvalidAddress,
        parsed.error,
      );
    }
    const address: StorageArrayAddress = parsed.address;

    const pinnedAddresses: Array<string> = await this.dependencies.resolve(
      address.url,
    );

    const handle: StorageArrayTransportHandle =
      this.dependencies.createTransport({
        address: address,
        pinnedAddresses: pinnedAddresses,
        trustedFingerprint: job.trustedCertificateFingerprint || null,
      });

    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const client: UnisphereClient = new UnisphereClient({
        transport: handle.transport,
        username: job.username,
        password: job.password,
      });

      const run: Promise<T> = (async (): Promise<T> => {
        const version: UnisphereVersion = await this.readVersion(
          client,
          address,
          job.username,
        );
        const apiVersion: number = this.pickApiVersion(version);
        client.setApiVersion(String(apiVersion));
        return await body({
          client,
          address,
          username: job.username,
          version,
          apiVersion,
          dependencies: this.dependencies,
        });
      })();

      const deadline: Promise<never> = new Promise<never>(
        (_resolve: (value: never) => void, reject: (error: Error) => void) => {
          timer = setTimeout(() => {
            reject(
              new StorageArrayCollectionError(
                StorageArrayCollectionErrorCode.TimedOut,
                `${what} of Unisphere at ${address.host}:${address.port} took longer than ${Math.round(timeoutInMs / 1000)} seconds. Unisphere may be overloaded: read it every 10 minutes, or check its health.`,
              ),
            );
          }, timeoutInMs);
        },
      );

      return await Promise.race([run, deadline]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      handle.close();
    }
  }

  private async readVersion(
    client: UnisphereClient,
    address: StorageArrayAddress,
    username: string,
  ): Promise<UnisphereVersion> {
    const where: string = `${address.host}:${address.port}`;
    try {
      return await client.getVersion();
    } catch (error) {
      if (isHttpStatus(error, 401)) {
        throw new StorageArrayCollectionError(
          StorageArrayCollectionErrorCode.InvalidLogin,
          `Unisphere at ${where} refused the login for ${username}: the user name or password is wrong, or the account is locked or not yet set up in Unisphere.`,
        );
      }
      if (isHttpStatus(error, 403)) {
        throw new StorageArrayCollectionError(
          StorageArrayCollectionErrorCode.MissingRole,
          `${username} logged in to Unisphere at ${where} but may not use its REST API. Give the user the Monitor role (and PerfMonitor for performance).`,
        );
      }
      if (
        isHttpStatus(error, 404, 405) ||
        error instanceof UnisphereNotRestApiError
      ) {
        throw new StorageArrayCollectionError(
          StorageArrayCollectionErrorCode.NotManagementServer,
          `${where} is not Unisphere for PowerMax's REST API (it does not answer /univmax/restapi/version). Enter the address and port you open Unisphere at, usually port 8443.`,
        );
      }
      if (error instanceof UnisphereHttpError) {
        throw new StorageArrayCollectionError(
          StorageArrayCollectionErrorCode.ApiError,
          `Unisphere at ${where} answered with an error: ${describe(error)}`,
        );
      }
      throw error;
    }
  }

  /*
   * The REST API version to speak: the newest the server supports, from
   * 10.1 (101). An older Unisphere has none of the bulk endpoints a
   * collection reads.
   */
  public pickApiVersion(version: UnisphereVersion): number {
    const candidates: Array<number> = [
      readApiVersionNumber(version.apiVersion),
      ...version.supportedApiVersions.map((entry: string) => {
        return readApiVersionNumber(entry);
      }),
    ].filter((entry: number | null): entry is number => {
      return entry !== null;
    });
    const newest: number = candidates.length ? Math.max(...candidates) : 0;
    if (newest < MIN_UNISPHERE_API_VERSION) {
      throw new StorageArrayCollectionError(
        StorageArrayCollectionErrorCode.UnsupportedVersion,
        `Unisphere ${version.version} is older than OneUptime reads. Upgrade to Unisphere for PowerMax 10.1 or later (10.3 or later to see ports and SRDF groups).`,
      );
    }
    return newest;
  }

  private classify(
    error: unknown,
    job: { address: string; username: string },
  ): ClassifiedStorageArrayError {
    const parsed: StorageArrayAddressResult =
      StorageArrayConnectionAddress.normalize(
        job.address,
        POWERMAX_PROBE_COLLECTOR,
      );

    if (error instanceof UnisphereHttpError) {
      const where: string = parsed.address
        ? `${parsed.address.host}:${parsed.address.port}`
        : job.address;
      if (error.status === 401) {
        return {
          code: StorageArrayCollectionErrorCode.InvalidLogin,
          message: `Unisphere at ${where} refused the login for ${job.username}: the user name or password is wrong, or the account is locked.`,
        };
      }
      if (error.status === 403) {
        return {
          code: StorageArrayCollectionErrorCode.MissingRole,
          message: `${job.username} may not read what Unisphere was asked (${error.path.split("?")[0]}). Give the user the Monitor role (and PerfMonitor for performance).`,
        };
      }
      return {
        code: StorageArrayCollectionErrorCode.ApiError,
        message: `Unisphere at ${where} answered with an error: ${describe(error)}`,
      };
    }

    if (error instanceof UnisphereNotRestApiError) {
      return {
        code: StorageArrayCollectionErrorCode.NotManagementServer,
        message: `${error.message} Enter the address and port you open Unisphere for PowerMax at.`,
      };
    }

    return classifyStorageArrayError(error, {
      host: parsed.address?.host || job.address,
      port: parsed.address?.port || POWERMAX_PROBE_COLLECTOR.defaultPort,
      username: job.username,
      serverName: POWERMAX_PROBE_COLLECTOR.serverShortName,
    });
  }
}

export default new PowerMaxPoller();
