import { isKnownToBeBelowPlan } from "../../Enterprise/EnterpriseEligibility";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether "Connect with GitHub App" may be pressed: the dashboard's half of
 * the rule the server asks when a connection starts and again when GitHub
 * sends the browser back (Common/Server/API/GitHubConnectAccess). Connecting
 * imports the installation's repositories as the project's code
 * repositories, so it asks what adding them would ask - on OneUptime Cloud
 * the plan code repositories are sold on, and permission to create code
 * repositories.
 *
 * For someone the dashboard knows may not connect, the card stays on screen,
 * locked, and says in one plain sentence what it takes - the plan first, as
 * the server asks it first. Someone it knows nothing about yet (the
 * permissions or the plan not loaded) keeps the card, and the server decides.
 * A team's block row is never a grant, and a block with no labels takes the
 * permission away (PermissionGate). A server admin is never locked out by a
 * permission.
 */

export interface GitHubConnectLock {
  isLocked: boolean;
  // Why it is locked, in the reader's language.
  reason?: string | undefined;
}

// For a plan the project is known to be below.
export const GITHUB_CONNECT_PLAN_REASON: string = translationKey(
  "Connecting GitHub needs the {{planName}} plan.",
);

// For someone who may not create code repositories in the project.
export const GITHUB_CONNECT_PERMISSION_REASON: string = translationKey(
  "Connecting GitHub needs permission to create code repositories.",
);

const NOT_LOCKED: GitHubConnectLock = { isLocked: false };

/*
 * The plan sentence, in the reader's language, naming the plan code
 * repositories are sold on: what the locked card says, and what the page says
 * when GitHub sends the browser back refused for the plan. Undefined where
 * code repositories need no plan.
 */
export const getGitHubConnectPlanReason: () => string | undefined = ():
  | string
  | undefined => {
  const requiredPlan: PlanType | null =
    new CodeRepository().getCreateBillingPlan() || null;

  if (!requiredPlan) {
    return undefined;
  }

  return getGlobalTranslator().translateTemplate(GITHUB_CONNECT_PLAN_REASON, {
    planName: requiredPlan,
  });
};

export const getGitHubConnectLock: (
  options?: PermissionGateOptions | undefined,
) => GitHubConnectLock = (
  options?: PermissionGateOptions | undefined,
): GitHubConnectLock => {
  const repository: CodeRepository = new CodeRepository();
  const requiredPlan: PlanType | null =
    repository.getCreateBillingPlan() || null;

  if (requiredPlan && isKnownToBeBelowPlan(requiredPlan)) {
    return {
      isLocked: true,
      reason: getGitHubConnectPlanReason(),
    };
  }

  const gate: PermissionGateResult = PermissionGate.check(
    repository,
    ModelAction.Create,
    options,
  );

  if (gate.isAllowed) {
    return NOT_LOCKED;
  }

  // Nothing to say means not known yet: the server decides.
  if (!gate.disabledReason) {
    return NOT_LOCKED;
  }

  return {
    isLocked: true,
    reason:
      getGlobalTranslator().translateText(GITHUB_CONNECT_PERMISSION_REASON) ||
      GITHUB_CONNECT_PERMISSION_REASON,
  };
};
