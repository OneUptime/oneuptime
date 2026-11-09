import CodeAgentTelemetry, {
  CodeAgentTelemetryCallResult,
  CodeAgentTelemetryToolList,
  MAX_TELEMETRY_TOOL_OUTPUT_CHARS,
  TelemetryToolCallDecision,
} from "../../../../../Server/Utils/AI/CodeFix/CodeAgentTelemetry";
import CodeAgentTelemetryScope, {
  CodeAgentScope,
} from "../../../../../Server/Utils/AI/CodeFix/CodeAgentTelemetryScope";
import CodeAgentTelemetryTools, {
  CodeAgentTelemetryTool,
  CodeAgentTelemetryToolOutput,
} from "../../../../../Server/Utils/AI/CodeFix/CodeAgentTelemetryTools";
import {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { LEGACY_MAX_TELEMETRY_TOOL_CALLS } from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentCompletion";
import AIRunLimitsReader from "../../../../../Server/Utils/AI/AIRunLimitsReader";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunTimeLimitSource,
} from "../../../../../Types/AI/AIAgentRunLimits";
import AIRunService from "../../../../../Server/Services/AIRunService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A RUN'S PRODUCTION QUERIES, COUNTED BY THE SERVER (issue #6440).
 *
 *   - no count of their own: a run used to get 12, and now makes as many
 *     as its work needs - each counted on the run by one conditional
 *     UPDATE, held to the project's tool calls per run when it set that;
 *   - none once the run may make no more model calls (its time is up, the
 *     project's model calls or tokens per run are reached): nothing would
 *     read what they return;
 *   - a call the server refuses (the tool, its arguments) costs nothing;
 *   - a Runner from before #6440 is still told the 12 it winds down on.
 */

const LIMITS_LOCATION: string =
  "Project Settings → AI → AI Features → More settings → Limits per run";

const MINUTE: number = 60 * 1000;

function caps(overrides: Partial<AIAgentRunLimits> = {}): AIAgentRunLimits {
  return { ...AIAgentRunLimitsHelper.getDefault(), ...overrides };
}

const PROJECT_ID: ObjectID = new ObjectID(
  "9c1c2d3e-1111-4222-8333-944455556666",
);
const RUN_ID: ObjectID = new ObjectID("9c1c2d3e-2222-4222-8333-944455556666");
const AGENT_ID: ObjectID = new ObjectID("9c1c2d3e-3333-4222-8333-944455556666");
const SERVICE_ID: string = "9c1c2d3e-4444-4222-8333-944455556666";

const AGENT: CodeFixAgentIdentity = {
  id: AGENT_ID,
  projectId: PROJECT_ID,
  source: CodeFixAgentSource.Runner,
};

const SCOPE: CodeAgentScope = {
  projectId: PROJECT_ID,
  aiRunId: RUN_ID,
  taskType: CodeFixTaskType.FixException,
  codeRepositoryId: ObjectID.generate(),
  repositoryFullName: "acme/cart",
  services: [
    {
      id: SERVICE_ID,
      name: "cart-api",
      method: "stack-trace",
      evidence: "Matched src/cart/total.ts in acme/cart",
      pathInRepository: null,
    },
  ],
};

describe("CodeAgentTelemetry.evaluateToolCall (pure)", () => {
  const NOW: number = Date.parse("2026-11-09T12:00:00.000Z");

  test("with no limit set, a run makes as many queries as it needs", () => {
    for (const toolCalls of [0, 11, 12, 13, 500]) {
      const decision: TelemetryToolCallDecision =
        CodeAgentTelemetry.evaluateToolCall({
          limits: caps(),
          usage: { modelCalls: 300, tokens: 9_000_000 },
          toolCalls,
          nowMs: NOW,
          deadlineAtMs: NOW + 30 * MINUTE,
        });

      expect(decision).toEqual({ allowed: true, reason: null });
    }
  });

  test("the project's tool calls per run: refused at the cap, naming the setting", () => {
    const limits: AIAgentRunLimits = caps({ maxToolCalls: 20 });

    expect(
      CodeAgentTelemetry.evaluateToolCall({
        limits,
        usage: { modelCalls: 1, tokens: 0 },
        toolCalls: 19,
        nowMs: NOW,
        deadlineAtMs: null,
      }).allowed,
    ).toBe(true);

    expect(
      CodeAgentTelemetry.evaluateToolCall({
        limits,
        usage: { modelCalls: 1, tokens: 0 },
        toolCalls: 20,
        nowMs: NOW,
        deadlineAtMs: null,
      }),
    ).toEqual({
      allowed: false,
      reason: `This run has made 20 tool calls, this project's limit per run, so it may make no more. Change it in ${LIMITS_LOCATION}. Finish with what you have.`,
    });
  });

  test("a run whose time is up may query no more", () => {
    expect(
      CodeAgentTelemetry.evaluateToolCall({
        limits: caps(),
        usage: { modelCalls: 1, tokens: 0 },
        toolCalls: 0,
        nowMs: NOW,
        deadlineAtMs: NOW,
      }),
    ).toEqual({
      allowed: false,
      reason: `This run has reached its time limit of 120 minutes, so it may make no more calls. Change it in ${LIMITS_LOCATION}. Finish with what you have.`,
    });
  });

  test("a run that may make no more model calls may query no more: nothing would read the result", () => {
    expect(
      CodeAgentTelemetry.evaluateToolCall({
        limits: caps({ maxLlmCalls: 8 }),
        usage: { modelCalls: 8, tokens: 0 },
        toolCalls: 0,
        nowMs: NOW,
        deadlineAtMs: null,
      }).reason,
    ).toContain("This run has made 8 model calls, this project's limit per run");

    expect(
      CodeAgentTelemetry.evaluateToolCall({
        limits: caps({ maxTokens: 50_000 }),
        usage: { modelCalls: 2, tokens: 50_000 },
        toolCalls: 0,
        nowMs: NOW,
        deadlineAtMs: null,
      }).reason,
    ).toContain("this project's limit of 50,000 tokens per run");
  });

  test("a refusal never speaks of a budget", () => {
    const decision: TelemetryToolCallDecision =
      CodeAgentTelemetry.evaluateToolCall({
        limits: caps({ maxToolCalls: 1 }),
        usage: { modelCalls: 0, tokens: 0 },
        toolCalls: 1,
        nowMs: NOW,
        deadlineAtMs: null,
      });

    expect((decision.reason || "").toLowerCase()).not.toContain("budget");
  });
});

function runningRun(toolCallCount: number, startedAt?: Date): AIRun {
  return {
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: AIRunStatus.Running,
    aiAgentId: AGENT_ID,
    toolCallCount,
    ...(startedAt ? { startedAt } : {}),
  } as unknown as AIRun;
}

function fakeTool(
  read: () => Promise<CodeAgentTelemetryToolOutput>,
): CodeAgentTelemetryTool {
  return {
    name: "query_traces",
    description: "A read",
    inputSchema: { type: "object", properties: {} },
    prepare: (
      args: JSONObject,
    ): (() => Promise<CodeAgentTelemetryToolOutput>) => {
      if (args["serviceId"] === "elsewhere") {
        throw new BadDataException(
          '"elsewhere" is not one of the services this repository serves',
        );
      }

      return read;
    },
  };
}

function mockRun(data: {
  completionCalls: number;
  outputTokens?: number;
  totalTokens?: number;
  toolCalls: number;
  tool?: CodeAgentTelemetryTool;
  reserves?: boolean;
  limits?: AIAgentRunLimits;
  startedAt?: Date;
}): { reserve: jest.SpyInstance; heartbeat: jest.SpyInstance } {
  jest.spyOn(CodeAgentTelemetryScope, "readRun").mockResolvedValue({
    run: runningRun(data.toolCalls, data.startedAt),
    projectId: PROJECT_ID,
    taskType: CodeFixTaskType.FixException,
  });
  jest
    .spyOn(CodeAgentTelemetryScope, "getOffer")
    .mockResolvedValue({ scope: SCOPE, reason: null });
  jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
    completionCalls: data.completionCalls,
    outputTokens: data.outputTokens ?? 0,
    totalTokens: data.totalTokens ?? 0,
  });
  // The project's limits per run: none, unless a test sets them.
  jest.spyOn(AIRunLimitsReader, "read").mockResolvedValue(data.limits ?? caps());

  if (data.tool) {
    jest.spyOn(CodeAgentTelemetryTools, "getTool").mockReturnValue(data.tool);
  }

  return {
    reserve: jest
      .spyOn(AIRunService, "reserveCodeAgentToolCall")
      .mockResolvedValue(data.reserves ?? true),
    heartbeat: jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1),
  };
}

