import { Service as BillingPaymentMethodService } from "../../../Server/Services/BillingPaymentMethodService";
import BillingService, {
  PaymentMethod,
} from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("stripe", () => {
  return jest.fn(() => {
    return {};
  });
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const CUSTOMER_ID: string = "cus_sync_test";

const CARD: PaymentMethod = {
  id: "pm_card",
  type: "visa",
  last4Digits: "4242",
  isDefault: true,
};

type SettledFunction = () => Promise<void>;

/*
 * Lets both callers get past their own awaits and reach the shared sync before
 * anything is asserted, without leaning on a fixed sleep.
 */
const settle: SettledFunction = async (): Promise<void> => {
  for (let i: number = 0; i < 20; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve: (value: void) => void) => {
    setTimeout(resolve, 5);
  });
};

/*
 * One billing page render issues two BillingPaymentMethod list requests at the
 * same time - the table, and the unfiltered count next to it - and every list
 * re-syncs the model from Stripe with five provider reads before it answers.
 * That doubled the provider traffic for a single page view, and pointed two
 * concurrent hard-delete-then-reinsert passes at the same rows.
 */
describe("BillingPaymentMethodService provider sync", () => {
  let service: BillingPaymentMethodService;
  let getPaymentMethods: jest.Mock;
  let deleteBy: jest.Mock;
  let create: jest.Mock;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new BillingPaymentMethodService();

    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      paymentProviderCustomerId: CUSTOMER_ID,
    } as never);

    // Slow enough that a second caller is guaranteed to arrive mid-read.
    getPaymentMethods = getJestSpyOn(
      BillingService,
      "getPaymentMethods",
    ).mockImplementation((): Promise<Array<PaymentMethod>> => {
      return new Promise((resolve: (value: Array<PaymentMethod>) => void) => {
        setTimeout(() => {
          return resolve([CARD]);
        }, 40);
      });
    }) as unknown as jest.Mock;

    deleteBy = getJestSpyOn(service, "deleteBy").mockResolvedValue(
      undefined as never,
    ) as unknown as jest.Mock;
    create = getJestSpyOn(service, "create").mockResolvedValue(
      undefined as never,
    ) as unknown as jest.Mock;
  });

  type OnBeforeFind = (findBy: unknown) => Promise<unknown>;

  const find: () => Promise<unknown> = (): Promise<unknown> => {
    return (service as unknown as { onBeforeFind: OnBeforeFind }).onBeforeFind({
      props: { tenantId: PROJECT_ID },
    });
  };

  it("reads the provider once for two overlapping list requests", async () => {
    const first: Promise<unknown> = find();
    const second: Promise<unknown> = find();

    await Promise.all([first, second]);

    expect(getPaymentMethods).toHaveBeenCalledTimes(1);
    // And only one delete-then-reinsert pass touched the rows.
    expect(deleteBy).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("gives both overlapping callers the same answer", async () => {
    const [a, b]: Array<unknown> = await Promise.all([find(), find()]);

    expect((a as { carryForward: Array<PaymentMethod> }).carryForward).toEqual([
      CARD,
    ]);
    expect((b as { carryForward: Array<PaymentMethod> }).carryForward).toEqual([
      CARD,
    ]);
  });

  it("does not cache past the in-flight window, so a newly added card is seen", async () => {
    await find();
    expect(getPaymentMethods).toHaveBeenCalledTimes(1);

    /*
     * A later, non-overlapping request must go back to the provider. This is
     * the "add a card, then look at the table" path, so a cache here would
     * show the user a table that does not contain the card they just added.
     */
    await find();
    expect(getPaymentMethods).toHaveBeenCalledTimes(2);
  });

  /*
   * This is what makes the admission path's denial cache safe to have at all.
   * The billing page reads this table immediately after a card is added, so
   * clearing the authorization here is what lets ingest be admitted on the
   * next batch instead of at the end of the denial TTL. Nothing else asserts
   * it, and dropping it would reintroduce a delay nobody would connect back
   * to this line.
   */
  it("clears the project's cached authorization once the provider has been read", async () => {
    const invalidate: jest.SpiedFunction<
      typeof PayAsYouGoBillingService.invalidate
    > = getJestSpyOn(PayAsYouGoBillingService, "invalidate").mockReturnValue(
      undefined,
    );

    await find();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate.mock.calls[0]![0]!.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  it("does not clear the cached authorization when the provider read fails", async () => {
    const invalidate: jest.SpiedFunction<
      typeof PayAsYouGoBillingService.invalidate
    > = getJestSpyOn(PayAsYouGoBillingService, "invalidate").mockReturnValue(
      undefined,
    );
    getPaymentMethods.mockRejectedValueOnce(new Error("provider unreachable"));

    await expect(find()).rejects.toThrow("provider unreachable");

    // A failed read learned nothing, so it must not claim the cache is stale.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not strand later callers when a provider read fails", async () => {
    getPaymentMethods.mockRejectedValueOnce(new Error("provider unreachable"));

    await expect(find()).rejects.toThrow("provider unreachable");
    await settle();

    // The failed sync must not be left in flight for every request after it.
    await find();
    expect(getPaymentMethods).toHaveBeenCalledTimes(2);
  });
});
