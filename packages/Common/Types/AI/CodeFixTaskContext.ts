import GitHubCommandType, {
  GitHubCommentKind,
} from "../CodeRepository/GitHubCommand";
import { DeclaredCodeChangeTaskContext } from "../../Utils/AiRemediation/DeclaredCodeChange";
import { CodeHost, CodeHostCapability } from "../CodeRepository/CodeHost";
import CodeRepositoryType from "../CodeRepository/CodeRepositoryType";
import { ProductionReviewCaughtLeak } from "../CodeRepository/ProductionReviewSensitiveData";
import { CodeTaskBranchName, CodeTaskRequest } from "./CodeTask";
import {
  ProductionReviewPosting,
  ProductionReviewTrigger,
} from "../CodeRepository/ProductionReview";

/*
 * The JSON persisted on AIRun.taskContext for tasks whose exact working
 * context must survive until a worker claims them. Some recipes have no
 * durable subject record; others, such as FixFromIncident, deliberately pin
 * a snapshot instead of re-reading mutable subject state at execution time.
 *
 * First user: the FixPerformance recipe. Its evidence is computed
 * DETERMINISTICALLY from a trace's span tree when the user clicks "Fix
 * performance with AI" (see Common/Utils/Traces/SpanTreeAnalyzer.ts, and
 * Common/Utils/Suggestions/TracePerformanceFixSuggestion.ts for which
 * findings are worth a fix) and stored here verbatim — ClickHouse span retention
 * is short, so by the time the agent worker claims the run the spans may
 * already be gone. The stored findings ARE the task's context.
 *
 * These shapes are a wire contract with the agent worker
 * (/ai-agent-data/get-instrumentation-task-details serves them back) — do
 * not rename fields.
 */

export enum PerformanceFindingType {
  // >=5 near-identical sibling spans under one parent (classic N+1).
  NPlusOneQuery = "NPlusOneQuery",
  // A single span whose self time is >=60% of the trace's total duration.
  DominantSpan = "DominantSpan",
  /*
   * >=3 same-name siblings executing strictly one-after-another whose
   * combined duration is >=50% of their parent — parallelizable work.
   */
  SequentialSiblings = "SequentialSiblings",
}

// One span a finding implicates — enough to name it in evidence and PRs.
export interface ImplicatedSpan {
  spanId: string;
  name: string;
  durationMs: number;
}

/*
 * One deterministic performance finding. `evidence` is the human-readable
 * proof (real counts, durations, normalized names/statements) — it is
 * embedded verbatim in the agent prompt and the pull request body, so it
 * must stand on its own.
 */
export interface PerformanceFinding {
  findingType: PerformanceFindingType;
  // One-line summary, e.g. 'N+1: 27× "SELECT users" under "GET /orders"'.
  headline: string;
  // Multi-line human-readable proof with the real numbers.
  evidence: string;
  spanCount: number;
  combinedDurationMs: number;
  traceDurationMs: number;
  percentOfTrace: number;
  // Only for SequentialSiblings: combined duration as a share of the parent.
  percentOfParent?: number | undefined;
  normalizedSpanName: string;
  parentSpanName?: string | undefined;
  // Normalized db.statement when the implicated spans carry one.
  normalizedDbStatement?: string | undefined;
  dbSystem?: string | undefined;
  httpUrl?: string | undefined;
  // Capped sample of the implicated spans (name + duration).
  implicatedSpans: Array<ImplicatedSpan>;
}

/*
 * A code location plucked from the implicated spans' code.* attributes
 * (code.filepath / code.function / code.lineno and their newer semconv
 * spellings). Feeds the stack-trace-style repository resolution at
 * task-details time.
 */
export interface PerformanceCodeLocation {
  filePath: string;
  functionName?: string | undefined;
  lineNumber?: number | undefined;
}

/*
 * The immutable investigation snapshot consumed by FixFromIncident. Both
 * fields travel together: the run id proves which Recommended decision was
 * gated, and the markdown is the exact posted analysis that decision covered.
 */
