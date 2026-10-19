import AIRunStatus from "./AIRunStatus";
import BadDataException from "../Exception/BadDataException";
import ObjectID from "../ObjectID";

/*
 * Code: where people ask OneUptime AI to work in their repositories, the way
 * they would ask Claude Code or Codex. A repository holds tasks; a task is a
 * conversation of turns, and every turn is one code-fix run (AIRun) - the
 * task itself is its first run, and each reply is a run whose codeTaskId
 * names that first run.
 *
 * These are the wire shapes the server, the Dashboard and the Runner share:
 * what a person adds to a request (CodeTaskContextInput), what is kept of it
 * on the run (CodeTaskContextItem, inside AIRun.taskContext.request), what a
 * run reports when it finishes (CodeTaskOutcome, CodeTaskChanges) and how a
 * task's state is read from its latest run (CodeTaskStateUtil).
 */

// What a person can add to a request, beside their own words.
export enum CodeTaskContextType {
  // Text they paste: an error, a spec, a log line.
  Note = "Note",
  // A web address, given to the AI as a reference.
  Link = "Link",
  // A file or folder in the repository, which the AI reads first.
  File = "File",
  // OneUptime records, read when the request is sent.
  Incident = "Incident",
  Alert = "Alert",
  Exception = "Exception",
  Monitor = "Monitor",
  Trace = "Trace",
  // The latest log lines matching a search.
  Logs = "Logs",
}

// The context types that name a OneUptime record by its id.
export const CODE_TASK_RECORD_CONTEXT_TYPES: Array<CodeTaskContextType> = [
  CodeTaskContextType.Incident,
  CodeTaskContextType.Alert,
  CodeTaskContextType.Exception,
  CodeTaskContextType.Monitor,
];

export const CODE_TASK_LIMITS: {
  // A request or a reply, as typed.
  maxMessageLength: number;
  maxContextItems: number;
  maxNoteLength: number;
  maxLinkLength: number;
  maxLinkTitleLength: number;
  maxPathLength: number;
  maxLogSearchLength: number;
  // What one record, trace or log search adds to the AI's prompt.
  maxSnapshotLength: number;
  // A task's title, cut from the first line of its request.
  maxTitleLength: number;
} = {
  maxMessageLength: 10000,
  maxContextItems: 10,
  maxNoteLength: 4000,
  maxLinkLength: 2000,
  maxLinkTitleLength: 200,
  maxPathLength: 500,
  maxLogSearchLength: 200,
  maxSnapshotLength: 8000,
  maxTitleLength: 120,
};

// How far back a Logs context looks, in hours: the last hour, day or week.
export const CODE_TASK_LOG_WINDOWS_IN_HOURS: Array<number> = [1, 24, 168];

export const DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS: number = 24;

// One piece of context as the Dashboard sends it.
export interface CodeTaskContextInput {
  type: CodeTaskContextType;
  // Note: the text.
  text?: string | undefined;
  // Link: the address, and what to call it.
  url?: string | undefined;
  title?: string | undefined;
  // File: a path in the repository.
  path?: string | undefined;
  // Incident, Alert, Exception, Monitor: the record's id.
  id?: string | undefined;
  // Trace: its id.
  traceId?: string | undefined;
  // Logs: what to search for, in which service (optional) and how far back.
  search?: string | undefined;
  serviceId?: string | undefined;
  hours?: number | undefined;
}

/*
 * One piece of context as the run keeps it: what the conversation shows
 * (label, and the record, address or path it names) and, for anything read
 * from OneUptime, the snapshot the AI was given - redacted, and taken when
 * the request was sent, because telemetry expires and records change.
 */
export interface CodeTaskContextItem {
  type: CodeTaskContextType;
  label: string;
  recordId?: string | undefined;
  url?: string | undefined;
  path?: string | undefined;
  text?: string | undefined;
  traceId?: string | undefined;
  search?: string | undefined;
  serviceId?: string | undefined;
  hours?: number | undefined;
  snapshot?: string | undefined;
}

