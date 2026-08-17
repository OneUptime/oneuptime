import { beforeEach, describe, expect, it } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * isProjectOnFreePlan decides whether a user is shown a price and made to
 * acknowledge a charge. Two failure directions matter and they are not
 * symmetric: quoting money to a self-hosted user who will never be invoiced is
 * a lie, and blocking their create button over it is a bug. So the predicate
 * fails closed, and every "we are not sure" path is pinned below.
 */

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: true };

(
  globalThis as unknown as { __payAsYouGoConfig: MutableConfig }
).__payAsYouGoConfig = config;

/*
 * BILLING_ENABLED is a module-scope const read at import time, so it has to be
 * switchable per test rather than per file. defineProperty rather than a
 * getter in the object literal: a literal getter is read once while the object
 * is built, which would freeze the value at mock time.
 */
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...jest.requireActual("../../../UI/Config"),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __payAsYouGoConfig: MutableConfig | undefined;
          }
        ).__payAsYouGoConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

// Imported after the mock above so it picks the switchable BILLING_ENABLED up.
import { isProjectOnFreePlan } from "../../../../App/FeatureSet/Dashboard/src/Utils/PayAsYouGo";

describe("isProjectOnFreePlan", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    config.billingEnabled = true;
  });

  describe("on a billed (cloud) deployment", () => {
    it("is true on the Free plan - the one plan that pays as it goes", () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(
        PlanType.Free,
      );

      expect(isProjectOnFreePlan()).toBe(true);
    });

    it.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
      "is false on the %s plan - that project already agreed to be billed",
      (plan: PlanType) => {
        getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(plan);

        expect(isProjectOnFreePlan()).toBe(false);
      },
    );

    it("is false when no plan is known yet - the project is not cached", () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(null);

      expect(isProjectOnFreePlan()).toBe(false);
    });

    it("is false, rather than throwing, when the plan id is not in this deployment's plan table", () => {
      /*
       * getCurrentPlan raises BadDataException for a plan id with no
       * SUBSCRIPTION_PLAN_* entry. A billing notice must never be able to take
       * a page down.
       */
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(() => {
        throw new BadDataException("Plan ID is invalid");
      });

      expect(() => {
        return isProjectOnFreePlan();
      }).not.toThrow();
      expect(isProjectOnFreePlan()).toBe(false);
    });
  });

  describe("on a self-hosted install (billing disabled)", () => {
    beforeEach(() => {
      config.billingEnabled = false;
    });

    it("is false even though there is no paid plan - nothing is charged", () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(
        PlanType.Free,
      );

      expect(isProjectOnFreePlan()).toBe(false);
    });

    it("does not even ask what the plan is", () => {
      const getCurrentPlan: jest.SpyInstance<any, any> = getJestSpyOn(
        ProjectUtil,
        "getCurrentPlan",
      );

      isProjectOnFreePlan();

      expect(getCurrentPlan).not.toHaveBeenCalled();
    });
  });
});
