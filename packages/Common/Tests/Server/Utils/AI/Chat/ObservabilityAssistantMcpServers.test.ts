import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
  ObservabilityAssistantResult,
  ObservabilityAssistantToolOutcome,
} from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import ChatMcpAccess, {
  ChatMcpServers,
  EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION,
} from "../../../../../Server/Utils/AI/Chat/ChatMcpAccess";
import { ObservabilityChatApp } from "../../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import ExternalMcpServerService from "../../../../../Server/Services/ExternalMcpServerService";
import ExternalMcpToolReadOnlyMarkService from "../../../../../Server/Services/ExternalMcpToolReadOnlyMarkService";
import ExternalMcpServerCheck from "../../../../../Server/Utils/AI/Mcp/ExternalMcpServerCheck";
import ExternalMcpServerConnection from "../../../../../Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import { clearMcpSignInCachesForTests } from "../../../../../Server/Utils/AI/Mcp/McpSignIn";
import { readMcpToolDescription } from "../../../../../Server/Utils/AI/Mcp/McpClient";
import { getMcpToolFingerprint } from "../../../../../Server/Utils/AI/Mcp/McpToolFingerprint";
import AiCommandKillSwitch from "../../../../../Server/Utils/AI/AiCommandKillSwitch";
import { ToolCallOutcome } from "../../../../../Server/Utils/AI/Toolbox/Index";
import logger from "../../../../../Server/Utils/Logger";
import ExternalMcpServer from "../../../../../Models/DatabaseModels/ExternalMcpServer";
import ExternalMcpToolReadOnlyMark from "../../../../../Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import AIAgentRunLimitsHelper from "../../../../../Types/AI/AIAgentRunLimits";
import ExternalMcpServerAuthType from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import FakeMcpServer, {
  FakeMcpTool,
  LocalMcpHttpTransport,
} from "../../../../Helpers/FakeMcpServer";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * ISSUE #11082: ONEUPTIME AI'S ANSWERS IN SLACK AND MICROSOFT TEAMS READ
 * WITH THE PROJECT'S EXTERNAL MCP SERVERS. Asked there to use a server's
 * tool, they said they had none: ObservabilityAssistant.answerQuestion with a
 * chatApp never offered one. Now Slack and Teams ask for them
 * (offersExternalMcpServers), and the answer gets the servers' tools that
 * read, for the person who asked - and closes their sessions however it
 * ends.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11082000-0000-4000-8000-000000000001",
);

const SLACK: ObservabilityChatApp = {
  name: "Slack",
  incidentCommand: "/oneuptime incident",
  pageCommand: "/oneuptime page",
  askAiUrl: "https://oneuptime.example.com/dashboard/ai",
};

function personProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission): JSONObject => {
          return {
            permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function toolCall(
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

function answer(content: string): ObservabilityAssistantModelReply {
  return { content, stopReason: "end_turn", tokenCount: 10 };
}

interface Asked {
  result: ObservabilityAssistantResult;
  calls: Array<ObservabilityAssistantModelCall>;
  outcomes: Array<ObservabilityAssistantToolOutcome>;
}

async function ask(data: {
  replies: Array<ObservabilityAssistantModelReply>;
  chatApp?: ObservabilityChatApp | undefined;
  offersExternalMcpServers?: boolean | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
  extraTools?: Array<ObservabilityAssistantExtraTool> | undefined;
  systemInstructions?: string | undefined;
  failModel?: boolean | undefined;
}): Promise<Asked> {
  const calls: Array<ObservabilityAssistantModelCall> = [];
  const outcomes: Array<ObservabilityAssistantToolOutcome> = [];
  const replies: Array<ObservabilityAssistantModelReply> = [...data.replies];

  const result: ObservabilityAssistantResult =
    await ObservabilityAssistant.answerQuestion({
      projectId: PROJECT_ID,
      props: data.props || personProps([Permission.ProjectMember]),
      question: "Why is checkout down?",
      feature: "Slack ChatOps",
      chatApp: data.chatApp,
      offersExternalMcpServers: data.offersExternalMcpServers,
      extraTools: data.extraTools,
      systemInstructions: data.systemInstructions,
      aiContext: null,
      runLimits: AIAgentRunLimitsHelper.getDefault(),
      onToolOutcome: (outcome: ObservabilityAssistantToolOutcome): void => {
        outcomes.push(outcome);
      },
      transport: {
        callModel: async (
          call: ObservabilityAssistantModelCall,
        ): Promise<ObservabilityAssistantModelReply> => {
          calls.push(call);

          if (data.failModel) {
            throw new Error("The model provider is down.");
          }

          return replies.shift() || answer("Done.");
        },
        executeTool: async (): Promise<ToolCallOutcome> => {
          return {
            success: false,
            textForLlm: "Not a tool of this test.",
            errorMessage: "Not a tool of this test.",
          };
        },
      },
    });

  return { result, calls, outcomes };
}

function toolNames(call: ObservabilityAssistantModelCall): Array<string> {
  return (call.tools || []).map((tool: { name: string }): string => {
    return tool.name;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which answers are offered the servers", () => {
  let build: SpyInstance<typeof ChatMcpAccess.buildForChatAppAnswer>;
  let close: Mock<() => Promise<void>>;
  let execute: Mock<(args: JSONObject) => Promise<ToolCallOutcome>>;

  beforeEach(() => {
    close = jest.fn(async (): Promise<void> => {});
    execute = jest.fn(async (): Promise<ToolCallOutcome> => {
      return {
        success: true,
        textForLlm: "get_pod_status [reads only]",
        result: {
          dataForLlm: "get_pod_status [reads only]",
          rowCount: 1,
          citationLabel: "MCP servers' tools",
          redactionCount: 0,
          isTruncated: false,
        },
      } as unknown as ToolCallOutcome;
    });

    build = jest
      .spyOn(ChatMcpAccess, "buildForChatAppAnswer")
      .mockImplementation(async (): Promise<ChatMcpServers> => {
        return {
          extraTools: [
            {
              definition: {
                name: LIST_MCP_TOOLS_TOOL_NAME,
                description: "List the servers' tools that read.",
                inputSchema: { type: "object", properties: {} },
              },
              execute,
            },
          ],
          instructions:
            "# External MCP servers\nYou are answering in Slack, where OneUptime AI only reads.",
          close,
        };
      });
  });

  test("an answer posted to Slack that asks for them: the person's own props and the chat app are what the servers are built for", async () => {
    const props: DatabaseCommonInteractionProps = personProps([
      Permission.ProjectMember,
    ]);

    await ask({
      replies: [answer("No servers needed.")],
      chatApp: SLACK,
      offersExternalMcpServers: true,
      props,
    });

    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]![0].props).toBe(props);
    expect(build.mock.calls[0]![0].chatApp).toBe(SLACK);
    expect(build.mock.calls[0]![0].projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("the model is offered the servers' tools and told about them, after what the caller wrote", async () => {
    const { calls } = await ask({
      replies: [
        toolCall("list-1", LIST_MCP_TOOLS_TOOL_NAME, {}),
        answer("get_pod_status reads [C1]."),
      ],
      chatApp: SLACK,
      offersExternalMcpServers: true,
      systemInstructions: "# The caller's own section",
    });

    expect(toolNames(calls[0]!)).toContain(LIST_MCP_TOOLS_TOOL_NAME);
    expect(toolNames(calls[0]!)).not.toContain(
      CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
    );
    const system: string = calls[0]!.messages[0]!.content;
    expect(system).toContain("# The caller's own section");
    expect(system).toContain("# External MCP servers");
    expect(system.indexOf("# The caller's own section")).toBeLessThan(
      system.indexOf("# External MCP servers"),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("their sessions are closed once the answer is written", async () => {
    await ask({
      replies: [answer("Done.")],
      chatApp: SLACK,
      offersExternalMcpServers: true,
    });

    expect(close).toHaveBeenCalledTimes(1);
  });

  test("their sessions are closed when the answer fails too", async () => {
    await expect(
      ask({
        replies: [],
        chatApp: SLACK,
        offersExternalMcpServers: true,
        failModel: true,
      }),
    ).rejects.toThrow("The model provider is down.");

    expect(close).toHaveBeenCalledTimes(1);
  });

  test("a chat app's answer that does not ask for them gets none", async () => {
    const { calls } = await ask({ replies: [answer("Done.")], chatApp: SLACK });

    expect(build).not.toHaveBeenCalled();
    expect(toolNames(calls[0]!)).not.toContain(LIST_MCP_TOOLS_TOOL_NAME);
  });

  test("an autonomous run brings its own servers: the flag means nothing without a chat app", async () => {
    await ask({
      replies: [answer("Done.")],
      offersExternalMcpServers: true,
    });

    expect(build).not.toHaveBeenCalled();
  });

  test("a project with no server: the answer goes on as it did", async () => {
    build.mockResolvedValue(null);

    const { result, calls } = await ask({
      replies: [answer("From OneUptime's data.")],
      chatApp: SLACK,
      offersExternalMcpServers: true,
    });

    expect(result.contentInMarkdown).toBe("From OneUptime's data.");
    expect(calls[0]!.messages[0]!.content).not.toContain(
      "# External MCP servers",
    );
  });

  test("someone who may not use them is told so, with no tool offered", async () => {
    build.mockResolvedValue({
      extraTools: [],
      instructions: EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION,
      close: async (): Promise<void> => {},
    });

    const { calls } = await ask({
      replies: [answer("You may not use them.")],
      chatApp: SLACK,
      offersExternalMcpServers: true,
      props: personProps([]),
    });

    expect(toolNames(calls[0]!)).not.toContain(LIST_MCP_TOOLS_TOOL_NAME);
    expect(calls[0]!.messages[0]!.content).toContain(
      EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION,
    );
  });
});

describe("an answer in Slack, through the servers' real toolkit and a server of its own", () => {
  const TOOLS: Array<FakeMcpTool> = [
    {
      name: "get_pod_status",
      description: "Reads a pod.",
      readOnly: true,
      inputSchema: { type: "object", properties: { pod: { type: "string" } } },
      handler: (args: JSONObject): JSONObject => {
        return {
          content: [
            { type: "text", text: `pod ${String(args["pod"])}: OOMKilled` },
          ],
        };
      },
    },
    {
      name: "k8s_get_resources",
      description: "List Kubernetes resources with kubectl.",
      inputSchema: {
        type: "object",
        properties: { resource_type: { type: "string" } },
      },
      handler: (): JSONObject => {
        return {
          content: [{ type: "text", text: "checkout-7f9 CrashLoopBackOff" }],
        };
      },
    },
    {
      name: "restart_deployment",
      description: "Restarts a deployment.",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: { deployment: { type: "string" } },
      },
      handler: (): JSONObject => {
        return { content: [{ type: "text", text: "restarted" }] };
      },
    },
  ];

  let fake: FakeMcpServer;
  let marks: Array<ExternalMcpToolReadOnlyMark>;

  beforeEach(async () => {
    clearMcpSignInCachesForTests();
    fake = await FakeMcpServer.start({ tools: TOOLS });
    marks = [];

    const server: ExternalMcpServer = new ExternalMcpServer();
    server.id = ObjectID.generate();
    server.projectId = PROJECT_ID;
    server.name = "Kubernetes";
    server.description = "The production cluster.";
    server.url = fake.url("/mcp");
    server.authType = ExternalMcpServerAuthType.None;
    server.isEnabled = true;

    jest
      .spyOn(ExternalMcpServerService, "findServersForRun")
      .mockResolvedValue([server]);
    jest.spyOn(ExternalMcpServerService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(ExternalMcpToolReadOnlyMarkService, "findMarksOfServer")
      .mockImplementation(
        async (): Promise<Array<ExternalMcpToolReadOnlyMark>> => {
          return marks;
        },
      );
    jest
      .spyOn(ExternalMcpServerCheck, "recordConnection")
      .mockResolvedValue(undefined);
    jest.spyOn(AiCommandKillSwitch, "isAiOff").mockResolvedValue(false);
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const realFromServer: typeof ExternalMcpServerConnection.fromServer =
      ExternalMcpServerConnection.fromServer.bind(ExternalMcpServerConnection);
    jest
      .spyOn(ExternalMcpServerConnection, "fromServer")
      .mockImplementation((target: ExternalMcpServer) => {
        return realFromServer(target, {
          transport: new LocalMcpHttpTransport(),
        });
      });
  });

  afterEach(async () => {
    await fake.stop();
  });

  function markK8sGetResources(): void {
    const mark: ExternalMcpToolReadOnlyMark = new ExternalMcpToolReadOnlyMark();
    mark.toolName = "k8s_get_resources";
    mark.toolFingerprint = getMcpToolFingerprint(
      readMcpToolDescription({
        name: "k8s_get_resources",
        description: "List Kubernetes resources with kubectl.",
        inputSchema: {
          type: "object",
          properties: { resource_type: { type: "string" } },
        },
      })!,
    );
    marks = [mark];
  }

  test("it lists only the tools that read, reads with them, refuses the rest, and the server sees only the reads", async () => {
    markK8sGetResources();

    const { result, calls, outcomes } = await ask({
      replies: [
        toolCall("list-1", LIST_MCP_TOOLS_TOOL_NAME, {}),
        toolCall("read-1", CALL_MCP_TOOL_TOOL_NAME, {
          server: "Kubernetes",
          tool: "get_pod_status",
          arguments: { pod: "checkout-7f9" },
        }),
        toolCall("read-2", CALL_MCP_TOOL_TOOL_NAME, {
          server: "Kubernetes",
          tool: "k8s_get_resources",
          arguments: { resource_type: "pods" },
        }),
        toolCall("change-1", CALL_MCP_TOOL_TOOL_NAME, {
          server: "Kubernetes",
          tool: "restart_deployment",
          arguments: { deployment: "checkout" },
        }),
        toolCall("change-2", CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME, {
          server: "Kubernetes",
          tool: "restart_deployment",
          arguments: { deployment: "checkout" },
        }),
        answer("checkout-7f9 was OOMKilled [C2]."),
      ],
      chatApp: SLACK,
      offersExternalMcpServers: true,
    });

    expect(toolNames(calls[0]!)).toEqual(
      expect.arrayContaining([
        LIST_MCP_TOOLS_TOOL_NAME,
        CALL_MCP_TOOL_TOOL_NAME,
      ]),
    );
    expect(toolNames(calls[0]!)).not.toContain(
      CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
    );

    expect(outcomes[0]!.textForLlm).toContain("get_pod_status [reads only]");
    expect(outcomes[0]!.textForLlm).toContain("k8s_get_resources [reads only]");
    expect(outcomes[0]!.textForLlm).not.toContain("restart_deployment");
    expect(outcomes[1]!.success).toBe(true);
    expect(outcomes[2]!.success).toBe(true);
    expect(outcomes[3]!.success).toBe(false);
    expect(outcomes[3]!.textForLlm).toContain(
      "an answer in Slack only reads. Nothing was sent.",
    );
    // Never offered, so never run: the loop knows no such tool.
    expect(outcomes[4]!.success).toBe(false);

    expect(
      fake.calls.map((entry: { name: string }) => {
        return entry.name;
      }),
    ).toEqual(["get_pod_status", "k8s_get_resources"]);
    expect(result.contentInMarkdown).toContain("OOMKilled");
  });

  test("a chat user without access gets no MCP tools, and nothing reaches the server", async () => {
    const { calls, outcomes } = await ask({
      replies: [
        toolCall("list-1", LIST_MCP_TOOLS_TOOL_NAME, {}),
        answer("I may not use the project's MCP servers."),
      ],
      chatApp: SLACK,
      offersExternalMcpServers: true,
      props: personProps([Permission.ReadProjectIncident]),
    });

    expect(toolNames(calls[0]!)).not.toContain(LIST_MCP_TOOLS_TOOL_NAME);
    expect(toolNames(calls[0]!)).not.toContain(CALL_MCP_TOOL_TOOL_NAME);
    expect(calls[0]!.messages[0]!.content).toContain(
      EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION,
    );
    expect(outcomes[0]!.success).toBe(false);
    expect(fake.methods()).toEqual([]);
  });
});
