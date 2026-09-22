import "../../TestingUtils/Init";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import HostService from "../../../../Server/Services/HostService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import VMwareVCenterService from "../../../../Server/Services/VMwareVCenterService";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import IoTFleetService from "../../../../Server/Services/IoTFleetService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import MetricService, {
  MetricService as MetricServiceClass,
} from "../../../../Server/Services/MetricService";
import LogService from "../../../../Server/Services/LogService";
import SpanService from "../../../../Server/Services/SpanService";
import LogAggregationService from "../../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../../Server/Services/TraceAggregationService";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span from "../../../../Models/AnalyticsModels/Span";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import AggregateBy from "../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import { LLMToolDefinition } from "../../../../Server/Utils/LLM/LLMService";
import {
  buildAIResourceTelemetryScope,
  AIResourceTelemetryScope,
  QueryResourceTelemetryTool,
  QueryTelemetryResourcesTool,
} from "../../../../Server/Utils/AI/Toolbox/ResourceTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import {
  AIChatCitationTargetType,
  AIChatWidgetSeries,
} from "../../../../Types/AI/AIChatTypes";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../Types/JSON";
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

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);
const resourceId: ObjectID = new ObjectID(
  "22222222-2222-2222-2222-222222222222",
);
const otherId: ObjectID = new ObjectID("33333333-3333-3333-3333-333333333333");
const start: Date = new Date("2026-09-16T12:00:00.000Z");
const end: Date = new Date("2026-09-17T12:00:00.000Z");

interface ResourceCase {
  type: AIResourceType;
  service: {
    findBy: (...args: Array<never>) => Promise<unknown>;
    getModel: () => BaseModel;
  };
  identifier?: string;
  attribute?: string;
  keyFor?: (projectId: string, identifier: string) => string;
  read: Permission;
}

const cases: Array<ResourceCase> = [
  {
    type: AIResourceType.Host,
    service: HostService,
    identifier: "hostIdentifier",
    attribute: "resource.host.name",
    keyFor: keyForHost,
    read: Permission.ReadHost,
  },
  {
    type: AIResourceType.DockerHost,
    service: DockerHostService,
    identifier: "hostIdentifier",
    attribute: "resource.host.name",
    keyFor: keyForHost,
    read: Permission.ReadDockerHost,
  },
  {
    type: AIResourceType.PodmanHost,
    service: PodmanHostService,
    identifier: "hostIdentifier",
    attribute: "resource.host.name",
    keyFor: keyForHost,
    read: Permission.ReadPodmanHost,
  },
  {
    type: AIResourceType.KubernetesCluster,
    service: KubernetesClusterService,
    identifier: "clusterIdentifier",
    attribute: "resource.k8s.cluster.name",
    keyFor: keyForKubernetesCluster,
    read: Permission.ReadKubernetesCluster,
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    service: DockerSwarmClusterService,
    identifier: "name",
    attribute: "resource.docker.swarm.cluster.name",
    keyFor: keyForDockerSwarmCluster,
    read: Permission.ReadDockerSwarmCluster,
  },
  {
    type: AIResourceType.ProxmoxCluster,
    service: ProxmoxClusterService,
    identifier: "name",
    attribute: "resource.proxmox.cluster.name",
    keyFor: keyForProxmoxCluster,
    read: Permission.ReadProxmoxCluster,
  },
  {
    type: AIResourceType.VMwareVCenter,
    service: VMwareVCenterService,
    identifier: "name",
    attribute: "resource.vmware.vcenter.name",
    keyFor: keyForVMwareVCenter,
    read: Permission.ReadVMwareVCenter,
  },
  {
    type: AIResourceType.CephCluster,
    service: CephClusterService,
    identifier: "name",
    attribute: "resource.ceph.cluster.name",
    keyFor: keyForCephCluster,
    read: Permission.ReadCephCluster,
  },
  {
    type: AIResourceType.ServerlessFunction,
    service: ServerlessFunctionService,
    identifier: "functionIdentifier",
    attribute: "resource.faas.name",
    read: Permission.ReadServerlessFunction,
  },
  {
    type: AIResourceType.CloudResource,
    service: CloudResourceService,
    read: Permission.ReadCloudResource,
  },
  {
    type: AIResourceType.IoTFleet,
    service: IoTFleetService,
    identifier: "name",
    attribute: "resource.iot.fleet.name",
    read: Permission.ReadIoTFleet,
  },
  {
    type: AIResourceType.NetworkDevice,
    service: NetworkDeviceService,
    read: Permission.ReadNetworkDevice,
  },
];

