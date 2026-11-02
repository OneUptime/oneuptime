import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Profile from "../../Models/AnalyticsModels/Profile";
import TelemetryRowRetention from "../Utils/Telemetry/TelemetryRowRetention";

export class ProfileService extends AnalyticsDatabaseService<Profile> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Profile, database: clickhouseDatabase });
  }

  // Its resource's retention for profiles, as on ingest.
  protected override async getRetentionDateOnCreate(
    profile: Profile,
  ): Promise<Date | null> {
    return await TelemetryRowRetention.getRetentionDate({
      row: profile,
      pillar: "profiles",
    });
  }
}

export default new ProfileService();
