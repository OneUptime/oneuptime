import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import Project from "../../../Models/DatabaseModels/Project";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * ProjectService.changePlan is the hop that hands a project's running trial to
 * the payment provider. If the trial does not make it across, the customer is
 * billed the full plan the moment they pick a different one - which is what
 * upgrading mid-trial used to do.
 *
 * Everything below the service boundary is spied: no database, no Stripe.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,

    /*
     * config.env carries a real incoming webhook URL, and changePlan announces
     * every plan change on it. Blanked so the suite cannot post to Slack.
     */
    NotificationSlackWebhookOnSubscriptionUpdate: "",
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CUSTOMER_ID: string = "cus_789";
const SUBSCRIPTION_ID: string = "sub_main_123";
const METERED_SUBSCRIPTION_ID: string = "sub_metered_456";
const NEW_SUBSCRIPTION_ID: string = "sub_main_new_789";
const NEW_METERED_SUBSCRIPTION_ID: string = "sub_metered_new_012";
const NEW_PLAN_ID: string = "price_monthly_scale";

function fakeProject(overrides?: Record<string, unknown>): Project {
  return {
    id: PROJECT_ID,
    _id: PROJECT_ID.toString(),
    trialEndsAt: OneUptimeDate.getSomeDaysAfter(9),
    paymentProviderCustomerId: CUSTOMER_ID,
    paymentProviderSubscriptionId: SUBSCRIPTION_ID,
    paymentProviderMeteredSubscriptionId: METERED_SUBSCRIPTION_ID,
    paymentProviderSubscriptionSeats: 4,
    paymentProviderPlanId: "price_monthly_growth",

    /*
     * Left unset on purpose: capturePlanChangeAnalytics returns early without
     * an owner email, so the suite never reaches the analytics client.
     */
    ...overrides,
  } as unknown as Project;
}