// What a person asked in one turn: AIRun.taskContext.request.
export interface CodeTaskRequest {
  // As typed. The AI is given it redacted.
  message: string;
  context: Array<CodeTaskContextItem>;
}

export enum CodeTaskFileStatus {
  Added = "Added",
  Modified = "Modified",
  Deleted = "Deleted",
  Renamed = "Renamed",
}

// One file a turn changed, counted.
export interface CodeTaskFileChange {
  path: string;
  previousPath?: string | undefined;
  status: CodeTaskFileStatus;
  additions: number;
  deletions: number;
}

/*
 * What a turn ended with (AIRun.taskOutcome): the AI's reply, the files it
 * changed and where the change went.
 */
export interface CodeTaskOutcome {
  // The AI's reply, written for the person who asked. Markdown.
  summary: string;
  filesChanged: Array<CodeTaskFileChange>;
  // The branch the change was pushed to, when there was one.
  branchName?: string | undefined;
  pullRequestNumber?: number | undefined;
  pullRequestUrl?: string | undefined;
  // True when this turn opened the pull request; false when it added to it.
  openedPullRequest?: boolean | undefined;
}

// One file's diff, as the turn committed it.
export interface CodeTaskFileDiff extends CodeTaskFileChange {
  // Unified diff hunks; null for a binary file.
  patch: string | null;
  isPatchTruncated?: boolean | undefined;
}

// The diff of a turn's commit (AIRun.codeChanges).
export interface CodeTaskChanges {
  files: Array<CodeTaskFileDiff>;
  // Some files, or parts of them, were left out to keep the diff small.
  isTruncated: boolean;
}

/*
 * What a Runner reports with a turn's Completed status. The server checks
 * every field (CodeTaskOutcomeReader) before it keeps any of it.
 */
export interface CodeTaskOutcomeReport extends CodeTaskOutcome {
  // The AI asked the person something, and waits for their answer.
  needsInput: boolean;
  changes?: CodeTaskChanges | undefined;
}

/*
 * A task's state, read from its latest run: what the person needs to know
 * at a glance - is the AI on it, does it wait for them, is it done, did it
 * fail, or did someone stop it.
 */
export enum CodeTaskState {
  Working = "Working",
  WaitingForYou = "WaitingForYou",
  Done = "Done",
  Failed = "Failed",
  Stopped = "Stopped",
}

export interface CodeTaskStateInput {
  status?: AIRunStatus | undefined;
  needsUserInput?: boolean | undefined;
}

export class CodeTaskStateUtil {
  public static fromRun(run: CodeTaskStateInput): CodeTaskState {
    switch (run.status) {
      case AIRunStatus.Completed:
        return run.needsUserInput
          ? CodeTaskState.WaitingForYou
          : CodeTaskState.Done;
      // A run that found nothing to change still finished its work.
      case AIRunStatus.NoFixFound:
        return CodeTaskState.Done;
      case AIRunStatus.Error:
      case AIRunStatus.Stale:
        return CodeTaskState.Failed;
      case AIRunStatus.Cancelled:
        return CodeTaskState.Stopped;
      case AIRunStatus.Queued:
      case AIRunStatus.Running:
      case AIRunStatus.WaitingForApproval:
      default:
        return CodeTaskState.Working;
    }
  }

  // Whether a new turn may start: never while one is still running.
  public static acceptsReply(state: CodeTaskState): boolean {
    return state !== CodeTaskState.Working;
  }
}

const TRACE_ID_PATTERN: RegExp = /^[0-9a-f]{16}(?:[0-9a-f]{16})?$/;