export interface InvestigationCodeFixTaskSnapshot {
  investigationRunId: string;
  investigationAnalysisMarkdown: string;
}

/*
 * The GitHub conversation a run was started from, and everything the agent
 * worker needs to work it without re-deriving anything from a webhook it can
 * no longer see.
 *
 * Two fields carry the trust boundary and must be read with it in mind:
 *
 *   - `instruction` is UNTRUSTED text, written by whoever commented. It is
 *     quoted into an LLM prompt, so every consumer treats it as data about
 *     what the human wants and never as instructions that widen what the run
 *     may do. The run's repository, its issue/pull request, and its command
 *     are all fixed HERE, at trigger time, by code that verified them.
 *
 *   - `installationId` was taken from the SIGNED webhook payload and checked
 *     against the CodeRepository row it names, so it is a GitHub-vouched
 *     binding rather than a client assertion. Nothing downstream may swap it.
 */
export interface GitHubTaskContext {
  // The OneUptime CodeRepository row this conversation belongs to.
  codeRepositoryId: string;
  installationId: string;
  organizationName: string;
  repositoryName: string;
  commandType: GitHubCommandType;
  // UNTRUSTED. What the human wrote after the mention. May be empty.
  instruction: string;
  /*
   * Exactly one of these is set, and it decides the recipe: an issue is
   * implemented, a pull request is revised or reviewed.
   */
  issueNumber?: number | undefined;
  pullRequestNumber?: number | undefined;
  /*
   * The head branch of the pull request, captured at trigger time. The
   * revision pushes to THIS branch and opens nothing new, and the review
   * checks it out so it can read the code as changed.
   *
   * DELIBERATELY ABSENT for a pull request from a fork: that branch does not
   * exist in the repository this installation can reach, so a run that tried
   * to check it out would silently land on the default branch instead. A
   * review of a fork works from the base branch plus the diff; a revision of
   * one is refused outright.
   */
  pullRequestHeadRefName?: string | undefined;
  // Whether the pull request's branch lives in a different repository.
  isPullRequestFromFork?: boolean | undefined;
  // The comment that triggered the run, so the app can react on it.
  triggerCommentId?: number | undefined;
  /*
   * What kind of comment triggerCommentId names, which decides where its
   * reactions go. Absent on runs queued before it was recorded; those are
   * read as conversation comments, the only kind they were reacted on as.
   */
  triggerCommentKind?: GitHubCommentKind | undefined;
  // The GitHub login that issued the command. Attribution, never authority.
  triggeredByLogin?: string | undefined;
  /*
   * The app's own acknowledgement comment. Edited in place as the run
   * progresses so one command produces one comment, not a status log.
   */
  acknowledgementCommentId?: number | undefined;
  // The X-GitHub-Delivery of the webhook that started this run.
  webhookDeliveryId?: string | undefined;
  /*
   * The pull requests the worker said this run opened, sent with its
   * Completed report and stored with that status. Read only when the run
   * recorded no pull request of its own — recording one can fail after GitHub
   * has opened it — and only those that are plainly pull requests of this
   * repository (see GitHubRunReply.readOpenedPullRequests).
   */
  openedPullRequestUrls?: Array<string> | undefined;
  /*
   * When the run's OUTCOME was reported back into the thread. Set by the
   * sweeper that posts it, and the only thing stopping the next sweep from
   * posting again — see GitHubRunReply for why the report is swept for rather
   * than posted by whoever finalized the run.
   */
  reportedToGitHubAt?: string | undefined;
}

/*
 * A pull (or merge) request on a host other than GitHub - GitLab, Forgejo
 * or Gitea - that a production review is about. The
 * GitHubPullRequestProductionReview recipe, named for GitHub where it
 * started, reviews the pull requests of every host that has them; GitHub's
 * are named in `github`, as they always were, and a repository is on one
 * host, so a task names its pull request in one or the other. Written by
 * the server only (ProductionReviewQueue), from what the host's API said
 * and the repository's own row.
 */
