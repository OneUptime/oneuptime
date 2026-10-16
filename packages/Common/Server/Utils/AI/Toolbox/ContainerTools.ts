import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import {
  AIChatCitationTarget,
  AIChatWidget,
} from "../../../../Types/AI/AIChatTypes";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import MetricService from "../../../Services/MetricService";
import AggregateBy from "../../../Types/AnalyticsDatabase/AggregateBy";
import ContainerActivityUtil, {
  CONTAINER_SORT_BY_VALUES,
  ContainerActivity,
  ContainerActivitySummary,
  ContainerCpuBucket,
  ContainerSortBy,
  ContainerStatus,
} from "./ContainerActivity";
import { countBuckets } from "./MetricAttributeQuery";
import {
  AIResourceTelemetryScope,
  ScopedResource,
  getResourceCitationTarget,
  readScopedResource,
} from "./ResourceTools";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";

/*
 * query_containers - the containers of one Docker or Podman host, the
 * busiest first, and the ones that stopped reporting (issue #4785).
 *
 * query_resource_telemetry reads a host's metrics as the host's: an average
 * or a peak over every container. That hides the two things an on-call
 * engineer looks for first on a container host - the one container eating
 * the CPU, and the container that is not running any more - so this reads
 * them per container, from the metrics the host's collector exports for each
 * (docker_stats; Podman's collector uses the same receiver):
 *
 *   - container.cpu.utilization, per container and per bucket, from
 *     LOOKBACK_MINUTES before the window to its end: average and peak CPU,
 *     when each container was first and last seen, and its image;
 *   - container.memory.percent, peak per container in the window;
 *   - container.restarts, highest minus lowest per container in the window.
 *
 * Every read is held to the host the caller may read (the same parent read
 * and scope query_resource_telemetry uses), to the project, and to at most
 * MAX_CONTAINERS_READ containers and MAX_ACTIVITY_BUCKETS buckets.
 */

export const QUERY_CONTAINERS_TOOL_NAME: string = "query_containers";

// How far before the window a container counts as "seen before it".
export const LOOKBACK_MINUTES: number = 15;

// The most containers one call reads (the highest CPU peak first).
export const MAX_CONTAINERS_READ: number = 100;

// The most CPU buckets one call reads per container.
export const MAX_ACTIVITY_BUCKETS: number = 90;

const DEFAULT_CONTAINER_LIMIT: number = 10;
const MAX_CONTAINER_LIMIT: number = 25;

const CONTAINER_NAME_KEY: string = "resource.container.name";
const CONTAINER_IMAGE_KEY: string = "resource.container.image.name";

export const CONTAINER_CPU_METRIC: string = "container.cpu.utilization";
export const CONTAINER_MEMORY_METRIC: string = "container.memory.percent";
export const CONTAINER_RESTARTS_METRIC: string = "container.restarts";

const CONTAINER_HOST_TYPES: ReadonlyArray<AIResourceType> = [
  AIResourceType.DockerHost,
  AIResourceType.PodmanHost,
];

function getContainerHostType(args: JSONObject): AIResourceType {
  const value: string | undefined = ToolArgs.getString(args, "resourceType");

  if (!CONTAINER_HOST_TYPES.includes(value as AIResourceType)) {
    throw new BadDataException(
      "resourceType must be DockerHost or PodmanHost: only a Docker or Podman host reports its containers.",
    );
  }

  return value as AIResourceType;
}

function getHostReadPermissions(args: JSONObject): Array<Permission> {
  const value: string | undefined = ToolArgs.getString(args, "resourceType");

  if (value === AIResourceType.DockerHost) {
    return new DockerHost().getReadPermissions();
  }

  if (value === AIResourceType.PodmanHost) {
    return new PodmanHost().getReadPermissions();
  }

  return [];
}

// The metric read permissions, as query_resource_telemetry asks for them.
function getMetricPermissions(): Array<Permission> {
  const permissions: Array<Permission> = [...new Metric().getReadPermissions()];

  if (!permissions.includes(Permission.ReadAllOperationalResources)) {
    permissions.push(Permission.ReadAllOperationalResources);
  }

  return permissions;
}

/*
 * The smallest bucket that keeps the lookback and the window within
 * MAX_ACTIVITY_BUCKETS: a minute for any window up to about an hour, which
 * is what "it stopped three minutes before the incident" needs.
 */
