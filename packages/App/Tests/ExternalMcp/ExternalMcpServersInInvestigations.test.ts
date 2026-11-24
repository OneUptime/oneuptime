import ChatAgentRunner, {
  ChatTurnRequest,
} from "Common/Server/Utils/AI/Chat/ChatAgentRunner";
import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
  ObservabilityAssistantResult,
  ObservabilityAssistantToolOutcome,
} from "Common/Server/Utils/AI/Chat/ObservabilityAssistant";
import ToolOutputPager from "Common/Server/Utils/AI/Chat/ToolOutputPager";
import McpInvestigationTools from "Common/Server/Utils/AI/Mcp/McpInvestigationTools";
import McpRunToolkit from "Common/Server/Utils/AI/Mcp/McpRunToolkit";
import InvestigationThread from "Common/Server/Utils/AI/SRE/InvestigationThread";
import InvestigationThreadService from "Common/Server/Utils/AI/SRE/InvestigationThreadService";
import IncidentAlertRuleMatcher from "Common/Server/Utils/Rules/IncidentAlertRuleMatcher";
import { ToolCallOutcome } from "Common/Server/Utils/AI/Toolbox/Index";
import AIConversationMessageService from "Common/Server/Services/AIConversationMessageService";
import AIRunService from "Common/Server/Services/AIRunService";
import AutoRemediationRuleService from "Common/Server/Services/AutoRemediationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import LlmProviderService from "Common/Server/Services/LlmProviderService";
import { AILogRequest } from "Common/Server/Services/AIService";
import { LLMMessage } from "Common/Server/Utils/LLM/LLMService";
import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Incident from "Common/Models/DatabaseModels/Incident";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "Common/Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import AIChatPageContextType from "Common/Types/AI/AIChatPageContext";
import { AIChatToolAction, AIChatToolActionStatus } from "Common/Types/AI/AIChatTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import LocalMcpServerProcess, { McpFixtureCall } from "./LocalMcpServerProcess";
import {
  PROJECT_ID,
  SERVER_TOKEN,
  TurnHarness,
  finalAnswer,
  installTurnHarness,
  personProps,
  storedServer,
  systemPromptOf,
  toolCallsAnswer,
  toolNamesOffered,
  toolResultFor,
} from "./McpTurnHarness";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ISSUE #10879, THROUGH AN INCIDENT'S INVESTIGATION: asked in an
 * incident's investigation box to use the project's MCP servers, OneUptime
 * AI said it could not see them. The box's conversation is a chat turn of
 * its own (InvestigationThreadService), and like Ask AI's it was never
 * handed the servers' tools - only the clusters and hosts the incident is
 * linked to.
 *
 * The autonomous investigation did get them, but only when an AI rule
 * matched: an investigation someone started by hand, on an incident no AI
 * rule matches, got none - and it only ever uses the tools the server
 * marks read-only, which kAgent's tool server marks none of.
 *
 * Here both run against a real MCP server, its own process, built with the
 * official MCP SDK, with a model that is a script.
 */

const SERVER_NAME: string = "Kubernetes";
const INCIDENT_ID: ObjectID = new ObjectID(
  "10879000-0000-4000-8000-0000000000d1",
);
const THREAD_ID: ObjectID = new ObjectID(
  "10879000-0000-4000-8000-0000000000d2",
);
const RUN_ID: ObjectID = new ObjectID("10879000-0000-4000-8000-0000000000d3");

let mcpServer: LocalMcpServerProcess;
let harness: TurnHarness;

beforeAll(async () => {
  mcpServer = await LocalMcpServerProcess.start({ token: SERVER_TOKEN });
});

afterAll(async () => {
  await mcpServer.stop();
});

