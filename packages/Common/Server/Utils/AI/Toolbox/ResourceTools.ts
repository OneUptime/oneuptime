import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import IoTFleet from "../../../../Models/DatabaseModels/IoTFleet";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span from "../../../../Models/AnalyticsModels/Span";
import {
  AIResourceType,
  isAIResourceType,
  getAIResourceDefinition,
} from "../../../../Types/AI/AIResourceContext";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
  AIChatWidget,
} from "../../../../Types/AI/AIChatTypes";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  keyForHost,
  keyForKubernetesCluster,
  keyForDockerSwarmCluster,
  keyForProxmoxCluster,
  keyForVMwareVCenter,
  keyForCephCluster,
} from "../../../../Utils/Telemetry/EntityKey";
import HostService from "../../../Services/HostService";
import DockerHostService from "../../../Services/DockerHostService";
import PodmanHostService from "../../../Services/PodmanHostService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import DockerSwarmClusterService from "../../../Services/DockerSwarmClusterService";
import ProxmoxClusterService from "../../../Services/ProxmoxClusterService";
import VMwareVCenterService from "../../../Services/VMwareVCenterService";
import CephClusterService from "../../../Services/CephClusterService";
import ServerlessFunctionService from "../../../Services/ServerlessFunctionService";
import CloudResourceService from "../../../Services/CloudResourceService";
import IoTFleetService from "../../../Services/IoTFleetService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import MetricService from "../../../Services/MetricService";
import LogAggregationService, {
  HistogramBucket,
} from "../../../Services/LogAggregationService";
import TraceAggregationService, {
  TraceAnalyticsTableRow,
} from "../../../Services/TraceAggregationService";
import FindBy from "../../../Types/Database/FindBy";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Types/AnalyticsDatabase/ModelPermission";
import { ResourceEntityScope } from "../../Telemetry/ResourceEntityFilter";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";

type ResourceSignal = "metrics" | "logs" | "traces";

interface ResourceDescriptor {
  model: new () => BaseModel;
  findBy: (data: FindBy<BaseModel>) => Promise<Array<BaseModel>>;
  fields: Array<string>;
  identifier?: string;
  attributeKey?: string;
  keyFor?: (projectId: string, identifier: string) => string;
  runtime?: string;
}

/*
 * Explicit allowlists are essential here: resource records can also contain
 * SSH, SNMP and integration credentials. Neither inventory nor scope
 * resolution ever selects or serializes an entire model.
 */
