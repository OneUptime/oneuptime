import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import GitHubCommandAuthorizer from "../GitHub/GitHubCommandAuthorizer";
import GitHubConversation, {
  GitHubRepositoryPermission,
} from "../GitHub/GitHubConversation";
import GitHubWebhookEvents, {
  GitHubWebhookRepository,
  GitHubWebhookSender,
} from "../GitHub/GitHubWebhookEvents";
import ProductionReviewQueue from "./ProductionReviewQueue";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { ProductionReviewTrigger as ProductionReviewTriggerType } from "../../../../Types/CodeRepository/ProductionReview";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHEN A PULL REQUEST IS REVIEWED AGAINST PRODUCTION ON ITS OWN.
 *
 * GitHub tells the app about every pull request in every connected
 * repository. A production review reads the project's production telemetry
 * and may spend its AI credits, and on a public repository anyone can open
 * a pull request - so OneUptime reviews one on its own only when all of
 * this holds, cheapest first:
 *
 *   - it opened, reopened, was pushed to or was marked ready for review
 *     (REVIEWED_ACTIONS), and is open and not a draft;
 *   - neither its author nor whoever did it is a bot (Dependabot, Renovate,
 *     this app's own pull requests);
 *   - its repository is connected to a project through the GitHub App, and
 *     has Production Review on;
 *   - its AUTHOR can write to the repository, and so can whoever did it
 *     (pushed to it, reopened it) - GitHub's permission API is asked, never
 *     the "contributor" badge, which describes past activity.
 *
 * A pull request from anyone else - an outside contributor, a fork, a
 * person with read access - is reviewed only when someone who can write to
 * the repository asks ("@oneuptime production review", which needs no
 * setting) or presses Review again in Code. An outsider can neither start a
 * review that spends the project's AI credits nor fish for what production
 * says about code of their choosing. Nothing is said in the thread when a
 * pull request is not reviewed: a comment would be noise on every pull
 * request OneUptime was never meant to review.
 */

// The pull_request actions that ask for a review.
export const REVIEWED_ACTIONS: ReadonlyArray<string> = [
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
];

export interface ProductionReviewTriggerResult {
  handled: boolean;
  outcome: string;
  aiRunId?: ObjectID | undefined;
}

function notHandled(outcome: string): ProductionReviewTriggerResult {
  return { handled: false, outcome };
}

// A GitHub user GitHub calls a bot, or whose login says it is one.
export function isBotUser(user: JSONObject | undefined): boolean {
  const login: string = (user?.["login"] as string) || "";
  const type: string = ((user?.["type"] as string) || "").toLowerCase();

  return type === "bot" || GitHubConversation.isBotLogin(login);
}

export default class ProductionReviewGitHubTrigger {
  /*
   * A pull_request webhook: queue a review when everything above holds.
   * Never throws; says nothing in the thread.
   */
  @CaptureSpan()
  public static async onPullRequestChanged(
    payload: JSONObject,
  ): Promise<ProductionReviewTriggerResult> {
    const action: string | null = GitHubWebhookEvents.getAction(payload);

    if (!action || !REVIEWED_ACTIONS.includes(action)) {
      return notHandled("action-not-reviewed");
    }

    const pullRequest: JSONObject | undefined = payload[
      "pull_request"
    ] as JSONObject;
    const pullRequestNumber: number | null =
      GitHubWebhookEvents.getNumber(pullRequest);

    if (!pullRequest || pullRequestNumber === null) {
      return notHandled("no-pull-request");
    }

    if (pullRequest["state"] !== "open") {
      return notHandled("pull-request-not-open");
    }

    if (pullRequest["draft"] === true) {
      return notHandled("pull-request-draft");
    }

    const author: JSONObject | undefined = pullRequest["user"] as JSONObject;
    const authorLogin: string = (author?.["login"] as string) || "";
    const sender: GitHubWebhookSender | null =
      GitHubWebhookEvents.getSender(payload);

    if (
      !authorLogin ||
      !sender ||
      isBotUser(author) ||
      isBotUser(payload["sender"] as JSONObject)
    ) {
      return notHandled("bot-or-unknown-author");
    }

    const repository: GitHubWebhookRepository | null =
      GitHubWebhookEvents.getRepository(payload);
    const installationId: string | null =
      GitHubWebhookEvents.getInstallationId(payload);

    if (!repository || !installationId) {
      return notHandled("unresolvable-repository");
    }

    const codeRepository: CodeRepository | null =
      await GitHubCommandAuthorizer.resolveConnectedRepository({
        organizationName: repository.organizationName,
        repositoryName: repository.repositoryName,
        installationId,
      });

    if (!codeRepository?.id || !codeRepository.projectId) {
      return notHandled("repository-not-connected");
    }

    if (codeRepository.isProductionReviewEnabled !== true) {
      return notHandled("production-review-off");
    }

    if (
      !(await ProductionReviewGitHubTrigger.canWrite({
        installationId,
        repository,
        login: authorLogin,
      }))
    ) {
      return notHandled("author-cannot-write");
    }

    if (
      sender.login.toLowerCase() !== authorLogin.toLowerCase() &&
      !(await ProductionReviewGitHubTrigger.canWrite({
        installationId,
        repository,
        login: sender.login,
      }))
    ) {
      return notHandled("sender-cannot-write");
    }

    const head: JSONObject = (pullRequest["head"] as JSONObject) || {};
    const headRepository: string | null =
      ((head["repo"] as JSONObject)?.["full_name"] as string) || null;

    const run: AIRun = await ProductionReviewQueue.request({
      projectId: codeRepository.projectId,
      codeRepositoryId: codeRepository.id,
      installationId,
      organizationName: repository.organizationName,
      repositoryName: repository.repositoryName,
      pullRequestNumber,
      pullRequestTitle: (pullRequest["title"] as string) || "",
      headSha: (head["sha"] as string) || "",
      isFromFork: GitHubConversation.isFromFork({
        headRepositoryFullName: headRepository,
        organizationName: repository.organizationName,
        repositoryName: repository.repositoryName,
      }),
      trigger: ProductionReviewTriggerType.PullRequestChanged,
      isAuthorTrusted: true,
      requestedByLogin: sender.login,
    });

    logger.debug(
      `Production review of ${repository.organizationName}/${repository.repositoryName}#${pullRequestNumber} asked for (${action}).`,
    );

    return { handled: true, outcome: "queued", aiRunId: run.id || undefined };
  }

  /*
   * Whether a GitHub user may write to the repository: write, maintain or
   * admin - the permission that may command the app. A failure answers no.
   */
  public static async canWrite(data: {
    installationId: string;
    repository: GitHubWebhookRepository;
    login: string;
  }): Promise<boolean> {
    const permission: GitHubRepositoryPermission =
      await GitHubConversation.getUserRepositoryPermission({
        installationId: data.installationId,
        organizationName: data.repository.organizationName,
        repositoryName: data.repository.repositoryName,
        username: data.login,
      });

    return GitHubConversation.canCommandApp(permission);
  }
}
