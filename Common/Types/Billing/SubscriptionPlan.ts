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

    public getYearlySubscriptionAmountInUSD(): number {
        return this.yearlySubscriptionAmountInUSD;
    }

    public getMonthlySubscriptionAmountInUSD(): number {
        return this.monthlySubscriptionAmountInUSD;
    }

    public isCustomPricing(): boolean {
        return this.monthlySubscriptionAmountInUSD === -1;
    }

    public static getSubscriptionPlans(): Array<SubscriptionPlan> {
        const plans: Array<SubscriptionPlan> = [];

        for (const key in process.env) {
            if (key.startsWith('SUBSCRIPTION_PLAN_')) {
                const content: string = (process.env[key] as string) || '';
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
        planId: string
    ): SubscriptionPlan | undefined {
        const plans: Array<SubscriptionPlan> = this.getSubscriptionPlans();
        return plans.find((plan: SubscriptionPlan) => {
            return plan.getMonthlyPlanId() === planId ||
                plan.getYearlyPlanId() === planId;
        });
    }

    public static isValidPlanId(planId: string): boolean {
        return !!this.getSubscriptionPlanById(planId)
    }
}
