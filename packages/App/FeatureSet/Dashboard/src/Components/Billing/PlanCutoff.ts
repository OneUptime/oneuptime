import { IDENTITY_REQUIRED_PLAN, isPlanAtLeast } from "../../Enterprise/EnterpriseEligibility";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
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
 * npm run i18n:extract finds.
 */

// The plan a project's API keys need.
export const API_KEY_REQUIRED_PLAN: PlanType =
  new ApiKey().getCreateBillingPlan() || PlanType.Growth;

// The plan a project's SCIM connections need, project and status page alike.
export const SCIM_REQUIRED_PLAN: PlanType = IDENTITY_REQUIRED_PLAN;

// How many of each the project has that work on a plan that includes them.
export interface PlanCutoffCounts {
  // API keys that have not expired.
  apiKeys: number;
  // SCIM connections: the project's and its status pages'.
  scimConnections: number;
}

export const NO_PLAN_CUTOFF_COUNTS: PlanCutoffCounts = {
  apiKeys: 0,
  scimConnections: 0,
};

// Whether a plan includes what needs `requiredPlan`.
type PlanReaches = (requiredPlan: PlanType, plan: PlanType) => boolean;

const reaches: PlanReaches = (
  requiredPlan: PlanType,
  plan: PlanType,
): boolean => {
  return isPlanAtLeast(requiredPlan, plan);
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
    apiKeys: reaches(API_KEY_REQUIRED_PLAN, data.plan) ? 0 : data.counts.apiKeys,
    scimConnections: reaches(SCIM_REQUIRED_PLAN, data.plan)
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
  if (!data.fromPlan || data.fromPlan === data.toPlan) {
    return NO_PLAN_CUTOFF_COUNTS;
  }

  const stopsOnMove: (requiredPlan: PlanType) => boolean = (
    requiredPlan: PlanType,
  ): boolean => {
    return (
      reaches(requiredPlan, data.fromPlan!) && !reaches(requiredPlan, data.toPlan)
    );
  };

  return {
    apiKeys: stopsOnMove(API_KEY_REQUIRED_PLAN) ? data.counts.apiKeys : 0,
    scimConnections: stopsOnMove(SCIM_REQUIRED_PLAN)
      ? data.counts.scimConnections
      : 0,
  };
};

export const hasPlanCutoff: (counts: PlanCutoffCounts) => boolean = (
  counts: PlanCutoffCounts,
): boolean => {
  return counts.apiKeys > 0 || counts.scimConnections > 0;
};

// The sentences, one per kind, so each is translated whole.
export const PlanCutoffCopy: {
  apiKeysStopOnPlan: PluralTemplate;
  scimStopOnPlan: PluralTemplate;
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
 * each kind the move to it would stop. Empty when it stops nothing.
 */
export const getStopSentences: (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}) => Array<string> = (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}): Array<string> => {
  const sentences: Array<string> = [];

  if (data.stopped.apiKeys > 0) {
    sentences.push(
      data.translator.translatePlural(
        PlanCutoffCopy.apiKeysStopOnPlan,
        data.stopped.apiKeys,
      ),
    );
  }

  if (data.stopped.scimConnections > 0) {
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
 * naming the plan that turns it back on. Empty when it stopped nothing.
 */
export const getStoppedSentences: (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}) => Array<string> = (data: {
  translator: Translator;
  stopped: PlanCutoffCounts;
}): Array<string> => {
  const sentences: Array<string> = [];

  if (data.stopped.apiKeys > 0) {
    sentences.push(
      data.translator.translatePlural(
        PlanCutoffCopy.apiKeysStoppedOnPlan,
        data.stopped.apiKeys,
        { planName: API_KEY_REQUIRED_PLAN },
      ),
    );
  }

  if (data.stopped.scimConnections > 0) {
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
