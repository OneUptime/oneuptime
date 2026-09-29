import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryQueueService, {
  LogsIngestJobData,
} from "./TelemetryQueueService";

// Export the interface for backward compatibility
export { LogsIngestJobData };

export default class LogsQueueService {
  public static async addLogIngestJob(req: TelemetryRequest): Promise<void> {
    return TelemetryQueueService.addLogIngestJob(req);
  }
}
