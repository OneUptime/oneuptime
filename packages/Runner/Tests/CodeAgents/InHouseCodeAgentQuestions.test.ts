/*
 * A request from Code may end with the AI asking the person who made it a
 * question - the way Claude Code or Codex ask when they cannot go on - and
 * the task then waits for their answer. The in-house agent offers an
 * ask_question tool only when the task allows it; a question ends the turn
 * (nothing else the model asked for alongside it runs) and the result says
 * the turn needs input.
 */

import InHouseCodeAgent, {
  ASK_QUESTION_TOOL_NAME,
} from "../../CodeAgents/InHouseCodeAgent";
import { CodeAgentResult } from "../../CodeAgents/CodeAgentInterface";
import { LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const llmCompletionMock: jest.Mock = jest.fn();

jest.mock("../../Utils/BackendAPI", () => {
  return {
    __esModule: true,
    default: class {
      public async llmCompletion(...args: Array<unknown>): Promise<unknown> {
        return llmCompletionMock(...args);
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

const temporaryPaths: Array<string> = [];

function makeWorkspace(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-agent-questions-"),
  );
  temporaryPaths.push(dir);

  const run: (args: Array<string>) => void = (args: Array<string>): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };

  run(["init", "-q", "-b", "main", "."]);
  run(["config", "user.email", "tests@oneuptime.com"]);
  run(["config", "user.name", "Runner Tests"]);
  run(["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# app\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "baseline"]);

  return dir;
}

function toolCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return {
    id: `call-${name}`,
    name,
    arguments: args,
  } as unknown as LLMToolCall;
}

function completion(data: {
  content?: string;
  toolCalls?: Array<LLMToolCall>;
}): unknown {
  const toolCalls: Array<LLMToolCall> = data.toolCalls || [];

  return {
    content: data.content ?? "",
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
    budget: {
      completionCallsUsed: 1,
      maxCompletionCalls: 40,
      outputTokensUsed: 100,
      maxOutputTokens: 100_000,
    },
  };
}

async function runAgent(
  workspace: string,
  allowQuestions: boolean,
): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const result: CodeAgentResult = await agent.executeTask({
    workingDirectory: workspace,
    prompt: "Add a retry to the users API.",
    timeoutMs: 60_000,
    allowQuestions,
  });

  await agent.cleanup();

  return result;
}

function offeredToolNames(callIndex: number): Array<string> {
  const request: { tools?: Array<{ name: string }> } = llmCompletionMock.mock
    .calls[callIndex]![0] as { tools?: Array<{ name: string }> };

  return (request.tools || []).map((tool: { name: string }): string => {
    return tool.name;
  });
}

beforeEach(() => {
  llmCompletionMock.mockReset();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("asking the person a question", () => {
  test("is offered only when the task allows it", async () => {
    llmCompletionMock.mockResolvedValue(completion({ content: "Done." }));

    await runAgent(makeWorkspace(), true);
    expect(offeredToolNames(0)).toContain(ASK_QUESTION_TOOL_NAME);

    llmCompletionMock.mockClear();

    await runAgent(makeWorkspace(), false);
    expect(offeredToolNames(0)).not.toContain(ASK_QUESTION_TOOL_NAME);
  });

  test("ends the turn: the reply is the question, and the turn needs input", async () => {
    const workspace: string = makeWorkspace();

    llmCompletionMock.mockResolvedValueOnce(
      completion({
        content: "I found two retry helpers.",
        toolCalls: [
          toolCall(ASK_QUESTION_TOOL_NAME, {
            question: "  Should the retry use the shared backoff helper?  ",
          }),
          toolCall("write_file", { path: "src/x.ts", content: "nope" }),
        ],
      }),
    );

    const result: CodeAgentResult = await runAgent(workspace, true);

    expect(result.success).toBe(true);
    expect(result.needsInput).toBe(true);
    expect(result.summary).toBe(
      "I found two retry helpers.\n\nShould the retry use the shared backoff helper?",
    );
    // Nothing the model asked for alongside the question ran.
    expect(result.filesModified).toEqual([]);
    expect(fs.existsSync(path.join(workspace, "src", "x.ts"))).toBe(false);
    // And the loop stopped there.
    expect(llmCompletionMock).toHaveBeenCalledTimes(1);
  });

  test("an empty question is no question: the loop carries on", async () => {
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [toolCall(ASK_QUESTION_TOOL_NAME, { question: "   " })],
        }),
      )
      .mockResolvedValue(completion({ content: "Done without asking." }));

    const result: CodeAgentResult = await runAgent(makeWorkspace(), true);

    expect(result.needsInput).toBeUndefined();
    expect(result.summary).toBe("Done without asking.");
  });

  test("a task that does not allow questions never waits, whatever the model calls", async () => {
    llmCompletionMock
      .mockResolvedValueOnce(
        completion({
          toolCalls: [
            toolCall(ASK_QUESTION_TOOL_NAME, { question: "Which one?" }),
          ],
        }),
      )
      .mockResolvedValue(completion({ content: "Went ahead." }));

    const result: CodeAgentResult = await runAgent(makeWorkspace(), false);

    expect(result.needsInput).toBeUndefined();
    expect(result.summary).toBe("Went ahead.");
  });

  test("a very long question is cut", async () => {
    llmCompletionMock.mockResolvedValueOnce(
      completion({
        toolCalls: [
          toolCall(ASK_QUESTION_TOOL_NAME, { question: "q".repeat(10_000) }),
        ],
      }),
    );

    const result: CodeAgentResult = await runAgent(makeWorkspace(), true);

    expect(result.needsInput).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(4000);
  });
});
