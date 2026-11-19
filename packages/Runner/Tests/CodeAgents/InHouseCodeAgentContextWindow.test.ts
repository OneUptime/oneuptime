/*
 * ---------------------------------------------------------------------------
 * The code agent sizes its conversation to the model's context window
 * (issue #6530).
 *
 * Before: every task kept its conversation under 300,000 characters, about
 * 75,000 tokens, whatever the model. A model with a larger window had its
 * oldest results left out long before it needed to, so a long task read
 * again what it could have kept; a self-hosted model with a smaller one was
 * sent up to 300,000 characters and refused, and refused again, until
 * halving brought the conversation down to fit - one failed model call each
 * time.
 *
 * Now the server says, with every answer, how many tokens one request to
 * the model may hold, and the agent keeps the conversation inside that:
 * about three characters a token, less the room for the answer and for the
 * tool definitions, never under the floor, never past a ceiling. When the
 * server cannot tell, the default holds, and halving on a refusal stays -
 * also for a window the server got wrong.
 *
 * The REAL agent loop is driven by a scripted model against a real
 * repository; only the server is faked. The fake model refuses a request
 * larger than it holds, counted the way a provider would: the messages, the
 * tool definitions and the answer's room, at three characters a token.
 * ---------------------------------------------------------------------------
 */

