import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import {
  APP_ENGINE_SERVICE_TYPE,
  APP_RUNNER_SERVICE_TYPE,
  APP_SERVICE_SITE_TYPE,
  APP_SERVICE_SLOT_TYPE,
  CLOUD_RUN_SERVICE_TYPE,
  CONTAINER_APP_TYPE,
  ECS_SERVICE_TYPE,
} from "Common/Types/Cloud/CloudAppPlatformResourceMatch";
import {
  GCP_ALIGNMENT_PERIOD_SECONDS,
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "Common/Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudResourceReading,
  CloudResourceReadings,
  readCloudResourceReadings,
} from "Common/Types/Cloud/CloudResourceHealth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  AppServiceMetric,
  getAppServiceStoredMetricName,
} from "./CloudAppPlatformResource";

/*
 * WHAT A MANAGED PLATFORM'S OWN MONITORING SAYS OF AN APP (issues #6770,
 * #6793, #6794): the metrics its cloud connection stores for the Cloud
 * Resource the app runs as, each under the name the connection stores it
 * by, and how each adds up over a range - for the app's page, whose section
 * is named after the provider's service (Azure Monitor, Google Cloud
 * Monitoring, Amazon CloudWatch), and for its lists (All Apps, an
 * environment's Apps tab and its Overview's Apps card).
 *
 * Each platform's, as its connection reads it (CloudKeyMetrics, and the
 * provider's metrics reference each is held to in
 * CloudKeyMetricsProviderReference.test):
 *
 *   - App Service, a site or a slot (Azure Monitor): Requests, Http5xx,
 *     HttpResponseTime, CpuTime and MemoryWorkingSet - its section is
 *     CloudAppAzureMonitorCard, which reads APP_SERVICE_METRICS.
 *   - Container Apps (Azure Monitor): Requests, ResponseTime (ms),
 *     CpuPercentage, WorkingSetBytes and RestartCount. Its Requests are read
 *     whole, never split by status code, so it has no 5xx share.
 *   - Cloud Run (Google Cloud Monitoring): request_count - each minute's
 *     rate, per response_code_class, whose "5xx" series are its server
 *     errors - request_latencies' 95th percentile, and its containers'
 *     CPU and memory utilizations' 95th percentile, a ratio of 1.
 *   - App Engine (Google Cloud Monitoring): response_count - each minute's
 *     rate, per response_code, whose 500 to 599 are its server errors -
 *     and response_latencies' 95th percentile. Its CPU and memory
 *     (system/cpu/utilization, system/memory/usage) are not key metrics of
 *     a gae_app yet, so the connection stores neither (#10838).
 *   - App Runner (Amazon CloudWatch): Requests, 5xxStatusResponses,
 *     RequestLatency (ms), CPUUtilization and MemoryUtilization.
 *   - ECS (Amazon CloudWatch): the service's CPUUtilization and
 *     MemoryUtilization alone. ECS publishes no requests of its own: they
 *     are its load balancer's target group's, which the connection reads
 *     as the load balancer's whole, and a load balancer often serves more
 *     than one service - so an ECS app's requests stay its traces'.
 *
 * A Cloud Monitoring rate is stored per second of each minute the
 * connection aligns it to (GCP_ALIGNMENT_PERIOD_SECONDS): a minute's count
 * is its value times 60. React-free, so all of it is tested without a
 * renderer.
 */

// What a platform section and a list say of an app, each figure one number.
export enum CloudAppPlatformFigure {
  Requests = "requests",
  ServerErrors = "server-errors",
  // The mean time to answer a request.
  ResponseTime = "response-time",
  // The 95th percentile of the time to answer, each minute's, averaged.
  Latency = "latency",
  // A share of the CPU the app may use, 0 to 100.
  Cpu = "cpu",
  Memory = "memory",
  // A share of the memory the app may use, 0 to 100.
  MemoryPercent = "memory-percent",
  Restarts = "restarts",
}

// The figures added up over a range; the others are averaged.
export const COUNTED_CLOUD_APP_PLATFORM_FIGURES: ReadonlySet<CloudAppPlatformFigure> =
  new Set<CloudAppPlatformFigure>([
    CloudAppPlatformFigure.Requests,
    CloudAppPlatformFigure.ServerErrors,
    CloudAppPlatformFigure.Restarts,
  ]);

