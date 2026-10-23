import AIService, {
  AI_DISABLED_MESSAGE,
  getProjectDailyLimitMessage,
  ProjectAiDailyLimitStatus,
} from "../../../Services/AIService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ProjectService from "../../../Services/ProjectService";
import { IsBillingEnabled, getAllEnvVars } from "../../../EnvironmentConfig";
import GitHubInstallationBinding from "../../CodeRepository/GitHub/GitHubInstallationBinding";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../CodeRepository/CodeHost/CodeHostAccess";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeFixReadiness, {
  CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
  getRepositoryRunnerBlocker,
} from "../CodeFix/CodeFixReadiness";
import CodeRepositoryRunnerChoice from "../CodeFix/CodeRepositoryRunnerChoice";
import { CODE_TASK_ASK_REFUSED_MESSAGE } from "./CodeTaskAccess";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Project from "../../../../Models/DatabaseModels/Project";
import { AIFixReadinessCheck } from "../../../../Types/AI/AIFixReadiness";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHETHER AI MAY START OR CONTINUE A TASK IN A REPOSITORY, AND IF NOT, WHY.
 *
 * Everything that gates AI work anywhere in OneUptime, asked in the order a
 * person would fix it: the subscription and the plan, permission to edit the
 * repository, the project's one AI switch (Project.enableAi), a repository
 * OneUptime can reach (through the GitHub App, or its connection to its Git
 * server - GitLab, Forgejo, Gitea or any Git server - whose token was not
 * refused), an LLM provider with credits behind it, the
 * project's own daily AI limits, and a Runner online to do the work: the
 * one the repository picks in its settings, or a global Runner for one that
 * picks none (CodeRepositoryRunnerChoice).
 *
 * The repository page asks first, so the request box says what is missing
 * before anyone types; the create, reply and retry routes ask again and
 * refuse with the same sentence. The LLM call itself (executeWithLogging)
 * still enforces the switch, the credits and the limits for every completion
 * the Runner asks for, so a task that starts and then crosses one of them
 * fails honestly rather than running on.
 */

export const CODE_TASK_PLAN_REQUIRED_MESSAGE: string =
  "AI in Code needs the Growth plan or above. Upgrade the project's plan in Project Settings > Billing and Invoices > Billing.";

export const CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE: string =
  "This project's subscription is unpaid. Update the payment method in Project Settings > Billing and Invoices > Billing to use AI.";

export const CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE: string =
  "AI can only work in a GitHub repository connected through the GitHub App, and this one is not. Connect GitHub again from Code.";

// A repository whose connection to its Git server is gone.
export const CODE_TASK_REPOSITORY_CONNECTION_GONE_MESSAGE: string =
  "This repository is no longer connected to its Git server, so AI cannot work in it. Connect it again from Code's Repositories.";

// The Git server refused the repository's access token.
export const getCodeTaskTokenRefusedMessage: (hostName: string) => string = (
  hostName: string,
): string => {
  return `${hostName} refused this repository's access token, so AI cannot work in it. It may have expired: replace it on the repository's Settings page in Code.`;
};

// A Git server on a private network, with no Runner of the project's own.
export const CODE_TASK_REPOSITORY_NEEDS_OWN_RUNNER_MESSAGE: string =
  "This repository's Git server is on a network OneUptime does not reach, so a global Runner cannot work in it. Pick one of your own Runners on that network in the repository's settings in Code.";

// What says a repository is not reachable, by why it is not.
export const getRepositoryNotReachableMessage: (
  summary: CodeHostConnectionSummary | null | undefined,
) => string = (
  summary: CodeHostConnectionSummary | null | undefined,
): string => {
  if (!summary) {
    return CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE;
  }

  switch (summary.state) {
    case CodeHostConnectionState.TokenRefused:
      return getCodeTaskTokenRefusedMessage(
        summary.hostProduct || CodeHost.getFacts(summary.provider).name,
      );
    case CodeHostConnectionState.NoConnection:
      return CODE_TASK_REPOSITORY_CONNECTION_GONE_MESSAGE;
    default:
      return CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE;
  }
};

