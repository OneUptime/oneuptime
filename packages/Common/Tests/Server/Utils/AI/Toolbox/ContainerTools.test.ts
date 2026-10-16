import "../../../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import DockerHost from "../../../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../../../Models/DatabaseModels/PodmanHost";
import DockerHostService from "../../../../../Server/Services/DockerHostService";
import MetricService from "../../../../../Server/Services/MetricService";
import PodmanHostService from "../../../../../Server/Services/PodmanHostService";
import AggregateBy from "../../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  CONTAINER_CPU_METRIC,
  CONTAINER_MEMORY_METRIC,
  CONTAINER_RESTARTS_METRIC,
  LOOKBACK_MINUTES,
  MAX_ACTIVITY_BUCKETS,
  MAX_CONTAINERS_READ,
  QUERY_CONTAINERS_TOOL_NAME,
  QueryContainersTool,
  chooseActivityInterval,
} from "../../../../../Server/Utils/AI/Toolbox/ContainerTools";
import { countBuckets } from "../../../../../Server/Utils/AI/Toolbox/MetricAttributeQuery";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIResourceType } from "../../../../../Types/AI/AIResourceContext";
import {
  AIChatCitationTargetType,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";
import AggregatedModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { keyForHost } from "../../../../../Utils/Telemetry/EntityKey";

/*
 * query_containers - A DOCKER OR PODMAN HOST'S CONTAINERS (issue #4785).
 *
 * The customer's two cases, end to end through the tool with the metric
 * reads answered in memory:
 *   - a CPU-bound container on a host behind a failing synthetic monitor:
 *     it leads the list, its CPU in percent of a core;
 *   - a stopped container: docker_stats stops reporting it, so host-wide
 *     numbers look healthy - it leads the list as "stopped reporting".
 * And how the tool reads: the host as the caller may read it, the project,
 * the host's own scope, bounded containers and buckets.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const HOST_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MINUTE: number = 60 * 1000;
// The incident: 14:30. The window: 30 minutes before it.
const START: Date = new Date("2026-10-16T14:00:00.000Z");
const END: Date = new Date("2026-10-16T14:30:00.000Z");
const READ_START: Date = new Date(START.getTime() - LOOKBACK_MINUTES * MINUTE);

function rootRun(): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: { isRoot: true, tenantId: PROJECT_ID },
  };
}

function memberWith(permissions: Array<Permission>): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [PROJECT_ID],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          _type: "UserTenantAccessPermission",
          permissions: permissions.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            };
          }),
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function hostRow(): JSONObject {
  return {
    _id: HOST_ID.toString(),
    name: "web-1",
    hostIdentifier: "web-1",
    isArchived: false,
    lastSeenAt: END,
  };
}

function args(extra: JSONObject = {}): JSONObject {
  return {
    resourceType: AIResourceType.DockerHost,
    resourceId: HOST_ID.toString(),
    startTime: START.toISOString(),
    endTime: END.toISOString(),
    ...extra,
  };
}

interface ContainerFixture {
  name: string;
  image: string;
  // Minutes after the read start it reported, inclusive.
  from: number;
  to: number;
  cpu: number;
  memory?: number;
  restarts?: [number, number];
}

/*
 * The four reads, answered from the fixtures: per-minute CPU (with image),
 * peak memory, and the highest and lowest restart count.
 */
function answerFrom(containers: Array<ContainerFixture>): void {
  jest
    .spyOn(MetricService, "aggregateBy")
    .mockImplementation(
      async (request: AggregateBy<Metric>): Promise<AggregatedResult> => {
        requests.push(request);
        const name: unknown = (request.query as JSONObject)["name"];

        if (name === CONTAINER_CPU_METRIC) {
          const data: Array<AggregatedModel> = [];

          for (const container of containers) {
            for (
              let minute: number = container.from;
              minute <= container.to;
              minute++
            ) {
              data.push({
                timestamp: new Date(READ_START.getTime() + minute * MINUTE),
                value: container.cpu,
                attributes: {
                  "resource.container.name": container.name,
                  "resource.container.image.name": container.image,
                },
              } as AggregatedModel);
            }
          }

          return { data };
        }

        if (name === CONTAINER_MEMORY_METRIC) {
          return {
            data: containers
              .filter((container: ContainerFixture): boolean => {
                return container.memory !== undefined;
              })
              .map((container: ContainerFixture): AggregatedModel => {
                return {
                  timestamp: START,
                  value: container.memory!,
                  attributes: { "resource.container.name": container.name },
                } as AggregatedModel;
              }),
          };
        }

        return {
          data: containers
            .filter((container: ContainerFixture): boolean => {
              return container.restarts !== undefined;
            })
            .map((container: ContainerFixture): AggregatedModel => {
              return {
                timestamp: START,
                value:
                  request.aggregationType === AggregationType.Max
                    ? container.restarts![1]
                    : container.restarts![0],
                attributes: { "resource.container.name": container.name },
              } as AggregatedModel;
            }),
        };
      },
    );
}

let requests: Array<AggregateBy<Metric>>;
let findDockerHost: SpyInstance<typeof DockerHostService.findBy>;

beforeEach(() => {
  requests = [];
  findDockerHost = jest
    .spyOn(DockerHostService, "findBy")
    .mockResolvedValue([hostRow()] as never);
  jest
    .spyOn(PodmanHostService, "findBy")
    .mockResolvedValue([hostRow()] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the customer's cases", () => {
  test("a CPU-bound container leads the list, its CPU in percent of a core", async () => {
    answerFrom([
      {
        name: "nginx",
        image: "nginx:1.27",
        from: 0,
        to: 45,
        cpu: 4,
        memory: 10,
        restarts: [0, 0],
      },
      {
        name: "shop-api",
        image: "acme/shop-api:2.1",
        from: 0,
        to: 45,
        cpu: 197.4,
        memory: 35,
        restarts: [0, 0],
      },
      {
        name: "redis",
        image: "redis:7",
        from: 0,
        to: 45,
        cpu: 1.2,
        memory: 61.5,
        restarts: [0, 0],
      },
    ]);

    const result: ToolExecutionResult = await QueryContainersTool.execute(
      args(),
      rootRun(),
    );
    const lines: Array<string> = result.dataForLlm.split("\n");

    expect(lines[0]).toBe(
      `- container=shop-api | image=acme/shop-api:2.1 | status=reporting | lastSeen=${END.toISOString()} | cpuAvgPercent=197.4 | cpuPeakPercent=197.4 | memoryPeakPercent=35 | restartsInWindow=0`,
    );
    expect(lines[1]).toContain("container=nginx");
    expect(lines[2]).toContain("container=redis");
    expect(result.dataForLlm).toContain(
      "3 container(s) reported; 0 stopped reporting",
    );
    expect(result.dataForLlm).toContain(
      "CPU is in percent of one core (100 = one full core)",
    );
    expect(result.rowCount).toBe(3);
    expect(result.isTruncated).toBe(false);
  });

  test("a container that stopped 3 minutes before the incident leads the list as stopped reporting", async () => {
    answerFrom([
      {
        name: "shop-api",
        image: "acme/shop-api:2.1",
        from: 0,
        to: 42,
        cpu: 6,
        restarts: [0, 0],
      },
      {
        name: "nginx",
        image: "nginx:1.27",
        from: 0,
        to: 45,
        cpu: 4,
        restarts: [0, 0],
      },
      {
        name: "redis",
        image: "redis:7",
        from: 0,
        to: 45,
        cpu: 1,
        restarts: [0, 0],
      },
    ]);

    const result: ToolExecutionResult = await QueryContainersTool.execute(
      args(),
      rootRun(),
    );

    expect(result.dataForLlm.split("\n")[0]).toBe(
      `- container=shop-api | image=acme/shop-api:2.1 | status=stopped reporting | lastSeen=${new Date(READ_START.getTime() + 42 * MINUTE).toISOString()} | cpuAvgPercent=6 | cpuPeakPercent=6 | memoryPeakPercent=no data | restartsInWindow=0`,
    );
    expect(result.dataForLlm).toContain(
      `3 container(s) reported; 1 stopped reporting (silent for at least 2 minutes while the host's other containers kept reporting, up to ${END.toISOString()})`,
    );
    expect(result.dataForLlm).toContain(
      "A stopped or crashed container sends nothing rather than zero.",
    );
  });

  test("restarts in the window are the highest count minus the lowest", async () => {
    answerFrom([
      { name: "api", image: "api", from: 0, to: 45, cpu: 3, restarts: [2, 5] },
    ]);

    const result: ToolExecutionResult = await QueryContainersTool.execute(
      args({ sortBy: "restarts" }),
      rootRun(),
    );

    expect(result.dataForLlm).toContain("restartsInWindow=3");
  });

  test("a container redeployed in the window says which image it ran before", async () => {
    answerFrom([
      { name: "api", image: "acme/api:1.3", from: 0, to: 20, cpu: 3 },
      { name: "api", image: "acme/api:1.4", from: 21, to: 45, cpu: 3 },
    ]);

    const result: ToolExecutionResult = await QueryContainersTool.execute(
      args(),
      rootRun(),
    );

    expect(result.dataForLlm).toContain(
      "image=acme/api:1.4 | imageChangedFrom=acme/api:1.3",
    );
  });

  test("no container data says so, and that missing data is not health", async () => {
    answerFrom([]);

    const result: ToolExecutionResult = await QueryContainersTool.execute(
      args(),
      rootRun(),
    );

    expect(result.dataForLlm).toContain("(no rows found)");
    expect(result.dataForLlm).toContain(
      "No container reported container.cpu.utilization for this host in that time.",
    );
    expect(result.dataForLlm).toContain(
      "Missing data is not evidence of health.",
    );
    expect(result.widget).toBeUndefined();
  });
});

describe("how it reads", () => {
  test("four reads, each held to the project and the host's own Docker scope", async () => {
    answerFrom([]);

    await QueryContainersTool.execute(args(), rootRun());

    expect(requests).toHaveLength(4);

    for (const request of requests) {
      expect(request.query).toEqual(
        expect.objectContaining({
          projectId: PROJECT_ID,
          resourceEntityScopes: [
            {
              entityIds: [HOST_ID.toString()],
              entityKeys: [keyForHost(PROJECT_ID.toString(), "web-1")],
              attributeKey: "resource.host.name",
              attributeValues: ["web-1"],
            },
          ],
          attributes: { "resource.container.runtime": "docker" },
        }),
      );
      expect(request.topK).toEqual({
        count: MAX_CONTAINERS_READ,
        rankBy: "max",
      });
      expect(request.props).toEqual(rootRun().props);
    }

    const [cpu, memory, restartsHigh, restartsLow] = requests;

    expect((cpu!.query as JSONObject)["name"]).toBe(CONTAINER_CPU_METRIC);
    expect(cpu!.aggregationType).toBe(AggregationType.Avg);
    expect(cpu!.groupByAttributeKeys).toEqual([
      "resource.container.name",
      "resource.container.image.name",
    ]);
    // From the lookback before the window to its end, minute by minute.
    expect(cpu!.startTimestamp).toEqual(READ_START);
    expect(cpu!.endTimestamp).toEqual(END);
    expect(cpu!.aggregationInterval).toBe(AggregationInterval.Minute);
    expect(cpu!.limit).toBe(MAX_CONTAINERS_READ * (46 + 1));

    for (const request of [memory!, restartsHigh!, restartsLow!]) {
      expect(request.aggregationInterval).toBe(AggregationInterval.Total);
      expect(request.groupByAttributeKeys).toEqual(["resource.container.name"]);
      expect(request.startTimestamp).toEqual(START);
    }

    expect((memory!.query as JSONObject)["name"]).toBe(CONTAINER_MEMORY_METRIC);
    expect(memory!.aggregationType).toBe(AggregationType.Max);
    expect((restartsHigh!.query as JSONObject)["name"]).toBe(
      CONTAINER_RESTARTS_METRIC,
    );
    expect(restartsHigh!.aggregationType).toBe(AggregationType.Max);
    expect(restartsLow!.aggregationType).toBe(AggregationType.Min);
  });

  test("a Podman host reads its Podman containers", async () => {
    answerFrom([]);

    await QueryContainersTool.execute(
      args({ resourceType: AIResourceType.PodmanHost }),
      rootRun(),
    );

    expect((requests[0]!.query as JSONObject)["attributes"]).toEqual({
      "resource.container.runtime": "podman",
    });
  });

  test("the host is read as the caller may read it, in the project; not found reads no metrics", async () => {
    findDockerHost.mockResolvedValue([] as never);
    answerFrom([]);
    const ctx: ToolContext = rootRun();

    await expect(QueryContainersTool.execute(args(), ctx)).rejects.toThrow(
      "Resource not found or you do not have access to it.",
    );
    expect(findDockerHost).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT_ID, _id: HOST_ID.toString() },
        props: ctx.props,
        limit: 1,
      }),
    );
    expect(requests).toEqual([]);
  });

  test.each([
    [{ resourceType: "Host" }, "resourceType must be DockerHost or PodmanHost"],
    [
      { resourceType: "KubernetesCluster" },
      "resourceType must be DockerHost or PodmanHost",
    ],
    [{ resourceId: "web-1" }, "resourceId must be the host's OneUptime UUID"],
    [{ sortBy: "network" }, "sortBy must be cpu, memory or restarts"],
  ])(
    "refuses %j before reading anything",
    async (extra: JSONObject, message: string) => {
      answerFrom([]);

      await expect(
        QueryContainersTool.execute(args(extra), rootRun()),
      ).rejects.toThrow(message);
      expect(findDockerHost).not.toHaveBeenCalled();
      expect(requests).toEqual([]);
    },
  );

  test("a long window is read in wider buckets, never more than the activity budget", () => {
    for (const hours of [0.5, 1, 3, 12, 24, 24 * 7]) {
      const end: Date = new Date(READ_START.getTime() + hours * 60 * MINUTE);
      const interval: AggregationInterval = chooseActivityInterval(
        READ_START,
        end,
      );

      expect(
        countBuckets({ startTime: READ_START, endTime: end, interval }),
      ).toBeLessThanOrEqual(MAX_ACTIVITY_BUCKETS);
    }

    expect(
      chooseActivityInterval(
        READ_START,
        new Date(READ_START.getTime() + 75 * MINUTE),
      ),
    ).toBe(AggregationInterval.Minute);
  });

  test("more containers than listed: the busiest are listed and the rest are counted", async () => {
    const many: Array<ContainerFixture> = [];

    for (let index: number = 0; index < 14; index++) {
      many.push({
        name: `worker-${String(index).padStart(2, "0")}`,
        image: "acme/worker:1",
        from: 0,
        to: 45,
        cpu: index,
      });
    }

    answerFrom(many);

    const result: ToolExecutionResult = await QueryContainersTool.execute(
      args({ limit: 5 }),
      rootRun(),
    );

    expect(result.rowCount).toBe(5);
    expect(result.dataForLlm.split("\n")[0]).toContain("container=worker-13");
    expect(result.dataForLlm).toContain(
      "Listing 5 of 14: raise limit (max 25) or sort differently to see others.",
    );
    expect(result.isTruncated).toBe(true);
  });

  test("the citation and the table link to the host's own page", async () => {
    answerFrom([
      {
        name: "api",
        image: "api",
        from: 0,
        to: 45,
        cpu: 3,
        memory: 12,
        restarts: [0, 0],
      },
    ]);

    const result: ToolExecutionResult = await QueryContainersTool.execute(
      args(),
      rootRun(),
    );

    expect(result.citationLabel).toBe(
      `Containers of Docker host web-1, ${START.toISOString()} – ${END.toISOString()}`,
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.TelemetryResourceView,
      params: {
        resourceType: AIResourceType.DockerHost,
        resourceId: HOST_ID.toString(),
      },
    });
    expect(result.widget?.type).toBe(AIChatWidgetType.Table);
    expect(
      (result.widget?.data as unknown as { rows: Array<JSONObject> }).rows,
    ).toEqual([
      {
        container: "api",
        image: "api",
        status: "reporting",
        cpuAvg: 3,
        cpuPeak: 3,
        memoryPeak: 12,
        restarts: 0,
        lastSeen: END.toISOString(),
      },
    ]);
  });
});