function context(
  allow: Array<Permission> = [Permission.ProjectMember],
  block: Array<Permission> = [],
): ToolContext {
  return {
    projectId,
    props: {
      tenantId: projectId,
      userId: otherId,
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [projectId],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId,
          _type: "UserTenantAccessPermission",
          permissions: [
            ...allow.map((permission: Permission) => {
              return {
                permission,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              };
            }),
            ...block.map((permission: Permission) => {
              return {
                permission,
                labelIds: [],
                isBlockPermission: true,
                _type: "UserPermission",
              };
            }),
          ],
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function resource(item: ResourceCase): JSONObject {
  return {
    _id: resourceId.toString(),
    name: "production",
    lastSeenAt: end,
    otelCollectorStatus: "Connected",
    isArchived: false,
    ...(item.identifier ? { [item.identifier]: "production" } : {}),
    ...(item.type === AIResourceType.CloudResource
      ? {
          cloudPlatform: "aws_ec2",
          cloudAccountId: "account-1",
          cloudRegion: "eu-west-1",
        }
      : {}),
  };
}

function args(
  type: AIResourceType = AIResourceType.Host,
  signal: string = "metrics",
): JSONObject {
  return {
    resourceType: type,
    resourceId: resourceId.toString(),
    signal,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function dataRows(value: number, timestamp: Date = start): AggregatedResult {
  return { data: [{ timestamp, value }] };
}

let metric: jest.SpyInstance;
let logs: jest.SpyInstance;
let traces: jest.SpyInstance;
let accessible: jest.SpyInstance;

beforeEach(() => {
  for (const item of cases) {
    jest.spyOn(item.service, "findBy").mockResolvedValue([resource(item)]);
  }
  metric = jest
    .spyOn(MetricService, "aggregateBy")
    .mockResolvedValue({ data: [] });
  logs = jest
    .spyOn(LogAggregationService, "getHistogram")
    .mockResolvedValue([]);
  traces = jest
    .spyOn(TraceAggregationService, "getAnalyticsTable")
    .mockResolvedValue([]);
  accessible = jest
    .spyOn(ModelPermission, "getAccessibleServiceIdsForAnalyticsModel")
    .mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("infrastructure inventory", () => {
  test.each(cases)(
    "lists $type with a safe model allowlist, project pin and caller props",
    async (item: ResourceCase) => {
      const ctx: ToolContext = context([item.read]);
      const result: ToolExecutionResult =
        await QueryTelemetryResourcesTool.execute(
          { resourceType: item.type, projectId: otherId.toString() },
          ctx,
        );
      const call: JSONObject = (item.service.findBy as jest.Mock).mock
        .calls[0]![0] as JSONObject;
      expect(call["query"]).toEqual({ projectId, isArchived: false });
      expect(call["props"]).toBe(ctx.props);
      expect(call["limit"]).toBe(20);
      expect(call["skip"]).toBe(0);
      expect(call["select"]).toEqual(
        expect.objectContaining({ _id: true, name: true, lastSeenAt: true }),
      );
      expect(JSON.stringify(call["select"])).not.toMatch(
        /password|secret|token|community|credential/i,
      );
      const model: BaseModel = item.service.getModel();
      for (const field of Object.keys(call["select"] as JSONObject)) {
        expect({ field, exists: model.hasColumn(field) }).toEqual({
          field,
          exists: true,
        });
      }
      expect(
        QueryTelemetryResourcesTool.getRequiredPermissionGroups!({
          resourceType: item.type,
        }),
      ).toEqual([model.getReadPermissions()]);
      expect(
        QueryResourceTelemetryTool.getRequiredPermissionGroups!({
          resourceType: item.type,
          signal: "metrics",
        }),
      ).toEqual([
        model.getReadPermissions(),
        [
          ...new Metric().getReadPermissions(),
          Permission.ReadAllOperationalResources,
        ],
      ]);
      expect(
        QueryResourceTelemetryTool.getRequiredPermissionGroups!({
          resourceType: item.type,
          signal: "logs",
        }),
      ).toEqual([
        model.getReadPermissions(),
        [
          ...new Log().getReadPermissions(),
          Permission.ReadAllOperationalResources,
        ],
      ]);
      expect(
        QueryResourceTelemetryTool.getRequiredPermissionGroups!({
          resourceType: item.type,
          signal: "traces",
        }),
      ).toEqual([
        model.getReadPermissions(),
        [
          ...new Span().getReadPermissions(),
          Permission.ReadAllOperationalResources,
        ],
      ]);
      expect(result.dataForLlm).toContain(`resourceType=${item.type}`);
      expect(result.dataForLlm).toContain(`resourceId=${resourceId}`);
      expect(result.dataForLlm).toContain(
        "Collector connection is not workload health",
      );
      expect(result.citationTarget).toEqual({
        type: AIChatCitationTargetType.TelemetryResources,
        params: { resourceType: item.type },
      });
      expect(
        AIToolbox.hasPermissionForTool(QueryTelemetryResourcesTool, ctx, {
          resourceType: item.type,
        }),
      ).toBe(true);
    },
  );

  test("never copies credentials or arbitrary fields even if a service returns them", async () => {
    (NetworkDeviceService.findBy as jest.Mock).mockResolvedValue([
      {
        _id: resourceId.toString(),
        name: "switch",
        isReachable: false,
        isSnmpReachable: false,
        interfacesTotal: 0,
        interfacesUp: null,
        snmpCommunity: "private-community",
        password: "secret-value",
        attributes: { authorization: "private" },
      },
    ]);
    const result: ToolExecutionResult =
      await QueryTelemetryResourcesTool.execute(
        { resourceType: "NetworkDevice" },
        context(),
      );
    expect(result.dataForLlm).toContain("isReachable=false");
    expect(result.dataForLlm).toContain("interfacesTotal=0");
    expect(result.dataForLlm).toContain("interfacesUp=unknown");
    expect(result.dataForLlm).not.toMatch(
      /private-community|secret-value|authorization|password|otelCollectorStatus/,
    );
  });

  test("bounds pagination and marks a reached limit as partial", async () => {
    (HostService.findBy as jest.Mock).mockResolvedValue([resource(cases[0]!)]);
    const result: ToolExecutionResult =
      await QueryTelemetryResourcesTool.execute(
        {
          resourceType: "Host",
          search: "prod",
          includeArchived: true,
          limit: 0,
          skip: 999999,
        },
        context(),
      );
    expect(HostService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ projectId, name: expect.anything() }),
        limit: 1,
        skip: 500,
      }),
    );
    expect(
      (HostService.findBy as jest.Mock).mock.calls[0]![0].query["isArchived"],
    ).toBeUndefined();
    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain(
      "paginate before making fleet-wide claims",
    );
  });

  test("an explicit ID ignores pagination and includes an archived resource", async () => {
    const result: ToolExecutionResult =
      await QueryTelemetryResourcesTool.execute(
        {
          resourceType: "Host",
          resourceId: resourceId.toString(),
          limit: 100000,
          skip: 500,
        },
        context(),
      );
    expect(HostService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId, _id: resourceId.toString() },
        limit: 1,
        skip: 0,
      }),
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.TelemetryResourceView,
      params: { resourceType: "Host", resourceId: resourceId.toString() },
    });
    expect(result.isTruncated).toBe(false);
  });

  test.each(["", "not-a-uuid", 123, null])(
    "rejects invalid inventory resource ID %p",
    async (value: unknown) => {
      await expect(
        QueryTelemetryResourcesTool.execute(
          { resourceType: "Host", resourceId: value } as JSONObject,
          context(),
        ),
      ).rejects.toThrow("valid OneUptime UUID");
      expect(HostService.findBy).not.toHaveBeenCalled();
    },
  );
});

