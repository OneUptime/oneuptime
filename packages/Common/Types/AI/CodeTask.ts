import FixProductionReport from "./FixProductionReport";
import {
  ProductionReviewReport,
  ProductionReviewSummaryJSON,
} from "../CodeRepository/ProductionReview";
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
  /*
   * One function of a service's continuous profile: its share of the time,
   * who calls it and what it calls - the evidence the Profiler's "Fix with
   * AI" starts from.
   */
  Profile = "Profile",
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
  // A profile's function name, and its profile kind's name.
  maxFunctionNameLength: number;
  maxProfileTypeLength: number;
  // The longest window a profile's evidence is read over, in days.
  maxProfileWindowInDays: number;
  // What one record, trace or log search adds to the AI's prompt.
  maxSnapshotLength: number;
  // A task's title, cut from the first line of its request.
  maxTitleLength: number;
  /*
   * A branch a task starts from, as GitHub takes one (255 bytes), and what
   * a person types to find one.
   */
  maxBranchNameLength: number;
  // The branches a repository's branch picker is sent at once.
  maxListedBranches: number;
} = {
  maxMessageLength: 10000,
  maxContextItems: 10,
  maxNoteLength: 4000,
  maxLinkLength: 2000,
  maxLinkTitleLength: 200,
  maxPathLength: 500,
  maxLogSearchLength: 200,
  maxFunctionNameLength: 1000,
  maxProfileTypeLength: 64,
  maxProfileWindowInDays: 7,
  maxSnapshotLength: 8000,
  maxTitleLength: 120,
  maxBranchNameLength: 255,
  maxListedBranches: 100,
};

// How far back a Logs context looks, in hours: the last hour, day or week.
export const CODE_TASK_LOG_WINDOWS_IN_HOURS: Array<number> = [1, 24, 168];

export const DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS: number = 24;

/*
 * How far back a Profile context looks when it says no window: the last
 * hour, the Profiler's own default.
 */
export const DEFAULT_CODE_TASK_PROFILE_WINDOW_IN_HOURS: number = 1;

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
  /*
   * Profile: the service (serviceId), the function and its file, the kind
   * of profile ("cpu", "memory", ...), and the window - either `hours` back
   * from now, or the startTime and endTime the Profiler was showing (ISO
   * timestamps). A window it was compared with (beforeStartTime and
   * beforeEndTime) adds how the function changed.
   */
  functionName?: string | undefined;
  fileName?: string | undefined;
  profileType?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  beforeStartTime?: string | undefined;
  beforeEndTime?: string | undefined;
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
  // Profile: what CodeTaskContextInput says, as it was read.
  functionName?: string | undefined;
  fileName?: string | undefined;
  profileType?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  beforeStartTime?: string | undefined;
  beforeEndTime?: string | undefined;
  snapshot?: string | undefined;
}

