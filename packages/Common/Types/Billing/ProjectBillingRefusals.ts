import { translationKey } from "../Translator";
import {
  getRefusalText,
  RefusalWithValues,
} from "../Exception/RefusalWithValues";

/*
 * WHY A PROJECT'S PLAN, TRIAL OR BALANCE WAS NOT CHANGED (#11059).
 *
 * ProjectService refused a plan change, a trial's extension, a reactivated
 * subscription and a balance adjustment with fragments: "Invalid plan",
 * "Project not found", "Payment Provider subscription not found", "Cannot
 * deduct 50.01 USD - the balance is only 50 USD", "Invalid balance type:
 * Bitcoin". Each is a sentence now: what happened - nothing was changed or
 * charged - and what to do next. Billing behaves exactly as it did; only
 * its words changed.
 *
 * A project owner meets the plan change's refusals on Project Settings >
 * Billing and Invoices > Billing: the ones marked translationKey() are keys
 * of the Dashboard's locales (this file is a "keys" root of its
 * extractor). A master admin meets the trial's, the plan's and the
 * balance's in the Admin Dashboard, whose locales word them too
 * (ADMIN_DASHBOARD_BILLING_REFUSALS). The ones with values in them are
 * refusals with values (RefusalWithValues), said in the reader's language
 * around their values (Common/UI/Utils/ErrorInSentence). The rest are read
 * in a job's log or by an API client, in English.
 */

// What a project whose billing is not set up with the payment provider does next.
const SET_UP_BILLING: string = "Contact support to set up the project's billing.";

export const ProjectBillingRefusals: {
  billingNotEnabled: string;
  balanceBillingNotEnabled: string;
  noSubscription: string;
  noUsageSubscription: string;
  noCustomer: string;
  noSeats: string;
  noPlan: string;
  amountNotANumber: string;
  amountNotWholeCents: string;
  amountNegative: string;
  amountZero: string;
  noReason: string;
  noPlanYet: string;
} = {
  billingNotEnabled:
    "This server does not bill for projects, so there is no plan or trial to change.",
  balanceBillingNotEnabled:
    "This server does not bill for projects, so there is no balance to adjust.",
  noSubscription: translationKey(
    "This project has no subscription with the payment provider, so nothing was changed or charged. Contact support to set up the project's billing.",
  ),
  noUsageSubscription: translationKey(
    "This project has no usage subscription with the payment provider, so nothing was changed or charged. Contact support to set up the project's billing.",
  ),
  noCustomer: translationKey(
    "This project has no customer record with the payment provider, so nothing was changed or charged. Contact support to set up the project's billing.",
  ),
  noSeats: `This project's subscription does not say how many seats it has, so nothing was changed or charged. ${SET_UP_BILLING}`,
  noPlan: `This project's subscription does not say which plan it is on, so nothing was changed or charged. ${SET_UP_BILLING}`,
  amountNotANumber:
    "The amount is not a number, so the balance was not changed. Enter the amount in US dollars.",
  amountNotWholeCents:
    "The amount has a fraction of a cent, so the balance was not changed. Enter the amount in whole cents.",
  amountNegative:
    "The amount is below zero, so the balance was not changed. Enter a positive amount, and choose Deduct to take it away.",
  amountZero:
    "The amount is zero, so there is nothing to add or deduct. Enter an amount above zero.",
  noReason:
    "The balance was not changed: say why it is being adjusted. The reason is kept with the adjustment.",
  noPlanYet: translationKey(
    "This project has no plan yet, so OneUptime cannot tell what it may use. Choose a plan in Project Settings > Billing and Invoices > Billing.",
  ),
};

/*
 * A project that is gone by the time it is read: deleted meanwhile, or an
 * id a job held on to. Named, so a job's log says which.
 */
export const PROJECT_GONE_REFUSAL: RefusalWithValues = {
  template:
    "Project {{projectId}} is not on this server any more, so nothing was changed or charged.",
  terms: [],
};

/*
 * A plan this server does not offer: one asked for by id, or the one a
 * project was on that the server no longer lists. With the plans it does.
 */
