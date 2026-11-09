/*
 * ---------------------------------------------------------------------------
 * The code agent doing whole changes, end to end (issue #6441).
 *
 * The customer's report: a code task made no change because "the read tool
 * truncates at ~20,000 characters" on a ~2,055-line file, and the tool
 * budget ran out. These drive the REAL agent, with a scripted model, through
 * the changes a coding agent makes every day, against a real repository on
 * disk - and assert on the repository and on what the pipeline stages:
 *
 *   - a fix deep in a 2,055-line file: found, read in place, edited;
 *   - a change across files: an edit, a new file, a deleted one, a moved one;
 *   - the repository's own tests run before and after the fix;
 *   - a long test run read whole, its failure found in the middle;
 *   - the same change on a global Runner, with the file tools alone.
 * ---------------------------------------------------------------------------
 */

import type InHouseCodeAgentType from "../../CodeAgents/InHouseCodeAgent";
import type {
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import type {
  LLMMessage,
  LLMToolCall,
} from "Common/Server/Utils/LLM/LLMService";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(120000);

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

interface CompletionRequest {
  messages: Array<LLMMessage>;
  tools?: Array<{ name: string }>;
}

/*
 * One scripted turn: the tool calls the model makes, chosen after reading
 * what it was shown so far (the tool results, newest last).
 */
type Turn = (shown: Array<string>) => Array<LLMToolCall> | string;

const temporaryPaths: Array<string> = [];

// The line number of a search hit in the service file.
const SEARCH_HIT_LINE: RegExp = /^src\/Service\.ts:(\d+):/;

// The id a shortened output gives, to read the rest of it by.
const OUTPUT_ID: RegExp = /read_tool_output with output_id "(out-\d+)"/;

function git(dir: string, args: Array<string>): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

function makeRepository(files: Record<string, string>): string {
  const dir: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-agent-e2e-")),
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

interface ScriptedModel {
  requests: Array<CompletionRequest>;
  /*
   * What a turn threw - an expectation about what the model was shown that
   * did not hold. The model then stops (it never throws into the agent,
   * which would take a failed call for an outage and wait to try again),
   * and the test fails on it after the run.
   */
  turnErrors: Array<unknown>;
}

/*
 * The model: each turn sees every tool result so far and answers with
 * tool calls, or with its summary (a string). Every request is kept, as
 * it was made.
 */
function scriptModel(turns: Array<Turn>): ScriptedModel {
  const requests: Array<CompletionRequest> = [];
  const turnErrors: Array<unknown> = [];
  let turn: number = 0;

  llmCompletionMock.mockReset();
  llmCompletionMock.mockImplementation((request: CompletionRequest) => {
    requests.push(JSON.parse(JSON.stringify(request)) as CompletionRequest);
    const shown: Array<string> = request.messages
      .filter((message: LLMMessage) => {
        return message.role === "tool";
      })
      .map((message: LLMMessage) => {
        return message.content;
      });
    let answer: Array<LLMToolCall> | string = "Done.";

    if (turn < turns.length && turnErrors.length === 0) {
      try {
        answer = turns[turn]!(shown);
      } catch (error) {
        turnErrors.push(error);
        answer = "Stopped: a scripted turn's expectation failed.";
      }
    }

    turn++;

    const toolCalls: Array<LLMToolCall> =
      typeof answer === "string" ? [] : answer;

    return Promise.resolve({
      content: typeof answer === "string" ? answer : "",
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
      budget: {
        completionCallsUsed: turn,
        maxCompletionCalls: 1000,
        outputTokensUsed: 100,
        maxOutputTokens: 10_000_000,
      },
    });
  });

  return { requests, turnErrors };
}

// Fails the test on the first expectation a scripted turn found broken.
function expectNoTurnErrors(model: ScriptedModel): void {
  if (model.turnErrors.length > 0) {
    throw model.turnErrors[0];
  }
}

/*
 * A fresh copy of the agent on a Runner the server called global or not
 * (GlobalRunnerMode, on the same copy of the modules).
 */
function loadAgent(isGlobalRunner: boolean): typeof InHouseCodeAgentType {
  jest.resetModules();

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  (
    require("../../Utils/GlobalRunnerMode") as {
      default: { setFromServer: (isGlobalRunner: boolean) => void };
    }
  ).default.setFromServer(isGlobalRunner);

  return (
    require("../../CodeAgents/InHouseCodeAgent") as {
      default: typeof InHouseCodeAgentType;
    }
  ).default;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
}

async function runAgent(
  workspace: string,
  options?: { isGlobalRunner?: boolean },
): Promise<CodeAgentResult> {
  const InHouseCodeAgent: typeof InHouseCodeAgentType = loadAgent(
    options?.isGlobalRunner === true,
  );
  const agent: InHouseCodeAgentType = new InHouseCodeAgent();
  await agent.initialize({ taskId: "run-1" });

  const task: CodeAgentTask = {
    workingDirectory: workspace,
    prompt: "Fix the bug the customer reported.",
    timeoutMs: 10 * 60_000,
  };

  const result: CodeAgentResult = await agent.executeTask(task);
  await agent.cleanup();
  return result;
}

// What the pipeline would commit: the reported files, staged as it stages them.
function stage(workspace: string, result: CodeAgentResult): string {
  git(workspace, ["add", "--all", "--", ...result.filesModified]);
  return git(workspace, ["diff", "--cached", "--name-status", "-M"]).trim();
}

function last(shown: Array<string>): string {
  return shown[shown.length - 1] || "";
}

// A service file of 2,055 lines, far past 20,000 characters, with one bug near its end.
function serviceSource(): string {
  const lines: Array<string> = [];

  for (let index: number = 1; index <= 2055; index++) {
    lines.push(
      index === 1900
        ? "  public applyDiscount(total: number): number { return total * 1.1; }"
        : `  public handler${index}(request: Request): Response { return this.respond(request, ${index}); }`,
    );
  }

  return `export default class Service {\n${lines.join("\n")}\n}\n`;
}

afterEach(() => {
  jest.resetModules();
});

afterAll(() => {
  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("a fix deep in a 2,055-line file (the customer's case)", () => {
  test("is found, read where it is, and changed - that one line, and nothing else", async () => {
    const source: string = serviceSource();
    const workspace: string = makeRepository({
      "src/Service.ts": source,
      "package.json": JSON.stringify({
        name: "shop",
        scripts: { test: "node test.js" },
      }),
    });

    expect(source.length).toBeGreaterThan(100_000);

    let foundLine: number = 0;
    const model: ScriptedModel = scriptModel([
      () => {
        return [
          call("search_files", { pattern: "applyDiscount\\(", glob: "*.ts" }),
        ];
      },
      (shown: Array<string>) => {
        // "src/Service.ts:1901:  public applyDiscount..." - the line the search found.
        foundLine = Number(SEARCH_HIT_LINE.exec(last(shown))![1]);
        return [
          call("read_file", {
            path: "src/Service.ts",
            start_line: foundLine - 2,
            end_line: foundLine + 2,
          }),
        ];
      },
      () => {
        return [
          call("edit_file", {
            path: "src/Service.ts",
            old_text: "return total * 1.1;",
            new_text: "return total * 0.9;",
          }),
        ];
      },
      () => {
        return [call("git", { action: "diff" })];
      },
      () => {
        return "Fixed applyDiscount: it multiplied by 1.1 instead of 0.9.";
      },
    ]);

    const result: CodeAgentResult = await runAgent(workspace);

    expectNoTurnErrors(model);

    expect(result.success).toBe(true);
    expect(foundLine).toBe(1901);
    expect(result.filesModified).toEqual(["src/Service.ts"]);
    expect(
      fs.readFileSync(path.join(workspace, "src", "Service.ts"), "utf-8"),
    ).toBe(source.replace("return total * 1.1;", "return total * 0.9;"));
    expect(git(workspace, ["diff", "--numstat"]).trim()).toBe(
      "1\t1\tsrc/Service.ts",
    );

    // What the model was shown at each step.
    const shownAtEnd: Array<string> = model.requests[
      model.requests.length - 1
    ]!.messages.filter((message: LLMMessage) => {
      return message.role === "tool";
    }).map((message: LLMMessage) => {
      return message.content;
    });
    expect(shownAtEnd[1]).toBe(
      [
        "  1899\t  public handler1898(request: Request): Response { return this.respond(request, 1898); }",
        "  1900\t  public handler1899(request: Request): Response { return this.respond(request, 1899); }",
        "  1901\t  public applyDiscount(total: number): number { return total * 1.1; }",
        "  1902\t  public handler1901(request: Request): Response { return this.respond(request, 1901); }",
        "  1903\t  public handler1902(request: Request): Response { return this.respond(request, 1902); }",
        "[src/Service.ts: lines 1899-1903 of 2057. Read on with start_line 1904.]",
      ].join("\n"),
    );
    expect(shownAtEnd[2]).toContain(
      "  1901\t  public applyDiscount(total: number): number { return total * 0.9; }",
    );
    expect(shownAtEnd[3]).toContain(
      "-  public applyDiscount(total: number): number { return total * 1.1; }",
    );
    expect(shownAtEnd[3]).toContain(
      "+  public applyDiscount(total: number): number { return total * 0.9; }",
    );

    // The repository at a glance was in the prompt from the start.
    const system: string = model.requests[0]!.messages[0]!.content;
    expect(system).toContain("## This repository at a glance");
    expect(system).toContain("  - test: node test.js");
    expect(system).toContain("- Change an existing file with edit_file");
  });
});

describe("a change across files", () => {
  test("an edit, a new file, a deleted file and a moved one are all staged - and nothing else", async () => {
    const workspace: string = makeRepository({
      "src/cart.ts":
        "import { legacyTotal } from './legacy';\nexport const total = legacyTotal;\n",
      "src/legacy.ts":
        "export const legacyTotal = (): number => { return 0; };\n",
      "src/helpers/format.ts":
        "export const format = (value: number): string => { return `${value}`; };\n",
    });

    const model: ScriptedModel = scriptModel([
      () => {
        return [
          call("update_plan", {
            plan: [
              { step: "Replace the legacy total", status: "in_progress" },
              { step: "Move the formatter", status: "pending" },
            ],
          }),
          call("write_file", {
            path: "src/total.ts",
            content:
              "export const computeTotal = (): number => { return 42; };\n",
          }),
          call("edit_file", {
            path: "src/cart.ts",
            edits: [
              {
                old_text: "import { legacyTotal } from './legacy';",
                new_text: "import { computeTotal } from './total';",
              },
              {
                old_text: "export const total = legacyTotal;",
                new_text: "export const total = computeTotal;",
              },
            ],
          }),
          call("delete_file", { path: "src/legacy.ts" }),
          call("move_file", {
            from: "src/helpers/format.ts",
            to: "src/format/format.ts",
          }),
        ];
      },
      (shown: Array<string>) => {
        expect(shown.slice(-5)).toEqual([
          "Plan updated:\n[>] Replace the legacy total\n[ ] Move the formatter",
          "Wrote 58 characters to src/total.ts (a new file).",
          expect.stringContaining("Edited src/cart.ts: 2 replacements."),
          "Deleted src/legacy.ts.",
          "Moved src/helpers/format.ts to src/format/format.ts.",
        ]);
        return [call("git", { action: "status" })];
      },
      () => {
        return "Replaced the legacy total and moved the formatter.";
      },
    ]);

    const result: CodeAgentResult = await runAgent(workspace);

    expectNoTurnErrors(model);

    expect(result.success).toBe(true);
    expect([...result.filesModified].sort()).toEqual([
      "src/cart.ts",
      "src/format/format.ts",
      "src/helpers/format.ts",
      "src/legacy.ts",
      "src/total.ts",
    ]);
    expect(stage(workspace, result).split("\n").sort()).toEqual([
      "A\tsrc/total.ts",
      "D\tsrc/legacy.ts",
      "M\tsrc/cart.ts",
      "R100\tsrc/helpers/format.ts\tsrc/format/format.ts",
    ]);
  });
});

describe("the repository's own tests", () => {
  const TEST_SCRIPT: string = [
    "const { discount } = require('./src/discount.js');",
    "const got = discount(100);",
    "if (got !== 90) {",
    "  console.log('FAIL discount(100): expected 90, got ' + got);",
    "  process.exitCode = 1;",
    "} else {",
    "  console.log('PASS discount');",
    "}",
    "",
  ].join("\n");

  test("fail before the fix and pass after it - the model sees both", async () => {
    const workspace: string = makeRepository({
      "src/discount.js":
        "exports.discount = (total) => { return total * 1.1; };\n",
      "test.js": TEST_SCRIPT,
    });

    const model: ScriptedModel = scriptModel([
      () => {
        return [call("run_command", { command: "node test.js" })];
      },
      (shown: Array<string>) => {
        expect(last(shown)).toBe(
          "Exit code: 1\nFAIL discount(100): expected 90, got 110.00000000000001",
        );
        return [
          call("edit_file", {
            path: "src/discount.js",
            old_text: "total * 1.1",
            new_text: "total * 0.9",
          }),
          call("run_command", { command: "node test.js" }),
        ];
      },
      (shown: Array<string>) => {
        expect(last(shown)).toBe("Exit code: 0\nPASS discount");
        return "Fixed the discount; node test.js passes.";
      },
    ]);

    const result: CodeAgentResult = await runAgent(workspace);

    expectNoTurnErrors(model);

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Fixed the discount; node test.js passes.");
    expect(result.filesModified).toEqual(["src/discount.js"]);
    expect(model.requests).toHaveLength(3);
  });

  test("a long test run shows its start and its end, and its middle is read with read_tool_output", async () => {
    const workspace: string = makeRepository({
      "noisy-test.js": [
        "for (let i = 1; i <= 6000; i++) {",
        "  console.log(i === 3000 ? 'FAIL checkout total rounds the wrong way' : 'ok test ' + i);",
        "}",
        "console.log('6000 tests, 1 failed');",
        // Not process.exit: node drops what is still queued for a pipe.
        "process.exitCode = 1;",
        "",
      ].join("\n"),
    });

    const model: ScriptedModel = scriptModel([
      () => {
        return [call("run_command", { command: "node noisy-test.js" })];
      },
      (shown: Array<string>) => {
        const output: string = last(shown);
        expect(output.startsWith("Exit code: 1\nok test 1\n")).toBe(true);
        // The end - the summary of the run - is always shown.
        expect(output.endsWith("ok test 6000\n6000 tests, 1 failed")).toBe(
          true,
        );
        expect(output).not.toContain("FAIL checkout");
        const id: string = OUTPUT_ID.exec(output)![1]!;
        return [call("read_tool_output", { output_id: id, pattern: "FAIL" })];
      },
      (shown: Array<string>) => {
        expect(last(shown)).toBe(
          [
            "  3000\tFAIL checkout total rounds the wrong way",
            "  6001\t6000 tests, 1 failed",
            '[2 lines of out-1 (run_command node noisy-test.js) hold "FAIL".]',
          ].join("\n"),
        );
        return "Found the failing test.";
      },
    ]);

    const result: CodeAgentResult = await runAgent(workspace);

    expectNoTurnErrors(model);

    expect(result.success).toBe(true);
  });
});

describe("on a global Runner", () => {
  test("the same change is made with the file tools alone; run_command is never offered nor run", async () => {
    const source: string = serviceSource();
    const workspace: string = makeRepository({ "src/Service.ts": source });

    const model: ScriptedModel = scriptModel([
      () => {
        return [
          call("search_files", { pattern: "total * 1.1", literal: true }),
          call("run_command", { command: "touch ran-on-a-global-runner" }),
        ];
      },
      (shown: Array<string>) => {
        expect(shown[shown.length - 1]).toContain(
          "Error: run_command is not available on this Runner.",
        );
        return [
          call("edit_file", {
            path: "src/Service.ts",
            old_text: "return total * 1.1;",
            new_text: "return total * 0.9;",
          }),
        ];
      },
      () => {
        return "Fixed it.";
      },
    ]);

    const result: CodeAgentResult = await runAgent(workspace, {
      isGlobalRunner: true,
    });

    expectNoTurnErrors(model);

    expect(result.success).toBe(true);
    expect(result.filesModified).toEqual(["src/Service.ts"]);
    expect(fs.existsSync(path.join(workspace, "ran-on-a-global-runner"))).toBe(
      false,
    );
    expect(
      model.requests[0]!.tools!.map((tool: { name: string }) => {
        return tool.name;
      }),
    ).toEqual([
      "read_file",
      "edit_file",
      "write_file",
      "delete_file",
      "move_file",
      "list_directory",
      "find_files",
      "search_files",
      "git",
      "read_tool_output",
      "update_plan",
    ]);
    expect(model.requests[0]!.messages[0]!.content).toContain(
      "- There is no command-running tool on this Runner",
    );
  });
});