/*
 * The requests of one read, by the label their response code is on: the
 * series the label calls a server error are its 5xx answers. Read so where
 * the provider counts errors only as a label of the request count (Cloud
 * Run's response_code_class, App Engine's response_code).
 */
export interface CloudAppPlatformErrorLabel {
  attribute: string;
  isServerError: (value: string) => boolean;
}

// One stored metric a section or a list reads.
export interface CloudAppPlatformMetricRead {
  figure: CloudAppPlatformFigure;
  storedName: string;
  // How an interval holds it: counted (Sum) or measured (Avg).
  aggregationType: AggregationType;
  // What each value is multiplied by: a rate's seconds, a ratio's 100.
  scale: number;
  // Requests read by their response code, which gives their 5xx too.
  errorLabel?: CloudAppPlatformErrorLabel | undefined;
}

export type CloudAppPlatformChart = "requests" | "latency" | "usage";

export interface CloudAppPlatformTile {
  figure: CloudAppPlatformFigure;
  // What the number means (a key, worded with the service's name).
  description: string;
}

export interface CloudAppPlatformProfile {
  // The Cloud Resource type it reads, as CloudResourceCatalog spells it.
  type: string;
  provider: CloudProvider;
  // The provider's monitoring, which names the section: "Google Cloud Monitoring".
  service: string;
  tiles: ReadonlyArray<CloudAppPlatformTile>;
  charts: ReadonlyArray<CloudAppPlatformChart>;
  // How its requests chart and its latency chart are described.
  requestsChartDescription: string;
  latencyChartDescription: string;
  // Each read, for a resource with these readings.
  reads: (readings: unknown) => Array<CloudAppPlatformMetricRead>;
}

// Each provider's monitoring, by its own name, as a section's heading names it.
export const AZURE_MONITOR: string = translationKey("Azure Monitor");
export const GOOGLE_CLOUD_MONITORING: string = translationKey(
  "Google Cloud Monitoring",
);
export const AMAZON_CLOUDWATCH: string = translationKey("Amazon CloudWatch");

// The service each cloud's monitoring is, as a section names it.
export const CLOUD_APP_PLATFORM_SERVICES: Readonly<
  Record<CloudProvider, string>
> = {
  [CloudProvider.Azure]: AZURE_MONITOR,
  [CloudProvider.GCP]: GOOGLE_CLOUD_MONITORING,
  [CloudProvider.AWS]: AMAZON_CLOUDWATCH,
};

/*
 * What each figure means, as a tile's (i) says it. "{{service}}" is the
 * provider's monitoring, as the section names it.
 */
export const CLOUD_APP_PLATFORM_DESCRIPTIONS: Readonly<Record<string, string>> =
  {
    requests: translationKey(
      "Requests to this app in the selected range, as {{service}} counts them, whether or not the app sends traces.",
    ),
    serverErrors: translationKey(
      "The share of this app's requests in the selected range answered with a 5xx status, as {{service}} counts them. The line below is how many.",
    ),
    responseTime: translationKey(
      "How long this app took to answer a request, averaged over the selected range, as {{service}} measures it.",
    ),
    latency: translationKey(
      "The 95th percentile of this app's response time in each minute, averaged over the selected range, as {{service}} measures it.",
    ),
    cpu: translationKey(
      "The share of its CPU this app used, averaged over the selected range, as {{service}} measures it.",
    ),
    cpuP95: translationKey(
      "The 95th percentile of its instances' CPU utilization, averaged over the selected range, as {{service}} measures it.",
    ),
    memory: translationKey(
      "Memory this app uses (its working set), averaged over the selected range, as {{service}} measures it.",
    ),
    memoryPercent: translationKey(
      "The share of its memory this app used, averaged over the selected range, as {{service}} measures it.",
    ),
    memoryP95: translationKey(
      "The 95th percentile of its instances' memory utilization, averaged over the selected range, as {{service}} measures it.",
    ),
    restarts: translationKey(
      "How many times this app's replicas restarted in the selected range, as {{service}} counts them.",
    ),
    requestsChart: translationKey(
      "This app's requests in each interval, as {{service}} counts them. A dashed line marks each deploy.",
    ),
    requestsAndErrorsChart: translationKey(
      "This app's requests in each interval, with those answered with a 5xx status as a line of their own, as {{service}} counts them. A dashed line marks each deploy.",
    ),
    responseTimeChart: translationKey(
      "This app's average response time in each interval, as {{service}} measures it. A dashed line marks each deploy.",
    ),
    latencyChart: translationKey(
      "The 95th percentile of this app's response time in each interval, as {{service}} measures it. A dashed line marks each deploy.",
    ),
    usageChart: translationKey(
      "This app's CPU and memory utilization in each interval, as {{service}} measures them. A dashed line marks each deploy.",
    ),
  };

