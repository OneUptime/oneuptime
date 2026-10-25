import ChatInfrastructureAccess, {
  ChatInfrastructureStatuses,
  ChatInfrastructureTools,
  ChatPageInfrastructure,
  INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
  MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER,
  PAGE_INFRASTRUCTURE_SECTION_HEADING,
  WITHOUT_ACCESS_SECTION_HEADING,
} from "../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import { ChatExtraTool } from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import { READ_TOOL_OUTPUT_TOOL_NAME } from "../../../../Server/Utils/AI/Chat/ToolOutputPager";
import ResourceAiAccessService, {
  ResourceAiAccessProjectGates,
  ResourceAiAccessRow,
} from "../../../../Server/Services/ResourceAiAccessService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import IncidentService from "../../../../Server/Services/IncidentService";
import AlertService from "../../../../Server/Services/AlertService";
import ResourceCommandJobRunner, {
  ResourceCommandJobOutcome,
  ResourceCommandRunState,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import KubectlJobRunner, {
  KubectlJobOutcome,
  KubectlRunState,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { KubernetesClusterAiAccessStatus } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5259: on a host's page, with the Host AI agent connected and its
 * test commands passing, Ask AI answered "Call 'uptime' command on remote
 * host" with "I don't have a tool that can execute commands on remote
 * hosts". The read-only commands an investigation of that host could run
 * were never offered to Ask AI.
 *
 * These pin what a chat turn may now run on infrastructure, and for whom:
 * the resource or Kubernetes cluster its page is about (or what an incident
 * or alert there is linked to), through the investigation's own read-only
 * toolkits, only for what the person asking may view - and why nothing can
 * run when it cannot.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLUSTER_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RUNNER_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INCIDENT_ID: string = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ALERT_ID: string = "12121212-1212-4121-8121-121212121212";
const OTHER_HOST_ID: string = "78787878-7878-4787-8787-787878787878";
const RUN_ID: ObjectID = new ObjectID("34343434-3434-4343-8343-343434343434");

// The person asking: the turn's commands are theirs.
const ASKER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("56565656-5656-4565-8565-565656565656"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

const GATES: ResourceAiAccessProjectGates = {
  isAiEnabled: true,
  hasLlmProvider: true,
  aiBalanceBlocker: null,
};

const UPTIME_OUTPUT: string =
  " 15:42:01 up 12 days,  3:04,  1 user,  load average: 0.08, 0.03, 0.01";

function hostRow(
  overrides?: Partial<ResourceAiAccessRow> | undefined,
): ResourceAiAccessRow {
  return {
    resourceType: AiResourceType.Host,
    id: new ObjectID(HOST_ID),
    projectId: PROJECT_ID,
    name: "test01",
    identifier: "test01",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
    aiCommandAllowlist: [],
    isArchived: false,
    ...overrides,
  };
}

/*
 * The issue's agent: ONEUPTIME_AI_AGENT_RESOURCE_TYPE=host, HOST_NAME=test01,
 * ONEUPTIME_AI_ALLOW_WRITES=true - connected, and able to reach the host.
 */
function hostAgent(data?: {
  online?: boolean | undefined;
  reachable?: boolean | undefined;
}): ResourceAiAgent {
  const isOnline: boolean = data?.online !== false;
  const agent: ResourceAiAgent = new ResourceAiAgent(new ObjectID(AGENT_ID));
  agent.projectId = PROJECT_ID;
  agent.resourceType = AiResourceType.Host;
  agent.resourceId = new ObjectID(HOST_ID);
  agent.resourceIdentifier = "test01";
  agent.connectionStatus = isOnline ? "connected" : "disconnected";
  agent.lastAliveAt = isOnline
    ? new Date()
    : new Date(Date.now() - 2 * 60 * 60 * 1000);
  agent.posture = {
    resourceType: AiResourceType.Host,
    resourceIdentifier: "test01",
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: data?.reachable !== false,
    ...(data?.reachable === false
      ? { reachError: "pid 1 is in the agent's own mount namespace" }
      : {}),
  };
  return agent;
}

// A host's status, computed the way the access service computes it.
function hostStatus(data?: {
  row?: Partial<ResourceAiAccessRow> | undefined;
  agent?: ResourceAiAgent | null | undefined;
}): ResourceAiAccessStatus {
  return ResourceAiAccessService.buildStatus({
    resource: hostRow(data?.row),
    agentRow:
      data && Object.prototype.hasOwnProperty.call(data, "agent")
        ? data.agent || null
        : hostAgent(),
    gates: GATES,
  });
}

function otherHostStatus(): ResourceAiAccessStatus {
  return {
    ...hostStatus(),
    resourceId: OTHER_HOST_ID,
    resourceName: "payments-host",
  };
}

function readyCluster(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-gke",
    clusterIdentifier: "prod-gke",
    isInvestigationReady: true,
    isRemediationReady: false,
    runner: {
      id: RUNNER_ID,
      name: "kubernetes-ai-agent",
      kind: "ai_agent",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    gaps: [],
  } as unknown as KubernetesClusterAiAccessStatus;
}

function hostPage(
  overrides?: Partial<AIChatPageContext> | undefined,
): AIChatPageContext {
  return {
    type: AIChatPageContextType.Resource,
    resourceType: AIResourceType.Host,
    entityId: HOST_ID,
    entityTitle: "test01",
    ...overrides,
  };
}

function toolNames(tools: Array<ChatExtraTool>): Array<string> {
  return tools.map((tool: ChatExtraTool): string => {
    return tool.definition.name;
  });
}

function toolNamed(
  tools: Array<ChatExtraTool>,
  name: string,
): ChatExtraTool | undefined {
  return tools.find((tool: ChatExtraTool): boolean => {
    return tool.definition.name === name;
  });
}

/*
 * The view checks, standing in for the services' own (the Postgres suite
 * KubernetesClusterEditScopePostgres runs them for real): every status the
 * person may view, all of them unless ids are given.
 */
function installViewChecks(data?: {
  viewableClusterIds?: Array<string> | undefined;
  viewableResourceIds?: Array<string> | undefined;
}): { clusterCheck: SpyInstance; resourceCheck: SpyInstance } {
  const clusterCheck: SpyInstance = jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusesViewableBy")
    .mockImplementation((async (args: {
      statuses: Array<KubernetesClusterAiAccessStatus>;
    }): Promise<Array<KubernetesClusterAiAccessStatus>> => {
      return args.statuses.filter(
        (status: KubernetesClusterAiAccessStatus): boolean => {
          return (
            !data?.viewableClusterIds ||
            data.viewableClusterIds.includes(status.clusterId)
          );
        },
      );
    }) as never);

  const resourceCheck: SpyInstance = jest
    .spyOn(ResourceAiAccessService, "getStatusesViewableBy")
    .mockImplementation((async (args: {
      statuses: Array<ResourceAiAccessStatus>;
    }): Promise<Array<ResourceAiAccessStatus>> => {
      return args.statuses.filter((status: ResourceAiAccessStatus): boolean => {
        return (
          !data?.viewableResourceIds ||
          data.viewableResourceIds.includes(status.resourceId)
        );
      });
    }) as never);

  return { clusterCheck, resourceCheck };
}

interface StatusLookups {
  resourceStatus: SpyInstance;
  clusterStatus: SpyInstance;
  resourceSubject: SpyInstance;
  clusterSubject: SpyInstance;
  incidentRead: SpyInstance;
  alertRead: SpyInstance;
}

function installStatusLookups(data?: {
  resource?: ResourceAiAccessStatus | null | undefined;
  cluster?: KubernetesClusterAiAccessStatus | null | undefined;
  subjectResources?: Array<ResourceAiAccessStatus> | undefined;
  subjectClusters?: Array<KubernetesClusterAiAccessStatus> | undefined;
  // Whether the person asking may read the incident or alert on the page.
  isSubjectReadable?: boolean | undefined;
}): StatusLookups {
  const isSubjectReadable: boolean = data?.isSubjectReadable !== false;

  return {
    resourceStatus: jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue((data?.resource ?? null) as never),
    clusterStatus: jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue((data?.cluster ?? null) as never),
    resourceSubject: jest
      .spyOn(ResourceAiAccessService, "getStatusesForSubject")
      .mockResolvedValue((data?.subjectResources ?? []) as never),
    clusterSubject: jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue((data?.subjectClusters ?? []) as never),
    incidentRead: jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(
        (isSubjectReadable
          ? new Incident(new ObjectID(INCIDENT_ID))
          : null) as never,
      ),
    alertRead: jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(
        (isSubjectReadable ? new Alert(new ObjectID(ALERT_ID)) : null) as never,
      ),
  };
}

function expectNoLookups(lookups: StatusLookups): void {
  expect(lookups.resourceStatus).not.toHaveBeenCalled();
  expect(lookups.clusterStatus).not.toHaveBeenCalled();
  expect(lookups.resourceSubject).not.toHaveBeenCalled();
  expect(lookups.clusterSubject).not.toHaveBeenCalled();
}

function uptimeOutcome(): ResourceCommandJobOutcome {
  return {
    jobId: ObjectID.generate().toString(),
    succeeded: true,
    exitCode: 0,
    output: UPTIME_OUTPUT,
    displayCommand: "uptime",
    executed: true,
    runState: ResourceCommandRunState.Ran,
  };
}

describe("ChatInfrastructureAccess.getAiResourceType", () => {
  test.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )(
    "a %s page is reached through that resource's own AI agent",
    (type: AiResourceType) => {
      expect(
        ChatInfrastructureAccess.getAiResourceType(
          type as unknown as AIResourceType,
        ),
      ).toBe(type);
    },
  );

  test.each([
    [AIResourceType.KubernetesCluster],
    [AIResourceType.StorageArray],
    [AIResourceType.ServerlessFunction],
    [AIResourceType.CloudResource],
    [AIResourceType.IoTFleet],
    [AIResourceType.NetworkDevice],
  ])("a %s has no resource AI agent", (type: AIResourceType) => {
    expect(ChatInfrastructureAccess.getAiResourceType(type)).toBeNull();
  });

  test("no resource type, no agent", () => {
    expect(ChatInfrastructureAccess.getAiResourceType(undefined)).toBeNull();
  });

  test("every page resource type is decided: an agent of its own, or none", () => {
    // A new resource type fails here until someone decides how Ask AI reaches it.
    const decided: Array<AIResourceType> = Object.values(AIResourceType).filter(
      (type: AIResourceType): boolean => {
        return (
          ChatInfrastructureAccess.getAiResourceType(type) !== null ||
          [
            AIResourceType.KubernetesCluster,
            AIResourceType.StorageArray,
            AIResourceType.ServerlessFunction,
            AIResourceType.CloudResource,
            AIResourceType.IoTFleet,
            AIResourceType.NetworkDevice,
          ].includes(type)
        );
      },
    );

    expect(decided).toEqual(Object.values(AIResourceType));
  });
});

describe("ChatInfrastructureAccess.getStatusesForPage", () => {
  test("the issue's page - a host - asks for that host's status in this project", async () => {
    const lookups: StatusLookups = installStatusLookups({
      resource: hostStatus(),
    });

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    expect(lookups.resourceStatus).toHaveBeenCalledTimes(1);
    const args: {
      projectId: ObjectID;
      resourceType: AiResourceType;
      resourceId: ObjectID;
    } = lookups.resourceStatus.mock.calls[0]![0] as {
      projectId: ObjectID;
      resourceType: AiResourceType;
      resourceId: ObjectID;
    };
    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.resourceType).toBe(AiResourceType.Host);
    expect(args.resourceId.toString()).toBe(HOST_ID);
    expect(
      statuses.resources.map((s: ResourceAiAccessStatus) => {
        return s.resourceId;
      }),
    ).toEqual([HOST_ID]);
    expect(statuses.clusters).toEqual([]);
    expect(lookups.clusterStatus).not.toHaveBeenCalled();
    expect(lookups.resourceSubject).not.toHaveBeenCalled();
  });

  test.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )(
    "a %s page asks for that resource's status by its own type",
    async (type: AiResourceType) => {
      const lookups: StatusLookups = installStatusLookups({
        resource: { ...hostStatus(), resourceType: type },
      });

      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: hostPage({
          resourceType: type as unknown as AIResourceType,
        }),
      });

      expect(
        (
          lookups.resourceStatus.mock.calls[0]![0] as {
            resourceType: AiResourceType;
          }
        ).resourceType,
      ).toBe(type);
    },
  );

  test("a child page (a systemd unit of the host) is about the host itself", async () => {
    const lookups: StatusLookups = installStatusLookups({
      resource: hostStatus(),
    });

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: hostPage({
          subresource: {
            kind: "SystemdUnit" as never,
            key: "nginx.service",
          },
        }),
      });

    expect(lookups.resourceStatus).toHaveBeenCalledTimes(1);
    expect(statuses.resources).toHaveLength(1);
  });

  test("a resource that is not the project's has no status, so nothing", async () => {
    installStatusLookups({ resource: null });

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    expect(statuses).toEqual({ clusters: [], resources: [] });
  });

  test("a Kubernetes cluster page asks for that cluster's status, through its own agent", async () => {
    const lookups: StatusLookups = installStatusLookups({
      cluster: readyCluster(),
    });

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: hostPage({
          resourceType: AIResourceType.KubernetesCluster,
          entityId: CLUSTER_ID,
        }),
      });

    expect(lookups.clusterStatus).toHaveBeenCalledTimes(1);
    const args: { clusterId: ObjectID; projectId: ObjectID } = lookups
      .clusterStatus.mock.calls[0]![0] as {
      clusterId: ObjectID;
      projectId: ObjectID;
    };
    expect(args.clusterId.toString()).toBe(CLUSTER_ID);
    expect(args.projectId).toBe(PROJECT_ID);
    expect(statuses.clusters).toEqual([readyCluster()]);
    expect(lookups.resourceStatus).not.toHaveBeenCalled();
  });

  test.each([
    [AIResourceType.StorageArray],
    [AIResourceType.ServerlessFunction],
    [AIResourceType.CloudResource],
    [AIResourceType.IoTFleet],
    [AIResourceType.NetworkDevice],
  ])(
    "a %s page is about nothing an AI agent reaches",
    async (type: AIResourceType) => {
      const lookups: StatusLookups = installStatusLookups();

      const statuses: ChatInfrastructureStatuses =
        await ChatInfrastructureAccess.getStatusesForPage({
          projectId: PROJECT_ID,
          props: ASKER_PROPS,
          pageContext: hostPage({ resourceType: type }),
        });

      expect(statuses).toEqual({ clusters: [], resources: [] });
      expectNoLookups(lookups);
    },
  );

  test("an incident the person may read: its linked clusters and resources, by incident", async () => {
    const lookups: StatusLookups = installStatusLookups({
      subjectResources: [hostStatus()],
      subjectClusters: [readyCluster()],
    });

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT_ID,
        },
      });

    // Read under the asker's own props, pinned to this project.
    const read: {
      query: { _id: string; projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    } = lookups.incidentRead.mock.calls[0]![0] as {
      query: { _id: string; projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    };
    expect(read.query._id).toBe(INCIDENT_ID);
    expect(read.query.projectId).toBe(PROJECT_ID);
    expect(read.props.userId).toBe(ASKER_PROPS.userId);
    expect(read.props.tenantId).toBe(PROJECT_ID);
    expect(read.props.isMultiTenantRequest).toBe(false);
    expect(read.props.isRoot).toBeUndefined();

    for (const lookup of [lookups.resourceSubject, lookups.clusterSubject]) {
      const args: { projectId: ObjectID; incidentId: ObjectID } = lookup.mock
        .calls[0]![0] as { projectId: ObjectID; incidentId: ObjectID };
      expect(args.projectId).toBe(PROJECT_ID);
      expect(args.incidentId.toString()).toBe(INCIDENT_ID);
    }

    expect(statuses.resources).toHaveLength(1);
    expect(statuses.clusters).toHaveLength(1);
  });

  test("an alert the person may read: its linked clusters and resources, by alert", async () => {
    const lookups: StatusLookups = installStatusLookups({
      subjectResources: [hostStatus()],
    });

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: { type: AIChatPageContextType.Alert, entityId: ALERT_ID },
      });

    expect(lookups.alertRead).toHaveBeenCalledTimes(1);
    expect(lookups.incidentRead).not.toHaveBeenCalled();
    const args: { alertId: ObjectID; incidentId?: ObjectID } = lookups
      .resourceSubject.mock.calls[0]![0] as {
      alertId: ObjectID;
      incidentId?: ObjectID;
    };
    expect(args.alertId.toString()).toBe(ALERT_ID);
    expect(args.incidentId).toBeUndefined();
    expect(statuses.resources).toHaveLength(1);
  });

  test("an incident the person may not read offers nothing, and its links are never read", async () => {
    const lookups: StatusLookups = installStatusLookups({
      subjectResources: [hostStatus()],
      isSubjectReadable: false,
    });

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT_ID,
        },
      });

    expect(statuses).toEqual({ clusters: [], resources: [] });
    expect(lookups.resourceSubject).not.toHaveBeenCalled();
    expect(lookups.clusterSubject).not.toHaveBeenCalled();
  });

  test("on an incident, a failed cluster lookup still leaves its linked resources", async () => {
    const lookups: StatusLookups = installStatusLookups({
      subjectResources: [hostStatus()],
    });
    lookups.clusterSubject.mockRejectedValue(
      new Error("cluster lookup failed") as never,
    );

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT_ID,
        },
      });

    expect(statuses.clusters).toEqual([]);
    expect(statuses.resources).toHaveLength(1);
  });

  test("on an alert, a failed resource lookup still leaves its linked clusters", async () => {
    const lookups: StatusLookups = installStatusLookups({
      subjectClusters: [readyCluster()],
    });
    lookups.resourceSubject.mockRejectedValue(
      new Error("resource lookup failed") as never,
    );

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: { type: AIChatPageContextType.Alert, entityId: ALERT_ID },
      });

    expect(statuses.clusters).toEqual([readyCluster()]);
    expect(statuses.resources).toEqual([]);
  });

  test("a read the permission layer refuses is the same as an unreadable incident", async () => {
    const lookups: StatusLookups = installStatusLookups({
      subjectResources: [hostStatus()],
    });
    lookups.incidentRead.mockRejectedValue(
      new NotAuthorizedException("no") as never,
    );

    const statuses: ChatInfrastructureStatuses =
      await ChatInfrastructureAccess.getStatusesForPage({
        projectId: PROJECT_ID,
        props: ASKER_PROPS,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT_ID,
        },
      });

    expect(statuses).toEqual({ clusters: [], resources: [] });
    expect(lookups.resourceSubject).not.toHaveBeenCalled();
  });

  test.each(
    Object.values(AIChatPageContextType)
      .filter((type: AIChatPageContextType): boolean => {
        return (
          type !== AIChatPageContextType.Resource &&
          type !== AIChatPageContextType.Incident &&
          type !== AIChatPageContextType.Alert
        );
      })
      .map((type: AIChatPageContextType) => {
        return [type];
      }),
  )(
    "a %s page is about no infrastructure an agent reaches",
    async (type: AIChatPageContextType) => {
      const lookups: StatusLookups = installStatusLookups({
        resource: hostStatus(),
      });

      const statuses: ChatInfrastructureStatuses =
        await ChatInfrastructureAccess.getStatusesForPage({
          projectId: PROJECT_ID,
          props: ASKER_PROPS,
          pageContext: {
            type,
            entityId: HOST_ID,
            resourceType: AIResourceType.Host,
          },
        });

      expect(statuses).toEqual({ clusters: [], resources: [] });
      expectNoLookups(lookups);
      expect(lookups.incidentRead).not.toHaveBeenCalled();
    },
  );

  test("no page, a list page, or an id that is not one, is about nothing", async () => {
    const lookups: StatusLookups = installStatusLookups({
      resource: hostStatus(),
    });

    for (const pageContext of [
      undefined,
      {
        type: AIChatPageContextType.ResourcesList,
        resourceType: AIResourceType.Host,
      },
      hostPage({ entityId: "test01" }),
      hostPage({ entityId: undefined }),
    ]) {
      expect(
        await ChatInfrastructureAccess.getStatusesForPage({
          projectId: PROJECT_ID,
          props: ASKER_PROPS,
          pageContext: pageContext as AIChatPageContext | undefined,
        }),
      ).toEqual({ clusters: [], resources: [] });
    }

    expectNoLookups(lookups);
  });
});

