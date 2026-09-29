import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Profile from "../../Models/AnalyticsModels/Profile";

export class ProfileService extends AnalyticsDatabaseService<Profile> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Profile, database: clickhouseDatabase });
  }
}

export default new ProfileService();
