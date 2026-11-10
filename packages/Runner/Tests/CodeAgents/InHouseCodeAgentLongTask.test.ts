/*
 * ---------------------------------------------------------------------------
 * A long code task, end to end (issue #6441).
 *
 * Every tool result stays in the conversation the agent sends with each
 * model call, so a task that reads a lot would outgrow the model's context
 * window and fail. The agent keeps the conversation inside a size instead
 * (CodeAgentContext): the oldest results are left out first, then the
 * oldest rounds go into one note that keeps the task's plan and the files
 * it changed. These drive the REAL agent loop with a scripted model far
 * past that size, against a real repository, and check every model call it
 * makes:
 *
 *   - no call is larger than the size the conversation is kept under;
 *   - the system prompt and the request lead every call, unchanged;
 *   - every tool call is answered by exactly one result, right after it
 *     (the providers' contract), however much was left out;
 *   - a result left out is read again as progress, never taken for a loop,
 *     and one cut to fit, then left out, too;
 *   - a model that keeps repeating itself is still told to change course
 *     and then stopped, however often the conversation is cut;
 *   - once the oldest rounds are summarized, the plan and the files changed
 *     are still in front of the model - and the task finishes its change.
 * ---------------------------------------------------------------------------
 */

import InHouseCodeAgent from "../../CodeAgents/InHouseCodeAgent";
import {
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import { CONTEXT_DIGEST_PREFIX } from "../../CodeAgents/CodeAgentContext";
import {
  DEFAULT_MAX_CONTEXT_CHARS,
  measureContextChars,
} from "Common/Server/Utils/AI/Chat/AgentContextCompactor";
import { LLMMessage, LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
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

// The note a result left out leaves in its place, and the file it read.
const LEFT_OUT_READ: RegExp = /^\[Earlier result of read_file (\S+) left out/;

// The last line a read listed in a summary note read up to.
const LISTED_END_LINE: RegExp = / end_line (\d+) -> /;

// What the agent tells a model whose rounds show it nothing new.
const NUDGE_WORDS: string = "returned only results you had already seen";

// The run's log line for each time the conversation was cut.
const KEPT_INSIDE_LOG: string =
  "[InHouse] Kept the conversation inside the model's context window (";

const TOTAL_BEFORE: string =
  "export function total(sum: number): number {\n  return sum * 1.1;\n}\n";
const REPORT_BEFORE: string = "export const heading: string = 'Totla';\n";
const SUMMARY: string = "Fixed the total and the report.";

const temporaryPaths: Array<string> = [];

function git(dir: string, args: Array<string>): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

function makeRepository(files: Record<string, string>): string {
  const dir: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-agent-long-")),
  );
  temporaryPaths.push(dir);

  git(dir, ["init", "-q", "-b", "main", "."]);
  git(dir, ["config", "user.email", "tests@oneuptime.com"]);
  git(dir, ["config", "user.name", "Runner Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }

  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "baseline"]);

  return dir;
}

let callNumber: number = 0;

function call(name: string, args: Record<string, unknown>): LLMToolCall {
  callNumber++;
  return {
    id: `call-${callNumber}`,
    name,
    arguments: args,
  } as unknown as LLMToolCall;
}

function plan(statuses: [string, string, string]): LLMToolCall {
  return call("update_plan", {
    plan: [
      { step: "Fix the total", status: statuses[0] },
      { step: "Read the code it uses", status: statuses[1] },
      { step: "Fix the report", status: statuses[2] },
    ],
  });
}

function fixTheTotal(): LLMToolCall {
  return call("edit_file", {
    path: "src/total.ts",
    old_text: "return sum * 1.1;",
    new_text: "return sum;",
  });
}

function fixTheReport(): LLMToolCall {
  return call("edit_file", {
    path: "src/report.ts",
    old_text: "'Totla'",
    new_text: "'Total'",
  });
}

/*
 * What a provider refuses in a conversation: a tool result that answers no
 * call of the turn before it, a call answered never or twice, or another
 * message between a call and its result.
 */
function contractProblems(messages: Array<LLMMessage>): Array<string> {
  const problems: Array<string> = [];
  let answers: Map<string, number> = new Map<string, number>();
  let inRound: boolean = false;

  const closeRound: () => void = (): void => {
    for (const [id, count] of answers) {
      if (count !== 1) {
        problems.push(`call ${id} was answered ${count} times`);
      }
    }
  };

  messages.forEach((message: LLMMessage, index: number) => {
    if (message.role === "assistant") {
      closeRound();
      inRound = true;
      answers = new Map<string, number>(
        (message.toolCalls || []).map((toolCall: LLMToolCall) => {
          return [toolCall.id, 0];
        }),
      );
      return;
    }

    if (message.role === "tool") {
      const id: string = message.toolCallId || "";

      if (!inRound || !answers.has(id)) {
        problems.push(`the result at ${index} answers no call of its turn`);
        return;
      }

      answers.set(id, (answers.get(id) || 0) + 1);
      return;
    }

    if (
      Array.from(answers.values()).some((count: number) => {
        return count === 0;
      })
    ) {
      problems.push(
        `a ${message.role} message at ${index} comes before a call is answered`,
      );
    }
  });

  closeRound();
  return problems;
}

function copy(messages: Array<LLMMessage>): Array<LLMMessage> {
  return JSON.parse(JSON.stringify(messages)) as Array<LLMMessage>;
}

function digestsIn(messages: Array<LLMMessage>): Array<string> {
  return messages
    .filter((message: LLMMessage) => {
      return (
        message.role === "user" &&
        message.content.startsWith(CONTEXT_DIGEST_PREFIX)
      );
    })
    .map((message: LLMMessage) => {
      return message.content;
    });
}

// The files whose read_file results were left out of a conversation.
function leftOutReads(messages: Array<LLMMessage>): Array<string> {
  return messages
    .filter((message: LLMMessage) => {
      return message.role === "tool";
    })
    .map((message: LLMMessage) => {
      return LEFT_OUT_READ.exec(message.content)?.[1] || "";
    })
    .filter((file: string) => {
      return file.length > 0;
    });
}

// What every model call was, checked as it was made.
interface CallCheck {
  chars: number;
  problems: Array<string>;
  nudged: boolean;
  digests: number;
  leadsWithTheTask: boolean;
}

interface DrivenModel {
  checks: Array<CallCheck>;
  // The first call, and the last, as they were made.
  first: Array<LLMMessage> | null;
  last: Array<LLMMessage> | null;
  // What a scripted answer threw: the model then stops, and the test fails.
  errors: Array<unknown>;
}

/*
 * A model that decides each answer from the conversation it is sent - tool
 * calls, or its summary (a string) - and checks every call as it is made.
 * Only the first and the last conversation are kept whole: a long task
 * sends hundreds.
 */
function driveModel(
  decide: (
    messages: Array<LLMMessage>,
    callIndex: number,
  ) => Array<LLMToolCall> | string,
): DrivenModel {
  const model: DrivenModel = {
    checks: [],
    first: null,
    last: null,
    errors: [],
  };

  llmCompletionMock.mockReset();
  llmCompletionMock.mockImplementation(
    (request: { messages: Array<LLMMessage> }) => {
      const messages: Array<LLMMessage> = request.messages;
      const callIndex: number = model.checks.length;
      const first: Array<LLMMessage> = model.first || copy(messages);

      model.first = first;
      model.last = copy(messages);
      model.checks.push({
        chars: measureContextChars(messages),
        problems: contractProblems(messages),
        nudged: messages.some((message: LLMMessage) => {
          return (
            message.role === "user" && message.content.includes(NUDGE_WORDS)
          );
        }),
        digests: digestsIn(messages).length,
        leadsWithTheTask:
          messages[0]?.role === "system" &&
          messages[0]?.content === first[0]?.content &&
          messages[1]?.role === "user" &&
          messages[1]?.content === first[1]?.content,
      });

      let answer: Array<LLMToolCall> | string =
        "Stopped: a scripted answer failed.";

      if (model.errors.length === 0) {
        try {
          answer = decide(messages, callIndex);
        } catch (error) {
          model.errors.push(error);
        }
      }

      const toolCalls: Array<LLMToolCall> =
        typeof answer === "string" ? [] : answer;

      return Promise.resolve({
        content: typeof answer === "string" ? answer : "",
        toolCalls,
        stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
        budget: {
          completionCallsUsed: callIndex + 1,
          maxCompletionCalls: 100_000,
          outputTokensUsed: 100,
          maxOutputTokens: 1_000_000_000,
        },
      });
    },
  );

  return model;
}

function expectNoErrors(model: DrivenModel): void {
  if (model.errors.length > 0) {
    throw model.errors[0];
  }
}

async function runAgent(workspace: string): Promise<CodeAgentResult> {
  const agent: InHouseCodeAgent = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const task: CodeAgentTask = {
    workingDirectory: workspace,
    prompt: "Fix the total, and the report's heading.",
    timeoutMs: 30 * 60_000,
  };

  const result: CodeAgentResult = await agent.executeTask(task);
  await agent.cleanup();
  return result;
}

// The run's log lines that say the conversation was cut, and how.
function keptInsideLogLines(): Array<string> {
  return (logger.debug as jest.Mock).mock.calls
    .map((args: Array<unknown>) => {
      return String(args[0]);
    })
    .filter((line: string) => {
      return line.startsWith(KEPT_INSIDE_LOG);
    });
}

function expectTheChangeMade(workspace: string, result: CodeAgentResult): void {
  expect(result.success).toBe(true);
  expect(result.summary).toBe(SUMMARY);
  expect([...result.filesModified].sort()).toEqual([
    "src/report.ts",
    "src/total.ts",
  ]);
  expect(
    fs.readFileSync(path.join(workspace, "src", "total.ts"), "utf-8"),
  ).toBe(TOTAL_BEFORE.replace("return sum * 1.1;", "return sum;"));
  expect(
    fs.readFileSync(path.join(workspace, "src", "report.ts"), "utf-8"),
  ).toBe("export const heading: string = 'Total';\n");
}

beforeEach(() => {
  (logger.debug as jest.Mock).mockClear();
});

afterAll(() => {
  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("a task that reads far more than the conversation may hold", () => {
  const MODULES: number = 16;

  // A module whose whole read is about 47,000 characters.
  function moduleSource(index: number): string {
    const lines: Array<string> = [];

    for (let line: number = 1; line <= 520; line++) {
      lines.push(
        `export const module${index}Value${line}: string = "${"m".repeat(40)}${line}";`,
      );
    }

    return `${lines.join("\n")}\n`;
  }

  test("leaves the oldest results out, reads them again as progress, and finishes the change", async () => {
    const files: Record<string, string> = {
      "src/total.ts": TOTAL_BEFORE,
      "src/report.ts": REPORT_BEFORE,
    };

    for (let index: number = 1; index <= MODULES; index++) {
      files[`src/module${index}.ts`] = moduleSource(index);
    }

    const workspace: string = makeRepository(files);
    const progress: {
      modulesRead: number;
      // The results the model no longer had when it first noticed.
      firstLeftOut: Array<string> | null;
      readAgain: number;
      cutAgain: boolean;
      fixedTheReport: boolean;
    } = {
      modulesRead: 0,
      firstLeftOut: null,
      readAgain: 0,
      cutAgain: false,
      fixedTheReport: false,
    };

    const readNextModule: () => Array<LLMToolCall> = (): Array<LLMToolCall> => {
      progress.modulesRead++;

      if (progress.modulesRead > MODULES) {
        throw new Error("The conversation was not cut as often as expected.");
      }

      return [
        call("read_file", { path: `src/module${progress.modulesRead}.ts` }),
      ];
    };

    const model: DrivenModel = driveModel(
      (messages: Array<LLMMessage>, callIndex: number) => {
        if (callIndex === 0) {
          return [plan(["in_progress", "pending", "pending"])];
        }

        if (callIndex === 1) {
          return [fixTheTotal(), plan(["done", "in_progress", "pending"])];
        }

        const leftOut: Array<string> = leftOutReads(messages);

        // 1. Read on until the oldest results are left out.
        if (progress.firstLeftOut === null) {
          if (leftOut.length === 0) {
            return readNextModule();
          }

          progress.firstLeftOut = leftOut;
        }

        // 2. Read each of them again: the same call, the same answer.
        if (progress.readAgain < progress.firstLeftOut.length) {
          progress.readAgain++;
          return [
            call("read_file", {
              path: progress.firstLeftOut[progress.readAgain - 1],
            }),
          ];
        }

        // 3. Read on until the conversation is cut once more.
        if (!progress.cutAgain) {
          if (new Set<string>(leftOut).size <= progress.firstLeftOut.length) {
            return readNextModule();
          }

          progress.cutAgain = true;
        }

        if (!progress.fixedTheReport) {
          progress.fixedTheReport = true;
          return [fixTheReport(), plan(["done", "done", "done"])];
        }

        return SUMMARY;
      },
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expectNoErrors(model);

    // The change is whole, and the task was never stopped for a loop.
    expectTheChangeMade(workspace, result);

    // The oldest reads went first - three at least, read again after.
    const firstLeftOut: Array<string> = progress.firstLeftOut!;
    expect(firstLeftOut.length).toBeGreaterThanOrEqual(3);
    expect(firstLeftOut).toEqual(
      Array.from(
        { length: firstLeftOut.length },
        (_: unknown, index: number) => {
          return `src/module${index + 1}.ts`;
        },
      ),
    );
    expect(progress.readAgain).toBe(firstLeftOut.length);
    expect(progress.cutAgain).toBe(true);

    /*
     * Every call, as it was made: inside the size, the task first, the
     * contract kept, nothing summarized (leaving results out was enough),
     * and the model never told it was going in circles.
     */
    for (const check of model.checks) {
      expect(check).toEqual({
        chars: expect.any(Number),
        problems: [],
        nudged: false,
        digests: 0,
        leadsWithTheTask: true,
      });
      expect(check.chars).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_CHARS);
    }

    // What the model was given in all is far past what one call holds.
    const reads: number = progress.modulesRead + progress.readAgain;
    expect(reads * 45_000).toBeGreaterThan(DEFAULT_MAX_CONTEXT_CHARS);

    // The run's log says each time what was left out.
    const logLines: Array<string> = keptInsideLogLines();
    expect(logLines.length).toBeGreaterThanOrEqual(2);
    expect(logLines[0]).toMatch(
      /^\[InHouse\] Kept the conversation inside the model's context window \([\d,]+ to [\d,]+ characters\): \d+ earlier tool result\(s\) left out\.$/,
    );

    // At the end the model still had the plan and both edits, as it made them.
    const lastCalls: Array<LLMToolCall> = model.last!.flatMap(
      (message: LLMMessage) => {
        return message.toolCalls || [];
      },
    );
    expect(
      lastCalls
        .filter((toolCall: LLMToolCall) => {
          return toolCall.name === "edit_file";
        })
        .map((toolCall: LLMToolCall) => {
          return toolCall.arguments;
        }),
    ).toEqual([
      {
        path: "src/total.ts",
        old_text: "return sum * 1.1;",
        new_text: "return sum;",
      },
      { path: "src/report.ts", old_text: "'Totla'", new_text: "'Total'" },
    ]);
    expect(
      lastCalls.filter((toolCall: LLMToolCall) => {
        return toolCall.name === "update_plan";
      }),
    ).toHaveLength(3);

    // A result left out says what it was, and how to get it back.
    const note: LLMMessage | undefined = model.last!.find(
      (message: LLMMessage) => {
        return (
          message.role === "tool" &&
          message.content.startsWith(
            `[Earlier result of read_file src/module${
              firstLeftOut.length + 1
            }.ts left out`,
          )
        );
      },
    );
    expect(note?.content).toMatch(
      /^\[Earlier result of read_file src\/module\d+\.ts left out to keep this task within the model's context window: it was [\d,]+ characters, beginning "1\\texport const module\d+Value1: string = \\"m+1\\";"\. Run the tool again if you need it\.\]$/,
    );
  });
});

describe("a task of many hundreds of rounds", () => {
  // A catalog read four lines at a time: no one result is long enough to leave out.
  function catalogSource(): string {
    const lines: Array<string> = [];

    for (let line: number = 1; line <= 6000; line++) {
      const number: string = String(line).padStart(4, "0");
      lines.push(
        `export const item${number}: Item = { sku: "SKU-${number}", price: ${line} };`,
      );
    }

    return `${lines.join("\n")}\n`;
  }

  test("summarizes its oldest rounds into one note that keeps the plan and the files changed - and goes on", async () => {
    const workspace: string = makeRepository({
      "src/total.ts": TOTAL_BEFORE,
      "src/report.ts": REPORT_BEFORE,
      "src/catalog.ts": catalogSource(),
    });

    const progress: {
      windowsRead: number;
      // The note as the model first saw it, and as it saw it after the next cut.
      firstDigest: string | null;
      laterDigest: string | null;
      afterFirstDigest: Array<LLMMessage> | null;
      fixedTheReport: boolean;
    } = {
      windowsRead: 0,
      firstDigest: null,
      laterDigest: null,
      afterFirstDigest: null,
      fixedTheReport: false,
    };

    const readNextWindow: () => Array<LLMToolCall> = (): Array<LLMToolCall> => {
      progress.windowsRead++;

      if (progress.windowsRead > 1400) {
        throw new Error("The oldest rounds were not summarized as expected.");
      }

      return [
        call("read_file", {
          path: "src/catalog.ts",
          start_line: progress.windowsRead * 4 - 3,
          end_line: progress.windowsRead * 4,
        }),
      ];
    };

    const model: DrivenModel = driveModel(
      (messages: Array<LLMMessage>, callIndex: number) => {
        if (callIndex === 0) {
          return [plan(["in_progress", "pending", "pending"])];
        }

        if (callIndex === 1) {
          return [fixTheTotal(), plan(["done", "in_progress", "pending"])];
        }

        const digests: Array<string> = digestsIn(messages);

        // 1. Read on until the oldest rounds are summarized.
        if (progress.firstDigest === null) {
          if (digests.length === 0) {
            return readNextWindow();
          }

          progress.firstDigest = digests[0]!;
          progress.afterFirstDigest = copy(messages);
        }

        // 2. Read on until they are summarized once more.
        if (progress.laterDigest === null) {
          if (digests[0] === progress.firstDigest) {
            return readNextWindow();
          }

          progress.laterDigest = digests[0]!;
        }

        if (!progress.fixedTheReport) {
          progress.fixedTheReport = true;
          return [fixTheReport(), plan(["done", "done", "done"])];
        }

        return SUMMARY;
      },
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expectNoErrors(model);

    expectTheChangeMade(workspace, result);

    // Hundreds of rounds: every call inside the size, the contract kept.
    expect(progress.windowsRead).toBeGreaterThan(500);
    for (const check of model.checks) {
      expect(check.problems).toEqual([]);
      expect(check.nudged).toBe(false);
      expect(check.leadsWithTheTask).toBe(true);
      expect(check.digests).toBeLessThanOrEqual(1);
      expect(check.chars).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_CHARS);
    }

    const firstDigest: string = progress.firstDigest!;
    const laterDigest: string = progress.laterDigest!;
    const afterFirstDigest: Array<LLMMessage> = progress.afterFirstDigest!;

    // The note comes right after the request, and a whole round after it.
    expect(afterFirstDigest[2]!.content).toBe(firstDigest);
    expect(afterFirstDigest[3]!.role).toBe("assistant");

    // The first rounds - the plan, the edit - are gone from the conversation...
    expect(
      afterFirstDigest.some((message: LLMMessage) => {
        return (message.toolCalls || []).some((toolCall: LLMToolCall) => {
          return (
            toolCall.name === "edit_file" || toolCall.name === "update_plan"
          );
        });
      }),
    ).toBe(false);

    // ...and the note keeps them: the files changed, the plan as it stands.
    for (const digest of [firstDigest, laterDigest]) {
      expect(digest).toContain("Files you have changed so far: src/total.ts");
      expect(digest).toContain(
        "Your plan as it stands:\n[x] Fix the total\n[>] Read the code it uses\n[ ] Fix the report",
      );
      // What the rounds did, newest last, as many as the note holds.
      expect(digest).toMatch(
        /\n- read_file src\/catalog\.ts start_line \d+ end_line \d+ -> \d+\texport const item\d+: Item/,
      );
      expect(digest).toMatch(/\n\(\d+ earlier lines not listed\)\n/);
      expect(
        digest.endsWith(
          "Go on from where you are. Files may have changed since you read them: read again what you need.]",
        ),
      ).toBe(true);
      expect(digest.length).toBeLessThan(20_000);
    }

    // The later note goes on past where the first one ended.
    const lastListedLine: (digest: string) => number = (
      digest: string,
    ): number => {
      const listed: Array<string> = digest
        .split("\n")
        .filter((line: string) => {
          return line.startsWith("- read_file");
        });

      return Number(LISTED_END_LINE.exec(listed[listed.length - 1] || "")?.[1]);
    };
    expect(lastListedLine(laterDigest)).toBeGreaterThan(
      lastListedLine(firstDigest),
    );

    const logLines: Array<string> = keptInsideLogLines();
    expect(logLines.length).toBeGreaterThanOrEqual(2);
    expect(logLines[0]).toMatch(/: \d+ earlier round\(s\) summarized\.$/);
  });
});

describe("a task whose conversation is cut every round or two", () => {
  // A file whose whole read is about 47,000 characters.
  function largeSource(index: number): string {
    const lines: Array<string> = [];

    for (let line: number = 1; line <= 520; line++) {
      lines.push(
        `export const large${index}Value${line}: string = "${"l".repeat(40)}${line}";`,
      );
    }

    return `${lines.join("\n")}\n`;
  }

  function largeFiles(count: number): Record<string, string> {
    const files: Record<string, string> = {
      "src/total.ts": TOTAL_BEFORE,
      "src/report.ts": REPORT_BEFORE,
    };

    for (let index: number = 1; index <= count; index++) {
      files[`src/large${index}.ts`] = largeSource(index);
    }

    return files;
  }

  // One round's calls: read each of these large files.
  function readLarge(indexes: Array<number>): Array<LLMToolCall> {
    return indexes.map((index: number) => {
      return call("read_file", { path: `src/large${index}.ts` });
    });
  }

  // The result in a conversation of the read of one large file, if any.
  function largeResult(
    messages: Array<LLMMessage>,
    index: number,
  ): string | undefined {
    const ids: Set<string> = new Set<string>();

    for (const message of messages) {
      for (const toolCall of message.toolCalls || []) {
        if (
          toolCall.name === "read_file" &&
          (toolCall.arguments as Record<string, unknown>)["path"] ===
            `src/large${index}.ts`
        ) {
          ids.add(toolCall.id);
        }
      }
    }

    return messages.find((message: LLMMessage) => {
      return message.role === "tool" && ids.has(message.toolCallId || "");
    })?.content;
  }

  /*
   * Every round reads the same five large files and gets the same five
   * answers, so the conversation passes its size every round and is cut
   * each time. Cutting it is no reason to forget what the model still has
   * in front of it: the repeats are still a circle - the model is told to
   * change course, then stopped, not left to run until its time is up.
   */
  test("a model that keeps repeating itself is told to change course and then stopped, however often it is cut", async () => {
    const workspace: string = makeRepository(largeFiles(5));
    const sent: Array<{
      chars: number;
      problems: Array<string>;
      nudged: boolean;
      withTools: boolean;
    }> = [];

    llmCompletionMock.mockReset();
    llmCompletionMock.mockImplementation(
      (request: { messages: Array<LLMMessage>; tools?: unknown }) => {
        const withTools: boolean = "tools" in request;

        sent.push({
          chars: measureContextChars(request.messages),
          problems: contractProblems(request.messages),
          nudged: request.messages.some((message: LLMMessage) => {
            return (
              message.role === "user" && message.content.includes(NUDGE_WORDS)
            );
          }),
          withTools,
        });

        // Past twenty calls the run was never stopped: it answers so.
        const toolCalls: Array<LLMToolCall> =
          withTools && sent.length <= 20 ? readLarge([1, 2, 3, 4, 5]) : [];

        return Promise.resolve({
          content:
            toolCalls.length > 0
              ? ""
              : withTools
                ? "Never stopped."
                : "Stopped going in circles.",
          toolCalls,
          stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
          budget: {
            completionCallsUsed: sent.length,
            maxCompletionCalls: 100_000,
            outputTokensUsed: 100,
            maxOutputTokens: 1_000_000_000,
          },
        });
      },
    );

    const result: CodeAgentResult = await runAgent(workspace);

    // One round that showed something, five that showed nothing new, the answer.
    expect(
      sent.map((check: { withTools: boolean }) => {
        return check.withTools;
      }),
    ).toEqual([true, true, true, true, true, true, false]);
    expect(result.success).toBe(true);
    expect(result.summary).toBe(
      "Stopped going in circles.\n\n_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
    expect(result.filesModified).toEqual([]);

    // Told to change course after three rounds that showed nothing new.
    expect(
      sent.map((check: { nudged: boolean }) => {
        return check.nudged;
      }),
    ).toEqual([false, false, false, false, true, true, true]);

    // Cut before every call from the third - each call inside the size.
    expect(keptInsideLogLines().length).toBeGreaterThanOrEqual(5);
    for (const check of sent) {
      expect(check.problems).toEqual([]);
      expect(check.chars).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_CHARS);
    }
  });

  /*
   * Reads cut to their start and end to fit, then left out as newer reads
   * came: the model has none of them any more, so reading them again - one
   * a round, as a model getting back what it lost does - is progress, not a
   * circle.
   */
  test("reading again results that were cut, then left out, is progress", async () => {
    const workspace: string = makeRepository(largeFiles(20));
    const progress: {
      // The first reads as the model had them before reading them again.
      cutFirst: Array<string> | null;
      leftOut: Array<string> | null;
      readAgain: number;
    } = { cutFirst: null, leftOut: null, readAgain: 0 };

    const model: DrivenModel = driveModel(
      (messages: Array<LLMMessage>, callIndex: number) => {
        // 1. Read twenty large files, five a round.
        if (callIndex < 4) {
          if (callIndex === 2) {
            progress.cutFirst = [1, 2, 3, 4, 5].map((index: number) => {
              return largeResult(messages, index) || "";
            });
          }

          return readLarge(
            [1, 2, 3, 4, 5].map((index: number) => {
              return callIndex * 5 + index;
            }),
          );
        }

        if (callIndex === 4) {
          progress.leftOut = [1, 2, 3, 4, 5].map((index: number) => {
            return largeResult(messages, index) ?? "gone with its round";
          });
        }

        // 2. Read the first five again, one a round.
        if (progress.readAgain < 5) {
          progress.readAgain++;
          return readLarge([progress.readAgain]);
        }

        return "Read what I needed.";
      },
    );

    const result: CodeAgentResult = await runAgent(workspace);

    expectNoErrors(model);

    // The first reads were cut to fit, then left out - or gone with their round.
    for (const content of progress.cutFirst!) {
      expect(content).toContain(
        "characters of this result left out to keep this task within the model's context window",
      );
    }
    expect(progress.leftOut).toEqual(
      [1, 2, 3, 4, 5].map((index: number) => {
        return expect.stringMatching(
          new RegExp(
            `^(gone with its round|\\[Earlier result of read_file src/large${index}\\.ts left out)`,
          ),
        );
      }),
    );

    // Each read again was progress: never told to change course, never stopped.
    expect(progress.readAgain).toBe(5);
    expect(result.success).toBe(true);
    expect(result.summary).toBe("Read what I needed.");
    for (const check of model.checks) {
      expect(check.nudged).toBe(false);
      expect(check.problems).toEqual([]);
      expect(check.chars).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_CHARS);
    }
    expect(model.checks).toHaveLength(10);
  });
});