const D: Readonly<Record<string, string>> = CLOUD_APP_PLATFORM_DESCRIPTIONS;
const F: typeof CloudAppPlatformFigure = CloudAppPlatformFigure;

/*
 * The name an Azure Monitor metric is stored under, for this resource: the
 * one its reading says the read stored (CloudResourceReading.metric), else
 * the metric with the aggregation its definition calls primary.
 */
export function getAzurePlatformStoredMetricName(data: {
  readings: unknown;
  metricName: string;
  aggregation: string;
}): string {
  const readings: CloudResourceReadings = readCloudResourceReadings(
    data.readings,
  );
  const reading: CloudResourceReading | undefined =
    readings[data.metricName.toLowerCase()];
  const stored: string = (reading?.metric || "").trim().toLowerCase();

  return stored || getAzureStoredMetricName(data.metricName, data.aggregation);
}

function azureRead(data: {
  readings: unknown;
  figure: CloudAppPlatformFigure;
  metricName: string;
  aggregation: string;
  aggregationType: AggregationType;
}): CloudAppPlatformMetricRead {
  return {
    figure: data.figure,
    storedName: getAzurePlatformStoredMetricName(data),
    aggregationType: data.aggregationType,
    scale: 1,
  };
}

function awsRead(data: {
  namespace: string;
  metricName: string;
  figure: CloudAppPlatformFigure;
  aggregationType: AggregationType;
}): CloudAppPlatformMetricRead {
  return {
    figure: data.figure,
    storedName: getAwsStoredMetricName(data.namespace, data.metricName),
    aggregationType: data.aggregationType,
    scale: 1,
  };
}

// A Cloud Monitoring rate, per second of each aligned minute: a minute's count.
function gcpCountRead(data: {
  metricType: string;
  errorLabel: CloudAppPlatformErrorLabel;
}): CloudAppPlatformMetricRead {
  return {
    figure: F.Requests,
    storedName: data.metricType,
    aggregationType: AggregationType.Sum,
    scale: GCP_ALIGNMENT_PERIOD_SECONDS,
    errorLabel: data.errorLabel,
  };
}

// Cloud Run's response_code_class: "2xx", "4xx", "5xx".
export const CLOUD_RUN_ERROR_LABEL: CloudAppPlatformErrorLabel = {
  attribute: "response_code_class",
  isServerError: (value: string): boolean => {
    return value.trim().toLowerCase() === "5xx";
  },
};

// App Engine's response_code: the HTTP status, 500 to 599 a server error.
export const APP_ENGINE_ERROR_LABEL: CloudAppPlatformErrorLabel = {
  attribute: "response_code",
  isServerError: (value: string): boolean => {
    const code: number = Number(value.trim());

    return Number.isInteger(code) && code >= 500 && code <= 599;
  },
};

