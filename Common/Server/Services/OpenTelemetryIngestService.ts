import OneUptimeDate from "../../Types/Date";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Metric, {
  AggregationTemporality,
} from "../../Models/AnalyticsModels/Metric";
import Project from "../../Models/DatabaseModels/Project";
import Service from "../../Models/DatabaseModels/Service";
import ProjectService from "../../Server/Services/ProjectService";
import ServiceService from "../../Server/Services/ServiceService";
import LabelService from "../../Server/Services/LabelService";
import { DEFAULT_RETENTION_IN_DAYS } from "../../Models/DatabaseModels/TelemetryUsageBilling";
import TelemetryUtil from "../../Server/Utils/Telemetry/Telemetry";
import { extractOneuptimeLabelNames } from "../Utils/Telemetry/OneuptimeLabel";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import TelemetryRetentionConfig from "../../Types/Telemetry/TelemetryRetentionConfig";
import ServiceType from "../../Types/Telemetry/ServiceType";
import Host from "../../Models/DatabaseModels/Host";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import ServerlessFunction from "../../Models/DatabaseModels/ServerlessFunction";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import HostService from "./HostService";
import DockerHostService from "./DockerHostService";
import KubernetesClusterService from "./KubernetesClusterService";
import ServerlessFunctionService from "./ServerlessFunctionService";
import CloudResourceService from "./CloudResourceService";
import RumApplicationService from "./RumApplicationService";
import GlobalCache from "../Infrastructure/GlobalCache";
import EntityType from "../../Types/Telemetry/EntityType";
import { ExtractedEntity } from "../Utils/Telemetry/TelemetryEntity";
import { reconcileEntityRegistryThrottled } from "../Utils/Telemetry/EntityRegistry";
import {
  keyForService,
  canonicalizeEntityValue,
} from "../../Utils/Telemetry/EntityKey";

export enum OtelAggregationTemporality {
  Cumulative = "AGGREGATION_TEMPORALITY_CUMULATIVE",
  Delta = "AGGREGATION_TEMPORALITY_DELTA",
}

export interface TelemetryServiceMetadata {
  serviceName: string;
  primaryEntityId: ObjectID;
  /*
   * Discriminator stamped on every analytics row so the read side
   * knows which Postgres table the `primaryEntityId` actually points at
   * (real Service, Host, DockerHost, KubernetesCluster, Monitor, …).
   * Defaults to OpenTelemetry for legacy ingest paths that go through
   * `telemetryServiceFromName`.
   */
  primaryEntityType: ServiceType;
  /*
   * Stable keys of every OpenTelemetry entity (service, host, k8s.pod,
   * container, ...) derived from this batch's resource attributes — the
   * membership set stamped into each row's `entityKeys` column. A
   * superset that includes the primary entity's key for OTel-resource
   * entity types (service / host / k8s.*). Populated with the full
   * extracted set by `OtelIngestBaseService.resolveTelemetryResource`;
   * lower-fidelity name-only sources (syslog / fluent) that resolve
   * metadata directly via `telemetryServiceFromName` get the single
   * service key.
   */
  entityKeys?: Array<string> | undefined;
  dataRententionInDays: number;
  serviceRetentionConfig: TelemetryRetentionConfig | null;
  serviceRetentionInDays: number | null;
  projectRetentionConfig: TelemetryRetentionConfig | null;
  projectRetentionInDays: number;
}

interface ProjectRetentionContext {
  projectRetentionConfig: TelemetryRetentionConfig | null;
  projectRetentionInDays: number;
}

/*
 * Per-process memo holding the project's telemetry retention
 * context for the duration of the cache TTL. The L2 GlobalCache
 * (Redis, shared across workers) is the source of truth for
 * cross-process freshness; this L1 in-process Map exists so the
 * dozens of getProjectRetentionContext calls per worker batch
 * (one per resource span -> Service/Host/DockerHost/Kubernetes
 * resolution) collapse to zero network round-trips after the
 * first one warms it. Both layers TTL out together.
 */
interface CachedRetentionContext {
  context: ProjectRetentionContext;
  expiresAtMs: number;
}

const PROJECT_RETENTION_CACHE_NAMESPACE: string = "project-retention-context";
/*
 * 5-minute TTL is long enough that steady-state ingest sees ~100%
 * cache hits and short enough that an admin retention change in
 * the UI propagates without us having to wire up cross-process
 * invalidation (which would need pub/sub — GlobalCache has no
 * delete primitive today). Admins changing retention should
 * expect up to 5 minutes of lag before new rows pick up the new
 * config; existing rows keep whatever retentionDate they were
 * stamped with at ingest time and aren't affected either way.
 */
