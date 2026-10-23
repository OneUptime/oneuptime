/*
 * Which task recipe a CodeFix AIRun executes. The agent worker dispatches on
 * this value (returned as `taskType` by /ai-agent-task/get-pending-task), so
 * these strings are a wire contract — do not rename them.
 *
 * A null AIRun.codeFixTaskType column means FixException: every CodeFix run
 * created before the column existed was an exception fix. Server responses
 * normalize null to FixException so clients never see the legacy null.
 */
enum CodeFixTaskType {
  // Analyze an exception's stack trace and open a PR that fixes the bug.
  FixException = "FixException",
  // Write a failing-then-passing regression test that reproduces the exception.
  WriteRegressionTest = "WriteRegressionTest",
  /*
   * Improve how the code HANDLES and REPORTS this exception without
   * changing business behavior: parameterize messages that interpolate
   * user data (PII out of error text, stable fingerprints), validate bad
   * input earlier with an actionable error, and mark expected/operational
   * errors as handled in telemetry. The recipe for exceptions the triage
   * classified as user errors or expected denials — where "fix the bug"
   * is the wrong instruction because there is no bug.
   */
  ImproveExceptionHandling = "ImproveExceptionHandling",
  /*
   * Add the observability an INCONCLUSIVE AI investigation was missing
   * (structured logs, spans, metric counters on the implicated code paths).
   * NOT user-triggerable from the exception page — it has its own automatic
   * trigger: an inconclusive investigation on a project that opted in through
   * the incident/alert instrumentation fix setting (see Common/Server/Utils/
   * AI/SRE/InstrumentationTaskTrigger.ts). Its subject is the triggering
   * incident/alert, NOT a telemetry exception.
   */
  ImproveInstrumentation = "ImproveInstrumentation",
  /*
   * Fix a deterministically-detected performance pattern in a trace (N+1
   * queries, one dominant slow span, sequential-that-could-be-parallel
   * siblings). Human-triggered from the trace view (POST /ai-investigation/
   * create-performance-fix-task), NOT from the exception page: it has no
   * subject row at all — its entire context (the SpanTreeAnalyzer findings)
   * is captured at trigger time into AIRun.taskContext (see
   * Common/Server/Utils/AI/SRE/FixPerformanceTaskTrigger.ts).
   */
  FixPerformance = "FixPerformance",
  /*
   * Improve a SERVICE's logging hygiene: structured/parameterized log
   * messages (no user data interpolated into log text), correct severity
   * levels, trace correlation, proper exception recording instead of raw
   * stack dumps in log bodies, and less noise. Human-triggered from the
   * service's Logs page (POST /ai-investigation/
   * create-telemetry-improvement-task); its context (service id + name) is
   * captured into AIRun.taskContext at trigger time. Instrumentation only —
   * never a behavior change.
   */
  ImproveLogging = "ImproveLogging",
  /*
   * Improve a SERVICE's tracing instrumentation: spans on uninstrumented
   * entry points and significant operations, low-cardinality span names,
   * exceptions recorded on spans with correct status/escaped semantics,
   * code.* and semantic-convention attributes, context propagation across
   * async boundaries. Human-triggered from the service's Traces page (same
   * endpoint as ImproveLogging); context captured into AIRun.taskContext.
   * Instrumentation only — never a behavior change.
   */
  ImproveTracing = "ImproveTracing",
  /*
   * Fix the root cause a completed AI investigation identified. Human-
   * triggered from the investigation panel (POST /ai-investigation/
   * create-fix-task), NOT from the exception page: its subject is the
   * investigated incident/alert, and its context is the posted analysis (see
   * Common/Server/Utils/AI/SRE/FixFromIncidentTaskTrigger.ts).
   */
  FixFromIncident = "FixFromIncident",
  /*
   * Work a GitHub ISSUE and open a pull request that closes it. Triggered
   * from GitHub itself — an "@oneuptime implement this" mention, an
   * assignment to the app's bot user, or the repository's trigger label —
   * never from the OneUptime UI. Its entire context (repository, issue
   * number, the commenter's instruction) is captured into
   * AIRun.taskContext.github at trigger time; see
   * Common/Server/Utils/CodeRepository/GitHub/GitHubAgentTaskTrigger.ts.
   */
  GitHubIssueFix = "GitHubIssueFix",
  /*
   * Revise an EXISTING pull request in place: new commits pushed to the same
   * head branch, no second pull request. Triggered by "@oneuptime revise
   * this because ..." on the pull request. The head branch is captured into
   * AIRun.taskContext.github at trigger time so a later force-push cannot
   * silently redirect the run at another branch.
   */
  GitHubPullRequestRevision = "GitHubPullRequestRevision",
  /*
   * Review a pull request and post the review as a COMMENT. Changes nothing
   * and pushes nothing — the one recipe that never touches the repository.
   * Triggered by "@oneuptime review" or by requesting a review from the app.
   */
  GitHubPullRequestReview = "GitHubPullRequestReview",
  /*
   * Review a pull request AGAINST PRODUCTION: what OneUptime's telemetry says
   * about the code it changes - the exceptions thrown in it, how busy and
   * how slow the operations it runs are, the CPU time it takes, and the
   * incidents and deploys around it - posted as ONE comment on the pull
   * request that is edited in place on every push, and shown on the pull
   * request's page in Code (Common/Server/Utils/CodeRepository/
   * ProductionReview).
   *
   * Started by OneUptime itself when a pull request opens or changes in a
   * repository with Production Review on, by "@oneuptime production review",
   * or by Review again in Code. Run by the OneUptime SERVER, never by a
   * Runner (isRunByServer): it clones nothing, runs nothing and changes
   * nothing, and its one task per pull request is reviewed again in place.
   */
  GitHubPullRequestProductionReview = "GitHubPullRequestProductionReview",
  /*
   * Do what a person asked, in their own words, in one repository: started
   * from that repository's page in Code, or as a reply in any task's
   * conversation there (Common/Server/Utils/AI/CodeTask). The request, the
   * context the person added (notes, links, files, OneUptime records) and,
   * for a reply, the conversation so far are captured into
   * AIRun.taskContext.request; the repository is AIRun.codeRepositoryId.
   *
   * A reply (AIRun.codeTaskId set) builds on the task's open pull request:
   * it checks out that pull request's branch and pushes to it. A first
   * request, or a reply in a task with no open pull request, works on a new
   * branch and opens a pull request only when it changes code. It may also
   * just answer, or ask the person a question, and change nothing.
   */
  CodeRequest = "CodeRequest",
}