export interface CodeHostPullRequestTaskContext {
  // The OneUptime CodeRepository row the pull request is in.
  codeRepositoryId: string;
  // The repository's host: GitLab, or Forgejo (Gitea too).
  provider: CodeRepositoryType;
  // GitLab's merge request iid ("!12"); Forgejo's and Gitea's index ("#12").
  pullRequestNumber: number;
  // Its page on the host, as the host's API gave it.
  pullRequestUrl?: string | undefined;
  // Whether its branch lives in another repository: a fork.
  isPullRequestFromFork?: boolean | undefined;
  // The login that opened, pushed or asked. Attribution, never authority.
  triggeredByLogin?: string | undefined;
}

/*
 * The pull request a production review task is about, whichever host it is
 * on: GitHub's from `github`, every other host's from `codeHostPullRequest`.
 */
export interface ReviewedPullRequest {
  codeRepositoryId: string;
  provider: CodeRepositoryType;
  number: number;
  isFromFork: boolean;
  // Its page on the host, when the task knows it.
  url?: string | undefined;
}

/*
 * A pull request's production review task (the
 * GitHubPullRequestProductionReview recipe): what it was asked to review,
 * and what it keeps between one review of the pull request and the next.
 * One task per pull request, reviewed again in place: every push, command
 * or Review again asks for a new review (requestNumber), and a review that
 * finishes while a newer one was asked for is queued again rather than
 * marked done. Written by the server only (ProductionReviewQueue).
 */
export interface ProductionReviewTaskContext {
  // Bumped by every request for a review.
  requestNumber: number;
  // The request the review in progress (or the last one) answers.
  reviewingRequestNumber?: number | undefined;
  /*
   * When the latest request came. A review waits a little after it, so a
   * burst of pushes is reviewed once, at the last of them.
   */
  requestedAt: string;
  // The pull request's head when it was asked; the review reads it again.
  headSha: string;
  trigger: ProductionReviewTrigger;
  // The GitHub login that pushed or asked. Attribution, never authority.
  requestedByLogin?: string | undefined;
  /*
   * Whether the pull request's author can write to the repository: only
   * then are its later pushes reviewed on their own. Anyone else's pull
   * request is reviewed only when someone who can write asks.
   */
  isAuthorTrusted: boolean;
  // The one comment the review keeps on the pull request, edited in place.
  commentId?: number | undefined;
  commentUrl?: string | undefined;
  commentPosting?: ProductionReviewPosting | undefined;
  reviewedHeadSha?: string | undefined;
  /*
   * GitHub only: the check run the review wrote on the pull request's
   * head, and that head - edited in place while the head is the same, a
   * new one written for a new head (GitHub keeps checks per commit).
   */
  checkRunId?: number | undefined;
  checkRunHeadSha?: string | undefined;
  // OneUptime AI's reads of this pull request today (UTC), and the input of the last.
  aiReadDay?: string | undefined;
  aiReadsToday?: number | undefined;
  aiInputHash?: string | undefined;
  // The input of OneUptime AI's last read of the Sensitive data section (#10376).
  sensitiveDataAiInputHash?: string | undefined;
  /*
   * Every leak a review of this pull request posted, once each, and when a
   * later review no longer found it (#10376): what AI Results counts as
   * caught before it merged.
   */
  caughtLeaks?: Array<ProductionReviewCaughtLeak> | undefined;
  /*
   * GitHub only: the leaks whose suggested change was posted on its line,
   * by key - each is posted once, however many pushes show it.
   */
  suggestedLeakKeys?: Array<string> | undefined;
  // Attempts at the latest request that failed (a GitHub or database blip).
  failedAttempts?: number | undefined;
}

/*
 * The fix of a group of Data Security issues' cause, once
 * (CodeFixTaskType.FixInfrastructureCode, #10370): what its Runner is
 * handed and its pull request says. Names, ids and the request as Data
 * Security's input builder wrote it - never a value, a sample or a record.
 */
