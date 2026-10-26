import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import { PAGE_INFRASTRUCTURE_SECTION_HEADING } from "../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import { READ_TOOL_OUTPUT_TOOL_NAME } from "../../../../Server/Utils/AI/Chat/ToolOutputPager";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import ResourceAiAccessService, {
  ResourceAiAccessRow,
} from "../../../../Server/Services/ResourceAiAccessService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import ResourceCommandJobRunner, {
  ResourceCommandRunState,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { RUN_KUBECTL_TOOL_NAME } from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import { LLMToolDefinition } from "../../../../Server/Utils/LLM/LLMService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatCitation,
  AIChatToolActionStatus,
  AIRunPausedState,
} from "../../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import { KubernetesClusterAiAccessStatus } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5259, through the whole chat turn: on host test01's page, with its
 * Host AI agent connected, the user sends "Call 'uptime' command on remote
 * host". Ask AI used to be offered no command tool at all and answered "I
 * don't have a tool that can execute commands on remote hosts". Now the
 * turn reaches the infrastructure its subject is about - the page it was
 * asked from, else the one the conversation kept - runs `uptime` through
 * the host's agent as a read, and answers with what came back, cited.
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

const QUESTION: string = "Call 'uptime' command on remote host";
const UPTIME_OUTPUT: string =
  " 15:42:01 up 12 days,  3:04,  1 user,  load average: 0.08, 0.03, 0.01";

const HOST_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Resource,
  resourceType: AIResourceType.Host,
  entityId: HOST_ID,
  entityTitle: "test01",
};

function response(data: {
  content?: string;
  stopReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JSONObject }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.stopReason,
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

// A personal Ask AI turn, as the AI chat API starts it.
function buildRequest(overrides?: Partial<ChatTurnRequest>): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
    pageContext: HOST_PAGE,
    offersPageInfrastructure: true,
    ...overrides,
  };
}

function hostRow(): ResourceAiAccessRow {
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
  };
}

// The issue's agent, connected and able to reach the host - or offline.
function hostStatus(data?: { online?: boolean }): ResourceAiAccessStatus {
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
    reachable: true,
  };

  return ResourceAiAccessService.buildStatus({
    resource: hostRow(),
    agentRow: agent,
    gates: { isAiEnabled: true, hasLlmProvider: true, aiBalanceBlocker: null },
  });
}

interface Spies {
  executeWithLogging: SpyInstance;
  messageUpdateOneBy: SpyInstance;
  runUpdateOneBy: SpyInstance;
  runFindOneById: SpyInstance;
  conversationFindOneById: SpyInstance;
  resourceStatus: SpyInstance;
  clusterStatus: SpyInstance;
  commandRun: SpyInstance;
  toolboxExecute: SpyInstance;
}