describe("parent resource and signal permissions", () => {
  test.each(cases)(
    "a telemetry wildcard alone cannot authorize the $type parent",
    (item: ResourceCase) => {
      const ctx: ToolContext = context([
        Permission.ReadAllOperationalResources,
      ]);
      expect(
        AIToolbox.hasPermissionForTool(QueryTelemetryResourcesTool, ctx, {
          resourceType: item.type,
        }),
      ).toBe(false);
      for (const signal of ["metrics", "logs", "traces"]) {
        expect(
          AIToolbox.hasPermissionForTool(
            QueryResourceTelemetryTool,
            ctx,
            args(item.type, signal),
          ),
        ).toBe(false);
      }
    },
  );

  test.each(["logs", "traces"])(
    "Host read plus operational wildcard can query %s with the actual analytics ownership resolver",
    async (signal: string) => {
      accessible.mockRestore();
      const ctx: ToolContext = context([
        Permission.ReadHost,
        Permission.ReadAllOperationalResources,
      ]);
      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name: QueryResourceTelemetryTool.name,
        args: args(AIResourceType.Host, signal),
        ctx,
      });
      expect(outcome.success).toBe(true);
      expect(
        (signal === "logs" ? logs : traces).mock.calls[0]![0].serviceIds,
      ).toBeUndefined();
    },
  );

  test.each(["metrics", "logs", "traces"])(
    "an explicit operational wildcard block denies %s despite a broad grant",
    async (signal: string) => {
      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name: QueryResourceTelemetryTool.name,
        args: args(AIResourceType.Host, signal),
        ctx: context(
          [Permission.ProjectMember],
          [Permission.ReadAllOperationalResources],
        ),
      });
      expect(outcome.success).toBe(false);
      expect(HostService.findBy).not.toHaveBeenCalled();
      expect(metric).not.toHaveBeenCalled();
      expect(logs).not.toHaveBeenCalled();
      expect(traces).not.toHaveBeenCalled();
    },
  );

  test.each([null, undefined, [], "Host", 1, true])(
    "malformed argument envelope %p returns a graceful failure before permission or database access",
    async (invalid: unknown) => {
      for (const name of [
        QueryTelemetryResourcesTool.name,
        QueryResourceTelemetryTool.name,
      ]) {
        const outcome: ToolCallOutcome = await AIToolbox.executeTool({
          name,
          args: invalid as JSONObject,
          ctx: context(),
        });
        expect(outcome.success).toBe(false);
        expect(outcome.errorMessage).toContain("expected a JSON object");
      }
      for (const item of cases) {
        expect(item.service.findBy).not.toHaveBeenCalled();
      }
      expect(metric).not.toHaveBeenCalled();
      expect(logs).not.toHaveBeenCalled();
      expect(traces).not.toHaveBeenCalled();
      expect(accessible).not.toHaveBeenCalled();
    },
  );

  test("registers both read-only tools", () => {
    const names: Array<string> = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.ReadOnly,
    ).map((tool: LLMToolDefinition) => {
      return tool.name;
    });
    expect(names).toContain("query_telemetry_resources");
    expect(names).toContain("query_resource_telemetry");
    expect(AIToolbox.isMutationTool("query_resource_telemetry")).toBe(false);
  });

  test("an unrelated Podman block does not prevent a Host inventory lookup", async () => {
    const ctx: ToolContext = context(
      [Permission.ReadHost, Permission.ReadPodmanHost],
      [Permission.ReadPodmanHost],
    );
    expect(
      (
        await AIToolbox.executeTool({
          name: QueryTelemetryResourcesTool.name,
          args: { resourceType: "Host" },
          ctx,
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await AIToolbox.executeTool({
          name: QueryTelemetryResourcesTool.name,
          args: { resourceType: "PodmanHost" },
          ctx,
        })
      ).success,
    ).toBe(false);
    expect(PodmanHostService.findBy).not.toHaveBeenCalled();
  });

  test.each(["metrics", "logs", "traces"])(
    "requires both parent and %s access",
    async (signal: string) => {
      const signalRead: Permission =
        signal === "logs"
          ? Permission.ReadTelemetryServiceLog
          : Permission.ReadTelemetryServiceTraces;
      for (const allow of [[Permission.ReadHost], [signalRead]]) {
        const outcome: ToolCallOutcome = await AIToolbox.executeTool({
          name: QueryResourceTelemetryTool.name,
          args: args(AIResourceType.Host, signal),
          ctx: context(allow),
        });
        expect(outcome.success).toBe(false);
      }
      expect(HostService.findBy).not.toHaveBeenCalled();
      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name: QueryResourceTelemetryTool.name,
        args: args(AIResourceType.Host, signal),
        ctx: context(
          [Permission.ReadHost, signalRead],
          [Permission.ReadPodmanHost],
        ),
      });
      expect(outcome.success).toBe(true);
    },
  );

  test.each([Permission.ReadHost, Permission.ReadTelemetryServiceTraces])(
    "blocks selected permission %s despite a broad grant",
    async (blocked: Permission) => {
      const outcome: ToolCallOutcome = await AIToolbox.executeTool({
        name: QueryResourceTelemetryTool.name,
        args: args(),
        ctx: context([Permission.ProjectMember], [blocked]),
      });
      expect(outcome.success).toBe(false);
      expect(metric).not.toHaveBeenCalled();
      expect(HostService.findBy).not.toHaveBeenCalled();
    },
  );

  test("refuses a cross-project context before touching either database", async () => {
    const ctx: ToolContext = context();
    ctx.projectId = otherId;
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: QueryResourceTelemetryTool.name,
      args: args(),
      ctx,
    });
    expect(outcome.success).toBe(false);
    expect(HostService.findBy).not.toHaveBeenCalled();
    expect(metric).not.toHaveBeenCalled();
  });

  test("a missing or denied parent prevents every telemetry read", async () => {
    (HostService.findBy as jest.Mock).mockResolvedValue([]);
    for (const signal of ["metrics", "logs", "traces"]) {
      await expect(
        QueryResourceTelemetryTool.execute(
          args(AIResourceType.Host, signal),
          context(),
        ),
      ).rejects.toThrow("not found or you do not have access");
    }
    expect(metric).not.toHaveBeenCalled();
    expect(logs).not.toHaveBeenCalled();
    expect(traces).not.toHaveBeenCalled();
    expect(accessible).not.toHaveBeenCalled();
  });

  test("propagates a model-layer rejection without querying telemetry", async () => {
    (HostService.findBy as jest.Mock).mockRejectedValue(
      new Error("No label permission"),
    );
    await expect(
      QueryResourceTelemetryTool.execute(args(), context()),
    ).rejects.toThrow("No label permission");
    expect(metric).not.toHaveBeenCalled();
  });

  test.each([
    {},
    { resourceType: "__proto__" },
    { resourceType: "Host", signal: "sql" },
  ])(
    "invalid resource/signal arguments fail closed in the permission gate: %p",
    (invalid: JSONObject) => {
      expect(
        AIToolbox.hasPermissionForTool(
          QueryResourceTelemetryTool,
          context(),
          invalid,
        ),
      ).toBe(false);
    },
  );

  test.each(["logs", "traces"])(
    "%s raw aggregation intersects the caller's allowed primary IDs",
    async (signal: string) => {
      accessible.mockResolvedValue([otherId]);
      const ctx: ToolContext = context();
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.KubernetesCluster, signal),
        ctx,
      );
      const call: JSONObject = (signal === "logs" ? logs : traces).mock
        .calls[0]![0];
      expect(accessible).toHaveBeenCalledWith(
        signal === "logs" ? Log : Span,
        ctx.props,
        DatabaseRequestType.Read,
      );
      expect(call["serviceIds"]).toEqual([otherId]);
      expect(call["projectId"]).toBe(projectId);
      expect(call["resourceScopes"]).toEqual(expect.any(Array));
    },
  );

  test.each(["logs", "traces"])(
    "empty owned access to %s becomes a no-match sentinel",
    async (signal: string) => {
      accessible.mockResolvedValue([]);
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.Host, signal),
        context(),
      );
      expect(
        (signal === "logs" ? logs : traces).mock.calls[0]![0].serviceIds,
      ).toEqual([ObjectID.getZeroObjectID()]);
    },
  );
});