export function chooseActivityInterval(
  readStart: Date,
  endTime: Date,
): AggregationInterval {
  const intervals: Array<AggregationInterval> = [
    AggregationInterval.Minute,
    AggregationInterval.FiveMinutes,
    AggregationInterval.FifteenMinutes,
    AggregationInterval.ThirtyMinutes,
    AggregationInterval.Hour,
    AggregationInterval.Day,
  ];

  return (
    intervals.find((interval: AggregationInterval): boolean => {
      return (
        countBuckets({ startTime: readStart, endTime, interval }) <=
        MAX_ACTIVITY_BUCKETS
      );
    }) || AggregationInterval.Day
  );
}

function formatPercent(value: number | null): string {
  return value === null ? "no data" : String(Number(value.toFixed(1)));
}

export const QueryContainersTool: ObservabilityTool = {
  name: QUERY_CONTAINERS_TOOL_NAME,
  description:
    "List the containers of one Docker or Podman host over a time window: the containers that STOPPED reporting first (a stopped or crashed container sends no data rather than a zero, so it is invisible in host-wide numbers), then the busiest. Each row has the container's image, average and peak CPU (percent of one core), peak memory (percent), restarts in the window, and when it was last seen. Containers seen in the 15 minutes before the window count too, so a container that stopped just before an incident shows. Use it for a Docker or Podman host linked to an incident's monitors; resourceId comes from the investigation's starting context or query_telemetry_resources.",
  inputSchema: {
    type: "object",
    properties: {
      resourceType: {
        type: "string",
        enum: [...CONTAINER_HOST_TYPES],
        description: "DockerHost or PodmanHost (required).",
      },
      resourceId: {
        type: "string",
        description:
          "The host's OneUptime UUID (required), from the starting context or query_telemetry_resources.",
      },
      ...TimeRangeSchemaProperties,
      sortBy: {
        type: "string",
        enum: [...CONTAINER_SORT_BY_VALUES],
        description:
          "What 'busiest' means: cpu (default, average CPU), memory (peak memory) or restarts. Containers that stopped reporting always come first.",
      },
      limit: {
        type: "number",
        description: `Maximum containers listed (default ${DEFAULT_CONTAINER_LIMIT}, max ${MAX_CONTAINER_LIMIT}).`,
      },
    },
    required: ["resourceType", "resourceId"],
  },
  get requiredPermissions(): Array<Permission> {
    return Array.from(
      new Set([
        ...new DockerHost().getReadPermissions(),
        ...new PodmanHost().getReadPermissions(),
      ]),
    );
  },
  getRequiredPermissionGroups: (args: JSONObject): Array<Array<Permission>> => {
    // The host itself, and its metrics - each with its own read list.
    return [getHostReadPermissions(args), getMetricPermissions()];
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const type: AIResourceType = getContainerHostType(args);
    const rawId: string | undefined = ToolArgs.getString(args, "resourceId");

    if (!rawId || !ObjectID.isValidUUID(rawId)) {
      throw new BadDataException(
        "resourceId must be the host's OneUptime UUID. Find it in the starting context or with query_telemetry_resources.",
      );
    }

    const id: ObjectID = new ObjectID(rawId);
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 1,
      maxDays: 7,
    });
    const sortByArg: string = ToolArgs.getString(args, "sortBy") || "cpu";

    if (!CONTAINER_SORT_BY_VALUES.includes(sortByArg as ContainerSortBy)) {
      throw new BadDataException("sortBy must be cpu, memory or restarts.");
    }

    const sortBy: ContainerSortBy = sortByArg as ContainerSortBy;
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: DEFAULT_CONTAINER_LIMIT,
      min: 1,
      max: MAX_CONTAINER_LIMIT,
    });

    // The host, read as the caller may read it; not found reads nothing.
    const { resource, scope }: ScopedResource = await readScopedResource({
      type,
      id,
      signal: "metrics",
      ctx,
    });
    const hostName: string =
      ToolArgs.getString(resource, "name") ||
      ToolArgs.getString(resource, "hostIdentifier") ||
      id.toString();
    const hostLabel: string = `${type === AIResourceType.DockerHost ? "Docker host" : "Podman host"} ${hostName}`;

    const readStart: Date = OneUptimeDate.addRemoveMinutes(
      startTime,
      -LOOKBACK_MINUTES,
    );
    const interval: AggregationInterval = chooseActivityInterval(
      readStart,
      endTime,
    );
    const bucketCount: number = countBuckets({
      startTime: readStart,
      endTime,
      interval,
    });

    const [cpu, memory, restartsHigh, restartsLow]: [
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
    ] = await Promise.all([
      readContainerMetric({
        scope,
        ctx,
        metricName: CONTAINER_CPU_METRIC,
        aggregationType: AggregationType.Avg,
        groupBy: [CONTAINER_NAME_KEY, CONTAINER_IMAGE_KEY],
        startTime: readStart,
        endTime,
        interval,
        bucketCount,
      }),
      readContainerMetric({
        scope,
        ctx,
        metricName: CONTAINER_MEMORY_METRIC,
        aggregationType: AggregationType.Max,
        groupBy: [CONTAINER_NAME_KEY],
        startTime,
        endTime,
        interval: AggregationInterval.Total,
        bucketCount: 1,
      }),
      readContainerMetric({
        scope,
        ctx,
        metricName: CONTAINER_RESTARTS_METRIC,
        aggregationType: AggregationType.Max,
        groupBy: [CONTAINER_NAME_KEY],
        startTime,
        endTime,
        interval: AggregationInterval.Total,
        bucketCount: 1,
      }),
      readContainerMetric({
        scope,
        ctx,
        metricName: CONTAINER_RESTARTS_METRIC,
        aggregationType: AggregationType.Min,
        groupBy: [CONTAINER_NAME_KEY],
        startTime,
        endTime,
        interval: AggregationInterval.Total,
        bucketCount: 1,
      }),
    ]);

    const restarts: Map<string, number> = new Map<string, number>();
    const lowest: Map<string, number> = readPerContainer(restartsLow);

    for (const [name, highest] of readPerContainer(restartsHigh)) {
      const low: number | undefined = lowest.get(name);

      if (low !== undefined) {
        restarts.set(name, Math.max(0, Math.round(highest - low)));
      }
    }

    const summary: ContainerActivitySummary = ContainerActivityUtil.summarize({
      buckets: cpu.data.map((row: AggregatedModel): ContainerCpuBucket => {
        const attributes: Record<string, unknown> = readAttributes(row);
        const value: number = Number(row.value);

        return {
          containerName: String(attributes[CONTAINER_NAME_KEY] ?? ""),
          imageName: String(attributes[CONTAINER_IMAGE_KEY] ?? ""),
          bucketStart: new Date(row.timestamp),
          cpuPercent: Number.isFinite(value) ? value : null,
        };
      }),
      windowStart: startTime,
      windowEnd: endTime,
      bucketMs: AggregationIntervalUtil.getAggregationIntervalMs(interval),
      memoryPeaks: readPerContainer(memory),
      restarts,
    });

    const sorted: Array<ContainerActivity> = ContainerActivityUtil.sort(
      summary.containers,
      sortBy,
    );
    const listed: Array<ContainerActivity> = sorted.slice(0, limit);
    const rows: Array<JSONObject> = listed.map(
      (container: ContainerActivity): JSONObject => {
        return {
          container: container.containerName,
          image: container.imageName || "unknown",
          ...(container.previousImageNames.length > 0
            ? {
                imageChangedFrom: container.previousImageNames.join(", "),
              }
            : {}),
          status: container.status,
          lastSeen: container.lastSeenAt.toISOString(),
          ...(container.status === ContainerStatus.StartedInWindow
            ? { firstSeen: container.firstSeenAt.toISOString() }
            : {}),
          cpuAvgPercent: formatPercent(container.cpuAverage),
          cpuPeakPercent: formatPercent(container.cpuPeak),
          memoryPeakPercent: formatPercent(container.memoryPeak),
          restartsInWindow:
            container.restartsInWindow === null
              ? "no data"
              : container.restartsInWindow,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);
    const window: string = `${startTime.toISOString()} – ${endTime.toISOString()}`;
    const target: AIChatCitationTarget = getResourceCitationTarget(type, id);
    const isTruncated: boolean =
      serialized.isTruncated ||
      sorted.length > listed.length ||
      Boolean(cpu.truncated);

    const notes: Array<string> = [
      `Containers of ${hostLabel}, window ${window} (containers seen in the ${LOOKBACK_MINUTES} minutes before it count too).`,
    ];

    if (summary.containers.length === 0) {
      notes.push(
        `No container reported ${CONTAINER_CPU_METRIC} for this host in that time. The host's collector may not be running, or it runs no containers. Missing data is not evidence of health.`,
      );
    } else {
      notes.push(
        `${summary.containers.length} container(s) reported; ${summary.stoppedCount} stopped reporting${
          summary.hostLastSeenAt
            ? ` (silent for at least 2 minutes while the host's other containers kept reporting, up to ${summary.hostLastSeenAt.toISOString()})`
            : ""
        }. A stopped or crashed container sends nothing rather than zero.`,
      );
      notes.push(
        `Stopped containers first, then the busiest by ${sortBy}. CPU is in percent of one core (100 = one full core), averaged per bucket; memory is the peak percent of the container's limit or the host's memory.`,
      );

      if (sorted.length > listed.length) {
        notes.push(
          `Listing ${listed.length} of ${sorted.length}: raise limit (max ${MAX_CONTAINER_LIMIT}) or sort differently to see others.`,
        );
      }

      if (cpu.truncated) {
        notes.push(
          `More than ${MAX_CONTAINERS_READ} containers matched or the read reached its row limit: these are the ones with the highest CPU peak. Use a shorter window for the rest.`,
        );
      }

      if (
        summary.hostLastSeenAt &&
        endTime.getTime() - summary.hostLastSeenAt.getTime() > 10 * 60 * 1000
      ) {
        notes.push(
          `The host's containers last reported at ${summary.hostLastSeenAt.toISOString()}, well before the window's end: the whole collector may have stopped.`,
        );
      }
    }

    return {
      dataForLlm: `${serialized.text}\n${notes.join(" ")}`,
      rowCount: listed.length,
      citationLabel: `Containers of ${hostLabel}, ${window}`,
      citationTarget: target,
      redactionCount: serialized.redactionCount,
      isTruncated,
      widget: buildContainersWidget({
        hostLabel,
        window,
        containers: listed,
        target,
      }),
    };
  },
};

/*
 * One container metric of the host, grouped per container, held to the
 * project and the host's scope - the same query shape
 * query_resource_telemetry reads a host's metrics with.
 */
async function readContainerMetric(data: {
  scope: AIResourceTelemetryScope;
  ctx: ToolContext;
  metricName: string;
  aggregationType: AggregationType;
  groupBy: Array<string>;
  startTime: Date;
  endTime: Date;
  interval: AggregationInterval;
  bucketCount: number;
}): Promise<AggregatedResult> {
  const query: JSONObject = {
    projectId: data.ctx.projectId,
    name: data.metricName,
    time: new InBetween(data.startTime, data.endTime),
    ...(data.scope.resourceScopes
      ? {
          resourceEntityScopes: data.scope
            .resourceScopes as unknown as JSONValue,
        }
      : {}),
    ...(data.scope.attributes ? { attributes: data.scope.attributes } : {}),
  };

  const aggregateBy: AggregateBy<Metric> = {
    query: query as never,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    aggregationType: data.aggregationType,
    aggregationInterval: data.interval,
    startTimestamp: data.startTime,
    endTimestamp: data.endTime,
    groupByAttributeKeys: data.groupBy,
    topK: { count: MAX_CONTAINERS_READ, rankBy: "max" },
    sort: { time: SortOrder.Ascending } as never,
    limit: Math.min(
      LIMIT_PER_PROJECT,
      MAX_CONTAINERS_READ * (data.bucketCount + 1),
    ),
    skip: 0,
    props: data.ctx.props,
  };

  return await MetricService.aggregateBy(aggregateBy);
}

function readAttributes(row: AggregatedModel): Record<string, unknown> {
  const raw: unknown = row["attributes"];

  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

// A whole-window grouped read, as container name -> value.
function readPerContainer(result: AggregatedResult): Map<string, number> {
  const values: Map<string, number> = new Map<string, number>();

  for (const row of result.data) {
    const name: string = String(
      readAttributes(row)[CONTAINER_NAME_KEY] ?? "",
    ).trim();
    const value: number = Number(row.value);

    if (name && Number.isFinite(value)) {
      values.set(name, value);
    }
  }

  return values;
}

function buildContainersWidget(data: {
  hostLabel: string;
  window: string;
  containers: Array<ContainerActivity>;
  target: AIChatCitationTarget;
}): AIChatWidget | undefined {
  if (data.containers.length === 0) {
    return undefined;
  }

  return WidgetBuilder.table({
    title: `Containers of ${data.hostLabel}`,
    description: data.window,
    columns: [
      { key: "container", title: "Container" },
      { key: "image", title: "Image" },
      { key: "status", title: "Status" },
      { key: "cpuAvg", title: "CPU avg %", type: "number" },
      { key: "cpuPeak", title: "CPU peak %", type: "number" },
      { key: "memoryPeak", title: "Memory peak %", type: "number" },
      { key: "restarts", title: "Restarts", type: "number" },
      { key: "lastSeen", title: "Last seen", type: "date" },
    ],
    rows: data.containers.map((container: ContainerActivity): JSONObject => {
      return {
        container: container.containerName,
        image: container.imageName,
        status: container.status,
        cpuAvg: container.cpuAverage,
        cpuPeak: container.cpuPeak,
        memoryPeak: container.memoryPeak,
        restarts: container.restartsInWindow,
        lastSeen: container.lastSeenAt.toISOString(),
      };
    }),
    link: data.target,
  });
}