export default CodeFixTaskType;

/*
 * What a queued run of a recipe must CARRY to be executable — the claim
 * guard and the task-details endpoint both group recipes by this, so a new
 * recipe declares its context kind exactly once.
 */
export enum CodeFixContextKind {
  // Executes against AIRun.triggeredByTelemetryExceptionId.
  TelemetryException = "TelemetryException",
  // Executes against AIRun.triggeredByIncidentId / triggeredByAlertId.
  IncidentOrAlertSubject = "IncidentOrAlertSubject",
  /*
   * Executes against evidence captured at trigger time into
   * AIRun.taskContext (FixPerformance: traceId + span-tree findings) — no
   * subject row exists at all.
   */
  TaskContext = "TaskContext",
}

export class CodeFixTaskTypeHelper {
  /*
   * The recipes a user may start today FROM THE EXCEPTION PAGE. Recipes
   * outside this list exist as enum values so the worker/UI can already
   * dispatch on them, but creation via the exception-page endpoint is
   * server-rejected. ImproveInstrumentation, FixFromIncident and
   * FixPerformance stay off this list by design — they are not
   * exception-triggered at all: ImproveInstrumentation's trigger is an
   * inconclusive AI investigation on an opted-in project,
   * FixFromIncident is user-triggered from the investigation panel
   * (POST /ai-investigation/create-fix-task), and FixPerformance is
   * user-triggered from the trace view
   * (POST /ai-investigation/create-performance-fix-task).
   */
  public static getUserTriggerableTaskTypes(): Array<CodeFixTaskType> {
    return [
      CodeFixTaskType.FixException,
      CodeFixTaskType.WriteRegressionTest,
      CodeFixTaskType.ImproveExceptionHandling,
    ];
  }

  public static isUserTriggerable(taskType: CodeFixTaskType): boolean {
    return this.getUserTriggerableTaskTypes().includes(taskType);
  }

  /*
   * Which context record a queued run of this recipe must carry to be
   * executable. The claim guard rejects runs missing their kind's record,
   * and the task-details endpoint dispatches its response shape on it.
   * Unlisted (and legacy-null-normalized) recipes are exception-based —
   * the safe default, since an exception-less claim of one is unexecutable.
   */
  public static getContextKind(taskType: CodeFixTaskType): CodeFixContextKind {
    switch (taskType) {
      case CodeFixTaskType.ImproveInstrumentation:
      case CodeFixTaskType.FixFromIncident:
        return CodeFixContextKind.IncidentOrAlertSubject;
      case CodeFixTaskType.FixPerformance:
      case CodeFixTaskType.ImproveLogging:
      case CodeFixTaskType.ImproveTracing:
      case CodeFixTaskType.GitHubIssueFix:
      case CodeFixTaskType.GitHubPullRequestRevision:
      case CodeFixTaskType.GitHubPullRequestReview:
      case CodeFixTaskType.GitHubPullRequestProductionReview:
      case CodeFixTaskType.CodeRequest:
        return CodeFixContextKind.TaskContext;
      default:
        return CodeFixContextKind.TelemetryException;
    }
  }

  /*
   * Whether the recipe executes against a telemetry exception
   * (AIRun.triggeredByTelemetryExceptionId). Kept as sugar over
   * getContextKind — the claim guard and the task-details endpoint now
   * dispatch on the full context kind.
   */
  public static requiresTelemetryException(taskType: CodeFixTaskType): boolean {
    return (
      this.getContextKind(taskType) === CodeFixContextKind.TelemetryException
    );
  }

