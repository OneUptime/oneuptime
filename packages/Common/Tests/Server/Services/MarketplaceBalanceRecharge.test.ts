import AIBillingService from "../../../Server/Services/AIBillingService";
import BillingService from "../../../Server/Services/BillingService";
import MarketplaceChargeService from "../../../Server/Services/MarketplaceChargeService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import MarketplaceCharge from "../../../Models/DatabaseModels/MarketplaceCharge";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import BadDataException from "../../../Types/Exception/BadDataException";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A project a cloud marketplace bills has no card. Its SMS and call balance
 * and its AI credits are still topped up - by hand or by Auto Recharge - and
 * the top-up is billed through the marketplace with the next hourly usage
 * report (MarketplaceChargeService) instead of being charged to a card. When
 * the marketplace subscription is not active, nothing is credited and the
 * owners are told to put the subscription right - not to add a card.
 *
 * Card projects are untouched: the same suite pins that they still charge
 * the card.
 */

jest.mock("../../../Server/BillingConfig", () => {
  return {
    __esModule: true,
    default: {
      IsBillingEnabled: true,
      BillingPublicKey: "pk_test_marketplace_recharge",
      BillingPrivateKey: "sk_test_marketplace_recharge",
      BillingWebhookSecret: "whsec_test_marketplace_recharge",
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_NAME: string = "Acme Production";
const INACTIVE_MESSAGE: string =
  "This project is billed through AWS Marketplace, and its subscription there is not active. Resolve it on AWS Marketplace, then try again.";

interface SlackRefillNotifier {
  sendBalanceRefillSlackNotification: () => Promise<void>;
}

const marketplaceProject: () => Project = (): Project => {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.name = PROJECT_NAME;
  project.billingMarketplace = CloudMarketplace.AWS;
  project.sendInvoicesByEmail = false;
  project.smsOrCallCurrentBalanceInUSDCents = 100;
  project.aiCurrentBalanceInUSDCents = 100;
  // Auto Recharge set up: add 20 USD when the balance is below 10.
  project.enableAutoRechargeSmsOrCallBalance = true;
  project.autoRechargeSmsOrCallByBalanceInUSD = 20;
  project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD = 10;
  return project;
};

let findOneByIdSpy: jest.SpyInstance;
let updateOneByIdSpy: jest.SpyInstance;
let sendEmailSpy: jest.SpyInstance;
let hasPaymentMethodsSpy: jest.SpyInstance;
let generateInvoiceSpy: jest.SpyInstance;
let recordChargeSpy: jest.SpyInstance;
let smsCreditSpy: jest.SpyInstance;
let atomicAddSpy: jest.SpyInstance;
let rememberFailureSpy: jest.SpyInstance;

beforeEach(() => {
  findOneByIdSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project> => {
      return marketplaceProject();
    });
  updateOneByIdSpy = jest
    .spyOn(ProjectService, "updateOneById")
    .mockResolvedValue(1);
  sendEmailSpy = jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined);
  hasPaymentMethodsSpy = jest
    .spyOn(BillingService, "hasPaymentMethods")
    .mockResolvedValue(true);
  generateInvoiceSpy = jest
    .spyOn(BillingService, "generateInvoiceAndChargeCustomer")
    .mockResolvedValue(undefined);
  recordChargeSpy = jest
    .spyOn(MarketplaceChargeService, "recordBalanceRecharge")
    .mockResolvedValue(new MarketplaceCharge());
  smsCreditSpy = jest
    .spyOn(ProjectService, "creditSmsOrCallBalanceInUSDCents")
    .mockResolvedValue(5100);
  atomicAddSpy = jest
    .spyOn(ProjectService, "atomicAddToColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);

  jest
    .spyOn(
      NotificationService as unknown as SlackRefillNotifier,
      "sendBalanceRefillSlackNotification",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(
      AIBillingService as unknown as SlackRefillNotifier,
      "sendBalanceRefillSlackNotification",
    )
    .mockResolvedValue(undefined);

  // This call owns today's notice window.
  jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
  jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);
  rememberFailureSpy = jest
    .spyOn(GlobalCache, "setString")
    .mockResolvedValue(undefined);
  // Auto Recharge charges only holding the recharge lock, in the shared cache.
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({} as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a marketplace-billed project's SMS and call balance", () => {
  test("a recharge is billed through the marketplace, never the card, and credited", async () => {
    const balance: number = await NotificationService.rechargeBalance(
      PROJECT_ID,
      50,
    );

    expect(recordChargeSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      balanceType: ProjectBalanceType.SmsOrCall,
      amountInUSD: 50,
      isAutomatic: false,
    });
    expect(hasPaymentMethodsSpy).not.toHaveBeenCalled();
    expect(generateInvoiceSpy).not.toHaveBeenCalled();

    expect(smsCreditSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      amountInUSDCents: 5000,
    });
    expect(balance).toBe(5100);

    // The confirmation says where it is billed.
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0]![2]).toContain(
      "It is billed through AWS Marketplace.",
    );
  });

  test("Auto Recharge records an automatic charge", async () => {
    smsCreditSpy.mockResolvedValue(2100);

    await NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);

    expect(recordChargeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        balanceType: ProjectBalanceType.SmsOrCall,
        amountInUSD: 20,
        isAutomatic: true,
      }),
    );
    expect(generateInvoiceSpy).not.toHaveBeenCalled();
    // Nobody pressed anything: no confirmation email.
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test("an inactive subscription credits nothing, and the owners are told to fix it there - once", async () => {
    recordChargeSpy.mockRejectedValue(new BadDataException(INACTIVE_MESSAGE));

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 50),
    ).rejects.toThrow(INACTIVE_MESSAGE);

    expect(smsCreditSpy).not.toHaveBeenCalled();

    // One email, about the subscription - not the card-path email as well.
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0]![1]).toBe(
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - " +
        PROJECT_NAME,
    );
    expect(sendEmailSpy.mock.calls[0]![2]).toContain(INACTIVE_MESSAGE);
    expect(sendEmailSpy.mock.calls[0]![2]).not.toContain("payment method");

    expect(updateOneByIdSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failedCallAndSMSBalanceChargeNotificationSentToOwners: true },
      }),
    );
  });

  test("Auto Recharge waits after a refusal, as after a declined card", async () => {
    recordChargeSpy.mockRejectedValue(new BadDataException(INACTIVE_MESSAGE));

    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow(INACTIVE_MESSAGE);

    // The failure is remembered for the hour Auto Recharge waits.
    expect(rememberFailureSpy).toHaveBeenCalled();
  });

  test("an unexpected failure is not quoted to the owners", async () => {
    recordChargeSpy.mockRejectedValue(
      new Error('relation "MarketplaceCharge" does not exist'),
    );

    await expect(
      NotificationService.rechargeBalance(PROJECT_ID, 50),
    ).rejects.toThrow();

    expect(sendEmailSpy.mock.calls[0]![2]).toContain("Please try again later.");
    expect(sendEmailSpy.mock.calls[0]![2]).not.toContain("relation");
  });
});

