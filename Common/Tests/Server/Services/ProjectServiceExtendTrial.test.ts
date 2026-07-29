import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import Project from "../../../Models/DatabaseModels/Project";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * ProjectService.extendTrial is the orchestration layer: the payment provider
 * is the source of truth for what the customer is charged, so these tests pin
 * the ordering (Stripe first, project row second) and the fact that a failed
 * push leaves the stored trial date alone. Everything below the service
 * boundary is spied - no database, no Stripe.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBSCRIPTION_ID: string = "sub_main_123";
const METERED_SUBSCRIPTION_ID: string = "sub_metered_456";

function fakeProject(overrides?: Record<string, unknown>): Project {
  return {
    id: PROJECT_ID,
    _id: PROJECT_ID.toString(),
    trialEndsAt: OneUptimeDate.getSomeDaysAfter(2),
    paymentProviderSubscriptionId: SUBSCRIPTION_ID,
    paymentProviderMeteredSubscriptionId: METERED_SUBSCRIPTION_ID,
    ...overrides,
  } as unknown as Project;
}

describe("ProjectService.extendTrial", () => {
  const newTrialEndDate: Date = OneUptimeDate.getSomeDaysAfter(30);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface ExtendTrialSpies {
    findOneById: jest.SpyInstance;
    extendTrial: jest.SpyInstance;
    getSubscriptionStatus: jest.SpyInstance;
    updateOneById: jest.SpyInstance;
  }

  function setup(data?: {
    project?: Project | null;
    extendTrialError?: Error;
  }): ExtendTrialSpies {
    const findOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        data && data.project !== undefined ? data.project : fakeProject(),
      );

    const extendTrial: jest.SpyInstance = jest.spyOn(
      BillingService,
      "extendTrial",
    );

    if (data?.extendTrialError) {
      extendTrial.mockRejectedValue(data.extendTrialError as never);
    } else {
      extendTrial.mockResolvedValue(undefined as never);
    }

    const getSubscriptionStatus: jest.SpyInstance = jest
      .spyOn(BillingService, "getSubscriptionStatus")
      .mockResolvedValue(SubscriptionStatus.Trialing as never);

    const updateOneById: jest.SpyInstance = jest
      .spyOn(ProjectService, "updateOneById")
      .mockResolvedValue(undefined as never);

    return { findOneById, extendTrial, getSubscriptionStatus, updateOneById };
  }

  describe("guards", () => {
    it("should throw Project not found when the project does not exist", async () => {
      const spies: ExtendTrialSpies = setup({ project: null });

      await expect(
        ProjectService.extendTrial({
          projectId: PROJECT_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow("Project not found");

      expect(spies.extendTrial).not.toHaveBeenCalled();
      expect(spies.updateOneById).not.toHaveBeenCalled();
    });

    it("should throw when the project has no payment provider subscription", async () => {
      const spies: ExtendTrialSpies = setup({
        project: fakeProject({ paymentProviderSubscriptionId: undefined }),
      });

      await expect(
        ProjectService.extendTrial({
          projectId: PROJECT_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow("Payment Provider subscription not found");

      expect(spies.extendTrial).not.toHaveBeenCalled();
    });

    it("should throw when the project has no metered subscription", async () => {
      /*
       * Every billed project gets both subscriptions at creation. A row with
       * only one is broken, and extending half of it would bill usage during
       * the trial - so fail loudly rather than partially apply.
       */
      const spies: ExtendTrialSpies = setup({
        project: fakeProject({
          paymentProviderMeteredSubscriptionId: undefined,
        }),
      });

      await expect(
        ProjectService.extendTrial({
          projectId: PROJECT_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow("Payment Provider metered subscription not found");

      expect(spies.extendTrial).not.toHaveBeenCalled();
      expect(spies.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("reading the project", () => {
    it("should select the trial date and both subscription ids as root", async () => {
      const spies: ExtendTrialSpies = setup();

      await ProjectService.extendTrial({
        projectId: PROJECT_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(spies.findOneById).toHaveBeenCalledWith({
        id: PROJECT_ID,
        select: {
          _id: true,
          trialEndsAt: true,
          paymentProviderSubscriptionId: true,
          paymentProviderMeteredSubscriptionId: true,
        },
        props: {
          isRoot: true,
        },
      });
    });
  });

  describe("pushing to the payment provider", () => {
    it("should send both subscription ids and the new date", async () => {
      const spies: ExtendTrialSpies = setup();

      await ProjectService.extendTrial({
        projectId: PROJECT_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(spies.extendTrial).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        meteredSubscriptionId: METERED_SUBSCRIPTION_ID,
        trialEndsAt: newTrialEndDate,
      });
    });

    it("should not require the customer to have a payment method", async () => {
      /*
       * A trial extension is most useful for a customer who has not entered a
       * card yet, so it deliberately does not gate on one the way changePlan
       * does.
       */
      setup();

      const hasPaymentMethods: jest.SpyInstance = jest.spyOn(
        BillingService,
        "hasPaymentMethods",
      );

      await ProjectService.extendTrial({
        projectId: PROJECT_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(hasPaymentMethods).not.toHaveBeenCalled();
    });

    it("should call the payment provider before writing the project row", async () => {
      const callOrder: Array<string> = [];

      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(fakeProject());
      jest
        .spyOn(BillingService, "getSubscriptionStatus")
        .mockResolvedValue(SubscriptionStatus.Trialing as never);

      jest.spyOn(BillingService, "extendTrial").mockImplementation((():
        | Promise<void>
        | undefined => {
        callOrder.push("stripe");
        return Promise.resolve();
      }) as never);

      jest.spyOn(ProjectService, "updateOneById").mockImplementation((():
        | Promise<void>
        | undefined => {
        callOrder.push("database");
        return Promise.resolve();
      }) as never);

      await ProjectService.extendTrial({
        projectId: PROJECT_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(callOrder).toEqual(["stripe", "database"]);
    });

    it("should not write to the project row when the payment provider rejects", async () => {
      /*
       * If Stripe refuses, the stored trial date has to stay put - otherwise
       * the customer sees a trial in the dashboard that they are actually
       * being billed for.
       */
      const spies: ExtendTrialSpies = setup({
        extendTrialError: new Error("Stripe API error"),
      });

      await expect(
        ProjectService.extendTrial({
          projectId: PROJECT_ID,
          trialEndsAt: newTrialEndDate,
        }),
      ).rejects.toThrow("Stripe API error");

      expect(spies.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("persisting the result", () => {
    it("should persist the trial date with isRoot and ignoreHooks", async () => {
      /*
       * Project.trialEndsAt has an empty update ACL, so nothing but a root
       * write can set it. ignoreHooks matches how changePlan persists.
       */
      const spies: ExtendTrialSpies = setup();

      await ProjectService.extendTrial({
        projectId: PROJECT_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(spies.updateOneById).toHaveBeenCalledWith({
        id: PROJECT_ID,
        data: {
          trialEndsAt: newTrialEndDate,
          paymentProviderSubscriptionStatus: SubscriptionStatus.Trialing,
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Trialing,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    });

    it("should read both subscription statuses back from the payment provider", async () => {
      const spies: ExtendTrialSpies = setup();

      await ProjectService.extendTrial({
        projectId: PROJECT_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(spies.getSubscriptionStatus).toHaveBeenCalledWith(SUBSCRIPTION_ID);
      expect(spies.getSubscriptionStatus).toHaveBeenCalledWith(
        METERED_SUBSCRIPTION_ID,
      );
    });

    it("should persist whatever statuses the payment provider reports", async () => {
      /*
       * The statuses are read back rather than assumed to be Trialing: the
       * project row drives the customer's trial banner and the paywall, so it
       * has to match Stripe even when Stripe disagrees with what we expected.
       */
      const spies: ExtendTrialSpies = setup();

      spies.getSubscriptionStatus
        .mockResolvedValueOnce(SubscriptionStatus.Trialing as never)
        .mockResolvedValueOnce(SubscriptionStatus.Active as never);

      await ProjectService.extendTrial({
        projectId: PROJECT_ID,
        trialEndsAt: newTrialEndDate,
      });

      expect(spies.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            trialEndsAt: newTrialEndDate,
            paymentProviderSubscriptionStatus: SubscriptionStatus.Trialing,
            paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Active,
          },
        }),
      );
    });
  });
});
