import * as mock from "jest-mock-extended";

let mockStripe: jest.Mocked<Stripe>;

jest.mock("stripe", () => {
  mockStripe = mock.mockDeep<Stripe>();
  return jest.fn(() => {
    return mockStripe;
  });
});

/*
 * A fresh Stripe for the next BillingService, without reloading any modules.
 *
 * The factory above runs once per require of "stripe", so a test that wanted an
 * untouched Stripe used to get one by way of jest.resetModules() - see
 * BillingServiceHelper, which stopped doing that because the reload, not the
 * mock, was the expensive half. The constructor it returns reads this binding
 * when it is called rather than closing over one object, so every generation of
 * BillingService hands out whatever mockStripe points at now, and tests reach
 * the same object through the live export.
 */
const resetStripeMock: () => void = (): void => {
  mockStripe = mock.mockDeep<Stripe>();
};

// import libraries to mock (we do it here because of hoisting)
import Stripe from "stripe";

// return the mocked library and the library itself
export { mockStripe, Stripe, resetStripeMock };
