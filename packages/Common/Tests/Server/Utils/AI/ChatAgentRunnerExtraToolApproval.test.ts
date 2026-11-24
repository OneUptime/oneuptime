import ChatAgentRunner, {
  ChatExtraTool,
  ChatExtraToolPreparation,
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatMcpAccess, {
  ChatMcpServers,
} from "../../../../Server/Utils/AI/Chat/ChatMcpAccess";
import ChatInfrastructureAccess from "../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import ToolOutputPager, {
  READ_TOOL_OUTPUT_TOOL_NAME,
} from "../../../../Server/Utils/AI/Chat/ToolOutputPager";
import { ExtraToolCall } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIRunLimitsReader from "../../../../Server/Utils/AI/AIRunLimitsReader";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import { LLMToolDefinition } from "../../../../Server/Utils/LLM/LLMService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIAgentRunLimitsHelper from "../../../../Types/AI/AIAgentRunLimits";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIRunPausedState,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import {
  AI_ACTION_LINES,
  AI_ACTION_TITLES,
} from "../../../../Types/AI/AIActionWords";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT A CHAT TURN DOES WITH AN EXTRA TOOL THAT CHANGES SOMETHING OUTSIDE
 * ONEUPTIME (issue #10879): a tool of one of the project's external MCP
 * servers that may change something asks for approval in every permission
 * mode, Auto-run included; is checked before its card is shown, with its
 * arguments written as they will run; and is told, when it runs, that a
 * person approved it. And the turn offers the project's servers only when
 * its caller says so, closing what they opened when it ends.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);

const CHANGE_TOOL: string = "change_outside";
const READ_TOOL: string = "read_outside";

function response(data: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JSONObject }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.toolCalls ? "tool_use" : "end_turn",
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

function ok(text: string): ToolCallOutcome {
  return {
    success: true,
    textForLlm: text,
    result: {
      dataForLlm: text,
      rowCount: 1,
      citationLabel: text,
      redactionCount: 0,
      isTruncated: false,
    },
  };
}

interface Stub {
  tools: Array<ChatExtraTool>;
  executed: Array<{ name: string; args: JSONObject; call?: ExtraToolCall }>;
}

// An extra tool that changes something outside OneUptime, and one that reads.
function stubTools(data?: {
  preparation?: ChatExtraToolPreparation | Error | undefined;
}): Stub {
  const executed: Array<{
    name: string;
    args: JSONObject;
    call?: ExtraToolCall;
  }> = [];

  return {
    executed,
    tools: [
      {
        definition: {
          name: CHANGE_TOOL,
          description: "Changes something outside OneUptime.",
          inputSchema: { type: "object", properties: {} },
        },
        isMutation: true,
        alwaysAsksForApproval: true,
        buildActionTitle: (args: JSONObject) => {
          return {
            template: AI_ACTION_TITLES.callMcpTool,
            values: {
              tool: String(args["tool"] || "tool"),
              server: String(args["server"] || "server"),
            },
          };
        },
        prepareForApproval: async (): Promise<ChatExtraToolPreparation> => {
          const preparation: ChatExtraToolPreparation | Error | undefined =
            data?.preparation;

          if (preparation instanceof Error) {
            throw preparation;
          }

          return (
            preparation || {
              arguments: { server: "Kubernetes", tool: "restart", kept: 1 },
              description: [
                {
                  template: AI_ACTION_LINES.mcpCallSendsOutside,
                  values: { server: "Kubernetes" },
                },
              ],
            }
          );
        },
        execute: async (
          args: JSONObject,
          call?: ExtraToolCall | undefined,
        ): Promise<ToolCallOutcome> => {
          executed.push({ name: CHANGE_TOOL, args, ...(call ? { call } : {}) });
          return ok("changed");
        },
      },
      {
        definition: {
          name: READ_TOOL,
          description: "Reads something outside OneUptime.",
          inputSchema: { type: "object", properties: {} },
        },
        execute: async (
          args: JSONObject,
          call?: ExtraToolCall | undefined,
        ): Promise<ToolCallOutcome> => {
          executed.push({ name: READ_TOOL, args, ...(call ? { call } : {}) });
          return ok("read");
        },
      },
    ],
  };
}

interface Spies {
  executeWithLogging: jest.SpiedFunction<typeof AIService.executeWithLogging>;
  runUpdateOneBy: jest.SpiedFunction<typeof AIRunService.updateOneBy>;
  messageUpdateOneBy: jest.SpiedFunction<
    typeof AIConversationMessageService.updateOneBy
  >;
  createEvent: jest.SpiedFunction<typeof AIRunEventService.create>;
}