export const CLOUD_APP_PLATFORM_PROFILES: ReadonlyArray<CloudAppPlatformProfile> =
  [
    {
      type: CONTAINER_APP_TYPE,
      provider: CloudProvider.Azure,
      service: AZURE_MONITOR,
      tiles: [
        { figure: F.Requests, description: D["requests"]! },
        { figure: F.ResponseTime, description: D["responseTime"]! },
        { figure: F.Cpu, description: D["cpu"]! },
        { figure: F.Memory, description: D["memory"]! },
        { figure: F.Restarts, description: D["restarts"]! },
      ],
      charts: ["requests", "latency"],
      requestsChartDescription: D["requestsChart"]!,
      latencyChartDescription: D["responseTimeChart"]!,
      reads: (readings: unknown): Array<CloudAppPlatformMetricRead> => {
        return [
          azureRead({
            readings,
            figure: F.Requests,
            metricName: "Requests",
            aggregation: "total",
            aggregationType: AggregationType.Sum,
          }),
          azureRead({
            readings,
            figure: F.ResponseTime,
            metricName: "ResponseTime",
            aggregation: "average",
            aggregationType: AggregationType.Avg,
          }),
          azureRead({
            readings,
            figure: F.Cpu,
            metricName: "CpuPercentage",
            aggregation: "average",
            aggregationType: AggregationType.Avg,
          }),
          azureRead({
            readings,
            figure: F.Memory,
            metricName: "WorkingSetBytes",
            aggregation: "average",
            aggregationType: AggregationType.Avg,
          }),
          azureRead({
            readings,
            figure: F.Restarts,
            metricName: "RestartCount",
            aggregation: "total",
            aggregationType: AggregationType.Sum,
          }),
        ];
      },
    },
    {
      type: CLOUD_RUN_SERVICE_TYPE,
      provider: CloudProvider.GCP,
      service: GOOGLE_CLOUD_MONITORING,
      tiles: [
        { figure: F.Requests, description: D["requests"]! },
        { figure: F.ServerErrors, description: D["serverErrors"]! },
        { figure: F.Latency, description: D["latency"]! },
        { figure: F.Cpu, description: D["cpuP95"]! },
        { figure: F.MemoryPercent, description: D["memoryP95"]! },
      ],
      charts: ["requests", "latency"],
      requestsChartDescription: D["requestsAndErrorsChart"]!,
      latencyChartDescription: D["latencyChart"]!,
      reads: (): Array<CloudAppPlatformMetricRead> => {
        return [
          gcpCountRead({
            metricType: "run.googleapis.com/request_count",
            errorLabel: CLOUD_RUN_ERROR_LABEL,
          }),
          {
            figure: F.Latency,
            storedName: "run.googleapis.com/request_latencies",
            aggregationType: AggregationType.Avg,
            scale: 1,
          },
          {
            figure: F.Cpu,
            storedName: "run.googleapis.com/container/cpu/utilizations",
            aggregationType: AggregationType.Avg,
            scale: 100,
          },
          {
            figure: F.MemoryPercent,
            storedName: "run.googleapis.com/container/memory/utilizations",
            aggregationType: AggregationType.Avg,
            scale: 100,
          },
        ];
      },
    },
    {
      type: APP_ENGINE_SERVICE_TYPE,
      provider: CloudProvider.GCP,
      service: GOOGLE_CLOUD_MONITORING,
      tiles: [
        { figure: F.Requests, description: D["requests"]! },
        { figure: F.ServerErrors, description: D["serverErrors"]! },
        { figure: F.Latency, description: D["latency"]! },
      ],
      charts: ["requests", "latency"],
      requestsChartDescription: D["requestsAndErrorsChart"]!,
      latencyChartDescription: D["latencyChart"]!,
      reads: (): Array<CloudAppPlatformMetricRead> => {
        return [
          gcpCountRead({
            metricType: "appengine.googleapis.com/http/server/response_count",
            errorLabel: APP_ENGINE_ERROR_LABEL,
          }),
          {
            figure: F.Latency,
            storedName:
              "appengine.googleapis.com/http/server/response_latencies",
            aggregationType: AggregationType.Avg,
            scale: 1,
          },
        ];
      },
    },
    {
      type: APP_RUNNER_SERVICE_TYPE,
      provider: CloudProvider.AWS,
      service: AMAZON_CLOUDWATCH,
      tiles: [
        { figure: F.Requests, description: D["requests"]! },
        { figure: F.ServerErrors, description: D["serverErrors"]! },
        { figure: F.ResponseTime, description: D["responseTime"]! },
        { figure: F.Cpu, description: D["cpu"]! },
        { figure: F.MemoryPercent, description: D["memoryPercent"]! },
      ],
      charts: ["requests", "latency"],
      requestsChartDescription: D["requestsAndErrorsChart"]!,
      latencyChartDescription: D["responseTimeChart"]!,
      reads: (): Array<CloudAppPlatformMetricRead> => {
        return [
          awsRead({
            namespace: "AWS/AppRunner",
            metricName: "Requests",
            figure: F.Requests,
            aggregationType: AggregationType.Sum,
          }),
          awsRead({
            namespace: "AWS/AppRunner",
            metricName: "5xxStatusResponses",
            figure: F.ServerErrors,
            aggregationType: AggregationType.Sum,
          }),
          awsRead({
            namespace: "AWS/AppRunner",
            metricName: "RequestLatency",
            figure: F.ResponseTime,
            aggregationType: AggregationType.Avg,
          }),
          awsRead({
            namespace: "AWS/AppRunner",
            metricName: "CPUUtilization",
            figure: F.Cpu,
            aggregationType: AggregationType.Avg,
          }),
          awsRead({
            namespace: "AWS/AppRunner",
            metricName: "MemoryUtilization",
            figure: F.MemoryPercent,
            aggregationType: AggregationType.Avg,
          }),
        ];
      },
    },
    {
      type: ECS_SERVICE_TYPE,
      provider: CloudProvider.AWS,
      service: AMAZON_CLOUDWATCH,
      tiles: [
        { figure: F.Cpu, description: D["cpu"]! },
        { figure: F.MemoryPercent, description: D["memoryPercent"]! },
      ],
      charts: ["usage"],
      requestsChartDescription: D["requestsChart"]!,
      latencyChartDescription: D["responseTimeChart"]!,
      reads: (): Array<CloudAppPlatformMetricRead> => {
        return [
          awsRead({
            namespace: "AWS/ECS",
            metricName: "CPUUtilization",
            figure: F.Cpu,
            aggregationType: AggregationType.Avg,
          }),
          awsRead({
            namespace: "AWS/ECS",
            metricName: "MemoryUtilization",
            figure: F.MemoryPercent,
            aggregationType: AggregationType.Avg,
          }),
        ];
      },
    },
  ];

