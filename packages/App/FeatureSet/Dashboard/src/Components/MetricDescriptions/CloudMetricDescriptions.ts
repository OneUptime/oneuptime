/*
 * What each number on the Cloud pages means, in plain words. Shown in the
 * (i) tooltip beside a tile, chart or card title.
 *
 * The environment overview runs on two clocks, and the texts say which:
 *   - CPU, Memory, Instances and "Top instances by CPU" are a live snapshot
 *     of the tasks seen in the last 15 minutes (each task's latest reading),
 *     so the time picker does not move them. CPU is whatever percentage the
 *     platform's receiver reports (per vCPU or core for ECS task metrics and
 *     docker_stats, a 0-1 ratio of the allocation otherwise), so it is not
 *     capped at 100%. The top-instances list is sorted by latestCpuPercent
 *     DESC in Postgres, which puts NULLs first, so a task with no CPU reading
 *     can lead the list - the text says so;
 *   - Requests, Error rate, p95 latency and both charts follow the selected
 *     range. They count requests: entry spans, where work enters a service
 *     (a root span, or a SERVER or CONSUMER span), not every span under
 *     them - an app's page counts its own the same way, so an environment's
 *     requests are its apps' added up. The p95 tile is the average of the
 *     per-interval p95s, and the Memory chart adds up every
 *     container.memory.usage reading in an interval, so a container that
 *     reports more often weighs more.
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export type CloudMetric =
  | "cpu"
  | "memory"
  | "instances"
  | "requests"
  | "errorRate"
  | "p95Latency"
  | "requestsChart"
  | "memoryChart"
  | "topInstancesByCpu";

export const CLOUD_METRIC_DESCRIPTIONS: Record<CloudMetric, string> = {
  cpu: translationKey(
    "Average of the latest CPU reading of each task or instance seen in the last 15 minutes (ones with none are left out); it ignores the selected time range. Depending on the platform, 100% is one full CPU core or all the CPU the task was given, so it can read above 100%.",
  ),
  memory: translationKey(
    "Memory in use, added up across every task or instance seen in the last 15 minutes from each one's latest reading. It is a live snapshot, so it ignores the selected time range.",
  ),
  instances: translationKey(
    "Running tasks, replicas or instances in this environment that sent telemetry in the last 15 minutes. It is a live count, so it ignores the selected time range.",
  ),
  requests: translationKey(
    "Requests to the apps in this environment (matched by its cloud platform, account and region) in the selected range: the spans where work enters a service, not every database call and step under them.",
  ),
  errorRate: translationKey(
    "The share of this environment's requests in the selected range whose status was set to Error; the line below is how many errored. The bar turns amber at 1% and red at 5%.",
  ),
  p95Latency: translationKey(
    "p95 means the 95th percentile: 95% of the requests to this environment's apps finished faster than this and the slowest 5% took longer. Worked out for each interval, then averaged over the selected range, so quiet and busy intervals count equally.",
  ),
  requestsChart: translationKey(
    "Requests to this environment's apps in each interval, with the ones whose status was Error as a second line. Every app in the environment counts.",
  ),
  memoryChart: translationKey(
    "Container memory (container.memory.usage) in this environment for each interval. Every reading in an interval is added up, so a container that reports more than once per interval counts more than once - read it as a trend, not a total.",
  ),
  topInstancesByCpu: translationKey(
    "Up to five tasks or instances seen in the last 15 minutes, ordered by their latest CPU reading, highest first, with each one's latest memory in use; it ignores the selected time range. Ones that have not reported CPU show a dash and may be listed first.",
  ),
};

/*
 * What each number on an app's page means (Pages/AppPlatforms/View/App).
 * The app's requests, error rate, p95 and both charts follow the selected
 * range and count its requests - entry spans carrying the app's own
 * attributes and its environment's; instances, CPU and memory are the live
 * snapshot of its instances seen in the last 15 minutes. A deploy is drawn
 * on both charts as a dashed line.
 */
export type CloudAppMetric =
  | "requests"
  | "errorRate"
  | "p95Latency"
  | "instances"
  | "cpu"
  | "memory"
  | "requestsChart"
  | "latencyChart"
  | "rollout";

