import {
  IDENTITY_REQUIRED_PLAN,
  isPlanAtLeast,
} from "../../Enterprise/EnterpriseEligibility";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import {
  getCredentialsStoppedByMove,
  PlanCutoffCredential,
} from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What a project's plan does to its API keys and SCIM connections, as the
 * Billing page shows it (Common/Types/Billing/PlanCutoffCredentials).
 *
 * On OneUptime Cloud, a project's API keys work only on the plan that sells
 * them (Growth, ApiKey's @TableBillingAccessControl) and its SCIM
 * connections - the project's and its status pages' - only on the plan that
 * sells SCIM (Scale). Below it they stop: every request with one is refused
 * until the project is back on the plan, and nothing is deleted. So the
 * Billing page names how many stop when it offers a lower plan, and how
 * many have stopped on the plan the project is on.
 *
 * Kept free of React so the page and the tests read these exact rules and
 * sentences. The plural sentences are { one, other } literals, which
 * npm run i18n:extract finds. Which plan each needs is read from the models,
 * as the server reads it, and what a move stops is the server's own rule
 * (getCredentialsStoppedByMove).
 */

// The plan a project's API keys need: the plan creating one needs.
export const API_KEY_REQUIRED_PLAN: PlanType =
  new ApiKey().getCreateBillingPlan() || PlanType.Growth;

// The plan a project's SCIM connections need, project and status page alike.
export const SCIM_REQUIRED_PLAN: PlanType =
  new ProjectSCIM().getCreateBillingPlan() || IDENTITY_REQUIRED_PLAN;

/*
 * How many of each the project has that work on a plan that includes them.
 * Null for a kind the person looking may not read - API keys and SCIM
 * connections have read permissions of their own, which someone who may
 * change the plan need not hold: how many is not known, which is not none.
 */
export interface PlanCutoffCounts {
  // API keys that have not expired.
  apiKeys: number | null;
  // SCIM connections: the project's and its status pages'.
  scimConnections: number | null;
}

export const NO_PLAN_CUTOFF_COUNTS: PlanCutoffCounts = {
  apiKeys: 0,
  scimConnections: 0,
};

// Whether `plan` includes what a credential of this kind needs.
const isOnPlan: (
  credential: PlanCutoffCredential,
  plan: PlanType,
) => boolean = (credential: PlanCutoffCredential, plan: PlanType): boolean => {
  return isPlanAtLeast(
    credential === PlanCutoffCredential.ApiKey
      ? API_KEY_REQUIRED_PLAN
      : SCIM_REQUIRED_PLAN,
    plan,
  );
};

/*
 * What stops working on `plan`: the counts of what needs a plan it does
 * not reach. Nothing for a plan that is not known.
 */
export const getStoppedOnPlan: (data: {
  counts: PlanCutoffCounts;
  plan: PlanType | null;
}) => PlanCutoffCounts = (data: {
  counts: PlanCutoffCounts;
  plan: PlanType | null;
}): PlanCutoffCounts => {
  if (!data.plan) {
    return NO_PLAN_CUTOFF_COUNTS;
  }

  return {
    apiKeys: isOnPlan(PlanCutoffCredential.ApiKey, data.plan)
      ? 0
      : data.counts.apiKeys,
    scimConnections: isOnPlan(PlanCutoffCredential.ProjectSCIM, data.plan)
      ? 0
      : data.counts.scimConnections,
  };
};

/*
 * What a move from `fromPlan` to `toPlan` stops: what works on the plan the
 * project is on and not on the one it would move to. Nothing when the plan
 * the project is on is not known - nothing is known to work on it - or for
 * a move that stops nothing (an upgrade, the same plan billed yearly).
 */
export const getStoppedByMove: (data: {
  counts: PlanCutoffCounts;
  fromPlan: PlanType | null;
  toPlan: PlanType;
}) => PlanCutoffCounts = (data: {
  counts: PlanCutoffCounts;
  fromPlan: PlanType | null;
  toPlan: PlanType;
}): PlanCutoffCounts => {
  const stopped: Array<PlanCutoffCredential> = getCredentialsStoppedByMove({
    fromPlan: data.fromPlan,
    toPlan: data.toPlan,
    isOnPlan: isOnPlan,
  });

  return {
    apiKeys: stopped.includes(PlanCutoffCredential.ApiKey)
      ? data.counts.apiKeys
      : 0,
    scimConnections:
      stopped.includes(PlanCutoffCredential.ProjectSCIM) ||
      stopped.includes(PlanCutoffCredential.StatusPageSCIM)
        ? data.counts.scimConnections
        : 0,
  };
};

// Whether any are known to stop. A count that is not known is not counted.
export const hasPlanCutoff: (counts: PlanCutoffCounts) => boolean = (
  counts: PlanCutoffCounts,
): boolean => {
  return (counts.apiKeys || 0) > 0 || (counts.scimConnections || 0) > 0;
};

// The sentences, one per kind, so each is translated whole.
export const PlanCutoffCopy: {
  apiKeysStopOnPlan: PluralTemplate;
  scimStopOnPlan: PluralTemplate;
  apiKeysStopOnPlanUncounted: string;
  scimStopOnPlanUncounted: string;
  apiKeysStoppedOnPlan: PluralTemplate;
  scimStoppedOnPlan: PluralTemplate;
  stoppedNoteTitle: string;
} = {
  // A plan the project could move to, offered in the plan picker.
  apiKeysStopOnPlan: {
    one: "Your API key stops working on this plan.",
    other: "Your {{count}} API keys stop working on this plan.",
  },
  scimStopOnPlan: {
    one: "Your SCIM connection stops working on this plan.",
    other: "Your {{count}} SCIM connections stop working on this plan.",
  },
  // The same, for someone who may not see how many the project has.
  apiKeysStopOnPlanUncounted: translationKey(
    "API keys stop working on this plan.",
  ),
  scimStopOnPlanUncounted: translationKey(
    "SCIM connections stop working on this plan.",
  ),
  // The plan the project is on.
  apiKeysStoppedOnPlan: {
    one: "Your API key stopped working on this plan. It works again on the {{planName}} plan.",
    other:
      "Your {{count}} API keys stopped working on this plan. They work again on the {{planName}} plan.",
  },
  scimStoppedOnPlan: {
    one: "Your SCIM connection stopped working on this plan, so your identity provider no longer adds or removes people. It works again on the {{planName}} plan.",
    other:
      "Your {{count}} SCIM connections stopped working on this plan, so your identity provider no longer adds or removes people. They work again on the {{planName}} plan.",
  },
  stoppedNoteTitle: translationKey("Not working on this plan"),
};

/*
 * What a plan option in the picker adds to its description: a sentence for
 * each kind the move to it would stop - how many, or, for someone who may
 * not see how many there are, that they stop. Empty when it stops nothing.
 */
export const getStopSentences: (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}) => Array<string> = (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}): Array<string> => {
  const sentences: Array<string> = [];

  if (data.stopped.apiKeys === null) {
    sentences.push(
      data.translator.translateTemplate(
        PlanCutoffCopy.apiKeysStopOnPlanUncounted,
      ),
    );
  } else if (data.stopped.apiKeys > 0) {
    sentences.push(
      data.translator.translatePlural(
        PlanCutoffCopy.apiKeysStopOnPlan,
        data.stopped.apiKeys,
      ),
    );
  }

  if (data.stopped.scimConnections === null) {
    sentences.push(
      data.translator.translateTemplate(PlanCutoffCopy.scimStopOnPlanUncounted),
    );
  } else if (data.stopped.scimConnections > 0) {
    sentences.push(
      data.translator.translatePlural(
        PlanCutoffCopy.scimStopOnPlan,
        data.stopped.scimConnections,
      ),
    );
  }

  return sentences;
};

/*
 * What the plan the project is on has stopped: a sentence for each kind,
 * naming the plan that turns it back on. Empty when it stopped nothing, and
 * nothing for a kind whose count is not known: whether there is any to have
 * stopped is not known either.
 */
export const getStoppedSentences: (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}) => Array<string> = (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}): Array<string> => {
  const sentences: Array<string> = [];

  if (data.stopped.apiKeys && data.stopped.apiKeys > 0) {
    sentences.push(
      data.translator.translatePlural(
        PlanCutoffCopy.apiKeysStoppedOnPlan,
        data.stopped.apiKeys,
        { planName: API_KEY_REQUIRED_PLAN },
      ),
    );
  }

  if (data.stopped.scimConnections && data.stopped.scimConnections > 0) {
    sentences.push(
      data.translator.translatePlural(
        PlanCutoffCopy.scimStoppedOnPlan,
        data.stopped.scimConnections,
        { planName: SCIM_REQUIRED_PLAN },
      ),
    );
  }

  return sentences;
};
