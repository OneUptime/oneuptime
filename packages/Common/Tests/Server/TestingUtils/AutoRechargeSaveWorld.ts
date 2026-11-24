import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import BillingService from "../../../Server/Services/BillingService";
import MarketplaceChargeService from "../../../Server/Services/MarketplaceChargeService";
import ProjectService from "../../../Server/Services/ProjectService";
import MarketplaceCharge from "../../../Models/DatabaseModels/MarketplaceCharge";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "./InMemoryRepository";
import {
  SlackWebhookMessages,
  captureSlackWebhookMessages,
} from "./SlackWebhookMessages";

/*
 * SOMEBODY SAVING AUTO RECHARGE, WITH THE REAL SAVE PATH RUNNING.
 *
 * Saving Auto Recharge on while a balance is below its threshold charges
 * the card at once, and a charge that fails refuses the save
 * (ProjectService.chargeAutoRechargeTurnedOn). Here all of it runs:
 * ProjectService.updateOneById - its permission checks and hooks - into the
 * real recharge services (NotificationService for the SMS and call balance,
 * AIBillingService for the AI credits). Auto Recharge's own try, when a
 * message or an AI call finds the balance low, runs on the same project
 * after it, so a test can tell the two apart. Behind fakes:
 *
 *   - the projects, held in memory (InMemoryRepository), with the
 *     one-statement credits of both balances added on the row;
 *   - the payment provider: whether the project has a payment method, and
 *     every charge it was asked for and made;
 *   - a cloud marketplace's top-ups (MarketplaceChargeService), kept rather
 *     than written, or refused as an inactive subscription refuses them;
 *   - the shared cache - Auto Recharge's hour of waiting after its own
 *     failure, the owners' notice window of the day - and the recharge lock;
 *   - the owners' emails, the operator's Slack channel and the audit log.
 *
 * Installed with jest.spyOn, so jest.restoreAllMocks() in a test's
 * afterEach takes it away again.
 */

export interface AutoRechargeSaveOwnerEmail {
  projectId: string;
  subject: string;
  body: string;
}

// A top-up recorded for a cloud marketplace to bill with its next report.
export interface MarketplaceTopUp {
  balanceType: ProjectBalanceType;
  amountInUSD: number;
  isAutomatic: boolean;
}

export interface AutoRechargeSaveWorld {
  projects: InMemoryTable;
  // The project's row as it is now.
  row: () => StoredRow;
  // Every charge the payment provider was asked for, made or not, in USD.
  chargesAsked: Array<number>;
  // Every charge it made, in USD.
  charges: Array<number>;
  // Every top-up recorded for a cloud marketplace to bill.
  marketplaceTopUps: Array<MarketplaceTopUp>;
  // Every email to a project's owners, in order.
  ownerEmails: Array<AutoRechargeSaveOwnerEmail>;
  // What the shared cache holds, by namespace-key.
  cache: Map<string, string>;
  // What was posted to the operator's Slack channel, caught rather than sent.
  slack: SlackWebhookMessages;
  // The next charges fail with this error (until set back to null).
  failChargesWith: (error: Error | null) => void;
  // hasPaymentMethods answers this.
  setHasPaymentMethods: (value: boolean) => void;
  // The next marketplace top-ups are refused with this (until set back to null).
  refuseMarketplaceTopUpsWith: (error: Error | null) => void;
  // Whether Auto Recharge of `balance` waits before it tries the card again.
  isAutoRechargeWaiting: (balance: ProjectBalanceType) => boolean;
  // The owners' notice windows of the day that were claimed.
  noticeWindowsClaimed: () => Array<string>;
}

// The shared cache's names for what the recharge services keep there.
const AUTO_RECHARGE_WAIT_NAMESPACES: Readonly<
  Record<ProjectBalanceType, string>
> = {
  [ProjectBalanceType.SmsOrCall]: "sms-or-call-auto-recharge-failed",
  [ProjectBalanceType.AI]: "ai-auto-recharge-failed",
};

const NOTICE_WINDOW_NAMESPACE: string = "billing-failure-notice";

// What the services read beside the columns a test gives.
const DEFAULT_ROW: StoredRow = {
  name: "Acme Production",
  paymentProviderCustomerId: "cus_auto_recharge_save_world",
  sendInvoicesByEmail: false,
  smsOrCallCurrentBalanceInUSDCents: 0,
  enableAutoRechargeSmsOrCallBalance: false,
  autoRechargeSmsOrCallByBalanceInUSD: 20,
  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
  lowCallAndSMSBalanceNotificationSentToOwners: false,
  failedCallAndSMSBalanceChargeNotificationSentToOwners: false,
  notEnabledSmsOrCallNotificationSentToOwners: false,
  aiCurrentBalanceInUSDCents: 0,
  enableAutoRechargeAiBalance: false,
  autoAiRechargeByBalanceInUSD: 20,
  autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
  lowAiBalanceNotificationSentToOwners: false,
  failedAiBalanceChargeNotificationSentToOwners: false,
  notEnabledAiNotificationSentToOwners: false,
};

