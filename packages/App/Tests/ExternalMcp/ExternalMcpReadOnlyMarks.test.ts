import ChatAgentRunner from "Common/Server/Utils/AI/Chat/ChatAgentRunner";
import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantModelReply,
  ObservabilityAssistantToolOutcome,
} from "Common/Server/Utils/AI/Chat/ObservabilityAssistant";
import ExternalMcpServerCheck from "Common/Server/Utils/AI/Mcp/ExternalMcpServerCheck";
import McpRunToolkit, {
  McpRunToolMark,
} from "Common/Server/Utils/AI/Mcp/McpRunToolkit";
import ToolOutputPager from "Common/Server/Utils/AI/Chat/ToolOutputPager";
import { ToolCallOutcome } from "Common/Server/Utils/AI/Toolbox/Index";
import ExternalMcpServerService from "Common/Server/Services/ExternalMcpServerService";
import ExternalMcpToolReadOnlyMarkService from "Common/Server/Services/ExternalMcpToolReadOnlyMarkService";
import AIService, { AILogRequest } from "Common/Server/Services/AIService";
import SlackAPI from "Common/Server/API/SlackAPI";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import { OnCreate } from "Common/Server/Types/Database/Hooks";
import ProjectReferenceCheck from "Common/Server/Utils/Database/ProjectReferenceCheck";
import MicrosoftTeamsAuthAction from "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceActionAuthorization from "Common/Server/Utils/Workspace/WorkspaceActionAuthorization";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpToolReadOnlyMark from "Common/Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import AIChatPermissionMode from "Common/Types/AI/AIChatPermissionMode";
import { ExternalMcpServerConnectionCheck } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import { ExternalMcpServerTool } from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerTool";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import {
  ExternalMcpToolReadOnlyStatus,
  getExternalMcpToolReadOnlyStatus,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpToolReadOnlyMark";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { LocalMcpHttpTransport } from "Common/Tests/Helpers/FakeMcpServer";
import {
  KAgentToolsVersion,
  getKAgentToolsRecordingPath,
} from "Common/Tests/Helpers/KAgentToolRecordings";
import LocalMcpServerProcess, {
  RECORDED_FIXTURE_PATH,
} from "./LocalMcpServerProcess";
import {
  PROJECT_ID,
  SERVER_TOKEN,
  TurnHarness,
  askAiTurn,
  finalAnswer,
  installTurnHarness,
  personProps,
  storedServer,
  toolCallsAnswer,
  toolNamesOffered,
  toolResultFor,
} from "./McpTurnHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ISSUES #11081 AND #11082, END TO END, AGAINST KAGENT'S TOOL SERVER AS IT
 * ANSWERS: a real MCP server in a process of its own (Fixtures/
 * RecordedMcpServer.js) serves kAgent's recorded tool lists
 * (Common/Tests/Fixtures/KAgentTools) exactly, and OneUptime reads them
 * as it reads kAgent.
 *
 * #11081: kAgent 0.3 says nothing about any of its tools, so an
 * investigation could use none of them, not even k8s_get_resources. A
 * Project Admin marks it - through the mark's real create hook, from what
 * Test connection stored - and the investigation then lists it and calls
 * it, and Ask AI runs it at once. A server that changes the tool drops the
 * mark: the run sends nothing and records what it read. kAgent 0.2
 * (mcp-go) marks every tool destructive, and none can be marked.
 *
 * #11082: an answer in Slack or Microsoft Teams, through their own answer
 * paths, reads with the marked tool for the person who asked, never with
 * one that may change something, and someone who may not read the
 * project's External MCP Servers gets no MCP tool.
 */

const SERVER_NAME: string = "Kubernetes";

let servers: Array<LocalMcpServerProcess> = [];
let harness: TurnHarness;

beforeEach(() => {
  servers = [];
  harness = installTurnHarness();
});

afterEach(async () => {
  for (const server of servers) {
    await server.stop();
  }

  jest.restoreAllMocks();
});