describe("ChatInfrastructureAccess.buildTools", () => {
  test("asks which clusters and resources the person may view, with their props, in this project", async () => {
    const checks: { clusterCheck: SpyInstance; resourceCheck: SpyInstance } =
      installViewChecks();
    const host: ResourceAiAccessStatus = hostStatus();

    await ChatInfrastructureAccess.buildTools({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      props: ASKER_PROPS,
      statuses: { clusters: [readyCluster()], resources: [host] },
      offeredIn: "a test",
    });

    expect(checks.clusterCheck.mock.calls[0]![0]).toEqual({
      props: ASKER_PROPS,
      projectId: PROJECT_ID,
      statuses: [readyCluster()],
    });
    expect(checks.resourceCheck.mock.calls[0]![0]).toEqual({
      props: ASKER_PROPS,
      projectId: PROJECT_ID,
      statuses: [host],
    });
  });

  test("the issue's host - agent connected, investigation on - gets read-only commands and read_tool_output", async () => {
    installViewChecks();

    const tools: ChatInfrastructureTools =
      await ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: { clusters: [], resources: [hostStatus()] },
        offeredIn: "a test",
      });

    expect(toolNames(tools.extraTools)).toEqual([
      LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      READ_TOOL_OUTPUT_TOOL_NAME,
    ]);
    // Commands only read, so none waits for an approval or is withheld.
    expect(
      tools.extraTools.every((tool: ChatExtraTool): boolean => {
        return tool.isMutation !== true;
      }),
    ).toBe(true);
    expect(tools.hasInfrastructureAccess).toBe(true);
    expect(tools.hasClusterAccess).toBe(false);
    expect(tools.hasInfrastructureWithoutAccess).toBe(false);
    expect(tools.contextSections.join("\n")).toContain(
      `Host "test01" (resourceId: ${HOST_ID}): READ access via ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} through its Host AI agent`,
    );
    // The host's own programs, uptime among them.
    expect(
      toolNamed(tools.extraTools, RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME)!
        .definition.description,
    ).toContain("uptime");
    expect(tools.contextSections).not.toContain(
      INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
    );
  });

  test("a cluster gets read-only kubectl; with a host too, one read_tool_output reads both", async () => {
    installViewChecks();

    const tools: ChatInfrastructureTools =
      await ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: { clusters: [readyCluster()], resources: [hostStatus()] },
        offeredIn: "a test",
      });

    expect(toolNames(tools.extraTools)).toEqual([
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      RUN_KUBECTL_TOOL_NAME,
      LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      READ_TOOL_OUTPUT_TOOL_NAME,
    ]);
    expect(tools.hasClusterAccess).toBe(true);
    expect(tools.hasInfrastructureAccess).toBe(true);
    expect(tools.contextSections.join("\n")).toContain(
      `Cluster "prod-gke" (clusterId: ${CLUSTER_ID}): kubectl READ access`,
    );
  });

  test.each([
    {
      name: "no agent was ever installed",
      status: (): ResourceAiAccessStatus => {
        return hostStatus({ agent: null });
      },
      reason: "No Host AI agent is connected",
    },
    {
      name: "the agent is offline",
      status: (): ResourceAiAccessStatus => {
        return hostStatus({ agent: hostAgent({ online: false }) });
      },
      reason: "The Host AI agent is offline",
    },
    {
      name: "the agent cannot reach the host",
      status: (): ResourceAiAccessStatus => {
        return hostStatus({ agent: hostAgent({ reachable: false }) });
      },
      reason: "The Host AI agent cannot reach this host",
    },
    {
      name: "AI investigation is off for the host",
      status: (): ResourceAiAccessStatus => {
        return hostStatus({ row: { isAiInvestigationEnabled: false } });
      },
      reason: "AI investigation is turned off for this host",
    },
  ])(
    "$name: no commands, and the section says why",
    async (testCase: {
      status: () => ResourceAiAccessStatus;
      reason: string;
    }) => {
      installViewChecks();

      const tools: ChatInfrastructureTools =
        await ChatInfrastructureAccess.buildTools({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          props: ASKER_PROPS,
          statuses: { clusters: [], resources: [testCase.status()] },
          offeredIn: "a test",
        });

      expect(tools.extraTools).toEqual([]);
      expect(tools.hasInfrastructureAccess).toBe(false);
      expect(tools.hasInfrastructureWithoutAccess).toBe(true);
      expect(tools.contextSections.join("\n")).toContain(
        `Host "test01" (resourceId: ${HOST_ID}): NO direct access`,
      );
      expect(tools.contextSections.join("\n")).toContain(testCase.reason);
    },
  );

  test("fixes being off changes nothing about what a conversation may read", async () => {
    installViewChecks();

    const tools: ChatInfrastructureTools =
      await ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: {
          clusters: [],
          resources: [
            hostStatus({
              row: { aiRemediationMode: ResourceAiRemediationMode.Disabled },
            }),
          ],
        },
        offeredIn: "a test",
      });

    expect(toolNames(tools.extraTools)).toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
  });

  test("a host the person may not view is left out: no commands, nothing named, and they are told why", async () => {
    installViewChecks({ viewableResourceIds: [] });

    const tools: ChatInfrastructureTools =
      await ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: { clusters: [], resources: [hostStatus()] },
        offeredIn: "a test",
      });

    expect(tools.extraTools).toEqual([]);
    expect(tools.contextSections).toEqual([INFRASTRUCTURE_OUT_OF_VIEW_SECTION]);
    expect(tools.contextSections.join("\n")).not.toContain("test01");
    expect(tools.contextSections.join("\n")).not.toContain(HOST_ID);
  });

  test("of two hosts, only the one the person may view is offered - and asking for the other runs nothing", async () => {
    installViewChecks({ viewableResourceIds: [HOST_ID] });
    const run: SpyInstance = jest
      .spyOn(ResourceCommandJobRunner, "run")
      .mockResolvedValue(uptimeOutcome() as never);

    const tools: ChatInfrastructureTools =
      await ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: {
          clusters: [],
          resources: [hostStatus(), otherHostStatus()],
        },
        offeredIn: "a test",
      });

    const listed: string =
      (
        await toolNamed(
          tools.extraTools,
          LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        )!.execute({})
      ).result?.dataForLlm || "";

    expect(listed).toContain(HOST_ID);
    expect(listed).not.toContain(OTHER_HOST_ID);
    expect(tools.contextSections.join("\n")).not.toContain("payments-host");
    expect(tools.contextSections).toContain(INFRASTRUCTURE_OUT_OF_VIEW_SECTION);

    const outcome: ToolCallOutcome = await toolNamed(
      tools.extraTools,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    )!.execute({
      resourceId: OTHER_HOST_ID,
      command: "uptime",
      rationale: "How long has it been up?",
    });

    expect(outcome.success).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  test("a view check that cannot run fails the whole build, so nothing is offered", async () => {
    installViewChecks();
    (
      ResourceAiAccessService.getStatusesViewableBy as unknown as SpyInstance
    ).mockRejectedValue(new Error("permission read failed") as never);

    await expect(
      ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: { clusters: [], resources: [hostStatus()] },
        offeredIn: "a test",
      }),
    ).rejects.toThrow("permission read failed");
  });
});