function installSpies(run?: AIRun | undefined): Spies {
  const createEvent: jest.SpiedFunction<typeof AIRunEventService.create> = jest
    .spyOn(AIRunEventService, "create")
    .mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);
  jest
    .spyOn(AIRunLimitsReader, "read")
    .mockResolvedValue(AIAgentRunLimitsHelper.getDefault() as never);

  const running: AIRun = new AIRun();
  running.status = AIRunStatus.Running;

  const findRun: jest.SpiedFunction<typeof AIRunService.findOneById> = jest
    .spyOn(AIRunService, "findOneById")
    .mockResolvedValue(running as never);

  if (run) {
    findRun.mockResolvedValueOnce(run as never);
  }

  const runUpdateOneBy: jest.SpiedFunction<typeof AIRunService.updateOneBy> =
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);

  jest
    .spyOn(AIConversationMessageService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AIConversationMessageService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  const messageUpdateOneBy: jest.SpiedFunction<
    typeof AIConversationMessageService.updateOneBy
  > = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(new AIConversation() as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  const executeWithLogging: jest.SpiedFunction<
    typeof AIService.executeWithLogging
  > = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Done." }) as never);

  return {
    executeWithLogging,
    runUpdateOneBy,
    messageUpdateOneBy,
    createEvent,
  };
}

function request(overrides?: Partial<ChatTurnRequest>): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AutoRun,
    props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
    ...overrides,
  };
}

function askToChange(spies: Spies): void {
  spies.executeWithLogging.mockResolvedValueOnce(
    response({
      toolCalls: [
        {
          id: "call-change",
          name: CHANGE_TOOL,
          arguments: { server: "kubernetes", tool: "restart", dropped: true },
        },
      ],
    }) as never,
  );
}

function pausedState(spies: Spies): AIRunPausedState | undefined {
  for (const call of spies.runUpdateOneBy.mock.calls) {
    const data: JSONObject = (call[0] as { data: JSONObject }).data;

    if (data["status"] === AIRunStatus.WaitingForApproval) {
      return data["pausedState"] as unknown as AIRunPausedState;
    }
  }

  return undefined;
}

function lastToolActions(spies: Spies): Array<AIChatToolAction> {
  const calls: Array<Array<unknown>> = spies.messageUpdateOneBy.mock.calls;

  for (let index: number = calls.length - 1; index >= 0; index--) {
    const data: JSONObject = (calls[index]![0] as { data: JSONObject }).data;

    if (data["toolActions"]) {
      return data["toolActions"] as unknown as Array<AIChatToolAction>;
    }
  }

  return [];
}

function toolsOffered(spies: Spies, index: number = 0): Array<string> {
  return (
    (spies.executeWithLogging.mock.calls[index]![0] as AILogRequest).tools || []
  ).map((tool: LLMToolDefinition): string => {
    return tool.name;
  });
}