/*
 * The profile of a resource of `type`, or null for a type with none: an
 * App Service site or slot, whose section is CloudAppAzureMonitorCard.
 */
export function getCloudAppPlatformProfile(
  type: string | null | undefined,
): CloudAppPlatformProfile | null {
  const wanted: string = (type || "").trim().toLowerCase();

  return (
    CLOUD_APP_PLATFORM_PROFILES.find(
      (profile: CloudAppPlatformProfile): boolean => {
        return profile.type.toLowerCase() === wanted;
      },
    ) || null
  );
}

/*
 * What a list reads of a resource of `type`, over its hour: its requests,
 * their 5xx (a read of its own, or a label of theirs) and its latency -
 * and whether that latency is a mean or a 95th percentile. An App Service
 * site's and slot's are App Service's own (APP_SERVICE_METRICS). Empty for
 * a type a list says nothing of (an ECS service: CPU and memory alone).
 */
export function getCloudAppPlatformListReads(data: {
  type: string | null | undefined;
  readings: unknown;
}): Array<CloudAppPlatformMetricRead> {
  const type: string = (data.type || "").trim().toLowerCase();

  if (
    type === APP_SERVICE_SITE_TYPE.toLowerCase() ||
    type === APP_SERVICE_SLOT_TYPE.toLowerCase()
  ) {
    return [
      {
        figure: F.Requests,
        storedName: getAppServiceStoredMetricName({
          metric: AppServiceMetric.Requests,
          readings: data.readings,
        }),
        aggregationType: AggregationType.Sum,
        scale: 1,
      },
      {
        figure: F.ServerErrors,
        storedName: getAppServiceStoredMetricName({
          metric: AppServiceMetric.ServerErrors,
          readings: data.readings,
        }),
        aggregationType: AggregationType.Sum,
        scale: 1,
      },
      {
        figure: F.ResponseTime,
        storedName: getAppServiceStoredMetricName({
          metric: AppServiceMetric.ResponseTime,
          readings: data.readings,
        }),
        aggregationType: AggregationType.Avg,
        // Azure Monitor reports HttpResponseTime in seconds.
        scale: 1000,
      },
    ];
  }

  const profile: CloudAppPlatformProfile | null =
    getCloudAppPlatformProfile(type);

  if (!profile) {
    return [];
  }

  return profile
    .reads(data.readings)
    .filter((read: CloudAppPlatformMetricRead): boolean => {
      return (
        read.figure === F.Requests ||
        read.figure === F.ServerErrors ||
        read.figure === F.ResponseTime ||
        read.figure === F.Latency
      );
    });
}

/* ------------------------------------------------------ Over a range */

export interface CloudAppPlatformPoint {
  x: Date;
  y: number;
}

// Each figure's points over a range, scaled; a figure not read has none.
export type CloudAppPlatformSeries = Partial<
  Record<CloudAppPlatformFigure, Array<CloudAppPlatformPoint>>
>;

