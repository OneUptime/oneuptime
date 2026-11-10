import { JSONObject } from "Common/Types/JSON";
import ToolOutputStore from "./ToolOutputStore";

/*
 * One tool execution: the one-line narration for the activity feed, and the
 * verbatim output the model saw. Both are shipped to the run's trail - the
 * narration as the event message, the output onto the transcript the Logs
 * page reads - so a bad run can be debugged from what the model was actually
 * told, not just from a summary of it.
 *
 * A tool that fails says so with an output that starts with "Error": the
 * loop detector counts those as failures, and the model reads why.
 */
export interface ToolExecution {
  narration: string;
  output: string;
}

/*
 * What the agent's change is made of, for one task: the files the model
 * changed with the file tools (always part of the change, even when a later
 * command touches them), the files a command produced that the model never
 * wrote (build output, caches - left out of the change), and the files the
 * model has read or written, which write_file may replace whole.
 */
export class CodeAgentChangeSet {
  public readonly writtenPaths: Set<string> = new Set<string>();
  public readonly commandArtifactPaths: Set<string> = new Set<string>();
  private readonly seenPaths: Set<string> = new Set<string>();

  public markRead(relativePath: string): void {
    this.seenPaths.add(relativePath);
  }

  /*
   * The model changed this path itself: it is part of the change, and never
   * taken for a command's output.
   */
  public markWritten(relativePath: string): void {
    this.writtenPaths.add(relativePath);
    this.commandArtifactPaths.delete(relativePath);
    this.seenPaths.add(relativePath);
  }

  public hasSeen(relativePath: string): boolean {
    return this.seenPaths.has(relativePath);
  }

  public markCommandArtifact(relativePath: string): void {
    if (!this.writtenPaths.has(relativePath)) {
      this.commandArtifactPaths.add(relativePath);
    }
  }
}

// What every workspace tool works with: the repository, and the task's state.
export interface CodeAgentToolContext {
  workspaceRoot: string;
  changes: CodeAgentChangeSet;
  outputs: ToolOutputStore;
}

// A string argument, or undefined when the model sent none (or not a string).
export function readStringArgument(
  args: JSONObject,
  names: Array<string>,
): string | undefined {
  for (const name of names) {
    const value: unknown = args[name];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

/*
 * A whole-number argument: a number, or a number written as text ("120"),
 * the first of the names the model used. Undefined when there is none, or
 * it is not a whole number.
 */
export function readIntegerArgument(
  args: JSONObject,
  names: Array<string>,
): number | undefined {
  for (const name of names) {
    const value: unknown = args[name];

    if (value === undefined || value === null || value === "") {
      continue;
    }

    const parsed: number =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.trim())
          : NaN;

    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return undefined;
}

// A yes/no argument: true, or "true" written as text.
export function readBooleanArgument(
  args: JSONObject,
  names: Array<string>,
): boolean {
  for (const name of names) {
    const value: unknown = args[name];

    if (value === true) {
      return true;
    }

    if (typeof value === "string" && value.trim().toLowerCase() === "true") {
      return true;
    }
  }

  return false;
}

// "1 line", "2,055 lines": a count as the model reads it.
export function countOf(count: number, noun: string, plural?: string): string {
  return `${count.toLocaleString("en-US")} ${
    count === 1 ? noun : plural || `${noun}s`
  }`;
}
