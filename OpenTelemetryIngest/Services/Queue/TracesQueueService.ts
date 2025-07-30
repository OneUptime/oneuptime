import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryQueueService, {
  TracesIngestJobData,
} from "./TelemetryQueueService";

// Export the interface for backward compatibility
export { TracesIngestJobData };

export default class TracesQueueService {
  public static async addTraceIngestJob(req: TelemetryRequest): Promise<void> {
    return TelemetryQueueService.addTraceIngestJob(req);
  }
}