export interface InfrastructureFixTaskContext {
  // The group of issues whose cause it fixes.
  groupId: string;
  checkId: string;
  // What the pull request is called: "Turn on access logging in the static-site module".
  title: string;
  // The group's cause, in English: "the static-site module".
  cause: string;
  // The request the coding agent reads (DataSecurityAiInput.buildFixIssueGroupRequest).
  request: string;
  // The code that declares the stores: its kind and the files named after them.
  codeKind?: string | undefined;
  paths?: Array<string> | undefined;
  // The stores and issues it fixes, for the pull request's description.
  stores: Array<InfrastructureFixStore>;
  // How many stores the group's fix is for; more than `stores` lists when it was long.
  storeCount: number;
  // Where the group's issues are in OneUptime.
  issuesUrl?: string | undefined;
}

export interface InfrastructureFixStore {
  name: string;
  kind?: string | undefined;
  region?: string | undefined;
  issueId: string;
  // Its issue's page in OneUptime.
  issueUrl?: string | undefined;
}

// The most stores a fix's context lists, and the longest text it keeps.
export const MAX_INFRASTRUCTURE_FIX_STORES: number = 200;
const MAX_INFRASTRUCTURE_FIX_TEXT: number = 20_000;
const MAX_INFRASTRUCTURE_FIX_NAME: number = 300;

function readFixText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/*
 * A fix's context as a run carries it, read defensively, or null when it
 * is not one: no group, no request, or no store.
 */
export function getInfrastructureFixTaskContext(
  value: unknown,
): InfrastructureFixTaskContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const groupId: string = readFixText(raw["groupId"], 100);
  const request: string = readFixText(
    raw["request"],
    MAX_INFRASTRUCTURE_FIX_TEXT,
  );
  const stores: Array<InfrastructureFixStore> = (
    Array.isArray(raw["stores"]) ? (raw["stores"] as Array<unknown>) : []
  )
    .slice(0, MAX_INFRASTRUCTURE_FIX_STORES)
    .map((item: unknown): InfrastructureFixStore | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const store: Record<string, unknown> = item as Record<string, unknown>;
      const name: string = readFixText(
        store["name"],
        MAX_INFRASTRUCTURE_FIX_NAME,
      );
      const issueId: string = readFixText(store["issueId"], 100);

      if (!name || !issueId) {
        return null;
      }

      const kind: string = readFixText(
        store["kind"],
        MAX_INFRASTRUCTURE_FIX_NAME,
      );
      const region: string = readFixText(
        store["region"],
        MAX_INFRASTRUCTURE_FIX_NAME,
      );
      const issueUrl: string = readFixText(store["issueUrl"], 2000);

      return {
        name,
        issueId,
        ...(kind ? { kind } : {}),
        ...(region ? { region } : {}),
        ...(issueUrl ? { issueUrl } : {}),
      };
    })
    .filter(
      (
        store: InfrastructureFixStore | null,
      ): store is InfrastructureFixStore => {
        return store !== null;
      },
    );

  if (!groupId || !request.trim() || stores.length === 0) {
    return null;
  }

  const codeKind: string = readFixText(raw["codeKind"], 100);
  const paths: Array<string> = (
    Array.isArray(raw["paths"]) ? (raw["paths"] as Array<unknown>) : []
  )
    .map((path: unknown): string => {
      return readFixText(path, 500);
    })
    .filter(Boolean)
    .slice(0, 5);
  const issuesUrl: string = readFixText(raw["issuesUrl"], 2000);
  const storeCount: unknown = raw["storeCount"];

  return {
    groupId,
    checkId: readFixText(raw["checkId"], 100),
    title:
      readFixText(raw["title"], MAX_INFRASTRUCTURE_FIX_NAME) ||
      "Fix the cause of Data Security issues",
    cause: readFixText(raw["cause"], MAX_INFRASTRUCTURE_FIX_NAME),
    request,
    stores,
    storeCount:
      typeof storeCount === "number" &&
      Number.isSafeInteger(storeCount) &&
      storeCount >= stores.length
        ? storeCount
        : stores.length,
    ...(codeKind ? { codeKind } : {}),
    ...(paths.length > 0 ? { paths } : {}),
    ...(issuesUrl ? { issuesUrl } : {}),
  };
}

