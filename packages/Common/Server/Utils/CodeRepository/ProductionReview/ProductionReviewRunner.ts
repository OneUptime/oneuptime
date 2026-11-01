import { DashboardClientUrl } from "../../../EnvironmentConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import AIService from "../../../Services/AIService";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../AI/LlmProviderChoice";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import GitHubRunReply from "../GitHub/GitHubRunReply";
import { CODE_HOST_REPOSITORY_SELECT } from "../CodeHost/CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../CodeHost/CodeHostHttp";
import {
  CodeHostChangedFile,
  CodeHostChangedFiles,
  CodeHostComment,
  CodeHostPullRequestDetails,
} from "../CodeHost/CodeHostTypes";
import ProductionReviewHosts, {
  ProductionReviewHost,
} from "./ProductionReviewHost";
import { CodeAgentScopedService } from "../../AI/CodeFix/CodeAgentTelemetryScope";
import ProductionReviewAI, {
  ProductionReviewAiResult,
} from "./ProductionReviewAI";
import ProductionReviewComposer, {
  ProductionReviewCheckRunText,
  ProductionReviewCommentInput,
} from "./ProductionReviewComposer";
import { GitHubCheckRunWritten } from "../GitHub/GitHubCheckRuns";
import { ChangedCode, readChangedCode } from "./ProductionReviewDiff";
import ProductionReviewFindings, {
  ProductionReviewFindingsResult,
} from "./ProductionReviewFindings";
import ProductionReviewQueue, {
  ProductionReviewContextUpdate,
} from "./ProductionReviewQueue";
import ProductionReviewRepositoryProfile, {
  RepositoryProductionProfile,
} from "./ProductionReviewRepositoryProfile";
import ProductionReviewScope, {
  ProductionReviewScopeResult,
} from "./ProductionReviewScope";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import {
  GitHubTaskContext,
  getGitHubTaskContext,
  getProductionReviewTaskContext,
  getReviewedPullRequest,
  ProductionReviewTaskContext,
  ReviewedPullRequest,
} from "../../../../Types/AI/CodeFixTaskContext";
import {
  CodeHost,
  PullRequestTerm,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { CodeTaskOutcome } from "../../../../Types/AI/CodeTask";
import {
  PRODUCTION_REVIEW_LIMITS,
  ProductionReviewAiNoteCode,
  ProductionReviewPosting,
  ProductionReviewPointJSON,
  ProductionReviewReport,
  ProductionReviewTrigger,
  ProductionReviewUtil,
} from "../../../../Types/CodeRepository/ProductionReview";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * ONE PRODUCTION REVIEW, DONE.
 *
 * A review the queue claimed (ProductionReviewQueue.claimDue) is carried
 * out here, on the OneUptime server: nothing is cloned and nothing the pull
 * request holds is run. In order:
 *
 *   1. The repository, still connected to the project - through the
 *      GitHub App, or its GitLab, Forgejo or Gitea connection - and still
 *      asking for reviews when OneUptime started this one on its own.
 *   2. The pull request as it is now - open, its head, its files and their
 *      diff - read from its host (ProductionReviewHost). A closed one is
 *      not reviewed; a draft is reviewed only when someone asked.
 *   3. What its code is in production: the services the repository serves
 *      (ProductionReviewScope), what production does with their code
 *      (ProductionReviewRepositoryProfile, shared by the repository's pull
 *      requests), matched against the change (ProductionReviewFindings).
 *   4. OneUptime AI's read of what to watch, when production says something
 *      and AI may run (ProductionReviewAI).
 *   5. The pull request's one comment, written or edited - the review, a
 *      link to it on a public repository, or nothing at all when OneUptime
 *      started the review, production has nothing to say about the change
 *      and no comment was there before (ProductionReviewComposer).
 *   6. The review kept on the task - its page in Code - and the task done,
 *      or queued again when the pull request was asked about while it ran.
 */

// The files of a pull request read from its host.
const MAX_FILES_READ: number = PRODUCTION_REVIEW_LIMITS.maxFilesRead;

// A repository's AI reads of the day are counted under this cache name.
const AI_READS_NAMESPACE: string = "production-review-ai-reads";

// Why a review did not post: kept on the task as its error message.
export const PULL_REQUEST_CLOSED_MESSAGE: string =
  "The pull request is closed, so it was not reviewed.";
export const PULL_REQUEST_DRAFT_MESSAGE: string =
  "The pull request is a draft. It is reviewed once it is marked ready for review, or when someone asks.";
export const PRODUCTION_REVIEW_OFF_MESSAGE: string =
  "Production review was turned off for this repository before this review started.";
export const REPOSITORY_NOT_CONNECTED_MESSAGE: string =
  "This repository is no longer connected to the project through the GitHub App.";

// Why a review ended failed: kept once it was tried again and failed again.
export const PRODUCTION_REVIEW_FAILED_MESSAGE: () => string = (): string => {
  return getProductionReviewFailedMessage("pull request");
};

// The name a review's check run has in a pull request's checks.
export function getProductionReviewCheckName(): string {
  return `${ProductBrandingText.getProductName()} production review`;
}

// The host's word for a pull request: GitLab's merge request.
export function getPullRequestTerm(
  provider: CodeRepositoryType | string | null | undefined,
): PullRequestTerm {
  return CodeHost.getFacts(provider).pullRequestTerm;
}

/*
 * The same sentences in the host's words: "The merge request is closed"
 * on GitLab. GitHub's are the constants above, word for word.
 */
export function getPullRequestClosedMessage(term: PullRequestTerm): string {
  return `The ${term} is closed, so it was not reviewed.`;
}

export function getPullRequestDraftMessage(term: PullRequestTerm): string {
  return `The ${term} is a draft. It is reviewed once it is marked ready for review, or when someone asks.`;
}

export function getProductionReviewFailedMessage(
  term: PullRequestTerm,
): string {
  return `${ProductBrandingText.getProductName()} could not finish this production review, even after trying again. A push to the ${term}, or Review again, starts a new one.`;
}

/*
 * Why a repository's review was not done: it is no longer reached the
 * way it was connected - GitHub's App installation, or the connection of
 * a repository on GitLab, Forgejo or Gitea (a token refused, a connection
 * gone).
 */
export function getRepositoryNotConnectedMessage(
  provider: CodeRepositoryType | string | null | undefined,
): string {
  const type: CodeRepositoryType = CodeHost.readType(provider);

  if (type === CodeRepositoryType.GitHub) {
    return REPOSITORY_NOT_CONNECTED_MESSAGE;
  }

  return `This repository's connection to ${CodeHost.getFacts(type).name} no longer works - its access token was refused, or the connection is gone - so it was not reviewed.`;
}

/*
 * Whether a host refused to let the token comment (403): the token may not
 * write there, which trying again does not change.
 */
export function isCommentRefusal(error: unknown): boolean {
  return (
    error instanceof CodeHostHttpError &&
    error.kind === CodeHostHttpErrorKind.Forbidden
  );
}

// What one review leaves behind.
export interface ProductionReviewRunResult {
  report: ProductionReviewReport | null;
  posted: ProductionReviewPosting;
  skippedBecause?: string | undefined;
}

// Today, as the AI read limits count days: the UTC date.
export function getUtcDay(now: Date): string {
  return now.toISOString().substring(0, 10);
}

export default class ProductionReviewRunner {
  // Every review that is due, one after another.
  @CaptureSpan()
  public static async runDueReviews(): Promise<number> {
    const claimed: Array<AIRun> = await ProductionReviewQueue.claimDue();

    for (const run of claimed) {
      await ProductionReviewRunner.runClaimed(run);
    }

    return claimed.length;
  }

  // One claimed review, to its end: never throws.
  @CaptureSpan()
  public static async runClaimed(run: AIRun): Promise<void> {
    const review: ProductionReviewTaskContext | null =
      getProductionReviewTaskContext(run.taskContext);
    const requestNumber: number = review?.requestNumber || 0;

    try {
      await ProductionReviewRunner.review(run);
    } catch (error) {
      logger.error(
        `Production review ${run.id?.toString()} failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      /*
       * Kept only once it was tried again and failed again: said on the
       * review's page, with what starts a new one.
       */
      await ProductionReviewQueue.fail({
        run,
        requestNumber,
        errorMessage: getProductionReviewFailedMessage(
          getPullRequestTerm(
            getReviewedPullRequest(run.taskContext)?.provider ||
              CodeRepositoryType.GitHub,
          ),
        ),
        isRetryable: true,
      }).catch((failError: unknown) => {
        logger.error(
          `Could not record that production review ${run.id?.toString()} failed: ${failError}`,
        );
      });
    }
  }

  /*
   * The review itself (steps 1-6 above). Throws on a failure worth trying
   * again - a host or a database that could not be reached.
   */
  @CaptureSpan()
  public static async review(run: AIRun): Promise<ProductionReviewRunResult> {
    const review: ProductionReviewTaskContext | null =
      getProductionReviewTaskContext(run.taskContext);
    const reviewed: ReviewedPullRequest | null = getReviewedPullRequest(
      run.taskContext,
    );
    const github: GitHubTaskContext | null = getGitHubTaskContext(
      run.taskContext,
    );

    if (!review || !reviewed || !run.projectId || !run.id) {
      await ProductionReviewQueue.finish({
        run,
        requestNumber: review?.requestNumber || 0,
        outcome: null,
        update: {},
        errorMessage: "This production review does not say what to review.",
      });

      return { report: null, posted: ProductionReviewPosting.None };
    }

    const projectId: ObjectID = run.projectId;
    const term: PullRequestTerm = getPullRequestTerm(reviewed.provider);
    const repository: CodeRepository | null = run.codeRepositoryId
      ? await CodeRepositoryService.findOneBy({
          query: { _id: run.codeRepositoryId.toString(), projectId },
          select: {
            ...CODE_HOST_REPOSITORY_SELECT,
            isProductionReviewEnabled: true,
            productionReviewPullRequestContent: true,
            productionReviewLlmProviderId: true,
          },
          props: { isRoot: true },
        })
      : null;

    const host: ProductionReviewHost | null = repository
      ? await ProductionReviewHosts.open({
          projectId,
          repository,
          provider: reviewed.provider,
          github,
        })
      : null;

    if (!repository || !host) {
      return await ProductionReviewRunner.skip({
        run,
        review,
        message: getRepositoryNotConnectedMessage(reviewed.provider),
      });
    }

    if (
      review.trigger === ProductionReviewTrigger.PullRequestChanged &&
      repository.isProductionReviewEnabled !== true
    ) {
      return await ProductionReviewRunner.skip({
        run,
        review,
        message: PRODUCTION_REVIEW_OFF_MESSAGE,
      });
    }

    const pullRequestNumber: number = reviewed.number;

    const pullRequest: CodeHostPullRequestDetails =
      await host.getPullRequest(pullRequestNumber);

    if (!pullRequest.isOpen) {
      return await ProductionReviewRunner.skip({
        run,
        review,
        message: getPullRequestClosedMessage(term),
      });
    }

    if (
      pullRequest.isDraft &&
      review.trigger === ProductionReviewTrigger.PullRequestChanged
    ) {
      return await ProductionReviewRunner.skip({
        run,
        review,
        message: getPullRequestDraftMessage(term),
      });
    }

    const listed: CodeHostChangedFiles = await host.listFiles({
      pullRequest,
      maxFiles: MAX_FILES_READ,
    });
    const files: Array<CodeHostChangedFile> = listed.files;

    const changed: ChangedCode = readChangedCode({
      files,
      hasMoreFiles: listed.hasMore,
    });

    const now: Date = OneUptimeDate.getCurrentDate();

    const scope: ProductionReviewScopeResult = await ProductionReviewScope.get({
      projectId,
      codeRepositoryId: repository.id!,
    });

    const touched: Array<CodeAgentScopedService> =
      ProductionReviewScope.getTouchedServices({
        services: scope.services,
        changed,
      });

    const profile: RepositoryProductionProfile =
      scope.services.length > 0 && changed.files.length > 0
        ? await ProductionReviewRepositoryProfile.get({
            projectId,
            codeRepositoryId: repository.id!,
            services: scope.services,
          })
        : {
            readAt: now.toISOString(),
            traffic: [],
            operations: [],
            codeLocations: [],
            functions: [],
            suspectDeploys: [],
            unread: [],
          };

    const findings: ProductionReviewFindingsResult =
      await ProductionReviewFindings.find({
        projectId,
        changed,
        services: scope.services,
        touched,
        profile,
        now,
      });

    const report: ProductionReviewReport = {
      pullRequest: {
        number: pullRequestNumber,
        title: pullRequest.title.substring(
          0,
          PRODUCTION_REVIEW_LIMITS.maxTitleLength,
        ),
        url:
          pullRequest.htmlUrl ||
          reviewed.url ||
          (github
            ? `https://github.com/${github.organizationName}/${github.repositoryName}/pull/${pullRequestNumber}`
            : ""),
        authorLogin: pullRequest.authorLogin,
        headSha: pullRequest.headSha,
        baseRefName: pullRequest.baseRefName,
        isFromFork: pullRequest.isFromFork,
        // Its pushes are reviewed on their own only when it is.
        isAuthorTrusted: review.isAuthorTrusted,
      },
      reviewedAt: now.toISOString(),
      trigger: review.trigger,
      changedFileCount: Math.max(
        changed.fileCount,
        pullRequest.changedFilesCount,
      ),
      codeFileCount: changed.codeFileCount,
      ...findings,
      points: [],
      posting: ProductionReviewPosting.None,
    };

    if (scope.services.length === 0 && scope.gap) {
      report.noServicesReason = scope.gap;
    }

    const contextUpdate: ProductionReviewContextUpdate = {
      reviewedHeadSha: pullRequest.headSha,
    };

    await ProductionReviewRunner.addAiRead({
      run,
      review,
      report,
      files,
      changed,
      repositoryId: repository.id!,
      pickedLlmProviderId: repository.productionReviewLlmProviderId,
      now,
      update: contextUpdate,
    });

    await ProductionReviewRunner.post({
      run,
      review,
      host,
      pullRequest,
      repository,
      report,
      update: contextUpdate,
    });

    const outcome: CodeTaskOutcome = {
      summary: ProductionReviewComposer.summarize(report, term),
      filesChanged: [],
      productionReview: report,
    };

    await ProductionReviewQueue.finish({
      run,
      requestNumber: review.requestNumber,
      outcome,
      update: contextUpdate,
    });

    return { report, posted: report.posting };
  }

  /*
   * OneUptime AI's read, added to the report when production says something
   * and AI may run: the project's AI switch is on, the pull request and
   * the repository have reads left today, and the facts and the diff are
   * not the ones the last read answered (whose points are kept instead).
   * It reads with the LLM provider the repository picks for its production
   * reviews, else the project's default provider, else the global one.
   */
  public static async addAiRead(data: {
    run: AIRun;
    review: ProductionReviewTaskContext;
    report: ProductionReviewReport;
    files: Array<CodeHostChangedFile>;
    changed: ChangedCode;
    repositoryId: ObjectID;
    // The repository's pick (CodeRepository.productionReviewLlmProviderId).
    pickedLlmProviderId?: ObjectID | undefined;
    now: Date;
    update: ProductionReviewContextUpdate;
  }): Promise<void> {
    if (!ProductionReviewUtil.hasSignal(data.report)) {
      return;
    }

    const projectId: ObjectID = data.run.projectId!;

    if (!(await AIService.isProjectAIEnabled(projectId))) {
      data.report.aiNote = { code: ProductionReviewAiNoteCode.AiOff };
      return;
    }

    const diffText: string = ProductionReviewAI.buildDiffText({
      files: data.files.map((file: CodeHostChangedFile) => {
        return { path: file.filename, patch: file.patch };
      }),
      changed: data.changed,
    });

    const inputHash: string = ProductionReviewAI.getInputHash({
      report: data.report,
      diffText,
    });

    const previous: ProductionReviewReport | undefined =
      data.run.taskOutcome?.productionReview;
    const previousPoints: Array<ProductionReviewPointJSON> =
      previous?.points || [];

    if (inputHash === data.review.aiInputHash && previousPoints.length > 0) {
      data.report.points = previousPoints;

      // The read they came from, and the provider that made it.
      if (previous?.llmProvider) {
        data.report.llmProvider = previous.llmProvider;
      }

      return;
    }

    const day: string = getUtcDay(data.now);
    const readsToday: number =
      data.review.aiReadDay === day ? data.review.aiReadsToday || 0 : 0;

    if (
      readsToday >= PRODUCTION_REVIEW_LIMITS.maxAiReadsPerPullRequestPerDay ||
      !(await ProductionReviewRunner.takeRepositoryAiRead({
        repositoryId: data.repositoryId,
        day,
      }))
    ) {
      data.report.aiNote = { code: ProductionReviewAiNoteCode.DailyLimit };
      return;
    }

    /*
     * The provider the read uses: the repository's pick when the project
     * may use it and nothing stops it, else what it falls back to - the
     * project's default provider, else the global one (LlmProviderChoice).
     * With no pick nothing more is read: the call resolves the project's
     * provider, as every review did before a repository could pick one.
     */
    const llmProviderChoice: RuleLlmProviderChoice =
      await LlmProviderChoice.decideIfPicked({
        projectId,
        pickedProviderId: data.pickedLlmProviderId,
      });

    /*
     * Which provider reads it, when the repository picks one: the pick, or
     * the provider it falls back to and why - which the review's page says,
     * a pick that could not be used as a warning. With no pick, nothing.
     */
    if (llmProviderChoice.activity) {
      data.report.llmProvider = llmProviderChoice.activity;
    }

    const result: ProductionReviewAiResult = await ProductionReviewAI.read({
      projectId,
      aiRunId: data.run.id!,
      report: data.report,
      diffText,
      llmProviderId: llmProviderChoice.llmProviderId,
    });

    data.report.points = result.points;

    if (result.note) {
      data.report.aiNote = result.note;
    }

    data.update.aiReadDay = day;
    data.update.aiReadsToday = readsToday + 1;

    if (!result.note) {
      data.update.aiInputHash = inputHash;
    }
  }

  /*
   * One of the repository's AI reads of the day, taken - or false when they
   * are used up. A cache that cannot be reached does not stop a read: the
   * project's own daily AI limits still hold.
   */
  public static async takeRepositoryAiRead(data: {
    repositoryId: ObjectID;
    day: string;
  }): Promise<boolean> {
    try {
      const count: number | null = await GlobalCache.incrementIfBelow(
        AI_READS_NAMESPACE,
        `${data.repositoryId.toString()}:${data.day}`,
        {
          limit: PRODUCTION_REVIEW_LIMITS.maxAiReadsPerRepositoryPerDay,
          expiresInSeconds: 2 * 24 * 60 * 60,
        },
      );

      return count !== null;
    } catch (error) {
      logger.debug(
        `Production review: could not count a repository's AI reads, reading anyway: ${error}`,
      );
      return true;
    }
  }

  /*
   * The pull request's one comment: what it shows (the review, or a link on
   * a public repository), written, or the one there edited in place - or
   * nothing, when OneUptime started the review, production has nothing to
   * say about the change, and there is no comment of its own to bring up to
   * date. On GitHub the review is a check run on the pull request's head
   * too (writeCheck), quiet or not: a check is no comment in the thread.
   */
  public static async post(data: {
    run: AIRun;
    review: ProductionReviewTaskContext;
    host: ProductionReviewHost;
    pullRequest: CodeHostPullRequestDetails;
    repository: CodeRepository;
    report: ProductionReviewReport;
    update: ProductionReviewContextUpdate;
  }): Promise<void> {
    const hasSignal: boolean = ProductionReviewUtil.hasSignal(data.report);
    const isQuiet: boolean =
      !hasSignal &&
      !data.review.commentId &&
      data.review.trigger === ProductionReviewTrigger.PullRequestChanged;

    if (isQuiet && !data.host.writeCheckRun) {
      data.report.posting = ProductionReviewPosting.None;
      return;
    }

    const isPublic: boolean | null = await data.host.isRepositoryPublic();

    const posting:
      | ProductionReviewPosting.Review
      | ProductionReviewPosting.Link = ProductionReviewUtil.getPosting({
      content: data.repository.productionReviewPullRequestContent,
      isPublic,
    });

    const input: ProductionReviewCommentInput = {
      report: data.report,
      posting,
      reviewUrl: GitHubRunReply.buildRunUrl({
        projectId: data.run.projectId!,
        aiRunId: data.run.id!,
      }),
      dashboardUrl: DashboardClientUrl.toString(),
      projectId: data.run.projectId!.toString(),
      productName: ProductBrandingText.getProductName(),
      reviewCommand: await data.host.getReviewCommand(),
      updatesOnPush:
        data.review.isAuthorTrusted &&
        data.repository.isProductionReviewEnabled === true,
      isPublicRepository: isPublic,
      pullRequestTerm: data.host.pullRequestTerm,
      asksAgainInProduct: data.host.provider !== CodeRepositoryType.GitHub,
    };

    if (isQuiet) {
      data.report.posting = ProductionReviewPosting.None;
    } else {
      await ProductionReviewRunner.writeComment({ ...data, input });
    }

    await ProductionReviewRunner.writeCheck({ ...data, input });
  }

  // The review's comment, as `post` decided it.
  private static async writeComment(data: {
    run: AIRun;
    review: ProductionReviewTaskContext;
    host: ProductionReviewHost;
    pullRequest: CodeHostPullRequestDetails;
    report: ProductionReviewReport;
    update: ProductionReviewContextUpdate;
    input: ProductionReviewCommentInput;
  }): Promise<void> {
    const posting: ProductionReviewPosting = data.input.posting;

    data.report.posting = posting;
    data.report.isPublicRepository = data.input.isPublicRepository === true;

    const body: string = ProductionReviewComposer.compose(data.input);

    let comment: CodeHostComment;

    try {
      comment = await data.host.writeComment({
        pullRequest: {
          number: data.pullRequest.number,
          htmlUrl: data.pullRequest.htmlUrl || data.report.pullRequest.url,
        },
        commentId: data.review.commentId,
        body,
      });
    } catch (error) {
      /*
       * A GitLab, Forgejo or Gitea that would not let the token comment -
       * a Forgejo or Gitea token without write access to issues, a merge
       * request whose discussion is locked - keeps the review here, its
       * page says why, rather than failing it: trying again would be
       * refused again. Anything else is tried again.
       */
      if (
        data.host.provider === CodeRepositoryType.GitHub ||
        !isCommentRefusal(error)
      ) {
        throw error;
      }

      logger.info(
        `Production review ${data.run.id?.toString()}: the ${data.host.pullRequestTerm}'s host refused its comment, so it is kept in Code only: ${error instanceof Error ? error.message : String(error)}`,
      );

      data.report.posting = ProductionReviewPosting.None;
      data.report.isCommentRefused = true;
      return;
    }

    data.update.commentId = comment.commentId;
    data.update.commentUrl = comment.htmlUrl;
    data.update.commentPosting = posting;
    data.report.commentUrl = comment.htmlUrl || undefined;
  }

  /*
   * The review as a GitHub check run on the pull request's head: success
   * when production has nothing to say, neutral when something is worth a
   * look, its Details the review in OneUptime - and its summary what the
   * comment holds, the link alone where the comment is a link. Edited in
   * place while the head is the same. An App that may not write checks
   * there writes none, and a check that cannot be written never fails the
   * review: the comment and the page in Code stand without it.
   */
  private static async writeCheck(data: {
    run: AIRun;
    review: ProductionReviewTaskContext;
    host: ProductionReviewHost;
    report: ProductionReviewReport;
    update: ProductionReviewContextUpdate;
    input: ProductionReviewCommentInput;
  }): Promise<void> {
    const headSha: string = data.report.pullRequest.headSha;

    if (!data.host.writeCheckRun || !headSha) {
      return;
    }

    try {
      const text: ProductionReviewCheckRunText =
        ProductionReviewComposer.composeCheckRun(data.input);

      const written: GitHubCheckRunWritten | null =
        await data.host.writeCheckRun({
          checkRunId: data.review.checkRunId,
          checkRunHeadSha: data.review.checkRunHeadSha,
          content: {
            name: getProductionReviewCheckName(),
            headSha,
            conclusion: text.conclusion,
            title: text.title,
            summary: text.summary,
            detailsUrl: data.input.reviewUrl,
            externalId: data.run.id!.toString(),
          },
        });

      if (written) {
        data.update.checkRunId = written.checkRunId;
        data.update.checkRunHeadSha = headSha;
      }
    } catch (error) {
      logger.info(
        `Production review ${data.run.id?.toString()}: its check run could not be written, so the review stands without it: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // A review that ends without reviewing: done, and why.
  private static async skip(data: {
    run: AIRun;
    review: ProductionReviewTaskContext;
    message: string;
  }): Promise<ProductionReviewRunResult> {
    await ProductionReviewQueue.finish({
      run: data.run,
      requestNumber: data.review.requestNumber,
      outcome: null,
      update: {},
      errorMessage: data.message,
    });

    return {
      report: null,
      posted: ProductionReviewPosting.None,
      skippedBecause: data.message,
    };
  }
}
