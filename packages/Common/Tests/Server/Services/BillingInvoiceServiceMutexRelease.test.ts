import { Service as BillingInvoiceService } from "../../../Server/Services/BillingInvoiceService";
import logger from "../../../Server/Utils/Logger";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * refreshSubscriptionStatus runs on every invoice list and every pay attempt,
 * under a per-project Redis mutex. It only released that mutex when it got to
 * the end, so any Stripe or database error left the project locked until the
 * 15s lock timeout - and the next Pay Invoice click or invoice list waited on
 * the 20s acquire timeout first. The customer who clicked Pay Invoice ten
 * times during the stale-card incident was hitting exactly that path.
 */

const lockMock: jest.Mock = jest.fn();
const releaseMock: jest.Mock = jest.fn();
const findOneByIdMock: jest.Mock = jest.fn();
const updateOneByIdMock: jest.Mock = jest.fn();
const reactiveSubscriptionMock: jest.Mock = jest.fn();
const getSubscriptionStatusMock: jest.Mock = jest.fn();
const getInvoicesMock: jest.Mock = jest.fn();

jest.mock("stripe", () => {
  return jest.fn(() => {
    return {};
  });
});

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: (...args: Array<unknown>) => {
        return lockMock(...args);
      },
      release: (...args: Array<unknown>) => {
        return releaseMock(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return findOneByIdMock(...args);
      },
      updateOneById: (...args: Array<unknown>) => {
        return updateOneByIdMock(...args);
      },
      reactiveSubscription: (...args: Array<unknown>) => {
        return reactiveSubscriptionMock(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/BillingService", () => {
  return {
    __esModule: true,
    default: {
      getSubscriptionStatus: (...args: Array<unknown>) => {
        return getSubscriptionStatusMock(...args);
      },
      getInvoices: (...args: Array<unknown>) => {
        return getInvoicesMock(...args);
      },
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const MUTEX: { id: string } = { id: "mutex-for-project" };

describe("BillingInvoiceService.refreshSubscriptionStatus mutex", () => {
  let service: BillingInvoiceService;

  type RefreshFunction = () => Promise<void>;

  const refresh: RefreshFunction = (): Promise<void> => {
    return service.refreshSubscriptionStatus({ projectId: PROJECT_ID });
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new BillingInvoiceService();

    getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
    getJestSpyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });

    lockMock.mockReset().mockResolvedValue(MUTEX);
    releaseMock.mockReset().mockResolvedValue(undefined);
    findOneByIdMock.mockReset().mockResolvedValue({
      id: PROJECT_ID,
      paymentProviderCustomerId: "cus_stale_card_customer",
      paymentProviderSubscriptionId: "sub_plan",
      paymentProviderMeteredSubscriptionId: "sub_pinned_metered",
    });
    updateOneByIdMock.mockReset().mockResolvedValue(undefined);
    reactiveSubscriptionMock.mockReset().mockResolvedValue(undefined);
    getSubscriptionStatusMock
      .mockReset()
      .mockResolvedValue(SubscriptionStatus.Active);
    getInvoicesMock.mockReset().mockResolvedValue([]);
  });

  it("locks per project and releases the same mutex after a normal refresh", async () => {
    await refresh();

    expect(lockMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: PROJECT_ID.toString() }),
    );
    expect(updateOneByIdMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(MUTEX);
  });

  it("releases the mutex after reactivating a subscription whose invoices are all paid", async () => {
    getSubscriptionStatusMock.mockResolvedValue(SubscriptionStatus.Unpaid);
    getInvoicesMock.mockResolvedValue([{ status: "paid" }]);

    await refresh();

    expect(reactiveSubscriptionMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(
      updateOneByIdMock.mock.invocationCallOrder[
        updateOneByIdMock.mock.invocationCallOrder.length - 1
      ]!,
    ).toBeLessThan(releaseMock.mock.invocationCallOrder[0]!);
  });

  it("releases the mutex when the project lookup throws, and still reports the error", async () => {
    const failure: Error = new Error("database unavailable");
    findOneByIdMock.mockRejectedValue(failure);

    await expect(refresh()).rejects.toBe(failure);

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(MUTEX);
  });

  it("releases the mutex when the project does not exist", async () => {
    findOneByIdMock.mockResolvedValue(null);

    await expect(refresh()).rejects.toThrow(
      new BadDataException("Project not found"),
    );

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("releases the mutex when the project has no payment provider customer", async () => {
    findOneByIdMock.mockResolvedValue({ id: PROJECT_ID });

    await expect(refresh()).rejects.toThrow(BadDataException);

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("releases the mutex when Stripe fails to return the subscription status", async () => {
    const stripeFailure: Error = Object.assign(new Error("Stripe HTTP 500"), {
      type: "StripeAPIError",
    });
    getSubscriptionStatusMock.mockRejectedValue(stripeFailure);

    await expect(refresh()).rejects.toBe(stripeFailure);

    expect(updateOneByIdMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("releases the mutex when saving the refreshed status fails", async () => {
    const failure: Error = new Error("update failed");
    updateOneByIdMock.mockRejectedValue(failure);

    await expect(refresh()).rejects.toBe(failure);

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("releases the mutex when listing invoices for an inactive subscription fails", async () => {
    const failure: Error = new Error("Stripe invoices list failed");
    getSubscriptionStatusMock.mockResolvedValue(SubscriptionStatus.Canceled);
    getInvoicesMock.mockRejectedValue(failure);

    await expect(refresh()).rejects.toBe(failure);

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("releases the mutex exactly once when the thrown error happens late in the refresh", async () => {
    const failure: Error = new Error("final status write failed");
    getSubscriptionStatusMock.mockResolvedValue(SubscriptionStatus.Unpaid);
    getInvoicesMock.mockResolvedValue([]);
    updateOneByIdMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);

    await expect(refresh()).rejects.toBe(failure);

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("reports the refresh error, not the release error, when both fail", async () => {
    const failure: Error = new Error("database unavailable");
    const releaseFailure: Error = new Error("redis unavailable");
    findOneByIdMock.mockRejectedValue(failure);
    releaseMock.mockRejectedValue(releaseFailure);

    await expect(refresh()).rejects.toBe(failure);

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      releaseFailure,
      expect.objectContaining({ projectId: PROJECT_ID.toString() }),
    );
  });

  it("does not fail a successful refresh when releasing the mutex fails", async () => {
    releaseMock.mockRejectedValue(new Error("redis unavailable"));

    await expect(refresh()).resolves.toBeUndefined();

    expect(updateOneByIdMock).toHaveBeenCalledTimes(1);
  });

  it("still refreshes without a lock, and releases nothing, when the lock cannot be acquired", async () => {
    lockMock.mockRejectedValue(new Error("acquire timeout"));

    await refresh();

    expect(updateOneByIdMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("releases nothing when the lock cannot be acquired and the refresh throws", async () => {
    lockMock.mockRejectedValue(new Error("acquire timeout"));
    findOneByIdMock.mockResolvedValue(null);

    await expect(refresh()).rejects.toThrow(BadDataException);

    expect(releaseMock).not.toHaveBeenCalled();
  });
});
