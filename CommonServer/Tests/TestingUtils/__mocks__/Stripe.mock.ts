import * as mock from 'jest-mock-extended';
// import libraries to mock (we do it here because of hoisting)
import Stripe from 'stripe';

let mockStripe: jest.Mocked<Stripe> | null = null;

jest.mock('stripe', () => {
    mockStripe = mock.mockDeep<Stripe>();
    return jest.fn(() => {
        return mockStripe;
    });
});

// return the mocked library and the library itself
export { mockStripe, Stripe };