describe("resource membership", () => {
  test.each(cases)(
    "$type uses a project-pinned parent read and real membership in every signal",
    async (item: ResourceCase) => {
      const ctx: ToolContext = context();
      for (const signal of ["metrics", "logs", "traces"]) {
        await QueryResourceTelemetryTool.execute(
          {
            ...args(item.type, signal),
            projectId: otherId.toString(),
            attributes: {},
            resourceScopes: [],
            resourceIdOverride: otherId.toString(),
          },
          ctx,
        );
        const parentCall: JSONObject = (item.service.findBy as jest.Mock).mock
          .calls[0]![0];
        expect(parentCall["query"]).toEqual({
          projectId,
          _id: resourceId.toString(),
        });
        expect(parentCall["props"]).toBe(ctx.props);
        const calls: Array<Array<JSONObject>> = (
          signal === "metrics" ? metric : signal === "logs" ? logs : traces
        ).mock.calls;
        const call: JSONObject = calls[calls.length - 1]![0]!;
        const scopeQuery: JSONObject =
          signal === "metrics" ? (call["query"] as JSONObject) : call;
        const scopes: unknown =
          scopeQuery[
            signal === "metrics" ? "resourceEntityScopes" : "resourceScopes"
          ];
        if (item.identifier) {
          expect(scopes).toEqual([
            {
              entityIds: [resourceId.toString()],
              entityKeys: item.keyFor
                ? [item.keyFor(projectId.toString(), "production")]
                : [],
              attributeKey: item.attribute,
              attributeValues: ["production"],
            },
          ]);
        } else if (item.type === AIResourceType.CloudResource) {
          expect(scopes).toBeUndefined();
          expect(scopeQuery["attributes"]).toEqual({
            "resource.cloud.platform": "aws_ec2",
            "resource.cloud.account.id": "account-1",
            "resource.cloud.region": "eu-west-1",
          });
        } else if (signal === "logs") {
          expect(scopeQuery["attributes"]).toEqual({
            "networkDevice.id": resourceId.toString(),
          });
        } else {
          expect(scopes).toEqual([
            { entityIds: [resourceId.toString()], entityKeys: [] },
          ]);
        }
      }
    },
  );

  test.each(
    cases.filter((item: ResourceCase) => {
      return Boolean(item.identifier);
    }),
  )(
    "$type refuses missing identifiers instead of silently querying only primary IDs",
    async (item: ResourceCase) => {
      const record: JSONObject = resource(item);
      delete record[item.identifier!];
      (item.service.findBy as jest.Mock).mockResolvedValue([record]);
      await expect(
        QueryResourceTelemetryTool.execute(args(item.type), context()),
      ).rejects.toThrow("cannot be scoped safely");
      expect(metric).not.toHaveBeenCalled();
    },
  );

  test.each([undefined, null, "", "   "])(
    "Cloud without a platform (%p) cannot query project-wide data",
    async (platform: unknown) => {
      (CloudResourceService.findBy as jest.Mock).mockResolvedValue([
        { ...resource(cases[9]!), cloudPlatform: platform },
      ]);
      await expect(
        QueryResourceTelemetryTool.execute(
          args(AIResourceType.CloudResource, "logs"),
          context(),
        ),
      ).rejects.toThrow("no cloud platform identity");
      expect(logs).not.toHaveBeenCalled();
    },
  );

  test("Cloud trims known attributes and omits absent account/region", () => {
    const scope: AIResourceTelemetryScope = buildAIResourceTelemetryScope({
      type: AIResourceType.CloudResource,
      id: resourceId,
      projectId,
      signal: "metrics",
      resource: {
        cloudPlatform: "  aws_ec2  ",
        cloudAccountId: " ",
        cloudRegion: null,
      },
    });
    expect(scope.attributes).toEqual({ "resource.cloud.platform": "aws_ec2" });
    expect(scope.resourceScopes).toBeUndefined();
  });

  test.each([
    { type: AIResourceType.DockerHost, runtime: "docker" },
    { type: AIResourceType.PodmanHost, runtime: "podman" },
  ])(
    "$type separates runtime metrics/logs and explicitly describes host-scoped traces",
    async ({ type, runtime }: { type: AIResourceType; runtime: string }) => {
      await QueryResourceTelemetryTool.execute(args(type), context());
      expect(metric.mock.calls[0]![0].query.attributes).toEqual({
        "resource.container.runtime": runtime,
      });
      await QueryResourceTelemetryTool.execute(args(type, "logs"), context());
      expect(logs.mock.calls[0]![0].attributes).toEqual({
        "resource.container.runtime": runtime,
      });
      const result: ToolExecutionResult =
        await QueryResourceTelemetryTool.execute(
          args(type, "traces"),
          context(),
        );
      expect(traces.mock.calls[0]![0].attributes).toBeUndefined();
      expect(result.dataForLlm).toContain(
        "not attributed to a particular container runtime",
      );
    },
  );
});

