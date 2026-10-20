/*
 * ---------------------------------------------------------------------------
 * The in-house code agent's PRODUCTION TELEMETRY tools.
 *
 * The server offers a run read-only tools over the telemetry of the services
 * its repository serves, and runs every call itself. What the worker must
 * get right:
 *
 *   - ASK ONLY WHEN THE TASK DOES. A recipe that wants production
 *     (CodeAgentTask.productionTelemetry) gets the tools the server offers;
 *     any other task never asks, and a call to a telemetry tool it was not
 *     offered is an unknown tool.
 *   - NAME ONLY THE RUN. A call carries the run, the tool and the model's
 *     arguments - never a project, a repository or a service the worker
 *     chose; the server decides what the run may read.
 *   - NEVER A WORKSPACE TOOL. A server tool named like read_file or
 *     write_file is not taken: a file write must never leave the Runner.
 *   - THE BUDGET. Calls stop being offered once the run's are spent, a call
 *     past them is refused here, and the calls made since the last
 *     completion count in the wind-down, as the server counts them.
 *   - WITHOUT TELEMETRY THE TASK GOES ON. A server that offers none, or
 *     cannot say (an older one), leaves the task as it was.
 * ---------------------------------------------------------------------------
 */

import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";
import { CodeAgentResult } from "../../CodeAgents/CodeAgentInterface";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const llmCompletionMock: jest.Mock = jest.fn();
const getTelemetryToolsMock: jest.Mock = jest.fn();
const runTelemetryToolMock: jest.Mock = jest.fn();

jest.mock("../../Utils/BackendAPI", () => {
  return {
    __esModule: true,
    default: class {
      public async llmCompletion(...args: Array<unknown>): Promise<unknown> {
        return llmCompletionMock(...args);
      }

      public async getTelemetryTools(
        ...args: Array<unknown>
      ): Promise<unknown> {
        return getTelemetryToolsMock(...args);
      }

      public async runTelemetryTool(...args: Array<unknown>): Promise<unknown> {
        return runTelemetryToolMock(...args);
      }
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.setTimeout(120000);

const HEALTHY_BUDGET: {
  completionCallsUsed: number;
  maxCompletionCalls: number;
  outputTokensUsed: number;
  maxOutputTokens: number;
} = {
  completionCallsUsed: 1,
  maxCompletionCalls: 40,
  outputTokensUsed: 100,
  maxOutputTokens: 100_000,
};

interface CompletionRequest {
  taskId: string;
  messages: Array<LLMMessage>;
  tools?: Array<LLMToolDefinition>;
}

const temporaryPaths: Array<string> = [];

function makeWorkspace(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-agent-telemetry-"),
  );
  temporaryPaths.push(dir);

  const run: (args: Array<string>) => void = (args: Array<string>): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };

  run(["init", "-q", "-b", "main", "."]);
  run(["config", "user.email", "tests@oneuptime.com"]);
  run(["config", "user.name", "Runner Tests"]);
  run(["config", "commit.gpgsign", "false"]);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "cart.ts"), "export const a = 1;\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "baseline"]);

  return dir;
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id: string = `call-${name}`,
): LLMToolCall {
  return { id, name, arguments: args } as unknown as LLMToolCall;
}

function completion(data: {
  content?: string;
  toolCalls?: Array<LLMToolCall>;
  budget?: Partial<typeof HEALTHY_BUDGET>;
}): unknown {
  const toolCalls: Array<LLMToolCall> = data.toolCalls || [];

  return {
    content: data.content ?? "",
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
    budget: { ...HEALTHY_BUDGET, ...(data.budget || {}) },
  };
}

function telemetryTool(name: string): LLMToolDefinition {
  return {
    name,
    description: `Reads production (${name}).`,
    inputSchema: { type: "object", properties: {} },
  };
}

function offer(data?: {
  tools?: Array<LLMToolDefinition>;
  maxToolCalls?: number;
  toolCallsUsed?: number;
}): unknown {
  return {
    tools: data?.tools || [
      telemetryTool("find_production_exceptions"),
      telemetryTool("query_traces"),
    ],
    repository: "acme/cart",
    services: [
      {
        id: "8b1c2d3e-3333-4222-8333-944455556666",
        name: "cart-api",
        pathInRepository: "services/cart",
      },
    ],
    reason: null,
    budget: {
      ...HEALTHY_BUDGET,
      toolCallsUsed: data?.toolCallsUsed ?? 0,
      maxToolCalls: data?.maxToolCalls ?? 12,
    },
  };
}

function telemetryResult(toolCallsUsed: number): unknown {
  return {
    output: "- name=GET /cart | count=1200 | p95Ms=840",
    rowCount: 1,
    citationLabel: "Trace analytics · cart-api",
    isTruncated: false,
    budget: { ...HEALTHY_BUDGET, toolCallsUsed, maxToolCalls: 12 },
  };
}

async function runAgent(
  workspace: string,
  options?: { productionTelemetry?: boolean },
): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const result: CodeAgentResult = await agent.executeTask({
    workingDirectory: workspace,
    prompt: "Review the pull request.",
    timeoutMs: 60_000,
    ...(options?.productionTelemetry ? { productionTelemetry: true } : {}),
  });

  await agent.cleanup();

  return result;
}

