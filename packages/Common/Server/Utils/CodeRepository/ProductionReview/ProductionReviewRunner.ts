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
import GitHubConversation, {
  GitHubIssueComment,
  GitHubPullRequestDetails,
  GitHubPullRequestFile,
} from "../GitHub/GitHubConversation";
import GitHubInstallationBinding from "../GitHub/GitHubInstallationBinding";
import GitHubRunReply from "../GitHub/GitHubRunReply";
import { CodeAgentScopedService } from "../../AI/CodeFix/CodeAgentTelemetryScope";
import ProductionReviewAI, {
  ProductionReviewAiResult,
} from "./ProductionReviewAI";
import ProductionReviewComposer from "./ProductionReviewComposer";
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
  ProductionReviewTaskContext,
} from "../../../../Types/AI/CodeFixTaskContext";
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
 *   1. The repository, still connected through the GitHub App to the
 *      project, and still asking for reviews when OneUptime started this
 *      one on its own.
 *   2. The pull request as it is now - open, its head, its files and their
 *      diff - read from GitHub. A closed one is not reviewed; a draft is
 *      reviewed only when someone asked.
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

// The files of a pull request read from GitHub.
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
  return `${ProductBrandingText.getProductName()} could not finish this production review, even after trying again. A push to the pull request, or Review again, starts a new one.`;
};

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
        errorMessage: PRODUCTION_REVIEW_FAILED_MESSAGE(),
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
   * again - GitHub or a database that could not be reached.
   */
  @CaptureSpan()
  public static async review(run: AIRun): Promise<ProductionReviewRunResult> {
    const review: ProductionReviewTaskContext | null =
      getProductionReviewTaskContext(run.taskContext);
    const github: GitHubTaskContext | null = getGitHubTaskContext(
      run.taskContext,
    );

    if (!review || !github || !run.projectId || !run.id) {
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
    const repository: CodeRepository | null = run.codeRepositoryId
      ? await CodeRepositoryService.findOneBy({
          query: { _id: run.codeRepositoryId.toString(), projectId },
          select: {
            _id: true,
            organizationName: true,
            repositoryName: true,
            gitHubAppInstallationId: true,
            isProductionReviewEnabled: true,
            productionReviewPullRequestContent: true,
            productionReviewLlmProviderId: true,
          },
          props: { isRoot: true },
        })
      : null;

    const isBound: boolean = Boolean(
      repository?.gitHubAppInstallationId &&
        repository.gitHubAppInstallationId === github.installationId &&
        (await GitHubInstallationBinding.isInstallationBoundToProject({
          projectId,
          installationId: repository.gitHubAppInstallationId,
        })),
    );

    if (!repository || !isBound) {
      return await ProductionReviewRunner.skip({
        run,
        review,
        message: REPOSITORY_NOT_CONNECTED_MESSAGE,
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

    const pullRequestNumber: number = github.pullRequestNumber!;

    const pullRequest: GitHubPullRequestDetails =
      await GitHubConversation.getPullRequestDetails({
        installationId: github.installationId,
        organizationName: github.organizationName,
        repositoryName: github.repositoryName,
        pullRequestNumber,
      });

    if (pullRequest.state !== "open") {
      return await ProductionReviewRunner.skip({
        run,
        review,
        message: PULL_REQUEST_CLOSED_MESSAGE,
      });
    }

    if (
      pullRequest.isDraft &&
      review.trigger === ProductionReviewTrigger.PullRequestChanged
    ) {
      return await ProductionReviewRunner.skip({
        run,
        review,
        message: PULL_REQUEST_DRAFT_MESSAGE,
      });
    }

    const files: Array<GitHubPullRequestFile> =
      await GitHubConversation.listPullRequestFiles({
        installationId: github.installationId,
        organizationName: github.organizationName,
        repositoryName: github.repositoryName,
        pullRequestNumber,
        maxFiles: MAX_FILES_READ,
      });

    const changed: ChangedCode = readChangedCode({
      files,
      hasMoreFiles: pullRequest.changedFilesCount > files.length,
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
          `https://github.com/${github.organizationName}/${github.repositoryName}/pull/${pullRequestNumber}`,
        authorLogin: pullRequest.authorLogin,
        headSha: pullRequest.headSha,
        baseRefName: pullRequest.baseRefName,
        isFromFork: GitHubConversation.isFromFork({
          headRepositoryFullName: pullRequest.headRepositoryFullName,
          organizationName: github.organizationName,
          repositoryName: github.repositoryName,
        }),
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
      github,
      repository,
      report,
      update: contextUpdate,
    });

    const outcome: CodeTaskOutcome = {
      summary: ProductionReviewComposer.summarize(report),
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
    files: Array<GitHubPullRequestFile>;
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
      files: data.files.map((file: GitHubPullRequestFile) => {
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
   * date.
   */
  public static async post(data: {
    run: AIRun;
    review: ProductionReviewTaskContext;
    github: GitHubTaskContext;
    repository: CodeRepository;
    report: ProductionReviewReport;
    update: ProductionReviewContextUpdate;
  }): Promise<void> {
    const hasSignal: boolean = ProductionReviewUtil.hasSignal(data.report);

    if (
      !hasSignal &&
      !data.review.commentId &&
      data.review.trigger === ProductionReviewTrigger.PullRequestChanged
    ) {
      data.report.posting = ProductionReviewPosting.None;
      return;
    }

    const isPublic: boolean | null =
      await GitHubConversation.isRepositoryPublic({
        installationId: data.github.installationId,
        organizationName: data.github.organizationName,
        repositoryName: data.github.repositoryName,
      });

    const posting:
      | ProductionReviewPosting.Review
      | ProductionReviewPosting.Link = ProductionReviewUtil.getPosting({
      content: data.repository.productionReviewPullRequestContent,
      isPublic,
    });

    data.report.posting = posting;
    data.report.isPublicRepository = isPublic === true;

    const body: string = ProductionReviewComposer.compose({
      report: data.report,
      posting,
      reviewUrl: GitHubRunReply.buildRunUrl({
        projectId: data.run.projectId!,
        aiRunId: data.run.id!,
      }),
      dashboardUrl: DashboardClientUrl.toString(),
      projectId: data.run.projectId!.toString(),
      productName: ProductBrandingText.getProductName(),
      appSlug: await GitHubConversation.getAppSlug(),
      updatesOnPush:
        data.review.isAuthorTrusted &&
        data.repository.isProductionReviewEnabled === true,
      isPublicRepository: isPublic,
    });

    const comment: GitHubIssueComment =
      await ProductionReviewRunner.writeComment({
        github: data.github,
        commentId: data.review.commentId,
        body,
      });

    data.update.commentId = comment.commentId;
    data.update.commentUrl = comment.htmlUrl;
    data.update.commentPosting = posting;
    data.report.commentUrl = comment.htmlUrl || undefined;
  }

  /*
   * The comment edited in place, or written when there is none - or when
   * the one there is gone: someone deleted it, which is an ordinary thing
   * to do to a bot's comment.
   */
  public static async writeComment(data: {
    github: GitHubTaskContext;
    commentId: number | undefined;
    body: string;
  }): Promise<GitHubIssueComment> {
    if (data.commentId) {
      try {
        return await GitHubConversation.updateIssueComment({
          installationId: data.github.installationId,
          organizationName: data.github.organizationName,
          repositoryName: data.github.repositoryName,
          commentId: data.commentId,
          body: data.body,
        });
      } catch (error) {
        logger.info(
          `Production review: its comment ${data.commentId} could not be edited (${error}); writing a new one.`,
        );
      }
    }

    return await GitHubConversation.createIssueComment({
      installationId: data.github.installationId,
      organizationName: data.github.organizationName,
      repositoryName: data.github.repositoryName,
      issueNumber: data.github.pullRequestNumber!,
      body: data.body,
    });
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