  /*
   * The recipes triggered from a GitHub conversation rather than from
   * OneUptime. They share a context shape (AIRun.taskContext.github), a
   * task-details endpoint, and the rule that their outcome is reported back
   * into the thread they came from.
   */
  public static getGitHubTaskTypes(): Array<CodeFixTaskType> {
    return [
      CodeFixTaskType.GitHubIssueFix,
      CodeFixTaskType.GitHubPullRequestRevision,
      CodeFixTaskType.GitHubPullRequestReview,
    ];
  }

  public static isGitHubTaskType(taskType: CodeFixTaskType): boolean {
    return this.getGitHubTaskTypes().includes(taskType);
  }

  /*
   * Whether a recipe can open a NEW pull request. The per-repository open-PR
   * cap exists to bound how many unreviewed AI pull requests a reviewer has
   * to wade through, so it applies to recipes that ADD to that queue.
   *
   * A revision pushes to a pull request that is already open and already
   * counted; a review writes nothing at all. Counting either against the cap
   * would mean a repository at its cap could never have its existing AI pull
   * requests improved or reviewed — the exact work that clears the cap.
   */
  public static opensNewPullRequest(taskType: CodeFixTaskType): boolean {
    return (
      taskType !== CodeFixTaskType.GitHubPullRequestRevision &&
      taskType !== CodeFixTaskType.GitHubPullRequestReview &&
      taskType !== CodeFixTaskType.GitHubPullRequestProductionReview
    );
  }

  /*
   * The recipes the OneUptime server carries out itself, never a Runner.
   * They are queued as code-fix runs so that they live in Code beside the
   * rest - a repository's tasks, their pages, their AI usage - but no
   * Runner is ever handed one: getTaskTypesForRunnersThatDoNotSay and
   * readSupportedTaskTypes leave them out, whatever a Runner says it can do,
   * and the queue sweepers that fail a run no Runner took pass them by.
   */
  public static getServerRunTaskTypes(): Array<CodeFixTaskType> {
    return [CodeFixTaskType.GitHubPullRequestProductionReview];
  }

  public static isRunByServer(
    taskType: CodeFixTaskType | string | null | undefined,
  ): boolean {
    return (
      typeof taskType === "string" &&
      (this.getServerRunTaskTypes() as Array<string>).includes(taskType)
    );
  }

  // Every recipe a Runner may be handed: all but those the server runs.
  public static getRunnerTaskTypes(): Array<CodeFixTaskType> {
    return Object.values(CodeFixTaskType).filter(
      (taskType: CodeFixTaskType): boolean => {
        return !CodeFixTaskTypeHelper.isRunByServer(taskType);
      },
    );
  }

  // A production review of a pull request (one task per pull request).
  public static isProductionReview(
    taskType: CodeFixTaskType | string | null | undefined,
  ): boolean {
    return taskType === CodeFixTaskType.GitHubPullRequestProductionReview;
  }

  /*
   * The recipe a person starts by asking, in Code: a repository's request
   * box, or a reply in a task's conversation.
   */
  public static isCodeRequest(
    taskType: CodeFixTaskType | string | null | undefined,
  ): boolean {
    return taskType === CodeFixTaskType.CodeRequest;
  }

  /*
   * The recipes a Runner that does not say which it can do is given.
   *
   * A Runner names the recipes it has a handler for when it asks for work
   * (get-pending-task's `supportedTaskTypes`). One built before it did can
   * still be online, and handed a recipe it has no handler for it fails the
   * run at once ("No handler registered"). So such a Runner is only given
   * the recipes every Runner has had - every recipe but the ones added since.
   * A request from Code waits for a Runner that can do it instead. The
   * recipes the server runs itself are never a Runner's (isRunByServer).
   */
  public static getTaskTypesForRunnersThatDoNotSay(): Array<CodeFixTaskType> {
    return CodeFixTaskTypeHelper.getRunnerTaskTypes().filter(
      (taskType: CodeFixTaskType): boolean => {
        return taskType !== CodeFixTaskType.CodeRequest;
      },
    );
  }

  /*
   * The recipes a Runner said it can do, read from its request: unknown
   * names are dropped, and an absent or malformed list means it did not say
   * (null). A recipe the server runs itself is dropped too, whatever the
   * Runner says: no Runner may take one.
   */
  public static readSupportedTaskTypes(
    value: unknown,
  ): Array<CodeFixTaskType> | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const supported: Array<CodeFixTaskType> = [];

    for (const entry of value) {
      if (
        typeof entry === "string" &&
        CodeFixTaskTypeHelper.isValidTaskType(entry) &&
        !CodeFixTaskTypeHelper.isRunByServer(entry) &&
        !supported.includes(entry)
      ) {
        supported.push(entry);
      }
    }

    return supported;
  }

  public static isValidTaskType(value: string): value is CodeFixTaskType {
    return Object.values(CodeFixTaskType).includes(value as CodeFixTaskType);
  }

  // Null means FixException: rows created before the column existed.
  public static fromDatabaseValue(
    value: CodeFixTaskType | string | null | undefined,
  ): CodeFixTaskType {
    if (value && this.isValidTaskType(value.toString())) {
      return value as CodeFixTaskType;
    }

    return CodeFixTaskType.FixException;
  }
}
