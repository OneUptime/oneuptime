import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryQueueService, {
  ProfilesIngestJobData,
} from "./TelemetryQueueService";

// Export the interface for backward compatibility
export { ProfilesIngestJobData };

export default class ProfilesQueueService {
  public static async addProfileIngestJob(
    req: TelemetryRequest,
  ): Promise<void> {
    return TelemetryQueueService.addProfileIngestJob(req);
  }
}
