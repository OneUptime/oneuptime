import CodeTaskSteps, {
  MAX_STEP_SUBJECT_LENGTH,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskSteps";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import { CodeTaskStepJSON } from "../../../../../Types/AI/CodeTask";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * A run's event trail, as the steps a person reads in a task's conversation:
 * "Read src/api/users.ts", "Ran npm test" - the lines the Runner's TaskLogger
 * writes ("[time] [INFO   ] [context] read src/api/users.ts"), with their tool
 * name, turned into plain steps. The fixtures below are the Runner's own
 * narrations (InHouseCodeAgent) in the logger's own format.
 */

let sequence: number = 0;

function line(
  message: string,
  options: { toolName?: string; severity?: string } = {},
): AIRunEvent {
  sequence++;
  const event: AIRunEvent = new AIRunEvent();
  event.sequence = sequence;
  event.eventType = AIRunEventType.ProgressLog;
  event.createdAt = new Date("2026-10-19T12:00:00.000Z");
  event.resultSummary = {
    message: `[2026-10-19 12:00:00] [${(options.severity || "info")
      .toUpperCase()
      .padEnd(7)}] [CodeRequest] ${message}`,
    severity: options.severity || "info",
  };
  if (options.toolName) {
    event.toolName = options.toolName;
  }
  return event;
}

function kinds(steps: Array<CodeTaskStepJSON>): Array<string> {
  return steps.map((step: CodeTaskStepJSON): string => {
    return `${step.kind}: ${step.subject}${step.isError ? " (error)" : ""}`;
  });
}

describe("CodeTaskSteps.fromEvents", () => {
  test("each tool call becomes a step in plain words", () => {
    const steps: Array<CodeTaskStepJSON> = CodeTaskSteps.fromEvents([
      line("read src/api/users.ts", { toolName: "read_file" }),
      line("wrote src/api/users.ts (1824 chars)", { toolName: "write_file" }),
      line("listed src/api", { toolName: "list_directory" }),
      line('searched files for "retryCount"', { toolName: "search_files" }),
      line("ran npm test -- users (exit 0)", { toolName: "run_command" }),
    ]);

    expect(kinds(steps)).toEqual([
      "Read: src/api/users.ts",
      "Edited: src/api/users.ts",
      "Listed: src/api",
      "Searched: retryCount",
      "Ran: npm test -- users",
    ]);
  });

  test("a refused or failed tool call is said as it happened, marked as an error", () => {
    const steps: Array<CodeTaskStepJSON> = CodeTaskSteps.fromEvents([
      line("refused run_command: rm -rf /", { toolName: "run_command" }),
      line("refused write_file src/big.bin: 9000000 chars exceeds the limit", {
        toolName: "write_file",
      }),
      line("read src/missing.ts failed: no such file", {
        toolName: "read_file",
        severity: "error",
      }),
    ]);

    expect(kinds(steps)).toEqual([
      "Note: refused run_command: rm -rf / (error)",
      "Note: refused write_file src/big.bin: 9000000 chars exceeds the limit (error)",
      "Read: src/missing.ts failed: no such file (error)",
    ]);
  });

  test("the plain copy of a tool line some recipes also write is dropped", () => {
    const steps: Array<CodeTaskStepJSON> = CodeTaskSteps.fromEvents([
      line("read src/a.ts", { toolName: "read_file" }),
      line("read src/a.ts"),
      line("Cloned the repository"),
    ]);

    expect(kinds(steps)).toEqual([
      "Read: src/a.ts",
      "Note: Cloned the repository",
    ]);
  });

  test("the pipeline's own bookkeeping lines are left out, its errors are not", () => {
    const steps: Array<CodeTaskStepJSON> = CodeTaskSteps.fromEvents([
      line("Starting: clone"),
      line("Starting tool loop"),
      line("Tool loop finished"),
      line("Cleaning up workspace"),
      line("Task completed"),
      line("Starting push failed: remote rejected", { severity: "error" }),
      line("Created branch oneuptime-task-42-1a2b3c4d"),
    ]);

    expect(kinds(steps)).toEqual([
      "Note: Starting push failed: remote rejected (error)",
      "Note: Created branch oneuptime-task-42-1a2b3c4d",
    ]);
  });

  test("the pull request a run opened is a step of its own", () => {
    const opened: AIRunEvent = new AIRunEvent();
    opened.sequence = 99;
    opened.eventType = AIRunEventType.ActionExecuted;
    opened.toolName = "open_pull_request";
    opened.resultSummary = {
      message: "Opened pull request #12: Add retries to the users API",
    };

    expect(kinds(CodeTaskSteps.fromEvents([opened]))).toEqual([
      "PullRequest: Opened pull request #12: Add retries to the users API",
    ]);
  });

  test("events that are not lines of work are not steps", () => {
    const llm: AIRunEvent = new AIRunEvent();
    llm.eventType = AIRunEventType.LlmCallCompleted;
    llm.resultSummary = { message: "called the model" };

    const empty: AIRunEvent = line("");

    expect(CodeTaskSteps.fromEvents([llm, empty])).toEqual([]);
  });

  test("a step keeps its order and time, and one long command is cut", () => {
    const command: string = `npm run ${"x".repeat(MAX_STEP_SUBJECT_LENGTH * 2)}`;
    const steps: Array<CodeTaskStepJSON> = CodeTaskSteps.fromEvents([
      line(`ran ${command} (exit 1)`, { toolName: "run_command" }),
    ]);

    expect(steps[0]!.subject).toHaveLength(MAX_STEP_SUBJECT_LENGTH);
    expect(steps[0]!.subject.endsWith("…")).toBe(true);
    expect(steps[0]!.createdAt).toBe("2026-10-19T12:00:00.000Z");
    expect(steps[0]!.sequence).toBeGreaterThan(0);
  });
});

describe("CodeTaskSteps.stripLogPrefix", () => {
  test.each([
    ["[2026-10-19 12:00:00] [INFO   ] [CodeRequest] read a.ts", "read a.ts"],
    ["[2026-10-19 12:00:00] [ERROR  ] push failed", "push failed"],
    ["read a.ts", "read a.ts"],
    ["[a] [b] [c] [d] [e] text", "[e] text"],
  ])("%j reads as %j", (raw: string, text: string) => {
    expect(CodeTaskSteps.stripLogPrefix(raw)).toBe(text);
  });

  test("a bracket that is not a short prefix is kept as written", () => {
    const long: string = `[${"x".repeat(200)}] text`;

    expect(CodeTaskSteps.stripLogPrefix(long)).toBe(long);
    expect(CodeTaskSteps.stripLogPrefix("[unclosed text")).toBe(
      "[unclosed text",
    );
  });

  test("takes time in line with a line's length, however it is built", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        CodeTaskSteps.stripLogPrefix(`${"[] ".repeat(140_000)}x`);
        CodeTaskSteps.stripLogPrefix(`[${"] [".repeat(140_000)}`);
        CodeTaskSteps.fromEvents([
          line(`ran ${" (".repeat(200_000)}`, { toolName: "run_command" }),
          line(`searched files for "${'"'.repeat(400_000)}`, {
            toolName: "search_files",
          }),
        ]);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