function installSpies(data?: {
  // The subject the conversation kept from an earlier turn.
  keptPageContext?: AIChatPageContext | undefined;
  resource?: ResourceAiAccessStatus | null | undefined;
  cluster?: KubernetesClusterAiAccessStatus | null | undefined;
  run?: AIRun | undefined;
}): Spies {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);

  const run: AIRun = data?.run ?? new AIRun();
  if (!data?.run) {
    run.status = AIRunStatus.Running;
  }

  const runFindOneById: SpyInstance = jest
    .spyOn(AIRunService, "findOneById")
    .mockResolvedValue(run as never);
  const runUpdateOneBy: SpyInstance = jest
    .spyOn(AIRunService, "updateOneBy")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(AIConversationMessageService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AIConversationMessageService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(AIConversationMessageService, "findOneBy")
    .mockResolvedValue(null as never);
  const messageUpdateOneBy: SpyInstance = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);

  const conversation: AIConversation = new AIConversation();
  if (data?.keptPageContext) {
    conversation.pageContext = data.keptPageContext;
  }
  const conversationFindOneById: SpyInstance = jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(conversation as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  const resourceStatus: SpyInstance = jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(
      (data && Object.prototype.hasOwnProperty.call(data, "resource")
        ? data.resource
        : hostStatus()) as never,
    );
  const clusterStatus: SpyInstance = jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockResolvedValue((data?.cluster ?? null) as never);

  // The person asking may view everything here.
  jest
    .spyOn(ResourceAiAccessService, "getStatusesViewableBy")
    .mockImplementation((async (args: {
      statuses: Array<ResourceAiAccessStatus>;
    }): Promise<Array<ResourceAiAccessStatus>> => {
      return args.statuses;
    }) as never);
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusesViewableBy")
    .mockImplementation((async (args: {
      statuses: Array<KubernetesClusterAiAccessStatus>;
    }): Promise<Array<KubernetesClusterAiAccessStatus>> => {
      return args.statuses;
    }) as never);

  const commandRun: SpyInstance = jest
    .spyOn(ResourceCommandJobRunner, "run")
    .mockResolvedValue({
      jobId: ObjectID.generate().toString(),
      succeeded: true,
      exitCode: 0,
      output: UPTIME_OUTPUT,
      displayCommand: "uptime",
      executed: true,
      runState: ResourceCommandRunState.Ran,
    } as never);

  const toolboxExecute: SpyInstance = jest
    .spyOn(AIToolbox, "executeTool")
    .mockResolvedValue({
      success: true,
      textForLlm: "Note posted.",
      result: {
        dataForLlm: "Note posted.",
        rowCount: 1,
        citationLabel: "Internal note",
        redactionCount: 0,
        isTruncated: false,
      },
    } as never);

  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Done." }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    runFindOneById,
    conversationFindOneById,
    resourceStatus,
    clusterStatus,
    commandRun,
    toolboxExecute,
  };
}

function llmRequest(spies: Spies, index: number): AILogRequest {
  return spies.executeWithLogging.mock.calls[index]![0] as AILogRequest;
}

function toolsOffered(request: AILogRequest): Array<string> {
  return (request.tools || []).map((tool: LLMToolDefinition): string => {
    return tool.name;
  });
}

function systemPrompt(request: AILogRequest): string {
  return request.messages[0]!.content;
}

function finalizedMessage(spies: Spies): JSONObject | undefined {
  for (const call of spies.messageUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };
    if (arg.data && arg.data["status"] === AIChatMessageStatus.Completed) {
      return arg.data;
    }
  }
  return undefined;
}

function askToRunUptime(spies: Spies): void {
  spies.executeWithLogging
    .mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [
          {
            id: "call-uptime",
            name: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
            arguments: {
              resourceId: HOST_ID,
              command: "uptime",
              rationale: "The user asked to run uptime on this host.",
            },
          },
        ],
      }) as never,
    )
    .mockResolvedValueOnce(
      response({
        content:
          "test01 has been up for 12 days, with a load average of 0.08 [C1].",
      }) as never,
    );
}