const RESOURCE_DESCRIPTORS: Record<AIResourceType, ResourceDescriptor> = {
  [AIResourceType.Host]: {
    model: Host,
    findBy: (data: FindBy<BaseModel>) => {
      return HostService.findBy(data as never);
    },
    fields: ["hostIdentifier", "cpuCores", "totalMemoryBytes", "processCount"],
    identifier: "hostIdentifier",
    attributeKey: "resource.host.name",
    keyFor: keyForHost,
  },
  [AIResourceType.DockerHost]: {
    model: DockerHost,
    findBy: (data: FindBy<BaseModel>) => {
      return DockerHostService.findBy(data as never);
    },
    fields: [
      "hostIdentifier",
      "containersRunning",
      "containersStopped",
      "containersPaused",
    ],
    identifier: "hostIdentifier",
    attributeKey: "resource.host.name",
    keyFor: keyForHost,
    runtime: "docker",
  },
  [AIResourceType.PodmanHost]: {
    model: PodmanHost,
    findBy: (data: FindBy<BaseModel>) => {
      return PodmanHostService.findBy(data as never);
    },
    fields: [
      "hostIdentifier",
      "containersRunning",
      "containersStopped",
      "containersPaused",
    ],
    identifier: "hostIdentifier",
    attributeKey: "resource.host.name",
    keyFor: keyForHost,
    runtime: "podman",
  },
  [AIResourceType.KubernetesCluster]: {
    model: KubernetesCluster,
    findBy: (data: FindBy<BaseModel>) => {
      return KubernetesClusterService.findBy(data as never);
    },
    fields: [
      "clusterIdentifier",
      "provider",
      "nodeCount",
      "podCount",
      "namespaceCount",
    ],
    identifier: "clusterIdentifier",
    attributeKey: "resource.k8s.cluster.name",
    keyFor: keyForKubernetesCluster,
  },
  [AIResourceType.DockerSwarmCluster]: {
    model: DockerSwarmCluster,
    findBy: (data: FindBy<BaseModel>) => {
      return DockerSwarmClusterService.findBy(data as never);
    },
    fields: [
      "nodeCount",
      "readyNodeCount",
      "managerNodeCount",
      "serviceCount",
      "taskCount",
      "runningTaskCount",
      "stackCount",
    ],
    identifier: "name",
    attributeKey: "resource.docker.swarm.cluster.name",
    keyFor: keyForDockerSwarmCluster,
  },
  [AIResourceType.ProxmoxCluster]: {
    model: ProxmoxCluster,
    findBy: (data: FindBy<BaseModel>) => {
      return ProxmoxClusterService.findBy(data as never);
    },
    fields: [
      "nodeCount",
      "onlineNodeCount",
      "guestCount",
      "storageCount",
      "guestsWithoutBackupCount",
    ],
    identifier: "name",
    attributeKey: "resource.proxmox.cluster.name",
    keyFor: keyForProxmoxCluster,
  },
  [AIResourceType.VMwareVCenter]: {
    model: VMwareVCenter,
    findBy: (data: FindBy<BaseModel>) => {
      return VMwareVCenterService.findBy(data as never);
    },
    fields: [
      "datacenterCount",
      "clusterCount",
      "hostCount",
      "vmCount",
      "poweredOnVmCount",
      "datastoreCount",
    ],
    identifier: "name",
    attributeKey: "resource.vmware.vcenter.name",
    keyFor: keyForVMwareVCenter,
  },
  [AIResourceType.CephCluster]: {
    model: CephCluster,
    findBy: (data: FindBy<BaseModel>) => {
      return CephClusterService.findBy(data as never);
    },
    fields: [
      "healthStatus",
      "capacityUsedPercent",
      "monCount",
      "osdCount",
      "osdUpCount",
      "osdInCount",
      "poolCount",
    ],
    identifier: "name",
    attributeKey: "resource.ceph.cluster.name",
    keyFor: keyForCephCluster,
  },
  [AIResourceType.ServerlessFunction]: {
    model: ServerlessFunction,
    findBy: (data: FindBy<BaseModel>) => {
      return ServerlessFunctionService.findBy(data as never);
    },
    fields: [
      "functionIdentifier",
      "cloudPlatform",
      "cloudProvider",
      "cloudRegion",
      "runtimeName",
    ],
    identifier: "functionIdentifier",
    attributeKey: "resource.faas.name",
  },
  [AIResourceType.CloudResource]: {
    model: CloudResource,
    findBy: (data: FindBy<BaseModel>) => {
      return CloudResourceService.findBy(data as never);
    },
    fields: [
      "resourceIdentifier",
      "cloudPlatform",
      "cloudProvider",
      "cloudAccountId",
      "cloudRegion",
      "runtimeName",
    ],
  },
  [AIResourceType.IoTFleet]: {
    model: IoTFleet,
    findBy: (data: FindBy<BaseModel>) => {
      return IoTFleetService.findBy(data as never);
    },
    fields: ["deviceCount", "onlineDeviceCount"],
    identifier: "name",
    attributeKey: "resource.iot.fleet.name",
  },
  [AIResourceType.NetworkDevice]: {
    model: NetworkDevice,
    findBy: (data: FindBy<BaseModel>) => {
      return NetworkDeviceService.findBy(data as never);
    },
    fields: [
      "isReachable",
      "isSnmpReachable",
      "interfacesTotal",
      "interfacesUp",
      "interfacesDown",
      "lastPolledAt",
    ],
  },
};

function getResourceType(args: JSONObject): AIResourceType {
  const value: string | undefined = ToolArgs.getString(args, "resourceType");
  if (!isAIResourceType(value)) {
    throw new BadDataException(
      "resourceType must be a supported infrastructure model name.",
    );
  }
  return value;
}

function getResourceId(
  args: JSONObject,
  required: boolean,
): ObjectID | undefined {
  if (args["resourceId"] === undefined && !required) {
    return undefined;
  }
  const value: string | undefined = ToolArgs.getString(args, "resourceId");
  if (!value || !ObjectID.isValidUUID(value)) {
    throw new BadDataException(
      "resourceId must be a valid OneUptime UUID. Resolve names with query_telemetry_resources.",
    );
  }
  return new ObjectID(value);
}

