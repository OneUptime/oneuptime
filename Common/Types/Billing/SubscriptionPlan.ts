import BadDataException from '../Exception/BadDataException';
import { JSONObject } from '../JSON';

export enum PlanSelect {
    Free = 'Free',
    Growth = 'Growth',
    Enterprise = 'Enterprise',
    Scale = 'Scale'
}

export default class SubscriptionPlan {
    private monthlyPlanId: string = '';
    private yearlyPlanId: string = '';
    private name: string = '';
    private monthlySubscriptionAmountInUSD: number = 0;
    private yearlySubscriptionAmountInUSD: number = 0;
    private order: number = -1;
    private trialPeriodInDays: number = 0;

    public constructor(
        monthlyPlanId: string,
        yearlyPlanId: string,
        name: string,
        monthlySubscriptionAmountInUSD: number,
        yearlySubscriptionAmountInUSD: number,
        order: number,
        trialPeriodInDays: number
    ) {
        this.monthlyPlanId = monthlyPlanId;
        this.yearlyPlanId = yearlyPlanId;
        this.name = name;
        this.monthlySubscriptionAmountInUSD = monthlySubscriptionAmountInUSD;
        this.yearlySubscriptionAmountInUSD = yearlySubscriptionAmountInUSD;
        this.order = order;
        this.trialPeriodInDays = trialPeriodInDays;
    }

    public getMonthlyPlanId(): string {
        return this.monthlyPlanId;
    }

    public getYearlyPlanId(): string {
        return this.yearlyPlanId;
    }

    public getPlanOrder(): number {
        return this.order;
    }

    public getTrialPeriod(): number {
        return this.trialPeriodInDays;
    }

    public getName(): string {
        return this.name;
    }

    public static isFreePlan(planId: string, env: JSONObject): boolean {
        const plan: SubscriptionPlan | undefined = this.getSubscriptionPlanById(
            planId,
            env
        );
        if (plan) {
            if (
                plan.getMonthlyPlanId() === planId &&
                plan.getMonthlySubscriptionAmountInUSD() === 0
            ) {
                return true;
            }

            if (
                plan.getYearlyPlanId() === planId &&
                plan.getYearlySubscriptionAmountInUSD() === 0
            ) {
                return true;
            }
        }

        return false;
    }

    public static isCustomPricingPlan(
        planId: string,
        env: JSONObject
    ): boolean {
        const plan: SubscriptionPlan | undefined = this.getSubscriptionPlanById(
            planId,
            env
        );
        if (plan) {
            if (plan.getMonthlyPlanId() === planId && plan.isCustomPricing()) {
                return true;
            }
        }

        return false;
    }

    public getYearlySubscriptionAmountInUSD(): number {
        return this.yearlySubscriptionAmountInUSD;
    }

    public getMonthlySubscriptionAmountInUSD(): number {
        return this.monthlySubscriptionAmountInUSD;
    }

    public isCustomPricing(): boolean {
        return this.monthlySubscriptionAmountInUSD === -1;
    }

    public static getSubscriptionPlans(
        env: JSONObject
    ): Array<SubscriptionPlan> {
        const plans: Array<SubscriptionPlan> = [];

        for (const key in env || process.env) {
            if (key.startsWith('SUBSCRIPTION_PLAN_')) {
                const content: string =
                    ((env || process.env)[key] as string) || '';
                const values: Array<string> = content.split(',');

                if (values.length > 0) {
                    plans.push(
                        new SubscriptionPlan(
                            values[1] as string,
                            values[2] as string,
                            values[0] as string,
                            parseInt(values[3] as string),
                            parseInt(values[4] as string),
                            parseInt(values[5] as string),
                            parseInt(values[6] as string)
                        )
                    );
                }
            }
        }

        plans.sort((a: SubscriptionPlan, b: SubscriptionPlan) => {
            return a.order - b.order;
        });

        return plans;
    }

    public static getSubscriptionPlanById(
        planId: string,
        env: JSONObject
    ): SubscriptionPlan | undefined {
        const plans: Array<SubscriptionPlan> = this.getSubscriptionPlans(env);
        return plans.find((plan: SubscriptionPlan) => {
            return (
                plan.getMonthlyPlanId() === planId ||
                plan.getYearlyPlanId() === planId
            );
        });
    }

    public static isValidPlanId(planId: string, env: JSONObject): boolean {
        return Boolean(this.getSubscriptionPlanById(planId, env));
    }

    public static getPlanSelect(planId: string, env: JSONObject): PlanSelect {
        const plan: SubscriptionPlan | undefined = this.getSubscriptionPlanById(
            planId,
            env
        );
        if (!plan) {
            throw new BadDataException('Plan ID is invalid');
        }

        return plan.getName() as PlanSelect;
    }

    public static getSubscriptionPlanFromPlanSelect(
        planSelect: PlanSelect,
        env: JSONObject
    ): SubscriptionPlan {
        const plan: SubscriptionPlan | undefined = this.getSubscriptionPlans(
            env
        ).find((plan: SubscriptionPlan) => {
            return plan.getName() === planSelect;
        });

        if (!plan) {
            throw new BadDataException('Invalid Plan');
        }

        return plan;
    }

    public static isFeatureAccessibleOnCurrentPlan(
        featurePlan: PlanSelect,
        currentPlan: PlanSelect,
        env: JSONObject
    ): boolean {
        const featureSubscriptionPlan: SubscriptionPlan | undefined =
            this.getSubscriptionPlanFromPlanSelect(featurePlan, env);
        const currentSubscriptionPlan: SubscriptionPlan | undefined =
            this.getSubscriptionPlanFromPlanSelect(currentPlan, env);

        if (
            featureSubscriptionPlan.getPlanOrder() >
            currentSubscriptionPlan.getPlanOrder()
        ) {
            return false;
        }

        return true;
    }

    public static isYearlyPlan(planId: string, env: JSONObject): boolean {
        const plan: SubscriptionPlan | undefined = this.getSubscriptionPlanById(
            planId,
            env
        );
        return plan?.getYearlyPlanId() === planId;
    }

    public static isUnpaid(subscriptionStatus: string): boolean {
        if (
            subscriptionStatus === 'incomplete' ||
            subscriptionStatus === 'incomplete_expired' ||
            subscriptionStatus === 'past_due' ||
            subscriptionStatus === 'canceled' ||
            subscriptionStatus === 'unpaid'
        ) {
            return true;
        }

        return false;
    }
}
