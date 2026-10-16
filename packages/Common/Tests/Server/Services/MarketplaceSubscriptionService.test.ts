import MarketplaceSubscriptionService, {
  Service,
} from "../../../Server/Services/MarketplaceSubscriptionService";
import ProjectService from "../../../Server/Services/ProjectService";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import MarketplaceClaimToken from "../../../Server/Utils/Marketplace/MarketplaceClaimToken";
import MarketplaceSubscription from "../../../Models/DatabaseModels/MarketplaceSubscription";
import OneUptimeDate from "../../../Types/Date";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "../../../Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Where a marketplace purchase stands, and what moves it. The rules that
 * matter for money:
 *
 *   - Active means "billing a project". A purchase the marketplace has
 *     activated but nobody has linked to a project yet is Pending here, so
 *     nothing is ever billed for a project that does not exist.
 *   - A purchase billing a project is never taken back to Pending by a
 *     marketplace that is behind.
 *   - A status change reaches the linked project at once.
 */

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      setMarketplaceBillingStatus: jest.fn(),
      moveBillingToMarketplace: jest.fn(),
    },
  };
});

const { Pending, Active, Suspended, Cancelled } = MarketplaceSubscriptionStatus;

const purchaseRow: (
  overrides?: Partial<MarketplaceSubscription>,
) => MarketplaceSubscription = (
  overrides?: Partial<MarketplaceSubscription>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.Azure,
    externalSubscriptionId: "37f9dea2-4345-438f-b0bd-03d40d28c7e0",
    status: Pending,
    ...overrides,
  });
};

describe("MarketplaceSubscriptionService.effectiveStatus", () => {
  const cases: Array<{
    current: MarketplaceSubscriptionStatus | undefined;
    reported: MarketplaceSubscriptionStatus | undefined;
    isLinked: boolean;
    expected: MarketplaceSubscriptionStatus | null;
  }> = [
    // Nothing reported: nothing changes.
    { current: Active, reported: undefined, isLinked: true, expected: null },
    // Active on the marketplace, but not billing any project yet.
    { current: Pending, reported: Active, isLinked: false, expected: null },
    {
      current: undefined,
      reported: Active,
      isLinked: false,
      expected: Pending,
    },
    {
      current: Suspended,
      reported: Active,
      isLinked: false,
      expected: Pending,
    },
    // Linked: Active means Active.
    { current: Pending, reported: Active, isLinked: true, expected: Active },
    { current: Suspended, reported: Active, isLinked: true, expected: Active },
    { current: Active, reported: Active, isLinked: true, expected: null },
    // A marketplace that still says "pending" never un-bills a project.
    { current: Active, reported: Pending, isLinked: true, expected: null },
    // Suspension and cancellation always land.
    {
      current: Active,
      reported: Suspended,
      isLinked: true,
      expected: Suspended,
    },
    {
      current: Active,
      reported: Cancelled,
      isLinked: true,
      expected: Cancelled,
    },
    {
      current: Pending,
      reported: Cancelled,
      isLinked: false,
      expected: Cancelled,
    },
    { current: Cancelled, reported: Cancelled, isLinked: true, expected: null },
  ];

  for (const testCase of cases) {
    it(`${testCase.current || "(new)"} + reported ${testCase.reported || "(nothing)"}${testCase.isLinked ? ", linked" : ""} -> ${testCase.expected || "unchanged"}`, () => {
      expect(
        Service.effectiveStatus({
          current: testCase.current,
          reported: testCase.reported,
          isLinked: testCase.isLinked,
        }),
      ).toBe(testCase.expected);
    });
  }
});

