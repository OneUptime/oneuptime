import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import MarketplacePurchases from "../../../../Server/CloudMarketplace/MarketplacePurchases";
import AwsMarketplaceAdapter from "../../../../Server/CloudMarketplace/AWS/AwsMarketplaceAdapter";
import AwsMarketplaceAPI, {
  AwsAgreement,
} from "../../../../Server/CloudMarketplace/AWS/AwsMarketplaceAPI";
import AwsMarketplaceInbound, {
  AwsInboundError,
  AwsMarketplaceEvent,
} from "../../../../Server/CloudMarketplace/AWS/AwsMarketplaceInbound";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import MarketplaceUsageReporter from "../../../../Server/CloudMarketplace/MarketplaceUsageReporter";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * What AWS Marketplace sends: the buyer's browser with a registration token,
 * and EventBridge events forwarded by the seller's API destination with a
 * shared secret. Events move a purchase only as far as DescribeAgreement
 * confirms.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    AwsMarketplaceProductCode: "prod-oneuptime",
    AwsMarketplaceEventsSecret: "events-secret-from-the-api-destination",
  };
});

jest.mock("Common/Server/Services/MarketplaceSubscriptionService", () => {
  return {
    __esModule: true,
    default: {
      findPurchase: jest.fn(),
      findPurchaseByEntitlementId: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/CloudMarketplace/MarketplacePurchases", () => {
  return {
    __esModule: true,
    default: {
      recordPurchase: jest.fn(),
      updatePurchase: jest.fn(),
    },
  };
});

jest.mock(
  "../../../../Server/CloudMarketplace/MarketplaceUsageReporter",
  () => {
    return {
      __esModule: true,
      default: { reportFinalUsage: jest.fn() },
    };
  },
);

const LICENSE_ARN: string =
  "arn:aws:license-manager::123456789012:license:l-0123456789abcdef0123456789abcdef";
const RENEWED_LICENSE_ARN: string =
  "arn:aws:license-manager::123456789012:license:l-fedcba9876543210fedcba9876543210";

const findPurchase: jest.Mock =
  MarketplaceSubscriptionService.findPurchase as unknown as jest.Mock;
const findPurchaseByEntitlementId: jest.Mock =
  MarketplaceSubscriptionService.findPurchaseByEntitlementId as unknown as jest.Mock;
const recordPurchase: jest.Mock =
  MarketplacePurchases.recordPurchase as unknown as jest.Mock;
const updatePurchase: jest.Mock =
  MarketplacePurchases.updatePurchase as unknown as jest.Mock;
const updateOneById: jest.Mock =
  MarketplaceSubscriptionService.updateOneById as unknown as jest.Mock;
const reportFinalUsage: jest.Mock =
  MarketplaceUsageReporter.reportFinalUsage as unknown as jest.Mock;

const agreement: (overrides?: Partial<AwsAgreement>) => AwsAgreement = (
  overrides?: Partial<AwsAgreement>,
): AwsAgreement => {
  return {
    agreementId: "agmt-1",
    status: "ACTIVE",
    acceptorAccountId: "123456789012",
    offerId: "offer-1",
    startTime: null,
    endTime: null,
    ...overrides,
  };
};

const linkedPurchase: (
  overrides?: Partial<MarketplaceSubscription>,
) => MarketplaceSubscription = (
  overrides?: Partial<MarketplaceSubscription>,
): MarketplaceSubscription => {
  return Object.assign(new MarketplaceSubscription(), {
    _id: ObjectID.generate().toString(),
    marketplace: CloudMarketplace.AWS,
    externalSubscriptionId: LICENSE_ARN,
    externalCustomerId: "123456789012",
    externalEntitlementId: "agmt-1",
    status: MarketplaceSubscriptionStatus.Active,
    projectId: ObjectID.generate(),
    ...overrides,
  });
};

// An EventBridge event as the API destination forwards it.
const eventBody: (
  detailType: string,
  detail: Record<string, unknown>,
) => Record<string, unknown> = (
  detailType: string,
  detail: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    version: "0",
    id: "6f1c5d0e-0000-4000-8000-000000000000",
    "detail-type": detailType,
    source: "aws.agreement-marketplace",
    account: "999999999999",
    time: "2026-10-16T09:00:00Z",
    region: "us-east-1",
    resources: [],
    detail: detail,
  };
};

const LICENSE_DETAIL: Record<string, unknown> = {
  requestId: "req-1",
  agreement: { id: "agmt-1", intent: "NEW" },
  license: { arn: LICENSE_ARN },
  acceptor: { accountId: "123456789012" },
  proposer: { accountId: "999999999999" },
  product: { code: "prod-oneuptime" },
  offer: { id: "offer-1" },
};

const parsed: (
  detailType: string,
  detail?: Record<string, unknown>,
) => AwsMarketplaceEvent = (
  detailType: string,
  detail?: Record<string, unknown>,
): AwsMarketplaceEvent => {
  return AwsMarketplaceInbound.parseEvent(
    eventBody(detailType, detail || LICENSE_DETAIL),
  )!;
};

describe("AwsMarketplaceInbound.isEventsSecretValid", () => {
  it("accepts only the configured secret", () => {
    expect(
      AwsMarketplaceInbound.isEventsSecretValid(
        "events-secret-from-the-api-destination",
      ),
    ).toBe(true);

    for (const provided of [
      undefined,
      "",
      "events-secret-from-the-api-destinatioN",
      "short",
      "events-secret-from-the-api-destination ",
    ]) {
      expect(AwsMarketplaceInbound.isEventsSecretValid(provided)).toBe(false);
    }
  });

  it("accepts nothing while no secret is configured", () => {
    expect(AwsMarketplaceInbound.isEventsSecretValid("anything", null)).toBe(
      false,
    );
    expect(AwsMarketplaceInbound.isEventsSecretValid("", "")).toBe(false);
  });
});

describe("AwsMarketplaceInbound.parseEvent", () => {
  it("reads what OneUptime needs from an EventBridge event", () => {
    expect(
      AwsMarketplaceInbound.parseEvent(
        eventBody("License Updated - Manufacturer", LICENSE_DETAIL),
      ),
    ).toEqual({
      detailType: "License Updated - Manufacturer",
      source: "aws.agreement-marketplace",
      agreementId: "agmt-1",
      previousAgreementId: null,
      intent: "NEW",
      licenseArn: LICENSE_ARN,
      acceptorAccountId: "123456789012",
      productCode: "prod-oneuptime",
      offerId: "offer-1",
    });
  });

  it("is null for anything that is not an event", () => {
    for (const body of [null, undefined, "event", 42, [], {}, { detail: {} }]) {
      expect(AwsMarketplaceInbound.parseEvent(body)).toBeNull();
    }

    // An event with an odd detail is still an event, with nothing in it.
    expect(
      AwsMarketplaceInbound.parseEvent({
        "detail-type": "License Updated - Manufacturer",
        source: "aws.agreement-marketplace",
        detail: "not an object",
      }),
    ).toMatchObject({ licenseArn: null, agreementId: null });
  });
});

describe("AwsMarketplaceInbound", () => {
  let api: { resolveCustomer: jest.Mock; describeAgreement: jest.Mock };
  let inbound: AwsMarketplaceInbound;

  beforeEach(() => {
    jest.clearAllMocks();

    api = { resolveCustomer: jest.fn(), describeAgreement: jest.fn() };
    inbound = new AwsMarketplaceInbound({
      adapter: new AwsMarketplaceAdapter(api as unknown as AwsMarketplaceAPI),
    });

    recordPurchase.mockImplementation(
      async (data: unknown): Promise<MarketplaceSubscription> => {
        return Object.assign(new MarketplaceSubscription(), data);
      },
    );
  });

  describe("registerBuyer", () => {
    it("records the license the registration token resolves to", async () => {
      api.resolveCustomer.mockResolvedValue({
        customerAwsAccountId: "123456789012",
        licenseArn: LICENSE_ARN,
        productCode: "prod-oneuptime",
        agreementId: "agmt-1",
      });

      await inbound.registerBuyer("registration-token");

      expect(api.resolveCustomer).toHaveBeenCalledWith("registration-token");
      expect(recordPurchase).toHaveBeenCalledWith({
        marketplace: CloudMarketplace.AWS,
        externalSubscriptionId: LICENSE_ARN,
        externalCustomerId: "123456789012",
        externalEntitlementId: "agmt-1",
        externalOfferId: "prod-oneuptime",
      });
    });

    it("refuses a token for another seller's product", async () => {
      api.resolveCustomer.mockResolvedValue({
        customerAwsAccountId: "123456789012",
        licenseArn: LICENSE_ARN,
        productCode: "prod-someone-else",
        agreementId: "agmt-1",
      });

      await expect(inbound.registerBuyer("t")).rejects.toBeInstanceOf(
        AwsInboundError,
      );
      expect(recordPurchase).not.toHaveBeenCalled();
    });

    it("refuses a token that resolves to no license", async () => {
      api.resolveCustomer.mockResolvedValue({
        customerAwsAccountId: "123456789012",
        licenseArn: null,
        productCode: "prod-oneuptime",
        agreementId: null,
      });

      await expect(inbound.registerBuyer("t")).rejects.toThrow(/which license/);
      expect(recordPurchase).not.toHaveBeenCalled();
    });
  });

  describe("handleEvent", () => {
    it("ignores events from any other source", async () => {
      await inbound.handleEvent({
        ...parsed("License Updated - Manufacturer"),
        source: "aws.ec2",
      });

      expect(api.describeAgreement).not.toHaveBeenCalled();
      expect(recordPurchase).not.toHaveBeenCalled();
    });

    it("records a live license with its agreement's status", async () => {
      const existing: MarketplaceSubscription = linkedPurchase();

      api.describeAgreement.mockResolvedValue(agreement());
      findPurchase.mockResolvedValue(existing);

      await inbound.handleEvent(parsed("License Updated - Manufacturer"));

      expect(api.describeAgreement).toHaveBeenCalledWith("agmt-1");
      expect(recordPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          marketplace: CloudMarketplace.AWS,
          externalSubscriptionId: LICENSE_ARN,
          externalEntitlementId: "agmt-1",
          externalCustomerId: "123456789012",
          externalOfferId: "offer-1",
          externalState: "ACTIVE",
          status: MarketplaceSubscriptionStatus.Active,
        }),
      );
      expect(updateOneById).not.toHaveBeenCalled();
    });

    it("records a license whose agreement AWS cannot describe without a status", async () => {
      api.describeAgreement.mockResolvedValue(null);
      findPurchase.mockResolvedValue(null);
      findPurchaseByEntitlementId.mockResolvedValue(null);

      await inbound.handleEvent(parsed("License Updated - Manufacturer"));

      const recorded: Record<string, unknown> = recordPurchase.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(recorded["status"]).toBeUndefined();
      expect(recorded).not.toHaveProperty("externalState");
    });

    it("ignores a license for another product, or without a license or agreement", async () => {
      await inbound.handleEvent(
        parsed("License Updated - Manufacturer", {
          ...LICENSE_DETAIL,
          product: { code: "prod-someone-else" },
        }),
      );
      await inbound.handleEvent(
        parsed("License Updated - Manufacturer", {
          ...LICENSE_DETAIL,
          license: {},
        }),
      );
      await inbound.handleEvent(
        parsed("License Updated - Manufacturer", {
          ...LICENSE_DETAIL,
          agreement: {},
        }),
      );

      expect(api.describeAgreement).not.toHaveBeenCalled();
      expect(recordPurchase).not.toHaveBeenCalled();
    });

    it("follows a renewal: the purchase moves to the new agreement, then to its new license", async () => {
      const renewing: MarketplaceSubscription = linkedPurchase();

      // Purchase Agreement Created, continuing agmt-1 as agmt-2.
      findPurchaseByEntitlementId.mockResolvedValueOnce(renewing);
      await inbound.handleEvent(
        parsed("Purchase Agreement Created - Proposer", {
          agreement: {
            id: "agmt-2",
            previousAgreementId: "agmt-1",
            intent: "RENEW",
          },
        }),
      );

      expect(findPurchaseByEntitlementId).toHaveBeenCalledWith({
        marketplace: CloudMarketplace.AWS,
        externalEntitlementId: "agmt-1",
      });
      expect(updatePurchase).toHaveBeenCalledWith(renewing, {
        externalEntitlementId: "agmt-2",
      });

      // License Updated for the new license, under agmt-2.
      api.describeAgreement.mockResolvedValue(
        agreement({ agreementId: "agmt-2" }),
      );
      findPurchase.mockResolvedValueOnce(null);
      findPurchaseByEntitlementId.mockResolvedValueOnce(renewing);

      await inbound.handleEvent(
        parsed("License Updated - Manufacturer", {
          ...LICENSE_DETAIL,
          agreement: { id: "agmt-2" },
          license: { arn: RENEWED_LICENSE_ARN },
        }),
      );

      expect(updateOneById).toHaveBeenCalledWith({
        id: renewing.id,
        data: { externalSubscriptionId: RENEWED_LICENSE_ARN },
        props: { isRoot: true },
      });
      expect(recordPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          externalSubscriptionId: RENEWED_LICENSE_ARN,
          externalEntitlementId: "agmt-2",
          status: MarketplaceSubscriptionStatus.Active,
        }),
      );
    });

    it("needs nothing for a new agreement that continues no other", async () => {
      await inbound.handleEvent(
        parsed("Purchase Agreement Created - Proposer", {
          agreement: { id: "agmt-9", intent: "NEW" },
        }),
      );

      expect(findPurchaseByEntitlementId).not.toHaveBeenCalled();
      expect(updatePurchase).not.toHaveBeenCalled();
    });

    it("ends a deprovisioned license once AWS confirms the agreement ended, billing final usage first", async () => {
      const existing: MarketplaceSubscription = linkedPurchase();

      findPurchase.mockResolvedValue(existing);
      api.describeAgreement.mockResolvedValue(
        agreement({ status: "CANCELLED" }),
      );

      await inbound.handleEvent(parsed("License Deprovisioned - Manufacturer"));

      expect(findPurchase).toHaveBeenCalledWith({
        marketplace: CloudMarketplace.AWS,
        externalSubscriptionId: LICENSE_ARN,
      });
      expect(reportFinalUsage).toHaveBeenCalledWith(existing);
      expect(updatePurchase).toHaveBeenCalledWith(existing, {
        status: MarketplaceSubscriptionStatus.Cancelled,
        externalState: "License Deprovisioned - Manufacturer",
      });
      expect(reportFinalUsage.mock.invocationCallOrder[0]!).toBeLessThan(
        updatePurchase.mock.invocationCallOrder[0]!,
      );
    });

    it("changes nothing when the agreement is still active", async () => {
      findPurchaseByEntitlementId.mockResolvedValue(linkedPurchase());
      api.describeAgreement.mockResolvedValue(agreement({ status: "ACTIVE" }));

      await inbound.handleEvent(
        parsed("Purchase Agreement Ended - Proposer", {
          agreement: { id: "agmt-1" },
        }),
      );

      expect(reportFinalUsage).not.toHaveBeenCalled();
      expect(updatePurchase).not.toHaveBeenCalled();
    });

    it("ends the purchase when AWS no longer has the agreement at all", async () => {
      const existing: MarketplaceSubscription = linkedPurchase();

      findPurchaseByEntitlementId.mockResolvedValue(existing);
      api.describeAgreement.mockResolvedValue(null);

      await inbound.handleEvent(
        parsed("Purchase Agreement Ended - Proposer", {
          agreement: { id: "agmt-1" },
        }),
      );

      expect(updatePurchase).toHaveBeenCalledWith(
        existing,
        expect.objectContaining({
          status: MarketplaceSubscriptionStatus.Cancelled,
        }),
      );
    });

    it("leaves alone a purchase it does not know, or one already cancelled", async () => {
      findPurchase.mockResolvedValueOnce(null);
      await inbound.handleEvent(parsed("License Deprovisioned - Manufacturer"));

      findPurchase.mockResolvedValueOnce(
        linkedPurchase({ status: MarketplaceSubscriptionStatus.Cancelled }),
      );
      await inbound.handleEvent(parsed("License Deprovisioned - Manufacturer"));

      expect(api.describeAgreement).not.toHaveBeenCalled();
      expect(updatePurchase).not.toHaveBeenCalled();
    });

    it("only logs an advisory: a person decides", async () => {
      await inbound.handleEvent(
        parsed("Purchase Agreement Advisory - Proposer", {
          agreement: { id: "agmt-1" },
          acceptor: { accountId: "123456789012" },
        }),
      );

      expect(api.describeAgreement).not.toHaveBeenCalled();
      expect(findPurchase).not.toHaveBeenCalled();
      expect(recordPurchase).not.toHaveBeenCalled();
      expect(updatePurchase).not.toHaveBeenCalled();
    });

    it("throws when AWS cannot be asked about the agreement, so EventBridge delivers again", async () => {
      api.describeAgreement.mockRejectedValue(
        new MarketplaceApiError({
          message: "ThrottlingException",
          status: 400,
          isRetryable: true,
        }),
      );

      await expect(
        inbound.handleEvent(parsed("License Updated - Manufacturer")),
      ).rejects.toBeInstanceOf(MarketplaceApiError);
      expect(recordPurchase).not.toHaveBeenCalled();
    });
  });
});