const ROWS: CodeAgentTelemetryToolOutput = {
  text: "- name=GET /cart | count=1200",
  rowCount: 1,
  citationLabel: "Trace analytics · cart-api",
  isTruncated: false,
};

describe("CodeAgentTelemetry.runTool", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a call is counted on the run, then read, and reports the run's limits after it", async () => {
    const read: jest.Mock = jest.fn(async () => {
      return ROWS;
    });
    const spies: { reserve: jest.SpyInstance; heartbeat: jest.SpyInstance } =
      mockRun({
        completionCalls: 6,
        totalTokens: 40_000,
        toolCalls: 2,
        tool: fakeTool(read),
      });

    const result: CodeAgentTelemetryCallResult =
      await CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      });

    // Counted, with no cap: the project set none.
    expect(spies.reserve).toHaveBeenCalledWith({
      aiRunId: RUN_ID,
      aiAgentId: AGENT_ID,
      maxToolCalls: null,
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.output).toBe(ROWS.text);
    expect(result.limits).toEqual(
      expect.objectContaining({
        maxModelCalls: null,
        maxToolCalls: null,
        maxTokens: null,
        timeLimitInMinutes: 120,
        timeLimitSource: AIRunTimeLimitSource.Default,
        modelCallsUsed: 6,
        toolCallsUsed: 3,
        tokensUsed: 40_000,
        lastCallTokens: 0,
      }),
    );
    // What a Runner from before #6440 winds down on.
    expect(result.budget).toEqual(
      expect.objectContaining({
        completionCallsUsed: 6 + 3,
        toolCallsUsed: 3,
        maxToolCalls: LEGACY_MAX_TELEMETRY_TOOL_CALLS,
      }),
    );

    // A call proves the worker alive, on a run that is still running.
    expect(
      (spies.heartbeat.mock.calls[0]![0] as { query: JSONObject }).query[
        "status"
      ],
    ).toBe(AIRunStatus.Running);
  });

  test.each([
    "create_incident",
    "commit_code_to_branch",
    "write_file",
    "run_kubectl",
  ])(
    "%s is no tool of the belt, refused before anything is counted",
    async (toolName: string) => {
      const spies: { reserve: jest.SpyInstance } = mockRun({
        completionCalls: 1,
        toolCalls: 0,
      });

      await expect(
        CodeAgentTelemetry.runTool({
          aiAgent: AGENT,
          aiRunId: RUN_ID,
          toolName,
          args: {},
        }),
      ).rejects.toThrow("is not a production telemetry tool");
      expect(spies.reserve).not.toHaveBeenCalled();
    },
  );

  test("arguments the scope refuses cost the run nothing", async () => {
    const read: jest.Mock = jest.fn();
    const spies: { reserve: jest.SpyInstance } = mockRun({
      completionCalls: 1,
      toolCalls: 0,
      tool: fakeTool(read),
    });

    await expect(
      CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: { serviceId: "elsewhere" },
      }),
    ).rejects.toThrow("is not one of the services this repository serves");
    expect(spies.reserve).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  /*
   * THE CUSTOMER'S CASE (issue #6440): a run used to be refused its 13th
   * query. With nothing set, its 13th - and its 60th - are served.
   */
  test.each([12, 59])(
    "with no limit set, a run that made %p queries is served the next one",
    async (toolCalls: number) => {
      const read: jest.Mock = jest.fn(async () => {
        return ROWS;
      });
      const spies: { reserve: jest.SpyInstance } = mockRun({
        completionCalls: 45,
        toolCalls,
        tool: fakeTool(read),
      });

      const result: CodeAgentTelemetryCallResult =
        await CodeAgentTelemetry.runTool({
          aiAgent: AGENT,
          aiRunId: RUN_ID,
          toolName: "query_traces",
          args: {},
        });

      expect(spies.reserve).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);
      expect(result.limits.toolCallsUsed).toBe(toolCalls + 1);
    },
  );

  test("the project's tool calls per run are the counter's cap", async () => {
    const spies: { reserve: jest.SpyInstance } = mockRun({
      completionCalls: 1,
      toolCalls: 3,
      tool: fakeTool(async () => {
        return ROWS;
      }),
      limits: caps({ maxToolCalls: 25 }),
    });

    const result: CodeAgentTelemetryCallResult =
      await CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      });

    expect(spies.reserve).toHaveBeenCalledWith({
      aiRunId: RUN_ID,
      aiAgentId: AGENT_ID,
      maxToolCalls: 25,
    });
    expect(result.limits.maxToolCalls).toBe(25);
  });

  test("a run at the project's model calls per run is refused without counting or reading", async () => {
    const read: jest.Mock = jest.fn();
    const spies: { reserve: jest.SpyInstance } = mockRun({
      completionCalls: 10,
      toolCalls: 2,
      tool: fakeTool(read),
      limits: caps({ maxLlmCalls: 10 }),
    });

    await expect(
      CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      }),
    ).rejects.toThrow(
      `This run has made 10 model calls, this project's limit per run, so it may make no more. Change it in ${LIMITS_LOCATION}. Finish with what you have.`,
    );
    expect(spies.reserve).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  test("a run whose time is up is refused without counting or reading", async () => {
    const read: jest.Mock = jest.fn();
    const spies: { reserve: jest.SpyInstance } = mockRun({
      completionCalls: 3,
      toolCalls: 2,
      tool: fakeTool(read),
      startedAt: new Date(Date.now() - 121 * MINUTE),
    });

    await expect(
      CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      }),
    ).rejects.toThrow("This run has reached its time limit of 120 minutes");
    expect(spies.reserve).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  test("a call the run's counter refuses (the cap, at the same moment as another) reads nothing", async () => {
    const read: jest.Mock = jest.fn();
    mockRun({
      completionCalls: 1,
      toolCalls: 4,
      tool: fakeTool(read),
      reserves: false,
      limits: caps({ maxToolCalls: 5 }),
    });

    await expect(
      CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      }),
    ).rejects.toThrow(
      "This run may make no more production telemetry calls: it has reached this project's limit of 5 tool calls per run, or it is no longer running. Finish with what you have.",
    );
    expect(read).not.toHaveBeenCalled();
  });

  test("with no cap, the counter refuses only a run that moved on", async () => {
    const read: jest.Mock = jest.fn();
    mockRun({
      completionCalls: 1,
      toolCalls: 4,
      tool: fakeTool(read),
      reserves: false,
    });

    await expect(
      CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      }),
    ).rejects.toThrow(
      "This run is no longer running, so it may make no more production telemetry calls.",
    );
    expect(read).not.toHaveBeenCalled();
  });

  test("a read that fails once counted is an error result, not a lost run", async () => {
    mockRun({
      completionCalls: 1,
      toolCalls: 0,
      tool: fakeTool(async () => {
        throw new Error("ClickHouse is unavailable");
      }),
    });

    const result: CodeAgentTelemetryCallResult =
      await CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      });

    expect(result.output).toContain("could not read production telemetry");
    expect(result.output).toContain("ClickHouse is unavailable");
    expect(result.limits.toolCallsUsed).toBe(1);
    expect(result.budget.toolCallsUsed).toBe(1);
  });

  test("a result is held to its length", async () => {
    mockRun({
      completionCalls: 1,
      toolCalls: 0,
      tool: fakeTool(async () => {
        return {
          ...ROWS,
          text: "x".repeat(MAX_TELEMETRY_TOOL_OUTPUT_CHARS * 2),
        };
      }),
    });

    const result: CodeAgentTelemetryCallResult =
      await CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      });

    expect(result.output.length).toBeLessThan(
      MAX_TELEMETRY_TOOL_OUTPUT_CHARS + 200,
    );
    expect(result.isTruncated).toBe(true);
  });

  test("a run offered nothing is refused with the reason", async () => {
    jest.spyOn(CodeAgentTelemetryScope, "readRun").mockResolvedValue({
      run: runningRun(0),
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveLogging,
    });
    jest.spyOn(CodeAgentTelemetryScope, "getOffer").mockResolvedValue({
      scope: null,
      reason: "Production telemetry is offered to reviews and to fixes",
    });
    const reserve: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "reserveCodeAgentToolCall",
    );

    await expect(
      CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      }),
    ).rejects.toThrow("offered to reviews and to fixes");
    expect(reserve).not.toHaveBeenCalled();
  });
});