// What a person asked in one turn: AIRun.taskContext.request.
export interface CodeTaskRequest {
  // As typed. The AI is given it redacted.
  message: string;
  context: Array<CodeTaskContextItem>;
  /*
   * The branch the task starts from, when the person picked one in Code's
   * request box: kept on the task's first turn only, and the branch every
   * turn works from until the task has a pull request of its own. Absent:
   * the repository's main branch.
   */
  baseBranch?: string | undefined;
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
  /*
   * A production review of a pull request (the
   * GitHubPullRequestProductionReview recipe): what production says about
   * the code it changes. Written by the server, never by a Runner.
   */
  productionReview?: ProductionReviewReport | undefined;
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

/*
 * Why AI cannot start or continue a task in a repository right now, in the
 * order they are best fixed. The Code pages turn each into one sentence and
 * the link that fixes it; the server refuses with the same sentence.
 */
export enum CodeTaskBlockerType {
  SubscriptionUnpaid = "SubscriptionUnpaid",
  PlanRequired = "PlanRequired",
  // The person may read the repository's tasks, not ask in it.
  NoPermission = "NoPermission",
  // Project Settings > AI > AI Features: Enable AI is off.
  AiDisabled = "AiDisabled",
  // Not connected through the GitHub App, or the installation is gone.
  RepositoryNotConnected = "RepositoryNotConnected",
  NoLlmProvider = "NoLlmProvider",
  NoAiCredits = "NoAiCredits",
  DailyLimitReached = "DailyLimitReached",
  /*
   * The repository picks no Runner (its Runner setting in Code), so a
   * global Runner does its work, and none is online.
   */
  NoAgent = "NoAgent",
  // The Runner the repository picks is not online.
  RunnerNotOnline = "RunnerNotOnline",
  /*
   * The repository picks no Runner, and its project does not use global
   * Runners: it needs one of the project's own.
   */
  GlobalRunnersOff = "GlobalRunnersOff",
}

export interface CodeTaskBlocker {
  type: CodeTaskBlockerType;
  message: string;
  /*
   * RunnerNotOnline: the name of the Runner the repository picks, so the
   * page says which one to check. Left out when it is not known.
   */
  runnerName?: string | undefined;
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

/*
 * What the Code API answers with. The Dashboard reads these and nothing
 * else of a task: they hold only what the person may see (CodeTaskAccess).
 */

// Who asked: shown by name.
export interface CodeTaskPersonJSON {
  id: string;
  name: string;
}

export interface CodeTaskPullRequestJSON {
  number?: number | undefined;
  url?: string | undefined;
  title?: string | undefined;
  // PullRequestState: "open", "closed" or "merged".
  state: string;
  branch?: string | undefined;
  /*
   * Merged is not fixed: what production showed once the deploy that ships
   * it ran (FixProductionVerifier), for a fix production can show.
   */
  production?: FixProductionReport | undefined;
}

// What started a task that nobody asked for in Code.
export enum CodeTaskOriginType {
  // A person, in Code.
  Request = "Request",
  Exception = "Exception",
  Incident = "Incident",
  Alert = "Alert",
  Trace = "Trace",
  Service = "Service",
  Insight = "Insight",
  GitHubIssue = "GitHubIssue",
  GitHubPullRequest = "GitHubPullRequest",
  Unknown = "Unknown",
}

export interface CodeTaskOriginJSON {
  type: CodeTaskOriginType;
  // The record or thread, by name: "TypeError: x is undefined", "#12".
  label: string;
  // A OneUptime record to link to.
  recordId?: string | undefined;
  // A GitHub issue or pull request to link to.
  url?: string | undefined;
}

/*
 * Which of a repository's tasks a list reads (POST /code-task/list `kind`):
 * the work people asked of AI and OneUptime started (Tasks, the default),
 * or the production reviews of its pull requests (ProductionReviews) - each
 * its own page in Code.
 */
export enum CodeTaskListKind {
  Tasks = "tasks",
  ProductionReviews = "productionReviews",
}

// One task in a list.
export interface CodeTaskSummaryJSON {
  id: string;
  taskNumber?: number | undefined;
  title: string;
  // The recipe of the task's first run (CodeFixTaskType).
  recipe: string;
  state: CodeTaskState;
  // Working, but no Runner has picked the latest turn up yet.
  isQueued: boolean;
  createdAt: string;
  lastActivityAt: string;
  requestedBy?: CodeTaskPersonJSON | undefined;
  origin: CodeTaskOriginJSON;
  pullRequest?: CodeTaskPullRequestJSON | undefined;
  turnCount: number;
  codeRepositoryId?: string | undefined;
  /*
   * What the task changed, added up over its turns (CodeTaskChangeStats),
   * when it changed anything: the "+23 −1" a list row shows.
   */
  changes?: CodeTaskChangeStatsJSON | undefined;
  // A production review's latest findings, at a glance.
  productionReview?: ProductionReviewSummaryJSON | undefined;
}

// How much a task changed: its files, and the lines added and taken out.
export interface CodeTaskChangeStatsJSON {
  files: number;
  additions: number;
  deletions: number;
}

// A step the AI took, as the conversation shows it.
export enum CodeTaskStepKind {
  Read = "Read",
  Edited = "Edited",
  Listed = "Listed",
  Searched = "Searched",
  Ran = "Ran",
  PullRequest = "PullRequest",
  Note = "Note",
}

export interface CodeTaskStepJSON {
  sequence: number;
  kind: CodeTaskStepKind;
  // The path, pattern or command the step was about; for a Note, its text.
  subject: string;
  isError: boolean;
  createdAt?: string | undefined;
}

// A context item as the conversation shows it: no snapshot.
export type CodeTaskContextItemJSON = Omit<CodeTaskContextItem, "snapshot">;

// One turn of a task's conversation: one run.
export interface CodeTaskTurnJSON {
  runId: string;
  recipe: string;
  status: string;
  state: CodeTaskState;
  createdAt: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  requestedBy?: CodeTaskPersonJSON | undefined;
  /*
   * What the person asked (a request from Code), and on the first turn the
   * branch they picked for the task to start from (CodeTaskRequest).
   */
  request?:
    | {
        message: string;
        context: Array<CodeTaskContextItemJSON>;
        baseBranch?: string | undefined;
      }
    | undefined;
  // What started it, for a turn nobody asked for in Code.
  origin?: CodeTaskOriginJSON | undefined;
  steps: Array<CodeTaskStepJSON>;
  outcome?: CodeTaskOutcome | undefined;
  // The diff - only for people who may ask AI to change the code.
  changes?: CodeTaskChanges | undefined;
  pullRequests: Array<CodeTaskPullRequestJSON>;
  errorMessage?: string | undefined;
  needsInput: boolean;
}

export interface CodeTaskRepositoryJSON {
  id: string;
  name: string;
  description?: string | undefined;
  organizationName?: string | undefined;
  repositoryName?: string | undefined;
  mainBranchName?: string | undefined;
  repositoryUrl?: string | undefined;
  // Connected through the GitHub App, so AI can work in it.
  isConnected: boolean;
  /*
   * Whether OneUptime reviews its pull requests against production on its
   * own (CodeRepository.isProductionReviewEnabled; unset is off). Left out
   * where the column was not read.
   */
  isProductionReviewEnabled?: boolean | undefined;
  /*
   * Whether the GitHub App answers commands in it, "@oneuptime production
   * review" among them (CodeRepository.isGitHubCommandsEnabled; unset is
   * on). Left out where the column was not read.
   */
  isGitHubCommandsEnabled?: boolean | undefined;
}

/*
 * A repository's branches, for the branch picker of Code's request box
 * (POST /code-task/branches/:repositoryId): its default branch first, then
 * the others GitHub lists, or those that start with what the person typed.
 */
export interface CodeRepositoryBranchesJSON {
  branches: Array<string>;
  // The branch a task starts from when the person picks none.
  defaultBranch: string;
  /*
   * Every branch that matches is in the list. GitHub answers a page at a
   * time: a repository with more branches than one page holds is searched
   * by what the person types instead.
   */
  isComplete: boolean;
}

export interface CodeRepositoryTaskStatsJSON {
  // Tasks whose latest turn is queued or running.
  working: number;
  // Tasks whose latest turn asked the person a question.
  waitingForYou: number;
  openPullRequests: number;
  taskCount: number;
  lastActivityAt?: string | undefined;
}

/*
 * What a Runner is told when it takes a request from Code
 * (/ai-agent-data/get-code-task-details; built by the server's
 * CodeTaskAgentBrief). Every text in it was redacted before it left the
 * server.
 */
export interface CodeTaskAgentContextItem {
  type: CodeTaskContextType;
  label: string;
  path?: string | undefined;
  url?: string | undefined;
  // A note's text, or what was read of a record, a trace or logs.
  content?: string | undefined;
}

export interface CodeTaskAgentTurn {
  // Who wrote it: the person who asked, or the AI (an earlier reply).
  role: "person" | "ai";
  author?: string | undefined;
  text: string;
  // For a person's turn: what they added to it.
  context?: Array<CodeTaskAgentContextItem> | undefined;
}

// Why OneUptime started a task on its own (CodeTaskAgentDetails.startedBy).
export interface CodeTaskAgentStartedBy {
  // The finding, as its insight's title says it.
  finding: string;
  // The insight's page in OneUptime.
  findingUrl: string;
}

export interface CodeTaskAgentDetails {
  // CodeFixTaskType.CodeRequest
  taskType: string;
  taskId: string;
  taskNumber?: number | undefined;
  taskTitle: string;
  taskUrl: string;
  requestedBy?: string | undefined;
  repository: {
    id: string;
    name: string;
    organizationName: string;
    repositoryName: string;
    mainBranchName: string;
    setupCommand: string | null;
    buildCommand: string | null;
    testCommand: string | null;
  };
  /*
   * The branch of the task's open pull request, when it has one: the turn
   * checks it out and pushes to it, and opens nothing new.
   */
  workingBranch: string | null;
  pullRequest: {
    number: number | null;
    url: string | null;
    title: string | null;
    baseRefName: string | null;
  } | null;
  // Otherwise: the branch to create from the default branch for a change.
  newBranchName: string;
  /*
   * When OneUptime started the task on its own, from a problem it found in
   * the project's telemetry (slow code in a service's profiles): what it
   * found, in one line, and the page that shows it - what the pull request
   * says it was opened for. Absent for a task a person asked for. A Runner
   * older than this field writes the pull request it always did.
   */
  startedBy?: CodeTaskAgentStartedBy | undefined;
  /*
   * The branch the person picked for the task to start from, when they
   * picked one (repository.mainBranchName names it too, for Runners older
   * than the pick). A Runner that cannot check it out stops, rather than
   * fall back to the default branch the way it does for a stale main branch
   * name: the person asked for this branch.
   */
  baseBranch?: string | null | undefined;
  // What is asked now.
  request: {
    message: string;
    context: Array<CodeTaskAgentContextItem>;
  };
  // The turns before this one, oldest first.
  conversation: Array<CodeTaskAgentTurn>;
  // Earlier turns left out to keep the conversation short.
  omittedTurns: number;
}

const TRACE_ID_PATTERN: RegExp = /^[0-9a-f]{16}(?:[0-9a-f]{16})?$/;

// Characters git never takes in a branch name (git check-ref-format).
const BRANCH_NAME_REFUSED_CHARACTERS: string = " ~^:?*[\\";

export const CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE: string =
  "That is not a branch name git takes. Pick a branch from the list.";

export class CodeTaskBranchName {
  /*
   * A branch name a person picked, as git takes one (git check-ref-format
   * for refs/heads/<name>): no spaces, control characters or ~ ^ : ? * [ \,
   * no "..", "@{" or "//", no part that starts with "." or ends with
   * ".lock", not starting with "-" or "/" and not ending with "/" or ".",
   * and at most maxBranchNameLength characters. The name is read with a
   * loop, never a pattern: what a person types is never backtracked over.
   */
  public static isValid(name: string): boolean {
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > CODE_TASK_LIMITS.maxBranchNameLength ||
      name === "@"
    ) {
      return false;
    }

