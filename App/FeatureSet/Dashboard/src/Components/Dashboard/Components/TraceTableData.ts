import { JSONObject } from "Common/Types/JSON";
import DashboardTraceTableComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTraceTableComponent";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import {
  TraceAttributeFilters,
  computeBucketSizeInMinutes,
  formatCount,
  formatDurationMs,
  resolveTraceAttributeFilters,
} from "./TraceChartData";

/*
 * Pure, React-free data helpers for the trace table widget. Kept out of the
 * .tsx so the request-building logic — the core of "does the table query the
 * right thing" — can be unit-tested in the node test environment. The
 * formatting + filter-parsing helpers are shared with the trace chart widget
 * (TraceChartData) so the two stay byte-for-byte consistent.
 */

export type TraceTableArguments = DashboardTraceTableComponent["arguments"];

/*
 * One aggregated row from POST /telemetry/traces/analytics with
 * chartType="table". The backend always returns the full duration stat set
 * (see TraceAggregationService.getAnalyticsTable), so a single query answers
 * "requests and median response time per dimension".
 */
export interface TraceTableRow {
  groupValues: Record<string, string>;
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

export { formatCount, formatDurationMs };

export interface BuildTraceTableRequestParams {
  arguments: TraceTableArguments;
  startTime: Date;
  endTime: Date;
  variables?: Array<DashboardVariable> | undefined;
}

/*
 * Build the POST body for /telemetry/traces/analytics (chartType="table")
 * from the widget's stored arguments. The group-by dimension is required for
 * a table — the caller guards against an unset value before reaching here, so
 * this still emits it defensively when present.
 */
export function buildTraceTableRequest(
  params: BuildTraceTableRequestParams,
): JSONObject {
  const args: TraceTableArguments = params.arguments;

  const requestData: JSONObject = {
    startTime: params.startTime.toISOString(),
    endTime: params.endTime.toISOString(),
    bucketSizeInMinutes: computeBucketSizeInMinutes(
      params.startTime,
      params.endTime,
    ),
    chartType: "table",
    /*
     * Dashboard form arguments may arrive as strings — coerce so the
     * server-side numeric check doesn't silently fall back to 10.
     */
    limit: Number(args.topLimit) || 10,
    /*
     * Root spans only by default, matching the traces explorer the user
     * compares against. Including child spans flips it off.
     */
    rootOnly: !args.includeChildSpans,
  };

  const spanNameContains: string | undefined =
    args.spanNameContains?.trim() || undefined;
  if (spanNameContains) {
    requestData["spanNameSearches"] = [spanNameContains];
  }

  const attributes: TraceAttributeFilters = resolveTraceAttributeFilters({
    attributeFilters: args.attributeFilters,
    variables: params.variables,
  });
  if (Object.keys(attributes).length > 0) {
    requestData["attributes"] = attributes;
  }

  const groupByAttribute: string | undefined =
    args.groupByAttribute?.trim() || undefined;
  if (groupByAttribute) {
    requestData["groupBy"] = [groupByAttribute];
  }

  return requestData;
}

/*
 * Friendly labels for the built-in top-level dimensions a row can group by.
 * The resource dimensions below are not offered by the widget's own split
 * picker (TraceChartQueryEditor deliberately omits opaque ids) — they arrive
 * from dashboard templates, which use them because grouping by one also
 * constrains the query to that resource type server-side. Their VALUES are
 * resolved to display names by TraceAggregationService; only the column
 * header is named here.
 */
const DIMENSION_LABELS: Record<string, string> = {
  name: "Span Name",
  statusCode: "Status Code",
  kind: "Span Kind",
  primaryEntityId: "Service",
  rumApplicationId: "Application",
  hostId: "Host",
  dockerHostId: "Docker Host",
  podmanHostId: "Podman Host",
  kubernetesClusterId: "Kubernetes Cluster",
  proxmoxClusterId: "Proxmox Cluster",
  cephClusterId: "Ceph Cluster",
  serverlessFunctionId: "Serverless Function",
  cloudResourceId: "Cloud Resource",
};

export function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] || key;
}

const STATUS_LABELS: Record<string, string> = {
  "0": "Unset",
  "1": "Ok",
  "2": "Error",
};

const KIND_LABELS: Record<string, string> = {
  "0": "Unspecified",
  "1": "Internal",
  "2": "Server",
  "3": "Client",
  "4": "Producer",
  "5": "Consumer",
};

/*
 * Render a grouped dimension value for display. statusCode/kind come back as
 * the raw OTel enum, so map them to readable names; everything else is shown
 * verbatim (an empty value becomes "(empty)").
 */
export function displayGroupValue(key: string, raw: string): string {
  if (!raw) {
    return "(empty)";
  }
  if (key === "statusCode") {
    return STATUS_LABELS[raw] || raw;
  }
  if (key === "kind") {
    return KIND_LABELS[raw] || raw;
  }
  return raw;
}
