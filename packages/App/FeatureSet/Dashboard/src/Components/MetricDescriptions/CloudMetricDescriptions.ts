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
 *     range. The p95 tile is the average of the per-interval p95s, and the
 *     Memory chart adds up every container.memory.usage reading in an
 *     interval, so a container that reports more often weighs more.
 * Change the fetch, change the words.
 */

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
  cpu: "Average of the latest CPU reading of each task or instance seen in the last 15 minutes (ones with none are left out); it ignores the selected time range. Depending on the platform, 100% is one full CPU core or all the CPU the task was given, so it can read above 100%.",
  memory:
    "Memory in use, added up across every task or instance seen in the last 15 minutes from each one's latest reading. It is a live snapshot, so it ignores the selected time range.",
  instances:
    "Running tasks, replicas or instances in this environment that sent telemetry in the last 15 minutes. It is a live count, so it ignores the selected time range.",
  requests:
    "Every span reported from this environment (matched by its cloud platform, account and region) in the selected range, across all its services. One user request often produces several spans, so this is usually higher than the request count.",
  errorRate:
    "The share of this environment's spans in the selected range whose status was set to Error; the line below is how many errored. The bar turns amber at 1% and red at 5%.",
  p95Latency:
    "p95 means the 95th percentile: 95% of the spans from this environment finished faster than this and the slowest 5% took longer. Worked out for each interval, then averaged over the selected range, so quiet and busy intervals count equally.",
  requestsChart:
    "Spans reported from this environment in each interval, with the ones whose status was Error as a second line. Every service running in the environment counts.",
  memoryChart:
    "Container memory (container.memory.usage) in this environment for each interval. Every reading in an interval is added up, so a container that reports more than once per interval counts more than once - read it as a trend, not a total.",
  topInstancesByCpu:
    "Up to five tasks or instances seen in the last 15 minutes, ordered by their latest CPU reading, highest first, with each one's latest memory in use; it ignores the selected time range. Ones that have not reported CPU show a dash and may be listed first.",
};

/*
 * The stat strip above the Cloud Environments list (Pages/Cloud/Utils/
 * CloudFleetSummary.ts). Counts of rows, not telemetry, so none of them has
 * a time range.
 */
export type CloudFleetMetric =
  | "environments"
  | "connected"
  | "disconnected"
  | "liveInstances";

export const CLOUD_FLEET_METRIC_DESCRIPTIONS: Record<CloudFleetMetric, string> =
  {
    environments:
      "Cloud environments in this project - one per cloud platform, account and region - not counting archived ones. The line below breaks them down by provider.",
    connected:
      "Environments currently marked as sending telemetry. One switches to disconnected after about 15 to 20 minutes with no logs, metrics or traces, and back as soon as telemetry returns.",
    disconnected:
      "Environments not currently sending telemetry: ones silent for about 15 minutes or more, and ones added by hand that have never reported. Check that the OpenTelemetry collector for each is running.",
    liveInstances:
      "Running tasks, replicas or instances that sent telemetry in the last 15 minutes, across every cloud environment in this project, archived ones included.",
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
  cpu: "The latest CPU reading this task or instance sent - one snapshot, not an average - kept until a newer one arrives. Depending on the platform, 100% is one full CPU core or all the CPU the task was given, so it can read above 100%. A dash means no CPU reading has arrived.",
  memory:
    "The latest memory-in-use reading this task or instance sent - one snapshot, not an average or a peak - kept until a newer one arrives. For an ECS task the whole task's figure is preferred over a single container's. A dash means no memory reading has arrived.",
};
