import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";

/*
 * A project's balance for SMS, calls, WhatsApp and Telegram, with everything
 * that touches it behind fakes, so a test can drive the real
 * NotificationService paths: the project row (reads, plain updates, the
 * one-statement credit and deduction, the owners' notice claim), the payment
 * provider (a charge takes a moment, so concurrent callers really overlap),
 * the shared cache (the auto-recharge failure window, the billing failure
 * notice window) and the distributed lock (a real mutual exclusion, in
 * process).
 *
 * The row is one plain object; every write lands on it, so what a test
 * reads back is what every writer did, in order. The credit and the
 * deduction add to the row as it is when they run - what the one statement
 * does in Postgres - so a test can tell them from a write-back of a value
 * read earlier.
 */

export interface MessagingBalanceRow {
  _id: string;
  name: string;
  paymentProviderCustomerId: string;
  smsOrCallCurrentBalanceInUSDCents: number;
  enableAutoRechargeSmsOrCallBalance: boolean;
  autoRechargeSmsOrCallByBalanceInUSD: number;
  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: number;
  lowCallAndSMSBalanceNotificationSentToOwners: boolean;
  failedCallAndSMSBalanceChargeNotificationSentToOwners: boolean;
  notEnabledSmsOrCallNotificationSentToOwners: boolean;
  sendInvoicesByEmail: boolean;
  [column: string]: unknown;
}

export interface MessagingBalanceOwnerEmail {
  projectId: string;
  subject: string;
  body: string;
}

export interface MessagingBalanceWorld {
  row: MessagingBalanceRow;
  // Every charge the payment provider was asked to make, in USD.
  charges: Array<number>;
  // Every email to the project's owners, in order.
  ownerEmails: Array<MessagingBalanceOwnerEmail>;
  // What the shared cache holds, by namespace-key.
  cache: Map<string, string>;
  // How many callers held the recharge lock at the same moment, at most.
  mostLockHoldersAtOnce: () => number;
  // How many times a lock was taken.
  locksTaken: () => number;
  // The next charges fail with this error (until set back to null).
  failChargesWith: (error: Error | null) => void;
  // hasPaymentMethods answers this.
  setHasPaymentMethods: (value: boolean) => void;
  // The lock cannot be taken although the cache is connected.
  failLocksWith: (error: Error | null) => void;
  // The shared cache is connected (true unless a test says otherwise).
  setCacheConnected: (value: boolean) => void;
  // How long a charge takes, in ms.
  setChargeDelayInMs: (ms: number) => void;
  // Called while a charge is with the payment provider.
  duringCharge: (callback: (() => void) | null) => void;
}

