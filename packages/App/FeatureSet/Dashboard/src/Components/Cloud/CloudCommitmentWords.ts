import { CloudCommitmentKind } from "Common/Types/Cloud/CloudCommitments";
import {
  CLOUD_COMMITMENT_PAYMENT_LABELS,
  CloudCommitmentPaymentOption,
} from "Common/Types/Cloud/CloudCommitmentInventory";
import { CloudCommitmentPlan } from "Common/Types/Cloud/CloudCommitmentPlans";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatCloudMoney } from "./CloudCostWords";

/*
 * WHAT A COMMITMENT AND ITS PLAN SAY, IN THE READER'S LANGUAGE (#11011):
 * when one ends, what to buy, what it saves and when it breaks even, and
 * how coverage changes - each a whole sentence of the locale, its figures
 * in the reader's digits. React-free, so the page's tests read it plain.
 */

export const ENDS_IN_DAYS: PluralTemplate = {
  one: "Ends in {{count}} day",
  other: "Ends in {{count}} days",
};
export const ENDS_TODAY: string = translationKey("Ends today");
export const ENDED: string = translationKey("Ended");
export const RENEWS_ITSELF: string = translationKey("Renews itself");
export const TERM_YEARS: PluralTemplate = {
  one: "{{count}} year",
  other: "{{count}} years",
};
export const TERM_MONTHS: PluralTemplate = {
  one: "{{count}} month",
  other: "{{count}} months",
};
export const PLAN_HOURLY: string = translationKey("{{amount}} an hour");
export const PLAN_SAVES_A_MONTH: string = translationKey(
  "Saves {{amount}} a month",
);
export const PLAN_COSTS_MORE: string = translationKey(
  "Costs more than on demand at its last month's use",
);
export const PLAN_BREAKS_EVEN_IN: PluralTemplate = {
  one: "Breaks even in {{count}} month",
  other: "Breaks even in {{count}} months",
};
export const PLAN_SAVES_FROM_FIRST_MONTH: string = translationKey(
  "Saves from the first month",
);
export const PLAN_PAYS_OFF_ABOVE: string = translationKey(
  "Pays off when at least {{percent}} of it is used",
);
export const PLAN_IF_IT_LAPSES: string = translationKey(
  "If it lapses, coverage falls from {{now}} to {{after}}",
);
export const PLAN_ONCE_BOUGHT: string = translationKey(
  "Once bought, coverage rises from {{now}} to {{after}}",
);
export const PLAN_NO_FIGURES: string = translationKey(
  "Its cloud does not say what it covers in money: renew it at the size its utilization shows it needs.",
);

// "1 year", "3 years" - or months, for a term that is not whole years.
export function getCloudCommitmentTermText(data: {
  termMonths: number | null | undefined;
  translator: Translator;
}): string {
  const months: number = Number(data.termMonths) || 0;

  if (months <= 0) {
    return "";
  }

  return months % 12 === 0
    ? data.translator.translatePlural(TERM_YEARS, months / 12)
    : data.translator.translatePlural(TERM_MONTHS, months);
}

// "1 year, All upfront": a commitment's term and how it is paid.
export function getCloudCommitmentTermLine(data: {
  termMonths: number | null | undefined;
  paymentOption: CloudCommitmentPaymentOption | null | undefined;
  translator: Translator;
}): string {
  const parts: Array<string> = [];
  const term: string = getCloudCommitmentTermText(data);

  if (term) {
    parts.push(term);
  }

  if (
    data.paymentOption &&
    CLOUD_COMMITMENT_PAYMENT_LABELS[data.paymentOption]
  ) {
    parts.push(
      data.translator.translateText(
        CLOUD_COMMITMENT_PAYMENT_LABELS[data.paymentOption],
      ) || CLOUD_COMMITMENT_PAYMENT_LABELS[data.paymentOption],
    );
  }

  return parts.join(", ");
}

/*
 * When a commitment ends, as its row says it: "Ends in 23 days", "Ends
 * today", "Ended" - or that it renews itself. Null for one with no end.
 */
export function getCloudCommitmentEndText(data: {
  daysLeft: number | null;
  isAutoRenew: boolean;
  translator: Translator;
}): string | null {
  if (data.daysLeft === null) {
    return null;
  }

  if (data.daysLeft < 0) {
    return data.translator.translateText(ENDED) || ENDED;
  }

  if (data.isAutoRenew) {
    return data.translator.translateText(RENEWS_ITSELF) || RENEWS_ITSELF;
  }

  if (data.daysLeft === 0) {
    return data.translator.translateText(ENDS_TODAY) || ENDS_TODAY;
  }

  return data.translator.translatePlural(ENDS_IN_DAYS, data.daysLeft);
}