describe("an extra tool that always asks for approval", () => {
  test("Auto-run asks too: the turn waits, and nothing runs", async () => {
    const spies: Spies = installSpies();
    const stub: Stub = stubTools();
    askToChange(spies);

    await ChatAgentRunner.runTurn(request({ extraTools: stub.tools }));

    expect(pausedState(spies)).toBeDefined();
    expect(stub.executed).toEqual([]);

    const action: AIChatToolAction = lastToolActions(spies)[0]!;
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.requiresApproval).toBe(true);
  });

  test("its card carries the arguments the preparation wrote, and the preparation's lines", async () => {
    const spies: Spies = installSpies();
    askToChange(spies);

    await ChatAgentRunner.runTurn(request({ extraTools: stubTools().tools }));

    const pending: JSONObject = (
      pausedState(spies)!.pendingToolCalls as Array<JSONObject>
    )[0]!;
    expect(pending["arguments"]).toEqual({
      server: "Kubernetes",
      tool: "restart",
      kept: 1,
    });

    const action: AIChatToolAction = lastToolActions(spies)[0]!;
    expect(action.arguments).toEqual({
      server: "Kubernetes",
      tool: "restart",
      kept: 1,
    });
    expect(action.title).toBe("Call restart on MCP server Kubernetes");
    expect(action.description).toBe(
      "Sends the arguments below to Kubernetes, outside OneUptime. OneUptime cannot undo what it changes there.",
    );
  });

  test("a preparation that refuses it: no card, the model is told why, and the step says it was refused", async () => {
    const spies: Spies = installSpies();
    const stub: Stub = stubTools({
      preparation: {
        refused: {
          success: false,
          textForLlm: "Refused: the person asking may not make changes.",
          errorMessage: "Refused: the person asking may not make changes.",
          refusal: AIToolRefusal.Permission,
        },
      },
    });
    askToChange(spies);

    await ChatAgentRunner.runTurn(request({ extraTools: stub.tools }));

    expect(pausedState(spies)).toBeUndefined();
    expect(lastToolActions(spies)).toEqual([]);
    expect(stub.executed).toEqual([]);
    expect(
      JSON.stringify(
        (spies.executeWithLogging.mock.calls[1]![0] as AILogRequest).messages,
      ),
    ).toContain("Refused: the person asking may not make changes.");

    const failed: JSONObject | undefined = spies.createEvent.mock.calls
      .map((call: Array<unknown>): JSONObject => {
        return (call[0] as { data: JSONObject }).data;
      })
      .find((event: JSONObject): boolean => {
        return (
          (event["resultSummary"] as JSONObject | undefined)?.["refusal"] ===
          AIToolRefusal.Permission
        );
      });
    expect(failed).toBeDefined();
    expect((failed!["resultSummary"] as JSONObject)["isAction"]).toBe(true);
  });

  test("a preparation that fails: no card either", async () => {
    const spies: Spies = installSpies();
    const stub: Stub = stubTools({
      preparation: new Error("the server could not be listed"),
    });
    askToChange(spies);

    await ChatAgentRunner.runTurn(request({ extraTools: stub.tools }));

    expect(pausedState(spies)).toBeUndefined();
    expect(stub.executed).toEqual([]);
    expect(
      JSON.stringify(
        (spies.executeWithLogging.mock.calls[1]![0] as AILogRequest).messages,
      ),
    ).toContain(
      "Error preparing change_outside: the server could not be listed. Nothing was proposed or sent.",
    );
  });

  test("approved, it runs once, told a person approved it", async () => {
    const stub: Stub = stubTools();
    const first: Spies = installSpies();
    askToChange(first);
    const turn: ChatTurnRequest = request({ extraTools: stub.tools });

    await ChatAgentRunner.runTurn(turn);

    const paused: AIRunPausedState = pausedState(first)!;
    jest.restoreAllMocks();

    const run: AIRun = new AIRun();
    run.status = AIRunStatus.WaitingForApproval;
    run.pausedState = paused;
    installSpies(run);

    await ChatAgentRunner.resumeTurn(turn, [
      { toolCallId: "call-change", approved: true },
    ]);

    expect(stub.executed).toHaveLength(1);
    expect(stub.executed[0]!.args).toEqual({
      server: "Kubernetes",
      tool: "restart",
      kept: 1,
    });
    expect(stub.executed[0]!.call?.isApprovedByPerson).toBe(true);
  });

  test("a Read-only conversation never offers it, and refuses it if named", async () => {
    const spies: Spies = installSpies();
    const stub: Stub = stubTools();
    askToChange(spies);

    await ChatAgentRunner.runTurn(
      request({
        extraTools: stub.tools,
        permissionMode: AIChatPermissionMode.ReadOnly,
      }),
    );

    expect(toolsOffered(spies)).toContain(READ_TOOL);
    expect(toolsOffered(spies)).not.toContain(CHANGE_TOOL);
    expect(stub.executed).toEqual([]);
    expect(pausedState(spies)).toBeUndefined();
  });

  test("a tool that reads runs at once, and is never told a person approved it", async () => {
    const spies: Spies = installSpies();
    const stub: Stub = stubTools();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        toolCalls: [{ id: "call-read", name: READ_TOOL, arguments: {} }],
      }) as never,
    );

    await ChatAgentRunner.runTurn(request({ extraTools: stub.tools }));

    expect(stub.executed).toHaveLength(1);
    expect(stub.executed[0]!.call?.isApprovedByPerson).toBeUndefined();
    expect(typeof stub.executed[0]!.call?.runDeadlineAtMs).toBe("number");
  });
});

