import MeteredPlan from 'Common/Types/Billing/MeteredPlan';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import SubscriptionStatus from 'Common/Types/Billing/SubscriptionStatus';

import {
    BillingService,
    Invoice,
    PaymentMethod,
    SubscriptionItem,
} from '../../Services/BillingService';

import Errors from '../../Utils/Errors';

import { mockStripe, Stripe } from '../TestingUtils/__mocks__/Stripe.mock';
import {
    mockIsBillingEnabled,
    getStripeCustomer,
    getStripeSubscription,
    getSubscriptionPlanData,
    getCustomerData,
    getSubscriptionData,
    getMeteredSubscription,
    getChangePlanData,
    getCouponData,
    getStripeInvoice,
} from '../TestingUtils/Services/Helpers';

import {
    ChangePlan,
    CouponData,
    CustomerData,
    MeteredSubscription,
    PaymentMethodsResponse,
    Subscription,
} from '../TestingUtils/Services/Types';

describe('BillingService', () => {
    let billingService: BillingService;
    const customer: CustomerData = getCustomerData();
    const mockCustomer: Stripe.Customer = getStripeCustomer(
        customer.id.toString()
    );

    beforeEach(() => {
        jest.clearAllMocks();
        billingService = mockIsBillingEnabled(true);
    });

    describe('Customer Management', () => {
        describe('createCustomer', () => {
            it('should create a customer when valid data is provided', async () => {
                mockStripe.customers.create = jest
                    .fn()
                    .mockResolvedValue(mockCustomer);

                const result: string = await billingService.createCustomer(
                    customer
                );

                expect(result).toEqual(mockCustomer.id);
                expect(mockStripe.customers.create).toHaveBeenCalledWith({
                    name: customer.name,
                    email: customer.email.toString(),
                    metadata: {
                        id: customer.id.toString(),
                    },
                });
                expect(result).toBe(mockCustomer.id);
            });

            it('should throw an exception if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.createCustomer(customer)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });
        });

        describe('updateCustomerName', () => {
            it('should successfully update a customer name', async () => {
                const newName: string = 'newName';
                await billingService.updateCustomerName(
                    customer.id.toString(),
                    newName
                );
                expect(mockStripe.customers.update).toHaveBeenCalledWith(
                    customer.id.toString(),
                    { name: newName }
                );
            });

            it('should throw an exception if billing is not enabled for updating customer name', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.updateCustomerName('cust_123', 'Jane Doe')
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });
        });

        describe('deleteCustomer', () => {
            it('should successfully delete a customer', async () => {
                await billingService.deleteCustomer(customer.id.toString());

                expect(mockStripe.customers.del).toHaveBeenCalledWith(
                    customer.id.toString()
                );
            });

            it('should throw an exception if billing is not enabled for deleting customer', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.deleteCustomer('cust_123')
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });
        });
    });

    describe('Subscription Management', () => {
        jest.useFakeTimers();
        let mockDate: Date = new Date(2023, 3, 1); // April 1, 2023
        jest.setSystemTime(mockDate);

        let mockSubscription: Stripe.Subscription;
        const subscription: Subscription = getSubscriptionData();
        const subscriptionPlan: SubscriptionPlan = getSubscriptionPlanData();
        const meteredSubscription: MeteredSubscription =
            getMeteredSubscription(subscriptionPlan);

        beforeEach(() => {
            mockSubscription = getStripeSubscription();
            mockDate = new Date(2023, 3, 1);
        });

        describe('subscribeToMeteredPlan', () => {
            it('should successfully create a metered plan subscription with all required parameters', async () => {
                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                const result: {
                    meteredSubscriptionId: string;
                    trialEndsAt: Date | null;
                } = await billingService.subscribeToMeteredPlan(subscription);

                expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        customer: subscription.customerId,
                        items: [],
                        trial_end: 'now',
                    })
                );
                expect(result.meteredSubscriptionId).toBe(mockSubscription.id);
                expect(result.trialEndsAt).toBe(subscription.trialDate);
            });

            it('should create a metered plan subscription with a trial date in the future', async () => {
                const futureDate: Date = new Date();
                futureDate.setDate(futureDate.getDate() + 10); // 10 days in the future
                subscription.trialDate = futureDate;

                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                await billingService.subscribeToMeteredPlan(subscription);

                expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        trial_end: Math.floor(
                            subscription.trialDate.getTime() / 1000
                        ),
                    })
                );
            });

            it('should create a subscription without a trial when the trial date is not in the future', async () => {
                const pastDate: Date = new Date('2020-01-01');
                subscription.trialDate = pastDate;

                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                await billingService.subscribeToMeteredPlan(subscription);

                expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        trial_end: 'now',
                    })
                );
            });

            // it.only('should handle invalid metered plans', async () => {
            //     const mp: MeteredPlan = new MeteredPlan('price_123', 100, 'unit');
            //     subscription.serverMeteredPlans = [];

            //     (
            //         mockStripe.subscriptions.create as jest.Mock
            //     ).mockResolvedValueOnce(mockSubscription);

            //     await expect(
            //         billingService.subscribeToMeteredPlan(subscription)
            //     ).rejects.toThrow();
            // });

            it('should handle API errors during subscription creation', async () => {
                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockImplementation(() => {
                        throw new Error('Stripe API error');
                    });

                await expect(
                    billingService.subscribeToMeteredPlan(subscription)
                ).rejects.toThrowError('Stripe API error');
            });

            it('should correctly handle the promo code', async () => {
                subscription.promoCode = 'VALIDPROMO';

                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                await billingService.subscribeToMeteredPlan(subscription);

                expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        coupon: subscription.promoCode,
                    })
                );
            });

            it('should set the default payment method if provided', async () => {
                subscription.defaultPaymentMethodId = 'pm_123';

                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                await billingService.subscribeToMeteredPlan(subscription);

                expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        default_payment_method:
                            subscription.defaultPaymentMethodId,
                    })
                );
            });
        });

        describe('subscribeToPlan', () => {
            it('should not subscribe to plan if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.subscribeToPlan(meteredSubscription)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully subscribe a customer to a plan', async () => {
                const mockSubscription2: Stripe.Subscription =
                    getStripeSubscription();
                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValueOnce(mockSubscription)
                    .mockResolvedValueOnce(mockSubscription2);

                const result: {
                    subscriptionId: string;
                    meteredSubscriptionId: string;
                    trialEndsAt: Date | null;
                } = await billingService.subscribeToPlan(meteredSubscription);

                expect(result.subscriptionId).toEqual(mockSubscription.id);
                expect(result.meteredSubscriptionId).toEqual(
                    mockSubscription2.id
                );
                const datePlusTrialDays: number = mockDate.setDate(
                    mockDate.getDate() + subscriptionPlan.getTrialPeriod()
                );
                expect(result.trialEndsAt).toEqual(new Date(datePlusTrialDays));

                expect(mockStripe.subscriptions.create).toHaveBeenCalledTimes(
                    2
                );
                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    1,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        items: expect.arrayContaining([
                            expect.objectContaining({
                                price: meteredSubscription.isYearly
                                    ? subscriptionPlan.getYearlyPlanId()
                                    : subscriptionPlan.getMonthlyPlanId(),
                                quantity: meteredSubscription.quantity,
                            }),
                        ]),
                        trial_end: datePlusTrialDays / 1000,
                    })
                );
                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    2,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        trial_end: datePlusTrialDays / 1000,
                    })
                );
            });

            it('should subscribe without a trial when trial is false', async () => {
                meteredSubscription.trial = false;
                const mockSubscription2: Stripe.Subscription =
                    getStripeSubscription();

                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValueOnce(mockSubscription)
                    .mockResolvedValueOnce(mockSubscription2);

                const result: {
                    subscriptionId: string;
                    meteredSubscriptionId: string;
                    trialEndsAt: Date | null;
                } = await billingService.subscribeToPlan(meteredSubscription);

                expect(result.subscriptionId).toEqual(mockSubscription.id);
                expect(result.meteredSubscriptionId).toEqual(
                    mockSubscription2.id
                );
                expect(result.trialEndsAt).toBeNull();

                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    1,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        items: expect.arrayContaining([
                            expect.objectContaining({
                                price: meteredSubscription.isYearly
                                    ? subscriptionPlan.getYearlyPlanId()
                                    : subscriptionPlan.getMonthlyPlanId(),
                                quantity: meteredSubscription.quantity,
                            }),
                        ]),
                        trial_end: 'now',
                    })
                );
                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    2,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        trial_end: 'now',
                    })
                );
            });

            it('should apply a promo code if provided', async () => {
                meteredSubscription.promoCode = 'PROMO123';
                const mockSubscription2: Stripe.Subscription =
                    getStripeSubscription();
                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValueOnce(mockSubscription)
                    .mockResolvedValueOnce(mockSubscription2);

                const result: {
                    subscriptionId: string;
                    meteredSubscriptionId: string;
                    trialEndsAt: Date | null;
                } = await billingService.subscribeToPlan(meteredSubscription);

                expect(result.subscriptionId).toEqual(mockSubscription.id);
                expect(result.meteredSubscriptionId).toEqual(
                    mockSubscription2.id
                );

                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    1,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        items: expect.arrayContaining([
                            expect.objectContaining({
                                price: meteredSubscription.isYearly
                                    ? subscriptionPlan.getYearlyPlanId()
                                    : subscriptionPlan.getMonthlyPlanId(),
                                quantity: meteredSubscription.quantity,
                            }),
                        ]),
                        coupon: meteredSubscription.promoCode,
                    })
                );
                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    2,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        coupon: meteredSubscription.promoCode,
                    })
                );
            });

            it('should set the default payment method if provided', async () => {
                meteredSubscription.defaultPaymentMethodId = 'pm_123';
                const mockSubscription2: Stripe.Subscription =
                    getStripeSubscription();
                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValueOnce(mockSubscription)
                    .mockResolvedValueOnce(mockSubscription2);

                const result: {
                    subscriptionId: string;
                    meteredSubscriptionId: string;
                    trialEndsAt: Date | null;
                } = await billingService.subscribeToPlan(meteredSubscription);

                expect(result.subscriptionId).toEqual(mockSubscription.id);
                expect(result.meteredSubscriptionId).toEqual(
                    mockSubscription2.id
                );

                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    1,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        items: expect.arrayContaining([
                            expect.objectContaining({
                                price: meteredSubscription.isYearly
                                    ? subscriptionPlan.getYearlyPlanId()
                                    : subscriptionPlan.getMonthlyPlanId(),
                                quantity: meteredSubscription.quantity,
                            }),
                        ]),
                        default_payment_method:
                            meteredSubscription.defaultPaymentMethodId,
                    })
                );
                expect(mockStripe.subscriptions.create).toHaveBeenNthCalledWith(
                    2,
                    expect.objectContaining({
                        customer: meteredSubscription.customerId,
                        default_payment_method:
                            meteredSubscription.defaultPaymentMethodId,
                    })
                );
            });
        });

        describe('changeQuantity', () => {
            it('should not change quantity if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.changeQuantity(mockSubscription.id, 1)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully change the quantity of a subscription', async () => {
                const newQuantity: number = 2;

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);
                mockStripe.subscriptions.update = jest
                    .fn()
                    .mockResolvedValue({});

                await billingService.changeQuantity(
                    mockSubscription.id,
                    newQuantity
                );

                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                    mockSubscription.id
                );
                expect(
                    mockStripe.subscriptionItems.update
                ).toHaveBeenCalledWith(mockSubscription.items?.data[0]?.id, {
                    quantity: newQuantity,
                });
            });

            it('should handle subscription not found scenario in change quantity', async () => {
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(null);

                await expect(
                    billingService.changeQuantity('invalid_id', 2)
                ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
            });

            it('should not change quantity if the subscription is canceled', async () => {
                mockSubscription.status = 'canceled';
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                await billingService.changeQuantity(mockSubscription.id, 2);

                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalled();
                expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
            });

            it('should handle missing subscription item ID in the subscription', async () => {
                mockSubscription.items.data = [];
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                await expect(
                    billingService.changeQuantity(mockSubscription.id, 2)
                ).rejects.toThrow(
                    Errors.BillingService.SUBSCRIPTION_ITEM_NOT_FOUND
                );
            });
        });

        describe('changePlan', () => {
            const newPlan: ChangePlan = getChangePlanData(
                getSubscriptionPlanData()
            );

            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.changePlan(newPlan)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully change the plan', async () => {
                // mocks
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                mockStripe.subscriptions.del = jest.fn().mockResolvedValue({});

                const newMockSubscription: Stripe.Subscription =
                    getStripeSubscription();
                const newMockMeteredSubscription: Stripe.Subscription =
                    getStripeSubscription();

                mockStripe.subscriptions.create = jest
                    .fn()
                    .mockResolvedValueOnce(newMockSubscription)
                    .mockResolvedValueOnce(newMockMeteredSubscription);

                const mockPaymentMethods: Array<PaymentMethod> = [
                    {
                        id: 'pm_123',
                        type: 'card',
                        last4Digits: '4242',
                        isDefault: true,
                    },
                ];
                billingService.getPaymentMethods = jest
                    .fn()
                    .mockResolvedValue(mockPaymentMethods);

                const result: {
                    subscriptionId: string;
                    meteredSubscriptionId: string;
                    trialEndsAt?: Date | undefined;
                } = await billingService.changePlan(newPlan);

                expect(result.subscriptionId).toEqual(newMockSubscription.id);
                expect(result.meteredSubscriptionId).toEqual(
                    newMockMeteredSubscription.id
                );

                expect(mockStripe.subscriptions.del).toHaveBeenCalled();
                expect(mockStripe.subscriptions.del).toHaveBeenCalled();
                expect(mockStripe.subscriptions.create).toHaveBeenCalled();
            });

            it('should handle errors when the current subscription is not found', async () => {
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(null);

                await expect(
                    billingService.changePlan(newPlan)
                ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
            });

            it('should check for active payment methods before changing the plan', async () => {
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                const mockPaymentMethods: Array<PaymentMethod> =
                    Array<PaymentMethod>();
                billingService.getPaymentMethods = jest
                    .fn()
                    .mockResolvedValue(mockPaymentMethods);

                await expect(
                    billingService.changePlan(newPlan)
                ).rejects.toThrow(Errors.BillingService.NO_PAYMENTS_METHODS);
            });
        });

        describe('isSubscriptionActive', () => {
            it('should return true for an active subscription status', () => {
                const activeStatuses: Array<SubscriptionStatus> = [
                    SubscriptionStatus.Active,
                    SubscriptionStatus.Trialing,
                ];

                activeStatuses.forEach((status: SubscriptionStatus) => {
                    expect(
                        billingService.isSubscriptionActive(status)
                    ).toBeTruthy();
                });
            });

            it('should return false for an inactive subscription status', () => {
                const inactiveStatuses: Array<SubscriptionStatus> = [
                    SubscriptionStatus.Incomplete,
                    SubscriptionStatus.IncompleteExpired,
                    SubscriptionStatus.PastDue,
                    SubscriptionStatus.Canceled,
                    SubscriptionStatus.Unpaid,
                ];

                inactiveStatuses.forEach((status: SubscriptionStatus) => {
                    expect(
                        billingService.isSubscriptionActive(status)
                    ).toBeFalsy();
                });
            });
        });

        describe('addOrUpdateMeteredPricingOnSubscription', () => {
            const quantity: number = 10;

            it('should throw if billing is not enabled', async () => {
                const subscriptionItem: SubscriptionItem | undefined =
                    mockSubscription.items.data[0];
                const meteredPlan: MeteredPlan = new MeteredPlan(
                    subscriptionItem?.price?.id || '',
                    100,
                    'unit'
                );

                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.addOrUpdateMeteredPricingOnSubscription(
                        mockSubscription.id,
                        meteredPlan,
                        quantity
                    )
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully add metered pricing to a subscription', async () => {
                const subscriptionItem: SubscriptionItem | undefined =
                    mockSubscription.items.data[0];
                const meteredPlan: MeteredPlan = new MeteredPlan(
                    subscriptionItem?.price?.id || '',
                    100,
                    'unit'
                );

                mockSubscription.items.data = [];

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);
                mockStripe.subscriptionItems.create = jest
                    .fn()
                    .mockResolvedValue({ id: 'sub_item_123' });
                mockStripe.subscriptionItems.createUsageRecord = jest
                    .fn()
                    .mockResolvedValue({});

                await billingService.addOrUpdateMeteredPricingOnSubscription(
                    mockSubscription.id,
                    meteredPlan,
                    quantity
                );

                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                    mockSubscription.id
                );
                expect(
                    mockStripe.subscriptionItems.create
                ).toHaveBeenCalledWith({
                    subscription: mockSubscription.id,
                    price: meteredPlan.getPriceId(),
                });
                expect(
                    mockStripe.subscriptionItems.createUsageRecord
                ).toHaveBeenCalledWith('sub_item_123', { quantity });
            });

            it('should successfully update existing metered pricing on a subscription', async () => {
                const subscriptionItem: SubscriptionItem | undefined =
                    mockSubscription.items.data[0];
                const meteredPlan: MeteredPlan = new MeteredPlan(
                    subscriptionItem?.price?.id || '',
                    100,
                    'unit'
                );

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);
                mockStripe.subscriptionItems.createUsageRecord = jest
                    .fn()
                    .mockResolvedValue({});

                await billingService.addOrUpdateMeteredPricingOnSubscription(
                    mockSubscription.id,
                    meteredPlan,
                    quantity
                );

                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                    mockSubscription.id
                );
                expect(
                    mockStripe.subscriptionItems.createUsageRecord
                ).toHaveBeenCalledWith(subscriptionItem?.id, {
                    quantity: quantity,
                });
            });

            it('should handle non-existent subscription', async () => {
                const subscriptionItem: SubscriptionItem | undefined =
                    mockSubscription.items.data[0];
                const meteredPlan: MeteredPlan = new MeteredPlan(
                    subscriptionItem?.price?.id || '',
                    100,
                    'unit'
                );

                const subscriptionId: string = 'sub_nonexistent';
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(null);

                await expect(
                    billingService.addOrUpdateMeteredPricingOnSubscription(
                        subscriptionId,
                        meteredPlan,
                        quantity
                    )
                ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
            });
        });

        describe('isPromoCodeValid', () => {
            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.isPromoCodeValid('INVALID_PROMO_CODE')
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should return true for a valid promo code', async () => {
                const promoCode: string = 'VALIDPROMO';
                const mockCoupon: { valid: boolean } = { valid: true };

                mockStripe.coupons.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCoupon);

                const isValid: boolean = await billingService.isPromoCodeValid(
                    promoCode
                );

                expect(isValid).toBeTruthy();
                expect(mockStripe.coupons.retrieve).toHaveBeenCalledWith(
                    promoCode
                );
            });

            it('should return false for an invalid or expired promo code', async () => {
                const promoCode: string = 'INVALIDPROMO';
                const mockCoupon: { valid: boolean } = {
                    valid: false,
                };
                mockStripe.coupons.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCoupon);

                const isValid: boolean = await billingService.isPromoCodeValid(
                    promoCode
                );

                expect(isValid).toBeFalsy();
                expect(mockStripe.coupons.retrieve).toHaveBeenCalledWith(
                    promoCode
                );
            });

            it('should handle non-existent promo code', async () => {
                const promoCode: string = 'NONEXISTENTPROMO';

                mockStripe.coupons.retrieve = jest.fn().mockResolvedValue(null);

                await expect(
                    billingService.isPromoCodeValid(promoCode)
                ).rejects.toThrow(Errors.BillingService.PROMO_CODE_NOT_FOUND);

                expect(mockStripe.coupons.retrieve).toHaveBeenCalledWith(
                    promoCode
                );
            });

            it('should handle errors from the Stripe API', async () => {
                const promoCode: string = 'ERRORPROMO';

                mockStripe.coupons.retrieve = jest
                    .fn()
                    .mockImplementation(() => {
                        throw new Error();
                    });

                await expect(
                    billingService.isPromoCodeValid(promoCode)
                ).rejects.toThrow(Errors.BillingService.PROMO_CODE_INVALID);
            });
        });

        describe('removeSubscriptionItem', () => {
            const subscriptionId: string = 'sub_123';
            const subscriptionItemId: string = 'si_123';
            const isMeteredSubscriptionItem: boolean = false;

            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.removeSubscriptionItem(
                        subscriptionId,
                        subscriptionItemId,
                        isMeteredSubscriptionItem
                    )
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully remove a metered subscription item', async () => {
                const isMeteredSubscriptionItem: boolean = true;

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);
                mockStripe.subscriptionItems.del = jest
                    .fn()
                    .mockResolvedValue({});

                await billingService.removeSubscriptionItem(
                    subscriptionId,
                    subscriptionItemId,
                    isMeteredSubscriptionItem
                );

                expect(mockStripe.subscriptionItems.del).toHaveBeenCalledWith(
                    subscriptionItemId,
                    {
                        proration_behavior: 'create_prorations',
                        clear_usage: true,
                    }
                );
            });

            it('should successfully remove a metered subscription item when isMeteredSubscriptionItem', async () => {
                const subscriptionItemId: string =
                    mockSubscription.items.data[0]?.id || '';

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);
                mockStripe.subscriptionItems.del = jest
                    .fn()
                    .mockResolvedValue({});

                await billingService.removeSubscriptionItem(
                    mockSubscription.id,
                    subscriptionItemId,
                    isMeteredSubscriptionItem
                );

                expect(mockStripe.subscriptionItems.del).toHaveBeenCalledWith(
                    subscriptionItemId,
                    {}
                );
            });

            it('should handle non-existent subscription or subscription item', async () => {
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(null);

                await expect(
                    billingService.removeSubscriptionItem(
                        subscriptionId,
                        subscriptionItemId,
                        isMeteredSubscriptionItem
                    )
                ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
            });

            it('should handle errors from the Stripe API', async () => {
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);
                mockStripe.subscriptionItems.del = jest
                    .fn()
                    .mockImplementation(() => {
                        throw new Error('Stripe API error');
                    });

                await expect(
                    billingService.removeSubscriptionItem(
                        subscriptionId,
                        subscriptionItemId,
                        isMeteredSubscriptionItem
                    )
                ).rejects.toThrow('Stripe API error');
            });

            it('should not remove an item if the subscription is canceled', async () => {
                const isMeteredSubscriptionItem: boolean = false;
                mockSubscription.status = 'canceled';

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);
                mockStripe.subscriptionItems.del = jest.fn();

                await billingService.removeSubscriptionItem(
                    subscriptionId,
                    subscriptionItemId,
                    isMeteredSubscriptionItem
                );
                expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
            });
        });

        describe('getSubscriptionItems', () => {
            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.getSubscriptionItems(mockSubscription.id)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully retrieve subscription items for a given subscription', async () => {
                mockSubscription.items.data = [
                    // @ts-ignore
                    { id: 'item_1', price: { id: 'price_123' } },
                    // @ts-ignore
                    { id: 'item_2', price: { id: 'price_456' } },
                ];
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                const items: SubscriptionItem[] =
                    await billingService.getSubscriptionItems(
                        mockSubscription.id
                    );

                expect(items).toEqual(mockSubscription.items.data);
                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                    mockSubscription.id
                );
            });

            it('should handle the case where the subscription does not exist', async () => {
                const subscriptionId: string = 'sub_nonexistent';

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(null);

                await expect(
                    billingService.getSubscriptionItems(subscriptionId)
                ).rejects.toThrow(Errors.BillingService.SUBSCRIPTION_NOT_FOUND);
            });
        });
    });

    describe('Payment & Billing', () => {
        const customerId: string = 'cust_123';
        const invoiceId: string = 'inv_123';
        const paymentMethodId: string = 'pm_123';
        const subscriptionId: string = 'sub_123';

        const mockPaymentMethods: Array<PaymentMethod> = [
            {
                id: 'pm_123',
                type: 'card',
                last4Digits: '4242',
                isDefault: true,
            },
            {
                id: 'pm_456',
                type: 'card',
                last4Digits: '4343',
                isDefault: false,
            },
        ];

        describe('generateCouponCode', () => {
            const couponData: CouponData = getCouponData();
            const mockCoupon: { id: string; valid: boolean } = {
                id: 'coupon_123',
                valid: true,
            };

            it('should successfully generate a coupon code', async () => {
                mockStripe.coupons.create = jest
                    .fn()
                    .mockResolvedValue(mockCoupon);

                const result: string = await billingService.generateCouponCode(
                    couponData
                );

                expect(result).toEqual(mockCoupon.id);
                expect(mockStripe.coupons.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        name: couponData.name,
                        percent_off: couponData.percentOff,
                        duration: 'repeating',
                        duration_in_months: couponData.durationInMonths,
                        max_redemptions: couponData.maxRedemptions,
                        metadata: couponData.metadata,
                    })
                );
            });
        });

        describe('deletePaymentMethod', () => {
            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.deletePaymentMethod(
                        customerId,
                        paymentMethodId
                    )
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully delete a payment method', async () => {
                billingService.getPaymentMethods = jest
                    .fn()
                    .mockResolvedValue(mockPaymentMethods);

                mockStripe.paymentMethods.detach = jest
                    .fn()
                    .mockResolvedValue({});

                await billingService.deletePaymentMethod(
                    customerId,
                    paymentMethodId
                );

                expect(mockStripe.paymentMethods.detach).toHaveBeenCalledWith(
                    paymentMethodId
                );
            });

            it("should throw an exception if it's the only payment method", async () => {
                // mock a single payment method to simulate a scenario where deletion is not allowed
                const mockSinglePaymentMethod: Array<PaymentMethod> = [
                    {
                        id: paymentMethodId,
                        type: 'card',
                        last4Digits: '4242',
                        isDefault: true,
                    },
                ];
                billingService.getPaymentMethods = jest
                    .fn()
                    .mockResolvedValue(mockSinglePaymentMethod);

                await expect(
                    billingService.deletePaymentMethod(
                        customerId,
                        paymentMethodId
                    )
                ).rejects.toThrow(
                    Errors.BillingService.MIN_REQUIRED_PAYMENT_METHOD_NOT_MET
                );
            });
        });

        describe('hasPaymentMethods', () => {
            it('should return true if the customer has payment methods', async () => {
                billingService.getPaymentMethods = jest
                    .fn()
                    .mockResolvedValue(mockPaymentMethods);

                const result: boolean = await billingService.hasPaymentMethods(
                    customerId
                );

                expect(result).toBeTruthy();
                expect(billingService.getPaymentMethods).toHaveBeenCalledWith(
                    customerId
                );
            });

            it('should return false if the customer does not have payment methods', async () => {
                const mockEmptyPaymentMethods: PaymentMethod[] =
                    Array<PaymentMethod>();
                billingService.getPaymentMethods = jest
                    .fn()
                    .mockResolvedValue(mockEmptyPaymentMethods);

                const result: boolean = await billingService.hasPaymentMethods(
                    customerId
                );

                expect(result).toBeFalsy();
                expect(billingService.getPaymentMethods).toHaveBeenCalledWith(
                    customerId
                );
            });
        });

        describe('getPaymentMethods', () => {
            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.getPaymentMethods(customerId)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should return all payment methods for a customer', async () => {
                const mockPaymentMethodsResponse: {
                    data: Array<Stripe.PaymentMethod>;
                } = {
                    data: [
                        {
                            id: 'pm_123',
                            type: 'card',
                            // @ts-ignore
                            card: { last4: '4242', brand: 'mastercard' },
                            isDefault: true,
                        },
                        {
                            id: 'pm_456',
                            type: 'card',
                            // @ts-ignore
                            card: { last4: '4343', brand: 'mastercard' },
                            isDefault: true,
                        },
                    ],
                };
                mockStripe.paymentMethods.list = jest
                    .fn()
                    .mockResolvedValueOnce(mockPaymentMethodsResponse)
                    .mockResolvedValue({ data: [] });
                mockStripe.customers.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCustomer);

                const paymentMethods: PaymentMethod[] =
                    await billingService.getPaymentMethods(customerId);

                expect(paymentMethods).toHaveLength(2);
                expect(paymentMethods[0]?.id).toBe('pm_123');
                expect(paymentMethods[0]?.last4Digits).toBe('4242');

                expect(mockStripe.paymentMethods.list).toHaveBeenCalledWith({
                    customer: customerId,
                    type: 'card',
                });
            });

            it('should return an empty array if no payment methods are present', async () => {
                const mockEmptyPaymentMethodsResponse: {
                    data: Array<PaymentMethod>;
                } = { data: [] };

                mockStripe.paymentMethods.list = jest
                    .fn()
                    .mockResolvedValue(mockEmptyPaymentMethodsResponse);
                mockStripe.customers.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCustomer);

                const paymentMethods: PaymentMethod[] =
                    await billingService.getPaymentMethods(customerId);

                expect(paymentMethods).toEqual([]);
                expect(mockStripe.paymentMethods.list).toHaveBeenCalledWith({
                    customer: customerId,
                    type: 'card',
                });
            });
        });

        describe('getSetupIntentSecret', () => {
            it('should successfully return a setup intent secret', async () => {
                const mockSetupIntent: { client_secret: string } = {
                    client_secret: 'seti_123_secret_xyz',
                };
                mockStripe.setupIntents.create = jest
                    .fn()
                    .mockResolvedValue(mockSetupIntent);

                const secret: string =
                    await billingService.getSetupIntentSecret(customerId);

                expect(secret).toBe(mockSetupIntent.client_secret);
                expect(mockStripe.setupIntents.create).toHaveBeenCalledWith({
                    customer: customerId,
                });
            });

            it('should handle missing client secret in the response', async () => {
                mockStripe.setupIntents.create = jest
                    .fn()
                    .mockResolvedValue({});

                await expect(
                    billingService.getSetupIntentSecret(customerId)
                ).rejects.toThrow(Errors.BillingService.CLIENT_SECRET_MISSING);
            });
        });

        describe('cancelSubscription', () => {
            it('should successfully cancel a subscription', async () => {
                mockStripe.subscriptions.del = jest.fn().mockResolvedValue({
                    id: subscriptionId,
                    status: 'canceled',
                });

                await billingService.cancelSubscription(subscriptionId);

                expect(mockStripe.subscriptions.del).toHaveBeenCalledWith(
                    subscriptionId
                );
            });

            it('should handle errors from the Stripe API', async () => {
                const subscriptionId: string = 'sub_123';

                // mock an error response from the Stripe API
                mockStripe.subscriptions.del = jest
                    .fn()
                    .mockImplementation(() => {
                        throw new Error('Stripe API error');
                    });

                await billingService.cancelSubscription(subscriptionId);
                // todo: we could expect the error to be logged
            });

            it('should not cancel a subscription if billing is not enabled', async () => {
                const subscriptionId: string = 'sub_123';
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.cancelSubscription(subscriptionId)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
                expect(mockStripe.subscriptions.del).not.toHaveBeenCalled();
            });
        });

        describe('getSubscriptionStatus', () => {
            const expectedStatus: SubscriptionStatus =
                SubscriptionStatus.Active;

            it('should successfully retrieve the subscription status', async () => {
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue({
                        id: subscriptionId,
                        status: expectedStatus,
                    });

                const status: SubscriptionStatus =
                    await billingService.getSubscriptionStatus(subscriptionId);

                expect(status).toBe(expectedStatus);
                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                    subscriptionId
                );
            });

            it('should successfully retrieve the subscription status', async () => {
                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue({
                        id: subscriptionId,
                        status: expectedStatus,
                    });

                const status: SubscriptionStatus =
                    await billingService.getSubscriptionStatus(subscriptionId);

                expect(status).toBe(expectedStatus);
                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                    subscriptionId
                );
            });
        });

        describe('getSubscription', () => {
            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.getSubscription(subscriptionId)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should successfully retrieve subscription data', async () => {
                const subscriptionId: string = 'sub_123';
                const mockSubscription: Stripe.Subscription =
                    getStripeSubscription();

                mockStripe.subscriptions.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockSubscription);

                const subscription: Stripe.Subscription =
                    await billingService.getSubscription(subscriptionId);

                expect(subscription).toEqual(mockSubscription);
                expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
                    subscriptionId
                );
            });
        });

        describe('getInvoices', () => {
            it('should successfully retrieve a list of invoices for a customer', async () => {
                const mockInvoices: { data: Array<Stripe.Invoice> } = {
                    data: [getStripeInvoice(), getStripeInvoice()],
                };
                mockStripe.invoices.list = jest
                    .fn()
                    .mockResolvedValue(mockInvoices);

                const invoices: Array<Invoice> =
                    await billingService.getInvoices(customerId);

                expect(invoices).toEqual(
                    mockInvoices.data.map((invoice: Stripe.Invoice) => {
                        return {
                            id: invoice.id,
                            amount: invoice.amount_due,
                            currencyCode: invoice.currency,
                            customerId: invoice.customer,
                            downloadableLink: '',
                            status: 'paid',
                            subscriptionId: invoice.subscription,
                        };
                    })
                );
                expect(mockStripe.invoices.list).toHaveBeenCalledWith({
                    customer: customerId,
                    limit: 100,
                });
            });

            it('should return an empty array if no invoices are found for the customer', async () => {
                const mockEmptyInvoices: { data: Invoice[] } = { data: [] };
                mockStripe.invoices.list = jest
                    .fn()
                    .mockResolvedValue(mockEmptyInvoices);

                const invoices: Array<Invoice> =
                    await billingService.getInvoices(customerId);

                expect(invoices).toEqual([]);
                expect(mockStripe.invoices.list).toHaveBeenCalledWith({
                    customer: customerId,
                    limit: 100,
                });
            });
        });

        describe('generateInvoiceAndChargeCustomer', () => {
            const itemText: string = 'Service Charge';
            const amountInUsd: number = 100;
            const mockPaymentMethodsResponse: PaymentMethodsResponse = {
                data: [
                    {
                        id: 'pm_123',
                        type: 'card',
                        last4Digits: '4242',
                        isDefault: true,
                    },
                ],
            };

            it('should successfully generate an invoice and charge the customer', async () => {
                mockStripe.paymentMethods.list = jest
                    .fn()
                    .mockResolvedValueOnce(mockPaymentMethodsResponse)
                    .mockResolvedValue({ data: [] });
                mockStripe.customers.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCustomer);

                // mock responses for invoice creation, adding an item, and finalizing
                const mockInvoice: Invoice = getStripeInvoice();
                mockStripe.invoices.create = jest
                    .fn()
                    .mockResolvedValue(mockInvoice);
                mockStripe.invoiceItems.create = jest
                    .fn()
                    .mockResolvedValue({});
                mockStripe.invoices.finalizeInvoice = jest
                    .fn()
                    .mockResolvedValue({});

                // mock response for paying the invoice
                mockStripe.invoices.pay = jest.fn().mockResolvedValue({});

                await billingService.generateInvoiceAndChargeCustomer(
                    customerId,
                    itemText,
                    amountInUsd
                );

                expect(mockStripe.invoices.create).toHaveBeenCalledWith(
                    expect.objectContaining({ customer: customerId })
                );
                expect(mockStripe.invoiceItems.create).toHaveBeenCalledWith(
                    expect.objectContaining({ invoice: mockInvoice.id })
                );
                expect(
                    mockStripe.invoices.finalizeInvoice
                ).toHaveBeenCalledWith(mockInvoice.id);
                expect(mockStripe.invoices.pay).toHaveBeenCalledWith(
                    mockInvoice.id,
                    { payment_method: mockPaymentMethodsResponse.data[0]?.id }
                );
            });

            it('should handle payment method errors when creating the invoice', async () => {
                mockStripe.invoices.create = jest.fn().mockResolvedValue(null);

                await expect(
                    billingService.generateInvoiceAndChargeCustomer(
                        customerId,
                        itemText,
                        amountInUsd
                    )
                ).rejects.toThrow(Errors.BillingService.INVOICE_NOT_GENERATED);
            });

            it('should handle payment method errors when charging the invoice', async () => {
                mockStripe.paymentMethods.list = jest
                    .fn()
                    .mockResolvedValueOnce(mockPaymentMethodsResponse)
                    .mockResolvedValue({ data: [] });
                mockStripe.customers.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCustomer);

                // mock successful invoice creation and finalization
                const mockInvoice: Invoice = getStripeInvoice();
                mockStripe.invoices.create = jest
                    .fn()
                    .mockResolvedValue(mockInvoice);
                mockStripe.invoiceItems.create = jest
                    .fn()
                    .mockResolvedValue({});
                mockStripe.invoices.finalizeInvoice = jest
                    .fn()
                    .mockResolvedValue({});

                billingService.voidInvoice = jest.fn();

                // mock an error during invoice payment
                mockStripe.invoices.pay = jest.fn().mockImplementation(() => {
                    throw new Error('Payment method error');
                });

                await expect(
                    billingService.generateInvoiceAndChargeCustomer(
                        customerId,
                        itemText,
                        amountInUsd
                    )
                ).rejects.toThrow();
                expect(billingService.voidInvoice).toHaveBeenCalled();
            });
        });

        describe('voidInvoice', () => {
            it('should successfully void an invoice', async () => {
                const mockVoidedInvoice: Stripe.Invoice = getStripeInvoice();
                mockVoidedInvoice.status = 'void';

                mockStripe.invoices.voidInvoice = jest
                    .fn()
                    .mockResolvedValue(mockVoidedInvoice);

                const voidedInvoice: Stripe.Invoice =
                    await billingService.voidInvoice(invoiceId);

                expect(voidedInvoice).toEqual(mockVoidedInvoice);
                expect(mockStripe.invoices.voidInvoice).toHaveBeenCalledWith(
                    invoiceId
                );
            });
        });

        describe('payInvoice', () => {
            const mockPaymentMethodsResponse: PaymentMethodsResponse = {
                data: [
                    {
                        id: 'pm_123',
                        type: 'card',
                        last4Digits: '4242',
                        isDefault: true,
                    },
                ],
            };

            it('should throw if billing is not enabled', async () => {
                billingService = mockIsBillingEnabled(false);

                await expect(
                    billingService.payInvoice(customerId, invoiceId)
                ).rejects.toThrow(Errors.BillingService.BILLING_NOT_ENABLED);
            });

            it('should throw if no payments methods exist', async () => {
                mockStripe.paymentMethods.list = jest
                    .fn()
                    .mockResolvedValue({ data: [] });
                mockStripe.customers.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCustomer);

                await expect(
                    billingService.payInvoice(customerId, invoiceId)
                ).rejects.toThrow(Errors.BillingService.NO_PAYMENTS_METHODS);
            });

            it('should successfully pay an invoice', async () => {
                mockStripe.paymentMethods.list = jest
                    .fn()
                    .mockResolvedValueOnce(mockPaymentMethodsResponse)
                    .mockResolvedValue({ data: [] });
                mockStripe.customers.retrieve = jest
                    .fn()
                    .mockResolvedValue(mockCustomer);

                const mockPaidInvoice: Stripe.Invoice = getStripeInvoice();
                mockStripe.invoices.pay = jest
                    .fn()
                    .mockResolvedValue(mockPaidInvoice);

                const paidInvoice: Invoice = await billingService.payInvoice(
                    customerId,
                    mockPaidInvoice.id || ''
                );

                expect(paidInvoice).toEqual({
                    id: mockPaidInvoice.id,
                    amount: mockPaidInvoice.amount_due,
                    currencyCode: mockPaidInvoice.currency,
                    customerId: mockPaidInvoice.customer,
                    status: mockPaidInvoice.status,
                    downloadableLink: '',
                    subscriptionId: mockPaidInvoice.subscription,
                });
                expect(mockStripe.invoices.pay).toHaveBeenCalledWith(
                    mockPaidInvoice.id,
                    {
                        payment_method: paymentMethodId,
                    }
                );
            });
        });
    });
});
