import OneUptimeDate from "../../Types/Date";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Metric, {
  AggregationTemporality,
} from "../../Models/AnalyticsModels/Metric";
import Dictionary from "../../Types/Dictionary";
import ProductType from "../../Types/MeteredPlan/ProductType";
import { IsBillingEnabled } from "../../Server/EnvironmentConfig";
import TelemetryUsageBillingService from "../../Server/Services/TelemetryUsageBillingService";
import logger from "../../Server/Utils/Logger";
import TelemetryService from "../../Models/DatabaseModels/TelemetryService";
import TelemetryServiceService from "../../Server/Services/TelemetryServiceService";
import { DEFAULT_RETENTION_IN_DAYS } from "../../Models/DatabaseModels/TelemetryUsageBilling";
import TelemetryUtil from "../../Server/Utils/Telemetry/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export enum OtelAggregationTemporality {
  Cumulative = "AGGREGATION_TEMPORALITY_CUMULATIVE",
  Delta = "AGGREGATION_TEMPORALITY_DELTA",
}

export interface TelemetryServiceDataIngested {
  serviceName: string;
  serviceId: ObjectID;
  dataIngestedInGB: number;
  dataRententionInDays: number;
}

export default class OTelIngestService {
  @CaptureSpan()
  public static async telemetryServiceFromName(data: {
    serviceName: string;
    projectId: ObjectID;
  }): Promise<{
    serviceId: ObjectID;
    dataRententionInDays: number;
  }> {
    const service: TelemetryService | null =
      await TelemetryServiceService.findOneBy({
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
      // create service

      const newService: TelemetryService = new TelemetryService();
      newService.projectId = data.projectId;
      newService.name = data.serviceName;
      newService.description = data.serviceName;
      newService.retainTelemetryDataForDays = DEFAULT_RETENTION_IN_DAYS;

      const createdService: TelemetryService =
        await TelemetryServiceService.create({
          data: newService,
          props: {
            isRoot: true,
          },
        });

      return {
        serviceId: createdService.id!,
        dataRententionInDays: DEFAULT_RETENTION_IN_DAYS,
      };
    }

    return {
      serviceId: service.id!,
      dataRententionInDays:
        service.retainTelemetryDataForDays || DEFAULT_RETENTION_IN_DAYS,
    };
  }

  @CaptureSpan()
  public static async recordDataIngestedUsgaeBilling(data: {
    services: Dictionary<TelemetryServiceDataIngested>;
    projectId: ObjectID;
    productType: ProductType;
  }): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    for (const serviceName in data.services) {
      const serviceData: TelemetryServiceDataIngested | undefined =
        data.services[serviceName];

      if (!serviceData) {
        continue;
      }

      TelemetryUsageBillingService.updateUsageBilling({
        projectId: data.projectId,
        productType: data.productType,
        dataIngestedInGB: serviceData.dataIngestedInGB || 0,
        telemetryServiceId: serviceData.serviceId,
        retentionInDays: serviceData.dataRententionInDays,
      }).catch((err: Error) => {
        logger.error("Failed to update usage billing for OTel");
        logger.error(err);
      });
    }
  }

  @CaptureSpan()
  public static getMetricFromDatapoint(data: {
    dbMetric: Metric;
    datapoint: JSONObject;
    aggregationTemporality: OtelAggregationTemporality;
    isMonotonic: boolean | undefined;
    telemetryServiceId: ObjectID;
    telemetryServiceName: string;
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
          serviceId: data.telemetryServiceId,
          serviceName: data.telemetryServiceName,
        }),
        ...TelemetryUtil.getAttributes({
          items: (datapoint["attributes"] as JSONArray) || [],
          prefixKeysWithString: "metricAttributes",
        }),
      };
    }

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