describe("metric evidence", () => {
  test("metric discovery is grouped inside the selected resource and time window", async () => {
    metric.mockResolvedValue({
      data: [{ timestamp: start, value: 4, name: "system.cpu.utilization" }],
    });
    const ctx: ToolContext = context();
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(args(), ctx);
    expect(metric).toHaveBeenCalledTimes(1);
    const call: AggregateBy<Metric> = metric.mock.calls[0]![0];
    expect(call.aggregationInterval).toBe(AggregationInterval.Total);
    expect(call.aggregationType).toBe(AggregationType.Count);
    expect(call.groupBy).toEqual({ name: true });
    expect(call.query).toEqual(
      expect.objectContaining({
        projectId,
        time: expect.any(InBetween),
        resourceEntityScopes: expect.any(Array),
      }),
    );
    expect(call.props).toBe(ctx.props);
    expect(result.dataForLlm).toContain("metricName=system.cpu.utilization");
  });

  test("a trend retains true zero values and emits null for zero-observation distribution exports", async () => {
    metric.mockImplementation(
      async (call: AggregateBy<Metric>): Promise<AggregatedResult> => {
        return call.aggregationType === AggregationType.Count
          ? {
              data: [
                { timestamp: start, value: 1 },
                { timestamp: end, value: 0 },
              ],
            }
          : {
              data: [
                { timestamp: start, value: 0 },
                { timestamp: end, value: 0 },
              ],
            };
      },
    );
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        { ...args(), metricName: "cpu.utilization" },
        context(),
      );
    expect(result.dataForLlm).toContain("value=0");
    expect(result.dataForLlm).toContain("status=no observations");
    const series: Array<AIChatWidgetSeries> =
      result.widget?.data["series"] || [];
    expect(series[0]!["points"]).toEqual([
      { x: start.toISOString(), y: 0 },
      { x: end.toISOString(), y: null },
    ]);
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.TelemetryResourceView,
      params: { resourceType: "Host", resourceId: resourceId.toString() },
    });
  });

  test.each([null, NaN, Infinity])(
    "invalid aggregate %p is not rendered as a numeric health value",
    async (value: unknown) => {
      metric.mockImplementation(
        async (call: AggregateBy<Metric>): Promise<AggregatedResult> => {
          return dataRows(
            call.aggregationType === AggregationType.Count
              ? 2
              : (value as number),
          );
        },
      );
      const result: ToolExecutionResult =
        await QueryResourceTelemetryTool.execute(
          { ...args(), metricName: "cpu.utilization" },
          context(),
        );
      expect(result.dataForLlm).toContain("status=aggregate unavailable");
      expect(result.dataForLlm).not.toMatch(/value=(NaN|Infinity)/);
    },
  );

  test("summary uses a whole-window aggregate, not an average of bucket averages", async () => {
    metric.mockImplementation(
      async (call: AggregateBy<Metric>): Promise<AggregatedResult> => {
        return dataRows(
          call.aggregationType === AggregationType.Count ? 42 : 0.7,
        );
      },
    );
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        {
          ...args(),
          metricName: "cpu.utilization",
          mode: "summary",
          aggregationType: "P95",
        },
        context(),
      );
    for (const call of metric.mock.calls) {
      expect(call[0].aggregationInterval).toBe(AggregationInterval.Total);
    }
    expect(metric.mock.calls[0]![0].aggregationType).toBe(AggregationType.P95);
    expect(result.dataForLlm).toContain("value=0.7");
    expect(result.widget).toBeUndefined();
  });

  test.each([1, 3, 12, 24, 72, 168, 720])(
    "a %s-hour trend fits all buckets under the serializer cap",
    async (hours: number) => {
      const result: ToolExecutionResult =
        await QueryResourceTelemetryTool.execute(
          {
            ...args(),
            metricName: "cpu.utilization",
            startTime: new Date(end.getTime() - hours * 3600000).toISOString(),
          },
          context(),
        );
      const call: AggregateBy<Metric> = metric.mock.calls[0]![0];
      const bucketMs: number = AggregationIntervalUtil.getAggregationIntervalMs(
        call.aggregationInterval!,
      );
      expect(Math.ceil((hours * 3600000) / bucketMs) + 1).toBeLessThanOrEqual(
        49,
      );
      expect(result.dataForLlm).toContain(
        "Missing telemetry is not evidence of health",
      );
    },
  );

  test("defaults to one hour and clamps a long request to30days", async () => {
    await QueryResourceTelemetryTool.execute(
      {
        resourceType: "Host",
        resourceId: resourceId.toString(),
        signal: "metrics",
        endTime: end.toISOString(),
      },
      context(),
    );
    expect(metric.mock.calls[0]![0].startTimestamp.getTime()).toBe(
      end.getTime() - 3600000,
    );
    await QueryResourceTelemetryTool.execute(
      { ...args(), startTime: "2020-01-01T00:00:00Z" },
      context(),
    );
    expect(metric.mock.calls[1]![0].startTimestamp.getTime()).toBe(
      end.getTime() - 30 * 86400000,
    );
  });

  test("marks service truncation and discovery limits honestly", async () => {
    metric.mockResolvedValue({
      truncated: true,
      data: [{ timestamp: start, name: "cpu", value: 3 }],
    });
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        { ...args(), limit: 1 },
        context(),
      );
    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain("do not treat this as complete");
  });

  test.each([
    { aggregationType: "arbitrary_sql" },
    { mode: "raw" },
    { startTime: "invalid" },
    { startTime: end.toISOString() },
  ])("rejects invalid query options %p", async (options: JSONObject) => {
    await expect(
      QueryResourceTelemetryTool.execute({ ...args(), ...options }, context()),
    ).rejects.toThrow();
    expect(metric).not.toHaveBeenCalled();
  });
});

