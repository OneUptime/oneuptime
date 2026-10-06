import Metric from "../../../Models/AnalyticsModels/Metric";
import Permission from "../../../Types/Permission";

/*
 * Who may read metric data points: the Metric model's own read list (the
 * Telemetry Service Metrics permission, or a role that reads telemetry).
 * The /telemetry/metrics/* routes and the AI tools that read metrics
 * through aggregation SQL of their own ask for this list, so they follow
 * the model rather than a copy of its list that can drift from it.
 *
 * Read from the model once, on first use (not at import, so a module that
 * imports this one never builds the model while the models are still
 * loading), and handed out as a copy so no caller can change it for the
 * others.
 */
let metricReadPermissions: Array<Permission> | undefined;

export function getMetricReadPermissions(): Array<Permission> {
  if (!metricReadPermissions) {
    metricReadPermissions = [...new Metric().getReadPermissions()];
  }

  return [...metricReadPermissions];
}