describe("ChatInfrastructureAccess.buildPageInstructions", () => {
  test("with commands: runs them when asked, one program per call, read-only, never 'no tool'", () => {
    const text: string = ChatInfrastructureAccess.buildPageInstructions({
      hasClusterAccess: false,
      hasInfrastructureAccess: true,
      hasInfrastructureWithoutAccess: false,
    });

    expect(text.startsWith(PAGE_INFRASTRUCTURE_SECTION_HEADING)).toBe(true);
    expect(text).toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
    expect(text).toContain(LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME);
    expect(text).toContain('"run uptime on this host"');
    expect(text).toContain("run the command and show what it returned");
    expect(text).toContain("never say you have no tool for it");
    expect(text).toContain("One command per call");
    expect(text).toContain("never a shell line");
    expect(text).toContain(
      `at most ${MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER} through each kind of agent for one answer`,
    );
    expect(text).toContain(
      "These commands only read: a change (restart or stop a service, kill a process, scale, roll back, …) cannot be made with them.",
    );
    expect(text).toContain("Never claim a command changed the infrastructure");
    expect(text).toContain(READ_TOOL_OUTPUT_TOOL_NAME);
    // kubectl only where a cluster is reachable.
    expect(text).not.toContain(RUN_KUBECTL_TOOL_NAME);
    expect(text).not.toContain("NO direct access");
  });

  /*
   * The commands only read, but Ask AI's own actions (a runbook, say) are
   * the permission mode's to allow: the instructions forbid a change made
   * with the commands, never "trying" a change some other way.
   */
  test("forbids a change made with the commands, not Ask AI's own actions", () => {
    const text: string = ChatInfrastructureAccess.buildPageInstructions({
      hasClusterAccess: true,
      hasInfrastructureAccess: true,
      hasInfrastructureWithoutAccess: false,
    });

    expect(text).not.toContain("do not try it");
    expect(text).not.toContain("Never claim you changed");
  });

  test("with a cluster: names run_kubectl and its list", () => {
    const text: string = ChatInfrastructureAccess.buildPageInstructions({
      hasClusterAccess: true,
      hasInfrastructureAccess: false,
      hasInfrastructureWithoutAccess: false,
    });

    expect(text).toContain(RUN_KUBECTL_TOOL_NAME);
    expect(text).toContain(LIST_CLUSTER_ACCESS_TOOL_NAME);
    expect(text).not.toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
  });

  test("without commands: says what to answer when asked for one, and never to invent output", () => {
    const text: string = ChatInfrastructureAccess.buildPageInstructions({
      hasClusterAccess: false,
      hasInfrastructureAccess: false,
      hasInfrastructureWithoutAccess: true,
    });

    expect(text.startsWith(PAGE_INFRASTRUCTURE_SECTION_HEADING)).toBe(true);
    // How the access sections mark them: resources and clusters each their way.
    expect(text).toContain(
      "For a resource marked NO direct access or a cluster marked NO kubectl access below",
    );
    expect(text).toContain(
      "with the reason and what would change it (What would let you run commands, below)",
    );
    expect(text).toContain("Do not bring this up otherwise");
    expect(text).toContain("never invent command output");
    expect(text).not.toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
    expect(text).not.toContain(READ_TOOL_OUTPUT_TOOL_NAME);
  });

  test("nothing to instruct, nothing at all", () => {
    expect(
      ChatInfrastructureAccess.buildPageInstructions({
        hasClusterAccess: false,
        hasInfrastructureAccess: false,
        hasInfrastructureWithoutAccess: false,
      }),
    ).toBe("");
  });
});

