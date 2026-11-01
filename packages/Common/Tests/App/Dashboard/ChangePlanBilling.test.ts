import { describe, expect, it } from "@jest/globals";
import {
  CHANGE_PLAN_SAME_PLAN_ERROR,
  ChangePlanBillingCopy,
  getChangePlanError,
  getRunningTrialEnd,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/ChangePlanBilling";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import fs from "fs";
import path from "path";

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

/*
 * Save Changes with the plan the project is on still picked (UI review of
 * #5482): the form says so under the plans, rather than running a plan
 * change that changes nothing.
 */
describe("getChangePlanError", () => {
  const PLANS: Array<SubscriptionPlan> = [
    new SubscriptionPlan(
      "price_free_month",
      "price_free_year",
      "Free",
      0,
      0,
      1,
      0,
    ),
    new SubscriptionPlan(
      "price_growth_month",
      "price_growth_year",
      "Growth",
      22,
      20,
      2,
      14,
    ),
  ];

  function errorFor(
    pickedPlanId: string | null,
    currentPlanId: string | null,
  ): string | null {
    return getChangePlanError({ plans: PLANS, pickedPlanId, currentPlanId });
  }

  it("says the project is already on the plan picked", () => {
    expect(errorFor("price_growth_year", "price_growth_year")).toBe(
      "The project is already on this plan. Pick another plan to change to.",
    );
    expect(CHANGE_PLAN_SAME_PLAN_ERROR).toBe(
      "The project is already on this plan. Pick another plan to change to.",
    );
  });

  it("lets another plan, or the other period of a paid one, be saved", () => {
    expect(errorFor("price_free_month", "price_growth_year")).toBeNull();
    expect(errorFor("price_growth_month", "price_growth_year")).toBeNull();
  });

  it("counts Free at either period as the plan the project is on", () => {
    expect(errorFor("price_free_year", "price_free_month")).toBe(
      CHANGE_PLAN_SAME_PLAN_ERROR,
    );
  });

  it("asks nothing of a project whose plan is not read yet, or of no pick", () => {
    expect(errorFor("price_growth_year", null)).toBeNull();
    // Nothing picked is the form's own required check.
    expect(errorFor(null, "price_growth_year")).toBeNull();
  });

  it("is in all 16 Dashboard languages", () => {
    const localesDirectory: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
    );

    const files: Array<string> = fs
      .readdirSync(localesDirectory)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(localesDirectory, file), "utf8"),
      ) as Record<string, unknown>;
      const translated: unknown = locale[CHANGE_PLAN_SAME_PLAN_ERROR];

      expect({ file, isText: typeof translated }).toEqual({
        file,
        isText: "string",
      });

      if (file !== "en.json") {
        expect({
          file,
          untranslated: translated === CHANGE_PLAN_SAME_PLAN_ERROR,
        }).toEqual({
          file,
          untranslated: false,
        });
      }
    }
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