async function startKAgent(data: {
  version: KAgentToolsVersion;
  isReadOnly?: boolean | undefined;
  overrides?: JSONObject | undefined;
}): Promise<LocalMcpServerProcess> {
  const server: LocalMcpServerProcess = await LocalMcpServerProcess.start({
    token: SERVER_TOKEN,
    fixture: RECORDED_FIXTURE_PATH,
    env: {
      MCP_FIXTURE_RECORDING: getKAgentToolsRecordingPath(data),
      MCP_FIXTURE_OVERRIDES: JSON.stringify(data.overrides || {}),
    },
  });

  servers.push(server);
  return server;
}

// The server as its project stored it, its tools as Test connection read them.
async function connect(
  process: LocalMcpServerProcess,
): Promise<ExternalMcpServer> {
  const server: ExternalMcpServer = storedServer({
    name: SERVER_NAME,
    description: "The production cluster's kAgent tools.",
    url: process.url,
  });

  const check: ExternalMcpServerConnectionCheck =
    await ExternalMcpServerCheck.run({
      server,
      transport: new LocalMcpHttpTransport(),
    });

  expect(check.isConnected).toBe(true);
  server.tools = check.tools as unknown as JSONArray;
  harness.setServers([server]);

  return server;
}

type CreateHook = {
  onBeforeCreate: (
    createBy: CreateBy<ExternalMcpToolReadOnlyMark>,
  ) => Promise<OnCreate<ExternalMcpToolReadOnlyMark>>;
};

// A Project Admin's mark, made through the mark's own create hook.
async function markReadOnly(
  server: ExternalMcpServer,
  toolName: string,
): Promise<McpRunToolMark> {
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ExternalMcpServerService, "findOneBy")
    .mockResolvedValue(server as never);

  const mark: ExternalMcpToolReadOnlyMark = new ExternalMcpToolReadOnlyMark();
  mark.externalMcpServerId = server.id!;
  mark.toolName = toolName;

  const onCreate: OnCreate<ExternalMcpToolReadOnlyMark> = await (
    ExternalMcpToolReadOnlyMarkService as unknown as CreateHook
  ).onBeforeCreate({
    data: mark,
    props: personProps([Permission.ProjectAdmin]),
  } as CreateBy<ExternalMcpToolReadOnlyMark>);

  return {
    toolName: onCreate.createBy.data.toolName,
    toolFingerprint: onCreate.createBy.data.toolFingerprint,
  };
}

function storedTool(
  server: ExternalMcpServer,
  name: string,
): ExternalMcpServerTool {
  return (server.tools as unknown as Array<ExternalMcpServerTool>).find(
    (tool: ExternalMcpServerTool): boolean => {
      return tool.name === name;
    },
  )!;
}

// An investigation's agent loop, with a scripted model and its MCP tools.
async function investigate(
  replies: Array<ObservabilityAssistantModelReply>,
): Promise<Array<ObservabilityAssistantToolOutcome>> {
  const kit: McpRunToolkit = new McpRunToolkit({
    projectId: PROJECT_ID,
    servers: [
      ...(await ExternalMcpServerService.findServersForRun({
        projectId: PROJECT_ID,
        allowance: { isEveryServer: true, serverIds: [] },
      })),
    ],
    purpose: "investigation",
    outputPager: new ToolOutputPager(),
  });
  const outcomes: Array<ObservabilityAssistantToolOutcome> = [];
  const extraTools: Array<ObservabilityAssistantExtraTool> = kit.buildTools();

  try {
    await ObservabilityAssistant.answerQuestion({
      projectId: PROJECT_ID,
      props: { isRoot: true },
      feature: "AI Incident Investigation",
      question: "Why are the checkout pods restarting?",
      systemInstructions: kit.buildPersonaAddendum(),
      aiContext: null,
      extraTools,
      onToolOutcome: (outcome: ObservabilityAssistantToolOutcome): void => {
        outcomes.push(outcome);
      },
      transport: {
        callModel: async (): Promise<ObservabilityAssistantModelReply> => {
          return (
            replies.shift() || {
              content: "The pods are crash-looping [C2].",
              tokenCount: 10,
            }
          );
        },
        executeTool: async (): Promise<ToolCallOutcome> => {
          return {
            success: false,
            textForLlm: "Not used in this test.",
            errorMessage: "Not used in this test.",
          };
        },
      },
    });
  } finally {
    await kit.close();
  }

  return outcomes;
}