function getSignal(args: JSONObject): ResourceSignal {
  const signal: string | undefined = ToolArgs.getString(args, "signal");
  if (signal !== "metrics" && signal !== "logs" && signal !== "traces") {
    throw new BadDataException("signal must be metrics, logs or traces.");
  }
  return signal;
}

function getFields(type: AIResourceType): Array<string> {
  return [
    "_id",
    "name",
    "lastSeenAt",
    "isArchived",
    ...(type === AIResourceType.NetworkDevice ? [] : ["otelCollectorStatus"]),
    ...RESOURCE_DESCRIPTORS[type].fields,
  ];
}

function getResourcePermissions(args: JSONObject): Array<Permission> {
  const type: string | undefined = ToolArgs.getString(args, "resourceType");
  return isAIResourceType(type)
    ? new RESOURCE_DESCRIPTORS[type].model().getReadPermissions()
    : [];
}

function resourceTarget(
  type: AIResourceType,
  id?: ObjectID,
): AIChatCitationTarget {
  return {
    type: id
      ? AIChatCitationTargetType.TelemetryResourceView
      : AIChatCitationTargetType.TelemetryResources,
    params: {
      resourceType: type,
      ...(id ? { resourceId: id.toString() } : {}),
    },
  };
}

const RESOURCE_SCHEMA_PROPERTIES: JSONObject = {
  resourceType: {
    type: "string",
    enum: Object.values(AIResourceType),
    description: "Infrastructure resource kind (required).",
  },
  resourceId: {
    type: "string",
    description:
      "OneUptime resource UUID, resolved with query_telemetry_resources.",
  },
};

function resultForRows(data: {
  rows: Array<JSONObject>;
  label: string;
  target: AIChatCitationTarget;
  note: string;
  truncated?: boolean;
  widget?: AIChatWidget | undefined;
}): ToolExecutionResult {
  const serialized: SerializedResult = ToolResultSerializer.serializeRows(
    data.rows,
  );
  return {
    dataForLlm: `${serialized.text || "No matching data."}\n${data.note}`,
    rowCount: serialized.rowCount,
    citationLabel: data.label,
    citationTarget: data.target,
    redactionCount: serialized.redactionCount,
    isTruncated: serialized.isTruncated || Boolean(data.truncated),
    widget: data.widget,
  };
}

export const QueryTelemetryResourcesTool: ObservabilityTool = {
  name: "query_telemetry_resources",
  description:
    "Discover infrastructure resources of one kind, their OneUptime IDs, last-seen timestamps, collector or reachability status and safe inventory counts. Pass resourceId for one resource. Counts are snapshots, not historical trends; collector connection does not establish workload health. No credentials or child configuration are returned.",
  inputSchema: {
    type: "object",
    properties: {
      ...RESOURCE_SCHEMA_PROPERTIES,
      search: {
        type: "string",
        description: "Only resource names containing this text.",
      },
      includeArchived: {
        type: "boolean",
        description:
          "Include archived resources (default false; an explicit resourceId also includes archived).",
      },
      limit: {
        type: "number",
        description: "Maximum resources (default20, max50).",
      },
      skip: { type: "number", description: "Rows to skip (default0, max500)." },
    },
    required: ["resourceType"],
  },
  get requiredPermissions(): Array<Permission> {
    return Array.from(
      new Set(
        Object.values(RESOURCE_DESCRIPTORS).flatMap(
          (descriptor: ResourceDescriptor): Array<Permission> => {
            return new descriptor.model().getReadPermissions();
          },
        ),
      ),
    );
  },
  getRequiredPermissionGroups: (args: JSONObject): Array<Array<Permission>> => {
    return [getResourcePermissions(args)];
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const type: AIResourceType = getResourceType(args);
    const id: ObjectID | undefined = getResourceId(args, false);
    const limit: number = id
      ? 1
      : ToolArgs.getNumber(args, "limit", {
          defaultValue: 20,
          min: 1,
          max: 50,
        });
    const query: JSONObject = { projectId: ctx.projectId };
    if (id) {
      query["_id"] = id.toString();
    } else if (!ToolArgs.getBoolean(args, "includeArchived")) {
      query["isArchived"] = false;
    }
    const search: string | undefined = ToolArgs.getString(args, "search");
    if (search) {
      query["name"] = QueryHelper.search(search);
    }
    const fields: Array<string> = getFields(type);
    const models: Array<BaseModel> = await RESOURCE_DESCRIPTORS[type].findBy({
      query: query as never,
      select: Object.fromEntries(
        fields.map((field: string): [string, boolean] => {
          return [field, true];
        }),
      ),
      sort: { name: SortOrder.Ascending } as never,
      limit,
      skip: id
        ? 0
        : ToolArgs.getNumber(args, "skip", {
            defaultValue: 0,
            min: 0,
            max: 500,
          }),
      props: ctx.props,
    });
    const rows: Array<JSONObject> = models.map(
      (model: BaseModel): JSONObject => {
        const row: JSONObject = { resourceType: type };
        const record: JSONObject = model as unknown as JSONObject;
        for (const field of fields) {
          // Reading own selected fields preserves real zero/false, unlike getColumnValue.
          row[field === "_id" ? "resourceId" : field] =
            record[field] ?? "unknown";
        }
        return row;
      },
    );
    return resultForRows({
      rows,
      label: getAIResourceDefinition(type).pluralLabel,
      target: resourceTarget(type, id),
      truncated: !id && rows.length >= limit,
      note:
        "Inventory snapshots are as of lastSeenAt; missing values are unknown. Collector connection is not workload health. Results are limited to resources you can read." +
        (!id && rows.length >= limit
          ? " Result limit reached; paginate before making fleet-wide claims."
          : ""),
    });
  },
};