beforeEach(() => {
  mcpServer.calls.splice(0);
  harness = installTurnHarness();
  harness.setServers([
    storedServer({
      name: SERVER_NAME,
      description: "The production cluster's kAgent tools.",
      url: mcpServer.url,
    }),
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function callNames(): Array<string> {
  return mcpServer.calls.map((call: McpFixtureCall): string => {
    return call.name;
  });
}

describe("an incident's investigation box (its shared conversation)", () => {
  // The turns the box started, so a test waits for them to end.
  let turns: Array<Promise<void>>;

  beforeEach(() => {
    turns = [];

    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(new LlmProvider() as never);
    jest.spyOn(InvestigationThread, "getSubjectDetails").mockResolvedValue({
      label: "Incident #42",
      title: "Checkout pods restarting",
      summary: "# Incident #42",
      pageContext: {
        type: AIChatPageContextType.Incident,
        entityId: INCIDENT_ID.toString(),
      },
    } as never);

    const thread: AIConversation = new AIConversation(THREAD_ID);
    thread.projectId = PROJECT_ID;
    thread.incidentId = INCIDENT_ID;
    jest
      .spyOn(InvestigationThread, "findOrCreateThread")
      .mockResolvedValue(thread as never);

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null as never);
    jest.spyOn(AIRunService, "create").mockImplementation((async (args: {
      data: AIRun;
    }) => {
      args.data.id = RUN_ID;
      return args.data;
    }) as never);
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([new AIRun(RUN_ID)] as never);
    jest
      .spyOn(AIConversationMessageService, "create")
      .mockImplementation((async (args: { data: AIConversationMessage }) => {
        args.data.id = ObjectID.generate();
        return args.data;
      }) as never);

    // What the box tells the model about the incident and its report.
    jest.spyOn(InvestigationThread, "buildTurnContext").mockResolvedValue({
      additionalSystemInstructions: "# This conversation\nIncident #42.",
      extraTools: [],
      pageContext: {
        type: AIChatPageContextType.Incident,
        entityId: INCIDENT_ID.toString(),
      },
      title: "Incident #42: Checkout pods restarting",
    } as never);

    const realRunTurn: typeof ChatAgentRunner.runTurn =
      ChatAgentRunner.runTurn.bind(ChatAgentRunner);

    jest
      .spyOn(ChatAgentRunner, "runTurn")
      .mockImplementation((request: ChatTurnRequest): Promise<void> => {
        const turn: Promise<void> = realRunTurn(request);
        turns.push(turn);
        return turn;
      });
  });

  async function ask(
    content: string,
    permissions: Array<Permission> = [Permission.ProjectMember],
  ): Promise<void> {
    await InvestigationThreadService.sendMessage({
      projectId: PROJECT_ID,
      subject: { type: "incident", id: INCIDENT_ID },
      userId: new ObjectID("10879000-0000-4000-8000-0000000000b1"),
      props: personProps(permissions),
      content,
    });

    while (turns.length === 0) {
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
    }

    await Promise.all(turns);
  }

  test("asked to use a tool of the project's MCP server, it does: the read reaches the server and the answer cites it", async () => {
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
            tool: "get_pod_status",
            arguments: { namespace: "shop", pod: "checkout-7f9" },
          },
        },
      ]),
      finalAnswer("checkout-7f9 was OOMKilled [C2]."),
    ]);

    await ask(
      "Use the Kubernetes MCP server's get_pod_status on shop/checkout-7f9.",
    );

    const first: AILogRequest = harness.llmRequests()[0]!;
    expect(toolNamesOffered(first)).toEqual(
      expect.arrayContaining([
        LIST_MCP_TOOLS_TOOL_NAME,
        CALL_MCP_TOOL_TOOL_NAME,
      ]),
    );
    expect(systemPromptOf(first)).toContain("# This conversation");
    expect(systemPromptOf(first)).toContain("# External MCP servers");
    expect(systemPromptOf(first)).toContain(`- ${SERVER_NAME}:`);

    expect(mcpServer.calls).toEqual([
      {
        name: "get_pod_status",
        arguments: { namespace: "shop", pod: "checkout-7f9" },
      },
    ]);

    const requests: Array<AILogRequest> = harness.llmRequests();
    expect(toolResultFor(requests[requests.length - 1]!, "read-1")).toContain(
      "OOMKilled",
    );
    expect(harness.finalized()?.["contentInMarkdown"]).toContain("[C2]");
  });

  test("a change asks first, though the box acts at once on anything else (Auto-run)", async () => {
    harness.script([
      toolCallsAnswer([
        {
          id: "change-1",
          name: CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
          arguments: {
            server: SERVER_NAME,
            tool: "restart_deployment",
            arguments: { namespace: "shop", deployment: "checkout" },
          },
        },
      ]),
    ]);

    await ask("Restart the checkout deployment.", [Permission.ProjectAdmin]);

    expect(harness.pausedState()).toBeDefined();

    const pending: AIChatToolAction | undefined = harness
      .lastToolActions()
      .find((action: AIChatToolAction): boolean => {
        return action.status === AIChatToolActionStatus.Pending;
      });
    expect(pending?.title).toBe(
      "Call restart_deployment on MCP server Kubernetes",
    );
    expect(callNames()).toEqual([]);
  });
});

