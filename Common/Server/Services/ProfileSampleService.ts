import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ProfileSample from "../../Models/AnalyticsModels/ProfileSample";

export class ProfileSampleService extends AnalyticsDatabaseService<ProfileSample> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ProfileSample, database: clickhouseDatabase });
  }
}

export default new ProfileSampleService();