export const CLOUD_APP_METRIC_DESCRIPTIONS: Record<CloudAppMetric, string> = {
  requests: translationKey(
    "Requests to this app in the selected range: the spans where work enters it (a root span, or a SERVER or CONSUMER span), not every database call and step under them.",
  ),
  errorRate: translationKey(
    "The share of this app's requests in the selected range whose status was set to Error; the line below is how many errored. The bar turns amber at 1% and red at 5%.",
  ),
  p95Latency: translationKey(
    "95% of this app's requests finished faster than this and the slowest 5% took longer. Worked out for each interval, then averaged over the selected range.",
  ),
  instances: translationKey(
    "Tasks, replicas or instances running this app that sent telemetry in the last 15 minutes. It is a live count, so it ignores the selected time range.",
  ),
  cpu: translationKey(
    "Average of the latest CPU reading of each of this app's instances seen in the last 15 minutes; it ignores the selected time range. Depending on the platform, 100% is one full CPU core or all the CPU the task was given.",
  ),
  memory: translationKey(
    "Memory in use, added up across this app's instances seen in the last 15 minutes, from each one's latest reading. It is a live snapshot, so it ignores the selected time range.",
  ),
  requestsChart: translationKey(
    "This app's requests in each interval, with the ones whose status was Error as a second line. A dashed line marks each deploy.",
  ),
  latencyChart: translationKey(
    "The 95th percentile of this app's request durations in each interval. A dashed line marks each deploy, so a slower release shows where it started.",
  ),
  rollout: translationKey(
    "The revisions this app's instances run right now, from the instances seen in the last 15 minutes. Two revisions at once is a deploy in progress, or traffic split between them.",
  ),
};

/*
 * The stat strip above the Cloud Environments list (Pages/Cloud/Utils/
 * CloudFleetSummary.ts). Counts of rows, not telemetry, so none of them has
 * a time range.
 */
export type CloudFleetMetric =
  | "apps"
  | "environments"
  | "deploys"
  | "liveInstances";

export const CLOUD_FLEET_METRIC_DESCRIPTIONS: Record<CloudFleetMetric, string> =
  {
    apps: translationKey(
      "Apps on your platforms - an ECS service, a Cloud Run service, a Container App - in every environment. The line below says how many have not reported in the last 15 minutes.",
    ),
    environments: translationKey(
      "Cloud environments in this project - one per cloud platform, account and region - not counting archived ones. The line below says how many are disconnected, else which providers they are on.",
    ),
    deploys: translationKey(
      "New revisions your apps started running in the last 24 hours: a new ECS task definition revision, Cloud Run revision or service.version. A rollback is not counted.",
    ),
    liveInstances: translationKey(
      "Running tasks, replicas or instances that sent telemetry in the last 15 minutes, across every cloud environment in this project, archived ones included.",
    ),
  };

/*
 * The metric columns of an environment's Instances tab (Pages/Cloud/View/
 * Instances.tsx). Each is the one point ingest mirrors onto the
 * CloudResourceInstance row (OtelMetricsIngestService
 * .bufferCloudResourceSnapshotMetric): a newer reading overwrites it, and
 * nothing ever clears it - CloudResourceInstanceService.recordInstance only
 * writes the fields it is given, so telemetry without a reading leaves the
 * last one in place. The tab has no time picker; these are not averages.
 *
 * Within one batch a task-level ECS point (ecs.task.*) beats a
 * container-level one for the same task, so the text says "preferred" -
 * a batch that carries only container points still overwrites it.
 */
export type CloudInstanceMetric = "cpu" | "memory";

export const CLOUD_INSTANCE_METRIC_DESCRIPTIONS: Record<
  CloudInstanceMetric,
  string
> = {
  cpu: translationKey(
    "The latest CPU reading this task or instance sent - one snapshot, not an average - kept until a newer one arrives. Depending on the platform, 100% is one full CPU core or all the CPU the task was given, so it can read above 100%. A dash means no CPU reading has arrived.",
  ),
  memory: translationKey(
    "The latest memory-in-use reading this task or instance sent - one snapshot, not an average or a peak - kept until a newer one arrives. For an ECS task the whole task's figure is preferred over a single container's. A dash means no memory reading has arrived.",
  ),
};
