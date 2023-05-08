import SubscriptionPlan, {
    PlanSelect,
} from '../../../Types/Billing/SubscriptionPlan';
import { JSONObject } from '../../../Types/JSON';
import BadDataException from '../../../Types/Exception/BadDataException';

describe('SubscriptionPlan', () => {
    const monthlyPlanId: string = 'monthly-plan-id';
    const yearlyPlanId: string = 'yearly-plan-id';
    const name: string = 'Test Plan';
    const monthlySubscriptionAmountInUSD: number = 0;
    const yearlySubscriptionAmountInUSD: number = 0;
    const order: number = 1;
    const trialPeriodInDays: number = 30;
    const env: JSONObject = {
        SUBSCRIPTION_PLAN_1: 'Free,monthly_plan_id,yearly_plan_id,0,0,1,7',
        SUBSCRIPTION_PLAN_2:
            'Growth,growth_monthly_plan_id,growth_yearly_plan_id,9,99,2,14',
    };

    describe('constructor', () => {
        it('should create a new SubscriptionPlan object', () => {
            const plan: SubscriptionPlan = new SubscriptionPlan(
                monthlyPlanId,
                yearlyPlanId,
                name,
                monthlySubscriptionAmountInUSD,
                yearlySubscriptionAmountInUSD,
                order,
                trialPeriodInDays
            );
            expect(plan.getMonthlyPlanId()).toEqual(monthlyPlanId);
            expect(plan.getYearlyPlanId()).toEqual(yearlyPlanId);
            expect(plan.getName()).toEqual(name);
            expect(plan.getPlanOrder()).toEqual(order);
            expect(plan.getTrialPeriod()).toEqual(trialPeriodInDays);
        });
    });

    describe('getMonthlyPlanId', () => {
        it('should return the monthly plan ID', () => {
            const getMonthlyPlanId: string = 'monthly-plan-id';
            expect(getMonthlyPlanId).toEqual(monthlyPlanId);
        });
    });

    describe('getYearlyPlanId', () => {
        it('should return the yearly plan ID', () => {
            const getYearlyPlanId: string = 'yearly-plan-id';
            expect(getYearlyPlanId).toEqual(yearlyPlanId);
        });
    });

    describe('getPlanOrder', () => {
        it('should return the plan order', () => {
            const getPlanOrder: number = 1;
            expect(getPlanOrder).toEqual(order);
        });
    });

    describe('getTrialPeriod', () => {
        it('should return the trial period in days', () => {
            const getTrialPeriod: number = 30;
            expect(getTrialPeriod).toEqual(trialPeriodInDays);
        });
    });

    describe('getName', () => {
        it('should return the plan name', () => {
            const getName: string = 'Test Plan';
            expect(getName).toEqual(name);
        });
    });

    describe('isFreePlan', () => {
        it('should return true if plan is free with monthlyId', () => {
            const isFreePlan: boolean = SubscriptionPlan.isFreePlan(
                'monthly_plan_id',
                env
            );
            expect(isFreePlan).toBe(true);
        });
        it('should return true if plan is free with yearlyId', () => {
            const isFreePlan: boolean = SubscriptionPlan.isFreePlan(
                'yearly_plan_id',
                env
            );
            expect(isFreePlan).toBe(true);
        });
    });
    describe('isCustomPricingPlan', () => {
        it('should return false if plan is not custom pricing', () => {
            const isCustomPricingPlan: boolean =
                SubscriptionPlan.isCustomPricingPlan(monthlyPlanId, env);
            expect(isCustomPricingPlan).toBe(false);
        });
    });

    describe('getSubscriptionPlans', () => {
        it('should return an array of SubscriptionPlan objects', () => {
            const subscriptionPlans: SubscriptionPlan[] =
                SubscriptionPlan.getSubscriptionPlans(env);

            expect(subscriptionPlans.length).toBe(2);
            expect(subscriptionPlans?.[0]?.getName()).toBe('Free');
            expect(subscriptionPlans?.[0]?.getYearlyPlanId()).toBe(
                'yearly_plan_id'
            );
        });
    });
    describe('isValidPlanId', () => {
        it('should return true if plan ID is valid', () => {
            const isValidPlanId: boolean = SubscriptionPlan.isValidPlanId(
                'growth_monthly_plan_id',
                env
            );
            expect(isValidPlanId).toBe(true);
        });
    });
    describe('getPlanSelect', () => {
        it('should return the plan name if valid planId is passed', () => {
            const plan: SubscriptionPlan = new SubscriptionPlan(
                monthlyPlanId,
                'yearly-plan-id',
                PlanSelect.Free,
                0,
                0,
                2,
                30
            );
            SubscriptionPlan.getSubscriptionPlanById = jest
                .fn()
                .mockReturnValue(plan);
            const result: PlanSelect = SubscriptionPlan.getPlanSelect(
                monthlyPlanId,
                env
            );
            expect(result).toBe(PlanSelect.Free);
        });
        it('should throw an error if invalid PlanId is passed', () => {
            SubscriptionPlan.getSubscriptionPlanById = jest
                .fn()
                .mockReturnValue(undefined);
            expect(() => {
                SubscriptionPlan.getPlanSelect('invalid-plan-id', env);
            }).toThrow(BadDataException);
        });
    });
    describe('getYearlySubscriptionAmountInUSD', () => {
        it('should return the yearly subscription amount', () => {
            const getYearlySubscriptionAmountInUSD: number = 0;
            expect(getYearlySubscriptionAmountInUSD).toEqual(
                yearlySubscriptionAmountInUSD
            );
        });
    });
    describe('getMonthlySubscriptionAmountInUSD', () => {
        it('should return the yearly subscription amount', () => {
            const getMonthlySubscriptionAmountInUSD: number = 0;
            expect(getMonthlySubscriptionAmountInUSD).toEqual(
                monthlySubscriptionAmountInUSD
            );
        });
    });
    describe('getSubscriptionPlanFromPlanSelect', () => {
        it('should return the correct SubscriptionPlan when a valid planSelect is provided', () => {
            const plan: SubscriptionPlan =
                SubscriptionPlan.getSubscriptionPlanFromPlanSelect(
                    PlanSelect.Growth,
                    env
                );
            expect(plan).toEqual(plan);
            expect(plan.getName()).toEqual(PlanSelect.Growth);
        });
        it('should throw a BadDataException when an invalid planSelect is provided', () => {
            const planSelect: PlanSelect = PlanSelect.Scale;
            SubscriptionPlan.getSubscriptionPlans = jest
                .fn()
                .mockReturnValue([]);
            expect(() => {
                SubscriptionPlan.getSubscriptionPlanFromPlanSelect(
                    planSelect,
                    env
                );
            }).toThrow(BadDataException);
        });
    });
    describe('isFeatureAccessibleOnCurrentPlan', () => {
        it('should return false if the feature is not accessible on current plan', () => {
            const featurePlan: PlanSelect = PlanSelect.Growth;
            const currentPlan: PlanSelect = PlanSelect.Free;
            const featureSubscriptionPlan: SubscriptionPlan =
                new SubscriptionPlan(
                    'growth_monthly_plan_id',
                    'growth_yearly_plan_id',
                    'Growth',
                    10,
                    100,
                    3,
                    7
                );
            const currentSubscriptionPlan: SubscriptionPlan =
                new SubscriptionPlan(
                    monthlyPlanId,
                    yearlyPlanId,
                    name,
                    monthlySubscriptionAmountInUSD,
                    yearlySubscriptionAmountInUSD,
                    order,
                    trialPeriodInDays
                );
            SubscriptionPlan.getSubscriptionPlanFromPlanSelect = jest
                .fn()
                .mockReturnValueOnce(featureSubscriptionPlan)
                .mockReturnValueOnce(currentSubscriptionPlan);
            const result: boolean =
                SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                    featurePlan,
                    currentPlan,
                    env
                );
            expect(result).toBe(false);
        });
        it('should return true if the feature is on the current plan', () => {
            const featurePlan: PlanSelect = PlanSelect.Free;
            const currentPlan: PlanSelect = PlanSelect.Growth;
            const featureSubscriptionPlan: SubscriptionPlan =
                new SubscriptionPlan(
                    'feature-plan-id',
                    'yearly-plan-id',
                    'Free',
                    0,
                    0,
                    1,
                    0
                );
            const currentSubscriptionPlan: SubscriptionPlan =
                new SubscriptionPlan(
                    'current-plan-id',
                    'yearly-plan-id',
                    'Growth',
                    10,
                    100,
                    5,
                    7
                );
            SubscriptionPlan.getSubscriptionPlanFromPlanSelect = jest
                .fn()
                .mockReturnValueOnce(featureSubscriptionPlan)
                .mockReturnValueOnce(currentSubscriptionPlan);

            const result: boolean =
                SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                    featurePlan,
                    currentPlan,
                    env
                );
            expect(result).toBe(true);
        });
    });
    describe('isYearlyPlan', () => {
        it('should return true if yearly plan exists', () => {
            const planId: string = 'growth_yearly_plan_id';
            const plan: SubscriptionPlan = new SubscriptionPlan(
                'monthly-plan-id',
                planId,
                'Growth',
                10,
                100,
                2,
                7
            );
            SubscriptionPlan.getSubscriptionPlanById = jest
                .fn()
                .mockReturnValueOnce(plan);
            const result: boolean = SubscriptionPlan.isYearlyPlan(planId, env);
            expect(result).toBe(true);
        });
    });
    describe('isUnpaid', () => {
        it('should return true if the subscription status is unpaid', () => {
            const subscriptionStatus: string = 'unpaid';
            const result: boolean =
                SubscriptionPlan.isUnpaid(subscriptionStatus);
            expect(result).toBe(true);
        });
        it('should return false if the subscription status is active', () => {
            const subscriptionStatus: string = 'active';
            const result: boolean =
                SubscriptionPlan.isUnpaid(subscriptionStatus);
            expect(result).toBe(false);
        });
    });
});