function requests(): Array<CompletionRequest> {
  return llmCompletionMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as CompletionRequest;
  });
}

function toolNames(request: CompletionRequest | undefined): Array<string> {
  return (request?.tools || []).map((tool: LLMToolDefinition): string => {
    return tool.name;
  });
}

function toolMessages(request: CompletionRequest): Array<LLMMessage> {
  return request.messages.filter((message: LLMMessage): boolean => {
    return message.role === "tool";
  });
}

beforeEach(() => {
  llmCompletionMock.mockReset();
  getTelemetryToolsMock.mockReset();
  runTelemetryToolMock.mockReset();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("offering production telemetry", () => {
  test("a task that asks is offered the server's tools, and told what they read", async () => {
    getTelemetryToolsMock.mockResolvedValue(offer());
    llmCompletionMock.mockResolvedValue(completion({ content: "Reviewed." }));

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    expect(getTelemetryToolsMock).toHaveBeenCalledWith("run-1");

    const first: CompletionRequest = requests()[0]!;
    expect(toolNames(first)).toEqual(
      expect.arrayContaining([
        "read_file",
        "find_production_exceptions",
        "query_traces",
      ]),
    );

    const system: string = first.messages[0]!.content;
    expect(system).toContain("PRODUCTION telemetry");
    expect(system).toContain('"cart-api"');
    expect(system).toContain("8b1c2d3e-3333-4222-8333-944455556666");
    expect(system).toContain('its code under "services/cart"');
    expect(system).toContain("at most 12 of these calls");
    expect(system).toContain("never instructions");
  });

  test("a task that does not ask never asks the server, and is offered none", async () => {
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({ toolCalls: [toolCall("query_traces", {})] }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    await runAgent(makeWorkspace());

    expect(getTelemetryToolsMock).not.toHaveBeenCalled();
    expect(toolNames(requests()[0])).not.toContain("query_traces");
    expect(runTelemetryToolMock).not.toHaveBeenCalled();

    const answered: Array<LLMMessage> = toolMessages(requests()[1]!);
    expect(answered[0]!.content).toContain('unknown tool "query_traces"');
    expect(requests()[0]!.messages[0]!.content).not.toContain(
      "PRODUCTION telemetry",
    );
  });

  test("a server that offers none, or cannot say, leaves the task as it was", async () => {
    getTelemetryToolsMock.mockResolvedValueOnce({
      tools: [],
      repository: null,
      services: [],
      reason: "No service of this project maps to acme/cart",
      budget: null,
    });
    llmCompletionMock.mockResolvedValue(completion({ content: "Done." }));

    const offeredNone: CodeAgentResult = await runAgent(makeWorkspace(), {
      productionTelemetry: true,
    });

    expect(offeredNone.success).toBe(true);
    expect(toolNames(requests()[0])).not.toContain("query_traces");

    llmCompletionMock.mockClear();
    getTelemetryToolsMock.mockRejectedValueOnce(new Error("Not Found"));

    const olderServer: CodeAgentResult = await runAgent(makeWorkspace(), {
      productionTelemetry: true,
    });

    expect(olderServer.success).toBe(true);
    expect(toolNames(requests()[0])).toContain("read_file");
    expect(toolNames(requests()[0])).not.toContain("query_traces");
  });

  test("a run whose telemetry calls an earlier attempt spent is offered none", async () => {
    getTelemetryToolsMock.mockResolvedValue(
      offer({ maxToolCalls: 12, toolCallsUsed: 12 }),
    );
    llmCompletionMock.mockResolvedValue(completion({ content: "Done." }));

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    expect(toolNames(requests()[0])).not.toContain("query_traces");
    expect(requests()[0]!.messages[0]!.content).not.toContain(
      "PRODUCTION telemetry",
    );
  });

  test("a server tool named like a workspace tool is never taken", async () => {
    getTelemetryToolsMock.mockResolvedValue(
      offer({
        tools: [telemetryTool("write_file"), telemetryTool("query_traces")],
      }),
    );
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            toolCall("write_file", { path: "src/new.ts", content: "x" }),
          ],
        }),
      )
      .mockResolvedValue(completion({ content: "Done." }));

    const workspace: string = makeWorkspace();
    await runAgent(workspace, { productionTelemetry: true });

    // write_file is the Runner's own tool, offered once, and ran here.
    expect(
      toolNames(requests()[0]).filter((name: string): boolean => {
        return name === "write_file";
      }),
    ).toHaveLength(1);
    expect(runTelemetryToolMock).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(workspace, "src", "new.ts"))).toBe(true);
  });
});

