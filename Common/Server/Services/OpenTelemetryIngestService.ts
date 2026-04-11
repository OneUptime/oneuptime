import OneUptimeDate from "../../Types/Date";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Metric, {
  AggregationTemporality,
} from "../../Models/AnalyticsModels/Metric";
import Service from "../../Models/DatabaseModels/Service";
import ServiceService from "../../Server/Services/ServiceService";
import { DEFAULT_RETENTION_IN_DAYS } from "../../Models/DatabaseModels/TelemetryUsageBilling";
import TelemetryUtil from "../../Server/Utils/Telemetry/Telemetry";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import QueryHelper from "../Types/Database/QueryHelper";
import Sleep from "../../Types/Sleep";

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
  public static async telemetryServiceFromName(data: {
    serviceName: string;
    projectId: ObjectID;
  }): Promise<{
    serviceId: ObjectID;
    dataRententionInDays: number;
  }> {
    /*
     * Case-insensitive + whitespace-trimmed match is used consistently in
     * both the initial lookup and the post-conflict re-fetch. The
     * `DatabaseService.checkUniqueColumnBy` pre-create hook rejects
     * duplicates with a LOWER(name) = LOWER(?) comparison, so a previous
     * worker may have inserted a row whose stored case differs from the
     * OTLP attribute we just received. An exact-match re-fetch would then
     * miss the existing row and the handler would throw "Failed to create
     * or find service", dropping the entire OTLP batch.
     */
    const nameMatcher: ReturnType<typeof QueryHelper.findWithSameText> =
      QueryHelper.findWithSameText(data.serviceName);

    const service: Service | null = await ServiceService.findOneBy({
      query: {
        projectId: data.projectId,
        name: nameMatcher,
      },
      select: {
        _id: true,
        retainTelemetryDataForDays: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (service) {
      return {
        serviceId: service.id!,
        dataRententionInDays:
          service.retainTelemetryDataForDays || DEFAULT_RETENTION_IN_DAYS,
      };
    }

    try {
      const newService: Service = new Service();
      newService.projectId = data.projectId;
      newService.name = data.serviceName;
      newService.description = data.serviceName;
      newService.retainTelemetryDataForDays = DEFAULT_RETENTION_IN_DAYS;

      const createdService: Service = await ServiceService.create({
        data: newService,
        props: {
          isRoot: true,
        },
      });

      return {
        serviceId: createdService.id!,
        dataRententionInDays: DEFAULT_RETENTION_IN_DAYS,
      };
    } catch {
      /*
       * Race condition: another worker created the same service between
       * our lookup and our create. Re-fetch with bounded retry to cover
       * the brief window where the winning worker's transaction is still
       * committing and its row is not yet visible to our session under
       * read-committed isolation. Total worst-case wait is ~375ms spread
       * across 5 attempts. If all retries fail, bubble the original
       * "Failed to create or find" error.
       */
      const maxAttempts: number = 5;
      const baseDelayMs: number = 25;

      for (let attempt: number = 0; attempt < maxAttempts; attempt++) {
        const existingService: Service | null = await ServiceService.findOneBy(
          {
            query: {
              projectId: data.projectId,
              name: nameMatcher,
            },
            select: {
              _id: true,
              retainTelemetryDataForDays: true,
            },
            props: {
              isRoot: true,
            },
          },
        );

        if (existingService) {
          return {
            serviceId: existingService.id!,
            dataRententionInDays:
              existingService.retainTelemetryDataForDays ||
              DEFAULT_RETENTION_IN_DAYS,
          };
        }

        // Exponential-ish backoff: 25ms, 50ms, 75ms, 100ms, 125ms
        await Sleep.sleep(baseDelayMs * (attempt + 1));
      }

      throw new Error(
        "Failed to create or find service: " + data.serviceName,
      );
    }
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
