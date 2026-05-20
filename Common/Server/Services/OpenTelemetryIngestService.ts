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
import logger from "../Utils/Logger";
import TelemetryRetentionConfig from "../../Types/Telemetry/TelemetryRetentionConfig";
import ServiceType from "../../Types/Telemetry/ServiceType";
import Host from "../../Models/DatabaseModels/Host";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import HostService from "./HostService";
import DockerHostService from "./DockerHostService";
import KubernetesClusterService from "./KubernetesClusterService";

export enum OtelAggregationTemporality {
  Cumulative = "AGGREGATION_TEMPORALITY_CUMULATIVE",
  Delta = "AGGREGATION_TEMPORALITY_DELTA",
}

export interface TelemetryServiceMetadata {
  serviceName: string;
  serviceId: ObjectID;
  /*
   * Discriminator stamped on every analytics row so the read side
   * knows which Postgres table the `serviceId` actually points at
   * (real Service, Host, DockerHost, KubernetesCluster, Monitor, …).
   * Defaults to OpenTelemetry for legacy ingest paths that go through
   * `telemetryServiceFromName`.
   */
  serviceType: ServiceType;
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

export default class OTelIngestService {
  @CaptureSpan()
  private static async getProjectRetentionContext(
    projectId: ObjectID,
  ): Promise<ProjectRetentionContext> {
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

    return {
      projectRetentionConfig: project?.telemetryRetentionConfig ?? null,
      projectRetentionInDays:
        project?.defaultTelemetryRetentionInDays || DEFAULT_RETENTION_IN_DAYS,
    };
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
     * Touch `lastSeenAt` on the service. Throttled per-service inside
     * ServiceService.updateLastSeen so the steady-state firehose costs
     * one in-memory cache lookup per batch.
     */
    try {
      await ServiceService.updateLastSeen(result.serviceId);
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
              serviceId: result.serviceId,
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
    const service: Service | null = await ServiceService.findOneBy({
      query: {
        projectId: data.projectId,
        name: data.serviceName,
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

    const buildMetadata: (svc: Service) => TelemetryServiceMetadata = (
      svc: Service,
    ): TelemetryServiceMetadata => {
      const serviceLevelRetention: number | null =
        svc.retainTelemetryDataForDays ?? null;
      return {
        serviceName: data.serviceName,
        serviceId: svc.id!,
        serviceType: ServiceType.OpenTelemetry,
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
            name: data.serviceName,
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
   * the analytics row's `serviceId` column) and do not have a paired
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
    serviceType: ServiceType;
    projectId: ObjectID;
  }): Promise<TelemetryServiceMetadata> {
    const projectContext: ProjectRetentionContext =
      await this.getProjectRetentionContext(data.projectId);

    const resourceRetention: {
      retainTelemetryDataForDays: number | null;
      telemetryRetentionConfig: TelemetryRetentionConfig | null;
    } = await this.getResourceRetention(data.resourceId, data.serviceType);

    return {
      serviceName: data.serviceName,
      serviceId: data.resourceId,
      serviceType: data.serviceType,
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
    serviceType: ServiceType,
  ): Promise<{
    retainTelemetryDataForDays: number | null;
    telemetryRetentionConfig: TelemetryRetentionConfig | null;
  }> {
    try {
      if (serviceType === ServiceType.Host) {
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
      if (serviceType === ServiceType.DockerHost) {
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
      if (serviceType === ServiceType.KubernetesCluster) {
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
    } catch (err) {
      logger.warn(
        `Per-resource retention lookup failed for ${serviceType} ${resourceId.toString()}: ${
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
    serviceId: ObjectID;
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
          serviceId: data.serviceId,
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