describe("CodeAgentTelemetry.listTools", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a run in scope is offered the belt, its services and its limits", async () => {
    const startedAt: Date = new Date(Date.now() - 5 * MINUTE);
    mockRun({
      completionCalls: 4,
      toolCalls: 1,
      startedAt,
      limits: AIAgentRunLimitsHelper.fromSettings({ timeLimitInMinutes: 60 }),
    });

    const list: CodeAgentTelemetryToolList = await CodeAgentTelemetry.listTools(
      { aiAgent: AGENT, aiRunId: RUN_ID },
    );

    expect(list.tools).toHaveLength(CodeAgentTelemetryTools.getTools().length);
    expect(list.repository).toBe("acme/cart");
    expect(list.services).toEqual([
      { id: SERVICE_ID, name: "cart-api", pathInRepository: null },
    ]);
    expect(list.limits).toEqual(
      expect.objectContaining({
        maxToolCalls: null,
        timeLimitInMinutes: 60,
        timeLimitSource: AIRunTimeLimitSource.Project,
        deadlineAt: new Date(startedAt.getTime() + 60 * MINUTE).toISOString(),
        modelCallsUsed: 4,
        toolCallsUsed: 1,
      }),
    );
    expect(list.limits.timeLeftMs).toBeGreaterThan(54 * MINUTE);
    expect(list.budget).toEqual(
      expect.objectContaining({
        completionCallsUsed: 5,
        toolCallsUsed: 1,
        maxToolCalls: LEGACY_MAX_TELEMETRY_TOOL_CALLS,
      }),
    );
  });

  test("a run offered nothing gets no tools, and why", async () => {
    jest.spyOn(CodeAgentTelemetryScope, "readRun").mockResolvedValue({
      run: runningRun(0),
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixException,
    });
    jest.spyOn(CodeAgentTelemetryScope, "getOffer").mockResolvedValue({
      scope: null,
      reason: "No service of this project maps to acme/cart",
    });
    jest
      .spyOn(LlmLogService, "getRunCompletionUsage")
      .mockResolvedValue({ completionCalls: 0, outputTokens: 0, totalTokens: 0 });
    jest.spyOn(AIRunLimitsReader, "read").mockResolvedValue(caps());

    const list: CodeAgentTelemetryToolList = await CodeAgentTelemetry.listTools(
      { aiAgent: AGENT, aiRunId: RUN_ID },
    );

    expect(list.tools).toEqual([]);
    expect(list.reason).toContain("No service of this project maps to");
  });

  test("a run the agent may not read for is refused, not listed", async () => {
    jest
      .spyOn(CodeAgentTelemetryScope, "readRun")
      .mockRejectedValue(new BadDataException("Task not found"));

    await expect(
      CodeAgentTelemetry.listTools({ aiAgent: AGENT, aiRunId: RUN_ID }),
    ).rejects.toThrow("Task not found");
  });
});
