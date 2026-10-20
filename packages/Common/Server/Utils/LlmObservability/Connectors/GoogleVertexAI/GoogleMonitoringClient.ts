import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmProviderHttp";
import GoogleServiceAccountToken from "./GoogleServiceAccountToken";

/*
 * Google Cloud Monitoring's timeSeries.list, the call the Vertex AI
 * connection makes with a service account that has the Monitoring Viewer
 * role on the project:
 *
 *   GET https://monitoring.googleapis.com/v3/projects/{project}/timeSeries
 *       ?filter=metric.type="..."&interval.startTime=&interval.endTime=
 *       &aggregation.alignmentPeriod=3600s&aggregation.perSeriesAligner=ALIGN_SUM
 *       &aggregation.crossSeriesReducer=REDUCE_SUM
 *       &aggregation.groupByFields=resource.label.model_user_id ...
 *   -> { timeSeries: [{ metric: { labels }, resource: { labels }, points:
 *        [{ interval: { startTime, endTime }, value: { int64Value } }] }],
 *        nextPageToken }
 *
 * Hours are read and added up into UTC days here: an hourly alignment that
 * ends on the hour puts every point inside one day, whatever Monitoring
 * does with a period's boundaries.
 */

export const GOOGLE_MONITORING_BASE_URL: string =
  "https://monitoring.googleapis.com/v3";
export const GOOGLE_MONITORING_READ_SCOPE: string =
  "https://www.googleapis.com/auth/monitoring.read";

const PAGE_SIZE: number = 10000;
const MAX_PAGES: number = 20;
const PROVIDER_TITLE: string = "Google Cloud Monitoring";

/*
 * Google Cloud project ids: 6-30 lowercase letters, digits and hyphens,
 * starting with a letter and not ending with a hyphen. Put into a URL path,
 * so nothing else is accepted.
 */
const PROJECT_ID_REGEX: RegExp = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export interface GoogleMonitoringPoint {
  // Start of the hour the point covers.
  hour: Date;
  value: number;
  metricLabels: Dictionary<string>;
  resourceLabels: Dictionary<string>;
}

export interface GoogleMonitoringClientOptions {
  projectId: string;
  serviceAccountJson: string;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
}

export default class GoogleMonitoringClient {
  private options: GoogleMonitoringClientOptions;
  private token: GoogleServiceAccountToken;
  private requestCount: number = 0;

  public constructor(options: GoogleMonitoringClientOptions) {
    GoogleMonitoringClient.validateProjectId(options.projectId);

    this.options = options;
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: options.serviceAccountJson,
      scope: GOOGLE_MONITORING_READ_SCOPE,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  public static validateProjectId(projectId: string): void {
    if (!PROJECT_ID_REGEX.test((projectId || "").trim())) {
      throw new BadDataException(
        "Project ID must be a Google Cloud project id: 6-30 lowercase letters, digits and hyphens, such as my-project-123456.",
      );
    }
  }

  public getRequestCount(): number {
    return this.requestCount + this.token.getRequestCount();
  }

  /*
   * Hourly sums of one metric over [startTime, endTime), grouped by the
   * given labels. Both times should be on the hour.
   */
  public async listHourlySums(data: {
    metricType: string;
    groupByFields: Array<string>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<GoogleMonitoringPoint>> {
    const points: Array<GoogleMonitoringPoint> = [];
    let pageToken: string = "";

    for (let index: number = 0; index < MAX_PAGES; index++) {
      const accessToken: string = await this.token.getAccessToken();

      const query: string = buildQueryString([
        ["filter", `metric.type="${data.metricType}"`],
        ["interval.startTime", data.startTime.toISOString()],
        ["interval.endTime", data.endTime.toISOString()],
        ["aggregation.alignmentPeriod", "3600s"],
        ["aggregation.perSeriesAligner", "ALIGN_SUM"],
        ["aggregation.crossSeriesReducer", "REDUCE_SUM"],
        ...data.groupByFields.map(
          (field: string): [string, string] => {
            return ["aggregation.groupByFields", field];
          },
        ),
        ["pageSize", PAGE_SIZE],
        ["pageToken", pageToken],
      ]);

      this.requestCount++;

      const response: JSONObject = await LlmProviderHttp.requestJson({
        transport: this.options.transport,
        method: "GET",
        url: `${GOOGLE_MONITORING_BASE_URL}/projects/${encodeURIComponent(
          this.options.projectId.trim(),
        )}/timeSeries?${query}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        timeoutInMs: this.options.requestTimeoutInMs,
        step: "time series request",
        providerTitle: PROVIDER_TITLE,
        secretValues: [accessToken],
      });

      points.push(...GoogleMonitoringClient.readPoints(response));

      const next: string = readText(response["nextPageToken"]);

      if (!next || next === pageToken) {
        break;
      }

      pageToken = next;
    }

    return points;
  }

  public static readPoints(response: JSONObject): Array<GoogleMonitoringPoint> {
    const points: Array<GoogleMonitoringPoint> = [];

    for (const rawSeries of readArray(response["timeSeries"])) {
      const series: JSONObject = readObject(rawSeries);
      const metricLabels: Dictionary<string> = GoogleMonitoringClient.readLabels(
        readObject(series["metric"])["labels"],
      );
      const resourceLabels: Dictionary<string> =
        GoogleMonitoringClient.readLabels(
          readObject(series["resource"])["labels"],
        );

      for (const rawPoint of readArray(series["points"])) {
        const point: JSONObject = readObject(rawPoint);
        const interval: JSONObject = readObject(point["interval"]);
        const value: JSONObject = readObject(point["value"]);
        const numeric: number = Number(
          value["int64Value"] ?? value["doubleValue"] ?? NaN,
        );
        const start: number = Date.parse(readText(interval["startTime"]));
        const end: number = Date.parse(readText(interval["endTime"]));
        // An aligned point covers (end - 1 hour, end]; its hour starts there.
        const hourStart: number = Number.isFinite(start) && start < end
          ? start
          : end - 60 * 60 * 1000;

        if (!Number.isFinite(numeric) || numeric === 0 || !Number.isFinite(hourStart)) {
          continue;
        }

        points.push({
          hour: new Date(hourStart),
          value: numeric,
          metricLabels,
          resourceLabels,
        });
      }
    }

    return points;
  }

  private static readLabels(raw: unknown): Dictionary<string> {
    const labels: Dictionary<string> = {};
    const object: JSONObject = readObject(raw);

    for (const key of Object.keys(object)) {
      labels[key] = readText(object[key]);
    }

    return labels;
  }
}
