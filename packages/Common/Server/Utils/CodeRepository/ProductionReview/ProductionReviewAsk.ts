import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../CodeHost/CodeHostHttp";
import { CodeHostPullRequestDetails } from "../CodeHost/CodeHostTypes";
import GitHubConversation from "../GitHub/GitHubConversation";
import GitHubInstallationBinding from "../GitHub/GitHubInstallationBinding";
import ProductionReviewGitHubTrigger from "./ProductionReviewGitHubTrigger";
import ProductionReviewHosts, {
  AuthorWriteAccess,
  GitHubReviewedRepository,
  isBotLogin,
  PolledReviewHost,
  ProductionReviewHost,
} from "./ProductionReviewHost";
import ProductionReviewPoller from "./ProductionReviewPoller";
import ProductionReviewQueue from "./ProductionReviewQueue";
import {
  getPullRequestClosedMessage,
  getPullRequestTerm,
  getRepositoryNotConnectedMessage,
} from "./ProductionReviewRunner";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import {
  CodeHost,
  CodeHostCapability,
  PullRequestTerm,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { ProductionReviewTrigger } from "../../../../Types/CodeRepository/ProductionReview";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * ONE PULL REQUEST, REVIEWED BECAUSE SOMEONE ASKED IN CODE.
 *
 * A repository's Production Reviews page in Code asks for a review of any
 * of its open pull (merge) requests by number - also one from a fork, a bot
 * or anyone who cannot write to the repository, which is never reviewed on
 * its own - as "@oneuptime production review" asks on GitHub. GitLab,
 * Forgejo and Gitea read no such command, so this is how a pull request of
 * an outside contributor's is reviewed there. It needs no setting, as the
 * command does not: the person asking may ask AI in the repository (the
 * route checks), which is the consent such a pull request needs.
 *
 * The repository must be on a host with pull requests, reached the way it
 * was connected, and the pull request open. The pull request's next pushes
 * are reviewed on their own only when its author is trusted the way the
 * host's own reviews trust one: on GitHub, an author who can write
 * (ProductionReviewGitHubTrigger); on GitLab, Forgejo and Gitea, a branch of
 * the repository itself whose author the host does not say cannot write
 * (ProductionReviewPoller) - never a bot's, nor OneUptime's own.
 */

// A Git server has no pull requests for a review to read.
export const PRODUCTION_REVIEW_NO_PULL_REQUESTS_MESSAGE: string =
  "A Git server has no pull requests for OneUptime to review. Production reviews work in GitHub, GitLab, Forgejo and Gitea repositories.";

// A pull request as its host writes it: GitLab's "!12", everyone else's "#12".
export function getPullRequestLabel(
  provider: CodeRepositoryType | string | null | undefined,
  number: number,
): string {
  return `${CodeHost.readType(provider) === CodeRepositoryType.GitLab ? "!" : "#"}${number}`;
}

// What a number that is none says, in the host's words.
export function getPullRequestNumberRefusedMessage(
  provider: CodeRepositoryType | string | null | undefined,
): string {
  return `Enter the number of a ${getPullRequestTerm(provider)}, such as ${getPullRequestLabel(provider, 12)}.`;
}

// What a pull request the host does not know says.
export function getPullRequestNotFoundMessage(
  provider: CodeRepositoryType | string | null | undefined,
  number: number,
): string {
  return `There is no ${getPullRequestTerm(provider)} ${getPullRequestLabel(provider, number)} in this repository.`;
}

// Whether a host's answer said there is no such pull request.
export function isPullRequestNotFound(error: unknown): boolean {
  if (error instanceof CodeHostHttpError) {
    return error.kind === CodeHostHttpErrorKind.NotFound;
  }

  return error instanceof HTTPErrorResponse && error.statusCode === 404;
}

export default class ProductionReviewAsk {
  /*
   * Ask for a review of the repository's pull request, now: its review
   * task, created or asked again. Throws a BadDataException a person can
   * act on when it cannot be asked.
   */
  @CaptureSpan()
  public static async ask(data: {
    projectId: ObjectID;
    // Read with CODE_HOST_REPOSITORY_SELECT.
    repository: CodeRepository;
    pullRequestNumber: number;
    requestedByUserId?: ObjectID | undefined;
  }): Promise<AIRun> {
    const type: CodeRepositoryType = CodeHost.readType(
      data.repository.repositoryHostedAt,
    );

    if (!CodeHost.can(type, CodeHostCapability.ProductionReview)) {
      throw new BadDataException(PRODUCTION_REVIEW_NO_PULL_REQUESTS_MESSAGE);
    }

    if (type === CodeRepositoryType.GitHub) {
      return await ProductionReviewAsk.askOnGitHub(data);
    }

    return await ProductionReviewAsk.askThroughConnection(data);
  }

  // A GitHub pull request, through the installation the project is bound to.
  private static async askOnGitHub(data: {
    projectId: ObjectID;
    repository: CodeRepository;
    pullRequestNumber: number;
    requestedByUserId?: ObjectID | undefined;
  }): Promise<AIRun> {
    const installationId: string | null =
      await GitHubInstallationBinding.getBoundInstallationId(data.projectId);
    const organizationName: string = data.repository.organizationName || "";
    const repositoryName: string = data.repository.repositoryName || "";

    if (
      !installationId ||
      data.repository.gitHubAppInstallationId !== installationId ||
      !organizationName ||
      !repositoryName
    ) {
      throw new BadDataException(
        getRepositoryNotConnectedMessage(CodeRepositoryType.GitHub),
      );
    }

    const github: GitHubReviewedRepository = {
      installationId,
      organizationName,
      repositoryName,
    };

    const pullRequest: CodeHostPullRequestDetails =
      await ProductionReviewAsk.readOpenPullRequest({
        host: ProductionReviewHosts.gitHub(github),
        number: data.pullRequestNumber,
      });

    // Its pushes are reviewed on their own when its author can write.
    let isAuthorTrusted: boolean = false;

    if (!GitHubConversation.isBotLogin(pullRequest.authorLogin)) {
      isAuthorTrusted = await ProductionReviewGitHubTrigger.canWrite({
        installationId,
        repository: { organizationName, repositoryName },
        login: pullRequest.authorLogin,
      }).catch((): boolean => {
        return false;
      });
    }

    return await ProductionReviewQueue.request({
      projectId: data.projectId,
      codeRepositoryId: data.repository.id!,
      installationId,
      organizationName,
      repositoryName,
      pullRequestNumber: pullRequest.number,
      pullRequestTitle: pullRequest.title,
      headSha: pullRequest.headSha,
      isFromFork: pullRequest.isFromFork,
      trigger: ProductionReviewTrigger.OneUptime,
      isAuthorTrusted,
      requestedByUserId: data.requestedByUserId,
      isImmediate: true,
    });
  }

  // A merge request on GitLab, or a pull request on Forgejo or Gitea.
  private static async askThroughConnection(data: {
    projectId: ObjectID;
    repository: CodeRepository;
    pullRequestNumber: number;
    requestedByUserId?: ObjectID | undefined;
  }): Promise<AIRun> {
    const type: CodeRepositoryType = CodeHost.readType(
      data.repository.repositoryHostedAt,
    );

    const host: PolledReviewHost | null =
      await ProductionReviewHosts.openPolled(data.repository);

    if (!host) {
      throw new BadDataException(getRepositoryNotConnectedMessage(type));
    }

    const pullRequest: CodeHostPullRequestDetails =
      await ProductionReviewAsk.readOpenPullRequest({
        host,
        number: data.pullRequestNumber,
      });

    /*
     * Its pushes are reviewed on their own when the poll would review it:
     * a branch of the repository itself, neither a bot's nor OneUptime's
     * own, whose author the host does not say cannot write.
     */
    const isAuthorTrusted: boolean =
      !pullRequest.isFromFork &&
      !isBotLogin(pullRequest.authorLogin) &&
      !host.isOwnPullRequest(pullRequest) &&
      (await ProductionReviewPoller.getAuthorWriteAccess({
        repositoryId: data.repository.id!,
        host,
        pullRequest,
      })) !== AuthorWriteAccess.CannotWrite;

    return await ProductionReviewQueue.request({
      projectId: data.projectId,
      codeRepositoryId: data.repository.id!,
      provider: host.provider as
        | CodeRepositoryType.GitLab
        | CodeRepositoryType.Forgejo,
      pullRequestNumber: pullRequest.number,
      pullRequestTitle: pullRequest.title,
      pullRequestUrl: pullRequest.htmlUrl || undefined,
      headSha: pullRequest.headSha,
      isFromFork: pullRequest.isFromFork,
      trigger: ProductionReviewTrigger.OneUptime,
      isAuthorTrusted,
      requestedByUserId: data.requestedByUserId,
      isImmediate: true,
    });
  }

  /*
   * The pull request, read from its host now: one the host does not know,
   * or one that is closed, is said plainly.
   */
  private static async readOpenPullRequest(data: {
    host: ProductionReviewHost;
    number: number;
  }): Promise<CodeHostPullRequestDetails> {
    const term: PullRequestTerm = data.host.pullRequestTerm;
    let pullRequest: CodeHostPullRequestDetails;

    try {
      pullRequest = await data.host.getPullRequest(data.number);
    } catch (error) {
      if (isPullRequestNotFound(error)) {
        throw new BadDataException(
          getPullRequestNotFoundMessage(data.host.provider, data.number),
        );
      }

      throw error;
    }

    if (!pullRequest.isOpen) {
      throw new BadDataException(getPullRequestClosedMessage(term));
    }

    return pullRequest;
  }
}