export function useAutoRechargeSaveWorld(
  projectId: ObjectID,
  values: StoredRow = {},
): AutoRechargeSaveWorld {
  const projects: InMemoryTable = useInMemoryTable(ProjectService, [
    { ...DEFAULT_ROW, ...values, _id: projectId.toString() },
  ]);

  const row: () => StoredRow = (): StoredRow => {
    return projects.get(projectId)!;
  };

  const rowOf: (id: ObjectID) => StoredRow = (id: ObjectID): StoredRow => {
    const found: StoredRow | undefined = projects.get(id);

    if (!found) {
      throw new Error(`No project ${id.toString()} in the world.`);
    }

    return found;
  };

  const chargesAsked: Array<number> = [];
  const charges: Array<number> = [];
  const marketplaceTopUps: Array<MarketplaceTopUp> = [];
  const ownerEmails: Array<AutoRechargeSaveOwnerEmail> = [];
  const cache: Map<string, string> = new Map<string, string>();

  let chargeError: Error | null = null;
  let marketplaceRefusal: Error | null = null;
  let hasPaymentMethods: boolean = true;

  // The SMS and call balance's credit: one statement, on the row as it is now.
  jest
    .spyOn(ProjectService, "creditSmsOrCallBalanceInUSDCents")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      amountInUSDCents: number;
    }): Promise<number> => {
      const project: StoredRow = rowOf(data.projectId);

      project["smsOrCallCurrentBalanceInUSDCents"] =
        Number(project["smsOrCallCurrentBalanceInUSDCents"] || 0) +
        data.amountInUSDCents;
      project["lowCallAndSMSBalanceNotificationSentToOwners"] = false;
      project["failedCallAndSMSBalanceChargeNotificationSentToOwners"] = false;
      project["notEnabledSmsOrCallNotificationSentToOwners"] = false;

      return Number(project["smsOrCallCurrentBalanceInUSDCents"]);
    }) as never);

  // The AI credits' credit: one statement, on the row as it is now.
  jest
    .spyOn(ProjectService, "atomicAddToColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      add: Record<string, number>;
      set?: Record<string, unknown> | undefined;
    }): Promise<void> => {
      const project: StoredRow = rowOf(data.id);

      for (const [column, amount] of Object.entries(data.add)) {
        project[column] = Number(project[column] || 0) + amount;
      }

      Object.assign(project, data.set || {});
    }) as never);

  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockImplementation((async (
      id: ObjectID,
      subject: string,
      body: string,
    ): Promise<void> => {
      ownerEmails.push({ projectId: id.toString(), subject, body });
    }) as never);

  jest
    .spyOn(BillingService, "hasPaymentMethods")
    .mockImplementation((async (): Promise<boolean> => {
      return hasPaymentMethods;
    }) as never);

  jest
    .spyOn(BillingService, "generateInvoiceAndChargeCustomer")
    .mockImplementation((async (
      _customerId: string,
      _itemText: string,
      amountInUSD: number,
    ): Promise<void> => {
      chargesAsked.push(amountInUSD);

      if (chargeError) {
        throw chargeError;
      }

      charges.push(amountInUSD);
    }) as never);

  jest
    .spyOn(MarketplaceChargeService, "recordBalanceRecharge")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      balanceType: ProjectBalanceType;
      amountInUSD: number;
      isAutomatic: boolean;
    }): Promise<MarketplaceCharge> => {
      if (marketplaceRefusal) {
        throw marketplaceRefusal;
      }

      marketplaceTopUps.push({
        balanceType: data.balanceType,
        amountInUSD: data.amountInUSD,
        isAutomatic: data.isAutomatic,
      });

      return new MarketplaceCharge();
    }) as never);

  // Who changed the project, as the audit log would keep it: not under test.
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);

  // The shared cache, connected, holding what the services keep there.
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);

  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    namespace: string,
    key: string,
  ): Promise<string | null> => {
    return cache.get(`${namespace}-${key}`) || null;
  }) as never);

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ): Promise<void> => {
    cache.set(`${namespace}-${key}`, value);
  }) as never);

  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ): Promise<void> => {
    cache.delete(`${namespace}-${key}`);
  }) as never);

  jest.spyOn(GlobalCache, "setStringIfNotExists").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ): Promise<boolean> => {
    const name: string = `${namespace}-${key}`;

    if (cache.has(name)) {
      return false;
    }

    cache.set(name, value);
    return true;
  }) as never);

  // The recharge lock, taken and given back; one caller at a time here.
  jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }): Promise<SemaphoreMutex> => {
    return {
      name: `${data.namespace}-${data.key}`,
    } as unknown as SemaphoreMutex;
  }) as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

  const slack: SlackWebhookMessages = captureSlackWebhookMessages();

  return {
    projects,
    row,
    chargesAsked,
    charges,
    marketplaceTopUps,
    ownerEmails,
    cache,
    slack,
    failChargesWith: (error: Error | null): void => {
      chargeError = error;
    },
    setHasPaymentMethods: (value: boolean): void => {
      hasPaymentMethods = value;
    },
    refuseMarketplaceTopUpsWith: (error: Error | null): void => {
      marketplaceRefusal = error;
    },
    isAutoRechargeWaiting: (balance: ProjectBalanceType): boolean => {
      return cache.has(
        `${AUTO_RECHARGE_WAIT_NAMESPACES[balance]}-${projectId.toString()}`,
      );
    },
    noticeWindowsClaimed: (): Array<string> => {
      return Array.from(cache.keys()).filter((name: string): boolean => {
        return name.startsWith(`${NOTICE_WINDOW_NAMESPACE}-`);
      });
    },
  };
}