describe("the autonomous investigation of an incident", () => {
  let rules: Array<AutoRemediationRule>;
  let matchingRuleNames: Array<string>;
  const toolkits: Array<McpRunToolkit> = [];

  beforeEach(() => {
    rules = [];
    matchingRuleNames = [];

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(new Incident(INCIDENT_ID) as never);
    jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockImplementation((async () => {
        return rules;
      }) as never);
    jest
      .spyOn(IncidentAlertRuleMatcher, "doesIncidentMatch")
      .mockImplementation((async (
        _incident: unknown,
        rule: AutoRemediationRule,
      ) => {
        return matchingRuleNames.includes(rule.name || "");
      }) as never);
  });

  afterEach(async () => {
    for (const kit of toolkits.splice(0)) {
      await kit.close();
    }
  });

  function rule(name: string): AutoRemediationRule {
    const item: AutoRemediationRule = new AutoRemediationRule();
    item.name = name;
    item.externalMcpServers = [];
    return item;
  }

  async function investigationToolkit(): Promise<McpRunToolkit | null> {
    const kit: McpRunToolkit | null = await McpInvestigationTools.forIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      aiRunId: RUN_ID,
      outputPager: new ToolOutputPager(),
    });

    if (kit) {
      toolkits.push(kit);
    }

    return kit;
  }

  // The investigation's agent loop, with a scripted model and its MCP tools.
  async function investigate(
    kit: McpRunToolkit,
    replies: Array<ObservabilityAssistantModelReply>,
  ): Promise<{
    outcomes: Array<ObservabilityAssistantToolOutcome>;
    calls: Array<ObservabilityAssistantModelCall>;
    result: ObservabilityAssistantResult;
  }> {
    const outcomes: Array<ObservabilityAssistantToolOutcome> = [];
    const calls: Array<ObservabilityAssistantModelCall> = [];
    const extraTools: Array<ObservabilityAssistantExtraTool> =
      kit.buildTools();

    const result: ObservabilityAssistantResult =
      await ObservabilityAssistant.answerQuestion({
        projectId: PROJECT_ID,
        props: { isRoot: true },
        incidentId: INCIDENT_ID,
        feature: "AI Incident Investigation",
        question: "Why are the checkout pods restarting?",
        systemInstructions: kit.buildPersonaAddendum(),
        aiContext: null,
        extraTools,
        onToolOutcome: (outcome: ObservabilityAssistantToolOutcome): void => {
          outcomes.push(outcome);
        },
        transport: {
          callModel: async (
            call: ObservabilityAssistantModelCall,
          ): Promise<ObservabilityAssistantModelReply> => {
            calls.push(call);
            return (
              replies.shift() || {
                content: "The pods were OOMKilled [C2].",
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

    return { outcomes, calls, result };
  }

  function toolCallReply(
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

  test("it lists the server's tools and reads with the one marked read-only", async () => {
    const kit: McpRunToolkit | null = await investigationToolkit();
    expect(kit).not.toBeNull();

    const { outcomes, calls } = await investigate(kit!, [
      toolCallReply("list-1", LIST_MCP_TOOLS_TOOL_NAME, { server: SERVER_NAME }),
      toolCallReply("read-1", CALL_MCP_TOOL_TOOL_NAME, {
        server: SERVER_NAME,
        tool: "get_pod_status",
        arguments: { namespace: "shop", pod: "checkout-7f9" },
      }),
    ]);

    expect(
      calls[0]!.tools!.map((tool: { name: string }): string => {
        return tool.name;
      }),
    ).toEqual(
      expect.arrayContaining([LIST_MCP_TOOLS_TOOL_NAME, CALL_MCP_TOOL_TOOL_NAME]),
    );
    // An investigation is never handed the tool that asks a person.
    expect(
      calls[0]!.tools!.map((tool: { name: string }): string => {
        return tool.name;
      }),
    ).not.toContain(CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME);

    expect(callNames()).toEqual(["get_pod_status"]);
    expect(outcomes[1]!.success).toBe(true);
    expect(outcomes[1]!.textForLlm).toContain("OOMKilled");

    const systemMessage: LLMMessage = calls[0]!.messages[0]!;
    expect(systemMessage.content).toContain("# External MCP servers");
  });

  test("it never calls a tool the server does not mark read-only - kAgent marks none - and its list says why", async () => {
    const kit: McpRunToolkit | null = await investigationToolkit();

    const { outcomes } = await investigate(kit!, [
      toolCallReply("list-1", LIST_MCP_TOOLS_TOOL_NAME, { server: SERVER_NAME }),
      toolCallReply("read-1", CALL_MCP_TOOL_TOOL_NAME, {
        server: SERVER_NAME,
        tool: "k8s_get_resources",
        arguments: { resource_type: "pods" },
      }),
    ]);

    expect(outcomes[0]!.textForLlm).toContain(
      "A tool counts as one that only reads when its server marks it read-only (readOnlyHint)",
    );
    expect(outcomes[1]!.success).toBe(false);
    expect(outcomes[1]!.textForLlm).toContain(
      "k8s_get_resources on Kubernetes may change something",
    );
    expect(callNames()).toEqual([]);
  });

  test("started by hand on an incident no AI rule matches, it still has the project's servers", async () => {
    rules = [rule("Critical incidents only")];
    matchingRuleNames = [];

    const kit: McpRunToolkit | null = await investigationToolkit();

    expect(kit).not.toBeNull();
    expect(kit!.getServerLabels()).toEqual([SERVER_NAME]);
  });

  test("Enable AI turned off during an investigation: nothing more is sent to the server", async () => {
    const kit: McpRunToolkit | null = await investigationToolkit();
    harness.setAiEnabled(false);

    const { outcomes } = await investigate(kit!, [
      toolCallReply("read-1", CALL_MCP_TOOL_TOOL_NAME, {
        server: SERVER_NAME,
        tool: "get_pod_status",
        arguments: { namespace: "shop", pod: "checkout-7f9" },
      }),
    ]);

    expect(outcomes[0]!.success).toBe(false);
    expect(outcomes[0]!.textForLlm).toContain("Enable AI");
    expect(callNames()).toEqual([]);
    expect(harness.connectionsOpened()).toEqual([]);
  });
});
