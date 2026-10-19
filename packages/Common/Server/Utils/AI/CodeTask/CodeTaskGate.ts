import AIService, {
  AI_DISABLED_MESSAGE,
  getProjectDailyLimitMessage,
  ProjectAiDailyLimitStatus,
} from "../../../Services/AIService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { IsBillingEnabled, getAllEnvVars } from "../../../EnvironmentConfig";
import GitHubInstallationBinding from "../../CodeRepository/GitHub/GitHubInstallationBinding";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeFixReadiness, {
  CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
} from "../CodeFix/CodeFixReadiness";
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
import BadDataException from "../../../../Types/Exception/BadDataException";
import Exception from "../../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHETHER AI MAY START OR CONTINUE A TASK IN A REPOSITORY, AND IF NOT, WHY.
 *
 * Everything that gates AI work anywhere in OneUptime, asked in the order a
 * person would fix it: permission to edit the repository, the plan and the
 * subscription, the project's one AI switch (Project.enableAi), a repository
 * the GitHub App can reach, an LLM provider with credits behind it, the
 * project's own daily AI limits, and a Runner online to do the work.
 *
 * The repository page asks first, so the request box says what is missing
 * before anyone types; the create, reply and retry routes ask again and
 * refuse with the same sentence. The LLM call itself (executeWithLogging)
 * still enforces the switch, the credits and the limits for every completion
 * the Runner asks for, so a task that starts and then crosses one of them
 * fails honestly rather than running on.
 */

export const CODE_TASK_PLAN_REQUIRED_MESSAGE: string =
  "AI in Code needs the Growth plan or above. Upgrade the project's plan in Project Settings > Billing.";

export const CODE_TASK_SUBSCRIPTION_UNPAID_MESSAGE: string =
  "This project's subscription is unpaid. Update the payment method in Project Settings > Billing to use AI.";

export const CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE: string =
  "AI can only work in a GitHub repository connected through the GitHub App, and this one is not. Connect GitHub again from Code.";

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
    if (!data.canAsk) {
      return {
        type: CodeTaskBlockerType.NoPermission,
        message: CODE_TASK_ASK_REFUSED_MESSAGE,
      };
    }

    const billingEnabled: boolean = data.billingEnabled ?? IsBillingEnabled;

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

    if (
      !(await CodeTaskGate.isRepositoryReachable({
        projectId: data.projectId,
        repositoryId: data.repository.id!,
      }))
    ) {
      return {
        type: CodeTaskBlockerType.RepositoryNotConnected,
        message: CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
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

    const agentCheck: AIFixReadinessCheck =
      await CodeFixReadiness.getAgentCheck({ projectId: data.projectId });

    if (!agentCheck.ok) {
      return {
        type: CodeTaskBlockerType.NoAgent,
        message: agentCheck.detail,
      };
    }

    return null;
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
   * Whether the Runner can be handed a token for the repository: a GitHub
   * repository connected through the GitHub App, whose installation is still
   * bound to its project - what /ai-agent-data/get-repository-token asks
   * before it mints one.
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
   * Which of the repositories AI can work in, in two reads: the rows, and
   * the installation bound to the project. Read as root - the installation
   * id is not every reader's to see, and only the answer goes back.
   */
  @CaptureSpan()
  public static async getReachableRepositoryIds(data: {
    projectId: ObjectID;
    repositoryIds: Array<ObjectID>;
  }): Promise<Set<string>> {
    const reachable: Set<string> = new Set<string>();

    if (data.repositoryIds.length === 0) {
      return reachable;
    }

    const boundInstallationId: string | null =
      await GitHubInstallationBinding.getBoundInstallationId(data.projectId);

    if (!boundInstallationId) {
      return reachable;
    }

    const repositories: Array<CodeRepository> =
      await CodeRepositoryService.findBy({
        query: {
          _id: QueryHelper.any(data.repositoryIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          repositoryHostedAt: true,
          gitHubAppInstallationId: true,
        },
        limit: data.repositoryIds.length,
        skip: 0,
        props: { isRoot: true },
      });

    for (const repository of repositories) {
      if (
        repository.id &&
        repository.repositoryHostedAt === CodeRepositoryType.GitHub &&
        repository.gitHubAppInstallationId === boundInstallationId
      ) {
        reachable.add(repository.id.toString());
      }
    }

    return reachable;
  }
}
