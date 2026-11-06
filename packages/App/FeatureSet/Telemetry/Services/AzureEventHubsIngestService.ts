import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import {
  AzureStreamContext,
  AzureStreamDelivered,
} from "Common/Server/Utils/CloudConnection/CloudStreamReader";
import { KafkaRecord } from "Common/Server/Utils/CloudConnection/Kafka/KafkaProtocol";
import { JSONArray } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  AzureDiagnosticDecoded,
  decodeAzureDiagnosticEvents,
} from "../Utils/AzureEventHubs/AzureDiagnosticRecords";
import AwsFirehoseIngestService, {
  MAX_DATAPOINTS_PER_JOB,
  MAX_LOG_RECORDS_PER_JOB,
} from "./AwsFirehoseIngestService";
import LogsQueueService from "./Queue/LogsQueueService";
import MetricsQueueService from "./Queue/MetricsQueueService";

/*
 * AN AZURE CONNECTION'S EVENTS, READ FROM ITS EVENT HUBS, INTO THE
 * TELEMETRY QUEUE.
 *
 * CloudStreamReader reads a connection's event hubs and hands each fetch's
 * events here (deliver): decoded (AzureDiagnosticRecords) against what the
 * connection's reads hold - its resources, its key metrics - and queued as
 * OTLP metrics and logs of the connection's project, in jobs of at most
 * MAX_DATAPOINTS_PER_JOB datapoints and MAX_LOG_RECORDS_PER_JOB log records,
 * exactly as an OTLP export is: drop filters, scrub rules, pipelines,
 * retention, billing and finding each datapoint's cloud resource apply to
 * them as to any other telemetry. It resolves once every job is queued, so
 * the reader moves the event hub's offset past them only then; a queue
 * that cannot take them throws, and the events are read again next minute.
 */

export const AZURE_EVENT_HUBS_PATH: string = "/azure-event-hubs";

export default class AzureEventHubsIngestService {
  public static async deliver(data: {
    context: AzureStreamContext;
    namespaceRegion: string;
    records: Array<KafkaRecord>;
  }): Promise<AzureStreamDelivered> {
    // Taken and dropped, as every ingest path does with ingestion off.
    if (TelemetryIngestionDisabled.isDisabled()) {
      return { sightings: [] };
    }

    const decoded: AzureDiagnosticDecoded = decodeAzureDiagnosticEvents({
      records: data.records,
      context: data.context,
      namespaceRegion: data.namespaceRegion,
      observedAtMs: Date.now(),
    });

    for (const resourceMetrics of AwsFirehoseIngestService.chunk(
      decoded.resourceMetrics,
      MAX_DATAPOINTS_PER_JOB,
    )) {
      const job: Partial<TelemetryRequest> = {
        body: { resourceMetrics: resourceMetrics as unknown as JSONArray },
        headers: {},
        projectId: data.context.projectId,
        productType: ProductType.Metrics,
        path: AZURE_EVENT_HUBS_PATH,
        url: AZURE_EVENT_HUBS_PATH,
      };

      await MetricsQueueService.addMetricIngestJob(job as TelemetryRequest);
    }

    for (const resourceLogs of AwsFirehoseIngestService.chunk(
      decoded.resourceLogs,
      MAX_LOG_RECORDS_PER_JOB,
    )) {
      const job: Partial<TelemetryRequest> = {
        body: { resourceLogs: resourceLogs as unknown as JSONArray },
        headers: {},
        projectId: data.context.projectId,
        productType: ProductType.Logs,
        path: AZURE_EVENT_HUBS_PATH,
        url: AZURE_EVENT_HUBS_PATH,
      };

      await LogsQueueService.addLogIngestJob(job as TelemetryRequest);
    }

    return { sightings: decoded.sightings };
  }
}
