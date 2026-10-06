import Metric from "../../../../Models/AnalyticsModels/Metric";
import Permission from "../../../../Types/Permission";

/*
 * Who may read metric data points: the Metric model's own read list (the
 * Telemetry Service Metrics permission, or a role that reads telemetry).
 * The AI tools that read metrics through aggregation SQL of their own ask
 * for this list, so they follow the model rather than a copy of its list
 * that can drift from it.
 */
export function getMetricReadPermissions(): Array<Permission> {
  return [...new Metric().getReadPermissions()];
}
