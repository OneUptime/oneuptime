import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryQueueService from "./TelemetryQueueService";

export default class FluentLogsQueueService {
  public static async addFluentLogIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return TelemetryQueueService.addFluentLogIngestJob(req);
  }
}