describe("ChatInfrastructureAccess.buildWithoutAccessSection", () => {
  function clusterWithoutAccess(): KubernetesClusterAiAccessStatus {
    return {
      ...readyCluster(),
      isInvestigationReady: false,
      runner: null,
      accessMethod: "none",
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No Kubernetes AI agent is connected",
          description: "AI cannot run kubectl on this cluster.",
          nextStep: "Install the Kubernetes AI agent with the Kubernetes agent chart.",
          blocks: "both",
        },
        {
          code: "remediation_disabled",
          title: "AI fixes are turned off",
          description: "AI only investigates.",
          nextStep: "Set aiAgent.fixes on the Kubernetes agent chart.",
          blocks: "remediation",
        },
      ],
    } as unknown as KubernetesClusterAiAccessStatus;
  }

  test("an offline agent: why, and the step that fixes it, in the access service's own words", () => {
    const status: ResourceAiAccessStatus = hostStatus({
      agent: hostAgent({ online: false }),
    });
    const text: string = ChatInfrastructureAccess.buildWithoutAccessSection({
      clusters: [],
      resources: [status],
    });

    expect(text.startsWith(WITHOUT_ACCESS_SECTION_HEADING)).toBe(true);
    expect(text).toContain(
      '- Host "test01": The Host AI agent is offline. It last reported in at',
    );
    expect(text).toContain(
      "Check that its container is running and can reach your OneUptime URL",
    );
  });

  test("investigation off: where to turn it on", () => {
    const status: ResourceAiAccessStatus = hostStatus({
      row: { isAiInvestigationEnabled: false },
    });
    const gap: { title: string; nextStep: string } | undefined =
      status.gaps.find((candidate: { code: string }): boolean => {
        return candidate.code === "investigation_disabled";
      });

    expect(gap).toBeDefined();
    expect(
      ChatInfrastructureAccess.buildWithoutAccessSection({
        clusters: [],
        resources: [status],
      }),
    ).toContain(`- Host "test01": ${gap!.title}. ${gap!.nextStep}`);
  });

  test("a cluster: only what blocks investigation, never what only blocks fixes", () => {
    const text: string = ChatInfrastructureAccess.buildWithoutAccessSection({
      clusters: [clusterWithoutAccess()],
      resources: [],
    });

    expect(text).toContain(
      '- Cluster "prod-gke": No Kubernetes AI agent is connected. Install the Kubernetes AI agent with the Kubernetes agent chart.',
    );
    expect(text).not.toContain("AI fixes are turned off");
  });

  test("everything ready: nothing to say", () => {
    expect(
      ChatInfrastructureAccess.buildWithoutAccessSection({
        clusters: [readyCluster()],
        resources: [hostStatus()],
      }),
    ).toBe("");
  });

  test("the marks the instructions name are the ones the access sections write", async () => {
    installViewChecks();

    const tools: ChatInfrastructureTools =
      await ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: {
          clusters: [clusterWithoutAccess()],
          resources: [hostStatus({ agent: null })],
        },
        offeredIn: "a test",
      });
    const sections: string = tools.contextSections.join("\n");
    const instructions: string = ChatInfrastructureAccess.buildPageInstructions(
      {
        hasClusterAccess: false,
        hasInfrastructureAccess: false,
        hasInfrastructureWithoutAccess: true,
      },
    );

    for (const mark of ["NO direct access", "NO kubectl access"]) {
      expect(sections).toContain(mark);
      expect(instructions).toContain(mark);
    }
  });
});