export class CodeTaskTitle {
  /*
   * A task's title: the first line of its request with markdown heading
   * marks and extra spaces taken out, cut at a word near the limit.
   */
  public static fromMessage(message: string): string {
    const firstLine: string =
      (message || "").split("\n").find((line: string): boolean => {
        return line.trim().length > 0;
      }) || "";

    let title: string = firstLine.trim();

    while (title.startsWith("#") || title.startsWith(">")) {
      title = title.substring(1).trimStart();
    }

    title = title.split(/\s+/).join(" ").trim();

    const maxLength: number = CODE_TASK_LIMITS.maxTitleLength;

    if (title.length <= maxLength) {
      return title;
    }

    const cut: string = title.substring(0, maxLength - 1);
    const lastSpace: number = cut.lastIndexOf(" ");

    return `${(lastSpace > maxLength / 2 ? cut.substring(0, lastSpace) : cut).trimEnd()}…`;
  }
}

export class CodeTaskContextInputUtil {
  /*
   * Read the context a person added to a request, refusing anything that is
   * not one of the shapes above with a sentence that says what is wrong.
   * Duplicates are kept once.
   */
  public static readList(raw: unknown): Array<CodeTaskContextInput> {
    if (raw === undefined || raw === null) {
      return [];
    }

    if (!Array.isArray(raw)) {
      throw new BadDataException("Context must be a list.");
    }

    if (raw.length > CODE_TASK_LIMITS.maxContextItems) {
      throw new BadDataException(
        `A request can carry at most ${CODE_TASK_LIMITS.maxContextItems} pieces of context.`,
      );
    }

    const items: Array<CodeTaskContextInput> = [];
    const seen: Set<string> = new Set<string>();

    for (const entry of raw) {
      const item: CodeTaskContextInput = CodeTaskContextInputUtil.readItem(
        entry,
      );
      const key: string = CodeTaskContextInputUtil.getKey(item);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      items.push(item);
    }

    return items;
  }

  public static readItem(raw: unknown): CodeTaskContextInput {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadDataException("Each piece of context must be an object.");
    }

    const entry: Record<string, unknown> = raw as Record<string, unknown>;
    const type: unknown = entry["type"];

    if (
      typeof type !== "string" ||
      !Object.values(CodeTaskContextType).includes(type as CodeTaskContextType)
    ) {
      throw new BadDataException(
        `Unknown context type. Use one of: ${Object.values(
          CodeTaskContextType,
        ).join(", ")}.`,
      );
    }