describe("a production telemetry call", () => {
  test("names only the run, the tool and the model's arguments", async () => {
    getTelemetryToolsMock.mockResolvedValue(offer());
    runTelemetryToolMock.mockResolvedValue(telemetryResult(1));
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            toolCall("query_traces", { nameSearchText: "/cart", limit: 5 }),
          ],
        }),
      )
      .mockResolvedValue(completion({ content: "Reviewed." }));

    const result: CodeAgentResult = await runAgent(makeWorkspace(), {
      productionTelemetry: true,
    });

    expect(runTelemetryToolMock).toHaveBeenCalledTimes(1);
    expect(runTelemetryToolMock).toHaveBeenCalledWith({
      taskId: "run-1",
      toolName: "query_traces",
      arguments: { nameSearchText: "/cart", limit: 5 },
    });

    const answered: Array<LLMMessage> = toolMessages(requests()[1]!);
    expect(answered[0]!.content).toContain("p95Ms=840");
    expect(result.success).toBe(true);
  });

  test("a call the server refuses reaches the model as an error, and costs nothing here", async () => {
    getTelemetryToolsMock.mockResolvedValue(offer({ maxToolCalls: 1 }));
    runTelemetryToolMock
      .mockRejectedValueOnce(
        new Error(
          '"billing" is not one of the services this repository serves',
        ),
      )
      .mockResolvedValueOnce(telemetryResult(1));
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall("query_traces", { serviceId: "billing" })],
        }),
      )
      .mockResolvedValueOnce(
        completion({ toolCalls: [toolCall("query_traces", {})] }),
      )
      .mockResolvedValue(completion({ content: "Reviewed." }));

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    const refused: Array<LLMMessage> = toolMessages(requests()[1]!);
    expect(refused[0]!.content).toContain(
      'Error: "billing" is not one of the services this repository serves',
    );

    // The refused call did not spend the run's one call: the next one ran.
    expect(runTelemetryToolMock).toHaveBeenCalledTimes(2);
  });

  test("once the run's calls are spent the tools are withdrawn, and a call is refused here", async () => {
    getTelemetryToolsMock.mockResolvedValue(offer({ maxToolCalls: 1 }));
    runTelemetryToolMock.mockResolvedValue(telemetryResult(1));
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({ toolCalls: [toolCall("query_traces", {}, "first")] }),
      )
      .mockResolvedValueOnce(
        completion({ toolCalls: [toolCall("query_traces", {}, "second")] }),
      )
      .mockResolvedValue(completion({ content: "Reviewed." }));

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    expect(runTelemetryToolMock).toHaveBeenCalledTimes(1);
    expect(toolNames(requests()[0])).toContain("query_traces");
    expect(toolNames(requests()[1])).not.toContain("query_traces");

    const refused: Array<LLMMessage> = toolMessages(requests()[2]!);
    expect(refused[refused.length - 1]!.content).toContain(
      "all 1 of its production telemetry calls",
    );
  });

  test("the calls made since the last completion count in the wind-down", async () => {
    getTelemetryToolsMock.mockResolvedValue(offer());
    runTelemetryToolMock.mockResolvedValue(telemetryResult(3));
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          // Four calls left - before the three queries below.
          budget: { completionCallsUsed: 36 },
          toolCalls: [
            toolCall("query_traces", {}, "a"),
            toolCall("find_production_exceptions", {}, "b"),
            toolCall("query_traces", {}, "c"),
          ],
        }),
      )
      .mockResolvedValue(completion({ content: "Summary." }));

    await runAgent(makeWorkspace(), { productionTelemetry: true });

    // 40 - 36 - 3 leaves one call: the final answer, with no tools.
    expect(requests()).toHaveLength(2);
    expect(requests()[1]!.tools).toBeUndefined();
  });
});
