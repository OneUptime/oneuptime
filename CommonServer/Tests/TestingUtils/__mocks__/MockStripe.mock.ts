import * as mock from 'jest-mock-extended';

let mockStripe: jest.Mocked<Stripe>;

jest.mock('stripe', () => {
    mockStripe = mock.mockDeep<Stripe>();
    return jest.fn(() => {
        return mockStripe;
    });
});

// import libraries to mock (we do it here because of hoisting)
import Stripe from 'stripe';

// return the mocked library and the library itself
export { mockStripe, Stripe };