describe("Ask AI on a host's page runs commands through the Host AI agent (issue #5259)", () => {
  test("the issue, end to end: uptime runs on test01 through its agent, and the answer cites what came back", async () => {
    const spies: Spies = installSpies();
    askToRunUptime(spies);
    const request: ChatTurnRequest = buildRequest();

    await ChatAgentRunner.runTurn(request);

    // The model is offered the host's command tools, and told what they reach.
    const first: AILogRequest = llmRequest(spies, 0);
    expect(toolsOffered(first)).toEqual(
      expect.arrayContaining([
        LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
        READ_TOOL_OUTPUT_TOOL_NAME,
      ]),
    );
    expect(systemPrompt(first)).toContain(PAGE_INFRASTRUCTURE_SECTION_HEADING);
    expect(systemPrompt(first)).toContain(
      `Host "test01" (resourceId: ${HOST_ID}): READ access via ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} through its Host AI agent`,
    );

    // `uptime` ran through the host's own agent, as this turn's read.
    expect(spies.commandRun).toHaveBeenCalledTimes(1);
    const runArgs: {
      projectId: ObjectID;
      aiRunId: ObjectID;
      origin: RunnerJobOrigin;
      resourceType: AiResourceType;
      resourceId: ObjectID;
      targetResourceAiAgentId: ObjectID;
      command: string;
    } = spies.commandRun.mock.calls[0]![0] as {
      projectId: ObjectID;
      aiRunId: ObjectID;
      origin: RunnerJobOrigin;
      resourceType: AiResourceType;
      resourceId: ObjectID;
      targetResourceAiAgentId: ObjectID;
      command: string;
    };
    expect(runArgs.projectId).toBe(PROJECT_ID);
    expect(runArgs.aiRunId).toBe(request.aiRunId);
    expect(runArgs.origin).toBe(RunnerJobOrigin.AiInvestigation);
    expect(runArgs.resourceType).toBe(AiResourceType.Host);
    expect(runArgs.resourceId.toString()).toBe(HOST_ID);
    expect(runArgs.targetResourceAiAgentId.toString()).toBe(AGENT_ID);
    expect(runArgs.command).toBe("uptime");

    // The model read the output, framed as a cited tool result.
    const toolResult: string = JSON.stringify(llmRequest(spies, 1).messages);
    expect(toolResult).toContain("load average: 0.08, 0.03, 0.01");
    expect(toolResult).toContain('citation=\\"C1\\"');

    // The answer is published with its citation, minted from the command.
    const finalized: JSONObject | undefined = finalizedMessage(spies);
    expect(finalized).toBeDefined();
    expect(finalized!["contentInMarkdown"]).toContain("[C1]");
    const citations: Array<AIChatCitation> = finalized![
      "citations"
    ] as unknown as Array<AIChatCitation>;
    expect(citations).toHaveLength(1);
    expect(citations[0]!.toolName).toBe(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
    expect(citations[0]!.label).toBe('`uptime` on Host "test01"');
  });

  test("a read-only conversation is still offered the commands: they only read", async () => {
    const spies: Spies = installSpies();
    askToRunUptime(spies);

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.ReadOnly }),
    );

    expect(toolsOffered(llmRequest(spies, 0))).toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(spies.commandRun).toHaveBeenCalledTimes(1);
    expect(finalizedMessage(spies)).toBeDefined();
  });

  test("the command never waits for an approval: it is not an action on the message", async () => {
    const spies: Spies = installSpies();
    askToRunUptime(spies);

    await ChatAgentRunner.runTurn(buildRequest());

    const finalized: JSONObject | undefined = finalizedMessage(spies);
    expect(finalized!["toolActions"]).toEqual([]);
    const paused: boolean = spies.runUpdateOneBy.mock.calls.some(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { data: JSONObject }).data["status"] ===
          AIRunStatus.WaitingForApproval
        );
      },
    );
    expect(paused).toBe(false);
  });

  test("a later question asked from a page without context still reaches the host the conversation kept", async () => {
    const spies: Spies = installSpies({ keptPageContext: HOST_PAGE });

    await ChatAgentRunner.runTurn(buildRequest({ pageContext: undefined }));

    expect(spies.resourceStatus).toHaveBeenCalledTimes(1);
    expect(
      (
        spies.resourceStatus.mock.calls[0]![0] as { resourceId: ObjectID }
      ).resourceId.toString(),
    ).toBe(HOST_ID);
    expect(toolsOffered(llmRequest(spies, 0))).toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
  });

  test("a conversation detached from its page reaches nothing", async () => {
    const spies: Spies = installSpies({ keptPageContext: HOST_PAGE });

    await ChatAgentRunner.runTurn(buildRequest({ pageContext: null }));

    expect(spies.resourceStatus).not.toHaveBeenCalled();
    expect(toolsOffered(llmRequest(spies, 0))).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(systemPrompt(llmRequest(spies, 0))).not.toContain(
      PAGE_INFRASTRUCTURE_SECTION_HEADING,
    );
  });

  test("a page about no infrastructure looks nothing up", async () => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(
      buildRequest({
        pageContext: { type: AIChatPageContextType.LogsExplorer },
      }),
    );

    expect(spies.resourceStatus).not.toHaveBeenCalled();
    expect(spies.clusterStatus).not.toHaveBeenCalled();
    expect(toolsOffered(llmRequest(spies, 0))).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
  });

  test("a turn not started by the AI chat API (an incident's shared thread brings its own tools) looks nothing up", async () => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(
      buildRequest({ offersPageInfrastructure: undefined }),
    );

    expect(spies.resourceStatus).not.toHaveBeenCalled();
    expect(toolsOffered(llmRequest(spies, 0))).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
  });

  test("the host's agent offline: no command tool, and the prompt says why instead of 'no tool'", async () => {
    const spies: Spies = installSpies({
      resource: hostStatus({ online: false }),
    });

    await ChatAgentRunner.runTurn(buildRequest());

    const first: AILogRequest = llmRequest(spies, 0);
    expect(toolsOffered(first)).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(systemPrompt(first)).toContain(PAGE_INFRASTRUCTURE_SECTION_HEADING);
    expect(systemPrompt(first)).toContain("NO direct access");
    expect(systemPrompt(first)).toContain("The Host AI agent is offline");
  });

  test("a lookup that fails still answers, from OneUptime's own data", async () => {
    const spies: Spies = installSpies();
    spies.resourceStatus.mockRejectedValue(new Error("db down") as never);

    await ChatAgentRunner.runTurn(buildRequest());

    expect(toolsOffered(llmRequest(spies, 0))).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(finalizedMessage(spies)?.["contentInMarkdown"]).toBe("Done.");
  });

  test("on a Kubernetes cluster's page, Ask AI gets read-only kubectl on that cluster", async () => {
    const spies: Spies = installSpies({
      cluster: {
        clusterId: CLUSTER_ID,
        clusterName: "prod-gke",
        clusterIdentifier: "prod-gke",
        isInvestigationReady: true,
        isRemediationReady: false,
        runner: {
          id: ObjectID.generate().toString(),
          name: "kubernetes-ai-agent",
          kind: "ai_agent",
          isOnline: true,
          canRunAiCommands: true,
        },
        accessMethod: "in_cluster",
        gaps: [],
      } as unknown as KubernetesClusterAiAccessStatus,
    });

    await ChatAgentRunner.runTurn(
      buildRequest({
        pageContext: {
          type: AIChatPageContextType.Resource,
          resourceType: AIResourceType.KubernetesCluster,
          entityId: CLUSTER_ID,
          entityTitle: "prod-gke",
        },
      }),
    );

    expect(spies.resourceStatus).not.toHaveBeenCalled();
    expect(toolsOffered(llmRequest(spies, 0))).toContain(RUN_KUBECTL_TOOL_NAME);
    expect(systemPrompt(llmRequest(spies, 0))).toContain(
      `Cluster "prod-gke" (clusterId: ${CLUSTER_ID}): kubectl READ access`,
    );
  });
});

