import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { ProjectBillingState } from "Common/Server/Enterprise/EnterpriseServerModule";
import logger from "Common/Server/Utils/Logger";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import ObjectID from "Common/Types/ObjectID";
import { getJestSpyOn } from "Common/Tests/Spy";
import MarketplacePurchases from "../../../Server/CloudMarketplace/MarketplacePurchases";
import MarketplaceUsageReporter from "../../../Server/CloudMarketplace/MarketplaceUsageReporter";
import CloudMarketplaceProjectBillingHooks from "../../../Server/CloudMarketplace/ProjectBillingHooks";
import VercelMarketplaceResources from "../../../Server/CloudMarketplace/Vercel/VercelMarketplaceResources";

/*
 * What the cloud marketplaces and Vercel Marketplace do when core's
 * ProjectService deletes projects or moves a marketplace-billed one to
 * another plan. Each hook does its steps in order, and a step that fails is
 * logged and never stops the next one or fails the change.
 * ProjectMarketplaceDelete.test.ts runs them from ProjectService.
 */

const AZURE_PROJECT: ProjectBillingState = {
  projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
  billingMarketplace: CloudMarketplace.Azure,
};
const VERCEL_PROJECT: ProjectBillingState = {
  projectId: new ObjectID("66666666-6666-4666-8666-666666666666"),
  billingMarketplace: CloudMarketplace.Vercel,
};
const CARD_PROJECT: ProjectBillingState = {
  projectId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  billingMarketplace: null,
};

const idsOf: (spy: jest.SpyInstance) => Array<string> = (
  spy: jest.SpyInstance,
): Array<string> => {
  return spy.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
};

let reportFinalUsageOfProject: jest.SpyInstance;
let unlinkProject: jest.SpyInstance;
let onProjectDeleted: jest.SpyInstance;
let onPlanChanged: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  reportFinalUsageOfProject = getJestSpyOn(
    MarketplaceUsageReporter,
    "reportFinalUsageOfProject",
  ).mockResolvedValue(undefined as never);
  unlinkProject = getJestSpyOn(
    MarketplacePurchases,
    "unlinkProject",
  ).mockResolvedValue(undefined as never);
  onProjectDeleted = getJestSpyOn(
    VercelMarketplaceResources,
    "onProjectDeleted",
  ).mockResolvedValue(undefined as never);
  onPlanChanged = getJestSpyOn(
    VercelMarketplaceResources,
    "onPlanChanged",
  ).mockResolvedValue(undefined as never);
  errorSpy = getJestSpyOn(logger, "error").mockImplementation(
    (() => {}) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("beforeProjectsDelete", () => {
  it("bills the last usage of every project a marketplace bills, and of no other", async () => {
    await CloudMarketplaceProjectBillingHooks.beforeProjectsDelete([
      AZURE_PROJECT,
      CARD_PROJECT,
      VERCEL_PROJECT,
    ]);

    expect(idsOf(reportFinalUsageOfProject)).toEqual([
      AZURE_PROJECT.projectId.toString(),
      VERCEL_PROJECT.projectId.toString(),
    ]);
    expect(unlinkProject).not.toHaveBeenCalled();
    expect(onProjectDeleted).not.toHaveBeenCalled();
  });

  it("a report that fails is logged, and the next project is still billed", async () => {
    const failure: Error = new Error("the marketplace is down");
    reportFinalUsageOfProject.mockRejectedValueOnce(failure as never);

    await expect(
      CloudMarketplaceProjectBillingHooks.beforeProjectsDelete([
        AZURE_PROJECT,
        VERCEL_PROJECT,
      ]),
    ).resolves.toBeUndefined();

    expect(idsOf(reportFinalUsageOfProject)).toEqual([
      AZURE_PROJECT.projectId.toString(),
      VERCEL_PROJECT.projectId.toString(),
    ]);
    expect(errorSpy).toHaveBeenCalledWith(failure);
  });
});

describe("afterProjectsDelete", () => {
  it("deletes each Vercel resource with its project, then unlinks every deleted project's purchase", async () => {
    await CloudMarketplaceProjectBillingHooks.afterProjectsDelete([
      AZURE_PROJECT,
      VERCEL_PROJECT,
      CARD_PROJECT,
    ]);

    expect(idsOf(onProjectDeleted)).toEqual([
      VERCEL_PROJECT.projectId.toString(),
    ]);
    expect(idsOf(unlinkProject)).toEqual([
      AZURE_PROJECT.projectId.toString(),
      VERCEL_PROJECT.projectId.toString(),
      CARD_PROJECT.projectId.toString(),
    ]);
    expect(onProjectDeleted.mock.invocationCallOrder[0]!).toBeLessThan(
      unlinkProject.mock.invocationCallOrder[0]!,
    );
  });

  it("tells Vercel nothing when no deleted project was a Vercel resource", async () => {
    await CloudMarketplaceProjectBillingHooks.afterProjectsDelete([
      AZURE_PROJECT,
      CARD_PROJECT,
    ]);

    expect(onProjectDeleted).not.toHaveBeenCalled();
    expect(unlinkProject).toHaveBeenCalledTimes(2);
  });

  it("a failing step is logged, and every other step still runs", async () => {
    const vercelFailure: Error = new Error("Vercel is down");
    const unlinkFailure: Error = new Error("the database is gone");
    onProjectDeleted.mockRejectedValue(vercelFailure as never);
    unlinkProject.mockRejectedValueOnce(unlinkFailure as never);

    await expect(
      CloudMarketplaceProjectBillingHooks.afterProjectsDelete([
        VERCEL_PROJECT,
        AZURE_PROJECT,
      ]),
    ).resolves.toBeUndefined();

    expect(idsOf(unlinkProject)).toEqual([
      VERCEL_PROJECT.projectId.toString(),
      AZURE_PROJECT.projectId.toString(),
    ]);
    expect(errorSpy).toHaveBeenCalledWith(vercelFailure);
    expect(errorSpy).toHaveBeenCalledWith(unlinkFailure);
  });
});

describe("afterMarketplacePlanChange", () => {
  it("moves a Vercel resource's billing plan with its project", async () => {
    await CloudMarketplaceProjectBillingHooks.afterMarketplacePlanChange({
      projectId: VERCEL_PROJECT.projectId,
      billingMarketplace: CloudMarketplace.Vercel,
      paymentProviderPlanId: "growth_monthly",
    });

    expect(onPlanChanged).toHaveBeenCalledWith({
      projectId: VERCEL_PROJECT.projectId,
      paymentProviderPlanId: "growth_monthly",
    });
  });

  it.each([
    CloudMarketplace.AWS,
    CloudMarketplace.Azure,
    CloudMarketplace.GoogleCloud,
  ])(
    "tells %s nothing: its next hourly usage report bills the new plan",
    async (billingMarketplace: CloudMarketplace) => {
      await CloudMarketplaceProjectBillingHooks.afterMarketplacePlanChange({
        projectId: AZURE_PROJECT.projectId,
        billingMarketplace: billingMarketplace,
        paymentProviderPlanId: "growth_monthly",
      });

      expect(onPlanChanged).not.toHaveBeenCalled();
    },
  );

  it("a Vercel that cannot be told is logged, and the plan change stands", async () => {
    const failure: Error = new Error("Vercel is down");
    onPlanChanged.mockRejectedValue(failure as never);

    await expect(
      CloudMarketplaceProjectBillingHooks.afterMarketplacePlanChange({
        projectId: VERCEL_PROJECT.projectId,
        billingMarketplace: CloudMarketplace.Vercel,
        paymentProviderPlanId: "growth_monthly",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(failure);
  });
});
