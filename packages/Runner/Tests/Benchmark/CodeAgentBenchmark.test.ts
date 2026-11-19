/*
 * ---------------------------------------------------------------------------
 * The code agent benchmark's harness (issue #6531), driven by a scripted
 * model - no key, no credits. It runs the REAL agent on a task's
 * repository, through a server that calls the model directly and holds the
 * run to the limits the OneUptime server holds a real one to, then the
 * task's check, and writes one row: whether the check passed, how the run
 * ended (its answer, a loop stop, its time limit, an error), its rounds,
 * its tool calls by tool, its tokens and its time.
 * ---------------------------------------------------------------------------
 */

import CodeAgentBenchmark, {
  CodeAgentBenchmarkEnding,
  CodeAgentBenchmarkRow,
  CodeAgentBenchmarkSummary,
} from "../../Benchmark/CodeAgentBenchmark";
import CodeAgentBenchmarkServer, {
  CodeAgentBenchmarkModel,
  CodeAgentBenchmarkModelReply,
  CodeAgentBenchmarkModelRequest,
} from "../../Benchmark/CodeAgentBenchmarkServer";
import {
  CODE_AGENT_BENCHMARK_TASKS,
  CodeAgentBenchmarkShape,
  CodeAgentBenchmarkTask,
} from "../../Benchmark/CodeAgentBenchmarkTasks";
import { LlmCompletionResult } from "../../Utils/BackendAPI";
import { LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import LlmType from "Common/Types/LLM/LlmType";

jest.setTimeout(240000);

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

const MANY_FILES: CodeAgentBenchmarkTask = CODE_AGENT_BENCHMARK_TASKS.find(
  (task: CodeAgentBenchmarkTask): boolean => {
    return task.shape === CodeAgentBenchmarkShape.ManyFiles;
  },
)!;

let callId: number = 0;

function call(name: string, args: Record<string, unknown>): LLMToolCall {
  callId++;
  return {
    id: `call-${callId}`,
    name,
    arguments: args,
  } as unknown as LLMToolCall;
}

/*
 * A model that gives the scripted replies in turn, each said to read 1,000
 * prompt tokens and write 100, and keeps every request it was sent.
 */
function scripted(
  replies: Array<Partial<CodeAgentBenchmarkModelReply> | Error>,
  llmType: LlmType = LlmType.Anthropic,
): {
  model: CodeAgentBenchmarkModel;
  requests: Array<CodeAgentBenchmarkModelRequest>;
} {
  const requests: Array<CodeAgentBenchmarkModelRequest> = [];
  let index: number = 0;

  return {
    requests,
    model: {
      llmType,
      modelName: "claude-sonnet-4-5",
      call: async (
        request: CodeAgentBenchmarkModelRequest,
      ): Promise<CodeAgentBenchmarkModelReply> => {
        requests.push(request);
        const reply: Partial<CodeAgentBenchmarkModelReply> | Error =
          replies[Math.min(index, replies.length - 1)]!;
        index++;

        if (reply instanceof Error) {
          throw reply;
        }

        return {
          content: "",
          toolCalls: [],
          promptTokens: 1_000,
          completionTokens: 100,
          totalTokens: 1_100,
          ...reply,
        };
      },
    },
  };
}

// The four edits a person would make, as edit_file calls.
function renameEdits(): Array<LLMToolCall> {
  return [
    ["src/views/profile.js", "<h1>${user.fullName}</h1>"],
    ["src/views/header.js", "Signed in as ${user.fullName}"],
    ["src/email/welcome.js", "Welcome, ${user.fullName}!"],
    ["src/email/digest.js", "Your weekly digest, ${user.fullName}"],
  ].map((edit: Array<string>): LLMToolCall => {
    return call("edit_file", {
      path: edit[0],
      old_text: edit[1],
      new_text: edit[1]!.replace("fullName", "displayName"),
    });
  });
}

describe("a task the model fixes", () => {
  test("is a row that passed, ended by its answer, with its rounds, its tool calls by tool, its tokens and its time", async () => {
    const { model } = scripted([
      {
        toolCalls: [call("search_files", { pattern: "fullName", path: "src" })],
      },
      { toolCalls: renameEdits() },
      {
        content:
          "Renamed fullName to displayName in the profile, the header and both emails.",
      },
    ]);

    const row: CodeAgentBenchmarkRow = await CodeAgentBenchmark.runTask({
      task: MANY_FILES,
      model,
      timeLimitInMinutes: 30,
    });

    expect(row).toEqual({
      taskId: MANY_FILES.id,
      shape: CodeAgentBenchmarkShape.ManyFiles,
      passed: true,
      ending: CodeAgentBenchmarkEnding.Answer,
      rounds: 3,
      toolCalls: { search_files: 1, edit_file: 4 },
      promptTokens: 3_000,
      completionTokens: 300,
      totalTokens: 3_300,
      durationSeconds: expect.any(Number),
      checkDetail: "",
      error: null,
      summary:
        "Renamed fullName to displayName in the profile, the header and both emails.",
    });
  });
});

describe("a task the model does not fix", () => {
  test("is a row that failed, with what the check said", async () => {
    const { model } = scripted([{ content: "Nothing to change here." }]);

    const row: CodeAgentBenchmarkRow = await CodeAgentBenchmark.runTask({
      task: MANY_FILES,
      model,
      timeLimitInMinutes: 30,
    });

    expect(row.passed).toBe(false);
    expect(row.ending).toBe(CodeAgentBenchmarkEnding.Answer);
    expect(row.checkDetail).toContain("still reads fullName");
    expect(row.rounds).toBe(1);
    expect(row.toolCalls).toEqual({});
  });

  test("a model the provider refuses ends in an error, said in the row", async () => {
    const { model } = scripted([
      new Error("Anthropic API error: invalid x-api-key"),
    ]);

    const row: CodeAgentBenchmarkRow = await CodeAgentBenchmark.runTask({
      task: MANY_FILES,
      model,
      timeLimitInMinutes: 30,
    });

    expect(row.passed).toBe(false);
    expect(row.ending).toBe(CodeAgentBenchmarkEnding.Error);
    expect(row.error).toContain("invalid x-api-key");
  });
});

describe("the run's time limit", () => {
  test("a task that runs out of time answers with what it did, and its row says it ended at the time limit", async () => {
    let nowMs: number = Date.parse("2026-11-19T10:00:00.000Z");
    const { model, requests } = scripted([
      { toolCalls: [call("list_directory", { path: "." })] },
      { content: "Out of time: I listed the repository and changed nothing." },
    ]);

    const row: CodeAgentBenchmarkRow = await CodeAgentBenchmark.runTask({
      task: MANY_FILES,
      model: {
        ...model,
        call: async (
          request: CodeAgentBenchmarkModelRequest,
        ): Promise<CodeAgentBenchmarkModelReply> => {
          const reply: CodeAgentBenchmarkModelReply = await model.call(request);
          // The first call takes the run's whole time limit.
          nowMs += 31 * 60 * 1000;
          return reply;
        },
      },
      timeLimitInMinutes: 30,
      now: (): number => {
        return nowMs;
      },
    });

    expect(row.ending).toBe(CodeAgentBenchmarkEnding.TimeLimit);
    expect(row.passed).toBe(false);
    expect(row.rounds).toBe(2);
    expect(row.summary).toContain(
      "Out of time: I listed the repository and changed nothing.",
    );
    // Its last call was its answer: no tools offered.
    expect(requests[1]!.tools).toBeUndefined();
  });

  test("a run past its time is served only its answer, and nothing past the grace for it", async () => {
    let nowMs: number = Date.parse("2026-11-19T10:00:00.000Z");
    const { model, requests } = scripted([
      { toolCalls: [call("list_directory", { path: "." })] },
      { content: "Out of time: I listed the repository and changed nothing." },
    ]);
    const tickingModel: CodeAgentBenchmarkModel = {
      ...model,
      call: async (
        request: CodeAgentBenchmarkModelRequest,
      ): Promise<CodeAgentBenchmarkModelReply> => {
        const reply: CodeAgentBenchmarkModelReply = await model.call(request);
        // Each call takes the run's whole time limit.
        nowMs += 31 * 60 * 1000;
        return reply;
      },
    };
    const server: CodeAgentBenchmarkServer = new CodeAgentBenchmarkServer({
      model: tickingModel,
      timeLimitInMinutes: 30,
      now: (): number => {
        return nowMs;
      },
    });

    const first: LlmCompletionResult = await server.llmCompletion({
      taskId: "benchmark",
      messages: [{ role: "user", content: "Begin." }],
      tools: [
        {
          name: "list_directory",
          description: "Lists a directory.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    // The first call was made in time; it says no time is left now.
    expect(first.toolCalls).toHaveLength(1);
    expect(first.limits?.timeLeftMs).toBe(0);

    const answer: LlmCompletionResult = await server.llmCompletion({
      taskId: "benchmark",
      messages: [{ role: "user", content: "Answer now." }],
      tools: [
        {
          name: "list_directory",
          description: "Lists a directory.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    // Past its time, the call is served without tools: it can only answer.
    expect(requests[1]!.tools).toBeUndefined();
    expect(answer.toolCalls).toEqual([]);
    expect(server.usage.answeredAfterTimeLimit).toBe(true);

    // Past the grace for that answer, nothing more is served.
    nowMs += 6 * 60 * 1000;
    await expect(
      server.llmCompletion({
        taskId: "benchmark",
        messages: [{ role: "user", content: "More." }],
      }),
    ).rejects.toThrow("This run reached its time limit of 30 minutes.");
  });

  test("the agent's summary note of the time limit is read as that ending", () => {
    const server: CodeAgentBenchmarkServer = new CodeAgentBenchmarkServer({
      model: scripted([{ content: "x" }]).model,
      timeLimitInMinutes: 30,
    });
    const notes: Partial<Record<CodeAgentBenchmarkEnding, string>> =
      CodeAgentBenchmark.getStopNotes(server);

    expect(notes[CodeAgentBenchmarkEnding.TimeLimit]).toContain("30");
    expect(
      CodeAgentBenchmark.getEnding(
        {
          success: true,
          filesModified: [],
          logs: [],
          summary: `Listed the repository.\n\n${notes[CodeAgentBenchmarkEnding.TimeLimit]}`,
        },
        notes,
      ),
    ).toBe(CodeAgentBenchmarkEnding.TimeLimit);
    expect(
      CodeAgentBenchmark.getEnding(
        {
          success: true,
          filesModified: [],
          logs: [],
          summary: `Went round in circles.\n\n${notes[CodeAgentBenchmarkEnding.LoopStop]}`,
        },
        notes,
      ),
    ).toBe(CodeAgentBenchmarkEnding.LoopStop);
    expect(
      CodeAgentBenchmark.getEnding(
        { success: true, filesModified: [], logs: [], summary: "Done." },
        notes,
      ),
    ).toBe(CodeAgentBenchmarkEnding.Answer);
    expect(
      CodeAgentBenchmark.getEnding(
        { success: false, filesModified: [], logs: [], summary: "" },
        notes,
      ),
    ).toBe(CodeAgentBenchmarkEnding.Error);
  });
});

describe("what the server says with every answer", () => {
  test("the model's context window, the time limit per command, and what the run used", async () => {
    const server: CodeAgentBenchmarkServer = new CodeAgentBenchmarkServer({
      model: scripted([{ toolCalls: [call("read_file", { path: "a.js" })] }])
        .model,
      timeLimitInMinutes: 45,
      commandTimeLimitInMinutes: 30,
    });

    const answer: LlmCompletionResult = await server.llmCompletion({
      taskId: "benchmark",
      messages: [{ role: "user", content: "Begin." }],
      maxTokens: 50_000,
    });

    // A Claude model's window, as the OneUptime server would say it.
    expect(answer.contextWindowTokens).toBe(200_000);
    expect(answer.limits?.timeLimitInMinutes).toBe(45);
    expect(answer.limits?.commandTimeLimitInMinutes).toBe(30);
    expect(answer.limits?.modelCallsUsed).toBe(1);
    expect(answer.limits?.tokensUsed).toBe(1_100);
    expect(server.usage.toolCalls).toEqual({ read_file: 1 });
  });

  test("never asks the model to write more than the server's most", async () => {
    const { model, requests } = scripted([{ content: "Done." }]);
    const server: CodeAgentBenchmarkServer = new CodeAgentBenchmarkServer({
      model,
      timeLimitInMinutes: 30,
    });

    await server.llmCompletion({
      taskId: "benchmark",
      messages: [{ role: "user", content: "Begin." }],
      maxTokens: 50_000,
    });
    await server.llmCompletion({
      taskId: "benchmark",
      messages: [{ role: "user", content: "Begin." }],
      maxTokens: 8_000,
    });

    expect(requests[0]!.maxTokens).toBe(16_384);
    expect(requests[1]!.maxTokens).toBe(8_000);
  });

  test("an Ollama model's window is its num_ctx", async () => {
    const { model } = scripted([{ content: "Done." }], LlmType.Ollama);
    const server: CodeAgentBenchmarkServer = new CodeAgentBenchmarkServer({
      model: { ...model, additionalParams: { options: { num_ctx: 32_768 } } },
      timeLimitInMinutes: 30,
    });

    const answer: LlmCompletionResult = await server.llmCompletion({
      taskId: "benchmark",
      messages: [{ role: "user", content: "Begin." }],
    });

    expect(answer.contextWindowTokens).toBe(32_768);
  });
});

describe("the report", () => {
  const rows: Array<CodeAgentBenchmarkRow> = [
    {
      taskId: "rename-across-files",
      shape: CodeAgentBenchmarkShape.ManyFiles,
      passed: true,
      ending: CodeAgentBenchmarkEnding.Answer,
      rounds: 3,
      toolCalls: { edit_file: 4, search_files: 1 },
      promptTokens: 3_000,
      completionTokens: 300,
      totalTokens: 3_300,
      durationSeconds: 42,
      checkDetail: "",
      error: null,
      summary: "Renamed it.",
    },
    {
      taskId: "slow-suite-retry-bug",
      shape: CodeAgentBenchmarkShape.SlowTests,
      passed: false,
      ending: CodeAgentBenchmarkEnding.TimeLimit,
      rounds: 12,
      toolCalls: { run_command: 3, read_file: 5 },
      promptTokens: 90_000,
      completionTokens: 4_000,
      totalTokens: 94_000,
      durationSeconds: 1_830,
      checkDetail: "busy",
      error: null,
      summary: "Ran out of time.",
    },
  ];

  test("is a Markdown table, one row a task, the most-used tools first", () => {
    expect(CodeAgentBenchmark.formatTable(rows)).toEqual([
      "| Task | Shape | Check | Ended | Rounds | Tool calls | Tokens | Time |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| rename-across-files | A change across files | passed | answer | 3 | 5 (edit_file 4, search_files 1) | 3,300 | 42s |",
      "| slow-suite-retry-bug | A slow test suite | failed | time limit | 12 | 8 (read_file 5, run_command 3) | 94,000 | 30m 30s |",
    ]);
  });

  test("sums the tasks up", () => {
    const summary: CodeAgentBenchmarkSummary =
      CodeAgentBenchmark.summarize(rows);

    expect(summary).toEqual({
      taskCount: 2,
      passedCount: 1,
      endings: { answer: 1, "time limit": 1 },
      rounds: 15,
      toolCalls: 13,
      totalTokens: 97_300,
      durationSeconds: 1_872,
    });
  });
});
