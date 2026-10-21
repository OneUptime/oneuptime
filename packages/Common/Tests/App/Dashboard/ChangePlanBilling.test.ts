import { describe, expect, it } from "@jest/globals";
import {
  ChangePlanBillingCopy,
  getRunningTrialEnd,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/ChangePlanBilling";
import OneUptimeDate from "../../../Types/Date";

/*
 * What the Change Plan picker may say about a trial (Dashboard
 * Components/Billing/ChangePlanBilling).
 *
 * A plan change keeps a trial the project is still on and never starts one.
 * The picker used to promise "Free 14 days trial." on every plan with a
 * trial period, and a project on Free that upgraded to Growth on the
 * strength of it was charged the year up front, then again for every user
 * it invited.
 */

type DaysFromNowFunction = (days: number) => Date;

// getSomeDaysAfter goes through PositiveNumber, so it cannot count backwards.
const daysFromNow: DaysFromNowFunction = (days: number): Date => {
  return OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), days);
};

describe("getRunningTrialEnd", () => {
  it("returns the end of a trial that is still running", () => {
    const trialEndsAt: Date = daysFromNow(9);

    expect(getRunningTrialEnd(trialEndsAt)).toEqual(trialEndsAt);
  });

  it("reads a trial end sent as a string", () => {
    const trialEndsAt: Date = daysFromNow(9);

    expect(getRunningTrialEnd(trialEndsAt.toISOString())?.getTime()).toBe(
      trialEndsAt.getTime(),
    );
  });

  it("returns null for a project that never had a trial", () => {
    // A project created on Free has no trial date at all.
    expect(getRunningTrialEnd(null)).toBeNull();
    expect(getRunningTrialEnd(undefined)).toBeNull();
    expect(getRunningTrialEnd("")).toBeNull();
  });

  it("returns null for a trial that has ended", () => {
    expect(getRunningTrialEnd(daysFromNow(-1))).toBeNull();
    expect(getRunningTrialEnd(daysFromNow(-90).toISOString())).toBeNull();
  });

  it("returns null for the moment a plan change stamps on a project with no trial", () => {
    /*
     * ProjectService.changePlan records "now" as the trial end when neither
     * side has a trial - what a project upgraded from Free carries. It is
     * never a trial to carry over, at the moment it is written or after.
     */
    expect(getRunningTrialEnd(OneUptimeDate.getCurrentDate())).toBeNull();
    expect(
      getRunningTrialEnd(
        OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), -5),
      ),
    ).toBeNull();
  });

  it("returns null for a date it cannot read", () => {
    expect(getRunningTrialEnd("not a date")).toBeNull();
  });
});

describe("ChangePlanBillingCopy", () => {
  it("says, when there is no trial, that changing plan does not start one", () => {
    expect(ChangePlanBillingCopy.noTrialTitle).toBe(
      "Changing plan does not start a free trial",
    );
  });

  it("says that a paid plan is billed from the change and invited users when they are invited", () => {
    expect(ChangePlanBillingCopy.noTrialDescription).toBe(
      "A paid plan is billed from the moment you change to it, and every user you invite on it is billed when you invite them.",
    );
  });

  it("names the date a running trial ends and that it carries over to any plan", () => {
    expect(ChangePlanBillingCopy.trialTitle).toBe(
      "Your free trial carries over",
    );
    expect(ChangePlanBillingCopy.trialDescription).toBe(
      "Your free trial runs until {{date}} on whichever plan you choose. Billing starts when it ends.",
    );
  });

  it("never promises a trial of a given length, which only a new project gets", () => {
    for (const sentence of Object.values(ChangePlanBillingCopy)) {
      expect(sentence).not.toMatch(/\d+\s*days?\s*trial/i);
      expect(sentence).not.toMatch(/\{\{count\}\}/);
    }
  });
});