describe("who may use it", () => {
  test("it is offered read-only to the AI, by name", () => {
    expect(AIToolbox.getToolByName(QUERY_CONTAINERS_TOOL_NAME)).toBe(
      QueryContainersTool,
    );
    expect(AIToolbox.isMutationTool(QUERY_CONTAINERS_TOOL_NAME)).toBe(false);
  });

  test("it needs the host's read permission and the metric read permission", () => {
    expect(
      QueryContainersTool.getRequiredPermissionGroups!({
        resourceType: AIResourceType.DockerHost,
      }),
    ).toEqual([
      new DockerHost().getReadPermissions(),
      expect.arrayContaining([
        ...new Metric().getReadPermissions(),
        Permission.ReadAllOperationalResources,
      ]),
    ]);
    expect(
      QueryContainersTool.getRequiredPermissionGroups!({
        resourceType: AIResourceType.PodmanHost,
      })[0],
    ).toEqual(new PodmanHost().getReadPermissions());
    // An unknown kind of resource fails closed.
    expect(
      QueryContainersTool.getRequiredPermissionGroups!({
        resourceType: "Host",
      })[0],
    ).toEqual([]);
  });

  test("a member who reads Docker hosts but not metrics is refused", () => {
    expect(
      AIToolbox.hasPermissionForTool(
        QueryContainersTool,
        memberWith([Permission.ReadDockerHost]),
        args(),
      ),
    ).toBe(false);
    expect(
      AIToolbox.hasPermissionForTool(
        QueryContainersTool,
        memberWith([
          Permission.ReadDockerHost,
          Permission.ReadTelemetryServiceMetrics,
        ]),
        args(),
      ),
    ).toBe(true);
    expect(
      AIToolbox.hasPermissionForTool(
        QueryContainersTool,
        memberWith([Permission.ReadTelemetryServiceMetrics]),
        args(),
      ),
    ).toBe(false);
  });
});
