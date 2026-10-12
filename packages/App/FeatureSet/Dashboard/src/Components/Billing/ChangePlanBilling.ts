import OneUptimeDate from "Common/Types/Date";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Change Plan picker says about trials and charges.
 *
 * A plan change never starts a free trial. It keeps the one the project is
 * already on - BillingService.changePlan carries a running trial to the new
 * plan, whatever trial period that plan has - and that is all. A project
 * with no running trial (one created on Free, or one whose trial ended) is
 * billed for a paid plan from the moment it moves to it, and every user it
 * invites after that is billed when they are invited
 * (BillingService.changeQuantity).
 *
 * The picker used to describe every plan with a trial period as "Free 14
 * days trial." That is the trial a NEW project on the plan gets
 * (ProjectPicker), not one a plan change gives. A project on Free that
 * upgraded to Growth read it, was charged the year up front, and was then
 * charged again for each person it invited - believing it was on a trial.
 *
 * Kept free of React so the component and the tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const CHANGE_PLAN_BILLING_NOTE_TEST_ID: string =
  "change-plan-billing-note";

export const ChangePlanBillingCopy: {
  // A project with no running trial.
  noTrialTitle: string;
  noTrialDescription: string;
  // A project still on its trial.
  trialTitle: string;
  trialDescription: string;
} = {
  noTrialTitle: translationKey("Changing plan does not start a free trial"),
  noTrialDescription: translationKey(
    "A paid plan is billed from the moment you change to it, and every user you invite on it is billed when you invite them.",
  ),
  trialTitle: translationKey("Your free trial carries over"),
  trialDescription: translationKey(
    "Your free trial runs until {{date}} on whichever plan you choose. Billing starts when it ends.",
  ),
};

/*
 * When the project's running trial ends, or null when it is not on one: no
 * trial date, or one already behind us. The same test the server applies
 * before it carries a trial across a plan change, so the picker never
 * speaks of a trial the change would not keep.
 */
export const getRunningTrialEnd: (
  trialEndsAt: Date | string | null | undefined,
) => Date | null = (
  trialEndsAt: Date | string | null | undefined,
): Date | null => {
  if (!trialEndsAt) {
    return null;
  }

  const trialEnd: Date = OneUptimeDate.fromString(trialEndsAt);

  if (isNaN(trialEnd.getTime())) {
    return null;
  }

  return OneUptimeDate.isInTheFuture(trialEnd) ? trialEnd : null;
};