function reply(
  id: string,
  name: string,
  args: JSONObject,
): ObservabilityAssistantModelReply {
  return {
    content: "",
    toolCalls: [{ id, name, arguments: args }],
    stopReason: "tool_use",
    tokenCount: 10,
  };
}

const LIST: ObservabilityAssistantModelReply = reply(
  "list-1",
  LIST_MCP_TOOLS_TOOL_NAME,
  { server: SERVER_NAME },
);

const GET_RESOURCES: ObservabilityAssistantModelReply = reply(
  "read-1",
  CALL_MCP_TOOL_TOOL_NAME,
  {
    server: SERVER_NAME,
    tool: "k8s_get_resources",
    arguments: { resource_type: "pods", namespace: "shop" },
  },
);

describe("kAgent 0.3, which marks none of its tools (#11081)", () => {
  test("Test connection reads its 126 tools, and k8s_get_resources is one a Project Admin may mark", async () => {
    const kagent: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
    });
    const server: ExternalMcpServer = await connect(kagent);

    const tools: Array<ExternalMcpServerTool> =
      server.tools as unknown as Array<ExternalMcpServerTool>;
    expect(tools).toHaveLength(126);
    expect(
      tools.filter((tool: ExternalMcpServerTool): boolean => {
        return tool.readsOnly;
      }),
    ).toEqual([]);
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: storedTool(server, "k8s_get_resources"),
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.NotMarked);
    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: storedTool(server, "k8s_delete_resource"),
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.CannotBeMarked);
    expect(kagent.calls).toEqual([]);
  });

  test("before it is marked, an investigation can use none of kAgent's tools, and sends it nothing", async () => {
    const kagent: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
    });
    await connect(kagent);

    const outcomes: Array<ObservabilityAssistantToolOutcome> =
      await investigate([LIST, GET_RESOURCES]);

    expect(outcomes[0]!.textForLlm).toContain(
      "It offers no tool marked read-only, so none can be used while investigating.",
    );
    expect(outcomes[1]!.success).toBe(false);
    expect(kagent.calls).toEqual([]);
  });

  test("once a Project Admin marks k8s_get_resources, the investigation lists it and calls it, and kAgent receives the call", async () => {
    const kagent: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
    });
    const server: ExternalMcpServer = await connect(kagent);
    harness.setMarks([await markReadOnly(server, "k8s_get_resources")]);

    const outcomes: Array<ObservabilityAssistantToolOutcome> =
      await investigate([LIST, GET_RESOURCES]);

    expect(outcomes[0]!.textForLlm).toContain("k8s_get_resources [reads only]");
    // Only the marked tool: the rest still may change something.
    expect(outcomes[0]!.textForLlm).toContain(
      "(125 more tools may change something, and cannot be used while investigating.)",
    );
    expect(outcomes[1]!.success).toBe(true);
    expect(outcomes[1]!.textForLlm).toContain("CrashLoopBackOff");
    expect(kagent.calls).toEqual([
      {
        name: "k8s_get_resources",
        arguments: { resource_type: "pods", namespace: "shop" },
      },
    ]);
  });

  test("a changed tool definition drops its mark: kAgent upgraded with a new description, nothing is sent, and the run records the change", async () => {
    const before: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
    });
    const server: ExternalMcpServer = await connect(before);
    harness.setMarks([await markReadOnly(server, "k8s_get_resources")]);
    await before.stop();
    servers = [];

    // The same server, upgraded: k8s_get_resources now says it deletes too.
    const after: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
      overrides: {
        k8s_get_resources: {
          description:
            "List or delete Kubernetes resources with kubectl. Set delete=true to delete what it lists.",
        },
      },
    });
    server.url = after.url;

    const outcomes: Array<ObservabilityAssistantToolOutcome> =
      await investigate([LIST, GET_RESOURCES]);

    expect(outcomes[0]!.textForLlm).not.toContain(
      "k8s_get_resources [reads only]",
    );
    expect(outcomes[0]!.textForLlm).toContain(
      "changed by its server since, so not read-only until someone marks it again: k8s_get_resources",
    );
    expect(outcomes[1]!.success).toBe(false);
    expect(after.calls).toEqual([]);

    // Recorded as a connection test records it: the page shows the lapse.
    const recorded: Array<JSONObject> = harness.recordedFailures();
    expect(recorded).toHaveLength(1);
    const check: ExternalMcpServerConnectionCheck = recorded[0]![
      "check"
    ] as unknown as ExternalMcpServerConnectionCheck;
    expect(check.isConnected).toBe(true);
    const kept: ExternalMcpServerTool = check.tools.find(
      (tool: ExternalMcpServerTool): boolean => {
        return tool.name === "k8s_get_resources";
      },
    )!;
    expect(kept.fingerprint).not.toBe(
      storedTool(server, "k8s_get_resources").fingerprint,
    );
  });

  test("kAgent's own k8s_generate_resource writes its description anew each start: a mark on it lapses when kAgent restarts", async () => {
    const before: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
    });
    const server: ExternalMcpServer = await connect(before);
    harness.setMarks([await markReadOnly(server, "k8s_generate_resource")]);
    await before.stop();
    servers = [];

    // Recorded from another start of the same kAgent: its types in another order.
    const restarted: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
      isReadOnly: true,
    });
    server.url = restarted.url;

    const outcomes: Array<ObservabilityAssistantToolOutcome> =
      await investigate([
        LIST,
        reply("read-1", CALL_MCP_TOOL_TOOL_NAME, {
          server: SERVER_NAME,
          tool: "k8s_generate_resource",
          arguments: { resource_type: "argo_rollout" },
        }),
      ]);

    expect(outcomes[1]!.success).toBe(false);
    expect(outcomes[1]!.textForLlm).toContain(
      "was marked read-only by a Project Admin, but its server has changed it since",
    );
    expect(restarted.calls).toEqual([]);
  });

  test("in Ask AI, the marked tool runs at once in Ask to act - no card - and kAgent receives the call", async () => {
    const kagent: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
    });
    const server: ExternalMcpServer = await connect(kagent);
    harness.setMarks([await markReadOnly(server, "k8s_get_resources")]);

    harness.script([
      toolCallsAnswer([
        {
          id: "read-1",
          name: CALL_MCP_TOOL_TOOL_NAME,
          arguments: {
            server: SERVER_NAME,
            tool: "k8s_get_resources",
            arguments: { resource_type: "pods" },
          },
        },
      ]),
      finalAnswer("checkout-7f9 is crash-looping [C1]."),
    ]);

    await ChatAgentRunner.runTurn(
      askAiTurn({ permissionMode: AIChatPermissionMode.AskForApproval }),
    );

    expect(harness.pausedState()).toBeUndefined();
    expect(
      kagent.calls.map((call: { name: string }) => {
        return call.name;
      }),
    ).toEqual(["k8s_get_resources"]);
    const requests: Array<AILogRequest> = harness.llmRequests();
    expect(toolResultFor(requests[requests.length - 1]!, "read-1")).toContain(
      "CrashLoopBackOff",
    );
  });
});

