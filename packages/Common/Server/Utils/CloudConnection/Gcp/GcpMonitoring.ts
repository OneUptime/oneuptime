import Dictionary from "../../../../Types/Dictionary";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import GoogleMonitoringClient, {
  GOOGLE_MONITORING_BASE_URL,
  GOOGLE_MONITORING_READ_SCOPE,
} from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleMonitoringClient";
import GoogleServiceAccountToken from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";

/*
 * Google Cloud Monitoring's timeSeries.list, the one call a Google Cloud
 * connection makes, signed in as a service account with the Monitoring
 * Viewer role (a JSON key exchanged for an access token,
 * GoogleServiceAccountToken):
 *
 *   GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries
 *       ?filter=metric.type="..."&interval.startTime=&interval.endTime=
 *       &aggregation.alignmentPeriod=60s&aggregation.perSeriesAligner=ALIGN_MEAN
 *   -> { timeSeries: [{ metric: { type, labels }, resource: { type, labels },
 *        metadata: { systemLabels, userLabels }, points: [{ interval,
 *        value: { doubleValue | int64Value | distributionValue } }] }],
 *        nextPageToken }
 *
 * A call can also name metric labels (metric.labels.state="used"), and a
 * distribution kept whole by its aligner is read for its count.
 *
 * One call returns a metric for every resource of the project. Cloud
 * Monitoring charges reads by the time series they return, past a million a
 * month per billing account.
 */

const PROVIDER_TITLE: string = "Google Cloud Monitoring";
const PAGE_SIZE: number = 10000;
const MAX_PAGES: number = 20;

export interface GcpTimeSeries {
  metricType: string;
  metricLabels: Dictionary<string>;
  resourceType: string;
  resourceLabels: Dictionary<string>;
  // What Cloud Monitoring calls the resource, when its metadata says (a VM's name).
  metadataName: string;
  points: Array<{ timeMs: number; value: number }>;
}

export interface GcpMonitoringOptions {
  serviceAccountJson: string;
  transport: CloudConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  budget?: CloudReadBudget | undefined;
}