    if (
      name.startsWith("-") ||
      name.startsWith("/") ||
      name.endsWith("/") ||
      name.endsWith(".") ||
      name.includes("..") ||
      name.includes("@{") ||
      name.includes("//")
    ) {
      return false;
    }

    for (let index: number = 0; index < name.length; index++) {
      const code: number = name.charCodeAt(index);

      if (
        code < 32 ||
        code === 127 ||
        BRANCH_NAME_REFUSED_CHARACTERS.includes(name[index]!)
      ) {
        return false;
      }
    }

    for (const part of name.split("/")) {
      if (part.startsWith(".") || part.endsWith(".lock")) {
        return false;
      }
    }

    return true;
  }

  /*
   * The branch a request asks to start from: null when it names none (an
   * absent or empty value), the name when git takes it, and a refusal
   * otherwise.
   */
  public static read(raw: unknown): string | null {
    if (raw === undefined || raw === null) {
      return null;
    }

    if (typeof raw !== "string") {
      throw new BadDataException(CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE);
    }

    const name: string = raw.trim();

    if (name.length === 0) {
      return null;
    }

    if (!CodeTaskBranchName.isValid(name)) {
      throw new BadDataException(CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE);
    }

    return name;
  }
}

export class CodeTaskChangeStats {
  /*
   * What a task changed, added up over the outcomes of its turns: every
   * file it touched counted once, and the lines each turn added and took
   * out. A turn that pushed to the task's pull request again adds its own
   * lines, so the sum can be more than the pull request's diff shows - it
   * is what AI wrote. Null when no turn changed a file.
   */
  public static fromOutcomes(
    outcomes: Array<CodeTaskOutcome | null | undefined>,
  ): CodeTaskChangeStatsJSON | null {
    const paths: Set<string> = new Set<string>();
    let additions: number = 0;
    let deletions: number = 0;

    for (const outcome of outcomes) {
      for (const file of outcome?.filesChanged || []) {
        if (!file || typeof file.path !== "string") {
          continue;
        }

        paths.add(file.path);
        additions += CodeTaskChangeStats.toCount(file.additions);
        deletions += CodeTaskChangeStats.toCount(file.deletions);
      }
    }

    if (paths.size === 0) {
      return null;
    }

    return { files: paths.size, additions, deletions };
  }