const DEFAULT_ROW: Omit<MessagingBalanceRow, "_id"> = {
  name: "Acme Production",
  paymentProviderCustomerId: "cus_messaging_balance_world",
  smsOrCallCurrentBalanceInUSDCents: 0,
  enableAutoRechargeSmsOrCallBalance: true,
  autoRechargeSmsOrCallByBalanceInUSD: 20,
  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
  lowCallAndSMSBalanceNotificationSentToOwners: false,
  failedCallAndSMSBalanceChargeNotificationSentToOwners: false,
  notEnabledSmsOrCallNotificationSentToOwners: false,
  sendInvoicesByEmail: false,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

function toProject(row: MessagingBalanceRow): Project {
  const project: Project = new Project();

  for (const [column, value] of Object.entries(row)) {
    (project as unknown as Record<string, unknown>)[column] = value;
  }

  project.id = new ObjectID(row._id);

  return project;
}

function applyValues(row: MessagingBalanceRow, values: unknown): void {
  for (const [column, value] of Object.entries(
    (values || {}) as Record<string, unknown>,
  )) {
    row[column] = value;
  }
}

/*
 * Installs the fakes (jest.spyOn, so jest.restoreAllMocks() in the test's
 * afterEach takes them away again) and answers with the world to drive and
 * read.
 */
export function useMessagingBalanceWorld(
  projectId: ObjectID,
  values: Partial<MessagingBalanceRow> = {},
): MessagingBalanceWorld {
  const row: MessagingBalanceRow = {
    ...DEFAULT_ROW,
    ...values,
    _id: projectId.toString(),
  } as MessagingBalanceRow;

  const charges: Array<number> = [];
  const ownerEmails: Array<MessagingBalanceOwnerEmail> = [];
  const cache: Map<string, string> = new Map<string, string>();

  let chargeError: Error | null = null;
  let lockError: Error | null = null;
  let isCacheConnected: boolean = true;
  let hasPaymentMethods: boolean = true;
  let chargeDelayInMs: number = 20;
  let whileCharging: (() => void) | null = null;

  // The lock: one holder per name, everyone else waits in line.
  const lockQueues: Map<string, Array<() => void>> = new Map();
  const heldLocks: Set<string> = new Set<string>();
  let holders: number = 0;
  let mostHolders: number = 0;
  let taken: number = 0;

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return toProject(row);
  }) as never);

  jest.spyOn(ProjectService, "updateOneById").mockImplementation((async (data: {
    data: unknown;
  }) => {
    applyValues(row, data.data);
    return 1;
  }) as never);

  // The recharge's credit: one statement, on the row as it is now.
  jest
    .spyOn(ProjectService, "creditSmsOrCallBalanceInUSDCents")
    .mockImplementation((async (data: { amountInUSDCents: number }) => {
      row.smsOrCallCurrentBalanceInUSDCents += data.amountInUSDCents;
      row.lowCallAndSMSBalanceNotificationSentToOwners = false;
      row.failedCallAndSMSBalanceChargeNotificationSentToOwners = false;
      row.notEnabledSmsOrCallNotificationSentToOwners = false;
      return row.smsOrCallCurrentBalanceInUSDCents;
    }) as never);

  // A message's cost: one statement, on the row as it is now.
  jest
    .spyOn(ProjectService, "deductSmsOrCallBalanceInUSDCents")
    .mockImplementation((async (data: { amountInUSDCents: number }) => {
      row.smsOrCallCurrentBalanceInUSDCents -= data.amountInUSDCents;
      row.notEnabledSmsOrCallNotificationSentToOwners = false;
      return row.smsOrCallCurrentBalanceInUSDCents;
    }) as never);

  // The owners' low-balance notice: one conditional UPDATE, on the row.
  jest
    .spyOn(ProjectService, "claimSmsOrCallLowBalanceNotice")
    .mockImplementation((async () => {
      if (row["deletedAt"] || row.lowCallAndSMSBalanceNotificationSentToOwners) {
        return false;
      }

      row.lowCallAndSMSBalanceNotificationSentToOwners = true;
      return true;
    }) as never);

  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockImplementation((async (
      id: ObjectID,
      subject: string,
      body: string,
    ) => {
      ownerEmails.push({ projectId: id.toString(), subject, body });
    }) as never);

  jest
    .spyOn(BillingService, "hasPaymentMethods")
    .mockImplementation((async () => {
      return hasPaymentMethods;
    }) as never);

  jest
    .spyOn(BillingService, "generateInvoiceAndChargeCustomer")
    .mockImplementation((async (
      _customerId: string,
      _itemText: string,
      amountInUsd: number,
    ) => {
      whileCharging?.();
      await wait(chargeDelayInMs);

      if (chargeError) {
        throw chargeError;
      }

      charges.push(amountInUsd);
    }) as never);

  jest.spyOn(Redis, "isConnected").mockImplementation((): boolean => {
    return isCacheConnected;
  });

  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    if (!isCacheConnected) {
      throw new Error("Cache is not connected");
    }

    return cache.get(`${namespace}-${key}`) || null;
  }) as never);

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    if (!isCacheConnected) {
      throw new Error("Cache is not connected");
    }

    cache.set(`${namespace}-${key}`, value);
  }) as never);

  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    if (!isCacheConnected) {
      throw new Error("Cache is not connected");
    }

    cache.delete(`${namespace}-${key}`);
  }) as never);

  jest.spyOn(GlobalCache, "setStringIfNotExists").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    if (!isCacheConnected) {
      throw new Error("Cache is not connected");
    }

    const name: string = `${namespace}-${key}`;

    if (cache.has(name)) {
      return false;
    }

    cache.set(name, value);
    return true;
  }) as never);

  jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }) => {
    if (lockError) {
      throw lockError;
    }

    const name: string = `${data.namespace}-${data.key}`;

    while (heldLocks.has(name)) {
      await new Promise<void>((resolve: () => void) => {
        const queue: Array<() => void> = lockQueues.get(name) || [];
        queue.push(resolve);
        lockQueues.set(name, queue);
      });
    }

    heldLocks.add(name);
    holders++;
    taken++;
    mostHolders = Math.max(mostHolders, holders);

    return { name } as unknown as SemaphoreMutex;
  }) as never);

  jest.spyOn(Semaphore, "release").mockImplementation((async (
    mutex: SemaphoreMutex,
  ) => {
    const name: string = (mutex as unknown as { name: string }).name;

    heldLocks.delete(name);
    holders--;

    const next: (() => void) | undefined = lockQueues.get(name)?.shift();

    if (next) {
      next();
    }
  }) as never);

  return {
    row,
    charges,
    ownerEmails,
    cache,
    mostLockHoldersAtOnce: (): number => {
      return mostHolders;
    },
    locksTaken: (): number => {
      return taken;
    },
    failChargesWith: (error: Error | null): void => {
      chargeError = error;
    },
    setHasPaymentMethods: (value: boolean): void => {
      hasPaymentMethods = value;
    },
    failLocksWith: (error: Error | null): void => {
      lockError = error;
    },
    setCacheConnected: (value: boolean): void => {
      isCacheConnected = value;
    },
    setChargeDelayInMs: (ms: number): void => {
      chargeDelayInMs = ms;
    },
    duringCharge: (callback: (() => void) | null): void => {
      whileCharging = callback;
    },
  };
}