/*
 * The folder an infrastructure fix starts in: the deepest one every file
 * that declares its stores is in ("modules/static-site"), or null for the
 * repository's root.
 */
export function getInfrastructureFixFolder(
  paths: ReadonlyArray<string> | undefined,
): string | null {
  const folders: Array<Array<string>> = (paths || [])
    .map((path: string): Array<string> => {
      return path.split("/").filter(Boolean).slice(0, -1);
    })
    .filter((parts: Array<string>): boolean => {
      return parts.length > 0;
    });

  if (folders.length === 0 || folders.length !== (paths || []).length) {
    return null;
  }

  const shared: Array<string> = [];

  for (let index: number = 0; index < folders[0]!.length; index++) {
    const part: string = folders[0]![index]!;

    if (
      !folders.every((parts: Array<string>): boolean => {
        return parts[index] === part;
      })
    ) {
      break;
    }

    shared.push(part);
  }

  return shared.length > 0 ? shared.join("/") : null;
}

export interface CodeFixTaskContext {
  /*
   * FixFromIncident: the exact investigation whose published RootCause is
   * the task's context. This prevents a later re-investigation from changing
   * the report between the user's click and the worker claiming the task.
   */
  sourceInvestigationRunId?: string | undefined;
  /*
   * Snapshot of that run's published analysis. Fix tasks can wait in the
   * queue, so reading the feed again when the worker claims the task would
   * let a later re-investigation silently change the requested fix.
   */
  sourceInvestigationAnalysisMarkdown?: string | undefined;
  // FixPerformance: the analyzed trace.
  traceId?: string | undefined;
  // Best-effort service attribution resolved from the trace's spans.
  serviceName?: string | undefined;
  // The deterministic span-tree findings — the recipe's entire evidence.
  performanceFindings?: Array<PerformanceFinding> | undefined;
  // code.* attribute locations for stack-trace-style repo resolution.
  codeLocations?: Array<PerformanceCodeLocation> | undefined;
  /*
   * ImproveLogging / ImproveTracing: the telemetry service whose
   * instrumentation the recipe improves (serviceName above carries its
   * name for repository resolution and PR wording).
   */
  telemetryServiceId?: string | undefined;
  /*
   * The GitHub Implement / Revise / Review recipes: the conversation the run
   * came from and must report back to.
   */
  github?: GitHubTaskContext | undefined;
  /*
   * CodeRequest: what a person asked in this turn, in Code, and the context
   * they added to it (see Types/AI/CodeTask). The repository is the run's
   * codeRepositoryId, and the turns before this one are the runs of the same
   * task (codeTaskId).
   */
  request?: CodeTaskRequest | undefined;
  /*
   * CodeRequest asked from a fix of OneUptime AI's on a cloud resource
   * declared as code: the fix and the step whose change the pull request
   * makes in the code (Utils/AiRemediation/DeclaredCodeChange). Kept on the
   * task's first turn only.
   */
  declaredCodeChange?: DeclaredCodeChangeTaskContext | undefined;
  /*
   * The fix of a group of Data Security issues' cause, once
   * (CodeFixTaskType.FixInfrastructureCode, #10370).
   */
  infrastructureFix?: InfrastructureFixTaskContext | undefined;
  /*
   * GitHubPullRequestProductionReview: what the pull request's review was
   * asked to do, and what it keeps between reviews. `github` names a
   * GitHub pull request, `codeHostPullRequest` one on any other host.
   */
  productionReview?: ProductionReviewTaskContext | undefined;
  /*
   * GitHubPullRequestProductionReview of a pull (or merge) request on
   * GitLab, Forgejo or Gitea: which one, and where it is.
   */
  codeHostPullRequest?: CodeHostPullRequestTaskContext | undefined;
  /*
   * ImproveInstrumentation / FixFromIncident opened on their own: the code
   * repositories the auto remediation rules that opened the run allow it to
   * be made in (Types/CodeRepository/CodeRepositoryAllowance). Absent - on
   * a run a person started, on a run opened with no rule or with a rule
   * that names none, and on a run queued before rules named repositories -
   * every connected repository. The run's repository is resolved among
   * these only, when it is queued and again when it starts.
   */
  allowedCodeRepositoryIds?: Array<string> | undefined;
  /*
   * A FixPerformance run a person asked for from a trace whose code no
   * connected repository was found to hold for certain: the repository
   * they picked (TracePerformanceFixSuggestion.repositories). The run works
   * in it, when it is queued and again when it starts
   * (getRunRepositoryAllowance). Absent: the repository is resolved from
   * the run's facts, as for every other run.
   */
  pickedCodeRepositoryId?: string | undefined;
}

