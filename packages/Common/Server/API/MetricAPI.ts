import Metric from "../../Models/AnalyticsModels/Metric";
import { MetricService } from "../Services/MetricService";
import BaseAnalyticsAPI from "./BaseAnalyticsAPI";

/*
 * Metric CRUD + aggregate endpoints. The 8-second project-scoped
 * aggregate cache that used to live here has been promoted to
 * `BaseAnalyticsAPI.getAggregate` so Log/Span/AuditLog/etc. benefit
 * from the same dashboard-widget-burst collapse without duplicating
 * the wrapper on every analytics API.
 */
export default class MetricAPI extends BaseAnalyticsAPI<Metric, MetricService> {
  public constructor(service: MetricService) {
    super(Metric, service);
  }
}