const PROJECT_RETENTION_CACHE_TTL_SECONDS: number = 5 * 60;
const projectRetentionInProcessCache: Map<string, CachedRetentionContext> =
  new Map();

export default class OTelIngestService {
  /*
   * Read a single string-valued OTel resource attribute out of the raw
   * OTLP attribute array (shape: [{ key, value: { stringValue } }]).
   * Mirrors OtelIngestBaseService.getStringAttribute — duplicated here
   * because that one is on the ingest-side base class and this read path
   * (Service resolution) lives in Common.
   */
  private static getResourceStringAttribute(
    attributes: JSONArray,
    key: string,
  ): string | null {
    for (const attribute of attributes) {
      if (
        attribute["key"] === key &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        const value: unknown = (attribute["value"] as JSONObject)[
          "stringValue"
        ];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
    return null;
  }

  /*
   * Build the metadata captured onto the Service row from OTel resource
   * attributes (service.version, deployment.environment, cloud.*, runtime.*).
   * Returns undefined when no resource attributes are available so the
   * caller falls back to a plain lastSeenAt touch.
   */
  private static buildServiceMetadataFromAttributes(
    attributes: JSONArray | undefined,
  ):
    | {
        serviceVersion?: string | undefined;
        deploymentEnvironment?: string | undefined;
        serviceNamespace?: string | undefined;
        runtimeName?: string | undefined;
        runtimeVersion?: string | undefined;
        cloudProvider?: string | undefined;
        cloudPlatform?: string | undefined;
        cloudRegion?: string | undefined;
        cloudAccountId?: string | undefined;
      }
    | undefined {
    if (!attributes) {
      return undefined;
    }
    return {
      serviceVersion:
        this.getResourceStringAttribute(attributes, "service.version") ||
        undefined,
      deploymentEnvironment:
        this.getResourceStringAttribute(
          attributes,
          "deployment.environment.name",
        ) ||
        this.getResourceStringAttribute(attributes, "deployment.environment") ||
        undefined,
      serviceNamespace:
        this.getResourceStringAttribute(attributes, "service.namespace") ||
        undefined,
      runtimeName:
        this.getResourceStringAttribute(attributes, "process.runtime.name") ||
        undefined,
      runtimeVersion:
        this.getResourceStringAttribute(
          attributes,
          "process.runtime.version",
        ) || undefined,
      cloudProvider:
        this.getResourceStringAttribute(attributes, "cloud.provider") ||
        undefined,
      cloudPlatform:
        this.getResourceStringAttribute(attributes, "cloud.platform") ||
        undefined,
      cloudRegion:
        this.getResourceStringAttribute(attributes, "cloud.region") ||
        undefined,
      cloudAccountId:
        this.getResourceStringAttribute(attributes, "cloud.account.id") ||
        undefined,
    };
  }

  @CaptureSpan()
  private static async getProjectRetentionContext(
    projectId: ObjectID,
  ): Promise<ProjectRetentionContext> {
    const projectIdStr: string = projectId.toString();
    const now: number = Date.now();

    // L1: in-process memo. Zero network cost.
    const memoed: CachedRetentionContext | undefined =
      projectRetentionInProcessCache.get(projectIdStr);
    if (memoed && memoed.expiresAtMs > now) {
      return memoed.context;
    }

    // L2: Redis. Single round-trip; shared across workers.
    try {
      const cached: JSONObject | null = await GlobalCache.getJSONObject(
        PROJECT_RETENTION_CACHE_NAMESPACE,
        projectIdStr,
      );
      if (cached) {
        const context: ProjectRetentionContext = {
          projectRetentionConfig:
            (cached[
              "projectRetentionConfig"
            ] as TelemetryRetentionConfig | null) ?? null,
          projectRetentionInDays:
            (cached["projectRetentionInDays"] as number) ||
            DEFAULT_RETENTION_IN_DAYS,
        };
        projectRetentionInProcessCache.set(projectIdStr, {
          context,
          expiresAtMs: now + PROJECT_RETENTION_CACHE_TTL_SECONDS * 1000,
        });
        return context;
      }
    } catch (err) {
      // Cache outage must never fail ingest. Fall through to Postgres.
      logger.warn(
        `Project retention cache read failed for project ${projectIdStr}; falling back to Postgres: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Cold path: hit Postgres and warm both caches.
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        defaultTelemetryRetentionInDays: true,
        telemetryRetentionConfig: true,
      },
      props: {
        isRoot: true,
      },
    });

    const context: ProjectRetentionContext = {
      projectRetentionConfig: project?.telemetryRetentionConfig ?? null,
      projectRetentionInDays:
        project?.defaultTelemetryRetentionInDays || DEFAULT_RETENTION_IN_DAYS,
    };

    projectRetentionInProcessCache.set(projectIdStr, {
      context,
      expiresAtMs: now + PROJECT_RETENTION_CACHE_TTL_SECONDS * 1000,
    });

    try {
      await GlobalCache.setJSON(
        PROJECT_RETENTION_CACHE_NAMESPACE,
        projectIdStr,
        {
          projectRetentionConfig: (context.projectRetentionConfig ??
            null) as unknown as JSONObject,
          projectRetentionInDays: context.projectRetentionInDays,
        },
        { expiresInSeconds: PROJECT_RETENTION_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      // Best-effort warm. Don't fail the request.
      logger.warn(
        `Project retention cache write failed for project ${projectIdStr}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return context;
  }

  @CaptureSpan()
  public static async telemetryServiceFromName(data: {
    serviceName: string;
    projectId: ObjectID;
    resourceAttributes?: JSONArray | undefined;
  }): Promise<TelemetryServiceMetadata> {
    const result: TelemetryServiceMetadata =
      await this.findOrCreateTelemetryService({
        serviceName: data.serviceName,
        projectId: data.projectId,
      });

    /*
     * Name-only sources (syslog / fluent) never go through
     * `resolveTelemetryResource`, so its extractor never registers this
     * service. Reconcile the single Service entity here, under the same
     * fence/throttle machinery. OTLP batches (resourceAttributes present)
     * reconcile their full entity set — including the service.namespace
     * identity this name-only path cannot see — in
     * `resolveTelemetryResource` instead. Fire-and-forget: all errors are
     * swallowed inside, so the registry can never break ingest.
     */
    if (!data.resourceAttributes) {
      const serviceEntity: ExtractedEntity = {
        entityType: EntityType.Service,
        entityKey: keyForService(data.projectId.toString(), data.serviceName),
        identifyingAttributes: {
          "service.name": canonicalizeEntityValue(data.serviceName),
        },
      };
      void reconcileEntityRegistryThrottled({
        projectId: data.projectId,
        entities: [serviceEntity],
      });
    }

    /*
     * Touch `lastSeenAt` on the service. Throttled per-service inside
     * ServiceService.updateLastSeen so the steady-state firehose costs
     * one in-memory cache lookup per batch.
     */
    try {
      await ServiceService.updateLastSeen(
        result.primaryEntityId,
        this.buildServiceMetadataFromAttributes(data.resourceAttributes),
      );
    } catch (err) {
      logger.warn(
        `telemetryServiceFromName lastSeen update failed for "${data.serviceName}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    /*
     * Promote `oneuptime.label.<dim>=<val>` resource attributes into
     * project labels and attach them to the discovered service. The
     * attach is throttled per-service so steady-state ingest with
     * unchanged labels costs one in-memory cache lookup.
     */
    if (data.resourceAttributes) {
      try {
        const labelNames: Array<string> = extractOneuptimeLabelNames(
          data.resourceAttributes,
        );
        if (labelNames.length > 0) {
          const labelIds: Array<ObjectID> =
            await LabelService.findOrCreateLabelsByNames({
              projectId: data.projectId,
              labelNames,
            });
          if (labelIds.length > 0) {
            await ServiceService.attachLabels({
              serviceId: result.primaryEntityId,
              labelIds,
            });
          }
        }
      } catch (err) {
        logger.warn(
          `telemetryServiceFromName label promotion failed for "${data.serviceName}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return result;
  }

  @CaptureSpan()
  private static async findOrCreateTelemetryService(data: {
    serviceName: string;
    projectId: ObjectID;
  }): Promise<TelemetryServiceMetadata> {
    /*
     * Sort by createdAt ASC for deterministic resolution if the
     * DB ever ends up with duplicates (defense in depth — the
     * unique index on (projectId, name) added in
     * DedupeServicesAndAddUniqueIndex1778100000000 prevents new
     * ones from forming, and converts concurrent first-contact
     * inserts into unique-violation errors that the catch block
     * below resolves to the winning row).
     */
    /*
     * Case-insensitive lookup (findWithSameText) to match the unique
     * guard's comparison — otherwise a service.name that drifts only in
     * case or surrounding whitespace misses here, gets rejected on create
     * ("Service with the same name already exists"), and wedges ingest.
     * Stored casing is preserved: service-detail pages key telemetry by the
     * stable primaryEntityId, and the name is user-facing.
     */
    const service: Service | null = await ServiceService.findOneBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(data.serviceName),
      },
      select: {
        _id: true,
        retainTelemetryDataForDays: true,
        telemetryRetentionConfig: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    const projectContext: ProjectRetentionContext =
      await this.getProjectRetentionContext(data.projectId);

    /*
     * The service's own membership key (pure hash, no DB round trip), so
     * name-only sources (syslog / fluent) stamp a queryable `entityKeys`
     * instead of []. The OTLP path overwrites this with the full extracted
     * entity set in `resolveTelemetryResource`.
     */
    const serviceEntityKey: string = keyForService(
      data.projectId.toString(),
      data.serviceName,
    );

    const buildMetadata: (svc: Service) => TelemetryServiceMetadata = (
      svc: Service,
    ): TelemetryServiceMetadata => {
      const serviceLevelRetention: number | null =
        svc.retainTelemetryDataForDays ?? null;
      return {
        serviceName: data.serviceName,
        primaryEntityId: svc.id!,
        primaryEntityType: ServiceType.OpenTelemetry,
        entityKeys: [serviceEntityKey],
        dataRententionInDays:
          serviceLevelRetention || projectContext.projectRetentionInDays,
        serviceRetentionConfig: svc.telemetryRetentionConfig ?? null,
        serviceRetentionInDays: serviceLevelRetention,
        projectRetentionConfig: projectContext.projectRetentionConfig,
        projectRetentionInDays: projectContext.projectRetentionInDays,
      };
    };

    if (!service) {
      try {
        const newService: Service = new Service();
        newService.projectId = data.projectId;
        newService.name = data.serviceName;
        newService.description = data.serviceName;

        const createdService: Service = await ServiceService.create({
          data: newService,
          props: {
            isRoot: true,
          },
        });

        return buildMetadata(createdService);
      } catch {
        /*
         * Race condition: another request created the service concurrently.
         * Re-fetch the existing service (oldest wins, see sort above).
         */
        const existingService: Service | null = await ServiceService.findOneBy({
          query: {
            projectId: data.projectId,
            name: QueryHelper.findWithSameText(data.serviceName),
          },
          select: {
            _id: true,
            retainTelemetryDataForDays: true,
            telemetryRetentionConfig: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });

        if (existingService) {
          return buildMetadata(existingService);
        }

        throw new Error(
          "Failed to create or find service: " + data.serviceName,
        );
      }
    }

    return buildMetadata(service);
  }

  /*
   * Builds a TelemetryServiceMetadata for a non-Service resource —
   * Host, DockerHost, KubernetesCluster, Monitor. These resources
   * own telemetry directly via their own Postgres id (stamped into
   * the analytics row's `primaryEntityId` column) and do not have a paired
   * Service row. Per-resource retention overrides (when set on the
   * Host / DockerHost / KubernetesCluster row) are honoured here so
   * the resource owner can keep host telemetry longer/shorter than
   * the project default. Monitor / unknown resource types fall back
   * to the project retention.
   */
  @CaptureSpan()
  public static async buildResourceMetadataForNonService(data: {
    serviceName: string;
    resourceId: ObjectID;
    primaryEntityType: ServiceType;
    projectId: ObjectID;
  }): Promise<TelemetryServiceMetadata> {
    const projectContext: ProjectRetentionContext =
      await this.getProjectRetentionContext(data.projectId);

    const resourceRetention: {
      retainTelemetryDataForDays: number | null;
      telemetryRetentionConfig: TelemetryRetentionConfig | null;
    } = await this.getResourceRetention(
      data.resourceId,
      data.primaryEntityType,
    );

    return {
      serviceName: data.serviceName,
      primaryEntityId: data.resourceId,
      primaryEntityType: data.primaryEntityType,
      dataRententionInDays:
        resourceRetention.retainTelemetryDataForDays ||
        projectContext.projectRetentionInDays,
      serviceRetentionConfig: resourceRetention.telemetryRetentionConfig,
      serviceRetentionInDays: resourceRetention.retainTelemetryDataForDays,
      projectRetentionConfig: projectContext.projectRetentionConfig,
      projectRetentionInDays: projectContext.projectRetentionInDays,
    };
  }

  /*
   * Look up per-resource retention overrides for non-Service telemetry.
   * One small SELECT per batch — the caller caches the resulting
   * TelemetryServiceMetadata under `serviceDictionary[serviceName]`
   * so steady-state ingest skips this lookup after the first row.
   */
  @CaptureSpan()
  private static async getResourceRetention(
    resourceId: ObjectID,
    primaryEntityType: ServiceType,
  ): Promise<{
    retainTelemetryDataForDays: number | null;
    telemetryRetentionConfig: TelemetryRetentionConfig | null;
  }> {
    try {
      if (primaryEntityType === ServiceType.Host) {
        const host: Host | null = await HostService.findOneById({
          id: resourceId,
          select: {
            retainTelemetryDataForDays: true,
            telemetryRetentionConfig: true,
          },
          props: { isRoot: true },
        });
        return {
          retainTelemetryDataForDays: host?.retainTelemetryDataForDays ?? null,
          telemetryRetentionConfig: host?.telemetryRetentionConfig ?? null,
        };
      }
      if (primaryEntityType === ServiceType.DockerHost) {
        const dockerHost: DockerHost | null =
          await DockerHostService.findOneById({
            id: resourceId,
            select: {
              retainTelemetryDataForDays: true,
              telemetryRetentionConfig: true,
            },
            props: { isRoot: true },
          });
        return {
          retainTelemetryDataForDays:
            dockerHost?.retainTelemetryDataForDays ?? null,
          telemetryRetentionConfig:
            dockerHost?.telemetryRetentionConfig ?? null,
        };
      }
      if (primaryEntityType === ServiceType.KubernetesCluster) {
        const cluster: KubernetesCluster | null =
          await KubernetesClusterService.findOneById({
            id: resourceId,
            select: {
              retainTelemetryDataForDays: true,
              telemetryRetentionConfig: true,
            },
            props: { isRoot: true },
          });
        return {
          retainTelemetryDataForDays:
            cluster?.retainTelemetryDataForDays ?? null,
          telemetryRetentionConfig: cluster?.telemetryRetentionConfig ?? null,
        };
      }
      if (primaryEntityType === ServiceType.ServerlessFunction) {
        const serverlessFunction: ServerlessFunction | null =
          await ServerlessFunctionService.findOneById({
            id: resourceId,
            select: {
              retainTelemetryDataForDays: true,
              telemetryRetentionConfig: true,
            },
            props: { isRoot: true },
          });
        return {
          retainTelemetryDataForDays:
            serverlessFunction?.retainTelemetryDataForDays ?? null,
          telemetryRetentionConfig:
            serverlessFunction?.telemetryRetentionConfig ?? null,
        };
      }
      if (primaryEntityType === ServiceType.CloudResource) {
        const cloudResource: CloudResource | null =
          await CloudResourceService.findOneById({
            id: resourceId,
            select: {
              retainTelemetryDataForDays: true,
              telemetryRetentionConfig: true,
            },
            props: { isRoot: true },
          });
        return {
          retainTelemetryDataForDays:
            cloudResource?.retainTelemetryDataForDays ?? null,
          telemetryRetentionConfig:
            cloudResource?.telemetryRetentionConfig ?? null,
        };
      }
      if (primaryEntityType === ServiceType.RealUserMonitor) {
        const rumApplication: RumApplication | null =
          await RumApplicationService.findOneById({
            id: resourceId,
            select: {
              retainTelemetryDataForDays: true,
              telemetryRetentionConfig: true,
            },
            props: { isRoot: true },
          });
        return {
          retainTelemetryDataForDays:
            rumApplication?.retainTelemetryDataForDays ?? null,
          telemetryRetentionConfig:
            rumApplication?.telemetryRetentionConfig ?? null,
        };
      }
    } catch (err) {
      logger.warn(
        `Per-resource retention lookup failed for ${primaryEntityType} ${resourceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return {
      retainTelemetryDataForDays: null,
      telemetryRetentionConfig: null,
    };
  }

  @CaptureSpan()
  public static getMetricFromDatapoint(data: {
    dbMetric: Metric;
    datapoint: JSONObject;
    aggregationTemporality: OtelAggregationTemporality;
    isMonotonic: boolean | undefined;
    primaryEntityId: ObjectID;
    serviceName: string;
  }): Metric {
    const { dbMetric, datapoint, aggregationTemporality, isMonotonic } = data;

    const newDbMetric: Metric = Metric.fromJSON(
      dbMetric.toJSON(),
      Metric,
    ) as Metric;

    // Handle start timestamp safely
    if (datapoint["startTimeUnixNano"]) {
      try {
        let startTimeUnixNano: number;
        if (typeof datapoint["startTimeUnixNano"] === "string") {
          startTimeUnixNano = parseFloat(datapoint["startTimeUnixNano"]);
          if (isNaN(startTimeUnixNano)) {
            startTimeUnixNano = OneUptimeDate.getCurrentDateAsUnixNano();
          }
        } else {
          startTimeUnixNano =
            (datapoint["startTimeUnixNano"] as number) ||
            OneUptimeDate.getCurrentDateAsUnixNano();
        }
        newDbMetric.startTimeUnixNano = startTimeUnixNano;
        newDbMetric.startTime = OneUptimeDate.fromUnixNano(startTimeUnixNano);
      } catch {
        const currentNano: number = OneUptimeDate.getCurrentDateAsUnixNano();
        newDbMetric.startTimeUnixNano = currentNano;
        newDbMetric.startTime = OneUptimeDate.getCurrentDate();
      }
    }

    // Handle end timestamp safely
    if (datapoint["timeUnixNano"]) {
      try {
        let timeUnixNano: number;
        if (typeof datapoint["timeUnixNano"] === "string") {
          timeUnixNano = parseFloat(datapoint["timeUnixNano"]);
          if (isNaN(timeUnixNano)) {
            timeUnixNano = OneUptimeDate.getCurrentDateAsUnixNano();
          }
        } else {
          timeUnixNano =
            (datapoint["timeUnixNano"] as number) ||
            OneUptimeDate.getCurrentDateAsUnixNano();
        }
        newDbMetric.timeUnixNano = timeUnixNano;
        newDbMetric.time = OneUptimeDate.fromUnixNano(timeUnixNano);
      } catch {
        const currentNano: number = OneUptimeDate.getCurrentDateAsUnixNano();
        newDbMetric.timeUnixNano = currentNano;
        newDbMetric.time = OneUptimeDate.getCurrentDate();
      }
    }

    if (Object.keys(datapoint).includes("asInt")) {
      newDbMetric.value = datapoint["asInt"] as number;
    } else if (Object.keys(datapoint).includes("asDouble")) {
      newDbMetric.value = datapoint["asDouble"] as number;
    }

    newDbMetric.count = datapoint["count"] as number;
    newDbMetric.sum = datapoint["sum"] as number;

    newDbMetric.min = datapoint["min"] as number;
    newDbMetric.max = datapoint["max"] as number;

    newDbMetric.bucketCounts = datapoint["bucketCounts"] as Array<number>;
    newDbMetric.explicitBounds = datapoint["explicitBounds"] as Array<number>;

    if (!newDbMetric.value) {
      newDbMetric.value = newDbMetric.sum;
    }

    // attrbutes

    if (Object.keys(datapoint).includes("attributes")) {
      if (!newDbMetric.attributes) {
        newDbMetric.attributes = {};
      }

      newDbMetric.attributes = {
        ...TelemetryUtil.getAttributesForServiceIdAndServiceName({
          serviceId: data.primaryEntityId,
          serviceName: data.serviceName,
        }),
        ...TelemetryUtil.getAttributes({
          items: (datapoint["attributes"] as JSONArray) || [],
          prefixKeysWithString: "",
        }),
      };
    }

    newDbMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
      newDbMetric.attributes,
    );

    // aggregationTemporality

    if (aggregationTemporality) {
      if (aggregationTemporality === OtelAggregationTemporality.Cumulative) {
        newDbMetric.aggregationTemporality = AggregationTemporality.Cumulative;
      }

      if (aggregationTemporality === OtelAggregationTemporality.Delta) {
        newDbMetric.aggregationTemporality = AggregationTemporality.Delta;
      }
    }

    if (isMonotonic !== undefined) {
      newDbMetric.isMonotonic = isMonotonic;
    }

    return newDbMetric;
  }
}
