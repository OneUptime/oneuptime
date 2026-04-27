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
import { DEFAULT_RETENTION_IN_DAYS } from "../../Models/DatabaseModels/TelemetryUsageBilling";
import TelemetryUtil from "../../Server/Utils/Telemetry/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export enum OtelAggregationTemporality {
  Cumulative = "AGGREGATION_TEMPORALITY_CUMULATIVE",
  Delta = "AGGREGATION_TEMPORALITY_DELTA",
}

export interface TelemetryServiceMetadata {
  serviceName: string;
  serviceId: ObjectID;
  dataRententionInDays: number;
}

export default class OTelIngestService {
  @CaptureSpan()
  private static async getProjectDefaultRetentionInDays(
    projectId: ObjectID,
  ): Promise<number> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        defaultTelemetryRetentionInDays: true,
      },
      props: {
        isRoot: true,
      },
    });

    return (
      project?.defaultTelemetryRetentionInDays || DEFAULT_RETENTION_IN_DAYS
    );
  }

  @CaptureSpan()
  public static async telemetryServiceFromName(data: {
    serviceName: string;
    projectId: ObjectID;
  }): Promise<{
    serviceId: ObjectID;
    dataRententionInDays: number;
  }> {
    const service: Service | null = await ServiceService.findOneBy({
      query: {
        projectId: data.projectId,
        name: data.serviceName,
      },
      select: {
        _id: true,
        retainTelemetryDataForDays: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!service) {
      const projectDefaultRetention: number =
        await this.getProjectDefaultRetentionInDays(data.projectId);

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

        return {
          serviceId: createdService.id!,
          dataRententionInDays: projectDefaultRetention,
        };
      } catch {
        /*
         * Race condition: another request created the service concurrently.
         * Re-fetch the existing service.
         */
        const existingService: Service | null = await ServiceService.findOneBy({
          query: {
            projectId: data.projectId,
            name: data.serviceName,
          },
          select: {
            _id: true,
            retainTelemetryDataForDays: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (existingService) {
          return {
            serviceId: existingService.id!,
            dataRententionInDays:
              existingService.retainTelemetryDataForDays ||
              projectDefaultRetention,
          };
        }

        throw new Error(
          "Failed to create or find service: " + data.serviceName,
        );
      }
    }

    if (service.retainTelemetryDataForDays) {
      return {
        serviceId: service.id!,
        dataRententionInDays: service.retainTelemetryDataForDays,
      };
    }

    return {
      serviceId: service.id!,
      dataRententionInDays: await this.getProjectDefaultRetentionInDays(
        data.projectId,
      ),
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
