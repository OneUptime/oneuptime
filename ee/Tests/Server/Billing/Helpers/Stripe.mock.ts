/*
 * A Stripe client whose every method is a jest mock: `stripe.customers.create`
 * and the like are made the first time a test or the code under test reads
 * them, answer undefined until a test says otherwise, and can be replaced
 * outright (`mockStripe.customers.create = jest.fn()...`). Two levels deep,
 * as Stripe's resources are. Built here rather than with a mocking library, so
 * ee/ needs no test dependency of its own.
 */
type MockedStripeResource = Record<string | symbol, unknown>;

// Read off the real object, never made into a mock: what jest and await probe.
const mockKeepsProperty: (
  target: MockedStripeResource,
  property: string | symbol,
) => boolean = (
  target: MockedStripeResource,
  property: string | symbol,
): boolean => {
  return (
    typeof property === "symbol" ||
    property in target ||
    property === "then" ||
    property === "asymmetricMatch" ||
    property === "$$typeof" ||
    property === "nodeType" ||
    property === "toJSON"
  );
};

const mockCreateLevel: (createChild: () => unknown) => MockedStripeResource = (
  createChild: () => unknown,
): MockedStripeResource => {
  return new Proxy<MockedStripeResource>(
    {},
    {
      get: (
        target: MockedStripeResource,
        property: string | symbol,
      ): unknown => {
        if (mockKeepsProperty(target, property)) {
          return target[property];
        }

        target[property] = createChild();
        return target[property];
      },
    },
  );
};

const mockCreateStripe: () => jest.Mocked<Stripe> = (): jest.Mocked<Stripe> => {
  return mockCreateLevel((): unknown => {
    return mockCreateLevel((): unknown => {
      return jest.fn();
    });
  }) as unknown as jest.Mocked<Stripe>;
};

let mockStripe: jest.Mocked<Stripe>;

jest.mock("stripe", () => {
  mockStripe = mockCreateStripe();
  return jest.fn(() => {
    return mockStripe;
  });
});

/*
 * A fresh Stripe for the next provider, without reloading any modules.
 *
 * The factory above runs once per require of "stripe", so a test that wanted an
 * untouched Stripe used to get one by way of jest.resetModules() - see
 * StripeBillingProviderHelper, which stopped doing that because the reload,
 * not the mock, was the expensive half. The constructor it returns reads this
 * binding when it is called rather than closing over one object, so every
 * generation of StripeBillingProvider hands out whatever mockStripe points at
 * now, and tests reach the same object through the live export.
 */
const resetStripeMock: () => void = (): void => {
  mockStripe = mockCreateStripe();
};

// import libraries to mock (we do it here because of hoisting)
import Stripe from "stripe";

// return the mocked library and the library itself
export { mockStripe, Stripe, resetStripeMock };