describe("kAgent 0.2, built on mcp-go, which marks every tool destructive (#11081)", () => {
  test("its tools are taken at their word: k8s_get_resources cannot be marked, and an investigation still uses none", async () => {
    const kagent: LocalMcpServerProcess = await startKAgent({
      version: "0.2.1",
    });
    const server: ExternalMcpServer = await connect(kagent);

    expect(
      getExternalMcpToolReadOnlyStatus({
        tool: storedTool(server, "k8s_get_resources"),
      }),
    ).toBe(ExternalMcpToolReadOnlyStatus.ServerMarksChange);
    await expect(markReadOnly(server, "k8s_get_resources")).rejects.toThrow(
      BadDataException,
    );

    const outcomes: Array<ObservabilityAssistantToolOutcome> =
      await investigate([LIST, GET_RESOURCES]);

    expect(outcomes[1]!.success).toBe(false);
    expect(kagent.calls).toEqual([]);
  });
});

describe("OneUptime AI in Slack and Microsoft Teams (#11082)", () => {
  async function kagentWithMarkedRead(): Promise<LocalMcpServerProcess> {
    const kagent: LocalMcpServerProcess = await startKAgent({
      version: "0.3.2",
    });
    const server: ExternalMcpServer = await connect(kagent);
    harness.setMarks([await markReadOnly(server, "k8s_get_resources")]);
    return kagent;
  }

  function asks(props: DatabaseCommonInteractionProps): void {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(props as never);
  }

  function chatAnswerScript(): void {
    harness.script([
      toolCallsAnswer([
        {
          id: "list-1",
          name: LIST_MCP_TOOLS_TOOL_NAME,
          arguments: { server: SERVER_NAME },
        },
      ]),
      toolCallsAnswer([
        {
          id: "read-1",
          name: CALL_MCP_TOOL_TOOL_NAME,
          arguments: {
            server: SERVER_NAME,
            tool: "k8s_get_resources",
            arguments: { resource_type: "pods", namespace: "shop" },
          },
        },
      ]),
      toolCallsAnswer([
        {
          id: "change-1",
          name: CALL_MCP_TOOL_TOOL_NAME,
          arguments: {
            server: SERVER_NAME,
            tool: "k8s_delete_resource",
            arguments: { resource_type: "pod", resource_name: "checkout-7f9" },
          },
        },
      ]),
      toolCallsAnswer([
        {
          id: "change-2",
          name: CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
          arguments: {
            server: SERVER_NAME,
            tool: "k8s_delete_resource",
            arguments: { resource_type: "pod", resource_name: "checkout-7f9" },
          },
        },
      ]),
      finalAnswer("checkout-7f9 is in CrashLoopBackOff, 7 restarts [C2]."),
    ]);
  }

  function expectReadOnlyAnswer(kagent: LocalMcpServerProcess): void {
    const requests: Array<AILogRequest> = harness.llmRequests();
    const first: AILogRequest = requests[0]!;

    expect(toolNamesOffered(first)).toEqual(
      expect.arrayContaining([
        LIST_MCP_TOOLS_TOOL_NAME,
        CALL_MCP_TOOL_TOOL_NAME,
      ]),
    );
    // A chat app shows no card: the tool that asks is never offered.
    expect(toolNamesOffered(first)).not.toContain(
      CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
    );

    const last: AILogRequest = requests[requests.length - 1]!;
    // The list holds only the tools that read: here, the marked one.
    expect(toolResultFor(last, "list-1")).toContain(
      "k8s_get_resources [reads only]",
    );
    expect(toolResultFor(last, "list-1")).not.toContain("k8s_delete_resource");
    expect(toolResultFor(last, "read-1")).toContain("CrashLoopBackOff");
    expect(toolResultFor(last, "change-1")).toContain("Nothing was sent.");

    // Only the read reached kAgent.
    expect(kagent.calls).toEqual([
      {
        name: "k8s_get_resources",
        arguments: { resource_type: "pods", namespace: "shop" },
      },
    ]);
  }

  test("Slack: the answer reads with the marked tool for the person who asked, and never with one that may change something", async () => {
    const kagent: LocalMcpServerProcess = await kagentWithMarkedRead();
    asks(personProps([Permission.ProjectMember]));
    chatAnswerScript();

    const answer: string = await (
      SlackAPI as unknown as {
        getAiOpsAnswerMarkdown: (data: {
          projectId: ObjectID;
          userId: ObjectID;
          question: string;
        }) => Promise<string>;
      }
    ).getAiOpsAnswerMarkdown({
      projectId: PROJECT_ID,
      userId: new ObjectID("10879000-0000-4000-8000-0000000000b1"),
      question: "Use the Kubernetes server to list the pods in shop.",
    });

    expectReadOnlyAnswer(kagent);
    expect(answer).toContain("CrashLoopBackOff");
    expect(harness.llmRequests()[0]!.feature).toBe("Slack ChatOps");
  });

  test("Microsoft Teams: the same, through the Teams bot", async () => {
    const kagent: LocalMcpServerProcess = await kagentWithMarkedRead();
    asks(personProps([Permission.ProjectMember]));
    chatAnswerScript();

    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(new ObjectID("10879000-0000-4000-8000-0000000000b1"));
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null as never);
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
    jest
      .spyOn(
        MicrosoftTeamsUtil as unknown as {
          getConversationHistoryTurns: () => Promise<Array<JSONObject>>;
        },
        "getConversationHistoryTurns",
      )
      .mockResolvedValue([]);

    const sent: Array<string> = [];

    await (
      MicrosoftTeamsUtil as unknown as {
        answerObservabilityQuestion: (data: {
          activity: JSONObject;
          turnContext: unknown;
          projectId: ObjectID;
          question: string;
        }) => Promise<void>;
      }
    ).answerObservabilityQuestion({
      activity: { from: { aadObjectId: "aad-user-11082" } },
      turnContext: {
        sendActivity: async (activity: unknown): Promise<void> => {
          sent.push(
            typeof activity === "string"
              ? activity
              : String((activity as { text?: unknown }).text),
          );
        },
      },
      projectId: PROJECT_ID,
      question: "Use the Kubernetes server to list the pods in shop.",
    });

    expectReadOnlyAnswer(kagent);
    expect(sent[sent.length - 1]).toContain("CrashLoopBackOff");
    expect(harness.llmRequests()[0]!.feature).toBe("Microsoft Teams ChatOps");
  });

  test("a chat user without access gets no MCP tools, and kAgent hears nothing", async () => {
    const kagent: LocalMcpServerProcess = await kagentWithMarkedRead();
    // Test connection's own, while the server was set up.
    const openedBefore: number = harness.connectionsOpened().length;
    // Their linked account reads incidents, not the project's External MCP Servers.
    asks(personProps([Permission.ReadProjectIncident]));
    harness.script([
      toolCallsAnswer([
        {
          id: "read-1",
          name: CALL_MCP_TOOL_TOOL_NAME,
          arguments: {
            server: SERVER_NAME,
            tool: "k8s_get_resources",
            arguments: { resource_type: "pods" },
          },
        },
      ]),
      finalAnswer("I may not use the project's MCP servers for you."),
    ]);

    await (
      SlackAPI as unknown as {
        getAiOpsAnswerMarkdown: (data: {
          projectId: ObjectID;
          userId: ObjectID;
          question: string;
        }) => Promise<string>;
      }
    ).getAiOpsAnswerMarkdown({
      projectId: PROJECT_ID,
      userId: new ObjectID("10879000-0000-4000-8000-0000000000b1"),
      question: "Use the Kubernetes server to list the pods in shop.",
    });

    const first: AILogRequest = harness.llmRequests()[0]!;
    expect(toolNamesOffered(first)).not.toContain(LIST_MCP_TOOLS_TOOL_NAME);
    expect(toolNamesOffered(first)).not.toContain(CALL_MCP_TOOL_TOOL_NAME);
    expect(first.messages[0]!.content).toContain(
      "the person asking may not use them",
    );
    expect(kagent.calls).toEqual([]);
    // The answer opened no connection at all.
    expect(harness.connectionsOpened()).toHaveLength(openedBefore);
  });

  test("Enable AI off: a Slack answer sends kAgent nothing", async () => {
    const kagent: LocalMcpServerProcess = await kagentWithMarkedRead();
    asks(personProps([Permission.ProjectMember]));
    harness.setAiEnabled(false);
    harness.script([
      toolCallsAnswer([
        {
          id: "read-1",
          name: CALL_MCP_TOOL_TOOL_NAME,
          arguments: {
            server: SERVER_NAME,
            tool: "k8s_get_resources",
            arguments: { resource_type: "pods" },
          },
        },
      ]),
      finalAnswer("Enable AI is off."),
    ]);

    await (
      SlackAPI as unknown as {
        getAiOpsAnswerMarkdown: (data: {
          projectId: ObjectID;
          userId: ObjectID;
          question: string;
        }) => Promise<string>;
      }
    ).getAiOpsAnswerMarkdown({
      projectId: PROJECT_ID,
      userId: new ObjectID("10879000-0000-4000-8000-0000000000b1"),
      question: "List the pods.",
    });

    const requests: Array<AILogRequest> = harness.llmRequests();
    expect(toolResultFor(requests[requests.length - 1]!, "read-1")).toContain(
      "Enable AI",
    );
    expect(kagent.calls).toEqual([]);
  });
});
