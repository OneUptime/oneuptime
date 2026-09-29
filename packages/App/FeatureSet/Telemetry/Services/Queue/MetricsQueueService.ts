import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryQueueService, {
  MetricsIngestJobData,
} from "./TelemetryQueueService";

// Export the interface for backward compatibility
export { MetricsIngestJobData };

export default class MetricsQueueService {
  public static async addMetricIngestJob(req: TelemetryRequest): Promise<void> {
    return TelemetryQueueService.addMetricIngestJob(req);
  }
}