import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";
import {
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import {
  CHARS_PER_TOKEN,
  MAX_ANSWER_TOKENS,
  MAX_CODE_AGENT_CONTEXT_CHARS,
} from "../../CodeAgents/CodeAgentContext";
import LlmCompletionError from "../../Utils/LlmCompletionError";
import {
  DEFAULT_MAX_CONTEXT_CHARS,
  measureContextChars,
} from "Common/Server/Utils/AI/Chat/AgentContextCompactor";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import logger from "Common/Server/Utils/Logger";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(180000);

const llmCompletionMock: jest.Mock = jest.fn();

jest.mock("../../Utils/BackendAPI", () => {
  return {
    __esModule: true,
    default: class {
      public async llmCompletion(...args: Array<unknown>): Promise<unknown> {
        return llmCompletionMock(...args);
      }

      public async updateTaskStatus(): Promise<void> {
        return undefined;
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

// The files the task reads, one a round: 12,000 characters each.
const FILE_COUNT: number = 36;
const LINES_PER_FILE: number = 150;

const LEFT_OUT_READ: RegExp = /^\[Earlier result of read_file /;

const temporaryPaths: Array<string> = [];

function makeRepository(): string {
  const dir: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-agent-window-")),
  );
  temporaryPaths.push(dir);

  const git: (args: Array<string>) => void = (args: Array<string>): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };

  git(["init", "-q", "-b", "main", "."]);
  git(["config", "user.email", "tests@oneuptime.com"]);
  git(["config", "user.name", "Runner Tests"]);
  git(["config", "commit.gpgsign", "false"]);

  fs.mkdirSync(path.join(dir, "src"));

  for (let file: number = 0; file < FILE_COUNT; file++) {
    const lines: Array<string> = [];

    for (let line: number = 0; line < LINES_PER_FILE; line++) {
      lines.push(
        `export const value_${file}_${line}: string = "${"v".repeat(40)}";`,
      );
    }

    fs.writeFileSync(
      path.join(dir, "src", `module${file}.ts`),
      `${lines.join("\n")}\n`,
    );
  }

  git(["add", "-A"]);
  git(["commit", "-q", "-m", "baseline"]);

  return dir;
}

// Each call as it was made: the agent goes on adding to the same messages.
interface ServerCall {
  chars: number;
  maxTokens: number | undefined;
  // The request, counted as a provider counts it: three characters a token.
  tokens: number;
  leftOut: number;
  refused: boolean;
}

interface FakeServer {
  calls: Array<ServerCall>;
  refusals: number;
}

/*
 * The model reads one file a round, then answers. The server says
 * `window` with every answer (null: it cannot tell), and the model refuses
 * a request larger than `holds` tokens - its real window, which the server
 * may have wrong.
 */
function serve(data: { window: number | null; holds: number }): FakeServer {
  const server: FakeServer = { calls: [], refusals: 0 };
  let round: number = 0;

  llmCompletionMock.mockReset();
  llmCompletionMock.mockImplementation(
    async (request: {
      messages: Array<LLMMessage>;
      tools?: Array<LLMToolDefinition>;
      maxTokens?: number;
    }): Promise<unknown> => {
      const tools: Array<LLMToolDefinition> = request.tools || [];
      const tokens: number =
        Math.ceil(
          (measureContextChars(request.messages) +
            JSON.stringify(tools).length) /
            CHARS_PER_TOKEN,
        ) + (request.maxTokens ?? MAX_ANSWER_TOKENS);
      const refused: boolean = tokens > data.holds;

      server.calls.push({
        chars: measureContextChars(request.messages),
        maxTokens: request.maxTokens,
        tokens,
        leftOut: request.messages.filter((message: LLMMessage): boolean => {
          return message.role === "tool" && LEFT_OUT_READ.test(message.content);
        }).length,
        refused,
      });

      if (refused) {
        server.refusals++;
        throw new LlmCompletionError({
          message: `This model's maximum context length is ${data.holds} tokens. However, you requested ${tokens} tokens. Please reduce the length of the messages.`,
          statusCode: 400,
        });
      }

      const toolCalls: Array<LLMToolCall> =
        round < FILE_COUNT
          ? [
              {
                id: `call-${round}`,
                name: "read_file",
                arguments: { path: `src/module${round}.ts` },
              } as unknown as LLMToolCall,
            ]
          : [];

      round++;

      return {
        content: toolCalls.length > 0 ? "" : "Read every module.",
        toolCalls,
        stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
        limits: null,
        budget: {
          completionCallsUsed: round,
          maxCompletionCalls: 100_000,
          outputTokensUsed: 100,
          maxOutputTokens: 1_000_000_000,
        },
        contextWindowTokens: data.window,
      };
    },
  );

  return server;
}

async function runTask(): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const task: CodeAgentTask = {
    workingDirectory: makeRepository(),
    prompt: "Read every module under src and say what they hold.",
  };

  const result: CodeAgentResult = await agent.executeTask(task);
  await agent.cleanup();

  return result;
}

function logLines(): Array<string> {
  return (logger.debug as jest.Mock).mock.calls.map(
    (args: Array<unknown>): string => {
      return String(args[0]);
    },
  );
}

beforeEach(() => {
  (logger.debug as jest.Mock).mockClear();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("a model with a 32,000-token window", () => {
  test("no call is larger than it holds, and no context-window error is needed to get there", async () => {
    const server: FakeServer = serve({ window: 32_000, holds: 32_000 });

    const result: CodeAgentResult = await runTask();

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Read every module.");
    // Every file was read: the task went on far past the window.
    expect(server.calls.length).toBe(FILE_COUNT + 1);
    expect(server.refusals).toBe(0);

    for (const call of server.calls) {
      expect(call.tokens).toBeLessThanOrEqual(32_000);
    }

    /*
     * From the second call on, the answer keeps a quarter of the window:
     * 16,384 tokens of room would leave the prompt too little.
     */
    expect(server.calls[0]!.maxTokens).toBeUndefined();
    for (const call of server.calls.slice(1)) {
      expect(call.maxTokens).toBe(8_000);
    }
  });

  test("the run's log says the window once, and what the conversation is kept under", async () => {
    serve({ window: 32_000, holds: 32_000 });

    await runTask();

    const said: Array<string> = logLines().filter((line: string): boolean => {
      return line.startsWith(
        "[InHouse] The model takes 32,000 tokens in one request: the conversation is kept under ",
      );
    });

    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/kept under [\d,]+ characters\.$/);
  });
});

describe("a model with a 1,000,000-token window", () => {
  test("a long task keeps more results whole than it does with the default", async () => {
    const large: FakeServer = serve({ window: 1_000_000, holds: 1_000_000 });

    expect((await runTask()).success).toBe(true);

    const withWindow: ServerCall = large.calls[large.calls.length - 1]!;

    const unknown: FakeServer = serve({ window: null, holds: 1_000_000 });

    expect((await runTask()).success).toBe(true);

    const withDefault: ServerCall = unknown.calls[unknown.calls.length - 1]!;

    // The default had to leave reads out; the large window kept them all.
    expect(withDefault.leftOut).toBeGreaterThan(0);
    expect(withWindow.leftOut).toBe(0);
    expect(withWindow.chars).toBeGreaterThan(DEFAULT_MAX_CONTEXT_CHARS);
    // Never past the ceiling, however large the window.
    for (const call of large.calls) {
      expect(call.chars).toBeLessThanOrEqual(MAX_CODE_AGENT_CONTEXT_CHARS);
      // Room for the answer is the server's own most: nothing is asked.
      expect(call.maxTokens).toBeUndefined();
    }
  });
});

describe("a server that cannot tell the window", () => {
  test("the default holds, as it does today: no call past 300,000 characters, and no answer cut shorter", async () => {
    const server: FakeServer = serve({ window: null, holds: 1_000_000 });

    expect((await runTask()).success).toBe(true);

    for (const call of server.calls) {
      expect(call.chars).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_CHARS);
      expect(call.maxTokens).toBeUndefined();
    }
    expect(
      logLines().some((line: string): boolean => {
        return line.includes("tokens in one request");
      }),
    ).toBe(false);
  });

  test("a model that refuses a long conversation is still met by halving, as it is today", async () => {
    const server: FakeServer = serve({ window: null, holds: 50_000 });

    const result: CodeAgentResult = await runTask();

    expect(result.success).toBe(true);
    expect(server.refusals).toBeGreaterThan(0);
    // Once halved, the task stays under what the model holds.
    const lastRefusal: number = server.calls
      .map((call: ServerCall): boolean => {
        return call.refused;
      })
      .lastIndexOf(true);

    for (const call of server.calls.slice(lastRefusal + 1)) {
      expect(call.tokens).toBeLessThanOrEqual(50_000);
    }
    expect(logLines()).toContain(
      "[InHouse] The model said the conversation was too long for its context window; trying again with less of it.",
    );
  });
});

describe("a window the server got wrong", () => {
  test("the halving still works, and the smaller size is kept though the server keeps saying the larger window", async () => {
    // The server says a million tokens; the model holds 40,000.
    const server: FakeServer = serve({ window: 1_000_000, holds: 40_000 });

    const result: CodeAgentResult = await runTask();

    expect(result.success).toBe(true);
    expect(server.refusals).toBeGreaterThan(0);

    const firstRefusal: number = server.calls.findIndex(
      (call: ServerCall): boolean => {
        return call.refused;
      },
    );
    const firstServedAfter: number = server.calls.findIndex(
      (call: ServerCall, index: number): boolean => {
        return index > firstRefusal && !call.refused;
      },
    );

    /*
     * Refused only while it learned the window - a few halvings in a row -
     * and never again after, though every answer still says a million.
     */
    expect(firstRefusal).toBeGreaterThan(-1);
    expect(firstServedAfter).toBeGreaterThan(firstRefusal);
    expect(server.refusals).toBe(firstServedAfter - firstRefusal);
    expect(server.refusals).toBeLessThanOrEqual(4);
    for (const call of server.calls.slice(firstServedAfter)) {
      expect(call.refused).toBe(false);
      expect(call.tokens).toBeLessThanOrEqual(40_000);
    }
  });
});
