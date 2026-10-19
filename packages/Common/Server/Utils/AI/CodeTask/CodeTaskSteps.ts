import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import {
  CodeTaskStepJSON,
  CodeTaskStepKind,
} from "../../../../Types/AI/CodeTask";

/*
 * A run's event trail, as the steps a person reads in a task's conversation.
 *
 * The code agent reports every tool call as a progress line - "[time]
 * [INFO   ] [Handler] read src/api/user.ts" - carrying the tool's name. Those
 * become steps in plain words: Read a file, Edited a file, Searched for a
 * pattern, Ran a command. The pull request a run opened is a step of its own.
 * The pipeline's other lines (cloned, created a branch, pushed) are kept as
 * notes, without their timestamp and severity prefix; the verbatim log is on
 * the task's Log page.
 *
 * Every string here was written by a Runner, and a tool's narration quotes
 * what the model chose (a path, a pattern, a command), so it is read with
 * indexOf and substring alone: nothing here runs a regular expression over
 * it.
 */

// The longest prefix group read off a line: "[2026-10-19 12:00:00]".
const MAX_PREFIX_GROUP_LENGTH: number = 120;

// Lines the pipeline writes for itself, not worth a step.
const NOISE_PREFIXES: Array<string> = [
  "Starting ",
  "Cleaning up workspace",
  "Task completed",
  "Initializing in-house code agent",
  "Starting tool loop",
  "Tool loop finished",
];

// A step's subject is cut here, so one long command cannot flood the page.
export const MAX_STEP_SUBJECT_LENGTH: number = 300;

export default class CodeTaskSteps {
  public static fromEvents(events: Array<AIRunEvent>): Array<CodeTaskStepJSON> {
    const steps: Array<CodeTaskStepJSON> = [];

    /*
     * Recipes that pass the agent's progress on to the log write each tool
     * call twice: once with its tool name, once as a plain line saying the
     * same. The plain copy is dropped.
     */
    let lastToolNarration: string | null = null;

    for (const event of events) {
      const step: CodeTaskStepJSON | null = CodeTaskSteps.fromEvent(event);

      if (!step) {
        continue;
      }

      const narration: string = CodeTaskSteps.stripLogPrefix(
        event.resultSummary?.message || "",
      );

      if (event.toolName) {
        lastToolNarration = narration;
      } else if (
        step.kind === CodeTaskStepKind.Note &&
        lastToolNarration !== null &&
        narration === lastToolNarration
      ) {
        continue;
      }

      steps.push(step);
    }

    return steps;
  }

  public static fromEvent(event: AIRunEvent): CodeTaskStepJSON | null {
    const sequence: number = event.sequence || 0;
    const createdAt: string | undefined = event.createdAt
      ? new Date(event.createdAt).toISOString()
      : undefined;

    if (
      event.eventType === AIRunEventType.ActionExecuted &&
      event.toolName === "open_pull_request"
    ) {
      return {
        sequence,
        kind: CodeTaskStepKind.PullRequest,
        subject: CodeTaskSteps.cut(event.resultSummary?.message || ""),
        isError: false,
        createdAt,
      };
    }

    if (event.eventType !== AIRunEventType.ProgressLog) {
      return null;
    }

    const message: string = CodeTaskSteps.stripLogPrefix(
      event.resultSummary?.message || "",
    );

    if (!message) {
      return null;
    }

    const severity: string = (
      event.resultSummary?.severity || ""
    ).toLowerCase();
    const isErrorLine: boolean = severity === "error";

    if (event.toolName) {
      return CodeTaskSteps.fromToolLine({
        toolName: event.toolName,
        narration: message,
        sequence,
        createdAt,
        isErrorLine,
      });
    }

    if (
      !isErrorLine &&
      NOISE_PREFIXES.some((prefix: string): boolean => {
        return message.startsWith(prefix);
      })
    ) {
      return null;
    }

    return {
      sequence,
      kind: CodeTaskStepKind.Note,
      subject: CodeTaskSteps.cut(message),
      isError: isErrorLine,
      createdAt,
    };
  }

  private static fromToolLine(data: {
    toolName: string;
    narration: string;
    sequence: number;
    createdAt: string | undefined;
    isErrorLine: boolean;
  }): CodeTaskStepJSON {
    const narration: string = data.narration;

    const step: (kind: CodeTaskStepKind, subject: string) => CodeTaskStepJSON =
      (kind: CodeTaskStepKind, subject: string): CodeTaskStepJSON => {
        return {
          sequence: data.sequence,
          kind,
          subject: CodeTaskSteps.cut(subject),
          isError: data.isErrorLine,
          createdAt: data.createdAt,
        };
      };

    switch (data.toolName) {
      case "read_file":
        if (narration.startsWith("read ")) {
          return step(CodeTaskStepKind.Read, narration.substring(5));
        }
        break;
      case "write_file":
        if (narration.startsWith("wrote ")) {
          return step(
            CodeTaskStepKind.Edited,
            CodeTaskSteps.beforeLastParenthesis(narration.substring(6)),
          );
        }
        break;
      case "list_directory":
        if (narration.startsWith("listed ")) {
          return step(CodeTaskStepKind.Listed, narration.substring(7));
        }
        break;
      case "search_files":
        if (narration.startsWith("searched files for ")) {
          return step(
            CodeTaskStepKind.Searched,
            CodeTaskSteps.unquote(narration.substring(19)),
          );
        }
        break;
      case "run_command":
        if (narration.startsWith("ran ")) {
          return step(
            CodeTaskStepKind.Ran,
            CodeTaskSteps.beforeLastParenthesis(narration.substring(4)),
          );
        }
        break;
      default:
        break;
    }

    // Refused, failed or unknown: the narration says what happened.
    return {
      sequence: data.sequence,
      kind: CodeTaskStepKind.Note,
      subject: CodeTaskSteps.cut(narration),
      isError:
        data.isErrorLine ||
        narration.startsWith("refused") ||
        narration.includes(" failed"),
      createdAt: data.createdAt,
    };
  }

  /*
   * A TaskLogger line without its "[time] [SEVERITY] [context] [agent] "
   * prefix - at most four bracketed groups, each short, read off the front.
   */
  public static stripLogPrefix(message: string): string {
    let text: string = message.trim();

    for (let group: number = 0; group < 4; group++) {
      if (!text.startsWith("[")) {
        break;
      }

      const end: number = text.indexOf("] ");

      if (end < 0 || end > MAX_PREFIX_GROUP_LENGTH) {
        break;
      }

      text = text.substring(end + 2).trimStart();
    }

    return text.trim();
  }

  // "src/x.ts (12 chars)" -> "src/x.ts"; "npm test (exit 0)" -> "npm test".
  private static beforeLastParenthesis(text: string): string {
    const index: number = text.lastIndexOf(" (");

    return (index > 0 ? text.substring(0, index) : text).trim();
  }

  private static unquote(text: string): string {
    const trimmed: string = text.trim();

    if (
      trimmed.length >= 2 &&
      trimmed.startsWith('"') &&
      trimmed.endsWith('"')
    ) {
      return trimmed.substring(1, trimmed.length - 1);
    }

    return trimmed;
  }

  private static cut(text: string): string {
    return text.length > MAX_STEP_SUBJECT_LENGTH
      ? `${text.substring(0, MAX_STEP_SUBJECT_LENGTH - 1)}…`
      : text;
  }
}