// How urgent an end is: soon (a week), near (a month), or neither.
export function getCloudCommitmentEndTone(
  daysLeft: number | null,
): "danger" | "warning" | "neutral" {
  if (daysLeft === null || daysLeft < 0) {
    return "neutral";
  }

  if (daysLeft <= 7) {
    return "danger";
  }

  return daysLeft <= 30 ? "warning" : "neutral";
}

/*
 * A plan's lines, in the reader's language: what to buy, what it saves a
 * month, when it breaks even and at what use, and how coverage changes.
 * A plan without money figures (Azure's reservations, Google Cloud's
 * commitments) says so instead.
 */
export function getCloudCommitmentPlanLines(data: {
  plan: CloudCommitmentPlan;
  // What a reservation's count is of: its instance type, its SKU.
  quantityOf?: string | undefined;
  translator: Translator;
}): Array<string> {
  const plan: CloudCommitmentPlan = data.plan;
  const translator: Translator = data.translator;
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({ amount, currency: plan.currency, translator });
  };
  const percent: (value: number) => string = (value: number): string => {
    return `${translator.formatNumber(Math.round(value))}%`;
  };
  const lines: Array<string> = [];
  const what: Array<string> = [];

  if (plan.hourlyCommitment !== null) {
    what.push(
      translator.translateTemplate(PLAN_HOURLY, {
        amount: formatCloudMoney({
          amount: plan.hourlyCommitment,
          currency: plan.currency,
          translator,
        }),
      }),
    );
  } else if (plan.quantity !== null) {
    what.push(
      data.quantityOf
        ? `${translator.formatNumber(plan.quantity)} × ${data.quantityOf}`
        : translator.formatNumber(plan.quantity),
    );
  }

  const term: string = getCloudCommitmentTermLine({
    termMonths: plan.termMonths,
    paymentOption: plan.paymentOption,
    translator,
  });

  if (term) {
    what.push(term);
  }

  if (what.length > 0) {
    lines.push(what.join(" · "));
  }

  if (plan.monthlySavings === null || plan.monthlyCost === null) {
    lines.push(translator.translateText(PLAN_NO_FIGURES) || PLAN_NO_FIGURES);
    return lines;
  }

  lines.push(
    plan.monthlySavings > 0
      ? translator.translateTemplate(PLAN_SAVES_A_MONTH, {
          amount: money(plan.monthlySavings),
        })
      : translator.translateText(PLAN_COSTS_MORE) || PLAN_COSTS_MORE,
  );

  if (plan.breakEvenMonths !== null && plan.monthlySavings > 0) {
    lines.push(
      plan.breakEvenMonths === 0
        ? translator.translateText(PLAN_SAVES_FROM_FIRST_MONTH) ||
            PLAN_SAVES_FROM_FIRST_MONTH
        : translator.translatePlural(
            PLAN_BREAKS_EVEN_IN,
            Math.max(1, Math.ceil(plan.breakEvenMonths)),
          ),
    );
  }

  if (plan.breakEvenUtilizationPercent !== null && plan.monthlySavings > 0) {
    lines.push(
      translator.translateTemplate(PLAN_PAYS_OFF_ABOVE, {
        percent: percent(plan.breakEvenUtilizationPercent),
      }),
    );
  }

  if (plan.coverageNowPercent !== null && plan.coverageAfterPercent !== null) {
    lines.push(
      translator.translateTemplate(
        plan.kind === "renewal" ? PLAN_IF_IT_LAPSES : PLAN_ONCE_BOUGHT,
        {
          now: percent(plan.coverageNowPercent),
          after: percent(plan.coverageAfterPercent),
        },
      ),
    );
  }

  return lines;
}

/*
 * Which kind of commitment a "commit to use" recommendation is for, from
 * its words: a Savings Plan or a reservation (Reserved Instances, Azure
 * reservations) - and, on Google Cloud, a committed use discount.
 */
export function getRecommendedCommitmentKind(data: {
  provider: string;
  words: string;
}): CloudCommitmentKind {
  if (data.provider === "gcp") {
    return CloudCommitmentKind.CommittedUseDiscounts;
  }

  return data.words.toLowerCase().includes("savings plan")
    ? CloudCommitmentKind.SavingsPlans
    : CloudCommitmentKind.Reservations;
}