describe("a marketplace-billed project's AI credits", () => {
  test("a recharge is billed through the marketplace, never the card, and credited", async () => {
    await AIBillingService.rechargeBalance(PROJECT_ID, 30);

    expect(recordChargeSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      balanceType: ProjectBalanceType.AI,
      amountInUSD: 30,
      isAutomatic: false,
    });
    expect(hasPaymentMethodsSpy).not.toHaveBeenCalled();
    expect(generateInvoiceSpy).not.toHaveBeenCalled();
    expect(atomicAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        add: { aiCurrentBalanceInUSDCents: 3000 },
      }),
    );
    expect(sendEmailSpy.mock.calls[0]![2]).toContain(
      "It is billed through AWS Marketplace.",
    );
  });

  test("an inactive subscription credits nothing, and the owners are told to fix it there", async () => {
    recordChargeSpy.mockRejectedValue(new BadDataException(INACTIVE_MESSAGE));

    await expect(
      AIBillingService.rechargeBalance(PROJECT_ID, 30),
    ).rejects.toThrow(INACTIVE_MESSAGE);

    expect(atomicAddSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0]![1]).toBe(
      "ACTION REQUIRED: AI Balance Recharge Failed for project - " +
        PROJECT_NAME,
    );
    expect(sendEmailSpy.mock.calls[0]![2]).toContain(INACTIVE_MESSAGE);
    expect(updateOneByIdSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failedAiBalanceChargeNotificationSentToOwners: true },
      }),
    );
  });
});

describe("a card-billed project", () => {
  test("still charges the card, and records no marketplace charge", async () => {
    findOneByIdSpy.mockImplementation(async (): Promise<Project> => {
      const project: Project = marketplaceProject();
      Object.assign(project, { billingMarketplace: undefined });
      project.paymentProviderCustomerId = "cus_test_card";
      return project;
    });

    await NotificationService.rechargeBalance(PROJECT_ID, 50);
    await AIBillingService.rechargeBalance(PROJECT_ID, 30);

    expect(hasPaymentMethodsSpy).toHaveBeenCalledTimes(2);
    expect(generateInvoiceSpy).toHaveBeenCalledTimes(2);
    expect(recordChargeSpy).not.toHaveBeenCalled();
    expect(sendEmailSpy.mock.calls[0]![2]).not.toContain("billed through");
  });
});