/*
 * A pull request on another host, as a task names it: whole - its
 * repository, a host that has production reviews and is not GitHub, a
 * number - or null.
 */
export function getCodeHostPullRequestTaskContext(
  taskContext: CodeFixTaskContext | null | undefined,
): CodeHostPullRequestTaskContext | null {
  const pullRequest: CodeHostPullRequestTaskContext | undefined =
    taskContext?.codeHostPullRequest;

  if (
    !pullRequest ||
    typeof pullRequest !== "object" ||
    typeof pullRequest.codeRepositoryId !== "string" ||
    pullRequest.codeRepositoryId.trim().length === 0 ||
    !CodeHost.isKnownType(pullRequest.provider) ||
    pullRequest.provider === CodeRepositoryType.GitHub ||
    !CodeHost.can(pullRequest.provider, CodeHostCapability.ProductionReview) ||
    typeof pullRequest.pullRequestNumber !== "number" ||
    !Number.isSafeInteger(pullRequest.pullRequestNumber) ||
    pullRequest.pullRequestNumber < 1
  ) {
    return null;
  }

  return pullRequest;
}

/*
 * The pull request a task is about, whichever host it is on - GitHub's
 * from `github`, every other host's from `codeHostPullRequest` - or null.
 */
export function getReviewedPullRequest(
  taskContext: CodeFixTaskContext | null | undefined,
): ReviewedPullRequest | null {
  const github: GitHubTaskContext | null = getGitHubTaskContext(taskContext);

  if (github && typeof github.pullRequestNumber === "number") {
    return {
      codeRepositoryId: github.codeRepositoryId,
      provider: CodeRepositoryType.GitHub,
      number: github.pullRequestNumber,
      isFromFork: Boolean(github.isPullRequestFromFork),
    };
  }

  const other: CodeHostPullRequestTaskContext | null =
    getCodeHostPullRequestTaskContext(taskContext);

  if (!other) {
    return null;
  }

  const reviewed: ReviewedPullRequest = {
    codeRepositoryId: other.codeRepositoryId,
    provider: other.provider,
    number: other.pullRequestNumber,
    isFromFork: Boolean(other.isPullRequestFromFork),
  };

  if (typeof other.pullRequestUrl === "string" && other.pullRequestUrl) {
    reviewed.url = other.pullRequestUrl;
  }

  return reviewed;
}

/*
 * A production review task's context, when it is whole: a pull request -
 * named in `github`, or on another host in `codeHostPullRequest` - and a
 * request to review it. Null otherwise.
 */
export function getProductionReviewTaskContext(
  taskContext: CodeFixTaskContext | null | undefined,
): ProductionReviewTaskContext | null {
  const review: ProductionReviewTaskContext | undefined =
    taskContext?.productionReview;

  if (
    !review ||
    typeof review !== "object" ||
    typeof review.requestNumber !== "number" ||
    !Number.isSafeInteger(review.requestNumber) ||
    review.requestNumber < 1 ||
    typeof review.requestedAt !== "string" ||
    typeof review.headSha !== "string"
  ) {
    return null;
  }

  if (!getReviewedPullRequest(taskContext)) {
    return null;
  }

  return review;
}