export const UNKNOWN_PLAN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "That plan is not one this server offers, so nothing was changed or charged. Choose one of these plans: {{plans}}.",
  ),
  terms: [],
};

/*
 * A master admin's deduction larger than the balance, with both amounts
 * (in US dollars, with a no-break space before USD, as the balance card
 * writes them).
 */
export const DEDUCT_MORE_THAN_BALANCE_REFUSAL: RefusalWithValues = {
  template:
    "The balance was not changed: {{amount}} is more than the {{balance}} the balance holds. Deduct {{balance}} or less.",
  terms: [],
};

// A master admin's adjustment larger than one adjustment may be.
export const ADJUSTMENT_TOO_LARGE_REFUSAL: RefusalWithValues = {
  template:
    "The balance was not changed: one adjustment can be {{limit}} at most. Adjust it in steps of {{limit}} or less.",
  terms: [],
};

/*
 * The refusals a master admin meets in the Admin Dashboard - extending a
 * trial, changing a project's plan, adjusting a balance - which its locales
 * word in every language it speaks.
 */
export const ADMIN_DASHBOARD_BILLING_REFUSALS: ReadonlyArray<string> = [
  "This project has no subscription with the payment provider, so nothing was changed or charged. Contact support to set up the project's billing.",
  "This project has no usage subscription with the payment provider, so nothing was changed or charged. Contact support to set up the project's billing.",
  PROJECT_GONE_REFUSAL.template,
  UNKNOWN_PLAN_REFUSAL.template,
  DEDUCT_MORE_THAN_BALANCE_REFUSAL.template,
  ADJUSTMENT_TOO_LARGE_REFUSAL.template,
];

// The refusals of this file with values in them, for ErrorInSentence.
export const PROJECT_BILLING_REFUSALS_WITH_VALUES: ReadonlyArray<RefusalWithValues> =
  [
    PROJECT_GONE_REFUSAL,
    UNKNOWN_PLAN_REFUSAL,
    DEDUCT_MORE_THAN_BALANCE_REFUSAL,
    ADJUSTMENT_TOO_LARGE_REFUSAL,
  ];

// An amount in US dollars, as these sentences write it: "50.01 USD".
export const getUsdAmountText: (amountInUSDCents: number) => string = (
  amountInUSDCents: number,
): string => {
  return `${amountInUSDCents / 100} USD`;
};

export const getProjectGoneMessage: (projectId: string) => string = (
  projectId: string,
): string => {
  return getRefusalText(PROJECT_GONE_REFUSAL, { projectId: projectId });
};

export const getUnknownPlanMessage: (planNames: Array<string>) => string = (
  planNames: Array<string>,
): string => {
  return getRefusalText(UNKNOWN_PLAN_REFUSAL, {
    plans: planNames.length > 0 ? planNames.join(", ") : "none",
  });
};

export const getDeductMoreThanBalanceMessage: (data: {
  amountInUSDCents: number;
  balanceInUSDCents: number;
}) => string = (data: {
  amountInUSDCents: number;
  balanceInUSDCents: number;
}): string => {
  return getRefusalText(DEDUCT_MORE_THAN_BALANCE_REFUSAL, {
    amount: getUsdAmountText(data.amountInUSDCents),
    balance: getUsdAmountText(data.balanceInUSDCents),
  });
};

export const getAdjustmentTooLargeMessage: (limitInUSDCents: number) => string =
  (limitInUSDCents: number): string => {
    return getRefusalText(ADJUSTMENT_TOO_LARGE_REFUSAL, {
      limit: getUsdAmountText(limitInUSDCents),
    });
  };

/*
 * A balance OneUptime keeps for a kind it does not know (an API client's
 * own word): the kinds it does.
 */
export const getUnknownBalanceTypeMessage: (data: {
  balanceType: string;
  balanceTypes: Array<string>;
}) => string = (data: {
  balanceType: string;
  balanceTypes: Array<string>;
}): string => {
  return `"${data.balanceType}" is not a balance OneUptime keeps, so nothing was changed. Choose one of these: ${data.balanceTypes.join(", ")}.`;
};