export interface AIResourceTelemetryScope {
  resourceScopes?: Array<ResourceEntityScope>;
  attributes?: Record<string, string> | undefined;
  note: string;
}

/*
 * Build only from a project-pinned, permission-checked parent lookup. The
 * membership OR deliberately covers primary agent rows, secondary OTLP entity
 * keys and legacy attributes. A missing identifier must never become an
 * unfiltered query or an apparently complete id-only answer.
 */
export function buildAIResourceTelemetryScope(data: {
  type: AIResourceType;
  id: ObjectID;
  resource: JSONObject;
  projectId: ObjectID;
  signal: ResourceSignal;
}): AIResourceTelemetryScope {
  const descriptor: ResourceDescriptor = RESOURCE_DESCRIPTORS[data.type];
  const note: string =
    "Scope is the parent resource; no individual child identity or namespace was selected. Missing telemetry is not evidence of health.";
  if (data.type === AIResourceType.CloudResource) {
    const attributes: Record<string, string> = {};
    for (const [column, key] of [
      ["cloudPlatform", "resource.cloud.platform"],
      ["cloudAccountId", "resource.cloud.account.id"],
      ["cloudRegion", "resource.cloud.region"],
    ]) {
      const value: string | undefined = ToolArgs.getString(
        data.resource,
        column!,
      );
      if (value) {
        attributes[key!] = value;
      }
    }
    if (!attributes["resource.cloud.platform"]) {
      throw new BadDataException(
        "This cloud environment has no cloud platform identity yet; its telemetry cannot be scoped safely.",
      );
    }
    return { attributes, note };
  }
  if (data.type === AIResourceType.NetworkDevice) {
    return data.signal === "logs"
      ? { attributes: { "networkDevice.id": data.id.toString() }, note }
      : {
          resourceScopes: [{ entityIds: [data.id.toString()], entityKeys: [] }],
          note: `${note} Network metrics use the device's primary ID; traces are only spans explicitly assigned to that device.`,
        };
  }
  const identifier: string | undefined = ToolArgs.getString(
    data.resource,
    descriptor.identifier!,
  );
  if (!identifier) {
    throw new BadDataException(
      "This resource has no telemetry identifier yet; its telemetry cannot be scoped safely.",
    );
  }
  return {
    resourceScopes: [
      {
        entityIds: [data.id.toString()],
        entityKeys: descriptor.keyFor
          ? [descriptor.keyFor(data.projectId.toString(), identifier)]
          : [],
        attributeKey: descriptor.attributeKey,
        attributeValues: [identifier],
      },
    ],
    attributes:
      descriptor.runtime && data.signal !== "traces"
        ? { "resource.container.runtime": descriptor.runtime }
        : undefined,
    note:
      descriptor.runtime && data.signal === "traces"
        ? `${note} Traces match the host, as in the resource dashboard; they are not attributed to a particular container runtime.`
        : note,
  };
}

