import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import {
  BillingPeriod,
  YearlySaving,
  formatPlanPriceInUSD,
  getChargePerUserInUSD,
  getMonthlyPricePerUserInUSD,
  getTrialDays,
  isPlanFree,
} from "../../../../Types/Billing/SubscriptionPlanPricing";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "../../../Utils/TranslateTemplate";

/*
 * What the plan picker says, kept free of React so the component and the
 * tests read the very same strings. Every sentence is whole and wrapped in
 * translationKey() (or written as a PluralTemplate), so npm run i18n:extract
 * finds it; a sentence with a value has a {{placeholder}} for it.
 *
 * Everything said about money follows what OneUptime does, not what reads
 * well:
 *   - a plan's price is per user (a seat is anyone in the project), quoted
 *     per month; billed yearly, the year is charged in advance;
 *   - a new project on a plan with a trial period starts free for that many
 *     days, without a card, and its first invoice comes when the trial ends
 *     (BillingService.subscribeToPlan); a plan without one is billed from
 *     the day the project is created;
 *   - usage - active monitors, telemetry - is metered on every plan
 *     (AllMeteredPlans), and on Free it needs a payment method
 *     (PayAsYouGoBillingService.canUsePayAsYouGo);
 *   - only one person can be in a Free project (TeamMemberService
 *     ALLOWED_PEOPLE_IN_FREE_PLAN, refused with LIMIT_REACHED_FOR_FREE_PLAN);
 *   - a custom-priced plan (Enterprise) is priced by the sales team, who are
 *     told of every new project (ProjectService
 *     sendProjectCreatedSlackNotification).
 */

export const PlanPickerCopy: {
  label: string;
  monthly: string;
  yearly: string;
  billingPeriod: string;
  savePercent: string;
  saveUpToPercent: string;
  perUserPerMonth: string;
  billedYearly: string;
  billedMonthly: string;
  customPrice: string;
  comparePlans: string;
  freeForever: string;
  freeUsage: string;
  paidUsage: string;
  thenBilledYearly: string;
  thenBilledMonthly: string;
  billedYearlyFromToday: string;
  billedMonthlyFromToday: string;
  salesWillContact: string;
} = {
  label: translationKey("Plan"),
  monthly: translationKey("Monthly"),
  yearly: translationKey("Yearly"),
  billingPeriod: translationKey("Billing period"),
  savePercent: translationKey("Save {{percent}}%"),
  saveUpToPercent: translationKey("Save up to {{percent}}%"),
  perUserPerMonth: translationKey("per user / month"),
  billedYearly: translationKey("billed yearly"),
  billedMonthly: translationKey("billed monthly"),
  /*
   * The Billing page's word for it too. Not "Custom" alone: that key is
   * "user-defined" in most languages ("Benutzerdefiniert").
   */
  customPrice: translationKey("Custom Price"),
  comparePlans: translationKey("Compare plans"),
  freeForever: translationKey("Free forever."),
  freeUsage: translationKey(
    "Active monitors and telemetry are pay as you go, and need a payment method.",
  ),
  paidUsage: translationKey("Active monitors and telemetry are pay as you go."),
  thenBilledYearly: translationKey("Then {{price}} per user, billed yearly."),
  thenBilledMonthly: translationKey("Then {{price}} per user, billed monthly."),
  billedYearlyFromToday: translationKey(
    "{{price}} per user, billed yearly from today.",
  ),
  billedMonthlyFromToday: translationKey(
    "{{price}} per user, billed monthly from today.",
  ),
  salesWillContact: translationKey(
    "Our sales team will contact you to agree on a price.",
  ),
};

// The pill on a plan that a new project tries for free first.
export const TRIAL_BADGE: PluralTemplate = {
  one: "{{count}}-day free trial",
  other: "{{count}}-day free trial",
};

// The first thing said about a paid plan with a trial.
export const TRIAL_TERMS: PluralTemplate = {
  one: "Free for {{count}} day, no card needed to start.",
  other: "Free for {{count}} days, no card needed to start.",
};

// The first thing said about a custom-priced plan with a trial.
export const CUSTOM_TRIAL_TERMS: PluralTemplate = {
  one: "Free for {{count}} day.",
  other: "Free for {{count}} days.",
};

/*
 * Who each plan is for, in one line, as the pricing page pitches it. A plan
 * name this deployment configures but OneUptime Cloud does not sell gets no
 * line rather than a wrong one.
 */
const PLAN_AUDIENCE: Record<string, string> = {
  [PlanType.Free]: translationKey("For one person getting started."),
  [PlanType.Growth]: translationKey(
    "For teams. On-call, workflows, integrations and API access.",
  ),
  [PlanType.Scale]: translationKey(
    "For larger teams. SSO, advanced access control and faster support.",
  ),
  [PlanType.Enterprise]: translationKey(
    "Custom terms, a dedicated engineer and phone support.",
  ),
};

// English; looked up where it is drawn.
export const getPlanAudience: (plan: SubscriptionPlan) => string | null = (
  plan: SubscriptionPlan,
): string | null => {
  return PLAN_AUDIENCE[plan.getName()] || null;
};

// One plan as the picker draws it, already in the reader's language.
export interface PlanPickerOptionText {
  name: string;
  audience: string | null;
  // "$20", "$0" or "Custom Price".
  price: string;
  // "per user / month" for a priced plan; null for a free or custom one.
  priceUnit: string | null;
  // "billed yearly" / "billed monthly" for a paid plan; null otherwise.
  priceCaption: string | null;
  // "14-day free trial" for a paid or custom plan with a trial; else null.
  trialBadge: string | null;
}