    switch (type as CodeTaskContextType) {
      case CodeTaskContextType.Note:
        return {
          type: CodeTaskContextType.Note,
          text: CodeTaskContextInputUtil.readText(
            entry["text"],
            "A note",
            CODE_TASK_LIMITS.maxNoteLength,
          ),
        };
      case CodeTaskContextType.Link:
        return CodeTaskContextInputUtil.readLink(entry);
      case CodeTaskContextType.File:
        return {
          type: CodeTaskContextType.File,
          path: CodeTaskContextInputUtil.normalizePath(entry["path"]),
        };
      case CodeTaskContextType.Trace:
        return {
          type: CodeTaskContextType.Trace,
          traceId: CodeTaskContextInputUtil.readTraceId(entry["traceId"]),
        };
      case CodeTaskContextType.Logs:
        return CodeTaskContextInputUtil.readLogs(entry);
      default:
        return {
          type: type as CodeTaskContextType,
          id: CodeTaskContextInputUtil.readId(entry["id"], type as string),
        };
    }
  }

  // What makes two pieces of context the same one.
  public static getKey(item: CodeTaskContextInput): string {
    return [
      item.type,
      item.id || "",
      item.path || "",
      item.url || "",
      item.traceId || "",
      item.text || "",
      item.search || "",
      item.serviceId || "",
      item.hours?.toString() || "",
    ].join("|");
  }

  /*
   * A path in the repository, written the way git writes it: forward
   * slashes, relative to the repository's root. A leading "/" or "./" is
   * read as the root; ".." and control characters are refused, so a path
   * can never point outside the repository.
   */
  public static normalizePath(raw: unknown): string {
    if (typeof raw !== "string") {
      throw new BadDataException("A file needs a path in the repository.");
    }

    let path: string = raw.trim().split("\\").join("/");

    while (path.startsWith("./") || path.startsWith("/")) {
      path = path.startsWith("./") ? path.substring(2) : path.substring(1);
    }

    while (path.endsWith("/") && path.length > 1) {
      path = path.substring(0, path.length - 1);
    }

    if (!path || path === "/") {
      throw new BadDataException("A file needs a path in the repository.");
    }

    if (path.length > CODE_TASK_LIMITS.maxPathLength) {
      throw new BadDataException(
        `A path can be at most ${CODE_TASK_LIMITS.maxPathLength} characters long.`,
      );
    }

    for (let index: number = 0; index < path.length; index++) {
      const code: number = path.charCodeAt(index);

      if (code < 32 || code === 127) {
        throw new BadDataException("A path cannot hold control characters.");
      }
    }

    const segments: Array<string> = path.split("/");

    if (
      segments.some((segment: string): boolean => {
        return segment === ".." || segment === ".";
      })
    ) {
      throw new BadDataException(
        "A path must stay inside the repository (no '..').",
      );
    }

    return segments
      .filter((segment: string): boolean => {
        return segment.length > 0;
      })
      .join("/");
  }

  private static readText(
    raw: unknown,
    what: string,
    maxLength: number,
  ): string {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new BadDataException(`${what} cannot be empty.`);
    }

    const text: string = raw.trim();

    if (text.length > maxLength) {
      throw new BadDataException(
        `${what} can be at most ${maxLength} characters long.`,
      );
    }

    return text;
  }

  private static readLink(
    entry: Record<string, unknown>,
  ): CodeTaskContextInput {
    const url: string = CodeTaskContextInputUtil.readText(
      entry["url"],
      "A link",
      CODE_TASK_LIMITS.maxLinkLength,
    );

    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new BadDataException(
        "A link must be a full web address, starting with https:// or http://.",
      );
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new BadDataException(
        "A link must be a full web address, starting with https:// or http://.",
      );
    }

    const item: CodeTaskContextInput = {
      type: CodeTaskContextType.Link,
      url: parsed.toString(),
    };

    if (typeof entry["title"] === "string" && entry["title"].trim()) {
      item.title = entry["title"]
        .trim()
        .substring(0, CODE_TASK_LIMITS.maxLinkTitleLength);
    }

    return item;
  }

  private static readTraceId(raw: unknown): string {
    const traceId: string =
      typeof raw === "string" ? raw.trim().toLowerCase() : "";

    if (!TRACE_ID_PATTERN.test(traceId)) {
      throw new BadDataException(
        "A trace ID is 32 (or 16) hexadecimal characters, as it appears on the trace's page.",
      );
    }

    return traceId;
  }

  private static readLogs(
    entry: Record<string, unknown>,
  ): CodeTaskContextInput {
    const item: CodeTaskContextInput = {
      type: CodeTaskContextType.Logs,
      search: CodeTaskContextInputUtil.readText(
        entry["search"],
        "A log search",
        CODE_TASK_LIMITS.maxLogSearchLength,
      ),
      hours: DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS,
    };

    if (entry["hours"] !== undefined && entry["hours"] !== null) {
      const hours: number = Number(entry["hours"]);

      if (!CODE_TASK_LOG_WINDOWS_IN_HOURS.includes(hours)) {
        throw new BadDataException(
          "Logs can look back the last hour, day or week.",
        );
      }

      item.hours = hours;
    }

    if (
      entry["serviceId"] !== undefined &&
      entry["serviceId"] !== null &&
      entry["serviceId"] !== ""
    ) {
      item.serviceId = CodeTaskContextInputUtil.readId(
        entry["serviceId"],
        "service",
      );
    }

    return item;
  }

  private static readId(raw: unknown, what: string): string {
    if (typeof raw !== "string" || !ObjectID.isValidUUID(raw.trim())) {
      throw new BadDataException(`Pick the ${what.toLowerCase()} to add.`);
    }

    return raw.trim().toLowerCase();
  }
}