function metricInterval(startTime: Date, endTime: Date): AggregationInterval {
  /*
   * Keep the full window under the serializer's 50-row budget, including
   * partial first/last buckets. Never truncate the tail of a trend chart.
   */
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
        Math.ceil(
          (endTime.getTime() - startTime.getTime()) /
            AggregationIntervalUtil.getAggregationIntervalMs(interval),
        ) +
          1 <=
        49
      );
    }) || AggregationInterval.Day
  );
}

export const QueryResourceTelemetryTool: ObservabilityTool = {
  name: "query_resource_telemetry",
  description:
    "Query metrics, log severity volume or trace operation/error/latency summaries for one accessible infrastructure resource. Safely includes secondary resource membership. Metrics without metricName discover names seen in this resource/time window; with a name return a bounded trend (default) or whole-window summary. No child/pod/container rankings or raw log messages. Missing data cannot establish health.",
  inputSchema: {
    type: "object",
    properties: {
      ...RESOURCE_SCHEMA_PROPERTIES,
      ...TimeRangeSchemaProperties,
      signal: { type: "string", enum: ["metrics", "logs", "traces"] },
      metricName: {
        type: "string",
        description: "Exact metric name; omit to discover scoped metric names.",
      },
      aggregationType: {
        type: "string",
        enum: ["Avg", "Min", "Max", "Sum", "Count", "P50", "P90", "P95", "P99"],
        description:
          "Metric aggregation (defaultAvg); counter sums are exported values, not derived rates.",
      },
      mode: {
        type: "string",
        enum: ["trend", "summary"],
        description:
          "Metric mode (defaulttrend); trend uses at most49 time buckets.",
      },
      severityText: {
        type: "string",
        description: "Logs only: match this exact severity before counting.",
      },
      rootOnly: {
        type: "boolean",
        description: "Traces only: restrict to root spans.",
      },
      limit: {
        type: "number",
        description:
          "Maximum metric names or trace operation groups (default20, max50). Does not truncate time buckets.",
      },
    },
    required: ["resourceType", "resourceId", "signal"],
  },
  get requiredPermissions(): Array<Permission> {
    return QueryTelemetryResourcesTool.requiredPermissions;
  },
  getRequiredPermissionGroups: (args: JSONObject): Array<Array<Permission>> => {
    const signal: string | undefined = ToolArgs.getString(args, "signal");
    const model: Metric | Log | Span | undefined =
      signal === "metrics"
        ? new Metric()
        : signal === "logs"
          ? new Log()
          : signal === "traces"
            ? new Span()
            : undefined;
    const permissions: Array<Permission> = model
      ? [...model.getReadPermissions()]
      : [];
    /*
     * Match the analytics model's effective table/owned-scope permissions.
     * Infrastructure parent models retain their separate literal read ACL;
     * a telemetry wildcard must never authorize an unrelated parent record.
     */
    if (
      model &&
      (model as unknown as { isOperationalResource?: boolean })
        .isOperationalResource &&
      !permissions.includes(Permission.ReadAllOperationalResources)
    ) {
      permissions.push(Permission.ReadAllOperationalResources);
    }
    return [getResourcePermissions(args), permissions];
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const type: AIResourceType = getResourceType(args);
    const id: ObjectID = getResourceId(args, true)!;
    const signal: ResourceSignal = getSignal(args);
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 1,
      maxDays: 30,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 20,
      min: 1,
      max: 50,
    });
    const descriptor: ResourceDescriptor = RESOURCE_DESCRIPTORS[type];
    const resources: Array<BaseModel> = await descriptor.findBy({
      query: { projectId: ctx.projectId, _id: id.toString() } as never,
      select: Object.fromEntries(
        getFields(type).map((field: string): [string, boolean] => {
          return [field, true];
        }),
      ),
      limit: 1,
      skip: 0,
      props: ctx.props,
    });
    if (!resources[0]) {
      throw new BadDataException(
        "Resource not found or you do not have access to it.",
      );
    }
    const scope: AIResourceTelemetryScope = buildAIResourceTelemetryScope({
      type,
      id,
      resource: resources[0] as unknown as JSONObject,
      projectId: ctx.projectId,
      signal,
    });
    const target: AIChatCitationTarget = resourceTarget(type, id);
    const label: string = `${getAIResourceDefinition(type).label} ${signal}, ${startTime.toISOString()} – ${endTime.toISOString()}`;
    const note: string = `${scope.note} Requested window: ${startTime.toISOString()} – ${endTime.toISOString()}.`;
    if (signal === "metrics") {
      const name: string | undefined = ToolArgs.getString(args, "metricName");
      const aggregation: string =
        ToolArgs.getString(args, "aggregationType") || "Avg";
      const mode: string = ToolArgs.getString(args, "mode") || "trend";
      if (
        !Object.values(AggregationType).includes(aggregation as AggregationType)
      ) {
        throw new BadDataException("Invalid aggregationType.");
      }
      if (mode !== "trend" && mode !== "summary") {
        throw new BadDataException("mode must be trend or summary.");
      }
      const interval: AggregationInterval =
        !name || mode === "summary"
          ? AggregationInterval.Total
          : metricInterval(startTime, endTime);
      const query: JSONObject = {
        projectId: ctx.projectId,
        time: new InBetween(startTime, endTime),
        ...(name ? { name } : {}),
        ...(scope.resourceScopes
          ? {
              resourceEntityScopes:
                scope.resourceScopes as unknown as JSONValue,
            }
          : {}),
        ...(scope.attributes ? { attributes: scope.attributes } : {}),
      };
      const aggregate: (
        aggregationType: AggregationType,
      ) => Promise<AggregatedResult> = async (
        aggregationType: AggregationType,
      ): Promise<AggregatedResult> => {
        return MetricService.aggregateBy({
          query: query as never,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          aggregationType,
          aggregationInterval: interval,
          startTimestamp: startTime,
          endTimestamp: endTime,
          ...(!name ? { groupBy: { name: true } } : {}),
          sort: { time: SortOrder.Ascending } as never,
          limit: name ? 50 : limit,
          skip: 0,
          props: ctx.props,
        });
      };
      const result: AggregatedResult = await aggregate(
        name ? (aggregation as AggregationType) : AggregationType.Count,
      );
      /*
       * Distribution exports with zero observations have an aggregate value of
       * zero. Count distinguishes those from real zero-valued scalar samples.
       */
      const counts: AggregatedResult =
        name && aggregation !== AggregationType.Count
          ? await aggregate(AggregationType.Count)
          : result;
      const countsByTime: Map<string, number> = new Map(
        counts.data.map((item: AggregatedModel): [string, number] => {
          return [String(item.timestamp), item.value];
        }),
      );
      const rows: Array<JSONObject> = result.data.map(
        (item: AggregatedModel): JSONObject => {
          if (!name) {
            return { metricName: item["name"], observationCount: item.value };
          }
          const count: number | undefined = countsByTime.get(
            String(item.timestamp),
          );
          const hasValue: boolean =
            typeof count === "number" &&
            count > 0 &&
            typeof item.value === "number" &&
            Number.isFinite(item.value);
          return {
            timestamp: item.timestamp,
            value: hasValue ? item.value : null,
            observationCount: count ?? null,
            ...(hasValue
              ? {}
              : {
                  status:
                    count === 0 ? "no observations" : "aggregate unavailable",
                }),
          };
        },
      );
      const widget: AIChatWidget | undefined =
        name && mode === "trend" && rows.length > 0
          ? WidgetBuilder.timeSeries({
              title: `${aggregation}(${name})`,
              description: note,
              series: [
                {
                  name,
                  points: rows.map((row: JSONObject) => {
                    return {
                      x: new Date(row["timestamp"] as string).toISOString(),
                      y: typeof row["value"] === "number" ? row["value"] : null,
                    };
                  }),
                },
              ],
              link: target,
            })
          : undefined;
      const truncated: boolean = Boolean(
        result.truncated || counts.truncated || (!name && rows.length >= limit),
      );
      return resultForRows({
        rows,
        label,
        target,
        widget,
        truncated,
        note: `${note} ${name ? `Metric ${aggregation}; ${mode}; interval ${interval}. Counter Sum is a sum of exported samples, not a rate or increase.` : "Names are observed in this resource/window; an empty result does not prove that the resource exports no metrics."}${truncated ? " Result limit reached or query truncated; do not treat this as complete." : ""}`,
      });
    }
    /*
     * These aggregators bypass the model query layer. Intersect their parent
     * resource scope with the same allowed primary-entity IDs as that layer.
     */
    const allowedIds: Array<ObjectID> | null =
      signal === "logs"
        ? await ModelPermission.getAccessibleServiceIdsForAnalyticsModel(
            Log,
            ctx.props,
            DatabaseRequestType.Read,
          )
        : await ModelPermission.getAccessibleServiceIdsForAnalyticsModel(
            Span,
            ctx.props,
            DatabaseRequestType.Read,
          );
    const serviceIds: Array<ObjectID> | undefined = ToolArgs.scopeServiceIds(
      allowedIds,
      undefined,
    );
    if (signal === "logs") {
      /*
       * The dashboard histogram includes whole boundary minutes so it can
       * use minute projections. Describe that effective interval exactly.
       */
      const effectiveStart: Date = new Date(
        Math.floor(startTime.getTime() / 60000) * 60000,
      );
      const effectiveEndExclusive: Date = new Date(
        (Math.floor(endTime.getTime() / 60000) + 1) * 60000,
      );
      const severity: string | undefined = ToolArgs.getString(
        args,
        "severityText",
      );
      const buckets: Array<HistogramBucket> =
        await LogAggregationService.getHistogram({
          projectId: ctx.projectId,
          startTime,
          endTime,
          bucketSizeInMinutes: Math.max(
            1,
            Math.ceil((endTime.getTime() - startTime.getTime()) / 60000 / 48),
          ),
          serviceIds,
          resourceScopes: scope.resourceScopes,
          attributes: scope.attributes,
          severityTexts: severity ? [severity] : undefined,
        });
      const rowsByTime: Map<string, JSONObject> = new Map();
      for (const bucket of buckets) {
        const row: JSONObject = rowsByTime.get(bucket.time) || {
          time: bucket.time,
          severities: [],
        };
        /*
         * Severity is telemetry content, never a field name. Keeping it in
         * values both redacts it and avoids collisions with the time column.
         */
        (row["severities"] as Array<JSONObject>).push({
          severity: bucket.severity || "Unspecified",
          count: bucket.count,
        });
        rowsByTime.set(bucket.time, row);
      }
      const rows: Array<JSONObject> = Array.from(rowsByTime.values()).sort(
        (a: JSONObject, b: JSONObject): number => {
          return String(a["time"]).localeCompare(String(b["time"]));
        },
      );
      return resultForRows({
        rows,
        label,
        target,
        note: `${note} Log histogram includes whole boundary minutes: ${effectiveStart.toISOString()} (inclusive) – ${effectiveEndExclusive.toISOString()} (exclusive). Counts are log records by severity, not raw messages or unique failures.`,
      });
    }
    const table: Array<TraceAnalyticsTableRow> =
      await TraceAggregationService.getAnalyticsTable({
        projectId: ctx.projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: Math.max(
          1,
          Math.ceil((endTime.getTime() - startTime.getTime()) / 60000 / 48),
        ),
        chartType: "table",
        metric: "count",
        groupBy: ["name"],
        limit,
        serviceIds,
        resourceScopes: scope.resourceScopes,
        attributes: scope.attributes,
        rootOnly: ToolArgs.getBoolean(args, "rootOnly"),
      });
    const rows: Array<JSONObject> = table.map(
      (row: TraceAnalyticsTableRow): JSONObject => {
        return {
          operation: row.groupValues["name"],
          spanCount: row.count,
          errorSpanCount: row.errorCount,
          avgMs: row.count > 0 ? row.avgDurationMs : null,
          p50Ms: row.count > 0 ? row.p50DurationMs : null,
          p95Ms: row.count > 0 ? row.p95DurationMs : null,
          p99Ms: row.count > 0 ? row.p99DurationMs : null,
        };
      },
    );
    return resultForRows({
      rows,
      label,
      target,
      truncated: rows.length >= limit,
      note: `${note} Counts are spans, not unique requests. Operations ranked by span volume (the analytics table ordering), not error rate.${rows.length >= limit ? " Operation limit reached; this is a partial ranking, not the resource total." : ""}`,
    });
  },
};