describe("log and span evidence", () => {
  test("pivots severities by time without treating severity content as field names", async () => {
    logs.mockResolvedValue([
      { time: start.toISOString(), severity: "Error", count: 4 },
      { time: start.toISOString(), severity: "time", count: 2 },
      {
        time: end.toISOString(),
        severity: "api_key=supersecretvalue",
        count: 1,
      },
    ]);
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        { ...args(AIResourceType.Host, "logs"), severityText: "Error" },
        context(),
      );
    expect(logs.mock.calls[0]![0].severityTexts).toEqual(["Error"]);
    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain(`time=${start.toISOString()}`);
    expect(result.dataForLlm).toContain('"severity":"time"');
    expect(result.dataForLlm).not.toContain("supersecretvalue");
    expect(result.redactionCount).toBeGreaterThan(0);
    expect(result.dataForLlm).toContain("not raw messages");
  });

  test("spans are operation summaries ranked by volume, with rootOnly forwarded and partial rankings labeled", async () => {
    traces.mockResolvedValue([
      {
        groupValues: { name: "checkout" },
        count: 7,
        errorCount: 2,
        avgDurationMs: 20,
        p50DurationMs: 15,
        p95DurationMs: 80,
        p99DurationMs: 100,
      },
    ]);
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        { ...args(AIResourceType.Host, "traces"), rootOnly: true, limit: 1 },
        context(),
      );
    expect(traces.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        groupBy: ["name"],
        metric: "count",
        rootOnly: true,
        limit: 1,
      }),
    );
    expect(result.dataForLlm).toContain("spanCount=7");
    expect(result.dataForLlm).toContain("errorSpanCount=2");
    expect(result.dataForLlm).toContain(
      "partial ranking, not the resource total",
    );
    expect(result.isTruncated).toBe(true);
  });

  test.each(["metrics", "logs", "traces"])(
    "empty %s remains unknown and parent scope is explicit",
    async (signal: string) => {
      const result: ToolExecutionResult =
        await QueryResourceTelemetryTool.execute(
          args(AIResourceType.KubernetesCluster, signal),
          context(),
        );
      expect(result.rowCount).toBe(0);
      expect(result.dataForLlm).toContain("no rows found");
      expect(result.dataForLlm).toContain(
        "no individual child identity or namespace was selected",
      );
      expect(result.dataForLlm).toContain(
        "Missing telemetry is not evidence of health",
      );
    },
  );
});