/*
 * The toolbox's definitions are one list per permission mode, shared by
 * every run of the process. The runner used to push a turn's command tools
 * onto that list itself, so after the first turn that had any, every later
 * turn - of any conversation, in any project - was offered them, described
 * with the first turn's resources (names and ids), while a later turn's own
 * tools of the same name were dropped as duplicates.
 */
describe("a turn's command tools stay in that turn", () => {
  function describedTool(request: AILogRequest, name: string): string {
    return (
      (request.tools || []).find((tool: LLMToolDefinition): boolean => {
        return tool.name === name;
      })?.description || ""
    );
  }

  test("the next turn, on a page about nothing, is offered none of them", async () => {
    const spies: Spies = installSpies();
    const toolboxCount: number = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.AskForApproval,
    ).length;

    await ChatAgentRunner.runTurn(buildRequest());
    expect(toolsOffered(llmRequest(spies, 0))).toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({
        pageContext: { type: AIChatPageContextType.LogsExplorer },
      }),
    );

    expect(toolsOffered(llmRequest(spies, 1))).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(toolsOffered(llmRequest(spies, 1))).not.toContain(
      READ_TOOL_OUTPUT_TOOL_NAME,
    );
    // The shared list itself is as the toolbox built it.
    expect(
      AIToolbox.getLlmToolDefinitions(AIChatPermissionMode.AskForApproval),
    ).toHaveLength(toolboxCount);
  });

  test("the next turn about another host is told about that host, never the first one", async () => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(buildRequest());

    const otherHost: ResourceAiAccessStatus = {
      ...hostStatus(),
      resourceId: "99999999-9999-4999-8999-999999999999",
      resourceName: "payments-db-host",
    };
    spies.resourceStatus.mockResolvedValue(otherHost as never);

    await ChatAgentRunner.runTurn(
      buildRequest({
        pageContext: {
          ...HOST_PAGE,
          entityId: otherHost.resourceId,
          entityTitle: "payments-db-host",
        },
      }),
    );

    const description: string = describedTool(
      llmRequest(spies, 1),
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );

    expect(description).toContain('Host "payments-db-host"');
    expect(description).not.toContain('Host "test01"');
    expect(description).not.toContain(HOST_ID);
    // Offered once, not once per turn that ever had it.
    expect(
      toolsOffered(llmRequest(spies, 1)).filter((name: string): boolean => {
        return name === RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME;
      }),
    ).toHaveLength(1);
  });
});

