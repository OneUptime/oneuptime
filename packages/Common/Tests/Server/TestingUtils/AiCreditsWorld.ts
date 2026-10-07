import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";

/*
 * A project's AI credits, with everything that touches them behind fakes, so
 * a test can drive the real AIService / AIBillingService paths: the project
 * row (reads, plain updates, the atomic add and decrement, the
 * compare-and-set claims), the payment provider (a charge takes a moment, so
 * concurrent callers really overlap), the shared cache (the auto-recharge
 * failure window, the billing failure notice window) and the distributed
 * lock (a real mutual exclusion, in process).
 *
 * The row is one plain object; every write lands on it, so what a test reads
 * back is what every writer did, in order.
 */

export interface AiCreditsRow {
  _id: string;
  name: string;
  enableAi: boolean;
  paymentProviderCustomerId: string;
  aiCurrentBalanceInUSDCents: number;
  enableAutoRechargeAiBalance: boolean;
  autoAiRechargeByBalanceInUSD: number;
  autoRechargeAiWhenCurrentBalanceFallsInUSD: number;
  lowAiBalanceNotificationSentToOwners: boolean;
  failedAiBalanceChargeNotificationSentToOwners: boolean;
  notEnabledAiNotificationSentToOwners: boolean;
  sendInvoicesByEmail: boolean;
  [column: string]: unknown;
}

export interface OwnerEmail {
  projectId: string;
  subject: string;
  body: string;
}

export interface AiCreditsWorld {
  row: AiCreditsRow;
  // Every charge the payment provider was asked to make, in USD.
  charges: Array<number>;
  // Every email to the project's owners, in order.
  ownerEmails: Array<OwnerEmail>;
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
  // The lock cannot be taken (the shared cache is down, say).
  failLocksWith: (error: Error | null) => void;
  // How long a charge takes, in ms.
  setChargeDelayInMs: (ms: number) => void;
}

const DEFAULT_ROW: Omit<AiCreditsRow, "_id"> = {
  name: "Acme Production",
  enableAi: true,
  paymentProviderCustomerId: "cus_ai_credits_world",
  aiCurrentBalanceInUSDCents: 0,
  enableAutoRechargeAiBalance: true,
  autoAiRechargeByBalanceInUSD: 20,
  autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
  lowAiBalanceNotificationSentToOwners: false,
  failedAiBalanceChargeNotificationSentToOwners: false,
  notEnabledAiNotificationSentToOwners: false,
  sendInvoicesByEmail: false,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

function toProject(row: AiCreditsRow): Project {
  const project: Project = new Project();

  for (const [column, value] of Object.entries(row)) {
    (project as unknown as Record<string, unknown>)[column] = value;
  }

  project.id = new ObjectID(row._id);

  return project;
}

function applyValues(row: AiCreditsRow, values: unknown): void {
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
export function useAiCreditsWorld(
  projectId: ObjectID,
  values: Partial<AiCreditsRow> = {},
): AiCreditsWorld {
  const row: AiCreditsRow = {
    ...DEFAULT_ROW,
    ...values,
    _id: projectId.toString(),
  } as AiCreditsRow;

  const charges: Array<number> = [];
  const ownerEmails: Array<OwnerEmail> = [];
  const cache: Map<string, string> = new Map<string, string>();

  let chargeError: Error | null = null;
  let lockError: Error | null = null;
  let hasPaymentMethods: boolean = true;
  let chargeDelayInMs: number = 20;

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

  jest
    .spyOn(ProjectService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: unknown }) => {
      applyValues(row, data.data);
    }) as never);

  jest
    .spyOn(ProjectService, "atomicAddToColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      add: Record<string, number>;
      set?: unknown;
    }) => {
      for (const [column, delta] of Object.entries(data.add || {})) {
        row[column] = Number(row[column] || 0) + delta;
      }
      applyValues(row, data.set);
    }) as never);

  jest
    .spyOn(ProjectService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      data: unknown;
      expectedData: Record<string, unknown>;
    }) => {
      for (const [column, expected] of Object.entries(data.expectedData)) {
        if (row[column] !== expected) {
          return false;
        }
      }

      applyValues(row, data.data);
      return true;
    }) as never);

  jest
    .spyOn(ProjectService, "deductAiBalanceInUSDCents")
    .mockImplementation((async (data: { amountInUSDCents: number }) => {
      row.aiCurrentBalanceInUSDCents -= data.amountInUSDCents;
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
      await wait(chargeDelayInMs);

      if (chargeError) {
        throw chargeError;
      }

      charges.push(amountInUsd);
    }) as never);

  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    return cache.get(`${namespace}-${key}`) || null;
  }) as never);

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    cache.set(`${namespace}-${key}`, value);
  }) as never);

  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    cache.delete(`${namespace}-${key}`);
  }) as never);

  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
    ) => {
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
    setChargeDelayInMs: (ms: number): void => {
      chargeDelayInMs = ms;
    },
  };
}