describe("resource query integration with real analytics SQL builders", () => {
  test("log histogram discloses the effective whole boundary minutes used by its real SQL", async () => {
    logs.mockRestore();
    const execute: jest.SpyInstance = jest
      .spyOn(LogService, "executeQuery")
      .mockResolvedValue({
        json: async () => {
          return { data: [] };
        },
      } as never);
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        {
          ...args(AIResourceType.Host, "logs"),
          startTime: "2026-09-17T12:00:59.000Z",
          endTime: "2026-09-17T12:01:01.000Z",
        },
        context(),
      );
    const statement: Statement = execute.mock.calls[0]![0];
    expect(statement.query).toContain(
      "toStartOfInterval(time, INTERVAL 1 MINUTE) >= toStartOfInterval(",
    );
    expect(statement.query).toContain(
      "toStartOfInterval(time, INTERVAL 1 MINUTE) < {",
    );
    expect(result.dataForLlm).toContain(
      "Requested window: 2026-09-17T12:00:59.000Z – 2026-09-17T12:01:01.000Z",
    );
    expect(result.dataForLlm).toContain(
      "whole boundary minutes: 2026-09-17T12:00:00.000Z (inclusive) – 2026-09-17T12:02:00.000Z (exclusive)",
    );
  });

  /*
   * The histogram keeps only minutes that start before the end, so a
   * minute-aligned end is the exclusive edge itself - the disclosure must not
   * claim a minute the SQL no longer counts.
   */
  test("log histogram disclosure treats a minute-aligned end as the exclusive edge", async () => {
    logs.mockRestore();
    jest.spyOn(LogService, "executeQuery").mockResolvedValue({
      json: async () => {
        return { data: [] };
      },
    } as never);
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        {
          ...args(AIResourceType.Host, "logs"),
          startTime: "2026-09-17T12:00:00.000Z",
          endTime: "2026-09-17T12:05:00.000Z",
        },
        context(),
      );
    expect(result.dataForLlm).toContain(
      "whole boundary minutes: 2026-09-17T12:00:00.000Z (inclusive) – 2026-09-17T12:05:00.000Z (exclusive)",
    );
  });

  test("metric membership survives aggregation SQL and binds project, ID, secondary key and legacy attribute", async () => {
    await QueryResourceTelemetryTool.execute(
      {
        ...args(AIResourceType.KubernetesCluster),
        metricName: "cpu' OR 1=1 --",
      },
      context(),
    );
    const call: AggregateBy<Metric> = metric.mock.calls[0]![0];
    const statement: Statement = new MetricServiceClass().toAggregateStatement(
      call,
    ).statement;
    expect(statement.query).toMatch(/hasAny/);
    expect(Object.values(statement.query_params)).toContain("primaryEntityId");
    expect(Object.values(statement.query_params)).toContain("attributes");
    expect(statement.query).toMatch(/OR/);
    expect(statement.query).not.toContain("cpu' OR 1=1 --");
    const values: Array<unknown> = Object.values(statement.query_params);
    expect(values).toContain(projectId.toString());
    expect(values).toContainEqual([resourceId.toString()]);
    expect(values).toContainEqual([
      keyForKubernetesCluster(projectId.toString(), "production"),
    ]);
    expect(values).toContain("resource.k8s.cluster.name");
  });

  test("real metric discovery returns group names and never drops the resource filter", async () => {
    metric.mockRestore();
    jest
      .spyOn(ModelPermission, "checkReadPermission")
      .mockImplementation(
        async (
          _model: Parameters<typeof ModelPermission.checkReadPermission>[0],
          query: Parameters<typeof ModelPermission.checkReadPermission>[1],
          select: Parameters<typeof ModelPermission.checkReadPermission>[2],
        ) => {
          return { query, select };
        },
      );
    const execute: jest.SpyInstance = jest
      .spyOn(MetricService, "executeQuery")
      .mockResolvedValue({
        json: async () => {
          return {
            data: [
              {
                time: "2026-09-16T12:00:00.000Z",
                value: "5",
                name: "system.cpu.utilization",
              },
            ],
          };
        },
      } as never);
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.Host),
        context(),
      );
    const statement: Statement = execute.mock.calls[0]![0];
    expect(statement.query).toMatch(/GROUP BY/);
    expect(statement.query).toMatch(/hasAny/);
    expect(result.dataForLlm).toContain("metricName=system.cpu.utilization");
    expect(result.dataForLlm).toContain("observationCount=5");
  });

  test("real log histogram binds the entire Cloud conjunction with no primary-only shortcut", async () => {
    logs.mockRestore();
    const execute: jest.SpyInstance = jest
      .spyOn(LogService, "executeQuery")
      .mockResolvedValue({
        json: async () => {
          return {
            data: [
              { bucket: start.toISOString(), severityText: "Error", cnt: "3" },
            ],
          };
        },
      } as never);
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.CloudResource, "logs"),
        context(),
      );
    const statement: Statement = execute.mock.calls[0]![0];
    const values: Array<unknown> = Object.values(statement.query_params);
    expect(values).toEqual(
      expect.arrayContaining([
        projectId.toString(),
        "resource.cloud.platform",
        "aws_ec2",
        "resource.cloud.account.id",
        "account-1",
        "resource.cloud.region",
        "eu-west-1",
      ]),
    );
    expect(statement.query).not.toMatch(/ OR /);
    expect(result.dataForLlm).toContain('"count":3');
  });

  test("real trace analytics preserves membership and owned scope together and returns operation errors", async () => {
    traces.mockRestore();
    accessible.mockResolvedValue([otherId]);
    const execute: jest.SpyInstance = jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue({
        json: async () => {
          return {
            data: [
              {
                name: "work",
                cnt: "7",
                err_cnt: "2",
                avg_ms: "3",
                p50_ms: "2",
                p95_ms: "6",
                p99_ms: "7",
              },
            ],
          };
        },
      } as never);
    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.ProxmoxCluster, "traces"),
        context(),
      );
    const statement: Statement = execute.mock.calls[0]![0];
    expect(statement.query).toMatch(/hasAny/);
    const values: Array<unknown> = Object.values(statement.query_params);
    expect(values).toContain(projectId.toString());
    expect(values).toContainEqual([otherId.toString()]);
    expect(values).toContainEqual([resourceId.toString()]);
    expect(values).toContainEqual([
      keyForProxmoxCluster(projectId.toString(), "production"),
    ]);
    expect(result.dataForLlm).toContain("operation=work");
    expect(result.dataForLlm).toContain("errorSpanCount=2");
    expect(result.dataForLlm).toContain("spanCount=7");
    expect(statement.query).toContain("ORDER BY cnt DESC");
  });
});
