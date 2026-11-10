import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import RumProductAnalyticsEvent from "../../Models/AnalyticsModels/RumProductAnalyticsEvent";

/*
 * The product analytics events table (issue #6444, part two). Created by
 * boot schema-sync; written by the product analytics ingest worker; read by
 * Utils/RumProductAnalytics/RumProductAnalyticsEventReadService, and pruned
 * by the session erasure job.
 */
export class RumProductAnalyticsEventService extends AnalyticsDatabaseService<RumProductAnalyticsEvent> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: RumProductAnalyticsEvent,
      database: clickhouseDatabase,
    });
  }
}

export default new RumProductAnalyticsEventService();
