import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryQueueService from "./TelemetryQueueService";

export default class SecurityEventsQueueService {
  public static async addSecurityEventsIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return TelemetryQueueService.addSecurityEventsIngestJob(req);
  }
}
