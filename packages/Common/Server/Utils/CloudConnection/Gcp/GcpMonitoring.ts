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
 * month per billing account. A call can be narrowed to some resources of a
 * type by one of their labels: resource.labels.instance_id=one_of("1","2"),
 * at most GCP_MAX_ONE_OF_VALUES values (Google's limit for one_of), so the
 * resources of a project an added metric is read for cost one call, not one
 * each (#9810).
 */

const PROVIDER_TITLE: string = "Google Cloud Monitoring";
const PAGE_SIZE: number = 10000;
const MAX_PAGES: number = 20;

/*
 * Values one one_of() takes at most: "x = one_of(...)" takes up to 100
 * strings (Cloud Monitoring's filter reference).
 */
export const GCP_MAX_ONE_OF_VALUES: number = 100;

/*
 * The longest filter a call sends, as its URL writes it (encoded): a call is
 * a GET, and a filter of a hundred long label values would make a URL a
 * proxy or Google's front end refuses. A batch past it is split.
 */
export const GCP_MAX_FILTER_URL_LENGTH: number = 6000;

/*
 * A label's values a call is narrowed to: resource.labels.<label> =
 * one_of(...), the resources of one batch (GcpCloudConnector).
 */
export interface GcpLabelValues {
  label: string;
  values: ReadonlyArray<string>;
}

export interface GcpTimeSeries {
  metricType: string;
  metricLabels: Dictionary<string>;
  resourceType: string;
  resourceLabels: Dictionary<string>;
  // What Cloud Monitoring calls the resource, when its metadata says (a VM's name).
  metadataName: string;
  points: Array<{ timeMs: number; value: number }>;
}

// A metric a project's resources may report (projects.metricDescriptors).
export interface GcpMetricDescriptor {
  type: string;
  displayName: string;
  description: string;
  // UCUM, as Cloud Monitoring writes it ("By", "1", "10^2.%").
  unit: string;
  // GAUGE, DELTA or CUMULATIVE.
  metricKind: string;
  // BOOL, INT64, DOUBLE, STRING or DISTRIBUTION.
  valueType: string;
  // GA, BETA, DEPRECATED and the rest.
  launchStage: string;
  monitoredResourceTypes: Array<string>;
  // The labels its series carry (#9808): each key, and what its values are.
  labels?: Array<{ key: string; valueType: string; description: string }>;
}

/*
 * A read split by one of a metric's labels (#9808): its other labels
 * added up by `reducer` (aggregation.crossSeriesReducer), keeping the
 * label and the monitored resource's own labels (groupByFields), so each
 * series is one value of one resource.
 */
export interface GcpSplitRead {
  label: string;
  reducer: string;
  resourceLabelKeys: ReadonlyArray<string>;
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
    /*
     * The resources of a batch (#9810): one label's values, the others
     * equal (resourceLabels). Each label in name order with those.
     */
    resourceLabelIn?: GcpLabelValues | undefined;
  }): string {
    const parts: Array<string> = [`metric.type="${data.metricType}"`];

    for (const name of Object.keys(data.metricLabels || {}).sort()) {
      parts.push(`metric.labels.${name}="${data.metricLabels![name]}"`);
    }

    if (data.resourceType) {
      parts.push(`resource.type="${data.resourceType}"`);
    }

    const resourceParts: Array<[string, string]> = Object.keys(
      data.resourceLabels || {},
    ).map((name: string): [string, string] => {
      return [name, `resource.labels.${name}="${data.resourceLabels![name]}"`];
    });

    if (data.resourceLabelIn && data.resourceLabelIn.values.length > 0) {
      const values: ReadonlyArray<string> = data.resourceLabelIn.values;

      resourceParts.push([
        data.resourceLabelIn.label,
        values.length === 1
          ? `resource.labels.${data.resourceLabelIn.label}="${values[0]}"`
          : `resource.labels.${data.resourceLabelIn.label}=one_of(${values
              .map((value: string): string => {
                return `"${value}"`;
              })
              .join(",")})`,
      ]);
    }

    resourceParts.sort((a: [string, string], b: [string, string]): number => {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });

    for (const [, part] of resourceParts) {
      parts.push(part);
    }

    return parts.join(" AND ");
  }

  // How long a filter is as a call's URL writes it, encoded.
  public static getFilterUrlLength(filter: string): number {
    return encodeURIComponent(filter).length;
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
    resourceLabelIn?: GcpLabelValues | undefined;
    split?: GcpSplitRead | undefined;
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
            resourceLabelIn: data.resourceLabelIn,
          }),
        ],
        ["interval.startTime", data.start.toISOString()],
        ["interval.endTime", data.end.toISOString()],
        ["aggregation.alignmentPeriod", `${data.alignmentPeriodSeconds}s`],
        ["aggregation.perSeriesAligner", data.aligner],
        ...GcpMonitoring.splitParameters(data.split),
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
   * The query parameters of a split read: the reducer, and each field it
   * keeps, the label first, then the resource's labels in name order.
   */
  public static splitParameters(
    split: GcpSplitRead | undefined,
  ): Array<[string, string]> {
    if (!split) {
      return [];
    }

    return [
      ["aggregation.crossSeriesReducer", split.reducer],
      ["aggregation.groupByFields", `metric.label.${split.label}`],
      ...[...split.resourceLabelKeys]
        .sort()
        .map((key: string): [string, string] => {
          return ["aggregation.groupByFields", `resource.label.${key}`];
        }),
    ];
  }

  /*
   * The metric descriptors of a project whose types start with one of
   * `prefixes` ("compute.googleapis.com/"), and that a resource of
   * `resourceType` can report (monitoredResourceTypes): what a resource's
   * list of the metrics it publishes shows (CloudResourceMetrics). A
   * descriptor filter selects by metric type only, so the resource type is
   * matched here. Free: Cloud Monitoring bills only reads of time series.
   */
  public async listMetricDescriptors(data: {
    projectId: string;
    prefixes: Array<string>;
    resourceType: string;
  }): Promise<Array<GcpMetricDescriptor>> {
    GoogleMonitoringClient.validateProjectId(data.projectId);

    const descriptors: Array<GcpMetricDescriptor> = [];

    for (const prefix of data.prefixes) {
      let pageToken: string = "";

      for (let page: number = 0; page < MAX_PAGES; page++) {
        if (this.options.budget && !this.options.budget.take()) {
          throw new CloudReadBudgetSpent();
        }

        const accessToken: string = await this.token.getAccessToken();
        const query: string = buildQueryString([
          ["filter", `metric.type = starts_with("${prefix}")`],
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
            )}/metricDescriptors?${query}`,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
            timeoutInMs: this.options.requestTimeoutInMs,
            step: "metric descriptors request",
            providerTitle: PROVIDER_TITLE,
            secretValues: [accessToken],
          });
        } catch (error) {
          throw GcpMonitoring.classify(error);
        }

        for (const raw of readArray(response["metricDescriptors"])) {
          const descriptor: GcpMetricDescriptor | null =
            GcpMonitoring.readDescriptor(raw);

          if (
            descriptor &&
            descriptor.monitoredResourceTypes.includes(data.resourceType)
          ) {
            descriptors.push(descriptor);
          }
        }

        const next: string = readText(response["nextPageToken"]);

        if (!next || next === pageToken) {
          break;
        }

        pageToken = next;
      }
    }

    return descriptors;
  }

  // One metric descriptor of an answer, or null when it is not one.
  public static readDescriptor(raw: unknown): GcpMetricDescriptor | null {
    const descriptor: JSONObject = readObject(raw);
    const type: string = readText(descriptor["type"]);

    if (!type) {
      return null;
    }

    return {
      type,
      displayName: readText(descriptor["displayName"]),
      description: readText(descriptor["description"]),
      unit: readText(descriptor["unit"]),
      metricKind: readText(descriptor["metricKind"]),
      valueType: readText(descriptor["valueType"]),
      launchStage: readText(descriptor["launchStage"]),
      monitoredResourceTypes: readArray(descriptor["monitoredResourceTypes"])
        .map((resourceType: unknown): string => {
          return readText(resourceType);
        })
        .filter((resourceType: string): boolean => {
          return Boolean(resourceType);
        }),
      labels: readArray(descriptor["labels"])
        .map(
          (
            raw: unknown,
          ): { key: string; valueType: string; description: string } => {
            const label: JSONObject = readObject(raw);

            return {
              key: readText(label["key"]),
              // A label's type is STRING unless it says otherwise.
              valueType: readText(label["valueType"]) || "STRING",
              description: readText(label["description"]),
            };
          },
        )
        .filter((label: { key: string }): boolean => {
          return Boolean(label.key);
        }),
    };
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