  private static toCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  }
}

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
      const item: CodeTaskContextInput =
        CodeTaskContextInputUtil.readItem(entry);
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
      case CodeTaskContextType.Profile:
        return CodeTaskContextInputUtil.readProfile(entry);
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
      item.functionName || "",
      item.fileName || "",
      item.profileType || "",
      item.startTime || "",
      item.endTime || "",
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

  /*
   * A function of a service's profile: the service and the function are
   * needed; the file, the kind of profile and the window are optional. The
   * window is the last hour, day or week (`hours`, the Code dialog's
   * choice), or the start and end the Profiler was showing - at most
   * maxProfileWindowInDays long.
   */
  private static readProfile(
    entry: Record<string, unknown>,
  ): CodeTaskContextInput {
    const item: CodeTaskContextInput = {
      type: CodeTaskContextType.Profile,
      serviceId: CodeTaskContextInputUtil.readId(entry["serviceId"], "service"),
      functionName: CodeTaskContextInputUtil.readText(
        entry["functionName"],
        "A function name",
        CODE_TASK_LIMITS.maxFunctionNameLength,
      ),
    };

    if (typeof entry["fileName"] === "string" && entry["fileName"].trim()) {
      const fileName: string = entry["fileName"].trim();

      if (fileName.length > CODE_TASK_LIMITS.maxPathLength) {
        throw new BadDataException(
          `A file name can be at most ${CODE_TASK_LIMITS.maxPathLength} characters long.`,
        );
      }

      item.fileName = fileName;
    }

    if (
      typeof entry["profileType"] === "string" &&
      entry["profileType"].trim()
    ) {
      const profileType: string = entry["profileType"].trim();

      if (profileType.length > CODE_TASK_LIMITS.maxProfileTypeLength) {
        throw new BadDataException("That kind of profile is not one we know.");
      }

      item.profileType = profileType;
    }

    const hasWindow: boolean =
      entry["startTime"] !== undefined || entry["endTime"] !== undefined;

    if (hasWindow) {
      const window: { startTime: string; endTime: string } =
        CodeTaskContextInputUtil.readWindow(
          entry["startTime"],
          entry["endTime"],
        );
      item.startTime = window.startTime;
      item.endTime = window.endTime;
    } else {
      item.hours = DEFAULT_CODE_TASK_PROFILE_WINDOW_IN_HOURS;

      if (entry["hours"] !== undefined && entry["hours"] !== null) {
        const hours: number = Number(entry["hours"]);

        if (!CODE_TASK_LOG_WINDOWS_IN_HOURS.includes(hours)) {
          throw new BadDataException(
            "A profile can look back the last hour, day or week.",
          );
        }

        item.hours = hours;
      }
    }

    if (
      entry["beforeStartTime"] !== undefined ||
      entry["beforeEndTime"] !== undefined
    ) {
      const before: { startTime: string; endTime: string } =
        CodeTaskContextInputUtil.readWindow(
          entry["beforeStartTime"],
          entry["beforeEndTime"],
        );
      item.beforeStartTime = before.startTime;
      item.beforeEndTime = before.endTime;
    }

    return item;
  }

  private static readWindow(
    rawStart: unknown,
    rawEnd: unknown,
  ): { startTime: string; endTime: string } {
    const start: Date | null = CodeTaskContextInputUtil.readTime(rawStart);
    const end: Date | null = CodeTaskContextInputUtil.readTime(rawEnd);

    if (!start || !end) {
      throw new BadDataException(
        "A profile's time range needs a start and an end, as ISO timestamps.",
      );
    }

    if (start.getTime() >= end.getTime()) {
      throw new BadDataException(
        "A profile's time range must start before it ends.",
      );
    }

    const maxWindowMs: number =
      CODE_TASK_LIMITS.maxProfileWindowInDays * 24 * 60 * 60 * 1000;

    if (end.getTime() - start.getTime() > maxWindowMs) {
      throw new BadDataException(
        `A profile's time range can be at most ${CODE_TASK_LIMITS.maxProfileWindowInDays} days long.`,
      );
    }

    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }

  private static readTime(raw: unknown): Date | null {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return null;
    }

    const date: Date = new Date(raw.trim());

    return isNaN(date.getTime()) ? null : date;
  }

  private static readId(raw: unknown, what: string): string {
    if (typeof raw !== "string" || !ObjectID.isValidUUID(raw.trim())) {
      throw new BadDataException(`Pick the ${what.toLowerCase()} to add.`);
    }

    return raw.trim().toLowerCase();
  }
}
