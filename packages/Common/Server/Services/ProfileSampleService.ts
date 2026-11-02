import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ProfileSample from "../../Models/AnalyticsModels/ProfileSample";
import TelemetryRowRetention from "../Utils/Telemetry/TelemetryRowRetention";

export class ProfileSampleService extends AnalyticsDatabaseService<ProfileSample> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ProfileSample, database: clickhouseDatabase });
  }

  // Its resource's retention for profiles, as on ingest.
  protected override async getRetentionDateOnCreate(
    sample: ProfileSample,
  ): Promise<Date | null> {
    return await TelemetryRowRetention.getRetentionDate({
      row: sample,
      pillar: "profiles",
    });
  }
}

export default new ProfileSampleService();