/*
 * Treat partial, empty and malformed JSON as no request: a CodeRequest run
 * that cannot say what was asked is not executable.
 */
export function getCodeTaskRequest(
  taskContext: CodeFixTaskContext | null | undefined,
): CodeTaskRequest | null {
  const request: CodeTaskRequest | undefined = taskContext?.request;

  if (
    !request ||
    typeof request.message !== "string" ||
    request.message.trim().length === 0
  ) {
    return null;
  }

  const result: CodeTaskRequest = {
    message: request.message,
    context: Array.isArray(request.context) ? request.context : [],
  };

  /*
   * The branch the person picked to start from, kept only when git would
   * take it: whatever reads it (the Runner's brief, the conversation) gets
   * a branch name or nothing.
   */
  if (
    typeof request.baseBranch === "string" &&
    CodeTaskBranchName.isValid(request.baseBranch)
  ) {
    result.baseBranch = request.baseBranch;
  }

  return result;
}

/*
 * Canonical JSON shape persisted for a Recommended investigation. Unlike the
 * normalized snapshot returned below, these names are the established
 * AIRun.taskContext wire contract.
 */
export type InvestigationCodeFixTaskContext = CodeFixTaskContext & {
  sourceInvestigationRunId: string;
  sourceInvestigationAnalysisMarkdown: string;
};

/*
 * Treat partial, empty and malformed JSON as no snapshot. The same validator
 * is shared by the trigger, claim guard and task-details reader so none of
 * those boundaries can silently fall back to a different investigation.
 */
export function getInvestigationCodeFixTaskSnapshot(
  taskContext: CodeFixTaskContext | null | undefined,
): InvestigationCodeFixTaskSnapshot | null {
  const investigationRunId: unknown = taskContext?.sourceInvestigationRunId;
  const investigationAnalysisMarkdown: unknown =
    taskContext?.sourceInvestigationAnalysisMarkdown;

  if (
    typeof investigationRunId !== "string" ||
    investigationRunId.trim().length === 0 ||
    typeof investigationAnalysisMarkdown !== "string" ||
    investigationAnalysisMarkdown.trim().length === 0
  ) {
    return null;
  }

  return {
    investigationRunId,
    investigationAnalysisMarkdown,
  };
}

/*
 * Treat partial, empty and malformed JSON as no GitHub context. Shared by the
 * trigger, the task-details endpoint and the reply helper so none of those
 * boundaries can fall back to a half-built conversation — a run that cannot
 * name its repository AND its issue-or-pull-request is not executable, and
 * one that names both is a bug, not a convenience.
 */
export function getGitHubTaskContext(
  taskContext: CodeFixTaskContext | null | undefined,
): GitHubTaskContext | null {
  const github: GitHubTaskContext | undefined = taskContext?.github;

  if (!github) {
    return null;
  }

  const requiredStrings: Array<unknown> = [
    github.codeRepositoryId,
    github.installationId,
    github.organizationName,
    github.repositoryName,
    github.commandType,
  ];

  for (const value of requiredStrings) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
  }

  const hasIssue: boolean = typeof github.issueNumber === "number";
  const hasPullRequest: boolean = typeof github.pullRequestNumber === "number";

  if (hasIssue === hasPullRequest) {
    return null;
  }

  return github;
}

/*
 * The issue or pull request number this run is about. GitHub numbers both in
 * the same sequence per repository, and the conversation API addresses both
 * as `/issues/{n}` — so the app's replies always go here, whichever it is.
 */
export function getGitHubConversationNumber(github: GitHubTaskContext): number {
  return (github.pullRequestNumber ?? github.issueNumber)!;
}

export default CodeFixTaskContext;