export const getPlanPickerOptionText: (data: {
  plan: SubscriptionPlan;
  period: BillingPeriod;
  translator: Translator;
}) => PlanPickerOptionText = (data: {
  plan: SubscriptionPlan;
  period: BillingPeriod;
  translator: Translator;
}): PlanPickerOptionText => {
  const { plan, period, translator } = data;
  const audience: string | null = getPlanAudience(plan);
  const trialDays: number = getTrialDays(plan);
  const isFree: boolean = isPlanFree(plan, period);

  const trialBadge: string | null =
    trialDays > 0 && !isFree
      ? translator.translatePlural(TRIAL_BADGE, trialDays)
      : null;

  const base: Pick<PlanPickerOptionText, "name" | "audience" | "trialBadge"> = {
    // A plan's name is its name in every language, as on the invoice.
    name: plan.getName(),
    audience: audience ? translator.translateText(audience) || audience : null,
    trialBadge: trialBadge,
  };

  const perMonth: number | null = getMonthlyPricePerUserInUSD(plan, period);

  if (perMonth === null) {
    return {
      ...base,
      price:
        translator.translateText(PlanPickerCopy.customPrice) ||
        PlanPickerCopy.customPrice,
      priceUnit: null,
      priceCaption: null,
    };
  }

  if (isFree) {
    return {
      ...base,
      price: formatPlanPriceInUSD(0),
      priceUnit: null,
      priceCaption: null,
    };
  }

  return {
    ...base,
    price: formatPlanPriceInUSD(perMonth),
    priceUnit:
      translator.translateText(PlanPickerCopy.perUserPerMonth) ||
      PlanPickerCopy.perUserPerMonth,
    priceCaption:
      translator.translateText(
        period === BillingPeriod.Yearly
          ? PlanPickerCopy.billedYearly
          : PlanPickerCopy.billedMonthly,
      ) || null,
  };
};

/*
 * What picking the plan means for money, under the plans: a headline, and
 * the sentences that follow it.
 */
export interface PlanTermsText {
  headline: string;
  details: Array<string>;
}

export const getPlanTermsText: (data: {
  plan: SubscriptionPlan;
  period: BillingPeriod;
  translator: Translator;
}) => PlanTermsText = (data: {
  plan: SubscriptionPlan;
  period: BillingPeriod;
  translator: Translator;
}): PlanTermsText => {
  const { plan, period, translator } = data;
  const trialDays: number = getTrialDays(plan);
  const text: (english: string) => string = (english: string): string => {
    return translator.translateText(english) || english;
  };

  if (plan.isCustomPricing()) {
    if (trialDays > 0) {
      return {
        headline: translator.translatePlural(CUSTOM_TRIAL_TERMS, trialDays),
        details: [text(PlanPickerCopy.salesWillContact)],
      };
    }

    return {
      headline: text(PlanPickerCopy.salesWillContact),
      details: [],
    };
  }

  if (isPlanFree(plan, period)) {
    return {
      headline: text(PlanPickerCopy.freeForever),
      details: [text(PlanPickerCopy.freeUsage)],
    };
  }

  const charge: number = getChargePerUserInUSD(plan, period) || 0;
  const price: string = formatPlanPriceInUSD(charge);
  const isYearly: boolean = period === BillingPeriod.Yearly;

  if (trialDays > 0) {
    return {
      headline: translator.translatePlural(TRIAL_TERMS, trialDays),
      details: [
        translator.translateTemplate(
          isYearly
            ? PlanPickerCopy.thenBilledYearly
            : PlanPickerCopy.thenBilledMonthly,
          { price: price },
        ),
        text(PlanPickerCopy.paidUsage),
      ],
    };
  }

  return {
    headline: translator.translateTemplate(
      isYearly
        ? PlanPickerCopy.billedYearlyFromToday
        : PlanPickerCopy.billedMonthlyFromToday,
      { price: price },
    ),
    details: [text(PlanPickerCopy.paidUsage)],
  };
};

// The stops after which Chinese and Japanese start the next sentence with no space.
const FULL_WIDTH_STOPS: Array<string> = ["\u3002", "\uFF01", "\uFF1F"];

/*
 * What goes between a sentence and the next thing on its line: a space, or
 * nothing after a full-width stop ("…されます。アクティブ…").
 */
export const getSentenceSeparator: (sentence: string) => string = (
  sentence: string,
): string => {
  return FULL_WIDTH_STOPS.some((stop: string): boolean => {
    return sentence.endsWith(stop);
  })
    ? ""
    : " ";
};

// Whole sentences, one after the other, as the reader's language spaces them.
export const joinSentences: (sentences: Array<string>) => string = (
  sentences: Array<string>,
): string => {
  return sentences.reduce((joined: string, sentence: string): string => {
    return joined ? joined + getSentenceSeparator(joined) + sentence : sentence;
  }, "");
};

// "Save 15%" or "Save up to 15%" beside Yearly; null when nothing is saved.
export const getYearlySavingText: (data: {
  saving: YearlySaving | null;
  translator: Translator;
}) => string | null = (data: {
  saving: YearlySaving | null;
  translator: Translator;
}): string | null => {
  if (!data.saving) {
    return null;
  }

  return data.translator.translateTemplate(
    data.saving.isSameForEveryPlan
      ? PlanPickerCopy.savePercent
      : PlanPickerCopy.saveUpToPercent,
    // Written the reader's way, as a plural's count is.
    { percent: data.translator.formatNumber(data.saving.percent) },
  );
};