describe("ChatInfrastructureAccess.buildForPage", () => {
  test(`one answer sends at most ${MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER} commands through the agent, and is told so up front`, async () => {
    installStatusLookups({ resource: hostStatus() });
    installViewChecks();
    const run: SpyInstance = jest
      .spyOn(ResourceCommandJobRunner, "run")
      .mockResolvedValue(uptimeOutcome() as never);

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });
    const tool: ChatExtraTool = toolNamed(
      infrastructure!.extraTools,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    )!;

    expect(tool.definition.description).toContain(
      `At most ${MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER} commands in this run.`,
    );

    for (let sent: number = 0; sent < MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER; sent++) {
      expect(
        (
          await tool.execute({
            resourceId: HOST_ID,
            command: "uptime",
            rationale: "The user asked again.",
          })
        ).success,
      ).toBe(true);
    }

    const refused: ToolCallOutcome = await tool.execute({
      resourceId: HOST_ID,
      command: "uptime",
      rationale: "Once more.",
    });

    expect(refused.success).toBe(false);
    expect(refused.textForLlm).toContain(
      `already sent ${MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER} infrastructure commands`,
    );
    expect(run).toHaveBeenCalledTimes(MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER);
  });

  test("kubectl on a cluster's page has the same cap", async () => {
    installStatusLookups({ cluster: readyCluster() });
    installViewChecks();

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage({
          resourceType: AIResourceType.KubernetesCluster,
          entityId: CLUSTER_ID,
        }),
      });

    expect(
      toolNamed(infrastructure!.extraTools, RUN_KUBECTL_TOOL_NAME)!.definition
        .description,
    ).toContain(
      `At most ${MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER} commands in this run.`,
    );
  });

  test("the incident's shared thread keeps the investigation's runaway guard: no cap of its own", async () => {
    installViewChecks();

    const tools: ChatInfrastructureTools =
      await ChatInfrastructureAccess.buildTools({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        statuses: { clusters: [readyCluster()], resources: [hostStatus()] },
        offeredIn: "the incident thread",
      });

    for (const name of [
      RUN_KUBECTL_TOOL_NAME,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    ]) {
      expect(
        toolNamed(tools.extraTools, name)!.definition.description,
      ).not.toContain("At most");
    }
  });

  test("an agent that cannot answer: the prompt says why, and what would change it", async () => {
    installStatusLookups({
      resource: hostStatus({ agent: hostAgent({ online: false }) }),
    });
    installViewChecks();

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    expect(infrastructure!.extraTools).toEqual([]);
    expect(infrastructure!.instructions).toContain(
      WITHOUT_ACCESS_SECTION_HEADING,
    );
    expect(infrastructure!.instructions).toContain(
      "Check that its container is running and can reach your OneUptime URL",
    );
  });

  test("a ready host: nothing about what would let it run commands", async () => {
    installStatusLookups({ resource: hostStatus() });
    installViewChecks();

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    expect(infrastructure!.instructions).not.toContain(
      WITHOUT_ACCESS_SECTION_HEADING,
    );
  });

  test("the issue: on test01's page, Ask AI can run uptime there through the Host AI agent", async () => {
    installStatusLookups({ resource: hostStatus() });
    installViewChecks();
    const run: SpyInstance = jest
      .spyOn(ResourceCommandJobRunner, "run")
      .mockResolvedValue(uptimeOutcome() as never);

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    expect(infrastructure).not.toBeNull();
    expect(infrastructure!.instructions).toContain(
      PAGE_INFRASTRUCTURE_SECTION_HEADING,
    );
    expect(infrastructure!.instructions).toContain("# Infrastructure access");

    const outcome: ToolCallOutcome = await toolNamed(
      infrastructure!.extraTools,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    )!.execute({
      resourceId: HOST_ID,
      command: "uptime",
      rationale: "The user asked to run uptime on this host.",
    });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(UPTIME_OUTPUT);
    expect(outcome.result?.citationLabel).toBe('`uptime` on Host "test01"');
    expect(outcome.result?.rowCount).toBe(1);

    // Through the host's own agent, as an AI run's read-only command.
    expect(run).toHaveBeenCalledTimes(1);
    const args: {
      projectId: ObjectID;
      aiRunId: ObjectID;
      origin: RunnerJobOrigin;
      resourceType: AiResourceType;
      resourceId: ObjectID;
      targetResourceAiAgentId: ObjectID;
      command: string;
    } = run.mock.calls[0]![0] as {
      projectId: ObjectID;
      aiRunId: ObjectID;
      origin: RunnerJobOrigin;
      resourceType: AiResourceType;
      resourceId: ObjectID;
      targetResourceAiAgentId: ObjectID;
      command: string;
    };
    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.aiRunId).toBe(RUN_ID);
    expect(args.origin).toBe(RunnerJobOrigin.AiInvestigation);
    expect(args.resourceType).toBe(AiResourceType.Host);
    expect(args.resourceId.toString()).toBe(HOST_ID);
    expect(args.targetResourceAiAgentId.toString()).toBe(AGENT_ID);
    expect(args.command).toBe("uptime");
  });

  test.each([
    ["systemctl restart nginx"],
    ["systemctl stop nginx"],
    ["kill 4242"],
  ])(
    "a change (%s) is refused before anything is queued, even with fixes on bypass-approval",
    async (command: string) => {
      installStatusLookups({ resource: hostStatus() });
      installViewChecks();
      const run: SpyInstance = jest
        .spyOn(ResourceCommandJobRunner, "run")
        .mockResolvedValue(uptimeOutcome() as never);

      const infrastructure: ChatPageInfrastructure | null =
        await ChatInfrastructureAccess.buildForPage({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          props: ASKER_PROPS,
          pageContext: hostPage(),
        });

      const outcome: ToolCallOutcome = await toolNamed(
        infrastructure!.extraTools,
        RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      )!.execute({
        resourceId: HOST_ID,
        command,
        rationale: "The user asked for it.",
      });

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain("was NOT run");
      expect(run).not.toHaveBeenCalled();
    },
  );

  test("a shell line is refused before anything is queued", async () => {
    installStatusLookups({ resource: hostStatus() });
    installViewChecks();
    const run: SpyInstance = jest
      .spyOn(ResourceCommandJobRunner, "run")
      .mockResolvedValue(uptimeOutcome() as never);

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    const outcome: ToolCallOutcome = await toolNamed(
      infrastructure!.extraTools,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    )!.execute({
      resourceId: HOST_ID,
      command: "uptime; cat /etc/shadow",
      rationale: "The user asked for it.",
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Nothing was run");
    expect(run).not.toHaveBeenCalled();
  });

  test("on a Kubernetes cluster's page, kubectl runs through the cluster's agent as a read", async () => {
    installStatusLookups({ cluster: readyCluster() });
    installViewChecks();
    const run: SpyInstance = jest
      .spyOn(KubectlJobRunner, "run")
      .mockResolvedValue({
        jobId: ObjectID.generate().toString(),
        succeeded: true,
        exitCode: 0,
        output:
          "NAME        READY   STATUS    RESTARTS   AGE\napi-7d9c   1/1     Running   0          3d",
        displayCommand: "kubectl get pods -A",
        executed: true,
        runState: KubectlRunState.Ran,
      } as KubectlJobOutcome as never);

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage({
          resourceType: AIResourceType.KubernetesCluster,
          entityId: CLUSTER_ID,
          entityTitle: "prod-gke",
        }),
      });

    expect(toolNames(infrastructure!.extraTools)).toEqual([
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      RUN_KUBECTL_TOOL_NAME,
      READ_TOOL_OUTPUT_TOOL_NAME,
    ]);
    expect(infrastructure!.instructions).toContain("# Cluster access");

    const outcome: ToolCallOutcome = await toolNamed(
      infrastructure!.extraTools,
      RUN_KUBECTL_TOOL_NAME,
    )!.execute({
      clusterId: CLUSTER_ID,
      command: "kubectl get pods -A",
      rationale: "Which pods are running?",
    });

    expect(outcome.success).toBe(true);
    const args: {
      aiRunId: ObjectID;
      origin: RunnerJobOrigin;
      kubernetesClusterId: ObjectID;
      targetRunnerId: ObjectID;
    } = run.mock.calls[0]![0] as {
      aiRunId: ObjectID;
      origin: RunnerJobOrigin;
      kubernetesClusterId: ObjectID;
      targetRunnerId: ObjectID;
    };
    expect(args.aiRunId).toBe(RUN_ID);
    expect(args.origin).toBe(RunnerJobOrigin.AiInvestigation);
    expect(args.kubernetesClusterId.toString()).toBe(CLUSTER_ID);
    expect(args.targetRunnerId.toString()).toBe(RUNNER_ID);
  });

  test("a host without an agent: no commands, and the prompt carries why and what to install", async () => {
    installStatusLookups({ resource: hostStatus({ agent: null }) });
    installViewChecks();

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    expect(infrastructure!.extraTools).toEqual([]);
    expect(infrastructure!.instructions).toContain("NO direct access");
    expect(infrastructure!.instructions).toContain(
      "No Host AI agent is connected",
    );
    expect(infrastructure!.instructions).toContain(
      "ONEUPTIME_AI_AGENT_RESOURCE_TYPE=host and HOST_NAME=test01",
    );
    expect(infrastructure!.instructions).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
  });

  test("a host the person may not view: no commands, and only that it is out of view", async () => {
    installStatusLookups({ resource: hostStatus() });
    installViewChecks({ viewableResourceIds: [] });

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      });

    expect(infrastructure!.extraTools).toEqual([]);
    expect(infrastructure!.instructions).toBe(
      INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
    );
  });

  test("an incident page offers its linked host, for the person asking", async () => {
    installStatusLookups({ subjectResources: [hostStatus()] });
    installViewChecks();

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT_ID,
        },
      });

    expect(toolNames(infrastructure!.extraTools)).toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
  });

  test("a page about no infrastructure adds nothing", async () => {
    const lookups: StatusLookups = installStatusLookups({
      resource: hostStatus(),
    });

    expect(
      await ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: { type: AIChatPageContextType.LogsExplorer },
      }),
    ).toBeNull();
    expectNoLookups(lookups);
  });

  test("a lookup that fails never fails the turn: it answers from OneUptime's data", async () => {
    const lookups: StatusLookups = installStatusLookups();
    lookups.resourceStatus.mockRejectedValue(new Error("db down") as never);

    await expect(
      ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      }),
    ).resolves.toBeNull();
  });

  test("a view check that fails offers nothing, rather than everything", async () => {
    installStatusLookups({ resource: hostStatus() });
    installViewChecks();
    (
      ResourceAiAccessService.getStatusesViewableBy as unknown as SpyInstance
    ).mockRejectedValue(new Error("permission read failed") as never);

    await expect(
      ChatInfrastructureAccess.buildForPage({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        props: ASKER_PROPS,
        pageContext: hostPage(),
      }),
    ).resolves.toBeNull();
  });
});