describe("the project's external MCP servers in a turn", () => {
  function stubServers(): {
    build: jest.SpiedFunction<typeof ChatMcpAccess.buildForTurn>;
    closed: Array<string>;
  } {
    const closed: Array<string> = [];
    const build: jest.SpiedFunction<typeof ChatMcpAccess.buildForTurn> = jest
      .spyOn(ChatMcpAccess, "buildForTurn")
      .mockImplementation(async (): Promise<ChatMcpServers> => {
        return {
          extraTools: stubTools().tools,
          instructions: "# External MCP servers\n- Kubernetes",
          close: async (): Promise<void> => {
            closed.push("closed");
          },
        };
      });

    return { build, closed };
  }

  test("not offered unless the turn's caller says so", async () => {
    installSpies();
    const { build } = stubServers();

    await ChatAgentRunner.runTurn(request());

    expect(build).not.toHaveBeenCalled();
  });

  test("offered, for the person asking and the conversation's mode, with what they reach in the prompt, and closed when the turn ends", async () => {
    const spies: Spies = installSpies();
    const { build, closed } = stubServers();
    const turn: ChatTurnRequest = request({
      offersExternalMcpServers: true,
      permissionMode: AIChatPermissionMode.AskForApproval,
    });

    await ChatAgentRunner.runTurn(turn);

    expect(build).toHaveBeenCalledTimes(1);
    const args: Parameters<typeof ChatMcpAccess.buildForTurn>[0] =
      build.mock.calls[0]![0];
    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.props).toBe(turn.props);
    expect(args.permissionMode).toBe(AIChatPermissionMode.AskForApproval);
    expect(args.outputPager).toBeInstanceOf(ToolOutputPager);
    expect(args.hasReadToolOutput).toBe(false);

    expect(toolsOffered(spies)).toEqual(
      expect.arrayContaining([READ_TOOL, CHANGE_TOOL]),
    );
    expect(
      (spies.executeWithLogging.mock.calls[0]![0] as AILogRequest).messages[0]!
        .content,
    ).toContain("# External MCP servers\n- Kubernetes");
    expect(closed).toEqual(["closed"]);
  });

  test("closed when the turn pauses for approval, too", async () => {
    const spies: Spies = installSpies();
    const { closed } = stubServers();
    askToChange(spies);

    await ChatAgentRunner.runTurn(request({ offersExternalMcpServers: true }));

    expect(pausedState(spies)).toBeDefined();
    expect(closed).toEqual(["closed"]);
  });

  test("closed when the turn fails", async () => {
    const spies: Spies = installSpies();
    const { closed } = stubServers();
    spies.executeWithLogging.mockRejectedValueOnce(
      new Error("the provider is down") as never,
    );

    await ChatAgentRunner.runTurn(request({ offersExternalMcpServers: true }));

    expect(closed).toEqual(["closed"]);
  });

  test("built again for a turn resumed after an approval", async () => {
    const run: AIRun = new AIRun();
    run.status = AIRunStatus.WaitingForApproval;
    run.pausedState = {
      messages: [
        { role: "system", content: "prompt" },
        { role: "user", content: "restart it" },
      ],
      pendingToolCalls: [],
      llmCallCount: 1,
      toolCallCount: 0,
      totalTokens: 10,
      totalCostInUSDCents: 1,
      eventSequence: 3,
      citations: [],
      widgets: [],
      toolActions: [],
      egressToolEntries: [],
      startedAtMs: Date.now(),
    } as unknown as AIRunPausedState;
    installSpies(run);
    const { build, closed } = stubServers();

    await ChatAgentRunner.resumeTurn(
      request({ offersExternalMcpServers: true }),
      [],
    );

    expect(build).toHaveBeenCalledTimes(1);
    expect(closed).toEqual(["closed"]);
  });

  test("a page's command tools and the servers' tools page with one pager, and read_tool_output is offered once", async () => {
    installSpies();
    const pager: ToolOutputPager = new ToolOutputPager();
    jest
      .spyOn(ChatInfrastructureAccess, "buildForPage")
      .mockImplementation(
        async (data: { outputPager?: ToolOutputPager | undefined }) => {
          expect(data.outputPager).toBe(pager);
          return {
            extraTools: [pager.buildReadTool()],
            instructions: "# Commands on infrastructure",
          };
        },
      );
    const { build } = stubServers();

    await ChatAgentRunner.runTurn(
      request({
        offersPageInfrastructure: true,
        offersExternalMcpServers: true,
        outputPager: pager,
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: ObjectID.generate().toString(),
        },
      }),
    );

    const args: Parameters<typeof ChatMcpAccess.buildForTurn>[0] =
      build.mock.calls[0]![0];
    expect(args.outputPager).toBe(pager);
    expect(args.hasReadToolOutput).toBe(true);
  });

  test("servers that cannot be built leave the turn as it was", async () => {
    const spies: Spies = installSpies();
    jest.spyOn(ChatMcpAccess, "buildForTurn").mockResolvedValue(null);

    await ChatAgentRunner.runTurn(request({ offersExternalMcpServers: true }));

    expect(toolsOffered(spies)).not.toContain(READ_TOOL_OUTPUT_TOOL_NAME);
    expect(
      spies.messageUpdateOneBy.mock.calls.some((call: Array<unknown>) => {
        return (
          (call[0] as { data: JSONObject }).data["status"] ===
          AIChatMessageStatus.Completed
        );
      }),
    ).toBe(true);
  });
});