describe("ProjectService.changePlan", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface ChangePlanSpies {
    findOneById: jest.SpyInstance;
    changePlan: jest.SpyInstance;
    hasPaymentMethods: jest.SpyInstance;
    getSubscriptionStatus: jest.SpyInstance;
    updateOneById: jest.SpyInstance;
    getUniqueTeamMemberCountInProject: jest.SpyInstance;
  }

  function setup(data?: {
    project?: Project | null;

    /*
     * The trial the payment provider reports on the subscriptions it created.
     * Omitted means it reported none.
     */
    billingTrialEndsAt?: Date | undefined;

    // Trial period configured on the plan being moved to. 0 for Scale/Basic.
    newPlanTrialPeriodInDays?: number;

    /*
     * Subscriptions changePlan replaced but could not cancel. They are about
     * to disappear from the project row, so the plan change has to raise them.
     */
    subscriptionIdsPendingCancellation?: Array<string> | undefined;
  }): ChangePlanSpies {
    const findOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        data && data.project !== undefined ? data.project : fakeProject(),
      );

    jest
      .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
      .mockReturnValue(
        new SubscriptionPlan(
          NEW_PLAN_ID,
          "price_yearly_scale",
          "Scale",
          99,
          84,
          3,
          data?.newPlanTrialPeriodInDays ?? 0,
        ),
      );

    const hasPaymentMethods: jest.SpyInstance = jest
      .spyOn(BillingService, "hasPaymentMethods")
      .mockResolvedValue(true as never);

    const changePlan: jest.SpyInstance = jest
      .spyOn(BillingService, "changePlan")
      .mockResolvedValue({
        subscriptionId: NEW_SUBSCRIPTION_ID,
        meteredSubscriptionId: NEW_METERED_SUBSCRIPTION_ID,
        trialEndsAt: data?.billingTrialEndsAt,
        subscriptionIdsPendingCancellation:
          data?.subscriptionIdsPendingCancellation || [],
      } as never);

    const getSubscriptionStatus: jest.SpyInstance = jest
      .spyOn(BillingService, "getSubscriptionStatus")
      .mockResolvedValue(SubscriptionStatus.Trialing as never);

    const updateOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const getUniqueTeamMemberCountInProject: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
      .mockResolvedValue(7 as never);

    return {
      findOneById,
      changePlan,
      hasPaymentMethods,
      getSubscriptionStatus,
      updateOneById,
      getUniqueTeamMemberCountInProject,
    };
  }

  function getUpdatedData(spies: ChangePlanSpies): Record<string, unknown> {
    return (
      spies.updateOneById.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      }
    ).data;
  }

  describe("reading the project", () => {
    it("should select the trial date", async () => {
      /*
       * Without this column in the select the trial reads back undefined, the
       * plan change is made with no trial, and the customer is charged. Same
       * failure mode the extend-trial suite guards.
       */
      const spies: ChangePlanSpies = setup();

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(spies.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ trialEndsAt: true }),
        }),
      );
    });
  });

  describe("carrying the running trial to the payment provider", () => {
    it("should hand the project's trial over when it is still running", async () => {
      /*
       * This assertion is the feature. The trial is what stops Stripe raising
       * an invoice for the new plan on the spot.
       */
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ trialEndsAt: runningTrialEndsAt }),
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ endTrialAt: runningTrialEndsAt }),
      );
    });

    it("should hand the trial over even when the plan moved to has no trial period of its own", async () => {
      /*
       * Scale and Basic are configured with 0 trial days. That says how long a
       * NEW trial on them runs - it must not shorten a trial the customer is
       * already in the middle of.
       */
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ trialEndsAt: runningTrialEndsAt }),
        newPlanTrialPeriodInDays: 0,
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ endTrialAt: runningTrialEndsAt }),
      );
    });

    it("should let an explicitly supplied trial date win over the project's", async () => {
      const explicitTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(30);
      const spies: ChangePlanSpies = setup({
        project: fakeProject({
          trialEndsAt: OneUptimeDate.getSomeDaysAfter(2),
        }),
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
        endTrialAt: explicitTrialEndsAt,
      });

      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ endTrialAt: explicitTrialEndsAt }),
      );
    });

    it("should end the trial when null is explicitly supplied", async () => {
      /*
       * null is the caller saying "no trial", as distinct from undefined,
       * which means "whatever the project has".
       */
      const spies: ChangePlanSpies = setup({
        project: fakeProject({
          trialEndsAt: OneUptimeDate.getSomeDaysAfter(9),
        }),
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
        endTrialAt: null,
      });

      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ endTrialAt: undefined }),
      );
    });

    it("should hand over no trial when the project has none", async () => {
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ trialEndsAt: null }),
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ endTrialAt: undefined }),
      );
    });

    it("should forward a lapsed trial date and leave the payment provider to drop it", async () => {
      /*
       * A single place decides whether a trial is still live, and it is the one
       * next to the payment provider call. Filtering here as well would mean
       * two answers to the same question.
       */
      const lapsed: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        -5,
      );
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ trialEndsAt: lapsed }),
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ endTrialAt: lapsed }),
      );
    });
  });

  describe("writing the result back to the project", () => {
    it("should record the trial the payment provider reports", async () => {
      const trialFromBilling: Date = OneUptimeDate.getSomeDaysAfter(9);
      const spies: ChangePlanSpies = setup({
        billingTrialEndsAt: trialFromBilling,
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(getUpdatedData(spies)["trialEndsAt"]).toEqual(trialFromBilling);
    });

    it("should prefer the payment provider's trial over the one it sent", async () => {
      /*
       * The payment provider is the source of truth for what the customer is
       * actually trialing on, so a date it reports back wins over the request.
       */
      const trialFromBilling: Date = OneUptimeDate.getSomeDaysAfter(20);
      const spies: ChangePlanSpies = setup({
        project: fakeProject({
          trialEndsAt: OneUptimeDate.getSomeDaysAfter(9),
        }),
        billingTrialEndsAt: trialFromBilling,
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(getUpdatedData(spies)["trialEndsAt"]).toEqual(trialFromBilling);
    });

    it("should keep the requested trial when the payment provider reports none", async () => {
      const runningTrialEndsAt: Date = OneUptimeDate.getSomeDaysAfter(9);
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ trialEndsAt: runningTrialEndsAt }),
        billingTrialEndsAt: undefined,
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(getUpdatedData(spies)["trialEndsAt"]).toEqual(runningTrialEndsAt);
    });

    it("should mark the trial as over when there is none on either side", async () => {
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ trialEndsAt: null }),
        billingTrialEndsAt: undefined,
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      const written: Date = getUpdatedData(spies)["trialEndsAt"] as Date;

      expect(written).toBeInstanceOf(Date);
      expect(OneUptimeDate.isInTheFuture(written)).toBe(false);
    });

    it("should record the new subscriptions, plan and seat count", async () => {
      const spies: ChangePlanSpies = setup();

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(getUpdatedData(spies)).toEqual(
        expect.objectContaining({
          paymentProviderPlanId: NEW_PLAN_ID,
          paymentProviderSubscriptionId: NEW_SUBSCRIPTION_ID,
          paymentProviderMeteredSubscriptionId: NEW_METERED_SUBSCRIPTION_ID,
          paymentProviderSubscriptionSeats: 4,
          planName: "Scale",
          paymentProviderSubscriptionStatus: SubscriptionStatus.Trialing,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Trialing,
        }),
      );
    });

    it("should write the project row only after the payment provider has accepted the change", async () => {
      /*
       * The payment provider decides what the customer is charged, so it goes
       * first: a rejected change must leave the project on its old plan and its
       * old trial rather than showing a plan the customer is not on.
       */
      const spies: ChangePlanSpies = setup();
      spies.changePlan.mockRejectedValue(new Error("card declined") as never);

      await expect(
        ProjectService.changePlan({
          projectId: PROJECT_ID,
          paymentProviderPlanId: NEW_PLAN_ID,
        }),
      ).rejects.toThrow("card declined");

      expect(spies.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("seats", () => {
    it("should reuse the stored seat count", async () => {
      const spies: ChangePlanSpies = setup();

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(spies.getUniqueTeamMemberCountInProject).not.toHaveBeenCalled();
      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 4 }),
      );
    });

    it("should count team members when no seat count is stored", async () => {
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ paymentProviderSubscriptionSeats: 0 }),
      });

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(spies.getUniqueTeamMemberCountInProject).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(spies.changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 7 }),
      );
    });
  });

  describe("refusing to change plan", () => {
    it("should throw when the project does not exist", async () => {
      setup({ project: null });

      await expect(
        ProjectService.changePlan({
          projectId: PROJECT_ID,
          paymentProviderPlanId: NEW_PLAN_ID,
        }),
      ).rejects.toThrow("Project not found");
    });

    it("should throw when the customer has no payment method", async () => {
      const spies: ChangePlanSpies = setup();
      spies.hasPaymentMethods.mockResolvedValue(false as never);

      await expect(
        ProjectService.changePlan({
          projectId: PROJECT_ID,
          paymentProviderPlanId: NEW_PLAN_ID,
        }),
      ).rejects.toThrow();

      expect(spies.changePlan).not.toHaveBeenCalled();
    });

    it("should throw when the plan id is not a known plan", async () => {
      const spies: ChangePlanSpies = setup();
      (
        SubscriptionPlan.getSubscriptionPlanById as unknown as jest.SpyInstance
      ).mockReturnValue(undefined);

      await expect(
        ProjectService.changePlan({
          projectId: PROJECT_ID,
          paymentProviderPlanId: "not_a_plan",
        }),
      ).rejects.toThrow("Invalid plan");

      expect(spies.changePlan).not.toHaveBeenCalled();
    });

    it("should throw when the project has no subscription to change", async () => {
      const spies: ChangePlanSpies = setup({
        project: fakeProject({ paymentProviderSubscriptionId: null }),
      });

      await expect(
        ProjectService.changePlan({
          projectId: PROJECT_ID,
          paymentProviderPlanId: NEW_PLAN_ID,
        }),
      ).rejects.toThrow("Payment Provider subscription not found");

      expect(spies.changePlan).not.toHaveBeenCalled();
    });

    it("should throw when the project has no metered subscription to change", async () => {
      const spies: ChangePlanSpies = setup({
        project: fakeProject({
          paymentProviderMeteredSubscriptionId: null,
        }),
      });

      await expect(
        ProjectService.changePlan({
          projectId: PROJECT_ID,
          paymentProviderPlanId: NEW_PLAN_ID,
        }),
      ).rejects.toThrow("Payment Provider metered subscription not found");

      expect(spies.changePlan).not.toHaveBeenCalled();
    });
  });

  /*
   * A plan change can replace a project's subscriptions, and the row written
   * above is what makes the old ids unreachable - it now carries the new ones.
   * A replaced subscription that could not be cancelled therefore has to be
   * raised here, with its id, or nobody ever finds it again.
   */
  describe("subscriptions that could not be cancelled", () => {
    it("should raise the ids of subscriptions left open at the payment provider", async () => {
      const spies: ChangePlanSpies = setup({
        subscriptionIdsPendingCancellation: [
          SUBSCRIPTION_ID,
          METERED_SUBSCRIPTION_ID,
        ],
      });

      const error: jest.SpyInstance = jest
        .spyOn(logger, "error")
        .mockReturnValue(undefined);

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      const raised: string = error.mock.calls
        .map((call: Array<unknown>) => {
          return String(call[0]);
        })
        .join("\n");

      expect(raised).toContain(SUBSCRIPTION_ID);
      expect(raised).toContain(METERED_SUBSCRIPTION_ID);

      // And the plan change itself still went through.
      expect(getUpdatedData(spies)).toMatchObject({
        paymentProviderSubscriptionId: NEW_SUBSCRIPTION_ID,
        paymentProviderMeteredSubscriptionId: NEW_METERED_SUBSCRIPTION_ID,
      });
    });

    it("should stay quiet when every replaced subscription was cancelled", async () => {
      setup({ subscriptionIdsPendingCancellation: [] });

      const error: jest.SpyInstance = jest
        .spyOn(logger, "error")
        .mockReturnValue(undefined);

      await ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: NEW_PLAN_ID,
      });

      expect(error).not.toHaveBeenCalled();
    });
  });
});
