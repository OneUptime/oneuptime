import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskContext, {
  CodeHostPullRequestTaskContext,
  GitHubTaskContext,
  getProductionReviewTaskContext,
  getReviewedPullRequest,
  ProductionReviewTaskContext,
  ReviewedPullRequest,
} from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import { CodeTaskOutcome } from "../../../../Types/AI/CodeTask";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import GitHubCommandType from "../../../../Types/CodeRepository/GitHubCommand";
import { ProductionReviewTrigger } from "../../../../Types/CodeRepository/ProductionReview";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE PRODUCTION REVIEWS WAITING TO BE DONE, AND WHAT EACH IS ASKED.
 *
 * A pull request has ONE production review task - a code-fix run of the
 * GitHubPullRequestProductionReview recipe, its repository's, named by the
 * pull request in its context (`github` on GitHub, `codeHostPullRequest`
 * on GitLab, Forgejo and Gitea) - reviewed again in place every time it is
 * asked: a push, a command, Review again. The same task, so the pull
 * request's one comment and its one page in Code always show the latest.
 *
 *   - request() records the ask under a lock on the pull request: a task
 *     for it, Queued, or the ask added to the one it has (requestNumber).
 *     A burst of pushes asks five times and is reviewed once: a review
 *     waits DEBOUNCE_SECONDS after the latest ask before it is due.
 *   - claimDue() hands the worker the reviews that are due, each claimed
 *     Queued -> Running by one conditional update (the investigation
 *     queue's), so two workers never review one at once.
 *   - finish() keeps what the review found and, under the same lock, marks
 *     it Completed - or Queued again, when it was asked again while it ran,
 *     so the latest push is never left unreviewed.
 *
 * The server does the work (ProductionReviewRunner); no Runner is ever
 * handed one (CodeFixTaskTypeHelper.isRunByServer).
 */

// How long a review waits after the latest ask, so a burst is reviewed once.
export const PRODUCTION_REVIEW_DEBOUNCE_SECONDS: number = 60;

// How long a review that failed waits before it is tried again, and how often.
export const PRODUCTION_REVIEW_RETRY_SECONDS: number = 120;
export const PRODUCTION_REVIEW_MAX_FAILED_ATTEMPTS: number = 2;

// How many reviews one tick looks at, and claims.
const QUEUE_READ_SIZE: number = 100;
export const PRODUCTION_REVIEW_CLAIMS_PER_TICK: number = 10;

const LOCK_NAMESPACE: string = "ProductionReview.pullRequest";

interface ProductionReviewRequestBase {
  projectId: ObjectID;
  codeRepositoryId: ObjectID;
  pullRequestNumber: number;
  pullRequestTitle: string;
  headSha: string;
  isFromFork: boolean;
  trigger: ProductionReviewTrigger;
  // Whether the pull request's author can write to the repository.
  isAuthorTrusted: boolean;
  requestedByLogin?: string | undefined;
  // The person who asked in OneUptime (Review again).
  requestedByUserId?: ObjectID | undefined;
  // Due at once: a person asked and waits. A push waits a little.
  isImmediate?: boolean | undefined;
}

// A GitHub pull request, reached through the App's installation.
export interface GitHubProductionReviewRequest
  extends ProductionReviewRequestBase {
  provider?: CodeRepositoryType.GitHub | undefined;
  installationId: string;
  organizationName: string;
  repositoryName: string;
}

/*
 * A merge request on GitLab, or a pull request on Forgejo or Gitea, reached
 * through the repository's connection.
 */
export interface CodeHostProductionReviewRequest
  extends ProductionReviewRequestBase {
  provider: CodeRepositoryType.GitLab | CodeRepositoryType.Forgejo;
  // Its page on the host; an ask that does not say keeps the one known.
  pullRequestUrl?: string | undefined;
}

export type ProductionReviewRequest =
  | GitHubProductionReviewRequest
  | CodeHostProductionReviewRequest;

// Whether an ask is for a pull request on GitLab, Forgejo or Gitea.
export function isCodeHostReviewRequest(
  request: ProductionReviewRequest,
): request is CodeHostProductionReviewRequest {
  return (
    request.provider === CodeRepositoryType.GitLab ||
    request.provider === CodeRepositoryType.Forgejo
  );
}

// What a finished review keeps of itself for the next one.
export interface ProductionReviewContextUpdate {
  commentId?: number | undefined;
  commentUrl?: string | undefined;
  commentPosting?: ProductionReviewTaskContext["commentPosting"];
  reviewedHeadSha?: string | undefined;
  checkRunId?: number | undefined;
  checkRunHeadSha?: string | undefined;
  aiReadDay?: string | undefined;
  aiReadsToday?: number | undefined;
  aiInputHash?: string | undefined;
}

export type ProductionReviewFinishOutcome =
  | "Completed"
  | "QueuedAgain"
  | "Gone";

/*
 * The selected fields every step reads - the outcome too: a review keeps
 * the last one's AI read when nothing it read changed.
 */
const RUN_SELECT: {
  _id: true;
  projectId: true;
  status: true;
  attemptCount: true;
  taskContext: true;
  taskOutcome: true;
  codeRepositoryId: true;
  createdAt: true;
} = {
  _id: true,
  projectId: true,
  status: true,
  attemptCount: true,
  taskContext: true,
  taskOutcome: true,
  codeRepositoryId: true,
  createdAt: true,
};

function nowIso(): string {
  return OneUptimeDate.getCurrentDate().toISOString();
}

// A pull request's title as a task's title: one line, held to its length.
export function toTaskTitle(title: string): string {
  const oneLine: string = (title || "").split(/\s+/).join(" ").trim();
  const max: number = 120;

  return oneLine.length > max
    ? `${oneLine.substring(0, max - 1).trimEnd()}…`
    : oneLine;
}

/*
 * When a review is due: DEBOUNCE_SECONDS after the ask that it answers - or,
 * after a failure, RETRY_SECONDS after that.
 */
export function getDueAt(review: ProductionReviewTaskContext): Date {
  const requestedAt: Date = new Date(review.requestedAt);

  return OneUptimeDate.addRemoveSeconds(
    Number.isNaN(requestedAt.getTime())
      ? OneUptimeDate.getCurrentDate()
      : requestedAt,
    PRODUCTION_REVIEW_DEBOUNCE_SECONDS,
  );
}

export default class ProductionReviewQueue {
  /*
   * The pull request's review task, or null: the first run of the recipe in
   * the repository whose context names the pull request - under `github`
   * for a GitHub repository, `codeHostPullRequest` for any other.
   */
  @CaptureSpan()
  public static async findTask(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
    pullRequestNumber: number;
    provider?: CodeRepositoryType | undefined;
  }): Promise<AIRun | null> {
    const isOtherHost: boolean =
      data.provider === CodeRepositoryType.GitLab ||
      data.provider === CodeRepositoryType.Forgejo;

    return await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: CodeFixTaskType.GitHubPullRequestProductionReview,
        codeRepositoryId: data.codeRepositoryId,
        codeTaskId: QueryHelper.isNull(),
        taskContext: QueryHelper.jsonContains(
          isOtherHost
            ? {
                codeHostPullRequest: {
                  pullRequestNumber: data.pullRequestNumber,
                },
              }
            : { github: { pullRequestNumber: data.pullRequestNumber } },
        ),
      } as never,
      select: RUN_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
  }

  /*
   * Ask for a review of the pull request: its task, created or asked
   * again. Never throws for a lock it cannot take (Valkey down): the ask
   * is then recorded without it, as a turn of a task is.
   */
  @CaptureSpan()
  public static async request(data: ProductionReviewRequest): Promise<AIRun> {
    const mutex: SemaphoreMutex | null = await ProductionReviewQueue.lock(
      data.codeRepositoryId,
      data.pullRequestNumber,
    );

    try {
      const task: AIRun | null = await ProductionReviewQueue.findTask(data);

      if (!task) {
        return await ProductionReviewQueue.createTask(data);
      }

      const current: ProductionReviewTaskContext | null =
        getProductionReviewTaskContext(task.taskContext);

      const review: ProductionReviewTaskContext = {
        ...(current || {}),
        requestNumber: (current?.requestNumber || 0) + 1,
        requestedAt: ProductionReviewQueue.getRequestedAt(data),
        headSha: data.headSha,
        trigger: data.trigger,
        isAuthorTrusted: data.isAuthorTrusted,
        failedAttempts: 0,
      };

      if (data.requestedByLogin) {
        review.requestedByLogin = data.requestedByLogin;
      } else {
        delete review.requestedByLogin;
      }

      const taskContext: CodeFixTaskContext = isCodeHostReviewRequest(data)
        ? {
            ...(task.taskContext || {}),
            codeHostPullRequest: ProductionReviewQueue.buildCodeHostContext(
              data,
              task.taskContext?.codeHostPullRequest,
            ),
            productionReview: review,
          }
        : {
            ...(task.taskContext || {}),
            github: {
              ...ProductionReviewQueue.buildGitHubContext(data),
              ...ProductionReviewQueue.keptGitHubFields(
                task.taskContext?.github,
              ),
            },
            productionReview: review,
          };

      const status: AIRunStatus = task.status || AIRunStatus.Queued;
      const isDone: boolean =
        AIRunStatusHelper.terminalStatuses().includes(status);

      /*
       * Done: queued again. Queued: due later, and it reads the pull
       * request as it is then. Running: queued again when it finishes
       * (finish() sees the newer ask).
       */
      const queued: number = isDone
        ? await AIRunService.attemptStatusTransition({
            aiRunId: task.id!,
            fromStatus: status,
            set: {
              status: AIRunStatus.Queued,
              taskContext: taskContext,
              errorMessage: "",
            },
          })
        : 0;

      await AIRunService.updateOneById({
        id: task.id!,
        data: {
          ...(queued === 1 ? {} : { taskContext: taskContext }),
          title: toTaskTitle(data.pullRequestTitle),
        } as never,
        props: { isRoot: true },
      });

      if (queued === 1) {
        task.status = AIRunStatus.Queued;
      }

      task.taskContext = taskContext;
      return task;
    } finally {
      await ProductionReviewQueue.unlock(mutex);
    }
  }

  /*
   * The reviews due now, claimed for this worker: Queued, past their wait,
   * oldest first. Each claim is one conditional update on the status and
   * the attempt count, so a review another worker took is passed over.
   */
  @CaptureSpan()
  public static async claimDue(): Promise<Array<AIRun>> {
    const waiting: Array<AIRun> = await AIRunService.findBy({
      query: {
        runType: AIRunType.CodeFix,
        codeFixTaskType: CodeFixTaskType.GitHubPullRequestProductionReview,
        status: AIRunStatus.Queued,
      },
      select: RUN_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: QUEUE_READ_SIZE,
      skip: 0,
      props: { isRoot: true },
    });

    const now: Date = OneUptimeDate.getCurrentDate();
    const claimed: Array<AIRun> = [];

    for (const run of waiting) {
      if (claimed.length >= PRODUCTION_REVIEW_CLAIMS_PER_TICK) {
        break;
      }

      const review: ProductionReviewTaskContext | null =
        getProductionReviewTaskContext(run.taskContext);

      if (!review) {
        // Nothing to review: no pull request, or no ask.
        await AIRunService.attemptStatusTransition({
          aiRunId: run.id!,
          fromStatus: AIRunStatus.Queued,
          set: {
            status: AIRunStatus.Error,
            completedAt: now,
            errorMessage:
              "This production review does not say which pull request to review.",
          },
        });
        continue;
      }

      if (getDueAt(review) > now) {
        continue;
      }

      const won: number = await AIRunService.attemptStatusTransition({
        aiRunId: run.id!,
        fromStatus: AIRunStatus.Queued,
        expectedAttemptCount: run.attemptCount || 0,
        set: {
          status: AIRunStatus.Running,
          startedAt: now,
          lastHeartbeatAt: now,
          attemptCount: (run.attemptCount || 0) + 1,
        },
      });

      if (won === 1) {
        run.status = AIRunStatus.Running;
        run.attemptCount = (run.attemptCount || 0) + 1;
        claimed.push(run);
      }
    }

    return claimed;
  }

  /*
   * Keep what a review found, and end it: Completed, or Queued again when
   * the pull request was asked about again while it ran (a push that came
   * during the review is reviewed next). Under the pull request's lock, so
   * an ask that arrives now is never lost between the read and the write.
   */
  @CaptureSpan()
  public static async finish(data: {
    run: AIRun;
    // The ask the review answered: the requestNumber it started from.
    requestNumber: number;
    outcome: CodeTaskOutcome | null;
    update: ProductionReviewContextUpdate;
    // Set when the review ended without reviewing (a closed pull request).
    errorMessage?: string | undefined;
  }): Promise<ProductionReviewFinishOutcome> {
    const mutex: SemaphoreMutex | null =
      await ProductionReviewQueue.lockReviewOf(data.run);

    try {
      const current: AIRun | null = await AIRunService.findOneById({
        id: data.run.id!,
        select: RUN_SELECT,
        props: { isRoot: true },
      });

      if (!current || current.status !== AIRunStatus.Running) {
        // Stopped, or taken back by the stale sweep, while it ran.
        return "Gone";
      }

      const review: ProductionReviewTaskContext | null =
        getProductionReviewTaskContext(current.taskContext);

      const merged: ProductionReviewTaskContext | undefined = review
        ? {
            ...review,
            ...ProductionReviewQueue.definedFields(data.update),
            failedAttempts: 0,
          }
        : undefined;

      const taskContext: CodeFixTaskContext = {
        ...(current.taskContext || {}),
        ...(merged ? { productionReview: merged } : {}),
      };

      const askedAgain: boolean = Boolean(
        review && review.requestNumber > data.requestNumber,
      );

      const now: Date = OneUptimeDate.getCurrentDate();

      await AIRunService.attemptStatusTransition({
        aiRunId: current.id!,
        fromStatus: AIRunStatus.Running,
        set: {
          status: askedAgain ? AIRunStatus.Queued : AIRunStatus.Completed,
          taskContext,
          ...(data.outcome ? { taskOutcome: data.outcome } : {}),
          ...(askedAgain ? {} : { completedAt: now }),
          errorMessage: data.errorMessage || "",
        },
      });

      return askedAgain ? "QueuedAgain" : "Completed";
    } finally {
      await ProductionReviewQueue.unlock(mutex);
    }
  }

  /*
   * A review that failed - GitHub or the database could not be reached -
   * is tried again a little later, a few times; then it ends with why. A
   * later push asks again either way.
   */
  @CaptureSpan()
  public static async fail(data: {
    run: AIRun;
    requestNumber: number;
    errorMessage: string;
    isRetryable: boolean;
  }): Promise<void> {
    const mutex: SemaphoreMutex | null =
      await ProductionReviewQueue.lockReviewOf(data.run);

    try {
      const current: AIRun | null = await AIRunService.findOneById({
        id: data.run.id!,
        select: RUN_SELECT,
        props: { isRoot: true },
      });

      if (!current || current.status !== AIRunStatus.Running) {
        return;
      }

      const review: ProductionReviewTaskContext | null =
        getProductionReviewTaskContext(current.taskContext);
      const askedAgain: boolean = Boolean(
        review && review.requestNumber > data.requestNumber,
      );
      const failedAttempts: number = askedAgain
        ? 0
        : (review?.failedAttempts || 0) + 1;

      const tryAgain: boolean =
        askedAgain ||
        (data.isRetryable &&
          failedAttempts < PRODUCTION_REVIEW_MAX_FAILED_ATTEMPTS);

      const taskContext: CodeFixTaskContext = {
        ...(current.taskContext || {}),
        ...(review
          ? {
              productionReview: {
                ...review,
                failedAttempts,
                /*
                 * Due RETRY_SECONDS from now: requestedAt is when the wait
                 * starts, and the wait is DEBOUNCE_SECONDS.
                 */
                ...(askedAgain
                  ? {}
                  : {
                      requestedAt: OneUptimeDate.addRemoveSeconds(
                        OneUptimeDate.getCurrentDate(),
                        PRODUCTION_REVIEW_RETRY_SECONDS -
                          PRODUCTION_REVIEW_DEBOUNCE_SECONDS,
                      ).toISOString(),
                    }),
              },
            }
          : {}),
      };

      await AIRunService.attemptStatusTransition({
        aiRunId: current.id!,
        fromStatus: AIRunStatus.Running,
        set: tryAgain
          ? {
              status: AIRunStatus.Queued,
              taskContext,
            }
          : {
              status: AIRunStatus.Error,
              taskContext,
              completedAt: OneUptimeDate.getCurrentDate(),
              errorMessage: data.errorMessage.substring(0, 1000),
            },
      });
    } finally {
      await ProductionReviewQueue.unlock(mutex);
    }
  }

  /*
   * A review whose worker stopped heartbeating (it died mid-review) is
   * queued again: a review only reads, so doing it again is safe.
   */
  @CaptureSpan()
  public static async requeueStale(run: { id: ObjectID }): Promise<number> {
    return await AIRunService.attemptStatusTransition({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Running,
      set: { status: AIRunStatus.Queued },
    });
  }

  private static async createTask(
    data: ProductionReviewRequest,
  ): Promise<AIRun> {
    const run: AIRun = new AIRun();
    run.projectId = data.projectId;
    run.runType = AIRunType.CodeFix;
    run.codeFixTaskType = CodeFixTaskType.GitHubPullRequestProductionReview;
    run.status = AIRunStatus.Queued;
    run.codeRepositoryId = data.codeRepositoryId;
    run.title = toTaskTitle(data.pullRequestTitle);

    if (data.requestedByUserId) {
      run.userId = data.requestedByUserId;
    }

    const review: ProductionReviewTaskContext = {
      requestNumber: 1,
      requestedAt: ProductionReviewQueue.getRequestedAt(data),
      headSha: data.headSha,
      trigger: data.trigger,
      isAuthorTrusted: data.isAuthorTrusted,
    };

    if (data.requestedByLogin) {
      review.requestedByLogin = data.requestedByLogin;
    }

    run.taskContext = isCodeHostReviewRequest(data)
      ? {
          codeHostPullRequest: ProductionReviewQueue.buildCodeHostContext(
            data,
            undefined,
          ),
          productionReview: review,
        }
      : {
          github: ProductionReviewQueue.buildGitHubContext(data),
          productionReview: review,
        };

    return await AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }

  /*
   * A pull request on GitLab, Forgejo or Gitea, as its task names it - with
   * the page an earlier ask gave, when this one does not say.
   */
  private static buildCodeHostContext(
    data: CodeHostProductionReviewRequest,
    earlier: CodeHostPullRequestTaskContext | undefined,
  ): CodeHostPullRequestTaskContext {
    const context: CodeHostPullRequestTaskContext = {
      codeRepositoryId: data.codeRepositoryId.toString(),
      provider: data.provider,
      pullRequestNumber: data.pullRequestNumber,
      isPullRequestFromFork: data.isFromFork,
    };

    const url: string | undefined =
      data.pullRequestUrl || earlier?.pullRequestUrl || undefined;

    if (url) {
      context.pullRequestUrl = url;
    }

    if (data.requestedByLogin) {
      context.triggeredByLogin = data.requestedByLogin;
    }

    return context;
  }

  private static buildGitHubContext(
    data: GitHubProductionReviewRequest,
  ): GitHubTaskContext {
    const github: GitHubTaskContext = {
      codeRepositoryId: data.codeRepositoryId.toString(),
      installationId: data.installationId,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
      commandType: GitHubCommandType.ProductionReview,
      instruction: "",
      pullRequestNumber: data.pullRequestNumber,
      isPullRequestFromFork: data.isFromFork,
    };

    if (data.requestedByLogin) {
      github.triggeredByLogin = data.requestedByLogin;
    }

    return github;
  }

  // What an earlier ask's GitHub context keeps that a new one does not say.
  private static keptGitHubFields(
    github: GitHubTaskContext | undefined,
  ): Partial<GitHubTaskContext> {
    return github?.acknowledgementCommentId
      ? { acknowledgementCommentId: github.acknowledgementCommentId }
      : {};
  }

  /*
   * When an ask starts its wait: now - or, for a person who asked and
   * waits, as long ago as the wait, so it is due at once.
   */
  private static getRequestedAt(data: ProductionReviewRequest): string {
    if (data.isImmediate) {
      return OneUptimeDate.addRemoveSeconds(
        OneUptimeDate.getCurrentDate(),
        -PRODUCTION_REVIEW_DEBOUNCE_SECONDS,
      ).toISOString();
    }

    return nowIso();
  }

  private static definedFields(
    update: ProductionReviewContextUpdate,
  ): Partial<ProductionReviewTaskContext> {
    const fields: Partial<ProductionReviewTaskContext> = {};

    for (const [key, value] of Object.entries(update)) {
      if (value !== undefined) {
        (fields as Record<string, unknown>)[key] = value;
      }
    }

    return fields;
  }

  /*
   * The lock on the pull request a run reviews, whichever host it is on -
   * or none for a run that names none.
   */
  private static async lockReviewOf(
    run: AIRun,
  ): Promise<SemaphoreMutex | null> {
    const reviewed: ReviewedPullRequest | null = getReviewedPullRequest(
      run.taskContext,
    );

    if (!reviewed) {
      return null;
    }

    return await ProductionReviewQueue.lock(
      run.codeRepositoryId || new ObjectID(reviewed.codeRepositoryId),
      reviewed.number,
    );
  }

  private static async lock(
    codeRepositoryId: ObjectID,
    pullRequestNumber: number,
  ): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: `${codeRepositoryId.toString()}:${pullRequestNumber}`,
        namespace: LOCK_NAMESPACE,
        lockTimeout: 15000,
      });
    } catch (error) {
      logger.error(
        `Could not lock the production review of ${codeRepositoryId.toString()}#${pullRequestNumber}; going ahead without the lock: ${error}`,
      );
      return null;
    }
  }

  private static async unlock(mutex: SemaphoreMutex | null): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (error) {
      logger.error(error);
    }
  }
}