export default class CodeTaskGate {
  /*
   * What stops AI working in the repository for this person now, or null.
   * `billingEnabled` overrides the IsBillingEnabled flag, for tests.
   */
  @CaptureSpan()
  public static async getBlocker(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repository: CodeRepository;
    canAsk: boolean;
    billingEnabled?: boolean | undefined;
  }): Promise<CodeTaskBlocker | null> {
    const billingEnabled: boolean = data.billingEnabled ?? IsBillingEnabled;

    /*
     * The bill and the plan come first: they stop everyone in the project,
     * and a plan below the repositories' own also reads as "may not edit
     * the repository" - which would send people to an admin who cannot
     * help either.
     */
    if (billingEnabled && data.props.isSubscriptionUnpaid) {
      return {
        type: CodeTaskBlockerType.SubscriptionUnpaid,
        message: CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE,
      };
    }

    if (
      billingEnabled &&
      data.props.currentPlan &&
      !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        PlanType.Growth,
        data.props.currentPlan,
        getAllEnvVars(),
      )
    ) {
      return {
        type: CodeTaskBlockerType.PlanRequired,
        message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      };
    }

    if (!data.canAsk) {
      return {
        type: CodeTaskBlockerType.NoPermission,
        message: CODE_TASK_ASK_REFUSED_MESSAGE,
      };
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        enableAi: true,
        aiDailyTokenLimit: true,
        aiDailySpendLimitInUSD: true,
        aiDailyTokenLimitReachedAt: true,
        aiDailySpendLimitReachedAt: true,
      },
      props: { isRoot: true },
    });

    // Strictly `=== false`, as every enableAi read: unset means on.
    if (!project || project.enableAi === false) {
      return {
        type: CodeTaskBlockerType.AiDisabled,
        message: AI_DISABLED_MESSAGE,
      };
    }

    const connection: CodeHostConnectionSummary | undefined = (
      await CodeHostAccess.getConnectionSummaries({
        projectId: data.projectId,
        repositoryIds: [data.repository.id!],
      })
    ).get(data.repository.id!.toString());

    if (
      !connection ||
      connection.state !== CodeHostConnectionState.Connected
    ) {
      return {
        type:
          connection?.state === CodeHostConnectionState.TokenRefused
            ? CodeTaskBlockerType.RepositoryTokenRefused
            : CodeTaskBlockerType.RepositoryNotConnected,
        message: getRepositoryNotReachableMessage(connection),
      };
    }

    const llmCheck: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId: data.projectId,
        billingEnabled: billingEnabled,
      });

    if (!llmCheck.ok) {
      return {
        type:
          llmCheck.detail === CODE_FIX_AI_CREDITS_USED_UP_DETAIL
            ? CodeTaskBlockerType.NoAiCredits
            : CodeTaskBlockerType.NoLlmProvider,
        message: llmCheck.detail,
      };
    }

    const reachedLimit: ProjectAiDailyLimitStatus | null =
      await AIService.getReachedProjectDailyLimit({
        projectId: data.projectId,
        project: project,
      });

    if (reachedLimit) {
      return {
        type: CodeTaskBlockerType.DailyLimitReached,
        message: getProjectDailyLimitMessage(reachedLimit),
      };
    }

    /*
     * The Runner the repository picks (its Runner setting in Code), or a
     * global Runner for one that picks none, must be online. Read as
     * OneUptime: which Runner a repository picks decides where its work
     * goes, whatever the reader may see of the setting.
     */
    const runnerChoice: CodeRepository | null =
      await CodeRepositoryService.findOneById({
        id: data.repository.id!,
        select: {
          _id: true,
          runnerId: true,
        },
        props: { isRoot: true },
      });

    /*
     * A Git server only a private network reaches is reached by a Runner of
     * the project's own on it: a global Runner refuses its address.
     */
    if (!connection.isReachableFromServer && !runnerChoice?.runnerId) {
      return {
        type: CodeTaskBlockerType.RepositoryNeedsOwnRunner,
        message: CODE_TASK_REPOSITORY_NEEDS_OWN_RUNNER_MESSAGE,
      };
    }

    return getRepositoryRunnerBlocker(
      await CodeRepositoryRunnerChoice.getStatusForRepository({
        projectId: data.projectId,
        runnerId: runnerChoice?.runnerId,
      }),
    );
  }

  // Refuse with the blocker's own sentence, as an error of its kind.
  public static async assertCanStart(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repository: CodeRepository;
    canAsk: boolean;
    billingEnabled?: boolean | undefined;
  }): Promise<void> {
    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker(data);

    if (blocker) {
      throw CodeTaskGate.toException(blocker);
    }
  }

  public static toException(blocker: CodeTaskBlocker): Exception {
    switch (blocker.type) {
      case CodeTaskBlockerType.NoPermission:
        return new NotAuthorizedException(blocker.message);
      case CodeTaskBlockerType.PlanRequired:
      case CodeTaskBlockerType.SubscriptionUnpaid:
        return new PaymentRequiredException(blocker.message);
      default:
        return new BadDataException(blocker.message);
    }
  }

  /*
   * Whether the Runner can be handed a token for the repository - what
   * /ai-agent-data/get-repository-token asks before it hands one out: a
   * GitHub repository connected through the GitHub App, whose installation
   * is still bound to its project, or a repository whose connection to its
   * Git server is its project's and was not refused (CodeHostAccess).
   */
  public static async isRepositoryReachable(data: {
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<boolean> {
    const reachable: Set<string> = await CodeTaskGate.getReachableRepositoryIds(
      {
        projectId: data.projectId,
        repositoryIds: [data.repositoryId],
      },
    );

    return reachable.has(data.repositoryId.toString());
  }

  /*
   * The GitHub App installation AI reaches the repository through, when it
   * can (isRepositoryReachable): the installation bound to the project,
   * which must be the one the repository was imported through. Null
   * otherwise. Read as root, and only used on the server: the installation
   * id is not every reader's to see.
   */
  @CaptureSpan()
  public static async getReachableInstallationId(data: {
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<string | null> {
    const boundInstallationId: string | null =
      await GitHubInstallationBinding.getBoundInstallationId(data.projectId);

    if (!boundInstallationId) {
      return null;
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: {
          _id: data.repositoryId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          repositoryHostedAt: true,
          gitHubAppInstallationId: true,
        },
        props: { isRoot: true },
      });

    if (
      !repository ||
      repository.repositoryHostedAt !== CodeRepositoryType.GitHub ||
      repository.gitHubAppInstallationId !== boundInstallationId
    ) {
      return null;
    }

    return boundInstallationId;
  }

  /*
   * Which of the repositories AI can work in, in a few reads whatever their
   * number: the rows, the installation bound to the project and their
   * connections (CodeHostAccess). Read as root - neither an installation id
   * nor a token is every reader's to see, and only the answer goes back.
   */
  @CaptureSpan()
  public static async getReachableRepositoryIds(data: {
    projectId: ObjectID;
    repositoryIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    return await CodeHostAccess.getReachableRepositoryIds(data);
  }
}
