import CodeAgentTelemetry, {
  CodeAgentTelemetryCallResult,
  CodeAgentTelemetryToolList,
  MAX_TELEMETRY_TOOL_OUTPUT_CHARS,
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
import {
  LoopBudgetDecision,
  MAX_COMPLETION_CALLS_PER_RUN,
  MAX_OUTPUT_TOKENS_PER_RUN,
  MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentCompletion";
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
 * THE BUDGET OF A RUN'S PRODUCTION QUERIES, KEPT BY THE SERVER.
 *
 *   - at most MAX_TELEMETRY_TOOL_CALLS_PER_RUN, counted on the run by one
 *     conditional UPDATE;
 *   - each one counts against the run's calls with its LLM completions,
 *     and one is always left for the final answer;
 *   - none after the run's output tokens are spent;
 *   - a call the server refuses (the tool, its arguments) costs nothing.
 */

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

describe("CodeAgentTelemetry.evaluateToolCallBudget (pure)", () => {
  test("allows a call with calls to spare", () => {
    const decision: LoopBudgetDecision =
      CodeAgentTelemetry.evaluateToolCallBudget({
        completionCalls: 5,
        outputTokens: 1000,
        toolCalls: 2,
      });

    expect(decision.allowed).toBe(true);
  });

  test("refuses once the run has made all its production queries", () => {
    const decision: LoopBudgetDecision =
      CodeAgentTelemetry.evaluateToolCallBudget({
        completionCalls: 1,
        outputTokens: 0,
        toolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(`${MAX_TELEMETRY_TOOL_CALLS_PER_RUN}`);
  });

  test("always leaves the run one call for its final answer", () => {
    // After this call, one call is left: allowed.
    expect(
      CodeAgentTelemetry.evaluateToolCallBudget({
        completionCalls: MAX_COMPLETION_CALLS_PER_RUN - 5,
        outputTokens: 0,
        toolCalls: 3,
      }).allowed,
    ).toBe(true);

    // After this call, none would be left: refused.
    const decision: LoopBudgetDecision =
      CodeAgentTelemetry.evaluateToolCallBudget({
        completionCalls: MAX_COMPLETION_CALLS_PER_RUN - 4,
        outputTokens: 0,
        toolCalls: 3,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("no call for its final answer");
  });

  test("refuses once the run's output tokens are spent", () => {
    const decision: LoopBudgetDecision =
      CodeAgentTelemetry.evaluateToolCallBudget({
        completionCalls: 1,
        outputTokens: MAX_OUTPUT_TOKENS_PER_RUN,
        toolCalls: 0,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("output-token budget");
  });
});

function runningRun(toolCallCount: number): AIRun {
  return {
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: AIRunStatus.Running,
    aiAgentId: AGENT_ID,
    toolCallCount,
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
  toolCalls: number;
  tool?: CodeAgentTelemetryTool;
  reserves?: boolean;
}): { reserve: jest.SpyInstance; heartbeat: jest.SpyInstance } {
  jest.spyOn(CodeAgentTelemetryScope, "readRun").mockResolvedValue({
    run: runningRun(data.toolCalls),
    projectId: PROJECT_ID,
    taskType: CodeFixTaskType.FixException,
  });
  jest
    .spyOn(CodeAgentTelemetryScope, "getOffer")
    .mockResolvedValue({ scope: SCOPE, reason: null });
  jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
    completionCalls: data.completionCalls,
    outputTokens: data.outputTokens ?? 0,
  });

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

  test("a call is counted on the run, then read, and reports the budget after it", async () => {
    const read: jest.Mock = jest.fn(async () => {
      return ROWS;
    });
    const spies: { reserve: jest.SpyInstance; heartbeat: jest.SpyInstance } =
      mockRun({ completionCalls: 6, toolCalls: 2, tool: fakeTool(read) });

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
      maxToolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.output).toBe(ROWS.text);
    expect(result.budget).toEqual(
      expect.objectContaining({
        completionCallsUsed: 6 + 3,
        toolCallsUsed: 3,
        maxToolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
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

  test("a run whose calls are spent is refused without counting or reading", async () => {
    const read: jest.Mock = jest.fn();
    const spies: { reserve: jest.SpyInstance } = mockRun({
      completionCalls: MAX_COMPLETION_CALLS_PER_RUN - 3,
      toolCalls: 2,
      tool: fakeTool(read),
    });

    await expect(
      CodeAgentTelemetry.runTool({
        aiAgent: AGENT,
        aiRunId: RUN_ID,
        toolName: "query_traces",
        args: {},
      }),
    ).rejects.toThrow("no call for its final answer");
    expect(spies.reserve).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  test("a call the run's counter refuses (its cap, at the same moment as another) reads nothing", async () => {
    const read: jest.Mock = jest.fn();
    mockRun({
      completionCalls: 1,
      toolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN - 1,
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
      `all ${MAX_TELEMETRY_TOOL_CALLS_PER_RUN} of its production telemetry queries`,
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

  test("a run in scope is offered the belt, its services and its budget", async () => {
    mockRun({ completionCalls: 4, toolCalls: 1 });

    const list: CodeAgentTelemetryToolList = await CodeAgentTelemetry.listTools(
      { aiAgent: AGENT, aiRunId: RUN_ID },
    );

    expect(list.tools).toHaveLength(CodeAgentTelemetryTools.getTools().length);
    expect(list.repository).toBe("acme/cart");
    expect(list.services).toEqual([
      { id: SERVICE_ID, name: "cart-api", pathInRepository: null },
    ]);
    expect(list.budget).toEqual(
      expect.objectContaining({
        completionCallsUsed: 5,
        toolCallsUsed: 1,
        maxToolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
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
      .mockResolvedValue({ completionCalls: 0, outputTokens: 0 });

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