describe("a paused Ask AI turn gets its command tools back when it resumes", () => {
  function pausedRun(): AIRun {
    const pendingCall: JSONObject = {
      id: "call-note",
      name: "create_incident_note",
      arguments: {
        incidentId: ObjectID.generate().toString(),
        note: "Checked test01.",
      },
    };

    const pausedState: AIRunPausedState = {
      messages: [
        {
          role: "system",
          content: "You are OneUptime's observability copilot.",
        },
        { role: "user", content: QUESTION },
        { role: "assistant", content: "", toolCalls: [pendingCall] },
      ],
      pendingToolCalls: [pendingCall],
      llmCallCount: 1,
      toolCallCount: 0,
      totalTokens: 10,
      totalCostInUSDCents: 1,
      eventSequence: 3,
      citations: [],
      widgets: [],
      toolActions: [
        {
          id: "call-note",
          toolName: "create_incident_note",
          title: "Post an internal note",
          arguments: pendingCall["arguments"] as JSONObject,
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Pending,
        },
      ],
      egressToolEntries: [],
      startedAtMs: Date.now(),
    };

    const run: AIRun = new AIRun();
    run.status = AIRunStatus.WaitingForApproval;
    run.pausedState = pausedState;
    return run;
  }

  test("after the approved action runs, the model can run commands on the host the conversation kept", async () => {
    const spies: Spies = installSpies({
      keptPageContext: HOST_PAGE,
      run: pausedRun(),
    });
    askToRunUptime(spies);

    // The AI chat API resumes with no page context: the kept subject decides.
    await ChatAgentRunner.resumeTurn(buildRequest({ pageContext: undefined }), [
      { toolCallId: "call-note", approved: true },
    ]);

    // The approved action ran first.
    expect(spies.toolboxExecute).toHaveBeenCalledTimes(1);
    expect(
      (spies.toolboxExecute.mock.calls[0]![0] as { name: string }).name,
    ).toBe("create_incident_note");

    // Then the loop went on with the host's command tools, built afresh.
    expect(spies.resourceStatus).toHaveBeenCalledTimes(1);
    expect(toolsOffered(llmRequest(spies, 0))).toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(spies.commandRun).toHaveBeenCalledTimes(1);
    expect(finalizedMessage(spies)?.["contentInMarkdown"]).toContain("[C");
  });

  test("a resume the API did not mark builds no command tools", async () => {
    const spies: Spies = installSpies({
      keptPageContext: HOST_PAGE,
      run: pausedRun(),
    });

    await ChatAgentRunner.resumeTurn(
      buildRequest({
        pageContext: undefined,
        offersPageInfrastructure: undefined,
      }),
      [{ toolCallId: "call-note", approved: true }],
    );

    expect(spies.resourceStatus).not.toHaveBeenCalled();
    expect(toolsOffered(llmRequest(spies, 0))).not.toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
  });
});