describe("MarketplaceSubscriptionService", () => {
  let findOneBy: jest.SpyInstance;
  let findOneById: jest.SpyInstance;
  let create: jest.SpyInstance;
  let updateOneById: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    findOneBy = getJestSpyOn(MarketplaceSubscriptionService, "findOneBy");
    findOneById = getJestSpyOn(MarketplaceSubscriptionService, "findOneById");
    create = getJestSpyOn(MarketplaceSubscriptionService, "create");
    updateOneById = getJestSpyOn(
      MarketplaceSubscriptionService,
      "updateOneById",
    ).mockResolvedValue(undefined);
  });

  describe("recordPurchase", () => {
    it("records a new purchase as Pending, whatever the marketplace says, until it is linked", async () => {
      const created: MarketplaceSubscription = purchaseRow();

      findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(created);
      create.mockResolvedValue(created);

      await expect(
        MarketplaceSubscriptionService.recordPurchase({
          marketplace: CloudMarketplace.Azure,
          externalSubscriptionId: created.externalSubscriptionId!,
          status: Active,
          externalPlanId: "pay-as-you-go",
          purchaserEmail: "buyer@contoso.com",
        }),
      ).resolves.toBe(created);

      const data: MarketplaceSubscription = (
        create.mock.calls[0]![0] as { data: MarketplaceSubscription }
      ).data;

      expect(data.status).toBe(Pending);
      expect(data.isUsageMetered).toBe(true);
      expect(data.isFreeTrial).toBe(false);
      expect(data.externalPlanId).toBe("pay-as-you-go");
      expect(data.purchaserEmail).toBe("buyer@contoso.com");
      expect(data.projectId).toBeUndefined();
    });

    it("keeps a suspension or cancellation reported before anyone linked the purchase", async () => {
      for (const status of [Suspended, Cancelled]) {
        create.mockClear();
        findOneBy
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(purchaseRow({ status }));
        create.mockResolvedValue(purchaseRow({ status }));

        await MarketplaceSubscriptionService.recordPurchase({
          marketplace: CloudMarketplace.AWS,
          externalSubscriptionId: "arn:aws:license-manager::1:license:l-1",
          status: status,
        });

        expect(
          (create.mock.calls[0]![0] as { data: MarketplaceSubscription }).data
            .status,
        ).toBe(status);
      }
    });

    it("updates the row another request created a moment earlier, instead of failing", async () => {
      const raced: MarketplaceSubscription = purchaseRow();

      findOneBy
        .mockResolvedValueOnce(null) // nothing yet...
        .mockResolvedValueOnce(raced); // ...until the other request's row lands
      create.mockRejectedValue(
        PostgresErrorTranslator.createUniqueViolationException("duplicate"),
      );
      findOneById.mockResolvedValue(raced);

      await expect(
        MarketplaceSubscriptionService.recordPurchase({
          marketplace: CloudMarketplace.Azure,
          externalSubscriptionId: raced.externalSubscriptionId!,
          externalPlanId: "pay-as-you-go",
        }),
      ).resolves.toBe(raced);

      expect(updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: raced.id,
          data: expect.objectContaining({ externalPlanId: "pay-as-you-go" }),
        }),
      );
    });

    it("passes on any other failure to create", async () => {
      findOneBy.mockResolvedValueOnce(null);
      create.mockRejectedValue(new Error("connection lost"));

      await expect(
        MarketplaceSubscriptionService.recordPurchase({
          marketplace: CloudMarketplace.Azure,
          externalSubscriptionId: "x",
        }),
      ).rejects.toThrow("connection lost");
    });
  });

  describe("updatePurchase", () => {
    it("moves a linked project's billing status with its purchase", async () => {
      const linked: MarketplaceSubscription = purchaseRow({
        status: Active,
        projectId: ObjectID.generate(),
      });
      findOneById.mockResolvedValue(linked);

      await MarketplaceSubscriptionService.updatePurchase(linked, {
        status: Suspended,
        externalState: "Suspended",
      });

      expect(updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: Suspended,
            externalState: "Suspended",
          }),
        }),
      );
      expect(ProjectService.setMarketplaceBillingStatus).toHaveBeenCalledWith({
        projectId: linked.projectId,
        status: Suspended,
      });
    });

    it("never writes Active for a purchase without a project, nor touches any project", async () => {
      const unlinked: MarketplaceSubscription = purchaseRow({
        status: Pending,
      });
      findOneById.mockResolvedValue(unlinked);

      await MarketplaceSubscriptionService.updatePurchase(unlinked, {
        status: Active,
        externalPlanId: "pay-as-you-go",
      });

      const data: Record<string, unknown> = (
        updateOneById.mock.calls[0]![0] as { data: Record<string, unknown> }
      ).data;

      expect(data).not.toHaveProperty("status");
      expect(data["externalPlanId"]).toBe("pay-as-you-go");
      expect(ProjectService.setMarketplaceBillingStatus).not.toHaveBeenCalled();
    });

    it("never blanks a fact the caller did not mention", async () => {
      const linked: MarketplaceSubscription = purchaseRow({
        status: Active,
        projectId: ObjectID.generate(),
        purchaserEmail: "buyer@contoso.com",
      });
      findOneById.mockResolvedValue(linked);

      await MarketplaceSubscriptionService.updatePurchase(linked, {
        externalEntitlementId: "agmt-2",
      });

      const data: Record<string, unknown> = (
        updateOneById.mock.calls[0]![0] as { data: Record<string, unknown> }
      ).data;

      expect(Object.keys(data).sort()).toEqual(
        ["externalEntitlementId", "lastSyncedAt"].sort(),
      );
    });
  });

  describe("claim tokens", () => {
    it("finds the purchase a valid claim token was issued for, by the token's hash", async () => {
      const token: string = MarketplaceClaimToken.generate();
      const row: MarketplaceSubscription = purchaseRow({
        claimTokenExpiresAt: OneUptimeDate.addRemoveHours(
          OneUptimeDate.getCurrentDate(),
          1,
        ),
      });
      findOneBy.mockResolvedValue(row);

      await expect(
        MarketplaceSubscriptionService.findPurchaseByClaimToken(token),
      ).resolves.toBe(row);

      expect(findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { claimTokenHash: MarketplaceClaimToken.hash(token) },
        }),
      );
    });

    it("refuses an expired token, and never looks up anything that is not a token", async () => {
      findOneBy.mockResolvedValue(
        purchaseRow({
          claimTokenExpiresAt: OneUptimeDate.addRemoveHours(
            OneUptimeDate.getCurrentDate(),
            -1,
          ),
        }),
      );

      await expect(
        MarketplaceSubscriptionService.findPurchaseByClaimToken(
          MarketplaceClaimToken.generate(),
        ),
      ).resolves.toBeNull();

      findOneBy.mockClear();

      await expect(
        MarketplaceSubscriptionService.findPurchaseByClaimToken("' OR 1=1 --"),
      ).resolves.toBeNull();
      expect(findOneBy).not.toHaveBeenCalled();
    });

    it("stores only the hash of a token it issues", async () => {
      const purchaseId: ObjectID = ObjectID.generate();

      const token: string =
        await MarketplaceSubscriptionService.issueClaimToken(purchaseId);

      const data: Record<string, unknown> = (
        updateOneById.mock.calls[0]![0] as { data: Record<string, unknown> }
      ).data;

      expect(data["claimTokenHash"]).toBe(MarketplaceClaimToken.hash(token));
      expect(JSON.stringify(data)).not.toContain(token);
    });
  });

  describe("linkToProject", () => {
    it("links the project, spends the claim token, starts the usage clock and moves the billing", async () => {
      const row: MarketplaceSubscription = purchaseRow({
        marketplace: CloudMarketplace.GoogleCloud,
      });
      const projectId: ObjectID = ObjectID.generate();
      const userId: ObjectID = ObjectID.generate();

      await MarketplaceSubscriptionService.linkToProject({
        purchase: row,
        projectId: projectId,
        userId: userId,
        status: Active,
        facts: { usageReportingId: "project_number:123" },
      });

      const data: Record<string, unknown> = (
        updateOneById.mock.calls[0]![0] as { data: Record<string, unknown> }
      ).data;

      expect(data).toMatchObject({
        projectId: projectId,
        linkedByUserId: userId,
        status: Active,
        usageReportingId: "project_number:123",
        claimTokenHash: null,
        claimTokenExpiresAt: null,
      });
      expect(data["usageReportedUntil"]).toBeInstanceOf(Date);
      expect(data["linkedAt"]).toEqual(data["usageReportedUntil"]);
      expect(
        Number((data["unreportedUsageInUSD"] as { value: unknown }).value),
      ).toBe(0);

      expect(ProjectService.moveBillingToMarketplace).toHaveBeenCalledWith({
        projectId: projectId,
        marketplace: CloudMarketplace.GoogleCloud,
        status: Active,
      });
    });
  });
});