/*
 * A platform's numbers over the range: totals for what is counted
 * (requests, server errors, restarts), means of the range's intervals for
 * what is measured. Null where the range holds no point: unknown, not
 * zero.
 */
export interface CloudAppPlatformSummary {
  requests: number | null;
  serverErrors: number | null;
  serverErrorRatePercent: number | null;
  responseTimeMs: number | null;
  latencyMs: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
  restarts: number | null;
}

function finiteValues(
  points: ReadonlyArray<CloudAppPlatformPoint> | undefined,
): Array<number> {
  return (points || [])
    .map((point: CloudAppPlatformPoint): number => {
      return point.y;
    })
    .filter((value: number): boolean => {
      return Number.isFinite(value);
    });
}

export function sumCloudAppPlatformPoints(
  points: ReadonlyArray<CloudAppPlatformPoint> | undefined,
): number | null {
  const values: Array<number> = finiteValues(points);

  return values.length === 0
    ? null
    : values.reduce((sum: number, value: number): number => {
        return sum + value;
      }, 0);
}

export function meanCloudAppPlatformPoints(
  points: ReadonlyArray<CloudAppPlatformPoint> | undefined,
): number | null {
  const values: Array<number> = finiteValues(points);
  const sum: number | null = sumCloudAppPlatformPoints(points);

  return sum === null ? null : sum / values.length;
}

export function summarizeCloudAppPlatformSeries(
  series: CloudAppPlatformSeries,
): CloudAppPlatformSummary {
  const requests: number | null = sumCloudAppPlatformPoints(series[F.Requests]);
  const serverErrors: number | null = sumCloudAppPlatformPoints(
    series[F.ServerErrors],
  );

  return {
    requests,
    serverErrors,
    /*
     * A range with requests and no 5xx point at all was not read - unknown,
     * not 0% - unless the 5xx came from the requests' own read, which
     * writes a 0 for each interval with none (readCloudAppPlatformSplit).
     */
    serverErrorRatePercent:
      requests !== null && requests > 0 && serverErrors !== null
        ? (serverErrors / requests) * 100
        : null,
    responseTimeMs: meanCloudAppPlatformPoints(series[F.ResponseTime]),
    latencyMs: meanCloudAppPlatformPoints(series[F.Latency]),
    cpuPercent: meanCloudAppPlatformPoints(series[F.Cpu]),
    memoryBytes: meanCloudAppPlatformPoints(series[F.Memory]),
    memoryPercent: meanCloudAppPlatformPoints(series[F.MemoryPercent]),
    restarts: sumCloudAppPlatformPoints(series[F.Restarts]),
  };
}

// One interval of a request read by its response code: one group's value.
export interface CloudAppPlatformSplitPoint {
  x: Date;
  // The response code label's value, as stored.
  label: string;
  y: number;
}

/*
 * A request read by its response code, as two series - all requests in
 * each interval, and the server errors among them - each scaled. An
 * interval with requests and no server error reads 0 server errors: the
 * read is the request count itself, so it proves there were none.
 */
export function readCloudAppPlatformSplit(data: {
  points: ReadonlyArray<CloudAppPlatformSplitPoint>;
  errorLabel: CloudAppPlatformErrorLabel;
  scale: number;
}): {
  requests: Array<CloudAppPlatformPoint>;
  serverErrors: Array<CloudAppPlatformPoint>;
} {
  const byTime: Map<number, { requests: number; serverErrors: number }> =
    new Map<number, { requests: number; serverErrors: number }>();

  for (const point of data.points) {
    const time: number = point.x.getTime();

    if (!Number.isFinite(time) || !Number.isFinite(point.y)) {
      continue;
    }

    const interval: { requests: number; serverErrors: number } = byTime.get(
      time,
    ) || { requests: 0, serverErrors: 0 };

    interval.requests += point.y * data.scale;

    if (data.errorLabel.isServerError(point.label)) {
      interval.serverErrors += point.y * data.scale;
    }

    byTime.set(time, interval);
  }

  const times: Array<number> = Array.from(byTime.keys()).sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );

  return {
    requests: times.map((time: number): CloudAppPlatformPoint => {
      return { x: new Date(time), y: byTime.get(time)!.requests };
    }),
    serverErrors: times.map((time: number): CloudAppPlatformPoint => {
      return { x: new Date(time), y: byTime.get(time)!.serverErrors };
    }),
  };
}