function readLabels(raw: unknown): Dictionary<string> {
  const labels: Dictionary<string> = {};
  const object: JSONObject = readObject(raw);

  for (const key of Object.keys(object)) {
    const value: unknown = object[key];

    if (typeof value === "string") {
      labels[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      labels[key] = String(value);
    }
  }

  return labels;
}

export default class GcpMonitoring {
  private options: GcpMonitoringOptions;
  private token: GoogleServiceAccountToken;

  public constructor(options: GcpMonitoringOptions) {
    this.options = options;
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: options.serviceAccountJson,
      scope: GOOGLE_MONITORING_READ_SCOPE,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  public getClientEmail(): string {
    return this.token.getClientEmail();
  }

  /*
   * The filter of a call: the metric type, and each metric label it is
   * read with (an Ops Agent's memory in its "used" state), in name order.
   * Values come from the catalog, never from what a person typed.
   */
  public static buildFilter(data: {
    metricType: string;
    metricLabels?: Readonly<Record<string, string>> | undefined;
    /*
     * An added metric's (CloudAddedMetrics): only the series of resources of
     * this type, and of the one resource these labels identify. Checked
     * when the metric is added (validateCloudAddedMetric): no quote or
     * backslash can reach the filter.
     */
    resourceType?: string | undefined;
    resourceLabels?: Readonly<Record<string, string>> | undefined;
  }): string {
    const parts: Array<string> = [`metric.type="${data.metricType}"`];

    for (const name of Object.keys(data.metricLabels || {}).sort()) {
      parts.push(`metric.labels.${name}="${data.metricLabels![name]}"`);
    }

    if (data.resourceType) {
      parts.push(`resource.type="${data.resourceType}"`);
    }

    for (const name of Object.keys(data.resourceLabels || {}).sort()) {
      parts.push(`resource.labels.${name}="${data.resourceLabels![name]}"`);
    }

    return parts.join(" AND ");
  }

  /*
   * A metric of every resource of a project over [start, end), aligned to
   * one point a period. A metric type the project has never had answers
   * with nothing, not an error. `readAs: "count"` reads how many values
   * each point's distribution holds, for an aligner that keeps a
   * distribution (ALIGN_SUM).
   */
  public async listTimeSeries(data: {
    projectId: string;
    metricType: string;
    aligner: string;
    alignmentPeriodSeconds: number;
    start: Date;
    end: Date;
    metricLabels?: Readonly<Record<string, string>> | undefined;
    readAs?: "count" | undefined;
    firstPageOnly?: boolean | undefined;
    resourceType?: string | undefined;
    resourceLabels?: Readonly<Record<string, string>> | undefined;
  }): Promise<Array<GcpTimeSeries>> {
    GoogleMonitoringClient.validateProjectId(data.projectId);

    const series: Array<GcpTimeSeries> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < MAX_PAGES; page++) {
      if (this.options.budget && !this.options.budget.take()) {
        throw new CloudReadBudgetSpent();
      }

      const accessToken: string = await this.token.getAccessToken();
      const query: string = buildQueryString([
        [
          "filter",
          GcpMonitoring.buildFilter({
            metricType: data.metricType,
            metricLabels: data.metricLabels,
            resourceType: data.resourceType,
            resourceLabels: data.resourceLabels,
          }),
        ],
        ["interval.startTime", data.start.toISOString()],
        ["interval.endTime", data.end.toISOString()],
        ["aggregation.alignmentPeriod", `${data.alignmentPeriodSeconds}s`],
        ["aggregation.perSeriesAligner", data.aligner],
        ["pageSize", PAGE_SIZE],
        ["pageToken", pageToken],
      ]);

      let response: JSONObject;

      try {
        response = await LlmProviderHttp.requestJson({
          transport: this.options.transport,
          method: "GET",
          url: `${GOOGLE_MONITORING_BASE_URL}/projects/${encodeURIComponent(
            data.projectId.trim(),
          )}/timeSeries?${query}`,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
          timeoutInMs: this.options.requestTimeoutInMs,
          step: `${data.metricType} request`,
          providerTitle: PROVIDER_TITLE,
          secretValues: [accessToken],
        });
      } catch (error) {
        const failure: LlmProviderError = GcpMonitoring.classify(error);

        // A metric type this project has no descriptor for: nothing to read.
        if (failure.statusCode === 404) {
          return series;
        }

        throw failure;
      }

      series.push(
        ...GcpMonitoring.readSeries(response, data.metricType, data.readAs),
      );

      const next: string = readText(response["nextPageToken"]);

      if (data.firstPageOnly || !next || next === pageToken) {
        break;
      }

      pageToken = next;
    }

    return series;
  }

  /*
   * Google answers a project whose Cloud Monitoring API is off with a 403
   * that says so: that is a setting to turn on, not a missing role.
   */
  public static classify(error: unknown): LlmProviderError {
    const failure: LlmProviderError =
      error instanceof LlmProviderError
        ? error
        : LlmProviderError.from({
            error,
            step: "request",
            providerTitle: PROVIDER_TITLE,
          });
    const body: string = (failure.responseBody || "").toLowerCase();

    if (
      failure.statusCode === 403 &&
      (body.includes("has not been used") || body.includes("is disabled"))
    ) {
      return new LlmProviderError({
        message: `${failure.message} Turn on the Cloud Monitoring API for the project: gcloud services enable monitoring.googleapis.com`,
        kind: CloudConnectionFailureKind.Settings,
        statusCode: failure.statusCode,
        responseBody: failure.responseBody,
      });
    }

    return failure;
  }

  /*
   * How many values a point's distribution holds: its `count`, an int64
   * written as a string - or 0 when the distribution leaves it out, as a
   * proto3 answer leaves out a zero. NaN for a point that is no
   * distribution.
   */
  public static readDistributionCount(value: JSONObject): number {
    const distribution: unknown = value["distributionValue"];

    if (
      !distribution ||
      typeof distribution !== "object" ||
      Array.isArray(distribution)
    ) {
      return NaN;
    }

    const count: unknown = (distribution as JSONObject)["count"];

    return count === undefined || count === null ? 0 : Number(count);
  }

  public static readSeries(
    response: JSONObject,
    metricType: string,
    readAs?: "count" | undefined,
  ): Array<GcpTimeSeries> {
    const series: Array<GcpTimeSeries> = [];

    for (const raw of readArray(response["timeSeries"])) {
      const entry: JSONObject = readObject(raw);
      const metric: JSONObject = readObject(entry["metric"]);
      const resource: JSONObject = readObject(entry["resource"]);
      const metadata: JSONObject = readObject(entry["metadata"]);
      const systemLabels: JSONObject = readObject(metadata["systemLabels"]);
      const points: Array<{ timeMs: number; value: number }> = [];

      for (const rawPoint of readArray(entry["points"])) {
        const point: JSONObject = readObject(rawPoint);
        const interval: JSONObject = readObject(point["interval"]);
        const value: JSONObject = readObject(point["value"]);
        const numeric: number =
          readAs === "count"
            ? GcpMonitoring.readDistributionCount(value)
            : Number(value["doubleValue"] ?? value["int64Value"] ?? NaN);
        const time: number = Date.parse(readText(interval["endTime"]));

        if (Number.isFinite(numeric) && Number.isFinite(time)) {
          points.push({ timeMs: time, value: numeric });
        }
      }

      const resourceType: string = readText(resource["type"]);

      if (!resourceType || points.length === 0) {
        continue;
      }

      series.push({
        metricType: readText(metric["type"]) || metricType,
        metricLabels: readLabels(metric["labels"]),
        resourceType,
        resourceLabels: readLabels(resource["labels"]),
        metadataName:
          typeof systemLabels["name"] === "string"
            ? (systemLabels["name"] as string)
            : "",
        points: points.sort(
          (a: { timeMs: number }, b: { timeMs: number }): number => {
            return a.timeMs - b.timeMs;
          },
        ),
      });
    }

    return series;
  }
}
