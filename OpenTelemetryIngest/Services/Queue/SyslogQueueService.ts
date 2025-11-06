import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryQueueService, {
  TelemetryType,
} from "./TelemetryQueueService";

export default class SyslogQueueService {
  public static async addSyslogIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return TelemetryQueueService.addTelemetryIngestJob(
      req,
      TelemetryType.Syslog,
    );
  }
}
